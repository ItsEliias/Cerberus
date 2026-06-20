// Verifies the dashboard renders + loads data without throwing when every
// backend endpoint returns empty/error. Loads dashboard.js in a vm sandbox
// with a minimal DOM/fetch shim so we can exercise the panel without a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = join(__dirname, '..', 'static/js/dashboard.js');
let src = readFileSync(SRC_PATH, 'utf8');

// Strip ES-module syntax so we can load the file in a plain vm context.
src = src.replace(/^export\s+/gm, '');
src += '\nthis.__open = open; this.__loadSecurity = _loadSecurity; this.__applySearch = _applySessionSearch; this.__wireSearch = _wireSessionSearch;';

function makeElement(tag = 'div') {
  const children = [];
  const classList = new Set();
  const dataset = {};
  const style = {};
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    children,
    parentElement: null,
    dataset,
    style,
    _classes: classList,
    _attrs: {},
    _text: '',
    _html: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = String(v ?? '');
      // We don't bother parsing; just clear children so queries return [].
      children.length = 0;
    },
    classList: {
      add: (c) => classList.add(c),
      remove: (c) => classList.delete(c),
      contains: (c) => classList.has(c),
      toggle: (c, force) => {
        if (force === true) { classList.add(c); return true; }
        if (force === false) { classList.delete(c); return false; }
        if (classList.has(c)) { classList.delete(c); return false; }
        classList.add(c); return true;
      },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(child) { children.push(child); child.parentElement = this; return child; },
    removeChild(child) {
      const i = children.indexOf(child); if (i >= 0) children.splice(i, 1);
      child.parentElement = null;
    },
    remove() {
      if (this.parentElement) this.parentElement.removeChild(this);
    },
    addEventListener(name, cb) { (listeners[name] = listeners[name] || []).push(cb); },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() {},
    // canvas + form bits the dashboard pokes
    getContext() {
      return {
        setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, closePath() {}, arc() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        save() {}, restore() {},
      };
    },
    getBoundingClientRect: () => ({ width: 900, height: 130, top: 0, left: 0 }),
    clientWidth: 900,
  };
  return el;
}

function makeDocument() {
  const byId = new Map();
  const body = makeElement('body');
  const root = makeElement('html');
  const doc = {
    body,
    documentElement: root,
    hidden: false,
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  // Allow body.appendChild() in dashboard.js's _buildPanel to register the panel.
  const realAppend = body.appendChild.bind(body);
  body.appendChild = (el) => {
    realAppend(el);
    // Recursively register IDs from elements that have them set via setAttribute.
    function walk(node) {
      const id = node._attrs?.id || node.id;
      if (id) byId.set(id, node);
    }
    walk(el);
    if (el.id) byId.set(el.id, el);
    return el;
  };
  return { doc, byId };
}

test('dashboard open() does not throw when every endpoint returns empty/error', async () => {
  const { doc } = makeDocument();
  const sandbox = {
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
    performance: { now: () => 0 },
    sessionStorage: { setItem: () => {}, getItem: () => null },
    getComputedStyle: () => ({ getPropertyValue: () => '#c0392b' }),
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    URL,
    JSON, Math, Date, String, Number, Array, Object, Set, Map,
    Promise,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  await vm.runInContext(`(async () => { ${src} })();`, sandbox);

  // Open should succeed without throwing
  await assert.doesNotReject(async () => {
    sandbox.__open();
    // Settle any in-flight Promise.all chain triggered inside _loadData
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  });
});

test('_loadSecurity renders gracefully when /api/health returns {}', async () => {
  const { doc, byId } = makeDocument();
  const host = makeElement('div');
  host.setAttribute('id', 'dash-security-items');
  byId.set('dash-security-items', host);
  const sandbox = {
    document: doc,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    JSON, Math, Date, String, Number, Array, Object, Set, Map, Promise, console, URL,
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame: () => 0,
    setInterval: () => 0,
    performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => '#c0392b' }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  await assert.doesNotReject(async () => {
    await sandbox.__loadSecurity();
  });
  // With empty payload, host should render the empty fallback, not crash
  assert.ok(/—|dash-empty/.test(host.innerHTML), 'security strip should render fallback');
});
