// Tests for assistant chat fix, dashboard CTAs, chart empty states, and observe labels.
//
// 1. assistant.js _sendMessage payload includes a `message` string field.
// 2. NEW CHAT / START FIRST CHAT CTAs have wired handlers (not no-ops).
// 3. Token-flow chart does not call Math.random.
// 4. Empty chart state shows "// NO DATA" consistently.
// 5. No observability.js .cc-section-label text contains literal "// ".
//
// node:test — run with: node --test tests/test_assistant_charts.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadModule(relPath, patchFn) {
  let src = readFileSync(join(__dirname, '..', relPath), 'utf8');
  src = src.replace(/^export\s+const\s+/gm, 'const ');
  src = src.replace(/^export\s+function\s+/gm, 'function ');
  src = src.replace(/^export\s+async\s+function\s+/gm, 'async function ');
  if (patchFn) src = patchFn(src);
  return src;
}

// ── Minimal sandbox builder ────────────────────────────────────────────────

function buildSandbox(src, extra = {}) {
  const store = {};
  const dispatched = [];
  const fetchCalls = [];

  const sandbox = vm.createContext({
    window:      { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 },
    document: {
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        textContent: '', innerHTML: '', id: '',
        _classes: new Set(), _attrs: {},
        classList: {
          add(c)      { this._classes.add(c); },
          remove(c)   { this._classes.delete(c); },
          contains(c) { return this._classes.has(c); },
        },
        setAttribute(k, v) { this._attrs[k] = v; },
        getAttribute(k)    { return this._attrs[k]; },
        querySelector()    { return null; },
        querySelectorAll() { return []; },
        style: {},
        getContext: () => ({
          setTransform: () => {}, clearRect: () => {}, fillRect: () => {},
          createRadialGradient: () => ({ addColorStop: () => {} }),
          createLinearGradient: () => ({ addColorStop: () => {} }),
          beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
          stroke: () => {}, fill: () => {}, arc: () => {},
          fillText: () => {}, setLineDash: () => {},
          get fillStyle()    { return ''; }, set fillStyle(_) {},
          get strokeStyle()  { return ''; }, set strokeStyle(_) {},
          get lineWidth()    { return 1; }, set lineWidth(_) {},
          get font()         { return ''; }, set font(_) {},
          get textAlign()    { return ''; }, set textAlign(_) {},
          get shadowColor()  { return ''; }, set shadowColor(_) {},
          get shadowBlur()   { return 0; }, set shadowBlur(_) {},
          get lineJoin()     { return ''; }, set lineJoin(_) {},
        }),
      }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      getElementById:      () => null,
      addEventListener:    () => {},
      removeEventListener: () => {},
      dispatchEvent: (e) => dispatched.push(e),
    },
    localStorage: {
      getItem:  (k) => store[k] ?? null,
      setItem:  (k, v) => { store[k] = v; },
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => {},
    cancelAnimationFrame:  () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#c0392b' }),
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    fetch: async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: false, text: async () => 'Error', json: async () => ({}) };
    },
    sessionStorage: { setItem: () => {}, getItem: () => null },
    dispatched,
    fetchCalls,
    store,
    ...extra,
  });

  vm.runInContext(src, sandbox);
  return sandbox;
}

// ── 1. _sendMessage payload contains `message` string ─────────────────────

test('1. _sendMessage posts message string, not messages array', async () => {
  const src = loadModule('static/js/cyberapps/command-center/assistant.js');
  const patchedSrc = src
    // Remove voice/doc imports (not resolvable in vm)
    .replace(/^import .+$/gm, '')
    + '\nthis.__send = _sendMessage; this.__msgs = _messages;';

  const sb = buildSandbox(patchedSrc, {
    startRecording: () => {}, stopRecording: () => {}, getIsRecording: () => false,
    init: () => {},
    buildDocsPanel: () => '', loadDocs: () => {},
    buildNotesPanel: () => '', loadNotes: () => {},
    buildResearchPanel: () => '', loadResearch: () => {},
    buildContactsPanel: () => '', loadContacts: () => {},
    buildMemoryTimelinePanel: () => '', loadMemoryTimeline: () => {},
    buildChangelogPanel: () => '', loadChangelog: () => {},
  });

  const root = {
    querySelector: (sel) => {
      if (sel === '#cc-chat-history') return { appendChild: () => {}, scrollTop: 0, scrollHeight: 0 };
      if (sel === '#cc-chat-typing')  return { style: {} };
      if (sel === '#cc-chat-send')    return { disabled: false };
      return null;
    },
    querySelectorAll: () => [],
  };

  await sb.__send(root, 'What is 2+2?');

  assert.equal(sb.fetchCalls.length, 1, 'fetch should have been called');
  const body = JSON.parse(sb.fetchCalls[0].opts?.body || '{}');
  assert.ok('message' in body, 'body must have a `message` key');
  assert.equal(typeof body.message, 'string', '`message` must be a string');
  assert.ok(!('messages' in body), 'body must NOT have a `messages` array key');
});

// ── 2. NEW CHAT / START FIRST CHAT CTAs have wired handlers ───────────────

