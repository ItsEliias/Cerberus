/**
 * cc-research.js — RESEARCH tab for the Command Center.
 *
 * Three view states share one container:
 *   .cc-research-form      — query + max_rounds + START
 *   .cc-research-progress  — step label + percent bar + CANCEL
 *   .cc-research-result    — findings text + sources + NEW RESEARCH
 *
 * Wire-protocol notes (verified against routes/research_routes.py):
 *
 *  - POST /api/research/start            { query, max_rounds, max_time? }
 *                                        → { session_id, status, query }
 *  - GET  /api/research/stream/{sid}     SSE; each event is `data: {json}`,
 *                                        terminal frame has `final: true`
 *                                        and `status` ∈ {complete,error,cancelled}
 *  - POST /api/research/result-peek/{sid} non-destructive — paired with the
 *                                        panel use case in the route docstring.
 *                                        (The plain /result endpoint clears
 *                                        the result after reading, which is
 *                                        wrong for an interactive panel.)
 *  - POST /api/research/cancel/{sid}
 *
 * The SSE payload shape from the handler is `{ ...progress, status }`. The
 * progress dict carries `{ phase, round, queries, total_sources,
 * total_findings }`. The spec said the wire would carry `step / percent`
 * directly; the reality is `phase` + `round`, so this module derives both
 * a step label and a percent from them. If the backend later starts emitting
 * `percent` explicitly, it wins.
 */

const PHASE_LABEL = {
  probing:   'PROBING MODEL',
  planning:  'PLANNING STRATEGY',
  searching: 'SEARCHING',
  reading:   'READING SOURCES',
  analyzing: 'ANALYZING FINDINGS',
  writing:   'WRITING REPORT',
  complete:  'COMPLETE',
  error:     'ERROR',
  cancelled: 'CANCELLED',
};

const PHASE_BASE_PCT = {
  probing:    5,
  planning:  15,
  searching: 35,
  reading:   55,
  analyzing: 75,
  writing:   92,
  complete: 100,
};

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

// ── Pure helpers (exposed for tests) ────────────────────────────────────

function _computeProgress(payload) {
  if (!payload || typeof payload !== 'object') return { percent: 0, label: 'INITIALISING' };
  const status = payload.status || '';
  if (status === 'complete')  return { percent: 100, label: PHASE_LABEL.complete };
  if (status === 'error')     return { percent: 0,   label: PHASE_LABEL.error };
  if (status === 'cancelled') return { percent: 0,   label: PHASE_LABEL.cancelled };
  // Explicit percent wins when supplied; clamp to [0, 100].
  if (Number.isFinite(payload.percent)) {
    return {
      percent: Math.max(0, Math.min(100, Math.round(payload.percent))),
      label:   PHASE_LABEL[payload.phase] || (payload.phase || 'RUNNING').toUpperCase(),
    };
  }
  const phase = payload.phase || '';
  const base  = PHASE_BASE_PCT[phase];
  if (base == null) return { percent: 0, label: 'INITIALISING' };
  // A modest within-phase nudge based on round count so the bar doesn't
  // stall during long searches.
  const round = Number(payload.round) || 0;
  const bump  = Math.min(8, round); // cap so we never overshoot the next phase base
  return { percent: Math.min(100, base + bump), label: PHASE_LABEL[phase] || phase.toUpperCase() };
}

function _sanitizeUrl(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const u = new URL(raw);
    return ALLOWED_URL_PROTOCOLS.has(u.protocol) ? u.toString() : '';
  } catch (_) { return ''; }
}

