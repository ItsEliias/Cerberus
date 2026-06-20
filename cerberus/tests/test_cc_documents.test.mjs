// cc-documents — 6 behavioural tests for the DOCUMENTS panel:
//   1. document rows render title from a mocked library response
//   2. filter hides non-matching rows
//   3. viewer renders content via textContent (not innerHTML — XSS safe)
//   4. copy button writes to navigator.clipboard.writeText
//   5. delete requires a two-step confirm before firing DELETE
//   6. PDF import fires POST /api/documents/import-pdf (multipart)
//
// Same vm-sandbox + DOM-shim pattern as the other CC tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/cc-documents.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildDocsPanel = buildDocsPanel;'
  + '\nthis.loadDocs       = loadDocs;'
  + '\nthis.__t = __testables;';

// ── DOM shim ──────────────────────────────────────────────────────────

function* _walkChildren(node) {
  for (const c of node._children || []) {
    yield c;
    yield* _walkChildren(c);
  }
}

// Tiny compound selector: handles #id, .cls, .cls.cls2, and [attr="val"].
function _compileSelector(sel) {
  const parts = sel.trim().split(/\s+/);
  const last  = parts[parts.length - 1];
  const attrM = /\[([\w-]+)="?([^"\]]*)"?\]$/.exec(last);
  const baseStr = attrM ? last.slice(0, -attrM[0].length) : last;
  const attrName = attrM ? attrM[1] : null;
  const attrVal  = attrM ? attrM[2] : null;
  const ids = [], classes = [];
  baseStr.split(/(?=[#.])/).forEach(tok => {
    if (tok.startsWith('#')) ids.push(tok.slice(1));
    else if (tok.startsWith('.')) classes.push(tok.slice(1));
  });
  return (node) => {
    for (const id of ids) if (node._attrs?.id !== id) return false;
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
      const VOID = new Set(['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr']);
      const tokenRe = /<\s*(\/)?\s*(\w+)\b([^>]*?)(\/?)\s*>/g;
      const stack = [el];
      let lastIdx = 0;
      let m;
      function _decode(s) {
        return String(s ?? '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      }
      while ((m = tokenRe.exec(this._innerHTML))) {
        // Any text between the previous token's end and this one's start
        // belongs to the currently-open element as its text content.
        const textChunk = this._innerHTML.slice(lastIdx, m.index).trim();
        if (textChunk) {
          const cur = stack[stack.length - 1];
          if (cur !== el) cur._text = (cur._text || '') + _decode(textChunk);
        }
        const isClose = m[1] === '/';
        const tag     = m[2].toLowerCase();
        const attrs   = m[3];
        const selfClose = m[4] === '/' || VOID.has(tag);
        const parent = stack[stack.length - 1];
        if (isClose) {
          for (let i = stack.length - 1; i > 0; i--) {
            if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
          }
          lastIdx = tokenRe.lastIndex;
          continue;
        }
        const child = makeElement(tag);
        const idM    = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM   = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const styleM = /\bstyle\s*=\s*"([^"]*)"/.exec(attrs);
        const dIdM   = /\bdata-id\s*=\s*"([^"]*)"/.exec(attrs);
        const dToneM = /\bdata-tone\s*=\s*"([^"]*)"/.exec(attrs);
        const dispM  = styleM && /display\s*:\s*([^;"]+)/.exec(styleM[1]);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (dIdM) child.dataset.id = dIdM[1];
        if (dToneM) child.dataset.tone = dToneM[1];
        if (dispM) child.style.display = dispM[1].trim();
        child.parentElement = parent;
        parent._children.push(child);
        if (!selfClose) stack.push(child);
        lastIdx = tokenRe.lastIndex;
      }
    },
    get textContent() { return this._text; },
    set textContent(v) {
      this._text = String(v ?? '');
      // Mirror to _innerHTML escaped form so the chip-render's
      // _esc(s) = createElement().textContent / .innerHTML pattern works.
      this._innerHTML = this._text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    appendChild(child) { this._children.push(child); child.parentElement = this; return child; },
    addEventListener(name, cb) { (this._listeners[name] = this._listeners[name] || []).push(cb); },
    removeEventListener() {},
    click() { (this._listeners.click || []).forEach(cb => cb({ target: this })); },
    focus() {},
    querySelector(sel) {
      const match = _compileSelector(sel);
      for (const c of _walkChildren(this)) if (match(c)) return c;
      return null;
    },
    querySelectorAll(sel) {
      const match = _compileSelector(sel);
      const out = [];
      for (const c of _walkChildren(this)) if (match(c)) out.push(c);
      return out;
    },
  };
  return el;
}