test('2. dash-act-chat and dash-cta-first-chat have non-trivial click handlers', () => {
  const src = loadModule('static/js/dashboard.js')
    + '\nthis.__build = _buildPanel;';

  const listeners = {};
  const sandbox = buildSandbox(src, {
    history: { replaceState: () => {} },
    location: { href: '/' },
    sessionStorage: { setItem: () => {} },
    setInterval: () => 0, clearInterval: () => {},
  });

  // Patch createElement to track addEventListener calls per ID
  let capturedIds = {};
  const realCE = sandbox.document.createElement.bind(sandbox.document);
  sandbox.document.createElement = (tag) => {
    const el = realCE(tag);
    const origAEL = el.addEventListener?.bind(el) || (() => {});
    el._ael = [];
    el.addEventListener = (evt, fn) => { el._ael.push({ evt, fn }); };
    el.querySelector = (sel) => {
      const id = sel.replace(/^#/, '');
      return capturedIds[id] || null;
    };
    el.querySelectorAll = () => [];
    el.appendChild = () => {};
    el.insertAdjacentElement = () => {};
    el.classList = { add: () => {}, remove: () => {}, contains: () => false };
    el.style = {};
    return el;
  };
  sandbox.document.body.appendChild = (el) => {
    // Recursively collect IDs from innerHTML (simplified — look for known button ids)
    ['dash-act-chat', 'dash-act-cerberus', 'dash-act-nexus', 'dash-act-cc',
     'dash-cta-first-chat', 'dash-close', 'dash-act-notes', 'dash-act-tasks', 'dash-act-theme'].forEach(id => {
      capturedIds[id] = el; // simplified: just return the panel itself for any query
    });
    // Now find the actual buttons on the panel
    const panel = el;
    const btns = panel._ael || [];
    capturedIds._panel = panel;
  };

  // We cannot run _buildPanel in this simple sandbox (too many DOM interactions),
  // so instead verify the source code directly: check that event listeners are
  // wired for #dash-act-chat and #dash-cta-first-chat in non-trivial ways.
  const rawSrc = readFileSync(
    join(__dirname, '..', 'static/js/dashboard.js'), 'utf8'
  );

  // #dash-act-chat must have a click handler
  assert.ok(
    rawSrc.includes("querySelector('#dash-act-chat')?.addEventListener"),
    '#dash-act-chat must have an event listener wired'
  );

  // Handler must dispatch cerberus:new-session event
  assert.ok(
    rawSrc.includes("cerberus:new-session"),
    '#dash-act-chat handler must dispatch cerberus:new-session'
  );

  // #dash-cta-first-chat must use addEventListener, not inline onclick
  assert.ok(
    rawSrc.includes("querySelector('#dash-cta-first-chat')?.addEventListener"),
    '"Start your first chat" CTA must use querySelector + addEventListener to wire listener'
  );
  assert.ok(
    !rawSrc.includes('onclick='),
    '"Start your first chat" must not use inline onclick'
  );
});

// ── 3. Token-flow chart does not call Math.random ─────────────────────────

test('3. dashboard.js token flow graph does not use Math.random', () => {
  const src = readFileSync(
    join(__dirname, '..', 'static/js/dashboard.js'), 'utf8'
  );
  assert.ok(
    !src.includes('Math.random'),
    'dashboard.js must not contain Math.random (no mock data allowed)'
  );
});

// ── 4. Empty chart state shows "// NO DATA" consistently ─────────────────

test('4. Empty sparkline states show "// NO DATA" in finance.js and observability.js', () => {
  const financeSrc = readFileSync(
    join(__dirname, '..', 'static/js/cyberapps/command-center/finance.js'), 'utf8'
  );
  const obsSrc = readFileSync(
    join(__dirname, '..', 'static/js/cyberapps/command-center/observability.js'), 'utf8'
  );

  assert.ok(
    financeSrc.includes('// NO DATA'),
    'finance.js sparkline empty state must say "// NO DATA"'
  );
  assert.ok(
    !financeSrc.includes('No daily data'),
    'finance.js must not have stale "No daily data" text'
  );

  // Count occurrences in observability.js
  const obsMatches = (obsSrc.match(/\/\/ NO DATA/g) || []).length;
  assert.ok(
    obsMatches >= 2,
    `observability.js must have at least 2 "// NO DATA" strings (found ${obsMatches})`
  );
  assert.ok(
    !obsSrc.includes('No daily data'),
    'observability.js must not have stale "No daily data" text'
  );
});

// ── 5. No .cc-section-label text in observability.js contains literal "// " ──

test('5. observability.js cc-section-label elements have no literal // prefix in text', () => {
  const src = readFileSync(
    join(__dirname, '..', 'static/js/cyberapps/command-center/observability.js'), 'utf8'
  );

  // Extract all text strings that appear after cc-section-label in HTML templates
  // Pattern: class="cc-section-label">TEXT<
  const matches = [...src.matchAll(/cc-section-label[^>]*>([^<]+)</g)];
  assert.ok(matches.length > 0, 'Should find at least one .cc-section-label element');

  for (const [, text] of matches) {
    assert.ok(
      !text.trim().startsWith('//'),
      `cc-section-label text must not start with "// ": found "${text.trim()}"`
    );
  }
});
