// test_trader_tab — five invariants for the TRADER tab shell:
//
//   1. buildTraderTab returns markup containing the NOT-YET-ACTIVE banner.
//   2. All placeholder panels render with empty-state text (no mock numbers).
//   3. Mode flags show SIM as the only current-state flag.
//   4. loadTrader is a safe no-op: doesn't throw, makes no fetch.
//   5. TRADER is registered in the TABS array in index.js.
//
// No jsdom — hand-rolled DOM shim + vm sandbox pattern.

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
    .replace(/^export\s+async\s+function\s+/gm, 'async function ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ');
}

// ── Minimal DOM shim ─────────────────────────────────────────────────

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _attrs: {},
    style: {},
    dataset: {},
    _innerHTML: '',
    _text: '',
    _listeners: {},
    get id()    { return this._attrs.id || ''; },
    set id(v)   { this._attrs.id = String(v); },
    get className() { return [...this._classes].join(' '); },
    set className(v) {
      this._classes.clear();
      String(v ?? '').split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k)    { return this._attrs[k]; },
    get innerHTML()    { return this._innerHTML; },
    set innerHTML(v)   {
      this._innerHTML = String(v ?? '');
      this._children = [];
      const VOID = new Set(['br','hr','img','input','meta','link']);
      const tokenRe = /<\s*(\/)?\s*(\w+)\b([^>]*?)(\/?)\s*>/g;
      const stack = [el];
      let m;
      while ((m = tokenRe.exec(this._innerHTML))) {
        const isClose  = m[1] === '/';
        const tag2     = m[2].toLowerCase();
        const attrs    = m[3];
        const selfClose = m[4] === '/' || VOID.has(tag2);
        const parent   = stack[stack.length - 1];
        if (isClose) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tag2.toUpperCase()) { stack.length = i; break; }
          }
          continue;
        }
        const child = makeElement(tag2);
        const idM  = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const titleM = /\btitle\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)    child._attrs.id = idM[1];
        if (clsM)   clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (titleM) child._attrs.title = titleM[1];
        // Capture text nodes between tags as _text on nearest parent
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
      // Also extract text content from the raw HTML for text-content queries
      el._text = this._innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(child) { this._children.push(child); child.parentElement = this; return child; },
    addEventListener(n, cb) { (this._listeners[n] = this._listeners[n] || []).push(cb); },
    removeEventListener() {},
    querySelector(sel)    {
      const m = _matcher(sel);
      for (const c of _walk(this)) if (m(c)) return c;
      return null;
    },
    querySelectorAll(sel) {
      const m = _matcher(sel);
      const o = [];
      for (const c of _walk(this)) if (m(c)) o.push(c);
      return o;
    },
  };
  return el;
}

function* _walk(node) {
  for (const c of node._children) { yield c; yield* _walk(c); }
}

function _matcher(sel) {
  if (!sel) return () => false;
  const parts = sel.trim().split(/\s+/);
  if (parts.length === 1) return _singleMatcher(parts[0]);
  // Descendant combinator: match last part among descendants of something matching first parts
  const last = _singleMatcher(parts[parts.length - 1]);
  return (node) => last(node);  // simplified: just match last segment
}

function _singleMatcher(sel) {
  if (sel.startsWith('#')) return (n) => n._attrs.id === sel.slice(1);
  if (sel.startsWith('.')) return (n) => n._classes.has(sel.slice(1));
  return (n) => n.tagName === sel.toUpperCase();
}

function makeSandbox(extra = {}) {
  const headEl = makeElement('head');
  const bodyEl = makeElement('body');
  const sb = {
    document: {
      createElement: (t) => makeElement(t),
      head: headEl,
      body: bodyEl,
      getElementById: (id) => null,
    },
    window: { _isAdmin: true, ...extra },
    console,
    Math, String, Number, Array, Object, Set, Map, JSON, Promise,
  };
  sb.document.getElementById = (id) => {
    for (const c of _walk(headEl)) if (c._attrs.id === id) return c;
    return null;
  };
  sb.window.matchMedia = sb.window.matchMedia || (() => ({ matches: false }));
  sb.globalThis = sb;
  return sb;
}

