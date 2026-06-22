// test_labels_glow_gateway — four invariants across three bug fixes:
//
//   1. Bug 1: T2-owned CC label strings contain no literal "// " prefix
//      (CSS ::before in tool-tabs-hud.css owns the prefix).
//   2. Bug 2: startOrbitGlow adds element to shared set; rAF loop drives angle.
//   3. Bug 2: prefers-reduced-motion skips loop entirely.
//   4. Bug 3: buildGatewayTab() renders each platform status row exactly once.
//
// Pattern: vm sandbox + hand-rolled DOM shim (no jsdom).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────

function loadSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/^export\s+async\s+function\s+/gm, 'async function ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ');
}

function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _attrs: {},
    _props: {},
    style: { _vars: {}, setProperty(k, v) { this._vars[k] = v; } },
    dataset: {},
    _innerHTML: '',
    _text: '',
    _listeners: {},
    hidden: false,
    disabled: false,
    get id()        { return this._attrs.id || ''; },
    set id(v)       { this._attrs.id = String(v); },
    get className() { return [...this._classes].join(' '); },
    set className(v) {
      this._classes.clear();
      String(v ?? '').split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    },
    classList: null,
    setAttribute(k, v)  { this._attrs[k] = String(v); },
    getAttribute(k)     { return this._attrs[k]; },
    get innerHTML()     { return this._innerHTML; },
    set innerHTML(v)    {
      this._innerHTML = String(v ?? '');
      this._children = [];
      const VOID = new Set(['br','hr','img','input','meta','link']);
      const tokenRe = /<\s*(\/)?\s*(\w+)\b([^>]*?)(\/?)\s*>/g;
      const stack = [el];
      let m;
      while ((m = tokenRe.exec(this._innerHTML))) {
        const isClose  = m[1] === '/';
        const tag      = m[2].toLowerCase();
        const attrs    = m[3];
        const selfClose = m[4] === '/' || VOID.has(tag);
        const parent   = stack[stack.length - 1];
        if (isClose) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
          }
          continue;
        }
        const child = makeElement(tag);
        const idM    = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM   = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const dataPlatM = /\bdata-platform\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)        child._attrs.id = idM[1];
        if (clsM)       clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (dataPlatM)  child.dataset.platform = dataPlatM[1];
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(child)     { this._children.push(child); child.parentElement = this; return child; },
    addEventListener(n, cb) { (this._listeners[n] = this._listeners[n] || []).push(cb); },
    removeEventListener()  {},
    querySelector(sel)    { const m = _matcher(sel); for (const c of _walk(this)) if (m(c)) return c; return null; },
    querySelectorAll(sel) { const m = _matcher(sel); const o = []; for (const c of _walk(this)) if (m(c)) o.push(c); return o; },
  };
  el.classList = {
    add(c)    { el._classes.add(c); },
    remove(c) { el._classes.delete(c); },
    contains(c) { return el._classes.has(c); },
    toggle(c, f) {
      if (f === true)  { el._classes.add(c); return true; }
      if (f === false) { el._classes.delete(c); return false; }
      if (el._classes.has(c)) { el._classes.delete(c); return false; }
      el._classes.add(c); return true;
    },
  };
  return el;
}

function* _walk(node) {
  for (const c of node._children) { yield c; yield* _walk(c); }
}

function _matcher(sel) {
  if (!sel) return () => false;
  const attrM   = /^([^\[]+)(\[[^\]]+\])?$/.exec(sel.trim());
  if (!attrM) return () => false;
  const base    = attrM[1].trim();
  const attrStr = attrM[2];
  const baseOk = (node) => {
    if (base.startsWith('#')) return node._attrs.id === base.slice(1);
    if (base.startsWith('.')) return node._classes.has(base.slice(1));
    return node.tagName === base.toUpperCase();
  };
  if (!attrStr) return baseOk;
  const aM = /^\[(\w[\w-]*)="?([^"\]]*)"?\]$/.exec(attrStr);
  if (!aM) return baseOk;
  const [, aKey, aVal] = aM;
  return (node) => {
    if (!baseOk(node)) return false;
    if (aKey.startsWith('data-')) {
      const k = aKey.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return node.dataset && node.dataset[k] === aVal;
    }
    return node._attrs[aKey] === aVal;
  };
}

