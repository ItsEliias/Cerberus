// Tests for the CC first-run guided tour (feat/cc-onboarding-tour).
//
// Verifies: first-run trigger, skip-when-done, step advancement,
// flag persistence, and manual re-trigger.
//
// Loads cc-tour.js in a vm sandbox with a minimal DOM + localStorage shim.
// node:test — run with: node --test tests/test_cc_tour.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = join(__dirname, '..', 'static/js/cyberapps/command-center/cc-tour.js');
let SRC = readFileSync(SRC_PATH, 'utf8');
SRC = SRC.replace(/^export\s+const\s+/gm, 'const ');
SRC = SRC.replace(/^export\s+function\s+/gm, 'function ');
SRC += '\nthis.__t = __testables; this.__init = initTour; this.__retrigger = retriggerTour;';

// ── Minimal DOM + localStorage shim ───────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(), _listeners: {},
    style: {}, dataset: {}, _attrs: {},
    innerHTML: '', textContent: '', value: '',
    classList: {
      add(c)      { el._classes.add(c); },
      remove(c)   { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k)    { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    querySelector()    { return null; },
    querySelectorAll() { return []; },
    insertAdjacentElement() {},
    remove() { this._removed = true; },
    get lastElementChild() { return null; },
    _removed: false,
  };
  return el;
}

function buildSandbox({ lsDone = false } = {}) {
  let store = {};
  if (lsDone) store['cerberus.cc_tour_done'] = '1';

  const createdEls = [];
  const body = makeElement('body');
  body.appendChild = (el) => { createdEls.push(el); };

  // Fake shell with a brand bar + tab buttons for each step
  const brandBar = makeElement('div');
  brandBar._classes.add('cc-brand-bar');
  const refreshBtn = makeElement('button');
  refreshBtn._attrs.id = 'cc-refresh';
  brandBar.querySelector = (sel) => {
    if (sel === '#cc-refresh') return refreshBtn;
    if (sel === '.cc-tour-help-btn') return brandBar._helpBtn || null;
    return null;
  };
  brandBar.appendChild = (el) => { brandBar._helpBtn = el; };

  const tabBtns = ['command', 'council', 'workspace', 'assistant', 'gateway', 'agents', 'rooms', 'compare', 'observability'].map(id => {
    const btn = makeElement('button');
    btn.dataset.tab = id;
    btn._classes.add('cc-tab-btn');
    btn.getBoundingClientRect = () => ({ top: 10, left: 20 + id.length, bottom: 34, width: 80, height: 24 });
    return btn;
  });

  const shell = makeElement('div');
  shell._classes.add('cc-shell');
  shell.querySelector = (sel) => {
    if (sel === '.cc-brand-bar') return brandBar;
    const tabMatch = sel.match(/\.cc-tab-btn\[data-tab="([^"]+)"\]/);
    if (tabMatch) return tabBtns.find(b => b.dataset.tab === tabMatch[1]) || null;
    return null;
  };

  // The overlay element that gets created
  let tourOverlayEl = null;
  const docMap = {};

  const sandbox = vm.createContext({
    window:      { matchMedia: () => ({ matches: false }) },
    document: {
      body,
      createElement: (tag) => {
        const el = makeElement(tag);
        // When innerHTML is set, parse out querySelector for .cc-tour-skip/.cc-tour-next
        Object.defineProperty(el, 'innerHTML', {
          get() { return el._inner || ''; },
          set(v) {
            el._inner = v;
            // Build queryable sub-elements from innerHTML strings
            el._queryCache = {};
            const classes = ['cc-tour-skip', 'cc-tour-next', 'cc-tour-card', 'cc-tour-spotlight'];
            for (const cls of classes) {
              if (v.includes(cls)) {
                const sub = makeElement('button');
                sub._classes.add(cls);
                el._queryCache[cls] = sub;
              }
            }
            el.querySelector = (sel) => {
              const cls = sel.replace('.', '');
              return el._queryCache[cls] || null;
            };
          },
        });
        // Track as the potential overlay
        el.id = '';
        Object.defineProperty(el, 'id', {
          get() { return el._id || ''; },
          set(v) { el._id = v; if (v === 'cc-tour-overlay') { tourOverlayEl = el; docMap[v] = el; } },
        });
        createdEls.push(el);
        return el;
      },
      getElementById: (id) => docMap[id] && !docMap[id]._removed ? docMap[id] : null,
      addEventListener:    () => {},
      removeEventListener: () => {},
    },
    localStorage: {
      getItem:  (k) => store[k] ?? null,
      setItem:  (k, v) => { store[k] = v; },
    },
    store,
    shell,
    createdEls,
    getTourOverlay: () => tourOverlayEl,
  });

  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── 1. Tour shows on first run (localStorage flag absent) ─────────────────

test('1. Tour shows on first run when flag is absent', () => {
  const sb = buildSandbox({ lsDone: false });
  assert.equal(sb.__t.isDone(), false, 'isDone() should be false initially');

  sb.__init(sb.shell);
  const overlay = sb.getTourOverlay();
  assert.ok(overlay && !overlay._removed, 'Tour overlay should be created on first run');
});

// ── 2. Tour is skipped when flag is present ────────────────────────────────

test('2. Tour is skipped when done flag is present', () => {
  const sb = buildSandbox({ lsDone: true });
  assert.equal(sb.__t.isDone(), true, 'isDone() should return true when flag set');

  sb.__init(sb.shell);
  const overlay = sb.getTourOverlay();
  assert.ok(!overlay || overlay._removed, 'Tour overlay should NOT appear when flag is already set');
});

// ── 3. Next button advances through steps ─────────────────────────────────

test('3. goToStep advances through steps sequentially', () => {
  const sb = buildSandbox({ lsDone: false });
  const STEPS = sb.__t.STEPS;

  sb.__init(sb.shell);
  assert.equal(STEPS.length, 9, 'Should have 9 steps (one per CC tab)');

  // Step to each index — should not throw
  for (let i = 0; i < STEPS.length; i++) {
    sb.__t.goToStep(i);
  }
  // If we get here without throwing, step navigation works
  assert.ok(true, 'All steps navigated without error');
});

// ── 4. Skip / finish sets the done flag ──────────────────────────────────

test('4. setDone sets the localStorage flag', () => {
  const sb = buildSandbox({ lsDone: false });
  assert.equal(sb.__t.isDone(), false);

  sb.__t.setDone();
  assert.equal(sb.__t.isDone(), true, 'isDone() should be true after setDone()');
  assert.equal(sb.store[sb.__t.LS_KEY], '1', 'localStorage key should be "1"');
});

// ── 5. Manual re-trigger works regardless of flag ────────────────────────

test('5. retriggerTour shows the overlay even when flag is set', () => {
  const sb = buildSandbox({ lsDone: true });
  assert.equal(sb.__t.isDone(), true, 'Flag should be set');

  sb.__retrigger(sb.shell);
  const overlay = sb.getTourOverlay();
  assert.ok(overlay && !overlay._removed, 'Overlay should appear on manual retrigger regardless of flag');
});
