// Verifies localStorage persistence for the AGENTS-tab category collapse state.
// Loads the helpers from agents.js inside a vm sandbox with stubbed
// localStorage + DOM so the test stays isolated from the browser runtime.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/agents.js'),
  'utf8',
);

// Extract the collapse helpers block — we don't need anything else from the
// module, and pulling the whole file in pulls in DOM-only code.
const START = SRC.indexOf("const COLLAPSED_KEY");
const END   = SRC.indexOf("export const __testables");
assert.ok(START > 0 && END > START, 'collapse helpers block not found in agents.js');
const BLOCK = SRC.slice(START, END)
  + 'this._readCollapsedCats = _readCollapsedCats;'
  + 'this._writeCollapsedCats = _writeCollapsedCats;'
  + 'this._applyCollapsedState = _applyCollapsedState;'
  + 'this._toggleCollapsedFor = _toggleCollapsedFor;';

function makeSandbox({ throwOnWrite = false } = {}) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (throwOnWrite) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const queries = new Map();
  const elements = [];
  function makeEl(cat, collapsed) {
    const classList = new Set(collapsed ? ['collapsed'] : []);
    const el = {
      dataset: { cat },
      classList: {
        add: (c) => classList.add(c),
        remove: (c) => classList.delete(c),
        contains: (c) => classList.has(c),
        toggle: (c) => (classList.has(c) ? (classList.delete(c), false) : (classList.add(c), true)),
      },
      _classes: classList,
    };
    elements.push(el);
    return el;
  }
  const container = {
    querySelectorAll: (sel) => {
      if (sel === '.cc-cat-section') return elements;
      return [];
    },
  };
  return { localStorage, container, makeEl, store, elements };
}

test('collapse helpers round-trip via localStorage', () => {
  const { localStorage, container, makeEl, store } = makeSandbox();
  const ctx = vm.createContext({ localStorage, JSON, Set, Array });
  vm.runInContext(BLOCK, ctx);

  const sec1 = makeEl('core', false);
  const sec2 = makeEl('ops', false);
  const sec3 = makeEl('comms', false);

  // initial empty state → no write yet, no class changes
  ctx._applyCollapsedState(container);
  assert.equal(sec1._classes.has('collapsed'), false);

  // Simulate user clicking core then ops to collapse them
  sec1.classList.add('collapsed');
  ctx._toggleCollapsedFor(sec1);
  sec2.classList.add('collapsed');
  ctx._toggleCollapsedFor(sec2);

  const raw = store.get('cerberus.agents.collapsed');
  const stored = JSON.parse(raw);
  assert.deepEqual(stored.sort(), ['core', 'ops']);

  // Simulate page reload: fresh elements, no collapsed class, apply state
  const fresh1 = makeEl('core', false);
  const fresh2 = makeEl('ops', false);
  const fresh3 = makeEl('comms', false);
  // Strip the previously-collapsed seeds out of the queryable element list
  // by mutating the sandbox container to point at the fresh ones only.
  const container2 = {
    querySelectorAll: (sel) => (sel === '.cc-cat-section' ? [fresh1, fresh2, fresh3] : []),
  };
  ctx._applyCollapsedState(container2);
  assert.equal(fresh1._classes.has('collapsed'), true,  'core re-applied');
  assert.equal(fresh2._classes.has('collapsed'), true,  'ops re-applied');
  assert.equal(fresh3._classes.has('collapsed'), false, 'comms untouched');

  // Expand one — state should be removed
  fresh1.classList.remove('collapsed');
  ctx._toggleCollapsedFor(fresh1);
  const after = JSON.parse(store.get('cerberus.agents.collapsed'));
  assert.deepEqual(after, ['ops']);
});

test('collapse helpers swallow localStorage errors (private browsing)', () => {
  const { localStorage, makeEl } = makeSandbox({ throwOnWrite: true });
  const ctx = vm.createContext({ localStorage, JSON, Set, Array });
  vm.runInContext(BLOCK, ctx);

  const sec = makeEl('data', true);
  // Should not throw even though setItem throws synchronously
  assert.doesNotThrow(() => ctx._toggleCollapsedFor(sec));
});
