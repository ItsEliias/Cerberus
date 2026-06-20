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

function* _walkChildren(node) {
  for (const c of node._children || []) {
    yield c;
    yield* _walkChildren(c);
  }
}

// Tiny compiler for `#id`, `.cls`, `.cls.cls2`, and the trivial
// `.cls[attr="val"]` form. Returns a predicate node ⇒ boolean.
function _compileSelector(sel) {
  const parts = sel.trim().split(/\s+/);
  const last  = parts[parts.length - 1];
  // Pull off an optional [attr="val"] tail
  const attrM = /\[([\w-]+)="?([^"\]]*)"?\]$/.exec(last);
  const baseStr = attrM ? last.slice(0, -attrM[0].length) : last;
  const attrName = attrM ? attrM[1] : null;
  const attrVal  = attrM ? attrM[2] : null;
  const ids     = [];
  const classes = [];
  baseStr.split(/(?=[#.])/).forEach(tok => {
    if (tok.startsWith('#')) ids.push(tok.slice(1));
    else if (tok.startsWith('.')) classes.push(tok.slice(1));
  });
  return (node) => {
    for (const id of ids)  if (node._attrs?.id !== id) return false;
    for (const c  of classes) if (!node._classes?.has(c)) return false;
    if (attrName) {
      const key = attrName.startsWith('data-')
        ? attrName.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        : null;
      const got = key ? node.dataset?.[key] : node._attrs?.[attrName];
      if (got !== attrVal) return false;
    }
    return true;
  };
}

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
      // Walk descendants directly so tests can build trees by push() too,
      // not only via innerHTML — and so compound class selectors work.
      const match = _compileSelector(sel);
      for (const c of _walkChildren(this)) if (match(c)) return c;
      return null;
    },
    querySelectorAll(sel) {
      if (!sel) return [];
      const match = _compileSelector(sel);
      const out = [];
      for (const c of _walkChildren(this)) if (match(c)) out.push(c);
      return out;
    },
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

  // dispatchEvent + CustomEvent — needed by the `p` shortcut test which
  // dispatches `cerberus:open-profile`. The existing _docListeners list
  // is the same one _fireKey iterates, so we just reuse it.
  _DOC.dispatchEvent = (event) => {
    const name = event && event.type;
    if (!name) return true;
    (_DOC._docListeners[name] || []).forEach(cb => cb(event));
    return true;
  };
  const sandbox = {
    document: _DOC,
    window: {},
    CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
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

// ── Expansion (this PR) ───────────────────────────────────────────────

test('Cmd+/ toggles help from anywhere (works while typing)', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  // From a focused input: still works (always-on combo)
  const input = makeElement('input');
  let ev = _DOC._fireKey({ key: '/', metaKey: true, target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, true, 'Cmd+/ opens help from inside an input');
  assert.equal(ev._prevented, true, 'Cmd+/ preventDefault');

  // Pressing again closes it
  ev = _DOC._fireKey({ key: '/', metaKey: true, target: input });
  sb.__t.onKeyDown(ev);
  assert.equal(sb.__t.STATE.helpOpen, false, 'Cmd+/ closes help on second press');
});

test('Cmd+Enter fires the submit hook for the active tab', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  // Mock a shell with #cc-tab-content + a "compare" active-tab pill +
  // a .cc-compare-run-btn for the submit selector to find.
  const shell = makeElement('div');
  const activeTabBtn = makeElement('button');
  activeTabBtn._classes.add('cc-tab-btn');
  activeTabBtn._classes.add('active');
  activeTabBtn.dataset = { tab: 'compare' };
  shell._children.push(activeTabBtn);

  const content = makeElement('div');
  content._attrs.id = 'cc-tab-content';
  const runBtn = makeElement('button');
  runBtn._classes.add('cc-compare-run-btn');
  let clicked = 0;
  runBtn.click = () => { clicked++; };
  content._children.push(runBtn);
  shell._children.push(content);

  sb.__t.STATE.shell = shell;

  // Focus is on a textarea — Cmd+Enter still fires (always-on combo).
  const ta = makeElement('textarea');
  const ev = _DOC._fireKey({ key: 'Enter', metaKey: true, target: ta });
  sb.__t.onKeyDown(ev);
  assert.equal(clicked, 1, 'Cmd+Enter clicked the COMPARE RUN button');
  assert.equal(ev._prevented, true, 'Cmd+Enter preventDefault when submit fired');
});

test('p dispatches the cerberus:open-profile custom event', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  let received = 0;
  _DOC.addEventListener('cerberus:open-profile', () => { received++; });

  // From the body (no typing target)
  const ev = _DOC._fireKey({ key: 'p', target: _DOC.body });
  sb.__t.onKeyDown(ev);
  assert.equal(received, 1, 'event dispatched on p');

  // p is suppressed when typing
  const input = makeElement('input');
  const ev2 = _DOC._fireKey({ key: 'p', target: input });
  sb.__t.onKeyDown(ev2);
  assert.equal(received, 1, 'p suppressed when target is INPUT');
});

test('quick-search overlay renders the hint bar (↑↓ navigate · ↵ select · Esc close)', () => {
  const sb = makeSandbox();
  sb.__t.STATE.inited = true;

  sb.__t.openSearch();
  const overlay = _DOC.getElementById('cc-quick-search');
  assert.ok(overlay, 'overlay mounted');
  // The mock stores the template verbatim in _innerHTML; assert on the
  // chunks that prove the hint bar was emitted.
  const html = overlay._innerHTML;
  assert.match(html, /cc-quick-search-hint/, 'hint bar present');
  assert.match(html, /<kbd>↑↓<\/kbd>/, 'navigate hint');
  assert.match(html, /<kbd>↵<\/kbd>/,    'select hint');
  assert.match(html, /<kbd>Esc<\/kbd>/,   'close hint');
});
