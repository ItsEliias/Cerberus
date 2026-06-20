// Agent memory viewer — 4 behavioural tests for the panel extensions in
// static/js/cyberapps/command-center/agents.js.
//
// Pattern matches the other CC tests: load the module source into a vm
// sandbox with a minimal DOM shim + stubbed fetch, then drive the
// __testables exports directly (the agents.js full module imports
// ./chat.js, which we don't need here — running in a vm sandbox lets us
// skip module resolution).
//
//   1. Search filter hides non-matching rows and restores them on clear.
//   2. Count updates after a successful delete (fetch mocked).
//   3. Agent-specific filter — entries with matching agent_id appear,
//      non-matching ones don't.
//   4. Fallback to recent-10 when no entries match the agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, '..', 'static/js/cyberapps/command-center/agents.js');
let SRC = readFileSync(SRC_PATH, 'utf8');

// Strip ES-module syntax so the source runs as a plain script in a vm context.
SRC = SRC.replace(/^import\s+[^;]+;\s*$/gm, '// (import stripped)');
SRC = SRC.replace(/^export\s+async\s+function\s+/gm, 'async function ');
SRC = SRC.replace(/^export\s+function\s+/gm, 'function ');
SRC = SRC.replace(/^export\s+const\s+/gm, 'const ');
SRC += '\nthis.__t = __testables;';

