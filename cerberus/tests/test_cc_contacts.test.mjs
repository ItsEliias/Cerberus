// Tests for cc-contacts.js — contact rows, debounced server-side search,
// two-step delete, clipboard copy, and the vCard export download.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..',
  'static/js/cyberapps/command-center/cc-contacts.js');

// ─── Stubs ──────────────────────────────────────────────────────────────────

globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};
globalThis.document = {
  createElement: () => {
    let text = '';
    return {
      set textContent(v) { text = String(v ?? ''); },
      get textContent() { return text; },
      get innerHTML() {
        return text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      },
      // _downloadExport calls querySelector / click / remove on the anchor.
      querySelector: () => null,
      click: () => {},
      remove: () => {},
      style: {},
    };
  },
  body: { appendChild: () => {} },
  head: { appendChild: () => {} },
  getElementById: () => null,
};

const mod = await import(SRC + '?bust=' + Date.now());
const T = mod.__testables;

// ─── Fake container DOM ─────────────────────────────────────────────────────

function makeContainer() {
  const listCell = {
    innerHTML: '',
    // _renderRows iterates `list.querySelectorAll('.cc-contacts-row')` to wire
    // click handlers — the fake just returns an empty list since we assert on
    // innerHTML, not events.
    querySelectorAll: () => [],
  };
  const cells = {
    '#cc-contacts-list':   listCell,
    '#cc-contacts-detail': { innerHTML: '', style: {} },
    '#cc-contacts-msg':    { innerHTML: '', hidden: true, textContent: '',
                              classList: { toggle: () => {} } },
    '#cc-contacts-export-btn': { disabled: false, textContent: '↓ vCard' },
  };
  return {
    cells,
    querySelector: (sel) => cells[sel] || null,
    querySelectorAll: () => [],
  };
}

// `globalThis.navigator` is read-only in node. Use defineProperty so the
// clipboard-write tests can mutate it.
function _setNavigator(nav) {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav, writable: true, configurable: true,
  });
}

beforeEach(() => {
  globalThis.fetch = undefined;
});

// ─── 1. Rows render name + first email from a mock response ────────────────

test('rows render name + first email from list endpoint response', () => {
  const root = makeContainer();
  const contacts = [
    { uid: 'u1', name: 'Eliias',  emails: ['e@x.com'],   phones: ['+1-555-1234'] },
    { uid: 'u2', name: 'Liv',     emails: ['l@x.com'],   phones: [] },
    { uid: 'u3', name: 'No Email', emails: [],           phones: ['+1-555-9999'] },
  ];
  T._renderRows(root, contacts);
  const html = root.cells['#cc-contacts-list'].innerHTML;
  assert.match(html, /Eliias/);
  assert.match(html, /e@x\.com/);
  assert.match(html, /Liv/);
  assert.match(html, /l@x\.com/);
  // Empty-email row falls back to the phone.
  assert.match(html, /No Email/);
  assert.match(html, /\+1-555-9999/);
  // One .cc-contacts-row per contact.
  assert.equal((html.match(/cc-contacts-row/g) || []).length, 3);
});

test('empty contact list shows "// NO CONTACTS"', () => {
  const root = makeContainer();
  T._renderRows(root, []);
  assert.match(root.cells['#cc-contacts-list'].innerHTML, /NO CONTACTS/);
});

// ─── 2. Search hits the server-side /api/contacts/search endpoint ──────────

test('search calls the /api/contacts/search endpoint, not a client filter', async () => {
  const root = makeContainer();
  let called = null;
  globalThis.fetch = async (url) => {
    called = url;
    return {
      ok: true,
      async json() { return { results: [{ uid: 'u1', name: 'match', emails: ['m@x.com'], phones: [] }] }; },
    };
  };
  await T._doSearch(root, 'match');
  assert.ok(called, 'fetch was never invoked');
  assert.match(String(called), /\/api\/contacts\/search\?q=match/);
  // Result rendered.
  assert.match(root.cells['#cc-contacts-list'].innerHTML, /match/);
});