function _renderSources(listEl, sources) {
  if (!listEl) return 0;
  listEl.innerHTML = '';
  const arr = Array.isArray(sources) ? sources : [];
  if (!arr.length) {
    const empty = document.createElement('div');
    empty.className = 'cc-empty';
    empty.textContent = 'No sources.';
    listEl.appendChild(empty);
    return 0;
  }
  let rendered = 0;
  for (const s of arr) {
    const href  = _sanitizeUrl(s?.url);
    const title = String(s?.title || s?.url || '').trim();
    if (!href || !title) continue; // skip non-http(s) and untitled
    const a = document.createElement('a');
    a.className = 'cc-research-source';
    a.href      = href;
    a.target    = '_blank';
    a.rel       = 'noopener noreferrer';
    a.textContent = title;
    listEl.appendChild(a);
    rendered++;
  }
  if (!rendered) {
    const empty = document.createElement('div');
    empty.className = 'cc-empty';
    empty.textContent = 'No valid sources.';
    listEl.appendChild(empty);
  }
  return rendered;
}

function _showOnly(container, which) {
  const form     = container.querySelector('.cc-research-form');
  const progress = container.querySelector('.cc-research-progress');
  const result   = container.querySelector('.cc-research-result');
  if (form)     form.style.display     = which === 'form'     ? '' : 'none';
  if (progress) progress.style.display = which === 'progress' ? '' : 'none';
  if (result)   result.style.display   = which === 'result'   ? '' : 'none';
}

function _resetToForm(container) {
  _showOnly(container, 'form');
  const queryEl = container.querySelector('.cc-research-query');
  if (queryEl) queryEl.focus?.();
  const stepEl = container.querySelector('.cc-research-step-label');
  if (stepEl) stepEl.textContent = '// INITIALISING';
  const pctEl  = container.querySelector('.cc-research-pct');
  if (pctEl)  pctEl.textContent = '0%';
  const fillEl = container.querySelector('.cc-research-bar-fill');
  if (fillEl) fillEl.style.width = '0%';
}

// ── Build / load ───────────────────────────────────────────────────────

export function buildResearchTab() {
  return `
<div class="cc-research-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">DEEP RESEARCH</span>
  </div>

  <div class="cc-research-form">
    <textarea class="cc-research-query"
      placeholder="// enter research query..."
      rows="3" autocomplete="off" spellcheck="false"></textarea>
    <div class="cc-research-options">
      <label class="cc-research-label">MAX ROUNDS
        <select class="cc-research-rounds">
          <option value="0">AUTO</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </label>
    </div>
    <button class="cc-research-start-btn" type="button">// START RESEARCH</button>
    <div class="cc-research-error" id="cc-research-error" style="display:none"></div>
  </div>

  <div class="cc-research-progress" style="display:none">
    <div class="cc-research-step-label">// INITIALISING</div>
    <div class="cc-research-bar"><div class="cc-research-bar-fill"></div></div>
    <div class="cc-research-pct">0%</div>
    <button class="cc-research-cancel-btn" type="button">// CANCEL</button>
  </div>

  <div class="cc-research-result" style="display:none">
    <div class="cc-section-label">// FINDINGS</div>
    <div class="cc-research-result-body"></div>
    <div class="cc-section-label">// SOURCES</div>
    <div class="cc-research-sources"></div>
    <button class="cc-research-new-btn" type="button">// NEW RESEARCH</button>
  </div>
</div>`.trim();
}