// ── Test 1: Bug 1 — no literal "// " inside any T2-owned section label ──

test('T2-owned CC files contain no literal "// " inside .cc-section-label text', () => {
  const ownedFiles = [
    'static/js/cyberapps/command-center/gateway.js',
    'static/js/cyberapps/command-center/rooms.js',
    'static/js/cyberapps/command-center/cc-compare.js',
    'static/js/cyberapps/command-center/cc-memory-timeline.js',
  ];
  // Match content immediately after the opening tag (no other tags before ">")
  const labelRe = /class="cc-section-label[^"]*"[^>]*>([^<]+)/g;
  for (const f of ownedFiles) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    let m;
    labelRe.lastIndex = 0;
    while ((m = labelRe.exec(src))) {
      const text = m[1].trim();
      assert.equal(
        text.startsWith('// '), false,
        `${f}: label text "${text}" still has literal "// " prefix — CSS owns it`,
      );
    }
  }
});

// ── Test 2: Bug 2 — startOrbitGlow adds element and rAF is called ──

test('startOrbitGlow registers element in shared set and starts rAF', () => {
  let rafCalled = 0;
  const orbitSrc = loadSrc('static/js/orbit-glow.js')
    + '\nthis.__t = __testables;'
    + '\nthis.startOrbitGlow = startOrbitGlow;'
    + '\nthis.stopOrbitGlow  = stopOrbitGlow;';

  const el = makeElement('div');
  const sb = {
    document: { hidden: false },
    window: {
      matchMedia: () => ({ matches: false }),
    },
    requestAnimationFrame: (cb) => { rafCalled++; return rafCalled; },
    cancelAnimationFrame: () => {},
    Set, Map, Math, String, Number, Object, Array, console,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(orbitSrc, sb);

  sb.startOrbitGlow(el);
  assert.ok(sb.__t._glowing.has(el), 'element added to _glowing set');
  assert.ok(rafCalled >= 1, 'requestAnimationFrame called to start loop');
});

// ── Test 3: Bug 2 — prefers-reduced-motion skips the loop ──

test('startOrbitGlow does nothing when prefers-reduced-motion is active', () => {
  let rafCalled = 0;
  const orbitSrc = loadSrc('static/js/orbit-glow.js')
    + '\nthis.__t = __testables;'
    + '\nthis.startOrbitGlow = startOrbitGlow;';

  const el = makeElement('div');
  const sb = {
    document: { hidden: false },
    window: {
      matchMedia: () => ({ matches: true }),  // reduced-motion ON
    },
    requestAnimationFrame: (cb) => { rafCalled++; return rafCalled; },
    cancelAnimationFrame: () => {},
    Set, Map, Math, String, Number, Object, Array, console,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(orbitSrc, sb);

  sb.startOrbitGlow(el);
  assert.equal(sb.__t._glowing.size, 0, 'element NOT added when reduced-motion active');
  assert.equal(rafCalled, 0, 'rAF NOT started when reduced-motion active');
});

// ── Test 4: Bug 3 — gateway platform rows appear exactly once ──

test('buildGatewayTab renders each platform (discord/telegram/slack) exactly once', () => {
  const gatewaySrc = loadSrc('static/js/cyberapps/command-center/gateway.js')
    + '\nthis.buildGatewayTab = buildGatewayTab;';

  const sb = {
    document: { createElement: (t) => makeElement(t) },
    window: {},
    console,
    Math, String, Number, Array, Object, Set, Map, JSON,
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(gatewaySrc, sb);

  const container = makeElement('div');
  container.innerHTML = sb.buildGatewayTab();

  for (const platform of ['discord', 'telegram', 'slack']) {
    const rows = container.querySelectorAll(`.cc-gw-status-row[data-platform="${platform}"]`);
    assert.equal(rows.length, 1, `platform "${platform}" should appear exactly once, found ${rows.length}`);
  }
});
