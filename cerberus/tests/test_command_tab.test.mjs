// Tests for command.js — live task feed + model status replacing the
// hardcoded mocks. Pure JS behavior tests: stubs `fetch` + `document` at the
// global scope, then invokes the loaders against a minimal DOM-shaped fake
// so we can assert what the panels actually render.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..',
  'static/js/cyberapps/command-center/command.js');

// ─── Minimal DOM stub ──────────────────────────────────────────────────────
//
// command.js calls _esc(s) which builds `document.createElement('div')` and
// reads `.innerHTML` after setting `.textContent`. That single round-trip is
// the only DOM API the renderers actually need at module load time.

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
};

// Import once. Cache-bust so the test runner re-evaluates if the module
// changed since the last `node --test` invocation in this process.
const mod = await import(SRC + '?bust=' + Date.now());

// ─── Fake container ─────────────────────────────────────────────────────────
//
// command.js looks up `#cc-tasks-feed` and `#cc-model-panel` via
// `root.querySelector(...)`. The fake returns objects whose only job is to
// capture whatever `innerHTML` the renderer writes so the assertions can
// inspect it.

function makeFakeRoot() {
  const tasksFeed  = { innerHTML: '' };
  const modelPanel = { innerHTML: '' };
  return {
    tasksFeed,
    modelPanel,
    querySelector(sel) {
      if (sel === '#cc-tasks-feed')  return tasksFeed;
      if (sel === '#cc-model-panel') return modelPanel;
      return null;
    },
  };
}

beforeEach(() => {
  document.hidden = false;
});

// ─── 1. _loadActiveTasks renders real rows from a mocked API response ──────

test('_loadActiveTasks renders rows from /api/tasks/active', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        tasks: [
          { id: 'task-1', title: 'reindex',       status: 'running', agent: 'CODER',  started_at: null },
          { id: 'task-2', title: 'summarise log', status: 'queued',  agent: 'SCRIBE', started_at: null },
        ],
      };
    },
  });
  const root = makeFakeRoot();
  await mod._loadActiveTasks(root);
  const html = root.tasksFeed.innerHTML;
  assert.match(html, /task-1/);
  assert.match(html, /task-2/);
  assert.match(html, /reindex/);
  assert.match(html, /CODER/);
  assert.match(html, /SCRIBE/);
  // Two cc-task-row divs rendered.
  assert.equal((html.match(/cc-task-row/g) || []).length, 2);
});

// ─── 2. Empty list → "// NO ACTIVE TASKS" empty state ──────────────────────

test('_loadActiveTasks shows the empty state when the API returns []', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return { tasks: [] }; },
  });
  const root = makeFakeRoot();
  await mod._loadActiveTasks(root);
  assert.match(root.tasksFeed.innerHTML, /NO ACTIVE TASKS/);
  assert.match(root.tasksFeed.innerHTML, /cc-empty/);
  assert.doesNotMatch(root.tasksFeed.innerHTML, /cc-task-row/);
});

// ─── 3. Fetch failure → "// TASK FEED UNAVAILABLE" ─────────────────────────

test('_loadActiveTasks shows an error state when fetch rejects', async () => {
  globalThis.fetch = async () => { throw new Error('network down'); };
  const root = makeFakeRoot();
  await mod._loadActiveTasks(root);
  assert.match(root.tasksFeed.innerHTML, /TASK FEED UNAVAILABLE/);
});

test('_loadActiveTasks shows an error state when fetch returns non-2xx', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
  const root = makeFakeRoot();
  await mod._loadActiveTasks(root);
  assert.match(root.tasksFeed.innerHTML, /TASK FEED UNAVAILABLE/);
});

// ─── 4. _loadModelInfo renders the model name + status ─────────────────────

test('_loadModelInfo renders model name from /api/model/status', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { model: 'claude-sonnet-4-6', ctx_used: 0, ctx_limit: 200000 };
    },
  });
  const root = makeFakeRoot();
  await mod._loadModelInfo(root);
  assert.match(root.modelPanel.innerHTML, /claude-sonnet-4-6/);
  assert.match(root.modelPanel.innerHTML, /MODEL/);
  assert.match(root.modelPanel.innerHTML, /STATUS/);
});

// ─── 5. CTX USED bar is suppressed when usage data is missing ──────────────

test('_loadModelInfo omits the CTX USED bar when ctx_used = 0', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return { model: 'claude-sonnet-4-6', ctx_used: 0, ctx_limit: 200000 }; },
  });
  const root = makeFakeRoot();
  await mod._loadModelInfo(root);
  // No bar, no percent text — the row is dropped entirely so the user never
  // sees a fake 0% bar (the design brief's hard rule).
  assert.doesNotMatch(root.modelPanel.innerHTML, /CTX USED/);
  assert.doesNotMatch(root.modelPanel.innerHTML, /cc-model-bar/);
  assert.doesNotMatch(root.modelPanel.innerHTML, /cc-model-pct/);
});

test('_loadModelInfo renders the CTX bar when usage IS available', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { model: 'gpt-4o', ctx_used: 50000, ctx_limit: 200000 };
    },
  });
  const root = makeFakeRoot();
  await mod._loadModelInfo(root);
  assert.match(root.modelPanel.innerHTML, /CTX USED/);
  assert.match(root.modelPanel.innerHTML, /25%/);
  assert.match(root.modelPanel.innerHTML, /cc-model-bar/);
});

// ─── Bonus: error state when the model endpoint fails ──────────────────────

test('_loadModelInfo shows the unavailable banner when fetch fails', async () => {
  globalThis.fetch = async () => { throw new Error('down'); };
  const root = makeFakeRoot();
  await mod._loadModelInfo(root);
  assert.match(root.modelPanel.innerHTML, /MODEL STATUS UNAVAILABLE/);
});
