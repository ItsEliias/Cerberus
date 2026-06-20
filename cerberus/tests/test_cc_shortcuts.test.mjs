// Verifies the Command Center keyboard-shortcuts module:
//   1. Shortcuts do NOT fire when focus is inside an input/textarea.
//   2. Escape closes the quick-search overlay.
//   3. `?` toggles the help overlay.
//
// Loads shortcuts.js inside a vm sandbox with a small DOM shim so the test
// stays isolated from the browser runtime (matches the project's
// vm-based JS test pattern used by tests/streaming/* and the dashboard /
// agents tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH  = join(__dirname, '..', 'static/js/cyberapps/command-center/shortcuts.js');
let SRC = readFileSync(SRC_PATH, 'utf8');
// Strip ES-module syntax so we can load the source as a plain script in a
// vm context.
SRC = SRC.replace(/^export\s+const\s+/gm, 'const ');
SRC = SRC.replace(/^export\s+function\s+/gm, 'function ');
SRC += '\nthis.__t = __testables;';

// ── Minimal DOM ─────────────────────────────────────────────────────────

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
    _idIndex: new Map(),       // synthetic children created from innerHTML
    _classIndex: new Map(),
    classList: {
      add(c) { el._classes.add(c); },
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
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    removeAttribute(k) { delete this._attrs[k]; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v ?? '');
      this._children = [];
      this._idIndex.clear();
      this._classIndex.clear();
      // Synthesize stub child elements by scanning the markup for id="..."
      // and class="..." attributes. We only need lookup by id / class for
      // the selectors that shortcuts.js actually uses.
      const tagRe = /<(\w+)\b([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(this._innerHTML))) {
        const childTag = m[1];
        const attrs = m[2];
        const idM   = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM  = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const child = makeElement(childTag);
        if (idM)  { child._attrs.id = idM[1]; this._idIndex.set(idM[1], child); }
        if (clsM) {
          clsM[1].split(/\s+/).filter(Boolean).forEach(c => {
            child._classes.add(c);
            if (!this._classIndex.has(c)) this._classIndex.set(c, []);
            this._classIndex.get(c).push(child);
          });
        }
        this._children.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(child) {
      this._children.push(child);
      child.parentElement = this;
      _DOC._index.set(child._attrs.id, child);
      return child;
    },
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) this._children.splice(i, 1);
      if (child._attrs.id) _DOC._index.delete(child._attrs.id);
      child.parentElement = null;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener(name, cb) { (this._listeners[name] = this._listeners[name] || []).push(cb); },
    removeEventListener() {},
    querySelector(sel) {
      if (!sel) return null;
      if (sel.startsWith('#')) return this._idIndex.get(sel.slice(1)) || null;
      if (sel.startsWith('.')) {
        const list = this._classIndex.get(sel.slice(1));
        return list && list[0] || null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() { _DOC.activeElement = this; },
    blur() { _DOC.activeElement = _DOC.body; },
    select() {},
    click() { (this._listeners.click || []).forEach(cb => cb({ target: this })); },
  };
  return el;
}

const _DOC = {
  _index: new Map(),
  _docListeners: {},
  body: null,
  activeElement: null,
  createElement: (tag) => makeElement(tag),
  getElementById: (id) => _DOC._index.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(name, cb) {
    (_DOC._docListeners[name] = _DOC._docListeners[name] || []).push(cb);
  },
  removeEventListener(name, cb) {
    const list = _DOC._docListeners[name];
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  },
  _fireKey(opts) {
    const event = {
      key: opts.key,
      altKey: !!opts.altKey,
      ctrlKey: !!opts.ctrlKey,
      metaKey: !!opts.metaKey,
      shiftKey: !!opts.shiftKey,
      target: opts.target || _DOC.body,
      _prevented: false,
      preventDefault() { this._prevented = true; },
      stopPropagation() {},
    };
    (_DOC._docListeners.keydown || []).forEach(cb => cb(event));
    return event;
  },
};
_DOC.body = makeElement('body');
_DOC.activeElement = _DOC.body;
// Body is also indexed so appendChild's inserted nodes register correctly
const _bodyAppend = _DOC.body.appendChild.bind(_DOC.body);
_DOC.body.appendChild = (child) => {
  const r = _bodyAppend(child);
  if (child._attrs?.id) _DOC._index.set(child._attrs.id, child);
  return r;
};

function makeSandbox() {
  // Fresh document state per sandbox to keep tests independent
  _DOC._index.clear();
  _DOC._docListeners = {};
  _DOC.body = makeElement('body');
  _DOC.activeElement = _DOC.body;
  const _bodyAppend2 = _DOC.body.appendChild.bind(_DOC.body);
  _DOC.body.appendChild = (child) => {
    const r = _bodyAppend2(child);
    if (child._attrs?.id) _DOC._index.set(child._attrs.id, child);
    return r;
  };

  const sandbox = {
    document: _DOC,
    window: {},
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    setTimeout: (fn) => { try { fn(); } catch (_) {} return 0; },
    clearTimeout: () => {},
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ──────────────────────────────────────────────────────────────

test('? toggles the help overlay (open then close)', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true; // pretend initShortcuts ran

  // Fire `?` once → help opens
  const ev1 = _DOC._fireKey({ key: '?' });
  // _onKeyDown isn't wired through document listeners (initShortcuts wasn't
  // called), so call the handler directly via the testable shim.
  sb.__t.onKeyDown(ev1);
  assert.equal(sb.__t.STATE.helpOpen, true,  '? should open the help overlay');
  assert.ok(_DOC.getElementById('cc-shortcuts-help'), 'help overlay node mounted');

  // Fire `?` again → help closes
  const ev2 = _DOC._fireKey({ key: '?' });
  sb.__t.onKeyDown(ev2);
  assert.equal(sb.__t.STATE.helpOpen, false, '? should close the help overlay');
  assert.equal(_DOC.getElementById('cc-shortcuts-help'), null, 'help overlay node removed');
});

test('Escape closes the quick-search overlay', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  // Open via the testable so we don't have to plumb Cmd+K through the shim
  sb.__t.openSearch();
  assert.equal(sb.__t.STATE.searchOpen, true,  'search overlay open');
  assert.ok(_DOC.getElementById('cc-quick-search'), 'search overlay node mounted');

  // Pressing Escape closes it
  const ev = _DOC._fireKey({ key: 'Escape' });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.searchOpen, false, 'Escape should close the search overlay');
  assert.equal(_DOC.getElementById('cc-quick-search'), null, 'search overlay node removed');
  assert.equal(ev._prevented, true, 'Escape should preventDefault when it closes something');
});

