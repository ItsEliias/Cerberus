// Tests for Feature 4 (memory timeline) + Feature 6 (wake word):
//
//   7.  wake word listener starts on toggle (and isWakeActive flips on)
//   8.  _wakeActive persists to localStorage (`cerberus.wake_word_enabled`)
//   9.  wake button hidden when SpeechRecognition unavailable
//   10. memory timeline groups entries by ISO week correctly
//   11. category filter shows only matching entries
//   12. delete fires DELETE request with the correct memory ID
//
// Same vm sandbox + minimal DOM-shim pattern as the other CC tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load both source modules into vm-runnable bodies ──────────────────

const MEM_SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-memory-timeline.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildMemoryTimelinePanel = buildMemoryTimelinePanel;'
  + '\nthis.loadMemoryTimeline       = loadMemoryTimeline;'
  + '\nthis.__t = __testables;';

const VOICE_SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/voice.js'),
  'utf8',
)
  // Strip ALL imports of sibling modules — we only test the wake-word
  // exports which don't touch any of them.
  .replace(/^import\s+[^;]+;\s*$/gm, '// (import stripped)')
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  // Strip the trailing `export { ... }` from the wake-word section
  .replace(/^export\s+\{[^}]+\};\s*$/gm, '// (export-list stripped)')
  + '\nthis.__wake = __wakeTestables;';

// ── DOM + sandbox shim ───────────────────────────────────────────────

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
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) {
      this._innerHTML = String(v ?? '');
      this._children = [];
      // Nesting-aware parser — required because loadMemoryTimeline does
      // root.querySelector once the section is the root.
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
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
          }
          continue;
        }
        const child = makeElement(tag);
        const idM    = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM   = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const dIdM   = /\bdata-id\s*=\s*"([^"]*)"/.exec(attrs);
        const dCatM  = /\bdata-cat\s*=\s*"([^"]*)"/.exec(attrs);
        const dFullM = /\bdata-full\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (dIdM) child.dataset.id = dIdM[1];
        if (dCatM) child.dataset.cat = dCatM[1];
        if (dFullM) child.dataset.full = dFullM[1];
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(c) { this._children.push(c); c.parentElement = this; return c; },
    addEventListener(name, cb) { (this._listeners[name] = this._listeners[name] || []).push(cb); },
    removeEventListener() {},
    click() {
      const ev = { target: this, stopPropagation() {}, preventDefault() {} };
      (this._listeners.click || []).forEach(cb => cb(ev));
    },
    querySelector(sel) {
      for (const c of _walk(this)) {
        if (sel.startsWith('#') && c._attrs.id === sel.slice(1)) return c;
        if (sel.startsWith('.') && c._classes.has(sel.slice(1))) return c;
      }
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      for (const c of _walk(this)) {
        if (sel.startsWith('#') && c._attrs.id === sel.slice(1)) out.push(c);
        if (sel.startsWith('.') && c._classes.has(sel.slice(1))) out.push(c);
      }
      return out;
    },
    closest() { return null; },
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

function makeMemorySandbox(fetchImpl) {
  const head = makeElement('head');
  const body = makeElement('body');
  const sandbox = {
    document: {
      head, body,
      createElement: (t) => makeElement(t),
      getElementById: (id) => {
        for (const c of _walk(head)) if (c._attrs.id === id) return c;
        for (const c of _walk(body)) if (c._attrs.id === id) return c;
        return null;
      },
    },
    window: {},
    fetch: fetchImpl || (async () => ({ ok: false, status: 500, json: async () => ({}) })),
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MEM_SRC, sandbox);
  return sandbox;
}

function makeVoiceSandbox({ supported = true } = {}) {
  const localStorageData = new Map();
  const sandbox = {
    document:  { createElement: () => makeElement('div') },
    window: {},
    localStorage: {
      getItem: (k) => localStorageData.has(k) ? localStorageData.get(k) : null,
      setItem: (k, v) => { localStorageData.set(k, String(v)); },
      removeItem: (k) => { localStorageData.delete(k); },
    },
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
  };
  if (supported) {
    // Stub a SpeechRecognition constructor that records start/stop calls
    // and lets the test fire `onresult` events at will.
    sandbox.window.SpeechRecognition = class {
      constructor() {
        this.started = 0; this.stopped = 0;
        this.continuous = false; this.interimResults = false;
        sandbox.__lastRec = this;
      }
      start() { this.started++; }
      stop()  { this.stopped++; if (this.onend) this.onend(); }
    };
  }
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(VOICE_SRC, sandbox);
  return sandbox;
}

