/**
 * tests/test_agents_fixes.test.mjs
 *
 * node:test suite covering the six QA bugs fixed in fix/font-and-agents.
 * Hand-rolled DOM shim — no jsdom dependency.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// ---------------------------------------------------------------------------
// Minimal DOM shim
// ---------------------------------------------------------------------------

function makeEl(tag = 'div') {
  const attrs = {};
  const style = {};
  const children = [];
  let _textContent = '';
  let _innerHTML = '';
  const events = {};
  const dataset = new Proxy({}, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = String(v); return true; },
  });

  const el = {
    tagName: tag.toUpperCase(),
    dataset,
    style,
    attrs,
    classList: (() => {
      const set = new Set();
      return {
        add: (...cls) => cls.forEach(c => set.add(c)),
        remove: (...cls) => cls.forEach(c => set.delete(c)),
        toggle: (c, force) => { const v = force !== undefined ? force : !set.has(c); v ? set.add(c) : set.delete(c); return v; },
        contains: c => set.has(c),
        _set: set,
      };
    })(),
    get textContent() { return _textContent; },
    set textContent(v) { _textContent = String(v ?? ''); _innerHTML = _textContent; },
    get innerHTML() { return _innerHTML; },
    set innerHTML(v) {
      _innerHTML = String(v ?? '');
      _textContent = _innerHTML.replace(/<[^>]*>/g, '');
    },
    addEventListener(ev, fn) { (events[ev] = events[ev] || []).push(fn); },
    dispatchEvent(ev) { (events[ev?.type] || []).forEach(fn => fn(ev)); },
    getAttribute(k) { return attrs[k] ?? null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    closest(sel) { return null; },
    querySelector(sel) {
      // tag+[data-attr] pattern
      const m = /^(\w+)\[data-([\w-]+)\]$/.exec(sel);
      if (m) return children.find(c => c.tagName === m[1].toUpperCase() && m[2] in c.dataset) || null;
      // class or id
      const cls = /^\.(.+)$/.exec(sel);
      const id  = /^#(.+)$/.exec(sel);
      return children.find(c =>
        (cls && c.classList._set.has(cls[1])) ||
        (id  && c.id === id[1])
      ) || null;
    },
    querySelectorAll(sel) {
      const m = /^(\w+)\[data-([\w-]+)\]$/.exec(sel);
      const cls = /^\.(.+)$/.exec(sel);
      const id  = /^#(.+)$/.exec(sel);
      return children.filter(c =>
        (m   && c.tagName === m[1].toUpperCase() && m[2] in c.dataset) ||
        (cls && c.classList._set.has(cls[1])) ||
        (id  && c.id === id[1])
      );
    },
    appendChild(c) { children.push(c); return c; },
    remove() {},
    children,
    id: '',
    hidden: false,
    disabled: false,
    value: '',
    _events: events,
  };
  return el;
}

const _doc = {
  createElement: (tag) => makeEl(tag),
  getElementById: () => null,
  head: makeEl('head'),
  body: makeEl('body'),
};
const _ls = {};
const _localStorage = {
  getItem: k => _ls[k] ?? null,
  setItem: (k, v) => { _ls[k] = v; },
  removeItem: k => { delete _ls[k]; },
};
const _win = {
  CYBER_APPS_REGISTRY: null,
  localStorage: _localStorage,
  confirm: () => true,
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
  Blob: class { constructor(p) { this._parts = p; } },
};

// ---------------------------------------------------------------------------
// Load agents.js source in a VM sandbox
// ---------------------------------------------------------------------------

const SRC_PATH = new URL(
  '../static/js/cyberapps/command-center/agents.js',
  import.meta.url,
).pathname;

let agentsSrc = readFileSync(SRC_PATH, 'utf8');
// Strip ES import/export so vm.Script can parse it
agentsSrc = agentsSrc
  .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?/gm, '')
  .replace(/^export\s+(const|function|async function|class)\s+/gm, '$1 ')
  .replace(/^export\s+\{[^}]*\}\s*;?/gm, '');

let _testables;
const sandbox = vm.createContext({
  document: _doc,
  localStorage: _localStorage,
  window: _win,
  fetch: async () => ({ ok: false, json: async () => ({}) }),
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {},
  confirm: () => true,
  alert: () => {},
  console,
  __exports: {},
});

// Wrap source so __testables is accessible
const wrappedSrc = `
${agentsSrc}
__exports.__testables = typeof __testables !== 'undefined' ? __testables : {};
`;

vm.runInContext(wrappedSrc, sandbox);
_testables = sandbox.__exports.__testables;

// ---------------------------------------------------------------------------
// Test 1 — _wireRow submit/export handlers use defined agent name (no ReferenceError)
// ---------------------------------------------------------------------------

describe('Bug 2 — invoke scope fix', () => {
  it('submit and export handlers reference row.dataset.agentName, not undefined agent', () => {
    // We can't call _wireRow without a full DOM setup, so inspect the source
    // directly: confirm that `agent?.name` no longer appears near submitBtn/exportBtn.
    const src = readFileSync(SRC_PATH, 'utf8');
    const lines = src.split('\n');

    // Find the submitBtn listener line
    const submitLine = lines.find(l => l.includes('submitBtn?.addEventListener') && l.includes('_invokeAgentWithHistory'));
    assert.ok(submitLine, 'submitBtn listener not found');
    assert.ok(!submitLine.includes('agent?.name'), 'submitBtn still references undefined agent?.name');
    assert.ok(submitLine.includes('row.dataset.agentName'), 'submitBtn should use row.dataset.agentName');

    // Find the exportBtn listener line
    const exportLine = lines.find(l => l.includes('exportBtn?.addEventListener') && l.includes('_exportInvokeHistory'));
    assert.ok(exportLine, 'exportBtn listener not found');
    assert.ok(!exportLine.includes('agent?.name'), 'exportBtn still references undefined agent?.name');
    assert.ok(exportLine.includes('row.dataset.agentName'), 'exportBtn should use row.dataset.agentName');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — RUN button label/icon/count are in cc-row-actions, not stacked separately
// ---------------------------------------------------------------------------

describe('Bug 3 — RUN layout in actions column', () => {
  it('cc-ag-invoke-count is a child of cc-row-actions in rendered HTML', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    // Find the _agentRow function body
    const fnStart = src.indexOf('function _agentRow(');
    const returnStart = src.indexOf('return `', fnStart);
    const returnEnd = src.indexOf('`.trim()', returnStart) + '`.trim()'.length;
    const rowHtml = src.slice(returnStart, returnEnd);

    // cc-ag-invoke-count must appear INSIDE cc-row-actions block
    const actionsBlock = /<span class="cc-row-actions">([\s\S]*?)<\/span>\s*<\/div>`\.trim/.exec(rowHtml);
    assert.ok(actionsBlock, 'cc-row-actions closing block not found in template literal');
    assert.ok(
      actionsBlock[1].includes('cc-ag-invoke-count'),
      'cc-ag-invoke-count must be inside cc-row-actions, not a separate grid child',
    );
  });

  it('cc-health-dot and cc-row-sigil are inside cc-row-sigil-cell (one grid column)', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    const fnStart = src.indexOf('function _agentRow(');
    const returnStart = src.indexOf('return `', fnStart);
    const returnEnd = src.indexOf('`.trim()', returnStart) + '`.trim()'.length;
    const rowHtml = src.slice(returnStart, returnEnd);

    const sigilCell = /cc-row-sigil-cell[\s\S]*?cc-health-dot[\s\S]*?cc-row-sigil/.test(rowHtml);
    assert.ok(sigilCell, 'cc-health-dot must appear inside cc-row-sigil-cell before cc-row-sigil');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — overflow menu renders full labels and is wide enough
// ---------------------------------------------------------------------------

describe('Bug 3 — overflow menu width and labels', () => {
  it('overflow menu items contain full text (not truncated)', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    // Find overflow menu HTML in _agentRow
    assert.ok(src.includes('cc-ov-call">📞 Call'), 'Call label missing');
    assert.ok(src.includes('cc-ov-memory">◎ Memory'), 'Memory label missing');
    assert.ok(src.includes('cc-ov-edit">✎ Edit'), 'Edit label missing');
    assert.ok(src.includes('cc-ov-delete danger">✕ Delete'), 'Delete label missing');
  });

  it('styles.css overflow menu has min-width >= 130px', () => {
    const cssSrc = readFileSync(
      new URL('../static/js/cyberapps/command-center/styles.css', import.meta.url).pathname,
      'utf8',
    );
    const mw = /\.cc-overflow-menu\s*\{[^}]*min-width:\s*(\d+)px/.exec(cssSrc);
    assert.ok(mw, '.cc-overflow-menu min-width rule not found');
    assert.ok(Number(mw[1]) >= 130, `min-width ${mw[1]}px is too narrow (need >= 130px for full labels)`);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — no cc-section-label text contains literal "// "
// ---------------------------------------------------------------------------

describe('Bug 5 — no literal // prefix in cc-section-label strings', () => {
  it('all cc-section-label text nodes are free of literal "//" prefix', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    // Find every cc-section-label occurrence and check text content
    const labelRe = /cc-section-label">\s*(.*?)\s*<\/span>/g;
    let m;
    const violations = [];
    while ((m = labelRe.exec(src)) !== null) {
      if (m[1].startsWith('//')) violations.push(m[1]);
    }
    assert.deepEqual(violations, [], `cc-section-label strings must not start with "//": ${violations.join(', ')}`);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — New Agent form buttons carry HUD classes
// ---------------------------------------------------------------------------

describe('Bug 4 — New Agent form buttons have HUD classes', () => {
  it('cc-create-submit has cc-detail-btn-primary class', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    const submitBtn = /id="cc-create-submit"([^>]*)>/.exec(src);
    assert.ok(submitBtn, '#cc-create-submit button not found');
    assert.ok(submitBtn[1].includes('cc-detail-btn'), 'Create button missing cc-detail-btn class');
    assert.ok(submitBtn[1].includes('cc-detail-btn-primary'), 'Create button missing cc-detail-btn-primary class');
  });

  it('cc-create-cancel has cc-detail-btn-secondary class', () => {
    const src = readFileSync(SRC_PATH, 'utf8');
    const cancelBtn = /id="cc-create-cancel"([^>]*)>/.exec(src);
    assert.ok(cancelBtn, '#cc-create-cancel button not found');
    assert.ok(cancelBtn[1].includes('cc-detail-btn'), 'Cancel button missing cc-detail-btn class');
    assert.ok(cancelBtn[1].includes('cc-detail-btn-secondary'), 'Cancel button missing cc-detail-btn-secondary class');
  });
});
