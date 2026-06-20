/**
 * cc-compare.js — COMPARE tab for the Command Center.
 *
 * Lets the operator send one prompt to up to four agents concurrently and
 * watch their responses stream into side-by-side columns. Built on the
 * same SSE endpoint the 1:1 chat panel uses
 * (POST /api/agents/{id}/thread/send — verified against
 * routes/cerberus_agent_thread_routes.py line 6) so no new backend
 * routes are required.
 *
 * The picker (setup view) and the results grid share one container; the
 * RUN button switches between them. Each stream lives in its own
 * AbortController so a failure on column 2 never blocks columns 1/3/4.
 */

const MAX_AGENTS = 4;
const MIN_AGENTS = 2;

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// ── Pure helpers (exposed for tests) ───────────────────────────────────

/**
 * Toggle an id into/out of the selection set, respecting MAX_AGENTS.
 * Returns the new set so callers can keep state immutable.
 */
function _toggleSelection(selected, id) {
  const out = new Set(selected);
  if (out.has(id)) { out.delete(id); return out; }
  if (out.size >= MAX_AGENTS) return out;
  out.add(id);
  return out;
}

function _canRun(selected) {
  return selected.size >= MIN_AGENTS;
}

/**
 * Map the SSE `data:` payload to a delta string. The chat-thread route
 * encodes deltas under any of `delta`, `text`, `content`, and emits
 * `{type: "usage"}` frames we should ignore. Anything we can't parse as
 * JSON we treat as raw text so the column stays useful even when the
 * upstream model dumps freeform.
 */
function _decodeStreamLine(raw) {
  if (typeof raw !== 'string') return { delta: '', usage: null };
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[DONE]') return { delta: '', usage: null, done: trimmed === '[DONE]' };
  try {
    const obj = JSON.parse(trimmed);
    if (obj?.type === 'usage') return { delta: '', usage: obj };
    const delta = obj?.delta || obj?.text || obj?.content || '';
    return { delta: String(delta || ''), usage: null };
  } catch (_) {
    return { delta: trimmed, usage: null };
  }
}

// ── Build / load ───────────────────────────────────────────────────────

export function buildCompareTab() {
  return `
<div class="cc-compare-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">COMPARE</span>
  </div>

  <div class="cc-compare-setup" id="cc-compare-setup">
    <textarea class="cc-compare-prompt" id="cc-compare-prompt"
      placeholder="// enter prompt to send to all selected agents..."
      rows="3" autocomplete="off" spellcheck="false"></textarea>

    <div class="cc-compare-agent-picker">
      <div class="cc-section-label">// SELECT AGENTS (max ${MAX_AGENTS})</div>
      <div class="cc-compare-agent-grid" id="cc-compare-agent-grid">
        <div class="cc-empty">Loading agents…</div>
      </div>
      <div class="cc-compare-picker-hint" id="cc-compare-hint">
        Pick at least ${MIN_AGENTS} agents to enable RUN.
      </div>
    </div>

    <button class="cc-compare-run-btn" id="cc-compare-run-btn"
            type="button" disabled>// RUN COMPARISON</button>
  </div>

  <div class="cc-compare-results" id="cc-compare-results" style="display:none"></div>

  <div class="cc-compare-reset-row" id="cc-compare-reset-row" style="display:none">
    <button class="cc-compare-reset-btn" type="button">// NEW COMPARISON</button>
  </div>
</div>`.trim();
}

