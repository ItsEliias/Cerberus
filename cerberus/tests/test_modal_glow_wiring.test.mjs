// Tests for modal-glow wiring (feat/wire-modal-glow).
//
// 1. Opening an allowlisted modal id adds .cerberus-orbit-glow + calls startOrbitGlow.
// 2. A non-allowlisted/confirm modal does NOT get the glow.
// 3. Closing a glowed modal calls stopOrbitGlow and removes the class.
// 4. research-overlay is not in GLOW_IDS (no double-glow).
//
// node:test — run with: node --test tests/test_modal_glow_wiring.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+async\s+function\s+/gm, 'async function ')
    .replace(/^import\s+.+$/gm, '');
}

function makeElement(initialClasses = []) {
  const classes = new Set(initialClasses);
  return {
    style: { setProperty() {} },
    classList: {
      add(...cs)      { cs.forEach(c => classes.add(c)); },
      remove(...cs)   { cs.forEach(c => classes.delete(c)); },
      contains(c)     { return classes.has(c); },
    },
  };
}

function buildSandbox() {
  const _windowHandlers = {};
  const _mutObs = []; // { el, cb, obs }

  const sb = vm.createContext({
    window: {
      matchMedia: () => ({ matches: false }),
      addEventListener: (evt, fn) => {
        _windowHandlers[evt] = _windowHandlers[evt] || [];
        _windowHandlers[evt].push(fn);
      },
    },
    document: { hidden: false },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    MutationObserver: class {
      constructor(cb) { this._cb = cb; }
      observe(el) { _mutObs.push({ el, cb: this._cb, obs: this }); }
      disconnect() {
        const i = _mutObs.findIndex(e => e.obs === this);
        if (i >= 0) _mutObs.splice(i, 1);
      }
    },
  });

  sb._fire = (type, detail) => {
    (_windowHandlers[type] || []).forEach(fn => fn({ detail }));
  };
  sb._triggerMutation = (el) => {
    _mutObs.filter(e => e.el === el).forEach(({ cb }) => cb());
  };

  return sb;
}

function buildCombinedSrc() {
  // glow-wiring.js imports startOrbitGlow/stopOrbitGlow — stripped by loadSrc.
  // Running both files in the same vm context makes those names available.
  const orbit  = loadSrc('static/js/orbit-glow.js');
  const wiring = loadSrc('static/js/glow-wiring.js');
  return [
    orbit,
    wiring,
    // expose internals for assertions (vm const is not on global; need this.X)
    'this.__glowing   = __testables._glowing;', // from orbit-glow
    'this.__glowIds   = GLOW_IDS;',             // from glow-wiring
    'this.__observers = _observers;',            // from glow-wiring
  ].join('\n');
}

// ── 1. Allowlisted modal gets glow ────────────────────────────────────────

test('1. allowlisted modal id adds .cerberus-orbit-glow and enters glowing set', () => {
  const sb = buildSandbox();
  vm.runInContext(buildCombinedSrc(), sb);

  const modal = makeElement();
  sb._fire('cerberus:modal-opened', { id: 'doclib-modal', modal });

  assert.ok(modal.classList.contains('cerberus-orbit-glow'),
    'modal must have .cerberus-orbit-glow class');
  assert.ok(sb.__glowing.has(modal),
    'modal must be in the orbit-glow glowing set');
});

// ── 2. Non-allowlisted modal does not get glow ────────────────────────────

test('2. non-allowlisted modal id does not get glow', () => {
  const sb = buildSandbox();
  vm.runInContext(buildCombinedSrc(), sb);

  const modal = makeElement();
  sb._fire('cerberus:modal-opened', { id: 'confirm-dialog', modal });

  assert.ok(!modal.classList.contains('cerberus-orbit-glow'),
    'non-allowlisted modal must not have glow class');
  assert.ok(!sb.__glowing.has(modal),
    'non-allowlisted modal must not be in glowing set');
});

// ── 3. Closing (hidden class) removes glow ────────────────────────────────

test('3. adding hidden class stops glow and removes .cerberus-orbit-glow', () => {
  const sb = buildSandbox();
  vm.runInContext(buildCombinedSrc(), sb);

  const modal = makeElement();
  sb._fire('cerberus:modal-opened', { id: 'gallery-modal', modal });

  assert.ok(modal.classList.contains('cerberus-orbit-glow'), 'pre: glow class present');
  assert.ok(sb.__glowing.has(modal),                         'pre: in glowing set');

  modal.classList.add('hidden');
  sb._triggerMutation(modal);

  assert.ok(!modal.classList.contains('cerberus-orbit-glow'), 'post: glow class removed');
  assert.ok(!sb.__glowing.has(modal),                         'post: removed from glowing set');
});

// ── 4. research-overlay excluded from allowlist ───────────────────────────

test('4. research-overlay is not in GLOW_IDS and receives no glow', () => {
  const sb = buildSandbox();
  vm.runInContext(buildCombinedSrc(), sb);

  assert.ok(!sb.__glowIds.has('research-overlay'),
    'research-overlay must not be in GLOW_IDS allowlist');

  const modal = makeElement();
  sb._fire('cerberus:modal-opened', { id: 'research-overlay', modal });

  assert.ok(!modal.classList.contains('cerberus-orbit-glow'),
    'research-overlay must not receive glow class');
  assert.ok(!sb.__glowing.has(modal),
    'research-overlay must not enter glowing set');
});
