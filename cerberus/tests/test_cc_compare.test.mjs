// cc-compare — 5 behavioural tests for the COMPARE tab:
//   1. agent picker limits selection to MAX_AGENTS (4)
//   2. RUN is disabled with fewer than MIN_AGENTS (2) selected
//   3. result columns are created for each selected agent
//   4. an error stream in one column doesn't stop the others
//   5. NEW COMPARISON reset returns to the setup view
//
// Same vm-sandbox + DOM-shim pattern as the other CC tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-compare.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildCompareTab = buildCompareTab;'
  + '\nthis.loadCompareTab  = loadCompareTab;'
  + '\nthis.__t = __testables;';

// ── DOM shim ──────────────────────────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _attrs: {},
    parentElement: null,
    style: {},
    dataset: {},
    _innerHTML: '',
    _text: '',
    _listeners: {},
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
      // Nesting-aware parser: maintain a stack of open elements so children
      // get added to the right parent. Without this the mock builds a flat
      // list and querySelector inside a child can't find its descendants.
      const VOID = new Set(['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr']);
      const tokenRe = /<\s*(\/)?\s*(\w+)\b([^>]*?)(\/?)\s*>/g;
      const stack = [el];
      let m;
      while ((m = tokenRe.exec(this._innerHTML))) {
        const isClose = m[1] === '/';
        const tag     = m[2].toLowerCase();
        const attrs   = m[3];
        const selfClose = m[4] === '/' || VOID.has(tag);
        const parent = stack[stack.length - 1];
        if (isClose) {
          // Pop until we close this tag (or stack underflow — bail safely).
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
          }
          continue;
        }
        const child = makeElement(tag);
        const idM    = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM   = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const styleM = /\bstyle\s*=\s*"([^"]*)"/.exec(attrs);
        const idAttr = /\bdata-id\s*=\s*"([^"]*)"/.exec(attrs);
        const agentIdAttr = /\bdata-agent-id\s*=\s*"([^"]*)"/.exec(attrs);
        const stateAttr = /\bdata-state\s*=\s*"([^"]*)"/.exec(attrs);
        const disabled = /\bdisabled\b/.test(attrs);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (styleM) {
          const dM = /display\s*:\s*([^;"]+)/.exec(styleM[1]);
          if (dM) child.style.display = dM[1].trim();
        }
        if (idAttr) child.dataset.id = idAttr[1];
        if (agentIdAttr) child.dataset.agentId = agentIdAttr[1];
        if (stateAttr) child.dataset.state = stateAttr[1];
        if (disabled) child.disabled = true;
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) {
      this._text = String(v ?? '');
      // _esc(s) in production builds an element via document.createElement,
      // sets textContent, and reads back innerHTML to get the HTML-escaped
      // form. Mirror that here so the chip-render template's data-id="${_esc(a.id)}"
      // resolves to the agent id rather than empty.
      this._innerHTML = this._text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    appendChild(child) { this._children.push(child); child.parentElement = this; return child; },
    addEventListener(name, cb) { (this._listeners[name] = this._listeners[name] || []).push(cb); },
    removeEventListener() {},
    click() { (this._listeners.click || []).forEach(cb => cb({ target: this })); },
    focus() {},
    querySelector(sel) {
      const m = _selectorMatcher(sel);
      for (const c of _walk(this)) if (m(c)) return c;
      return null;
    },
    querySelectorAll(sel) {
      const m = _selectorMatcher(sel);
      const out = [];
      for (const c of _walk(this)) if (m(c)) out.push(c);
      return out;
    },
  };
  return el;
}

function* _walk(node) {
  for (const c of node._children) {
    yield c;
    yield* _walk(c);
  }
}

