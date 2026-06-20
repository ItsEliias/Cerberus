// Tests for the prompt-testing helpers in agents.js. Pure-JS behaviour tests
// against the module's __testables surface — stubs localStorage and document
// at the global scope before import so the module's top-level references
// resolve cleanly.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..',
  'static/js/cyberapps/command-center/agents.js');

// ─── Stubs ─────────────────────────────────────────────────────────────────
//
// agents.js calls _esc(s) on import via the document.createElement('div')
// round-trip; the localStorage helpers under test use the standard
// {getItem, setItem, removeItem} API. Stub both at the global scope.

const _storage = new Map();
globalThis.localStorage = {
  getItem:    (k) => (_storage.has(k) ? _storage.get(k) : null),
  setItem:    (k, v) => { _storage.set(k, String(v)); },
  removeItem: (k) => { _storage.delete(k); },
  clear:      () => { _storage.clear(); },
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
};
globalThis.document = {
  hidden: false,
  createElement: () => {
    let text = '';
    return {
      set textContent(v) { text = String(v ?? ''); },
      get textContent() { return text; },
      get innerHTML() {
        return text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      },
    };
  },
  head: { appendChild: () => {} },
  getElementById: () => null,
};

const mod = await import(SRC + '?bust=' + Date.now());
const T = mod.__testables;

beforeEach(() => {
  _storage.clear();
});

// ─── 1. Store up to 5 entries per agent ────────────────────────────────────

test('history stores up to INVOKE_HISTORY_MAX entries per agent', () => {
  for (let i = 1; i <= 5; i++) {
    T._appendInvokeHistory('agent-1', {
      prompt: `q${i}`, response: `a${i}`,
      timestamp: `2026-06-20T10:00:0${i}`,
    });
  }
  const all = T._readInvokeHistory('agent-1');
  assert.equal(all.length, 5);
  assert.equal(T.INVOKE_HISTORY_MAX, 5);
  // Newest-first: q5 should be at index 0.
  assert.deepEqual(all.map(e => e.prompt), ['q5', 'q4', 'q3', 'q2', 'q1']);
});

// ─── 2. 6th entry drops the oldest ─────────────────────────────────────────

test('history drops the oldest entry when adding a 6th', () => {
  for (let i = 1; i <= 6; i++) {
    T._appendInvokeHistory('agent-1', {
      prompt: `q${i}`, response: `a${i}`,
      timestamp: `2026-06-20T10:00:0${i}`,
    });
  }
  const all = T._readInvokeHistory('agent-1');
  assert.equal(all.length, 5);
  // q1 was the oldest; should now be gone.
  assert.deepEqual(all.map(e => e.prompt), ['q6', 'q5', 'q4', 'q3', 'q2']);
});

// ─── 3. Clear history empties the store ────────────────────────────────────

test('_clearInvokeHistory removes the per-agent store', () => {
  T._appendInvokeHistory('agent-1', { prompt: 'q', response: 'a' });
  T._appendInvokeHistory('agent-2', { prompt: 'q', response: 'a' });
  assert.equal(T._readInvokeHistory('agent-1').length, 1);

  T._clearInvokeHistory('agent-1');
  assert.equal(T._readInvokeHistory('agent-1').length, 0);
  // Other agents are untouched.
  assert.equal(T._readInvokeHistory('agent-2').length, 1);
});

test('history is keyed per agent — agents do not share', () => {
  T._appendInvokeHistory('agent-1', { prompt: 'one', response: '1' });
  T._appendInvokeHistory('agent-2', { prompt: 'two', response: '2' });
  assert.deepEqual(
    T._readInvokeHistory('agent-1').map(e => e.prompt), ['one']);
  assert.deepEqual(
    T._readInvokeHistory('agent-2').map(e => e.prompt), ['two']);
});

test('garbage / non-array localStorage payloads round-trip as empty', () => {
  _storage.set(T._invokeHistoryKey('agent-1'), 'not-json');
  assert.deepEqual(T._readInvokeHistory('agent-1'), []);
  _storage.set(T._invokeHistoryKey('agent-1'), JSON.stringify({ not: 'array' }));
  assert.deepEqual(T._readInvokeHistory('agent-1'), []);
});

// ─── 4. Diff highlights added/removed lines correctly ──────────────────────

test('_diffResponses marks added + removed + context lines', () => {
  const ops = T._diffResponses(
    'alpha\nbeta\ngamma',
    'alpha\ndelta\ngamma',
  );
  // alpha (ctx), beta removed, delta added, gamma (ctx).
  assert.deepEqual(ops, [
    { kind: 'ctx', text: 'alpha' },
    { kind: 'rem', text: 'beta' },
    { kind: 'add', text: 'delta' },
    { kind: 'ctx', text: 'gamma' },
  ]);
});

test('_diffResponses handles pure-add and pure-remove blocks', () => {
  // String.prototype.split('\n') on an empty string returns ['']  — so the
  // diff carries one leading 'rem'/'add' for the blank line plus the real
  // new/old lines. Assert on the real lines without caring about the blank.
  const onlyAdd = T._diffResponses('', 'one\ntwo');
  const addTexts = onlyAdd.filter(o => o.kind === 'add').map(o => o.text);
  assert.ok(addTexts.includes('one'));
  assert.ok(addTexts.includes('two'));
  assert.ok(onlyAdd.every(o => o.kind !== 'ctx'));

  const onlyRem = T._diffResponses('one\ntwo', '');
  const remTexts = onlyRem.filter(o => o.kind === 'rem').map(o => o.text);
  assert.ok(remTexts.includes('one'));
  assert.ok(remTexts.includes('two'));
  assert.ok(onlyRem.every(o => o.kind !== 'ctx'));
});

test('_diffResponses returns all-ctx when both inputs match', () => {
  const ops = T._diffResponses('same\nthing', 'same\nthing');
  assert.ok(ops.every(o => o.kind === 'ctx'));
  assert.deepEqual(ops.map(o => o.text), ['same', 'thing']);
});

// ─── 5. Export markdown structure ──────────────────────────────────────────

test('_buildExportMarkdown emits the documented structure', () => {
  const entries = [
    { prompt: 'first ask',  response: 'first answer',
      timestamp: '2026-06-20T10:00:00Z' },
    { prompt: 'second ask', response: 'second answer',
      timestamp: '2026-06-20T10:01:00Z' },
  ];
  const md = T._buildExportMarkdown('CODER', entries);
  assert.match(md, /^# AGENT: CODER — Invocation History/m);
  // Each entry uses a `## {timestamp}` heading.
  assert.match(md, /^## 2026-06-20T10:00:00Z/m);
  assert.match(md, /^## 2026-06-20T10:01:00Z/m);
  // Bold prompt + response labels with the actual text.
  assert.match(md, /\*\*Prompt:\*\* first ask/);
  assert.match(md, /\*\*Response:\*\* first answer/);
  assert.match(md, /\*\*Prompt:\*\* second ask/);
  assert.match(md, /\*\*Response:\*\* second answer/);
  // Each entry is terminated by a `---` separator.
  assert.equal((md.match(/^---$/gm) || []).length, 2);
});

test('_buildExportMarkdown handles empty history gracefully', () => {
  const md = T._buildExportMarkdown('CODER', []);
  assert.match(md, /^# AGENT: CODER — Invocation History/m);
  assert.match(md, /_No invocations recorded\._/);
});
