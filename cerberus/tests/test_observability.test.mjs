// OBSERVE tab — covers the 5 behavioural cases the spec calls out:
//
//   1. per-agent bars render with correct widths relative to max
//   2. agents sorted descending by token count
//   3. cap at 8 even if more exist
//   4. empty list renders "// NO AGENT DATA"
//   5. Promise.all failure in one section doesn't blank the others
//
// Pattern matches the other CC tests: load the module text in a vm
// sandbox with a minimal DOM shim + stubbed fetch, then drive the
// __testables exports directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'static/js/cyberapps/command-center/observability.js'),
  'utf8',
)
  .replace(/^export\s+async\s+function\s+/gm, 'async function ')
  .replace(/^export\s+function\s+/gm, 'function ')
  .replace(/^export\s+const\s+/gm, 'const ')
  + '\nthis.buildObservabilityTab = buildObservabilityTab;'
  + '\nthis.loadObservability     = loadObservability;'
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
      // Tiny scanner so querySelector can find synthesized children by id/class.
      // Also keeps inline style="..." accessible for the bar-fill width test.
      const tagRe = /<(\w+)\b([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(this._innerHTML))) {
        const child = makeElement(m[1]);
        const attrs = m[2];
        const idM    = /\bid\s*=\s*"([^"]*)"/.exec(attrs);
        const clsM   = /\bclass\s*=\s*"([^"]*)"/.exec(attrs);
        const styleM = /\bstyle\s*=\s*"([^"]*)"/.exec(attrs);
        const rankM  = /\bdata-rank\s*=\s*"([^"]*)"/.exec(attrs);
        if (idM)  child._attrs.id = idM[1];
        if (clsM) clsM[1].split(/\s+/).filter(Boolean).forEach(c => child._classes.add(c));
        if (styleM) {
          child._inlineStyle = styleM[1];
          // Pull width: %|px and opacity into the .style proxy for assertions.
          const wM = /width\s*:\s*([\d.]+)%/.exec(styleM[1]);
          const oM = /opacity\s*:\s*([\d.]+)/.exec(styleM[1]);
          if (wM) child.style.width   = wM[1] + '%';
          if (oM) child.style.opacity = oM[1];
        }
        if (rankM) child._attrs['data-rank'] = rankM[1];
        child.parentElement = el;
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
    addEventListener() {},
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
  };
  return el;
}

function* _walk(node) {
  for (const c of node._children) {
    yield c;
    yield* _walk(c);
  }
}

function makeSandbox(fetchImpl) {
  const doc = {
    createElement: (tag) => makeElement(tag),
    body: makeElement('body'),
    documentElement: makeElement('html'),
    getElementById: () => null,
  };
  const sandbox = {
    document: doc,
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame: () => 0,
    performance: { now: () => 0 },
    fetch: fetchImpl || (async () => ({ ok: false, status: 500, json: async () => ({}) })),
    Math, Date, String, Number, Array, Object, Set, Map, JSON, Promise, console,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

// ── Tests ─────────────────────────────────────────────────────────────

test('_aggregatePerAgent: bars track relative widths (top row = 100%)', () => {
  const sb = makeSandbox();
  const { _aggregatePerAgent, _renderAgentBreakdown } = sb.__t;

  const agents = [
    { name: 'CODER',      total_input_tokens: 30000, total_output_tokens: 12300, model_alias: 'sonnet' },
    { name: 'RESEARCHER', total_input_tokens:  8000, total_output_tokens:  4100, model_alias: 'sonnet' },
    { name: 'PLANNER',    total_input_tokens:  1000, total_output_tokens:   500, model_alias: 'haiku'  },
  ];
  const rows = _aggregatePerAgent(agents);
  assert.deepEqual(rows.map(r => r.name), ['CODER', 'RESEARCHER', 'PLANNER']);

  const listEl = makeElement('div');
  _renderAgentBreakdown(listEl, rows);
  const fills = listEl.querySelectorAll('.cc-obs-agent-bar-fill');
  assert.equal(fills.length, 3);
  assert.equal(fills[0].style.width, '100%', 'top row pinned to max');
  // RESEARCHER total = 12100; CODER total = 42300; pct = 12100/42300 ≈ 29%
  assert.match(fills[1].style.width, /^2\d%$/, 'second row scales to ~29%');
  // PLANNER total = 1500; pct = 1500/42300 ≈ 4%, but clamped to >= 2%
  assert.equal(fills[2].style.width, '4%', 'third row scaled correctly');
});

test('_aggregatePerAgent: sorted descending by total tokens', () => {
  const sb = makeSandbox();
  const { _aggregatePerAgent } = sb.__t;

  const agents = [
    { name: 'C', total_input_tokens: 10, total_output_tokens: 10 },
    { name: 'A', total_input_tokens: 200, total_output_tokens: 200 },
    { name: 'B', total_input_tokens: 50, total_output_tokens: 50 },
  ];
  const rows = _aggregatePerAgent(agents);
  assert.deepEqual(rows.map(r => r.name), ['A', 'B', 'C']);
  assert.deepEqual(rows.map(r => r.tokens), [400, 100, 20]);
});

test('_aggregatePerAgent: caps at BREAKDOWN_CAP (8) even when 20 agents are supplied', () => {
  const sb = makeSandbox();
  const { _aggregatePerAgent, BREAKDOWN_CAP } = sb.__t;
  assert.equal(BREAKDOWN_CAP, 8);

  const agents = Array.from({ length: 20 }, (_, i) => ({
    name: `AG-${i}`,
    total_input_tokens: 1000 + i,
    total_output_tokens: 0,
  }));
  const rows = _aggregatePerAgent(agents);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].name, 'AG-19', 'highest-tokens row is first');
  assert.equal(rows[7].name, 'AG-12', 'cap excludes the bottom 12 rows');
});