// Lightweight CSS selector compiler — handles `#id`, `.cls`, and
// `.cls[attr="val"]` which is all the production code reaches for.
function _selectorMatcher(sel) {
  if (typeof sel !== 'string' || !sel) return () => false;
  // Split into a base part + optional [attr="val"]
  const attrM = /^([^\[]+)(\[[^\]]+\])?$/.exec(sel.trim());
  if (!attrM) return () => false;
  const base = attrM[1];
  const attrClause = attrM[2];
  const baseMatch = (node) => {
    if (base.startsWith('#')) return node._attrs.id === base.slice(1);
    if (base.startsWith('.')) return node._classes.has(base.slice(1));
    return false;
  };
  if (!attrClause) return baseMatch;
  // [data-agent-id="foo"] / [data-state="streaming"]
  const aM = /^\[(\w[\w-]*)="?([^"\]]*)"?\]$/.exec(attrClause);
  if (!aM) return baseMatch;
  const attrName = aM[1];
  const attrVal  = aM[2];
  return (node) => {
    if (!baseMatch(node)) return false;
    // dataset is stored on .dataset for data-* attrs
    if (attrName.startsWith('data-')) {
      const key = attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return node.dataset && node.dataset[key] === attrVal;
    }
    return node._attrs[attrName] === attrVal;
  };
}

const AGENT_FIXTURES = [
  { id: 'a', name: 'CODER',      model_alias: 'sonnet' },
  { id: 'b', name: 'RESEARCHER', model_alias: 'sonnet' },
  { id: 'c', name: 'TESTER',     model_alias: 'haiku'  },
  { id: 'd', name: 'PLANNER',    model_alias: 'opus'   },
  { id: 'e', name: 'SCRIBE',     model_alias: 'sonnet' },
];

function makeFetch(responses) {
  return async (url) => {
    if (url === '/api/agents') {
      return { ok: true, status: 200, json: async () => ({ agents: AGENT_FIXTURES }) };
    }
    if (responses && responses[url]) return responses[url];
    return {
      ok: true, status: 200,
      body: {
        getReader: () => ({
          _consumed: false,
          async read() {
            if (this._consumed) return { done: true, value: undefined };
            this._consumed = true;
            const enc = new TextEncoder();
            return { done: false, value: enc.encode('data: {"delta":"hello"}\n\ndata: [DONE]\n\n') };
          },
        }),
      },
    };
  };
}

function makeSandbox(fetchImpl) {
  const sandbox = {
    document: {
      createElement: (t) => makeElement(t),
      body: makeElement('body'),
    },
    window: {},
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } },
    TextDecoder, TextEncoder,
    fetch: fetchImpl || makeFetch(),
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

async function _settle(times = 30) {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
}

// ── Tests ──────────────────────────────────────────────────────────────

test('agent picker limits selection to MAX_AGENTS (4)', () => {
  const sb = makeSandbox();
  const { _toggleSelection, MAX_AGENTS } = sb.__t;
  assert.equal(MAX_AGENTS, 4);
  let s = new Set();
  for (const id of ['a', 'b', 'c', 'd', 'e']) s = _toggleSelection(s, id);
  assert.equal(s.size, 4, 'fifth selection ignored at cap');
  assert.equal(s.has('e'), false, 'over-cap id not added');

  // Toggling an already-selected id removes it regardless of cap
  s = _toggleSelection(s, 'a');
  assert.equal(s.size, 3);
  assert.equal(s.has('a'), false);
});

test('_canRun: needs at least MIN_AGENTS (2) selected', () => {
  const sb = makeSandbox();
  const { _canRun, MIN_AGENTS } = sb.__t;
  assert.equal(MIN_AGENTS, 2);
  assert.equal(_canRun(new Set()),       false);
  assert.equal(_canRun(new Set(['a'])),  false);
  assert.equal(_canRun(new Set(['a','b'])), true);
});

// _renderPicker resets gridEl.innerHTML on every selection change, so
// the freshly mounted chips are different element objects each time.
// This helper re-queries after every click so the test isn't holding
// stale references.
function _clickChip(container, idx) {
  const fresh = container.querySelector('#cc-compare-agent-grid')
    .querySelectorAll('.cc-compare-agent-chip');
  fresh[idx].click();
}