export async function loadCompareTab(container) {
  const setupEl   = container.querySelector('#cc-compare-setup');
  const promptEl  = container.querySelector('#cc-compare-prompt');
  const gridEl    = container.querySelector('#cc-compare-agent-grid');
  const hintEl    = container.querySelector('#cc-compare-hint');
  const runBtn    = container.querySelector('#cc-compare-run-btn');
  const resultsEl = container.querySelector('#cc-compare-results');
  const resetRow  = container.querySelector('#cc-compare-reset-row');
  const resetBtn  = container.querySelector('.cc-compare-reset-btn');

  let agents     = [];       // [{id, name, model_alias, ...}]
  let selected   = new Set();
  let controllers = [];      // AbortController per active column

  function _updateRunState() {
    const can = _canRun(selected);
    runBtn.disabled = !can;
    if (hintEl) {
      hintEl.textContent = can
        ? `${selected.size}/${MAX_AGENTS} agents selected — ready.`
        : `Pick at least ${MIN_AGENTS} agents to enable RUN. ` +
          `(${selected.size}/${MAX_AGENTS})`;
    }
  }

  function _renderPicker() {
    if (!agents.length) {
      gridEl.innerHTML = '<div class="cc-empty">No agents available.</div>';
      return;
    }
    gridEl.innerHTML = agents.map(a => {
      const isOn   = selected.has(a.id);
      const atCap  = !isOn && selected.size >= MAX_AGENTS;
      const cls    = `cc-compare-agent-chip${isOn ? ' selected' : ''}${atCap ? ' disabled' : ''}`;
      return `<button class="${cls}" type="button"
              data-id="${_esc(a.id)}" aria-pressed="${isOn ? 'true' : 'false'}"
              ${atCap ? 'disabled' : ''}>
        <span class="cc-compare-agent-chip-name">${_esc(a.name || a.id)}</span>
        ${a.model_alias ? `<span class="cc-compare-agent-chip-model">${_esc(a.model_alias)}</span>` : ''}
      </button>`;
    }).join('');
    gridEl.querySelectorAll('.cc-compare-agent-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        selected = _toggleSelection(selected, id);
        _renderPicker();
        _updateRunState();
      });
    });
  }

  async function _fetchAgents() {
    try {
      const r = await fetch('/api/agents', { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      agents = Array.isArray(data?.agents) ? data.agents : (Array.isArray(data) ? data : []);
      _renderPicker();
      _updateRunState();
    } catch (e) {
      gridEl.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
    }
  }

  function _buildResultsGrid(selectedAgents) {
    resultsEl.innerHTML = selectedAgents.map(a => `
<div class="cc-compare-col" data-agent-id="${_esc(a.id)}">
  <div class="cc-compare-col-header">
    <span class="cc-compare-agent-name">${_esc(a.name || a.id)}</span>
    <span class="cc-compare-status" data-state="streaming">// STREAMING</span>
  </div>
  <div class="cc-compare-col-body">
    <div class="cc-compare-bubble"></div>
  </div>
  <div class="cc-compare-col-footer">
    <span class="cc-compare-tokens">— tokens</span>
  </div>
</div>`.trim()).join('');
  }

  function _setColumnStatus(col, state, label) {
    const statusEl = col.querySelector('.cc-compare-status');
    if (!statusEl) return;
    statusEl.dataset.state = state;
    statusEl.textContent = label;
  }

  function _setColumnTokens(col, usage) {
    const tokensEl = col.querySelector('.cc-compare-tokens');
    if (!tokensEl) return;
    if (!usage) return;
    const total = (usage.total_tokens
                || (usage.input_tokens || 0) + (usage.output_tokens || 0)
                || usage.tokens || 0);
    if (total > 0) tokensEl.textContent = `${total.toLocaleString()} tokens`;
  }

  async function _streamOne(agent, prompt, controller) {
    const col = resultsEl.querySelector(`.cc-compare-col[data-agent-id="${CSS.escape(agent.id)}"]`);
    if (!col) return;
    const bubble = col.querySelector('.cc-compare-bubble');
    let usage = null;
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/thread/send`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: prompt }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let eventType = 'message';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) { eventType = 'message'; continue; }
          const raw = line.slice(5).trim();
          if (eventType === 'error') {
            try {
              const errObj = JSON.parse(raw);
              throw new Error(errObj.error || `Error: ${raw}`);
            } catch (e) {
              throw new Error(e.message || raw);
            }
          }
          const { delta, usage: u, done: streamDone } = _decodeStreamLine(raw);
          if (u) usage = u;
          if (delta && bubble) bubble.textContent += delta;
          if (streamDone) break;
          eventType = 'message';
        }
      }
      _setColumnStatus(col, 'done', '// DONE');
      _setColumnTokens(col, usage);
    } catch (e) {
      if (e?.name === 'AbortError') {
        _setColumnStatus(col, 'cancelled', '// CANCELLED');
        return;
      }
      _setColumnStatus(col, 'error', '// ERROR');
      if (bubble) {
        const msg = document.createElement('div');
        msg.className = 'cc-compare-error-line';
        msg.textContent = e?.message || 'Stream failed.';
        bubble.appendChild(msg);
      }
    }
  }

  function _resetToSetup() {
    // Abort anything still running so the next RUN starts clean.
    controllers.forEach(c => { try { c.abort(); } catch (_) {} });
    controllers = [];
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    resetRow.style.display  = 'none';
    setupEl.style.display   = '';
  }

  async function _run() {
    const prompt = (promptEl.value || '').trim();
    if (!prompt) {
      promptEl.focus();
      return;
    }
    if (!_canRun(selected)) return;

    const selectedAgents = agents.filter(a => selected.has(a.id));
    setupEl.style.display   = 'none';
    resultsEl.style.display = '';
    resetRow.style.display  = 'none';
    _buildResultsGrid(selectedAgents);

    controllers = selectedAgents.map(() => new AbortController());

    // Promise.all keeps the RAF straightforward; individual failures are
    // caught inside _streamOne and reported in their own column, so the
    // outer promise always resolves.
    await Promise.all(selectedAgents.map((a, i) => _streamOne(a, prompt, controllers[i])));
    resetRow.style.display = '';
  }

  // Wire events
  promptEl?.addEventListener('input', _updateRunState);
  runBtn?.addEventListener('click', _run);
  resetBtn?.addEventListener('click', _resetToSetup);

  await _fetchAgents();
}

// ── Exposed for tests/test_cc_compare.test.mjs ─────────────────────────

export const __testables = {
  MAX_AGENTS, MIN_AGENTS,
  _toggleSelection, _canRun, _decodeStreamLine,
};
