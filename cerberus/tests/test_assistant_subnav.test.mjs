// Tests for the ASSISTANT tab sub-navigation (feat/assistant-tab-subnav).
//
// Loads assistant.js in a vm sandbox with a minimal DOM shim and stubs for
// all imported modules, then exercises the sub-tab logic directly.
//
// node:test — run with: node --test tests/test_assistant_subnav.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = join(__dirname, '..', 'static/js/cyberapps/command-center/assistant.js');

let SRC = readFileSync(SRC_PATH, 'utf8');
// Strip ES-module import/export syntax so the source runs in a plain vm context
SRC = SRC.replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*/gm, '');
SRC = SRC.replace(/^export\s+const\s+/gm, 'const ');
SRC = SRC.replace(/^export\s+function\s+/gm, 'function ');
SRC += '\nthis.__t = __testables; this.__build = buildAssistantTab;';

// ── Minimal DOM shim ──────────────────────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _listeners: {},
    style: {},
    dataset: {},
    _attrs: {},
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    classList: {
      add(c)        { el._classes.add(c); },
      remove(c)     { el._classes.delete(c); },
      contains(c)   { return el._classes.has(c); },
      toggle(c, f)  {
        if (f === true)  { el._classes.add(c); return true; }
        if (f === false) { el._classes.delete(c); return false; }
        if (el._classes.has(c)) { el._classes.delete(c); return false; }
        el._classes.add(c); return true;
      },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k)    { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    _fire(evt, e = {}) {
      (this._listeners[evt] || []).forEach(fn => fn(e));
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() { this._fire('click'); },
    scrollTop: 0,
    scrollHeight: 0,
  };
  return el;
}

// Build a fake root that mirrors the sub-nav DOM structure produced by
// buildAssistantTab(). Each sub-tab and sub-panel is a real fake element so
// classList.toggle / style.display work correctly.
function makeFakeRoot() {
  const TABS = ['profile', 'notes', 'docs', 'contacts', 'memory', 'more'];

  const subtabs = TABS.map(id => {
    const b = makeElement('button');
    b.dataset.subtab = id;
    if (id === 'profile') b._classes.add('active');
    b._classes.add('cc-assistant-subtab');
    return b;
  });

  const subpanels = TABS.map(id => {
    const p = makeElement('div');
    p.dataset.panel = id;
    p._classes.add('cc-assistant-subpanel');
    p.style.display = id === 'profile' ? '' : 'none';
    return p;
  });

  const root = makeElement('div');
  root.querySelector = (sel) => {
    if (sel === '.cc-assistant-subtab.active') return subtabs.find(b => b._classes.has('active')) || null;
    if (sel.startsWith('.cc-assistant-subtab[data-subtab="')) {
      const id = sel.match(/data-subtab="([^"]+)"/)?.[1];
      return subtabs.find(b => b.dataset.subtab === id) || null;
    }
    if (sel === '#cc-op-profile-body' || sel === '#cc-op-profile-edit') return makeElement('div');
    return null;
  };
  root.querySelectorAll = (sel) => {
    if (sel === '.cc-assistant-subtab') return subtabs;
    if (sel === '.cc-assistant-subpanel') return subpanels;
    return [];
  };

  return { root, subtabs, subpanels };
}

// ── Build the vm sandbox ──────────────────────────────────────────────────