async function _settle(times = 12) {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
}

// ── Tests ────────────────────────────────────────────────────────────

test('7. wake word listener starts on toggle (isWakeActive flips on)', () => {
  const sb = makeVoiceSandbox({ supported: true });
  assert.equal(sb.__wake.isWakeActive(), false);
  const ok = sb.__wake.start(() => {});
  assert.equal(ok, true);
  assert.equal(sb.__wake.isWakeActive(), true);
  sb.__wake.stop();
  assert.equal(sb.__wake.isWakeActive(), false);
});

test('8. wake pref persists to localStorage', () => {
  const sb = makeVoiceSandbox({ supported: true });
  assert.equal(sb.__wake.readPref(), false, 'default off');
  sb.__wake.writePref(true);
  assert.equal(sb.__wake.readPref(), true);
  assert.equal(sb.localStorage.getItem(sb.__wake.WAKE_PREF_KEY), '1');
  sb.__wake.writePref(false);
  assert.equal(sb.__wake.readPref(), false);
});

test('9. wake support reports false when SpeechRecognition is unavailable', () => {
  const sb = makeVoiceSandbox({ supported: false });
  assert.equal(sb.__wake.isSupported(), false);
  // start() must no-op (returns false) under unsupported environments
  assert.equal(sb.__wake.start(() => {}), false);
  assert.equal(sb.__wake.isWakeActive(), false);
});

test('10. memory timeline groups entries by ISO week (most-recent first)', () => {
  const sb = makeMemorySandbox();
  const { _groupByWeek } = sb.__t;
  // Two entries in week of 2026-06-15 (Mon), one in week of 2026-06-08
  const entries = [
    { id: 'a', text: 'mid-week', timestamp: '2026-06-17T10:00:00Z' },
    { id: 'b', text: 'older',    timestamp: '2026-06-10T10:00:00Z' },
    { id: 'c', text: 'monday',   timestamp: '2026-06-15T08:00:00Z' },
  ];
  const groups = _groupByWeek(entries);
  assert.equal(groups.length, 2);
  // Most-recent week first
  assert.equal(groups[0].entries.length, 2);
  assert.equal(groups[1].entries.length, 1);
  const ids = groups[0].entries.map(e => e.id);
  // Within a week, newer first
  assert.equal(ids[0], 'a');
  assert.equal(ids[1], 'c');
});

test('11. category filter keeps only matching entries', () => {
  const sb = makeMemorySandbox();
  const { _filterByCategory, _collectCategories } = sb.__t;
  const entries = [
    { id: '1', text: 'a', category: 'work',     timestamp: 1 },
    { id: '2', text: 'b', category: 'personal', timestamp: 2 },
    { id: '3', text: 'c', category: 'work',     timestamp: 3 },
  ];
  const cats = _collectCategories(entries);
  assert.ok(cats.includes('work'));
  assert.ok(cats.includes('personal'));

  const onlyWork = _filterByCategory(entries, 'work');
  assert.equal(onlyWork.length, 2);
  assert.ok(onlyWork.every(e => e.category === 'work'));

  // 'all' is a special pass-through
  assert.equal(_filterByCategory(entries, 'all').length, 3);
  assert.equal(_filterByCategory(entries, '').length, 3);
});

test('12. delete fires DELETE /api/memory/{id} with the right id', async () => {
  let deleted = null;
  const sb = makeMemorySandbox(async (url, opts) => {
    if (url === '/api/memory') {
      return { ok: true, status: 200, json: async () => ({
        memory: [
          { id: 'm-1', text: 'first', category: 'note', timestamp: 1000 },
          { id: 'm-2', text: 'second', category: 'note', timestamp: 2000 },
        ],
      }) };
    }
    if (url.startsWith('/api/memory/') && opts?.method === 'DELETE') {
      deleted = url.replace('/api/memory/', '');
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return { ok: false, status: 404 };
  });

  const container = makeElement('div');
  container.innerHTML = sb.buildMemoryTimelinePanel();
  await sb.loadMemoryTimeline(container);
  await _settle();
  const entries = container.querySelectorAll('.cc-mem-entry');
  assert.ok(entries.length >= 2, 'entries rendered');
  const delBtn = entries[0].querySelector('.cc-mem-entry-del');
  assert.ok(delBtn, 'delete button on first entry');
  delBtn.click();
  await _settle();
  assert.ok(deleted, 'DELETE request fired');
  // The list is sorted newest-first, so the FIRST rendered entry is the
  // 2000-ts one (m-2). That's what should have been deleted.
  assert.equal(deleted, 'm-2');
});