// ── Tiny DOM shim ──────────────────────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _attrs: {},
    parentElement: null,
    style: {},
    dataset: {},
    isContentEditable: false,
    _listeners: {},
    _innerHTML: '',
    _text: '',
    classList: {
      add(c)    { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
      toggle(c, f) {
        if (f === true)  { el._classes.add(c); return true; }
        if (f === false) { el._classes.delete(c); return false; }
        if (el._classes.has(c)) { el._classes.delete(c); return false; }
        el._classes.add(c); return true;
      },
    },
    get id() { return this._attrs.id || ''; },
    set id(v) { this._attrs.id = String(v); },
    get className() { return [...this._classes].join(' '); },
    set className(v) {
      this._classes.clear();
      String(v ?? '').split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v ?? '');
      this._children = [];
      // Synthesize stub children by scanning for tags + id/class attrs. We
      // only need class lookup for what shortcuts.js / agents.js querySelect.
      const tagRe = /<(\w+)\b([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(this._innerHTML))) {
        const childTag = m[1];
        if (/^(br|hr|img|input|meta|link|area|base|col|embed|param|source|track|wbr)$/i.test(childTag)) {
          // void elements still register
        }
        const attrs = m[2];
        const child = makeElement(childTag);
        const idM  = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        child.parentElement = el;
        this._children.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(child) {
      this._children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) this._children.splice(i, 1);
      child.parentElement = null;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(name, cb) { (this._listeners[name] = this._listeners[name] || []).push(cb); },
    removeEventListener() {},
    closest(sel) {
      let n = this.parentElement;
      while (n) {
        if (typeof sel === 'string') {
          if (sel.startsWith('.') && n._classes.has(sel.slice(1))) return n;
          if (sel.startsWith('#') && n._attrs.id === sel.slice(1))   return n;
        }
        n = n.parentElement;
      }
      return null;
    },
    querySelector(sel) {
      // Single-level walk + recursive on children. Supports .class and #id.
      if (typeof sel !== 'string') return null;
      for (const child of _walk(this)) {
        if (sel.startsWith('.') && child._classes.has(sel.slice(1))) return child;
        if (sel.startsWith('#') && child._attrs.id === sel.slice(1))  return child;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (typeof sel !== 'string') return [];
      const out = [];
      for (const child of _walk(this)) {
        if (sel.startsWith('.') && child._classes.has(sel.slice(1))) out.push(child);
        if (sel.startsWith('#') && child._attrs.id === sel.slice(1))  out.push(child);
      }
      return out;
    },
    focus() {},
  };
  return el;
}

function* _walk(node) {
  for (const c of node._children) {
    yield c;
    yield* _walk(c);
  }
}

function makePanel(agentId = 'agt-1') {
  const panel = makeElement('div');
  panel._classes.add('cc-ag-memory-panel');
  panel._attrs.id = `cc-ag-memory-${agentId}`;

  const note = makeElement('div');
  note._classes.add('cc-ag-mem-fallback-note');
  note.style.display = 'none';

  const search = makeElement('input');
  search._classes.add('cc-ag-mem-search-input');

  const list = makeElement('div');
  list._classes.add('cc-ag-memory-list');
  list._attrs.id = `cc-ag-memory-list-${agentId}`;

  const footer = makeElement('div');
  footer._classes.add('cc-ag-mem-footer');
  const count = makeElement('span');
  count._classes.add('cc-ag-mem-count');
  count.textContent = '0 entries';
  footer.appendChild(count);

  panel.appendChild(note);
  panel.appendChild(search);
  panel.appendChild(list);
  panel.appendChild(footer);

  return { panel, note, search, list, footer, count };
}

function makeDocument() {
  const byId = new Map();
  const doc = {
    body: makeElement('body'),
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { doc, byId };
}

function makeSandbox(fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) })) {
  const { doc } = makeDocument();
  const sandbox = {
    document: doc,
    window: {},
    fetch: fetchImpl,
    localStorage: {
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    },
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ──────────────────────────────────────────────────────────────

test('search filter hides non-matching entries and restores on clear', () => {
  const sb = makeSandbox();
  const t  = sb.__t;
  const { panel, list } = makePanel('agt-1');

  // Manually create three rendered rows
  for (const [text, cat] of [
    ['Likes terse code reviews', 'fact'],
    ['Prefers TypeScript',       'preference'],
    ['Owns three cats',          'fact'],
  ]) {
    const row = makeElement('div');
    row._classes.add('cc-ag-mem-row');
    row.dataset.memText     = text;
    row.dataset.memCategory = cat;
    list.appendChild(row);
  }

  // Filter for "typescript" — only the matching row should remain visible
  let shown = t._applyMemorySearch(list, 'typescript');
  assert.equal(shown, 1);
  const rows = list.querySelectorAll('.cc-ag-mem-row');
  assert.equal(rows[0]._classes.has('cc-ag-mem-row--hidden'), true,  'fact-row hidden');
  assert.equal(rows[1]._classes.has('cc-ag-mem-row--hidden'), false, 'matching row visible');
  assert.equal(rows[2]._classes.has('cc-ag-mem-row--hidden'), true,  'cats-row hidden');

  // Clearing the input restores every row
  shown = t._applyMemorySearch(list, '');
  assert.equal(shown, 3);
  rows.forEach(r => assert.equal(r._classes.has('cc-ag-mem-row--hidden'), false));

  // _setMemCount should reflect what's visible
  t._setMemCount(panel, shown);
  assert.equal(panel.querySelector('.cc-ag-mem-count').textContent, '3 entries');
});

test('count updates after a successful delete', async () => {
  const sb = makeSandbox(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  const t  = sb.__t;
  const { panel, list } = makePanel('agt-2');

  const entries = [
    { id: 'm1', text: 'Alpha', category: 'fact', agent_id: 'agt-2' },
    { id: 'm2', text: 'Beta',  category: 'fact', agent_id: 'agt-2' },
    { id: 'm3', text: 'Gamma', category: 'fact', agent_id: 'agt-2' },
  ];
  for (const e of entries) t._renderMemoryRow(e, 'agt-2', list, panel);
  t._setMemCount(panel, entries.length);
  assert.equal(panel.querySelector('.cc-ag-mem-count').textContent, '3 entries');

  // Click the delete button on the second row → fetch returns ok, row removed,
  // count updates to 2.
  const rows = list.querySelectorAll('.cc-ag-mem-row');
  const delBtn = rows[1].querySelector('.cc-ag-mem-del-btn');
  await delBtn._listeners.click[0]({ target: delBtn });
  await new Promise(r => setImmediate(r));

  const remaining = list.querySelectorAll('.cc-ag-mem-row');
  assert.equal(remaining.length, 2, 'one row removed');
  assert.equal(panel.querySelector('.cc-ag-mem-count').textContent, '2 entries',
               'count reflects the remaining rows');
});

test('agent-specific filter keeps only matching entries', () => {
  const sb = makeSandbox();
  const t  = sb.__t;

  const mixed = [
    { id: 'a', text: 'belongs to agt-1', agent_id: 'agt-1', timestamp: 100 },
    { id: 'b', text: 'belongs to agt-2', agent_id: 'agt-2', timestamp: 200 },
    { id: 'c', text: 'belongs to agt-1', agent_id: 'agt-1', timestamp: 300 },
    { id: 'd', text: 'untagged',                          timestamp: 400 },
  ];
  const out = t._filterMemoriesForAgent(mixed, 'agt-1');
  assert.equal(out.isFallback, false);
  assert.equal(out.entries.length, 2);
  assert.deepEqual(out.entries.map(e => e.id).sort(), ['a', 'c']);
});

test('falls back to the 10 most recent when no agent-specific entries match', () => {
  const sb = makeSandbox();
  const t  = sb.__t;

  // 12 untagged memories with ascending timestamps; agent has zero of its own
  const pool = Array.from({ length: 12 }, (_, i) => ({
    id: `mem-${i}`,
    text: `memory ${i}`,
    agent_id: 'someone-else',
    timestamp: i,
  }));

  const out = t._filterMemoriesForAgent(pool, 'agt-x');
  assert.equal(out.isFallback, true, 'fallback flag set');
  assert.equal(out.entries.length, 10, 'limited to recent-10');
  // Most recent first
  assert.equal(out.entries[0].id, 'mem-11', 'sorted newest first');
  assert.equal(out.entries[9].id, 'mem-2',  'oldest of the 10 newest');
});