function buildSandbox(overrides = {}) {
  const calls = {};
  const track = (name) => { calls[name] = (calls[name] || 0) + 1; };

  const sandbox = vm.createContext({
    // Stubs for imported module functions
    startRecording:           () => {},
    stopRecording:            () => {},
    getIsRecording:           () => false,
    initVoice:                () => {},
    buildDocsPanel:           () => '<div class="cc-docs-stub"></div>',
    loadDocs:                 (r) => track('loadDocs'),
    buildNotesPanel:          () => '<div class="cc-notes-stub"></div>',
    loadNotes:                (r) => track('loadNotes'),
    buildResearchPanel:       () => '<div class="cc-research-stub"></div>',
    loadResearch:             (r) => track('loadResearch'),
    buildContactsPanel:       () => '<div class="cc-contacts-stub"></div>',
    loadContacts:             (r) => track('loadContacts'),
    buildMemoryTimelinePanel: () => '<div class="cc-memory-stub"></div>',
    loadMemoryTimeline:       (r) => track('loadMemoryTimeline'),
    buildChangelogPanel:      () => '<div class="cc-changelog-stub"></div>',
    loadChangelog:            (r) => track('loadChangelog'),
    // Browser globals
    window:      { matchMedia: () => ({ matches: false }) },
    document:    {
      createElement:    (t) => makeElement(t),
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById:   () => null,
      dispatchEvent:    () => {},
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame:  () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch:        async () => ({ ok: true, json: async () => ({}) }),
    setTimeout:   () => {},
    clearTimeout: () => {},
    console:      { info: () => {}, warn: () => {} },
    ...overrides,
    calls,
  });

  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test('1. Sub-nav renders 6 sub-tabs', () => {
  const sb = buildSandbox();
  const html = sb.__build();
  const matches = [...html.matchAll(/class="cc-assistant-subtab/g)];
  assert.equal(matches.length, 6, 'Should render exactly 6 sub-tabs');

  const expectedIds = ['profile', 'notes', 'docs', 'contacts', 'memory', 'more'];
  for (const id of expectedIds) {
    assert.ok(html.includes(`data-subtab="${id}"`), `Missing data-subtab="${id}"`);
  }
});

test('2. Only active panel visible by default (PROFILE)', () => {
  const sb = buildSandbox();
  const html = sb.__build();

  // All non-profile panels should have display:none inline
  const panels = ['notes', 'docs', 'contacts', 'memory', 'more'];
  for (const id of panels) {
    // Find the subpanel div for each id and confirm it has display:none
    const re = new RegExp(`data-panel="${id}"[^>]*style="display:none"`);
    assert.ok(re.test(html), `Panel "${id}" should start hidden`);
  }
  // Profile panel should NOT have display:none
  assert.ok(!html.match(/data-panel="profile"[^>]*style="display:none"/), 'Profile panel should be visible');
});

test('3. Clicking a sub-tab switches the active panel', () => {
  const sb = buildSandbox();
  const { root, subtabs, subpanels } = makeFakeRoot();

  sb.__t.activateSubtab(root, 'notes');

  // notes tab should be active
  const notesTab = subtabs.find(b => b.dataset.subtab === 'notes');
  assert.ok(notesTab._classes.has('active'), 'notes tab should become active');

  // profile tab should NOT be active
  const profileTab = subtabs.find(b => b.dataset.subtab === 'profile');
  assert.ok(!profileTab._classes.has('active'), 'profile tab should lose active state');

  // notes panel should be visible, profile panel hidden
  const notesPanel   = subpanels.find(p => p.dataset.panel === 'notes');
  const profilePanel = subpanels.find(p => p.dataset.panel === 'profile');
  assert.equal(notesPanel.style.display, '', 'notes panel should be visible');
  assert.equal(profilePanel.style.display, 'none', 'profile panel should be hidden');
});

test('4. Load fires only on first activation (lazy-load)', () => {
  const sb = buildSandbox();
  const { root } = makeFakeRoot();

  sb.__t.loadedPanels().clear();
  sb.calls.loadNotes = 0;

  // First activation — load should fire
  sb.__t.activateSubtab(root, 'notes');
  assert.equal(sb.calls.loadNotes, 1, 'loadNotes should fire on first activation');

  // Switch away then back — should NOT reload (already loaded)
  sb.__t.activateSubtab(root, 'docs');
  sb.__t.activateSubtab(root, 'notes');
  assert.equal(sb.calls.loadNotes, 1, 'loadNotes should NOT fire again on re-select from another tab');
});

test('5. Re-clicking the active sub-tab refreshes the panel', () => {
  const sb = buildSandbox();
  const { root, subtabs } = makeFakeRoot();

  sb.__t.loadedPanels().clear();
  sb.calls.loadNotes = 0;

  // First activation
  sb.__t.activateSubtab(root, 'notes');
  assert.equal(sb.calls.loadNotes, 1, 'loadNotes should fire on first activation');

  // Re-click the already-active notes tab — should refresh
  sb.__t.activateSubtab(root, 'notes');
  assert.equal(sb.calls.loadNotes, 2, 'loadNotes should fire again on re-click of active tab (refresh)');
});