test('result column is created for each selected agent', async () => {
  const sb = makeSandbox();
  const container = makeElement('div');
  container.innerHTML = sb.buildCompareTab();
  await sb.loadCompareTab(container);
  await _settle();

  const grid = container.querySelector('#cc-compare-agent-grid');
  assert.ok(grid, 'picker grid mounted');
  const initialChips = grid.querySelectorAll('.cc-compare-agent-chip');
  assert.ok(initialChips.length >= 3, 'agents rendered as chips');

  _clickChip(container, 0);
  _clickChip(container, 1);
  const runBtn = container.querySelector('#cc-compare-run-btn');
  assert.equal(runBtn.disabled, false, 'run enabled after 2 selected');

  // Fire RUN — wire prompt content via the textarea before clicking
  const promptEl = container.querySelector('#cc-compare-prompt');
  promptEl.value = 'compare these';
  runBtn.click();
  await _settle();

  const results = container.querySelector('#cc-compare-results');
  const cols    = results.querySelectorAll('.cc-compare-col');
  assert.equal(cols.length, 2, 'one column per selected agent');
});

test('an error in one column does not stop the others', async () => {
  // Custom fetch: first selected agent's send call rejects, second succeeds.
  let attempt = 0;
  const fetchImpl = async (url) => {
    if (url === '/api/agents') {
      return { ok: true, status: 200, json: async () => ({ agents: AGENT_FIXTURES.slice(0, 2) }) };
    }
    if (url.startsWith('/api/agents/') && url.endsWith('/thread/send')) {
      attempt++;
      if (attempt === 1) return { ok: false, status: 500, body: null };
      return makeFetch()(url);
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const sb = makeSandbox(fetchImpl);
  const container = makeElement('div');
  container.innerHTML = sb.buildCompareTab();
  await sb.loadCompareTab(container);
  await _settle();

  _clickChip(container, 0);
  _clickChip(container, 1);
  const promptEl = container.querySelector('#cc-compare-prompt');
  promptEl.value = 'compare these';
  container.querySelector('#cc-compare-run-btn').click();
  await _settle();

  const cols = container.querySelector('#cc-compare-results').querySelectorAll('.cc-compare-col');
  assert.equal(cols.length, 2);
  const statuses = [...cols].map(c => c.querySelector('.cc-compare-status').textContent);
  // Order matches selection order (a, b). With agents.slice(0,2), the
  // failing column is whichever called fetch first. Both states should
  // be terminal — DONE or ERROR — not still STREAMING.
  for (const s of statuses) {
    assert.match(s, /DONE|ERROR/);
  }
  assert.ok(statuses.some(s => /DONE/.test(s)),  'at least one DONE');
  assert.ok(statuses.some(s => /ERROR/.test(s)), 'failure surfaced as ERROR');
});

test('NEW COMPARISON button resets view to setup', async () => {
  const sb = makeSandbox();
  const container = makeElement('div');
  container.innerHTML = sb.buildCompareTab();
  await sb.loadCompareTab(container);
  await _settle();

  _clickChip(container, 0);
  _clickChip(container, 1);
  container.querySelector('#cc-compare-prompt').value = 'go';
  container.querySelector('#cc-compare-run-btn').click();
  await _settle();

  // After RUN, results panel + reset row should be visible
  const resultsEl = container.querySelector('#cc-compare-results');
  const resetRow  = container.querySelector('#cc-compare-reset-row');
  assert.notEqual(resultsEl.style.display, 'none', 'results visible after RUN');
  assert.notEqual(resetRow.style.display,  'none', 'reset row visible after RUN');

  resetRow.querySelector('.cc-compare-reset-btn').click();
  const setupEl = container.querySelector('#cc-compare-setup');
  assert.equal(resultsEl.style.display, 'none', 'results hidden after reset');
  assert.equal(resetRow.style.display,  'none', 'reset row hidden');
  assert.notEqual(setupEl.style.display, 'none', 'setup back on screen');
  assert.equal(resultsEl.innerHTML, '', 'columns cleared');
});
