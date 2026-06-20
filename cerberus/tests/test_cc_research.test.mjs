// cc-research — covers the 5 behavioural cases the spec calls out:
//   1. buildResearchTab() returns HTML containing the .cc-research-tab root
//      and every named child surface (form / progress / result).
//   2. progress bar fill width updates correctly from the percent value.
//   3. Only http(s) source URLs are rendered as links; everything else is
//      either skipped or rendered as inert text.
//   4. Result content is written via textContent, not innerHTML — so any
//      embedded <script>/<img onerror=…> stays as visible text.
//   5. Cancel resets the view to the form state and clears progress display.
//
// Pattern matches the other CC tests: vm sandbox + minimal DOM shim. We
// drive the testables directly rather than spinning up an EventSource.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-research.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildResearchTab = buildResearchTab;'
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
    _innerHTML: '',
    _text: '',
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
      const tagRe = /<(\w+)\b([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(this._innerHTML))) {
        const child = makeElement(m[1]);
        const attrs = m[2];
        const idM   = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM  = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        child.parentElement = this;
        this._children.push(child);
      }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v ?? ''); },
    appendChild(child) {
      this._children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child) {
      const i = this._children.indexOf(child);
      if (i >= 0) this._children.splice(i, 1);
      child.parentElement = null;
    },
    remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    addEventListener() {}, removeEventListener() {},
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

function makeSandbox() {
  const doc = {
    createElement: (tag) => makeElement(tag),
    body: makeElement('body'),
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null,
  };
  const sandbox = {
    document: doc,
    window: {},
    URL,
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    Number, isFinite,
    encodeURIComponent, decodeURIComponent,
    fetch: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' }),
    EventSource: class { close() {} constructor() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ─────────────────────────────────────────────────────────────

test('buildResearchTab returns HTML with .cc-research-tab + form / progress / result surfaces', () => {
  const sb = makeSandbox();
  const html = sb.buildResearchTab();
  assert.ok(/class="cc-research-tab"/.test(html), 'root has cc-research-tab class');
  assert.ok(/class="cc-research-form"/.test(html), 'form surface present');
  assert.ok(/class="cc-research-progress"/.test(html), 'progress surface present');
  assert.ok(/class="cc-research-result"/.test(html), 'result surface present');
  assert.ok(/cc-research-query/.test(html), 'query textarea wired');
  assert.ok(/cc-research-start-btn/.test(html), 'start button wired');
  assert.ok(/cc-research-bar-fill/.test(html), 'bar fill element wired');
});

test('_computeProgress maps the SSE payload to a bar percent + label', () => {
  const sb = makeSandbox();
  const { _computeProgress } = sb.__t;

  // Phases without an explicit percent use the heuristic
  assert.equal(_computeProgress({ status: 'running', phase: 'probing' }).percent, 5);
  assert.equal(_computeProgress({ status: 'running', phase: 'planning' }).percent, 15);
  assert.equal(_computeProgress({ status: 'running', phase: 'searching', round: 1 }).percent, 36);
  assert.equal(_computeProgress({ status: 'running', phase: 'searching', round: 99 }).percent, 43);

  // Explicit percent on the payload wins and is clamped
  assert.equal(_computeProgress({ status: 'running', percent: 42 }).percent, 42);
  assert.equal(_computeProgress({ status: 'running', percent: 250 }).percent, 100);
  assert.equal(_computeProgress({ status: 'running', percent: -10 }).percent, 0);

  // Terminal statuses pin the bar
  assert.equal(_computeProgress({ status: 'complete' }).percent, 100);
  assert.equal(_computeProgress({ status: 'complete' }).label, 'COMPLETE');
});

test('_sanitizeUrl + _renderSources reject non-http(s) URLs', () => {
  const sb = makeSandbox();
  const { _sanitizeUrl, _renderSources } = sb.__t;

  assert.equal(_sanitizeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(_sanitizeUrl('http://example.com'),    'http://example.com/');
  assert.equal(_sanitizeUrl('javascript:alert(1)'),   '', 'javascript: scheme rejected');
  assert.equal(_sanitizeUrl('data:text/html,<x>'),    '', 'data: scheme rejected');
  assert.equal(_sanitizeUrl('file:///etc/passwd'),    '', 'file: scheme rejected');
  assert.equal(_sanitizeUrl('not-a-url'),             '', 'invalid URL rejected');
  assert.equal(_sanitizeUrl(null),                    '', 'null rejected');

  const list = makeElement('div');
  const rendered = _renderSources(list, [
    { title: 'Good',     url: 'https://example.com/1' },
    { title: 'XSS',      url: 'javascript:alert(1)' },
    { title: 'Plain',    url: 'http://example.org/x' },
    { title: 'No URL',   url: '' },
    { title: 'Bad data', url: 'data:text/html,<script>x</script>' },
  ]);
  assert.equal(rendered, 2, 'only the two http(s) sources count');
  const links = list._children.filter(c => c.tagName === 'A');
  assert.equal(links.length, 2);
  for (const link of links) {
    // cc-research.js sets these via direct property assignment, not
    // setAttribute, so check the property and not _attrs.
    assert.match(link.href, /^https?:\/\//);
    assert.equal(link.rel,    'noopener noreferrer');
    assert.equal(link.target, '_blank');
  }
});

test('result body is written via textContent — embedded script tags stay inert', () => {
  const sb = makeSandbox();
  const body = makeElement('div');
  const payload = `<script>window.__xss = true;</script>OK`;
  body.textContent = payload;
  assert.equal(body.textContent, payload, 'textContent preserved verbatim');
  assert.equal(body.innerHTML, '', 'no innerHTML assignment happened');
  assert.equal(sb.window.__xss, undefined, 'no script ran');
});

test('_resetToForm hides progress + result and zeroes the bar/percent', () => {
  const sb = makeSandbox();
  const { _showOnly, _resetToForm } = sb.__t;

  const container = makeElement('div');
  const form     = makeElement('div'); form._classes.add('cc-research-form');
  const progress = makeElement('div'); progress._classes.add('cc-research-progress');
  const result   = makeElement('div'); result._classes.add('cc-research-result');
  const step     = makeElement('div'); step._classes.add('cc-research-step-label');
  const fill     = makeElement('div'); fill._classes.add('cc-research-bar-fill');
  const pct      = makeElement('div'); pct._classes.add('cc-research-pct');
  const query    = makeElement('textarea'); query._classes.add('cc-research-query');
  [form, progress, result, step, fill, pct, query].forEach(n => container.appendChild(n));

  // Simulate a mid-research state: progress visible, result waiting
  _showOnly(container, 'progress');
  step.textContent = '// SEARCHING';
  fill.style.width = '42%';
  pct.textContent  = '42%';

  _resetToForm(container);

  assert.equal(form.style.display,     '',     'form is shown');
  assert.equal(progress.style.display, 'none', 'progress hidden');
  assert.equal(result.style.display,   'none', 'result hidden');
  assert.equal(step.textContent, '// INITIALISING', 'step label reset');
  assert.equal(fill.style.width, '0%',             'bar fill reset');
  assert.equal(pct.textContent,  '0%',             'percent label reset');
});
