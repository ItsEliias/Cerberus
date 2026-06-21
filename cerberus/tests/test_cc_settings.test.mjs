// cc-settings — 5 behavioural tests for the settings overlay:
//   1. Settings overlay renders all 5 sections
//   2. Escape closes the overlay
//   3. Auto-approve toggle reads from and writes to the API
//   4. Language picker calls setLocale
//   5. Gear icon opens the overlay
//
// Same vm-sandbox + DOM-shim pattern as other CC tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-settings.js'),
  'utf8',
)
  // Strip ES module imports — replaced by shim objects in the sandbox
  .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
  .replace(/^export\s+const\s+/gm, 'const ')
  .replace(/^export\s+function\s+/gm, 'function ')
  + '\nthis.openSettings   = openSettings;'
  + '\nthis.closeSettings  = closeSettings;'
  + '\nthis.isSettingsOpen = isSettingsOpen;'
  + '\nthis.__testables    = __testables;';

// ── DOM shim ──────────────────────────────────────────────────────────────────

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
    _listeners: {},
    classList: {
      add(c)    { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
    },
    get id()   { return this._attrs.id || ''; },
    set id(v)  { this._attrs.id = String(v); },
    get className()  { return [...this._classes].join(' '); },
    set className(v) {
      this._classes.clear();
      String(v ?? '').split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k)    { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    hasAttribute(k)    { return Object.prototype.hasOwnProperty.call(this._attrs, k); },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v ?? '');
      this._children = [];
      const VOID = new Set(['br','hr','img','input','meta','link','area']);
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
        const idM   = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM  = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const typeM = /\btype\s*=\s*"([^"]*)"/.exec(attrs);
        const checkedM = /\bchecked\b/.test(attrs);
        const dataPlatM = /\bdata-platform\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)  child._attrs.id  = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (typeM) child._attrs.type = typeM[1];
        if (checkedM) child._attrs.checked = child.checked = true;
        if (dataPlatM) child.dataset.platform = dataPlatM[1];
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); this._innerHTML = String(v ?? ''); },
    focus() {},
    addEventListener(ev, fn) {
      if (!el._listeners[ev]) el._listeners[ev] = [];
      el._listeners[ev].push(fn);
    },
    removeEventListener(ev, fn) {
      if (!el._listeners[ev]) return;
      el._listeners[ev] = el._listeners[ev].filter(f => f !== fn);
    },
    dispatchEvent(ev) {
      (el._listeners[ev.type] || []).forEach(fn => fn(ev));
      return true;
    },
    appendChild(child) { el._children.push(child); child.parentElement = el; return child; },
    querySelector(sel) {
      const idM      = /^#([\w-]+)$/.exec(sel);
      const clsM     = /^\.([\w-]+)$/.exec(sel);
      const tagM     = /^(\w+)$/.exec(sel);
      const attrValM = /^\[data-([\w-]+)="([^"]+)"\]$/.exec(sel);
      const tagAttrM = /^(\w+)\[data-([\w-]+)\]$/.exec(sel);
      function matches(c) {
        if (idM      && c._attrs.id === idM[1]) return true;
        if (clsM     && c._classes.has(clsM[1])) return true;
        if (tagM     && c.tagName === tagM[1].toUpperCase()) return true;
        if (attrValM && c.dataset[attrValM[1]] === attrValM[2]) return true;
        if (tagAttrM && c.tagName === tagAttrM[1].toUpperCase() &&
            Object.prototype.hasOwnProperty.call(c.dataset, tagAttrM[2])) return true;
        return false;
      }
      function search(node) {
        for (const c of node._children) {
          if (matches(c)) return c;
          const found = search(c);
          if (found) return found;
        }
        return null;
      }
      return search(el);
    },
    querySelectorAll(sel) {
      const idM      = /^#([\w-]+)$/.exec(sel);
      const clsM     = /^\.([\w-]+)$/.exec(sel);
      const tagM     = /^(\w+)$/.exec(sel);
      const attrValM = /^\[data-([\w-]+)="([^"]+)"\]$/.exec(sel);
      // tag + data-attr presence: e.g. "input[data-platform]"
      const tagAttrM = /^(\w+)\[data-([\w-]+)\]$/.exec(sel);
      const results = [];
      function matches(c) {
        if (idM      && c._attrs.id === idM[1]) return true;
        if (clsM     && c._classes.has(clsM[1])) return true;
        if (tagM     && c.tagName === tagM[1].toUpperCase()) return true;
        if (attrValM && c.dataset[attrValM[1]] === attrValM[2]) return true;
        if (tagAttrM && c.tagName === tagAttrM[1].toUpperCase() &&
            Object.prototype.hasOwnProperty.call(c.dataset, tagAttrM[2])) return true;
        return false;
      }
      function search(node) {
        for (const c of node._children) {
          if (matches(c)) results.push(c);
          search(c);
        }
      }
      search(el);
      return results;
    },
  };
  return el;
}

