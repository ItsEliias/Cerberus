// cc-notes — 8 behavioural tests covering all four spec features.
//   1. search filter hides non-matching note rows
//   2. pinned notes sort above unpinned
//   3. markdown renderer: **bold** → <b>text</b>
//   4. markdown renderer: `code`   → <code>text</code>
//   5. sanitizer strips <script> tags from output
//   6. sanitizer strips <img>    tags from output
//   7. word count: "hello world" → 2 words · 11 chars
//   8. word count: ""            → 0 words · 0 chars
//
// vm sandbox + tiny DOM shim matches the other CC tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-notes.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildNotesPanel = buildNotesPanel;'
  + '\nthis.__t = __testables;';

// Minimal element shim — enough for _renderList to build markup we can
// regex-check, and for class toggles to work on rows.
function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _classes: new Set(),
    _children: [],
    _attrs: {},
    _innerHTML: '',
    _text: '',
    style: {},
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
    set innerHTML(v) { this._innerHTML = String(v ?? ''); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    addEventListener() {},
    appendChild(c) { this._children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
  return el;
}

function makeSandbox() {
  const localStorageData = new Map();
  const sandbox = {
    document: {
      createElement: (t) => makeElement(t),
      body: makeElement('body'),
    },
    window: {},
    localStorage: {
      getItem: (k) => localStorageData.has(k) ? localStorageData.get(k) : null,
      setItem: (k, v) => { localStorageData.set(k, String(v)); },
      removeItem: (k) => { localStorageData.delete(k); },
    },
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ──────────────────────────────────────────────────────────────

test('search filter: only rows whose title or content contain the query survive', () => {
  const sb = makeSandbox();
  const { _matchesSearch } = sb.__t;
  const notes = [
    { id: 'a', title: 'Architecture review',   content: 'cerberus boundary diagram' },
    { id: 'b', title: 'Shopping list',         content: 'eggs, milk, bread' },
    { id: 'c', title: 'Deploy notes',          content: 'staging then prod, rollback path' },
  ];
  const q = 'deploy';
  const survivors = notes.filter(n => _matchesSearch(n, q));
  assert.equal(JSON.stringify(survivors.map(n => n.id)), JSON.stringify(['c']));

  // case-insensitive + matches against content
  const survivors2 = notes.filter(n => _matchesSearch(n, 'CERBERUS'));
  assert.equal(JSON.stringify(survivors2.map(n => n.id)), JSON.stringify(['a']));

  // empty query passes everything
  assert.equal(notes.filter(n => _matchesSearch(n, '')).length, 3);
});

test('pinned notes sort above unpinned', () => {
  const sb = makeSandbox();
  const { _sortNotesForDisplay } = sb.__t;
  const notes = [
    { id: 'a', title: 'A', _idx: 0 },
    { id: 'b', title: 'B', _idx: 1 },
    { id: 'c', title: 'C', _idx: 2 },
    { id: 'd', title: 'D', _idx: 3 },
  ];
  const pinned = new Set(['c']);
  const out = _sortNotesForDisplay(notes, pinned);
  assert.equal(JSON.stringify(out.map(n => n.id)), JSON.stringify(['c', 'a', 'b', 'd']),
               'pinned id sorts to top; unpinned preserve original order');
  // Pin two — both should be at the top, in original order
  const out2 = _sortNotesForDisplay(notes, new Set(['b', 'd']));
  assert.equal(JSON.stringify(out2.map(n => n.id)), JSON.stringify(['b', 'd', 'a', 'c']));
});

test('markdown renderer: **bold** → <b>text</b>', () => {
  const sb = makeSandbox();
  const { _renderMarkdown } = sb.__t;
  const out = _renderMarkdown('This is **bold** text');
  assert.match(out, /<b>bold<\/b>/, 'emits <b> wrapper');
  assert.doesNotMatch(out, /\*\*/, 'consumes the ** delimiters');
});

test('markdown renderer: `code` → <code>text</code>', () => {
  const sb = makeSandbox();
  const { _renderMarkdown } = sb.__t;
  const out = _renderMarkdown('Run `npm test` to verify');
  assert.match(out, /<code>npm test<\/code>/, 'inline code wrapped');
  assert.doesNotMatch(out, /`/, 'consumes the backticks');
});

test('sanitizer strips <script> tags from output', () => {
  const sb = makeSandbox();
  const { _sanitizeHtml } = sb.__t;
  const out = _sanitizeHtml('<b>kept</b><script>alert(1)</script><i>kept</i>');
  assert.match(out, /<b>kept<\/b>/, 'kept allowlisted tags');
  assert.match(out, /<i>kept<\/i>/, 'kept allowlisted tags');
  assert.doesNotMatch(out, /<script/i, 'script opening tag removed');
  assert.doesNotMatch(out, /<\/script>/i, 'script closing tag removed');
  // The inner script *text* (alert(1)) survives as inert text. The sanitizer
  // strips the tags but is not a JS-stripper — confirm it's no longer a
  // script element by ensuring no <script> markers remain.
});

test('sanitizer strips <img> tags from output', () => {
  const sb = makeSandbox();
  const { _sanitizeHtml } = sb.__t;
  const out = _sanitizeHtml('<p>before</p><img src="x" onerror="alert(1)"><p>after</p>');
  assert.match(out, /<p>before<\/p>/);
  assert.match(out, /<p>after<\/p>/);
  assert.doesNotMatch(out, /<img/i, '<img> stripped');
  assert.doesNotMatch(out, /onerror/i, 'attributes never reach the output');
});

test('sanitizer also drops other disallowed tags (<a>, <iframe>)', () => {
  const sb = makeSandbox();
  const { _sanitizeHtml } = sb.__t;
  const out = _sanitizeHtml('<a href="https://x">link</a><iframe src="x"></iframe>');
  assert.doesNotMatch(out, /<a\b/i, '<a> stripped');
  assert.doesNotMatch(out, /<iframe/i, '<iframe> stripped');
  assert.doesNotMatch(out, /href/i, 'href dropped with the tag');
});

test('word count: "hello world" → 2 words · 11 chars', () => {
  const sb = makeSandbox();
  const { _wordCount, _formatCount } = sb.__t;
  // The returned object lives in the vm realm so its prototype isn't ours;
  // assert field-by-field instead of deepEqual to dodge cross-realm equality.
  const r = _wordCount('hello world');
  assert.equal(r.words, 2);
  assert.equal(r.chars, 11);
  assert.equal(_formatCount('hello world'), '2 words · 11 chars');
});

test('word count: empty string → 0 words · 0 chars', () => {
  const sb = makeSandbox();
  const { _wordCount, _formatCount } = sb.__t;
  const empty = _wordCount('');
  assert.equal(empty.words, 0);
  assert.equal(empty.chars, 0);
  const spaces = _wordCount('   ');
  assert.equal(spaces.words, 0);
  assert.equal(spaces.chars, 3);
  assert.equal(_formatCount(''), '0 words · 0 chars');
});