function makeSandbox(opts = {}) {
  const head = makeElement('head');
  const body = makeElement('body');
  const sandbox = {
    document: {
      createElement: (t) => makeElement(t),
      head, body,
      getElementById: (id) => {
        for (const c of _walkChildren(head))  if (c._attrs.id === id) return c;
        for (const c of _walkChildren(body))  if (c._attrs.id === id) return c;
        return null;
      },
    },
    navigator: {
      clipboard: {
        writes: [],
        async writeText(t) { sandbox.navigator.clipboard.writes.push(t); },
      },
    },
    FormData: class {
      constructor() { this._fields = []; }
      append(k, v)  { this._fields.push([k, v]); }
    },
    fetch: opts.fetch || (async () => ({ ok: false, status: 500, json: async () => ({}) })),
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    encodeURIComponent, decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

async function _settle(times = 30) {
  for (let i = 0; i < times; i++) await new Promise(r => setImmediate(r));
}

const LIBRARY_FIXTURE = {
  documents: [
    { id: 'd1', title: 'Threat model brief',   preview: 'attack surface notes', created_at: '2026-06-01T10:00:00Z' },
    { id: 'd2', title: 'Architecture overview', preview: 'high level diagram',   created_at: '2026-06-02T10:00:00Z' },
    { id: 'd3', title: 'Runbook — prod',        preview: 'rollback steps',        created_at: '2026-06-03T10:00:00Z' },
  ],
  total: 3,
};

// ── Tests ──────────────────────────────────────────────────────────────

test('document rows render with title + meta from the library response', async () => {
  const sb = makeSandbox({
    fetch: async (url) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => LIBRARY_FIXTURE };
      }
      return { ok: false, status: 404 };
    },
  });
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  const rows = container.querySelectorAll('.cc-docs-row');
  assert.equal(rows.length, 3);
  const titles = rows.map(r => r.querySelector('.cc-docs-row-title')?.textContent || '');
  for (const expected of ['Threat model brief', 'Architecture overview', 'Runbook — prod']) {
    assert.ok(titles.includes(expected), `expected row "${expected}"`);
  }
});

test('search input filters rows client-side (case-insensitive substring on title)', async () => {
  const sb = makeSandbox({
    fetch: async (url) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => LIBRARY_FIXTURE };
      }
      return { ok: false, status: 404 };
    },
  });
  const { _matchesQuery } = sb.__t;
  for (const d of LIBRARY_FIXTURE.documents) {
    assert.equal(_matchesQuery(d, ''), true, 'empty query passes everything');
  }
  // Substring + case-insensitive
  assert.equal(_matchesQuery({ title: 'Runbook — prod' }, 'run'), true);
  assert.equal(_matchesQuery({ title: 'Runbook — prod' }, 'RUN'), true);
  assert.equal(_matchesQuery({ title: 'Threat model brief' }, 'arch'), false);

  // End-to-end: type into the search box, list re-renders with one row
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  const searchEl = container.querySelector('#cc-docs-search');
  searchEl.value = 'arch';
  (searchEl._listeners.input || []).forEach(cb => cb({ target: searchEl }));
  const rows = container.querySelectorAll('.cc-docs-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.cc-docs-row-title')?.textContent, 'Architecture overview');
});