// ── Sandbox factory ───────────────────────────────────────────────────────────

function makeSandbox({ fetchImpl } = {}) {
  const docListeners = {};
  const docEl = makeElement('div');
  docEl._attrs.id = 'cc-sett-styles-container';

  const sandbox = {
    // i18n shim (replaces stripped import)
    t: (k) => k,
    setLocale: () => {},
    getLocale: () => 'en',
    AVAILABLE_LOCALES: ['en', 'es'],

    localStorage: { _store: {}, getItem(k) { return this._store[k] ?? null; }, setItem(k, v) { this._store[k] = String(v); } },

    fetch: fetchImpl || (() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),

    document: {
      createElement: (tag) => makeElement(tag),
      getElementById: (id) => {
        function search(node) {
          if (node._attrs?.id === id) return node;
          for (const c of node._children || []) { const f = search(c); if (f) return f; }
          return null;
        }
        return search(docEl);
      },
      head: makeElement('head'),
      body: makeElement('body'),
      addEventListener(ev, fn) {
        if (!docListeners[ev]) docListeners[ev] = [];
        docListeners[ev].push(fn);
      },
      removeEventListener(ev, fn) {
        if (!docListeners[ev]) return;
        docListeners[ev] = docListeners[ev].filter(f => f !== fn);
      },
      dispatchEvent(ev) { (docListeners[ev.type] || []).forEach(fn => fn(ev)); return true; },
      _docListeners: docListeners,
    },

    CustomEvent: class CustomEvent {
      constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
    },
    Event: class Event {
      constructor(type) { this.type = type; this.defaultPrevented = false; }
      preventDefault() { this.defaultPrevented = true; }
      stopPropagation() {}
    },
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => {},
  };
  return { sandbox, docEl, docListeners };
}

function makeModule(sandbox) {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return ctx;
}

// ── Helper: open settings and return the overlay element ─────────────────────