export async function loadResearch(container) {
  const queryEl   = container.querySelector('.cc-research-query');
  const roundsEl  = container.querySelector('.cc-research-rounds');
  const startBtn  = container.querySelector('.cc-research-start-btn');
  const cancelBtn = container.querySelector('.cc-research-cancel-btn');
  const newBtn    = container.querySelector('.cc-research-new-btn');
  const stepEl    = container.querySelector('.cc-research-step-label');
  const fillEl    = container.querySelector('.cc-research-bar-fill');
  const pctEl     = container.querySelector('.cc-research-pct');
  const resultEl  = container.querySelector('.cc-research-result-body');
  const sourcesEl = container.querySelector('.cc-research-sources');
  const errorEl   = container.querySelector('#cc-research-error');

  let activeSessionId = null;
  let activeES        = null;

  function _setError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = `// ${msg}`;
      errorEl.style.display = 'block';
    } else {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }

  function _applyProgress(payload) {
    const { percent, label } = _computeProgress(payload);
    if (stepEl) stepEl.textContent = `// ${label}`;
    if (fillEl) fillEl.style.width = `${percent}%`;
    if (pctEl)  pctEl.textContent  = `${percent}%`;
  }

  function _teardownStream() {
    if (activeES) { try { activeES.close(); } catch (_) {} activeES = null; }
  }

  async function _fetchAndShowResult(sessionId) {
    try {
      const res = await fetch(`/api/research/result-peek/${encodeURIComponent(sessionId)}`, {
        method: 'POST', credentials: 'same-origin',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Untrusted content from the upstream model: never inject as HTML.
      // textContent escapes <script>, on* handlers, and stray markup.
      if (resultEl) resultEl.textContent = String(data?.result || '').trim() || 'No result.';
      _renderSources(sourcesEl, data?.sources || []);
      _showOnly(container, 'result');
    } catch (e) {
      _setError(`Could not fetch result — ${e.message}`);
      _showOnly(container, 'form');
    }
  }

  startBtn?.addEventListener('click', async () => {
    _setError('');
    const query = (queryEl?.value || '').trim();
    if (!query) { _setError('Enter a query first.'); return; }
    const maxRounds = parseInt(roundsEl?.value, 10) || 0;
    startBtn.disabled = true;
    try {
      const res = await fetch('/api/research/start', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, max_rounds: maxRounds }),
      });
      if (!res.ok) {
        const txt = await res.text();
        let detail = txt;
        try { detail = JSON.parse(txt).detail || txt; } catch (_) {}
        throw new Error(detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      activeSessionId = data?.session_id;
      if (!activeSessionId) throw new Error('No session_id in response.');
      _applyProgress({ status: 'running', phase: 'probing' });
      _showOnly(container, 'progress');

      activeES = new EventSource(`/api/research/stream/${encodeURIComponent(activeSessionId)}`);
      activeES.onmessage = (ev) => {
        let payload;
        try { payload = JSON.parse(ev.data); } catch (_) { return; }
        _applyProgress(payload);
        const st = payload?.status;
        if (st === 'complete') {
          _teardownStream();
          _fetchAndShowResult(activeSessionId);
        } else if (st === 'error' || st === 'cancelled' || st === 'not_found') {
          _teardownStream();
          _setError(payload?.error || `Research ${st || 'failed'}.`);
          _showOnly(container, 'form');
        }
      };
      activeES.onerror = () => {
        _teardownStream();
        _setError('Stream interrupted.');
        _showOnly(container, 'form');
      };
    } catch (e) {
      _setError(e.message || 'Failed to start research.');
      _showOnly(container, 'form');
    } finally {
      startBtn.disabled = false;
    }
  });

  cancelBtn?.addEventListener('click', async () => {
    _teardownStream();
    const sid = activeSessionId;
    activeSessionId = null;
    if (sid) {
      try {
        await fetch(`/api/research/cancel/${encodeURIComponent(sid)}`, {
          method: 'POST', credentials: 'same-origin',
        });
      } catch (_) { /* best-effort */ }
    }
    _resetToForm(container);
  });

  newBtn?.addEventListener('click', () => {
    _teardownStream();
    activeSessionId = null;
    if (queryEl) queryEl.value = '';
    _resetToForm(container);
  });

  // Keyboard ergonomics: Ctrl/Cmd+Enter inside the textarea triggers START.
  queryEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      startBtn?.click();
    }
  });
}

// ── Testables (consumed by tests/test_cc_research.test.mjs) ───────────

export const __testables = {
  PHASE_LABEL, PHASE_BASE_PCT, ALLOWED_URL_PROTOCOLS,
  _computeProgress, _sanitizeUrl, _renderSources, _resetToForm, _showOnly,
};