test('shortcuts are suppressed when an INPUT has focus', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  // Sanity: `?` works when target is the body
  let ev = _DOC._fireKey({ key: '?', target: _DOC.body });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, true, 'sanity: ? opens help from body');
  sb.__t.closeHelp();

  // Now fire `?` with an INPUT as the event target — should be ignored
  const input = makeElement('input');
  ev = _DOC._fireKey({ key: '?', target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, false, 'INPUT target must suppress ?');

  // Same check for `n` and `/`
  ev = _DOC._fireKey({ key: 'n', target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(ev._prevented, false, 'n must not preventDefault while typing');

  ev = _DOC._fireKey({ key: '/', target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(ev._prevented, false, '/ must not preventDefault while typing');

  // TEXTAREA also suppresses
  const ta = makeElement('textarea');
  ev = _DOC._fireKey({ key: '?', target: ta });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, false, 'TEXTAREA target must suppress ?');

  // contentEditable also suppresses
  const ce = makeElement('div');
  ce.isContentEditable = true;
  ev = _DOC._fireKey({ key: '?', target: ce });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, false, 'contentEditable target must suppress ?');
});

test('Cmd+K opens search even while typing in an input', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  const input = makeElement('input');
  const ev = _DOC._fireKey({ key: 'k', metaKey: true, target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.searchOpen, true, 'Cmd+K should bypass typing-target suppression');
  assert.equal(ev._prevented, true, 'Cmd+K should preventDefault');
});