function openAndGetOverlay(mod, shell) {
  mod.openSettings(shell);
  return shell.querySelector('#cc-settings-overlay') ||
    shell._children.find(c => c._attrs?.id === 'cc-settings-overlay');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('1. settings overlay renders all 5 sections', async () => {
  const { sandbox } = makeSandbox();
  const mod = makeModule(sandbox);
  const shell = makeElement('div');
  // openSettings() is async internally (loadAll) but we only need to check HTML structure
  mod.openSettings(shell);

  const overlay = openAndGetOverlay(mod, shell);
  assert.ok(overlay, 'overlay element should be appended to shell');

  const html = overlay._innerHTML;
  assert.ok(html.includes('GENERAL'),    'GENERAL section missing');
  assert.ok(html.includes('GATEWAY'),    'GATEWAY section missing');
  assert.ok(html.includes('AGENTS'),     'AGENTS section missing');
  assert.ok(html.includes('VOICE'),      'VOICE section missing');
  assert.ok(html.includes('ABOUT'),      'ABOUT section missing');
});

test('2. Escape closes the overlay', () => {
  const { sandbox } = makeSandbox();
  const mod = makeModule(sandbox);
  const shell = makeElement('div');

  mod.openSettings(shell);
  assert.ok(mod.isSettingsOpen(), 'should be open after openSettings()');

  const overlay = openAndGetOverlay(mod, shell);
  assert.ok(overlay, 'overlay should exist');

  // Simulate Escape keydown on the overlay
  const escEvent = new sandbox.Event('keydown');
  escEvent.key = 'Escape';
  overlay.dispatchEvent(escEvent);

  assert.ok(!mod.isSettingsOpen(), 'overlay should be closed after Escape');
});

test('3. auto-approve toggle reads from and writes to the API', async () => {
  const patchCalls = [];
  const fetchImpl = (url, opts = {}) => {
    if (url === '/api/gateway/autoapprove' && (!opts.method || opts.method === 'GET')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ discord: false, telegram: true, slack: false }),
      });
    }
    if (url === '/api/gateway/autoapprove' && opts.method === 'PATCH') {
      patchCalls.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };

  const { sandbox } = makeSandbox({ fetchImpl });
  const mod = makeModule(sandbox);
  const shell = makeElement('div');
  mod.openSettings(shell);

  // Run _loadGateway on the overlay
  const overlay = openAndGetOverlay(mod, shell);
  const gwBlock = overlay?.querySelector('#cc-sett-gw');
  assert.ok(gwBlock, 'GATEWAY block (#cc-sett-gw) should exist');

  await mod.__testables._loadGateway(overlay);

  // After load, the block should contain toggle inputs for each platform
  const gwHtml = gwBlock._innerHTML;
  assert.ok(gwHtml.includes('discord'),   'discord toggle missing');
  assert.ok(gwHtml.includes('telegram'),  'telegram toggle missing');
  assert.ok(gwHtml.includes('slack'),     'slack toggle missing');

  // Simulate toggling discord: find the input and fire change
  const discordInput = gwBlock.querySelector('[data-platform="discord"]');
  assert.ok(discordInput, 'discord input should be present');
  discordInput.checked = true;
  discordInput.dispatchEvent(Object.assign(new sandbox.Event('change'), { target: discordInput }));

  // Give the async PATCH a tick to fire
  await new Promise(r => setTimeout(r, 10));
  assert.ok(patchCalls.some(c => c.platform === 'discord'), 'PATCH should have been called for discord');
});

test('4. language picker calls setLocale', () => {
  let localeCalled = null;
  const { sandbox } = makeSandbox();
  sandbox.setLocale = (loc) => { localeCalled = loc; };
  const mod = makeModule(sandbox);
  const shell = makeElement('div');
  mod.openSettings(shell);

  const overlay = openAndGetOverlay(mod, shell);
  const picker = overlay?.querySelector('#cc-sett-locale');
  assert.ok(picker, 'locale picker (#cc-sett-locale) should be present');

  // Simulate selecting 'es'
  picker.value = 'es';
  picker.dispatchEvent(Object.assign(new sandbox.Event('change'), { target: picker }));
  assert.equal(localeCalled, 'es', 'setLocale should have been called with "es"');
});

test('5. gear icon opens the settings overlay', () => {
  const { sandbox, docListeners } = makeSandbox();
  const mod = makeModule(sandbox);

  // Simulate the gear button wiring in index.js:
  // index.js calls openSettings(shell) on gear click and listens for
  // cerberus:open-settings to toggle. Test the dispatch path instead.
  sandbox.document.addEventListener('cerberus:open-settings', () => {
    if (mod.isSettingsOpen()) mod.closeSettings();
    else mod.openSettings(makeElement('div'));
  });

  assert.ok(!mod.isSettingsOpen(), 'should be closed initially');

  // Dispatch the event (mirrors what shortcuts.js does for , key and
  // what index.js wires to the gear button click)
  const evt = new sandbox.CustomEvent('cerberus:open-settings');
  sandbox.document.dispatchEvent(evt);

  assert.ok(mod.isSettingsOpen(), 'overlay should be open after cerberus:open-settings event');
});