test('viewer renders content via textContent — embedded script tags stay inert', async () => {
  const docPayload = {
    id: 'd1', title: 'Hostile <script>alert(1)</script>',
    current_content: '<script>window.__x = 1;</script>Body OK',
  };
  const sb = makeSandbox({
    fetch: async (url) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => ({ documents: [docPayload] }) };
      }
      if (url.startsWith('/api/document/')) {
        return { ok: true, status: 200, json: async () => docPayload };
      }
      return { ok: false, status: 404 };
    },
  });
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  const row = container.querySelector('.cc-docs-row');
  assert.ok(row);
  row.click();
  await _settle();
  const bodyEl  = container.querySelector('#cc-docs-viewer-body');
  const titleEl = container.querySelector('#cc-docs-viewer-title');
  assert.equal(bodyEl.textContent, docPayload.current_content, 'verbatim text preserved');
  assert.equal(titleEl.textContent, docPayload.title);
  assert.equal(sb.window?.__x, undefined, 'no script executed');
});

test('copy button calls navigator.clipboard.writeText with the document body', async () => {
  const sb = makeSandbox({
    fetch: async (url) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => ({ documents: [
          { id: 'd1', title: 'A', preview: 'a' }
        ] }) };
      }
      if (url.startsWith('/api/document/')) {
        return { ok: true, status: 200, json: async () => ({ id: 'd1', title: 'A', current_content: 'BODY-TEXT' }) };
      }
      return { ok: false, status: 404 };
    },
  });
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  container.querySelector('.cc-docs-row').click();
  await _settle();
  container.querySelector('.cc-docs-copy-btn').click();
  await _settle();
  assert.deepEqual([...sb.navigator.clipboard.writes], ['BODY-TEXT']);
});

test('delete is two-step: first click reveals CONFIRM; second click fires DELETE', async () => {
  let deleteCalled = 0;
  const sb = makeSandbox({
    fetch: async (url, opts) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => ({ documents: [
          { id: 'd1', title: 'A', preview: 'a' }
        ] }) };
      }
      if (url.startsWith('/api/document/d1') && opts?.method === 'DELETE') {
        deleteCalled++;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (url.startsWith('/api/document/d1')) {
        return { ok: true, status: 200, json: async () => ({ id: 'd1', title: 'A', current_content: 'body' }) };
      }
      return { ok: false, status: 404 };
    },
  });
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  container.querySelector('.cc-docs-row').click();
  await _settle();

  const deleteBtn  = container.querySelector('.cc-docs-delete-btn');
  const confirmBtn = container.querySelector('.cc-docs-confirm-btn');
  assert.equal(confirmBtn.style.display, 'none', 'CONFIRM hidden initially');
  deleteBtn.click();
  assert.notEqual(confirmBtn.style.display, 'none', 'CONFIRM revealed after first click');
  assert.equal(deleteCalled, 0, 'no DELETE fired on first click');

  confirmBtn.click();
  await _settle();
  assert.equal(deleteCalled, 1, 'DELETE fired on confirm click');
});

test('PDF import fires POST /api/documents/import-pdf with multipart form data', async () => {
  let importedWith = null;
  const sb = makeSandbox({
    fetch: async (url, opts) => {
      if (url.startsWith('/api/documents/library')) {
        return { ok: true, status: 200, json: async () => ({ documents: [] }) };
      }
      if (url === '/api/documents/import-pdf' && opts?.method === 'POST') {
        importedWith = opts.body;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404 };
    },
  });
  const container = makeElement('div');
  container.innerHTML = sb.buildDocsPanel();
  await sb.loadDocs(container);
  await _settle();
  const pdfInput = container.querySelector('#cc-docs-pdf-input');
  pdfInput.files = [{ name: 'paper.pdf', size: 1024, type: 'application/pdf' }];
  (pdfInput._listeners.change || []).forEach(cb => cb({ target: pdfInput }));
  await _settle();

  assert.ok(importedWith, 'POST /api/documents/import-pdf was called');
  // The body should be the FormData stub with one file field
  assert.equal(importedWith._fields?.length, 1);
  assert.equal(importedWith._fields[0][0], 'file');
  assert.equal(importedWith._fields[0][1].name, 'paper.pdf');
});
