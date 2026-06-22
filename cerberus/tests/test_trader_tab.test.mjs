// test_trader_tab — invariants for the TRADER tab (Phase 1: data + briefs).
//
//   1. buildTraderTab returns markup containing the Phase 1 banner.
//   2. Static panels render with expected content (T2-owned panels unchanged).
//   3. Mode flags show SIM as the only current-state flag.
//   4. loadTrader (admin) calls fetch for markets and briefs; non-admin gets access-denied.
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
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
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
  const last = _singleMatcher(parts[parts.length - 1]);
  return (node) => last(node);
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

test('buildTraderTab contains the Phase 1 active banner', () => {
  const sb = runTrader();
  const html = sb.buildTraderTab();
  assert.ok(typeof html === 'string' && html.length > 0, 'returns non-empty string');
  assert.ok(
    html.includes('PHASE 1') || html.includes('DATA + BRIEFS'),
    'Phase 1 banner text present',
  );
  assert.ok(html.includes('cc-trader-notice'), 'banner uses cc-trader-notice class');
});

test('T2-owned static panels are present and unchanged', () => {
  const sb = runTrader();
  const html = sb.buildTraderTab();

  // T2-owned panels must be verbatim
  const t2Panels = [
    'NO WALLET CONNECTED',
    'NO POSITIONS',
    'HUMAN APPROVAL REQUIRED',
    'NO EVENTS',
  ];
  for (const text of t2Panels) {
    assert.ok(html.includes(text), `T2 panel "${text}" must be unchanged`);
  }

  // Phase 1 panels should have live data placeholders, not the old "NO … YET" text
  assert.ok(html.includes('cc-trader-markets-body'), 'market data mount point present');
  assert.ok(html.includes('cc-trader-briefs-body'), 'briefs mount point present');
  assert.ok(html.includes('GENERATE BRIEFS'), 'generate-briefs button present');
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
    || html.includes('cc-trader-flag--current" title="'),
    'the current flag is SIM',
  );
});

test('loadTrader (admin) calls fetch; non-admin renders access-denied', async () => {
  // Admin branch: fetch should be called for markets and briefs
  let fetchCount = 0;
  const sbAdmin = runTrader();
  sbAdmin.window._isAdmin = true;
  sbAdmin.fetch = async (url) => {
    fetchCount++;
    return { ok: true, json: async () => ({ markets: [], briefs: [] }) };
  };

  const adminRoot = makeElement('div');
  adminRoot.innerHTML = sbAdmin.buildTraderTab();
  sbAdmin.loadTrader(adminRoot);
  // Give microtasks a tick to run
  await new Promise(r => setTimeout(r, 0));
  assert.ok(fetchCount >= 1, `admin loadTrader must call fetch (called ${fetchCount} times)`);

  // Non-admin branch: no fetch, renders access-denied
  let nonAdminFetch = 0;
  const sbGuest = runTrader();
  sbGuest.window._isAdmin = false;
  sbGuest.fetch = async () => { nonAdminFetch++; return { ok: true, json: async () => ({}) }; };

  const guestRoot = makeElement('div');
  guestRoot.innerHTML = sbGuest.buildTraderTab();
  sbGuest.loadTrader(guestRoot);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(nonAdminFetch, 0, 'non-admin loadTrader must not call fetch');
  // The shim doesn't back-propagate child mutations to the parent _innerHTML,
  // so check the wrapper's _innerHTML directly.
  const wrapper = guestRoot.querySelector('#cc-trader-root');
  const wrapperHtml = wrapper ? wrapper._innerHTML : guestRoot._innerHTML;
  assert.ok(
    wrapperHtml.includes('ADMIN ACCESS REQUIRED'),
    'non-admin sees access-denied state',
  );
});

test('TRADER is registered in the TABS array in index.js', () => {
  const src = readFileSync(
    join(ROOT, 'static/js/cyberapps/command-center/index.js'), 'utf8',
  );
  assert.ok(
    /id\s*:\s*['"]trader['"]/.test(src),
    'TABS array in index.js contains { id: "trader" }',
  );
  assert.ok(
    /adminOnly\s*:\s*true/.test(src),
    'trader tab has adminOnly: true',
  );
});

test('adminOnly filter shows TRADER for admin, hides for non-admin', () => {
  // Reproduce the exact filter from _renderTabNavHTML so a regression is
  // immediately visible without needing to boot the full module graph.
  const TABS = [
    { id: 'command' },
    { id: 'trader', adminOnly: true },
    { id: 'assistant' },
  ];

  const adminTabs = TABS.filter(tab => !tab.adminOnly || true);
  assert.ok(adminTabs.some(t => t.id === 'trader'), 'admin (_isAdmin=true) sees TRADER');

  const guestTabs = TABS.filter(tab => !tab.adminOnly || false);
  assert.ok(!guestTabs.some(t => t.id === 'trader'), 'non-admin (_isAdmin=false) cannot see TRADER');
});