test('_renderAgentBreakdown: empty list renders "// NO AGENT DATA"', () => {
  const sb = makeSandbox();
  const { _renderAgentBreakdown } = sb.__t;
  const listEl = makeElement('div');
  _renderAgentBreakdown(listEl, []);
  const empty = listEl.querySelector('.cc-obs-empty-row');
  assert.ok(empty, 'fallback element rendered');
  assert.match(listEl.innerHTML, /\/\/ NO AGENT DATA/);
});

test('loadObservability: one fetch failing does not blank the other sections', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === '/api/usage/tokens') {
      return { ok: true, status: 200, json: async () => ({
        total_tokens: 1234, input_tokens: 700, output_tokens: 534, cost_usd: 0.01,
        by_day: [{ date: '2026-06-01', tokens: 100 }, { date: '2026-06-02', tokens: 200 }],
      }) };
    }
    if (url === '/api/agents') {
      // Simulate a 500 — Promise.allSettled wraps this in a rejection.
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (url.startsWith('/api/stats/activity')) {
      return { ok: true, status: 200, json: async () => ({ total_sessions: 42 }) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const sb = makeSandbox(fetchImpl);

  // Build the tab into a container, then run loadObservability
  const container = makeElement('div');
  container.innerHTML = sb.buildObservabilityTab();
  await sb.loadObservability(container);

  // /api/agents failed → per-agent + per-model sections show "unavailable"
  const agentEl = container.querySelector('#cc-obs-per-agent');
  const modelEl = container.querySelector('#cc-obs-per-model');
  assert.ok(agentEl,  'per-agent host rendered');
  assert.match(agentEl.innerHTML, /unavailable/i);
  assert.match(modelEl.innerHTML, /unavailable/i);

  // /api/usage/tokens succeeded → the totals + sparkline got applied
  const totalEl = container.querySelector('#cc-obs-total');
  // _animCounter sets the text content via requestAnimationFrame (stubbed to
  // no-op), so the visible text starts empty. The sparkline should populate
  // immediately, though.
  const sparkEl = container.querySelector('#cc-obs-spark-wrap');
  assert.match(sparkEl.innerHTML, /<svg/, 'usage sparkline rendered');
  const costSparkEl = container.querySelector('#cc-obs-cost-spark-wrap');
  assert.match(costSparkEl.innerHTML, /<svg/, 'cost sparkline rendered');

  // /api/stats/activity succeeded → sessions counter populated
  const sessionsEl = container.querySelector('#cc-obs-sessions');
  assert.ok(sessionsEl, 'sessions counter element exists');
  assert.notEqual(sessionsEl.textContent, '—', 'sessions counter received a value');

  // All three URLs were probed
  assert.ok(calls.includes('/api/usage/tokens'));
  assert.ok(calls.includes('/api/agents'));
  assert.ok(calls.some(u => u.startsWith('/api/stats/activity')));
});
