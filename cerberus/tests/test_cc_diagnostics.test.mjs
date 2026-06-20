// Tests for the SYSTEM DIAGNOSTICS strip in observability.js. Pure JS
// behavior tests against the module's __testables surface — stubs fetch
// + a minimal DOM so we can assert the rendered HTML.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..',
  'static/js/cyberapps/command-center/observability.js');

// Stub window + document BEFORE the import so the module's top-level
// references resolve cleanly.
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

// Fake DOM container that captures whatever `innerHTML` the renderer writes.
function makeContainer() {
  const cells = {
    '#cc-diag-services': { innerHTML: '' },
    '#cc-diag-db':       { innerHTML: '' },
    '#cc-diag-rag':      { innerHTML: '' },
  };
  return {
    cells,
    isConnected: true,
    querySelector: (sel) => cells[sel] || null,
  };
}

beforeEach(() => {
  document.hidden = false;
});

// ─── 1. Service rows render one per service ────────────────────────────────

test('_applyServices renders a row per service in the response', () => {
  const root = makeContainer();
  T._applyServices(root, {
    overall: 'ok',
    services: [
      { name: 'searxng', status: 'ok',       meta: { latency_ms: 42 } },
      { name: 'ntfy',    status: 'disabled', meta: {} },
      { name: 'providers', status: 'degraded', meta: { latency_ms: 800 } },
    ],
  });
  const html = root.cells['#cc-diag-services'].innerHTML;
  // Three rows, one per service.
  assert.equal((html.match(/cc-diag-row/g) || []).length, 3);
  assert.match(html, /SEARXNG/);
  assert.match(html, /NTFY/);
  assert.match(html, /PROVIDERS/);
});

// ─── 2. Down service maps to the error dot class ───────────────────────────

test('_diagDotClass maps status values to the right dot class', () => {
  assert.equal(T._diagDotClass('ok'),       'cc-diag-dot--ok');
  assert.equal(T._diagDotClass('online'),   'cc-diag-dot--ok');
  assert.equal(T._diagDotClass('degraded'), 'cc-diag-dot--warn');
  assert.equal(T._diagDotClass('down'),     'cc-diag-dot--err');
  assert.equal(T._diagDotClass('error'),    'cc-diag-dot--err');
  assert.equal(T._diagDotClass('disabled'), 'cc-diag-dot--off');
  assert.equal(T._diagDotClass(''),         'cc-diag-dot--unknown');
});

test('_applyServices applies cc-diag-dot--err to a down service row', () => {
  const root = makeContainer();
  T._applyServices(root, {
    services: [{ name: 'email', status: 'down', meta: {} }],
  });
  const html = root.cells['#cc-diag-services'].innerHTML;
  assert.match(html, /cc-diag-dot--err/);
  assert.match(html, /DOWN/);
});

// ─── 3. DB stats chips render with correct values ──────────────────────────

test('_applyDbStats renders sessions/messages/memories with thousand separators', () => {
  const root = makeContainer();
  T._applyDbStats(root, {
    total_sessions: 1234,
    total_messages: 45678,
    total_memories: 892,
    database_size_mb: 12.5,
  });
  const html = root.cells['#cc-diag-db'].innerHTML;
  assert.match(html, /SESSIONS/);
  assert.match(html, /1,234/);
  assert.match(html, /MESSAGES/);
  assert.match(html, /45,678/);
  assert.match(html, /MEMORIES/);
  assert.match(html, /892/);
  // SIZE chip only appears when database_size_mb > 0.
  assert.match(html, /SIZE/);
  assert.match(html, /12\.5 MB/);
});

test('_applyDbStats omits the SIZE chip when database_size_mb is 0', () => {
  const root = makeContainer();
  T._applyDbStats(root, {
    total_sessions: 1, total_messages: 1, total_memories: 1,
    database_size_mb: 0,
  });
  const html = root.cells['#cc-diag-db'].innerHTML;
  assert.doesNotMatch(html, /SIZE/);
});

// ─── 4. RAG stats render the document count ────────────────────────────────

test('_applyRagStats renders document count + status from a healthy response', () => {
  const root = makeContainer();
  T._applyRagStats(root, {
    document_count: 2048,
    embedding_model: 'BAAI/bge-base-en-v1.5 @ http://localhost:8100',
    healthy: true,
  });
  const html = root.cells['#cc-diag-rag'].innerHTML;
  assert.match(html, /DOCUMENTS/);
  assert.match(html, /2,048/);
  assert.match(html, /STATUS/);
  assert.match(html, /HEALTHY/);
  // Embedder name is split at " @ " so the bare model identifier shows.
  assert.match(html, /BAAI&#x2F;bge-base-en-v1.5|BAAI\/bge-base-en-v1\.5/);
});

test('_applyRagStats surfaces the error string when RAG is unavailable', () => {
  const root = makeContainer();
  T._applyRagStats(root, { error: 'RAG system not available' });
  const html = root.cells['#cc-diag-rag'].innerHTML;
  assert.match(html, /RAG SYSTEM NOT AVAILABLE/);
  assert.doesNotMatch(html, /DOCUMENTS/);
});

// ─── 5. One failed fetch doesn't blank the other sections ─────────────────

test('_loadDiagnostics: services fails but DB + RAG still render', async () => {
  const root = makeContainer();
  globalThis.fetch = async (url) => {
    if (url.endsWith('/api/diagnostics/services')) {
      return { ok: false, status: 503, async json() { return {}; } };
    }
    if (url.endsWith('/api/db/stats')) {
      return {
        ok: true,
        async json() {
          return { total_sessions: 5, total_messages: 10, total_memories: 2,
                   database_size_mb: 0 };
        },
      };
    }
    if (url.endsWith('/api/rag/stats')) {
      return {
        ok: true,
        async json() { return { document_count: 7, healthy: true }; },
      };
    }
    throw new Error('unexpected fetch ' + url);
  };
  await T._loadDiagnostics(root);
  // Services row got the // UNAVAILABLE banner.
  assert.match(root.cells['#cc-diag-services'].innerHTML, /UNAVAILABLE/);
  // DB + RAG still rendered.
  assert.match(root.cells['#cc-diag-db'].innerHTML, /SESSIONS/);
  assert.match(root.cells['#cc-diag-db'].innerHTML, /\b5\b/);
  assert.match(root.cells['#cc-diag-rag'].innerHTML, /DOCUMENTS/);
  assert.match(root.cells['#cc-diag-rag'].innerHTML, /\b7\b/);
});

test('_loadDiagnostics: all three failing renders three // UNAVAILABLE banners', async () => {
  const root = makeContainer();
  globalThis.fetch = async () => { throw new Error('offline'); };
  await T._loadDiagnostics(root);
  assert.match(root.cells['#cc-diag-services'].innerHTML, /UNAVAILABLE/);
  assert.match(root.cells['#cc-diag-db'].innerHTML,       /UNAVAILABLE/);
  assert.match(root.cells['#cc-diag-rag'].innerHTML,      /UNAVAILABLE/);
});