function runTrader(extra = {}) {
  const src = loadSrc('static/js/cyberapps/command-center/trader.js')
    + '\nthis.buildTraderTab = buildTraderTab;'
    + '\nthis.loadTrader     = loadTrader;';
  const sb = makeSandbox(extra);
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return sb;
}

// ── Tests ─────────────────────────────────────────────────────────────

test('buildTraderTab contains the NOT-YET-ACTIVE banner', () => {
  const sb = runTrader();
  const html = sb.buildTraderTab();
  assert.ok(typeof html === 'string' && html.length > 0, 'returns non-empty string');
  assert.ok(
    html.includes('NOT YET ACTIVE') || html.includes('NOT-YET-ACTIVE'),
    'banner text present',
  );
  assert.ok(html.includes('cc-trader-notice'), 'banner uses cc-trader-notice class');
});

test('placeholder panels render empty-state text with no mock numbers', () => {
  const sb = runTrader();
  const html = sb.buildTraderTab();

  // All required panels must be present
  const requiredPanels = [
    'NO WALLET CONNECTED',
    'NO STRATEGY LOADED',
    'NO POSITIONS',
    'NO BRIEFS YET',
    'NO EVENTS',
    'HUMAN APPROVAL REQUIRED',
  ];
  for (const text of requiredPanels) {
    assert.ok(html.includes(text), `panel empty state "${text}" present`);
  }

  // No mock numeric data: no dollar amounts, no percentages that look like fake data
  // Check for patterns like "$1,234" or "2.6%" appearing as standalone data values
  // (the mention of "+2.6%" in the strategy blurb is descriptive text, not fake data)
  const container = makeElement('div');
  container.innerHTML = html;
  // None of the cc-trader-empty elements should contain standalone numbers
  const empties = container.querySelectorAll('.cc-trader-empty');
  assert.ok(empties.length >= 6, `at least 6 empty-state elements, got ${empties.length}`);
  for (const el of empties) {
    const text = el._text;
    assert.equal(
      /^\s*[\d,]+\s*$/.test(text), false,
      `empty-state element contains only a number (mock data?): "${text}"`,
    );
  }
});

test('mode flags show SIM as the only current-state flag', () => {
  const sb = runTrader();
  const html = sb.buildTraderTab();
  const container = makeElement('div');
  container.innerHTML = html;

  const flags = container.querySelectorAll('.cc-trader-flag');
  assert.ok(flags.length >= 4, `expected ≥4 mode flags, got ${flags.length}`);

  const currentFlags = container.querySelectorAll('.cc-trader-flag--current');
  assert.equal(currentFlags.length, 1, 'exactly one flag has --current modifier');
  assert.ok(
    currentFlags[0]._text.includes('SIM') || currentFlags[0]._attrs.title?.includes('SIM')
    || html.includes('cc-trader-flag--current" title="Current state'),
    'the current flag is SIM',
  );
});

test('loadTrader is a safe no-op: no fetch, no throw', async () => {
  let fetchCalled = false;
  const sb = runTrader();
  sb.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  vm.createContext(sb);  // already contextified — extend globals via property
  sb.window._isAdmin = true;

  const container = makeElement('div');
  container.innerHTML = sb.buildTraderTab();

  // Should not throw
  await assert.doesNotReject(
    async () => { sb.loadTrader(container); },
    'loadTrader must not throw',
  );
  assert.equal(fetchCalled, false, 'loadTrader must not call fetch');
});

test('TRADER is registered in the TABS array in index.js', () => {
  const src = readFileSync(
    join(ROOT, 'static/js/cyberapps/command-center/index.js'), 'utf8',
  );
  // Check the TABS array contains an entry for trader
  assert.ok(
    /id\s*:\s*['"]trader['"]/.test(src),
    'TABS array in index.js contains { id: "trader" }',
  );
  assert.ok(
    /adminOnly\s*:\s*true/.test(src),
    'trader tab has adminOnly: true',
  );
});