test('empty search query falls back to list (does NOT hit /search)', async () => {
  const root = makeContainer();
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() { return { contacts: [], count: 0 }; },
    };
  };
  await T._doSearch(root, '   ');
  assert.ok(calls.some(u => u.endsWith('/api/contacts/list')), `expected list call; got ${calls.join(', ')}`);
  assert.ok(!calls.some(u => u.includes('/search')), `unexpected search call; got ${calls.join(', ')}`);
});

// ─── 3. Search input is debounced (only ONE fetch for rapid input) ─────────

test('rapid typing only fires a single search fetch (debounce)', async () => {
  const root = makeContainer();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, async json() { return { results: [] }; } };
  };
  T._scheduleSearch(root, 'a');
  T._scheduleSearch(root, 'al');
  T._scheduleSearch(root, 'ali');
  T._scheduleSearch(root, 'alice');
  // Even on the (test-shortened) debounce window, only the last keystroke
  // should trigger a fetch.
  await new Promise(r => setTimeout(r, T.SEARCH_DEBOUNCE_MS + 80));
  assert.equal(calls, 1, `expected 1 fetch, got ${calls}`);
});

// ─── 4. DELETE is two-step — first click "arms", second click fires ───────

test('_twoStepDelete: first click arms the button, second click fires DELETE', async () => {
  const root = makeContainer();
  // Spy button. The shipped UI relies on `dataset.armed` to track state.
  const btn = {
    textContent: 'DELETE',
    dataset: { armed: undefined, original: undefined },
    classList: { add: () => { btn._added = true; }, remove: () => { btn._added = false; } },
  };
  let deleteCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'DELETE') {
      deleteCalls += 1;
      return { ok: true, async json() { return { success: true }; } };
    }
    return { ok: true, async json() { return { contacts: [], count: 0 }; } };
  };

  // First click — must NOT fire DELETE, just arm the button.
  T._twoStepDelete(root, { uid: 'u1', name: 'X' }, btn);
  assert.equal(btn.dataset.armed, '1');
  assert.equal(btn.textContent, 'CONFIRM DELETE');
  assert.equal(deleteCalls, 0);

  // Second click — fires DELETE.
  T._twoStepDelete(root, { uid: 'u1', name: 'X' }, btn);
  // Yield to the async _performDelete fetch.
  await new Promise(r => setTimeout(r, 5));
  assert.equal(deleteCalls, 1);
});

// ─── 5. Copy email writes to the navigator.clipboard API ──────────────────

test('_copyEmail writes to navigator.clipboard.writeText', async () => {
  const root = makeContainer();
  let written = null;
  _setNavigator({
    clipboard: {
      writeText: async (s) => { written = s; },
    },
  });
  await T._copyEmail(root, 'eliias@example.com');
  assert.equal(written, 'eliias@example.com');
});

test('_copyEmail with no email is a no-op (no clipboard call)', async () => {
  const root = makeContainer();
  let calls = 0;
  _setNavigator({
    clipboard: {
      writeText: async () => { calls += 1; },
    },
  });
  await T._copyEmail(root, '');
  assert.equal(calls, 0);
});

// ─── 6. Export hits the /api/contacts/export endpoint ─────────────────────

test('_downloadExport hits /api/contacts/export?format=vcf', async () => {
  const root = makeContainer();
  let called = null;
  globalThis.fetch = async (url) => {
    called = String(url);
    return {
      ok: true,
      headers: {
        get: (h) => h.toLowerCase() === 'content-disposition'
          ? 'attachment; filename="cerberus-contacts.vcf"' : null,
      },
      async blob() { return { size: 0, type: 'text/vcard' }; },
    };
  };
  // URL.createObjectURL + revokeObjectURL are required by the export path.
  globalThis.URL = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => {},
  };
  await T._downloadExport(root);
  assert.ok(called, 'fetch was never invoked');
  assert.match(called, /\/api\/contacts\/export\?format=vcf/);
});
