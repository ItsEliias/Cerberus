/**
 * agents.js — AGENTS tab for Command Center.
 * Variant A — Dense Roster Table: compact columnar rows grouped by category,
 * expand-on-click detail panel with inline invoke + edit + memory.
 */

import { openAgentChat } from './chat.js';

// ---------------------------------------------------------------------------
// Category collapse-state persistence (localStorage)
// ---------------------------------------------------------------------------

const COLLAPSED_KEY = 'cerberus.agents.collapsed';

function _readCollapsedCats() {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(x => typeof x === 'string') : [];
  } catch (_) { return []; }
}

function _writeCollapsedCats(cats) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...new Set(cats)]));
  } catch (_) { /* private browsing / quota — silent */ }
}

function _applyCollapsedState(container) {
  const collapsed = new Set(_readCollapsedCats());
  if (!collapsed.size) return;
  container.querySelectorAll('.cc-cat-section').forEach(sec => {
    if (collapsed.has(sec.dataset.cat || '')) sec.classList.add('collapsed');
  });
}

function _toggleCollapsedFor(sec) {
  if (!sec) return;
  const cat = sec.dataset.cat || '';
  if (!cat) return;
  const cats = new Set(_readCollapsedCats());
  if (sec.classList.contains('collapsed')) cats.add(cat);
  else cats.delete(cat);
  _writeCollapsedCats([...cats]);
}

// ---------------------------------------------------------------------------
// Prompt-testing history (localStorage, per agent)
// ---------------------------------------------------------------------------
//
// Each agent's last `INVOKE_HISTORY_MAX` invocations are stashed under
// `cerberus.invoke.history.{agentId}` as an array of {prompt, response,
// timestamp}. The store is a convenience — failures (private browsing,
// quota, malformed JSON) are swallowed and treated as "no history".
//
// Constants live above the __testables export below because `const`
// declarations aren't hoisted into the TDZ window the way function
// declarations are.

const INVOKE_HISTORY_KEY_PREFIX = 'cerberus.invoke.history.';
const INVOKE_HISTORY_MAX = 5;
const INVOKE_PROMPT_PREVIEW = 40;

export const __testables = {
  COLLAPSED_KEY,
  _readCollapsedCats, _writeCollapsedCats, _applyCollapsedState, _toggleCollapsedFor,
  // Memory viewer helpers (exposed for tests/test_agent_memory_viewer.test.mjs).
  // Function declarations are hoisted, so referencing them up here is safe even
  // though their bodies live further down the module.
  _filterMemoriesForAgent, _memMatchesQuery, _applyMemorySearch,
  _setMemCount, _setMemFallbackNote, _renderMemoryRow, _loadAgentMemories,
  // Prompt-testing helpers (tests/test_invoke_history.test.mjs).
  INVOKE_HISTORY_KEY_PREFIX, INVOKE_HISTORY_MAX,
  _invokeHistoryKey, _readInvokeHistory, _writeInvokeHistory,
  _appendInvokeHistory, _clearInvokeHistory,
  _diffResponses, _buildExportMarkdown,
};

function _invokeHistoryKey(agentId) {
  return INVOKE_HISTORY_KEY_PREFIX + String(agentId || '');
}

function _readInvokeHistory(agentId) {
  try {
    const raw = localStorage.getItem(_invokeHistoryKey(agentId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(e =>
      e && typeof e === 'object'
      && typeof e.prompt === 'string'
      && typeof e.response === 'string',
    );
  } catch (_) { return []; }
}

function _writeInvokeHistory(agentId, entries) {
  try {
    localStorage.setItem(
      _invokeHistoryKey(agentId),
      JSON.stringify(entries),
    );
  } catch (_) { /* quota / private browsing — silent */ }
}

function _appendInvokeHistory(agentId, entry) {
  const cleaned = {
    prompt:    String(entry?.prompt    ?? '').trim(),
    response:  String(entry?.response  ?? ''),
    timestamp: entry?.timestamp ?? new Date().toISOString(),
  };
  if (!cleaned.prompt) return _readInvokeHistory(agentId);
  const history = _readInvokeHistory(agentId);
  // Newest-first. Drop the oldest when we'd exceed the cap so each agent
  // keeps a tight rolling window — the spec's "max 5, drop oldest" rule.
  history.unshift(cleaned);
  while (history.length > INVOKE_HISTORY_MAX) history.pop();
  _writeInvokeHistory(agentId, history);
  return history;
}

function _clearInvokeHistory(agentId) {
  try {
    localStorage.removeItem(_invokeHistoryKey(agentId));
  } catch (_) { /* silent */ }
}

// Hand-rolled, line-based diff. Returns a list of {kind, text} ops where
// `kind` is one of "ctx" (unchanged), "add" (only in `current`), "rem"
// (only in `prior`). Greedy LCS — O(n·m) where n,m are line counts; fine
// for the ≤5×short-response payloads we work with here.
function _diffResponses(prior, current) {
  const a = String(prior   ?? '').split('\n');
  const b = String(current ?? '').split('\n');
  const n = a.length, m = b.length;
  // LCS table; default-zero borders so the backtrack handles either-empty.
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ kind: 'ctx', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'rem', text: a[i] }); i++;
    } else {
      ops.push({ kind: 'add', text: b[j] }); j++;
    }
  }
  while (i < n) { ops.push({ kind: 'rem', text: a[i] }); i++; }
  while (j < m) { ops.push({ kind: 'add', text: b[j] }); j++; }
  return ops;
}

// Render the Markdown export body for the agent's last invocations.
function _buildExportMarkdown(agentName, entries) {
  const name = String(agentName || 'AGENT');
  const lines = [`# AGENT: ${name} — Invocation History`, ''];
  if (!entries || !entries.length) {
    lines.push('_No invocations recorded._');
    return lines.join('\n') + '\n';
  }
  for (const e of entries) {
    const ts = e?.timestamp || '';
    lines.push(`## ${ts}`);
    lines.push('');
    lines.push(`**Prompt:** ${String(e?.prompt    ?? '')}`);
    lines.push('');
    lines.push(`**Response:** ${String(e?.response ?? '')}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

// ---------------------------------------------------------------------------
// Voice picker — lazily fetched from /api/tts/voices, cached for session
// ---------------------------------------------------------------------------

let _voicesCache = null;   // null = not yet fetched; [] = fetched (may be empty)
let _voicesFetch = null;   // in-flight promise dedup

async function _getVoices() {
  if (_voicesCache !== null) return _voicesCache;
  if (_voicesFetch) return _voicesFetch;
  _voicesFetch = fetch('/api/tts/voices', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : { voices: [] })
    .then(d => { _voicesCache = d.voices || []; _voicesFetch = null; return _voicesCache; })
    .catch(() => { _voicesCache = []; _voicesFetch = null; return _voicesCache; });
  return _voicesFetch;
}

async function _populateVoiceSelect(selectEl, currentVoice) {
  const voices = await _getVoices();
  const prev = selectEl.value;
  selectEl.innerHTML = '<option value="">— none —</option>' +
    voices.map(v => {
      const label = `${v.name} (${v.lang}, ${v.gender})`;
      const sel   = v.id === (currentVoice || prev) ? ' selected' : '';
      return `<option value="${_esc(v.id)}"${sel}>${_esc(label)}</option>`;
    }).join('');
  if (!voices.length) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'Kokoro not installed — enter voice ID manually';
    selectEl.appendChild(opt);
  }
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

const STATUS_META = {
  active:  { label: 'ACTIVE'   },
  idle:    { label: 'IDLE'     },
  alert:   { label: 'ALERT'    },
  standby: { label: 'STANDBY'  },
  ready:   { label: 'READY'    },
};
function _statusLabel(status) {
  return (STATUS_META[status] || { label: (status || 'UNKNOWN').toUpperCase() }).label;
}

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_MAP = {
  ORCHESTRATOR: 'COORDINATOR',
  ARCHITECT: 'CORE', CODER: 'CORE', TESTER: 'CORE', RESEARCHER: 'CORE', REVIEWER: 'CORE',
  SECURITY: 'SECURITY',
  DEVOPS: 'OPS', DEBUGGER: 'OPS', PLANNER: 'OPS',
  'DATA-ANALYST': 'DATA', LIBRARIAN: 'DATA', OPTIMIZER: 'DATA',
  SCRIBE: 'COMMS', DESIGNER: 'COMMS', PROMPTSMITH: 'COMMS',
};

const CAT_ACCENT = {
  COORDINATOR: '#c0392b',
  CORE:        '#3498db',
  SECURITY:    '#e74c3c',
  OPS:         '#e67e22',
  DATA:        '#2ecc71',
  COMMS:       '#9b59b6',
  CUSTOM:      'rgba(197,201,208,0.45)',
};

const CAT_ORDER = ['COORDINATOR', 'CORE', 'SECURITY', 'OPS', 'DATA', 'COMMS', 'CUSTOM'];

function _getCategory(name) {
  return CATEGORY_MAP[(name || '').toUpperCase()] || 'CUSTOM';
}

const GLYPH_MAP = {
  ARCHITECT:     '🏗',
  CODER:         '⚡',
  TESTER:        '🧪',
  RESEARCHER:    '🔍',
  REVIEWER:      '✅',
  SECURITY:      '🛡',
  ORCHESTRATOR:  '🎯',
  DEVOPS:        '⚙',
  DEBUGGER:      '🐛',
  PLANNER:       '📋',
  'DATA-ANALYST':'📊',
  LIBRARIAN:     '📚',
  OPTIMIZER:     '⚡',
  SCRIBE:        '✍',
  DESIGNER:      '🎨',
  PROMPTSMITH:   '🔧',
};


function _groupAgents(agents) {
  const groups = {};
  for (const a of agents) {
    const cat = _getCategory(a.name);
    (groups[cat] = groups[cat] || []).push(a);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Row HTML
// ---------------------------------------------------------------------------

function _agentRow(agent) {
  _ensureHealthStyles();
  const id     = _esc(agent.id);
  const status = agent.status || 'idle';
  const glyph  = _esc(agent.avatar || GLYPH_MAP[(agent.name || '').toUpperCase()] || (agent.name || '?')[0]);
  const score  = agent.score > 0 ? _esc(agent.score) : '—';
  const accent = CAT_ACCENT[_getCategory(agent.name)] || CAT_ACCENT.CUSTOM;
  const health = String(agent.health_status || 'ok').toLowerCase();
  const healthTitle = `Health: ${health.toUpperCase()}`
                    + (agent.error_count ? ` (${agent.error_count} errors)` : '');
  const roleLower  = (agent.role || agent.agent_type || '').toLowerCase();
  const modelAlias = agent.model_alias || '—';
  const isDupModel = modelAlias !== '—' && modelAlias.toLowerCase() === roleLower;
  const modelClass = isDupModel ? 'cc-row-model cc-row-model--dup' : 'cc-row-model';
  return `
<div class="cc-agent-row" data-id="${id}" data-status="${_esc(status)}" data-agent-name="${_esc(agent.name || '')}" data-agent-avatar="${_esc(agent.avatar || '')}" data-cat-accent="${_esc(accent)}" data-tts-voice="${_esc(agent.tts_voice || '')}">
  <span class="cc-status-pip ${_esc(status)}"></span>
  <span class="cc-row-sigil-cell">
    <span class="cc-health-dot cc-health-dot--${_esc(health)}" title="${_esc(healthTitle)}" aria-label="${_esc(healthTitle)}"></span>
    <span class="cc-row-sigil">${glyph}</span>
  </span>
  <span class="cc-row-name-cell">
    <span class="cc-row-name">${_esc(agent.name || agent.id)}</span>
    ${agent.is_custom ? '<span class="cc-row-custom-badge" title="Custom agent">CUSTOM</span>' : ''}
    ${(agent.pinned_skills && agent.pinned_skills.length)
        ? `<span class="cc-row-skills-chip" title="Pinned skills: ${_esc(agent.pinned_skills.join(', '))}">📎 ${agent.pinned_skills.length}</span>`
        : ''}
  </span>
  <span class="cc-row-role">${_esc(agent.role || agent.agent_type || '—')}</span>
  <span class="${modelClass}">${_esc(modelAlias)}</span>
  <span class="cc-row-score">${score}</span>
  <span class="cc-row-actions">
    <span class="cc-ag-invoke-count" title="Total invocations">↑${_esc(agent.invocation_count || 0)}</span>
    <button class="cc-row-btn cc-row-btn-chat" -webkit-appearance="none">Chat</button>
    <button class="cc-row-btn cc-row-btn-invoke" -webkit-appearance="none">Run</button>
    <div class="cc-overflow-wrap">
      <button class="cc-row-btn cc-row-btn-overflow" -webkit-appearance="none">···</button>
      <div class="cc-overflow-menu" id="cc-ov-${id}">
        <button class="cc-overflow-item cc-ov-call">📞 Call</button>
        <button class="cc-overflow-item cc-ov-memory">◎ Memory</button>
        <button class="cc-overflow-item cc-ov-edit">✎ Edit</button>
        <button class="cc-overflow-item cc-ov-delete danger">✕ Delete</button>
      </div>
    </div>
  </span>
</div>`.trim();
}

function _agentDetail(agent) {
  const id     = _esc(agent.id);
  const status = agent.status || 'idle';
  const label  = _statusLabel(status);
  const inTok  = agent.total_input_tokens  || 0;
  const outTok = agent.total_output_tokens || 0;
  const lastAt = agent.last_active_at
    ? new Date(agent.last_active_at + 'Z').toLocaleString() : null;
  const snip   = (agent.system_prompt || '').slice(0, 180);
  const more   = (agent.system_prompt || '').length > 180;
  const health    = String(agent.health_status || 'ok').toLowerCase();
  const errCount  = Number(agent.error_count || 0);
  const lastErrAt = agent.last_error_at
    ? new Date(agent.last_error_at + 'Z').toLocaleString() : '';
  const lastErrTxt = String(agent.last_error || '').slice(0, 100);
  const lastErrMore = String(agent.last_error || '').length > 100 ? '…' : '';
  return `
<div class="cc-agent-detail" id="cc-detail-${id}">
  <div class="cc-detail-grid">
    <div class="cc-detail-section">
      <div class="cc-detail-header-row">
        <span class="cc-detail-status ${_esc(status)}">● ${label}</span>
        <span class="cc-detail-tokens">↑ ${inTok.toLocaleString()} ↓ ${outTok.toLocaleString()}</span>
        ${lastAt ? `<span class="cc-detail-last-active">${_esc(lastAt)}</span>` : ''}
      </div>
      <div class="cc-detail-label">System Prompt</div>
      <div class="cc-detail-prompt">${_esc(snip)}${more ? '…' : ''}</div>
    </div>
    <div class="cc-detail-section">
      <div class="cc-detail-label">Quick Actions</div>
      <div class="cc-detail-actions">
        <button class="cc-detail-btn cc-detail-btn-primary cc-detail-chat-btn">Chat ›</button>
        <button class="cc-detail-btn cc-detail-btn-primary cc-detail-invoke-btn">Invoke ›</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-call-btn">📞 Call</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-memory-btn">◎ Memory</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-edit-btn">✎ Edit</button>
        <button class="cc-detail-btn cc-detail-btn-secondary cc-detail-btn-danger cc-detail-delete-btn">✕ Del</button>
      </div>
      <div class="cc-ag-invoke-form" id="cc-ag-invoke-${id}" style="display:none">
        <textarea class="cc-ag-invoke-input" placeholder="Enter prompt…" rows="3"></textarea>
        <div class="cc-ag-invoke-actions">
          <button class="cc-ag-submit-btn" data-agent-id="${id}">Send</button>
          <button class="cc-ag-cancel-btn" data-agent-id="${id}">Cancel</button>
          <button class="cc-invoke-export-btn" data-agent-id="${id}" type="button" title="Download last 5 invocations as Markdown">// EXPORT</button>
        </div>
        <div class="cc-ag-result" id="cc-ag-result-${id}"></div>
        <div class="cc-invoke-history" id="cc-invoke-history-${id}">
          <div class="cc-invoke-hist-head">
            <span class="cc-section-label">// RECENT INVOCATIONS</span>
            <button class="cc-invoke-hist-clear" data-agent-id="${id}" type="button">// CLEAR HISTORY</button>
          </div>
          <div class="cc-invoke-hist-list" id="cc-invoke-hist-list-${id}"></div>
        </div>
      </div>
    </div>
    <div class="cc-detail-section cc-health-section" id="cc-health-${id}">
      <div class="cc-detail-label">// HEALTH</div>
      <div class="cc-health-row">
        <span class="cc-health-dot cc-health-dot--${_esc(health)}"></span>
        <span class="cc-health-label">Status: <strong>${_esc(health.toUpperCase())}</strong></span>
        <span class="cc-health-counts">Errors: <strong>${errCount}</strong> lifetime</span>
      </div>
      ${lastErrTxt ? `<div class="cc-health-lasterr" title="${_esc(agent.last_error || '')}">Last error: ${_esc(lastErrTxt)}${lastErrMore}${lastErrAt ? ` <span class="cc-health-when">at ${_esc(lastErrAt)}</span>` : ''}</div>` : ''}
      <div class="cc-health-actions">
        <button class="cc-health-reset-btn" data-agent-id="${id}" type="button">[ RESET HEALTH ]</button>
      </div>
      <div class="cc-health-msg" id="cc-health-msg-${id}" hidden></div>
    </div>
  </div>
  <div class="cc-ag-memory-panel" id="cc-ag-memory-${id}" style="display:none">
    <div class="cc-ag-memory-header">
      <span class="cc-ag-memory-title">
        <span class="cc-ag-mem-title-prefix">//</span>
        MEMORY — <span class="cc-ag-mem-title-agent">${_esc((agent.name || '').toUpperCase() || 'AGENT')}</span>
      </span>
      <button class="cc-ag-memory-close-btn" data-agent-id="${id}">✕</button>
    </div>
    <div class="cc-ag-mem-fallback-note" id="cc-ag-mem-fallback-${id}" style="display:none">(showing recent memories — none tagged to this agent)</div>
    <input class="cc-ag-mem-search-input" id="cc-ag-mem-search-${id}"
           data-agent-id="${id}"
           type="search" autocomplete="off" spellcheck="false"
           placeholder="// search memories"
           aria-label="Search this agent's memories"
           style="-webkit-appearance:none;appearance:none">
    <div class="cc-ag-memory-list" id="cc-ag-memory-list-${id}"></div>
    <div class="cc-ag-mem-footer">
      <span class="cc-ag-mem-count" id="cc-ag-mem-count-${id}">0 entries</span>
    </div>
  </div>
  <div class="cc-ag-edit-form" id="cc-ag-edit-${id}" style="display:none">
    <label>Avatar (emoji)</label>
    <input class="cc-ag-edit-avatar"     value="${_esc(agent.avatar || '')}" placeholder="🤖" maxlength="4">
    <label>Name</label>
    <input class="cc-ag-edit-name"       value="${_esc(agent.name || '')}" placeholder="Agent name">
    <label>Role</label>
    <input class="cc-ag-edit-role"       value="${_esc(agent.role || '')}" placeholder="e.g. coder">
    <label>Type</label>
    <input class="cc-ag-edit-agent-type" value="${_esc(agent.agent_type || '')}" placeholder="e.g. backend-dev">
    <label>Model alias</label>
    <input class="cc-ag-edit-model"      value="${_esc(agent.model_alias || 'default')}" placeholder="default">
    <label>TTS voice (optional)</label>
    <select class="cc-ag-edit-tts-voice" data-current="${_esc(agent.tts_voice || '')}">
      <option value="">— loading voices… —</option>
    </select>
    <label>System prompt</label>
    <textarea class="cc-ag-edit-prompt" rows="5">${_esc(agent.system_prompt || '')}</textarea>
    <label class="cc-ag-edit-skills-label">// PINNED SKILLS</label>
    <div class="cc-ag-edit-skills" id="cc-ag-edit-skills-${id}"
         data-current="${_esc((agent.pinned_skills || []).join(','))}">
      <div class="cc-empty">Loading skills…</div>
    </div>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-save-btn"    data-agent-id="${id}">Save</button>
      <button class="cc-ag-discard-btn" data-agent-id="${id}">Cancel</button>
    </div>
    <div class="cc-ag-edit-msg" id="cc-ag-edit-msg-${id}"></div>
  </div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function _createForm() {
  return `
<div class="cc-ag-create-form" id="cc-ag-create-form" style="display:none">
  <div class="cc-ag-create-title">New Agent</div>
  <label>Avatar (emoji)</label>
  <input id="cc-create-avatar"  placeholder="🤖" maxlength="4">
  <label>Name <span class="cc-req">*</span></label>
  <input id="cc-create-name"    placeholder="AGENT-NAME">
  <label>Role <span class="cc-req">*</span></label>
  <input id="cc-create-role"    placeholder="e.g. coder">
  <label>Agent type <span class="cc-req">*</span></label>
  <input id="cc-create-type"    placeholder="e.g. backend-dev">
  <label>Model alias</label>
  <input id="cc-create-model"   placeholder="default" value="default">
  <label>System prompt <span class="cc-req">*</span></label>
  <textarea id="cc-create-prompt" rows="5" placeholder="You are …"></textarea>
  <div class="cc-ag-invoke-actions">
    <button id="cc-create-submit" class="cc-detail-btn cc-detail-btn-primary">Create</button>
    <button id="cc-create-cancel" class="cc-detail-btn cc-detail-btn-secondary">Cancel</button>
  </div>
  <div id="cc-create-msg" class="cc-ag-edit-msg"></div>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _toggleDetail(row, detail) {
  const open = detail.classList.toggle('open');
  row.classList.toggle('expanded', open);
  row.classList.toggle('is-active', open);
}

function _openChat(container, row, agentId) {
  const name   = row.dataset.agentName   || agentId;
  const avatar = row.dataset.agentAvatar || '';
  const accent = row.dataset.catAccent   || 'rgba(197,201,208,0.5)';
  const voice  = row.dataset.ttsVoice    || '';
  openAgentChat(container, agentId, name, avatar, accent, voice);
}

async function _openCall(container, row, agentId) {
  const name   = row.dataset.agentName   || agentId;
  const avatar = row.dataset.agentAvatar || '';
  const accent = row.dataset.catAccent   || 'rgba(197,201,208,0.5)';
  const voice  = row.dataset.ttsVoice    || '';
  const { openVoiceCall } = await import('./voice.js');
  openVoiceCall(container, agentId, name, avatar, accent, voice);
}

// ---------------------------------------------------------------------------
// Voice picker init — called once when the edit form is first shown
// ---------------------------------------------------------------------------

function _initEditVoicePicker(editForm) {
  const sel = editForm.querySelector('.cc-ag-edit-tts-voice');
  if (!sel || sel.dataset.voiceLoaded) return;
  sel.dataset.voiceLoaded = '1';
  const current = sel.dataset.current || '';
  _populateVoiceSelect(sel, current);
  // Pinned skills picker lives alongside the voice picker — both lazy-loaded
  // the first time the edit form opens.
  _initEditSkillsPicker(editForm);
}

// Skills cache — lazily fetched once per session.
let _skillsCache = null;
let _skillsFetch = null;
async function _getSkills() {
  if (_skillsCache !== null) return _skillsCache;
  if (_skillsFetch) return _skillsFetch;
  _skillsFetch = fetch('/api/skills', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : { skills: [] })
    .then(d => { _skillsCache = d.skills || []; _skillsFetch = null; return _skillsCache; })
    .catch(() => { _skillsCache = []; _skillsFetch = null; return _skillsCache; });
  return _skillsFetch;
}

async function _initEditSkillsPicker(editForm) {
  const wrap = editForm.querySelector('.cc-ag-edit-skills');
  if (!wrap || wrap.dataset.skillsLoaded) return;
  wrap.dataset.skillsLoaded = '1';
  const current = new Set((wrap.dataset.current || '').split(',').filter(Boolean));
  const skills = await _getSkills();
  if (!skills.length) {
    wrap.innerHTML = '<div class="cc-empty">No skills configured.</div>';
    return;
  }
  wrap.innerHTML = skills.map(sk => {
    const name = sk.name || sk.id || '';
    if (!name) return '';
    const desc = (sk.description || sk.problem || '').slice(0, 80);
    const checked = current.has(name) ? 'checked' : '';
    return `<label class="cc-ag-edit-skill">
      <input type="checkbox" class="cc-ag-edit-skill-cb" value="${_esc(name)}" ${checked}>
      <span class="cc-ag-edit-skill-name">${_esc(name)}</span>
      ${desc ? `<span class="cc-ag-edit-skill-desc">${_esc(desc)}</span>` : ''}
    </label>`;
  }).join('');
}

function _readPinnedSkillsFromForm(editForm) {
  if (!editForm) return [];
  return [...editForm.querySelectorAll('.cc-ag-edit-skill-cb')]
    .filter(cb => cb.checked)
    .map(cb => cb.value)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Wire a single row + detail pair
// ---------------------------------------------------------------------------

function _wireRow(container, agentId) {
  const row    = container.querySelector(`.cc-agent-row[data-id="${agentId}"]`);
  const detail = container.querySelector(`#cc-detail-${agentId}`);
  if (!row || !detail) return;

  // Row body click → expand/collapse detail
  row.addEventListener('click', e => {
    if (e.target.closest('.cc-row-actions')) return;
    _toggleDetail(row, detail);
  });

  // Row: Chat
  row.querySelector('.cc-row-btn-chat')?.addEventListener('click', () => {
    _openChat(container, row, agentId);
  });

  // Row: Run → open detail + toggle invoke form
  row.querySelector('.cc-row-btn-invoke')?.addEventListener('click', () => {
    if (!detail.classList.contains('open')) _toggleDetail(row, detail);
    const invForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (invForm) invForm.style.display = invForm.style.display === 'none' ? 'block' : 'none';
  });

  // Row: Overflow menu
  const overflowBtn  = row.querySelector('.cc-row-btn-overflow');
  const overflowMenu = row.querySelector(`#cc-ov-${agentId}`);
  if (overflowBtn && overflowMenu) {
    overflowBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = overflowMenu.classList.toggle('open');
      if (isOpen) {
        const close = () => { overflowMenu.classList.remove('open'); document.removeEventListener('click', close); };
        document.addEventListener('click', close);
      }
    });
    overflowMenu.querySelector('.cc-ov-call')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      _openCall(container, row, agentId);
    });
    overflowMenu.querySelector('.cc-ov-memory')?.addEventListener('click', async () => {
      overflowMenu.classList.remove('open');
      if (!detail.classList.contains('open')) _toggleDetail(row, detail);
      const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
      const memList  = detail.querySelector(`#cc-ag-memory-list-${agentId}`);
      if (!memPanel) return;
      const wasOpen = memPanel.style.display !== 'none';
      memPanel.style.display = wasOpen ? 'none' : 'block';
      if (!wasOpen && memList) await _loadAgentMemories(agentId, memList);
    });
    overflowMenu.querySelector('.cc-ov-edit')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      if (!detail.classList.contains('open')) _toggleDetail(row, detail);
      const editForm = detail.querySelector(`#cc-ag-edit-${agentId}`);
      if (editForm) {
        const opening = editForm.style.display === 'none';
        editForm.style.display = opening ? 'block' : 'none';
        if (opening) _initEditVoicePicker(editForm);
      }
    });
    overflowMenu.querySelector('.cc-ov-delete')?.addEventListener('click', () => {
      overflowMenu.classList.remove('open');
      _deleteAgent(agentId, row);
    });
  }

  // Detail: Chat
  detail.querySelector('.cc-detail-chat-btn')?.addEventListener('click', () => {
    _openChat(container, row, agentId);
  });

  // Detail: Invoke toggle
  detail.querySelector('.cc-detail-invoke-btn')?.addEventListener('click', () => {
    const invForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (invForm) invForm.style.display = invForm.style.display === 'none' ? 'block' : 'none';
  });

  // Detail: Call
  detail.querySelector('.cc-detail-call-btn')?.addEventListener('click', () => {
    _openCall(container, row, agentId);
  });

  // Detail: Memory toggle
  detail.querySelector('.cc-detail-memory-btn')?.addEventListener('click', async () => {
    const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
    const memList  = detail.querySelector(`#cc-ag-memory-list-${agentId}`);
    if (!memPanel) return;
    const wasOpen = memPanel.style.display !== 'none';
    memPanel.style.display = wasOpen ? 'none' : 'block';
    if (!wasOpen && memList) await _loadAgentMemories(agentId, memList);
  });

  // Detail: Edit toggle
  detail.querySelector('.cc-detail-edit-btn')?.addEventListener('click', () => {
    const editForm = detail.querySelector(`#cc-ag-edit-${agentId}`);
    const invForm  = detail.querySelector(`#cc-ag-invoke-${agentId}`);
    if (editForm) {
      const opening = editForm.style.display === 'none';
      editForm.style.display = opening ? 'block' : 'none';
      if (opening) _initEditVoicePicker(editForm);
    }
    if (invForm) invForm.style.display = 'none';
  });

  // Detail: Delete
  detail.querySelector('.cc-detail-delete-btn')?.addEventListener('click', () => {
    _deleteAgent(agentId, row);
  });

  // Health: reset button — POST /api/agents/{id}/reset-health.
  detail.querySelector('.cc-health-reset-btn')?.addEventListener('click', () =>
    _resetAgentHealth(agentId, row, detail),
  );

  // Invoke form
  const invokeForm = detail.querySelector(`#cc-ag-invoke-${agentId}`);
  const textarea   = invokeForm?.querySelector('.cc-ag-invoke-input');
  const result     = detail.querySelector(`#cc-ag-result-${agentId}`);
  const submitBtn  = invokeForm?.querySelector('.cc-ag-submit-btn');
  const cancelBtn  = invokeForm?.querySelector('.cc-ag-cancel-btn');
  const exportBtn  = invokeForm?.querySelector('.cc-invoke-export-btn');
  const clearBtn   = invokeForm?.querySelector('.cc-invoke-hist-clear');
  submitBtn?.addEventListener('click', () => _invokeAgentWithHistory(agentId, row.dataset.agentName, textarea, result, submitBtn, detail));
  cancelBtn?.addEventListener('click', () => {
    if (invokeForm) invokeForm.style.display = 'none';
    if (result)     result.textContent = '';
  });
  exportBtn?.addEventListener('click', () => _exportInvokeHistory(agentId, row.dataset.agentName));
  clearBtn?.addEventListener('click', () => {
    if (typeof confirm === 'function'
        && !confirm('Clear invocation history for this agent?')) return;
    _clearInvokeHistory(agentId);
    _renderInvokeHistory(detail, agentId);
  });
  // First paint — any prior invocations from this browser show on detail open.
  _renderInvokeHistory(detail, agentId);

  // Edit form
  const editForm   = detail.querySelector(`#cc-ag-edit-${agentId}`);
  const saveBtn    = editForm?.querySelector('.cc-ag-save-btn');
  const discardBtn = editForm?.querySelector('.cc-ag-discard-btn');
  saveBtn?.addEventListener('click', () => _saveAgent(agentId, row, detail, editForm));
  discardBtn?.addEventListener('click', () => { if (editForm) editForm.style.display = 'none'; });

  // Memory panel close
  detail.querySelector('.cc-ag-memory-close-btn')?.addEventListener('click', () => {
    const memPanel = detail.querySelector(`#cc-ag-memory-${agentId}`);
    if (memPanel) memPanel.style.display = 'none';
  });

  // Memory panel search input — client-side filter over already-rendered rows
  const memSearch = detail.querySelector(`#cc-ag-mem-search-${agentId}`);
  if (memSearch) {
    memSearch.addEventListener('input', () => {
      const list  = detail.querySelector(`#cc-ag-memory-list-${agentId}`);
      const panel = detail.querySelector(`#cc-ag-memory-${agentId}`);
      if (!list || !panel) return;
      const shown = _applyMemorySearch(list, memSearch.value);
      _setMemCount(panel, shown);
    });
  }
}

// ---------------------------------------------------------------------------
// Save / Delete / Invoke
// ---------------------------------------------------------------------------

async function _saveAgent(agentId, row, detail, editForm) {
  const msgEl = editForm.querySelector(`#cc-ag-edit-msg-${agentId}`);
  const body = {
    name:           editForm.querySelector('.cc-ag-edit-name')?.value?.trim(),
    role:           editForm.querySelector('.cc-ag-edit-role')?.value?.trim(),
    agent_type:     editForm.querySelector('.cc-ag-edit-agent-type')?.value?.trim(),
    model_alias:    editForm.querySelector('.cc-ag-edit-model')?.value?.trim() || 'default',
    system_prompt:  editForm.querySelector('.cc-ag-edit-prompt')?.value ?? '',
    avatar:         editForm.querySelector('.cc-ag-edit-avatar')?.value?.trim() || '',
    tts_voice:      editForm.querySelector('.cc-ag-edit-tts-voice')?.value?.trim() || '',
    pinned_skills:  _readPinnedSkillsFromForm(editForm),
  };
  if (!body.name) { if (msgEl) msgEl.textContent = 'Name is required'; return; }
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
    const nameEl  = row.querySelector('.cc-row-name');
    const roleEl  = row.querySelector('.cc-row-role');
    const modelEl = row.querySelector('.cc-row-model');
    const sigilEl = row.querySelector('.cc-row-sigil');
    if (nameEl)  nameEl.textContent  = data.name  || '';
    if (roleEl)  roleEl.textContent  = data.role  || data.agent_type || '—';
    if (modelEl) modelEl.textContent = data.model_alias || 'default';
    if (sigilEl) sigilEl.textContent = data.avatar || (data.name || '?')[0];
    const promptEl = detail.querySelector('.cc-detail-prompt');
    if (promptEl && data.system_prompt != null) {
      const snip = (data.system_prompt || '').slice(0, 180);
      promptEl.textContent = snip + ((data.system_prompt || '').length > 180 ? '…' : '');
    }
    if (data.name)           row.dataset.agentName   = data.name;
    if (data.avatar)         row.dataset.agentAvatar = data.avatar;
    if (data.tts_voice != null) row.dataset.ttsVoice = data.tts_voice;
    editForm.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  } catch (e) {
    if (msgEl) msgEl.textContent = `Error: ${e.message}`;
  }
}

async function _resetAgentHealth(agentId, row, detail) {
  const btn  = detail.querySelector('.cc-health-reset-btn');
  const msg  = detail.querySelector(`#cc-health-msg-${agentId}`);
  const dotRow = detail.querySelector('.cc-row .cc-health-dot, .cc-health-row .cc-health-dot');
  const dotInRow = row?.querySelector('.cc-health-dot');
  const sectionDot = detail.querySelector('.cc-health-row .cc-health-dot');
  const original = btn?.textContent || '[ RESET HEALTH ]';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const res = await fetch(
      `/api/agents/${encodeURIComponent(agentId)}/reset-health`,
      { method: 'POST', credentials: 'same-origin' },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Flip the dot back to OK on both the row pip and the detail section
    // so the user sees the change without a full re-render of the roster.
    [dotInRow, sectionDot, dotRow].forEach(el => {
      if (!el) return;
      el.className = 'cc-health-dot cc-health-dot--ok';
      el.title = 'Health: OK';
    });
    const label = detail.querySelector('.cc-health-label strong');
    if (label) label.textContent = 'OK';
    const counts = detail.querySelector('.cc-health-counts strong');
    if (counts) counts.textContent = '0';
    const lasterr = detail.querySelector('.cc-health-lasterr');
    if (lasterr) lasterr.remove();
    if (msg) {
      msg.hidden = false;
      msg.textContent = 'Health reset.';
      setTimeout(() => { msg.hidden = true; }, 2000);
    }
  } catch (e) {
    if (msg) {
      msg.hidden = false;
      msg.textContent = `Reset failed — ${e.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

// Token-only styles for the health dot + section. Injected once at first
// row render so each agent card lights up without us having to touch the
// (frequently-locked) styles.css file.
const _HEALTH_STYLE_ID = 'cc-agent-health-styles';
function _ensureHealthStyles() {
  if (typeof document === 'undefined') return;
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function'
      && document.getElementById(_HEALTH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = _HEALTH_STYLE_ID;
  style.textContent = `
.cc-health-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 4px;
  background: var(--cc-border, var(--border, #3a2a2a));
}
.cc-health-dot--ok {
  background: var(--green, var(--cc-ok, #50fa7b));
  box-shadow: 0 0 4px color-mix(in srgb, var(--green, var(--cc-ok, #50fa7b)) 50%, transparent);
}
.cc-health-dot--degraded {
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 60%, transparent);
}
.cc-health-dot--error {
  background: var(--cc-crimson, var(--red, #c0392b));
  box-shadow: 0 0 5px color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 55%, transparent);
  animation: cc-health-pulse 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .cc-health-dot--error { animation: none; }
}
@keyframes cc-health-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.cc-health-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--cc-border, var(--border, #3a2a2a));
}
.cc-health-row {
  display: flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--cc-fg, var(--fg, #c5c9d0));
}
.cc-health-counts {
  margin-left: auto;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 65%, transparent);
}
.cc-health-lasterr {
  margin-top: 6px;
  padding: 6px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px; line-height: 1.4;
  border: 1px solid color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 35%, transparent);
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 8%, transparent);
  color: var(--cc-fg, var(--fg, #c5c9d0));
  word-break: break-word;
}
.cc-health-when {
  opacity: 0.55;
  letter-spacing: 0.04em;
}
.cc-health-actions { margin-top: 8px; }
.cc-health-reset-btn {
  -webkit-appearance: none; appearance: none;
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 70%, transparent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px; letter-spacing: 0.14em;
  padding: 4px 9px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cc-health-reset-btn:hover {
  color: var(--cc-crimson, var(--red, #c0392b));
  border-color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-health-reset-btn:disabled { opacity: 0.5; cursor: wait; }
.cc-health-msg {
  margin-top: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 65%, transparent);
}
  `.trim();
  document.head.appendChild(style);
}

async function _deleteAgent(agentId, row) {
  const name = row.querySelector('.cc-row-name')?.textContent || 'this agent';
  if (!confirm(`Delete ${name}? Seeded defaults won't come back on refresh.`)) return;
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    const detail     = document.querySelector(`#cc-detail-${agentId}`);
    const rosterBody = row.closest('#cc-ag-grid');
    row.remove();
    detail?.remove();
    if (rosterBody) {
      rosterBody.querySelectorAll('.cc-cat-section').forEach(sec => {
        if (!sec.querySelector('.cc-agent-row')) sec.remove();
      });
      const countEl = document.getElementById('cc-ag-count');
      if (countEl) countEl.textContent = rosterBody.querySelectorAll('.cc-agent-row').length;
    }
  } catch (e) {
    alert(`Could not delete agent: ${e.message}`);
  }
}

async function _invokeAgent(agentId, textarea, resultEl, submitBtn) {
  const prompt = textarea?.value?.trim();
  if (!prompt) return;
  resultEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Running…';
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      await _streamSSE(res.body, resultEl);
    } else {
      const data = await res.json();
      resultEl.textContent = data.response || data.result || JSON.stringify(data);
    }
  } catch (e) {
    resultEl.textContent = `Error: ${e.message}`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send';
  }
}

// ─── Prompt-testing wrapper around _invokeAgent ────────────────────────────
//
// Runs the existing invoke flow, then captures whatever final text landed in
// the result element and appends it to localStorage. Re-renders the recent-
// invocations list once the call completes (success or error).
async function _invokeAgentWithHistory(agentId, agentName, textarea, resultEl, submitBtn, detail) {
  const prompt = textarea?.value?.trim() || '';
  await _invokeAgent(agentId, textarea, resultEl, submitBtn);
  if (!prompt) return;
  const response = resultEl ? (resultEl.textContent || '') : '';
  _appendInvokeHistory(agentId, {
    prompt, response,
    timestamp: new Date().toISOString(),
  });
  if (detail) _renderInvokeHistory(detail, agentId);
}

// ─── History render ─────────────────────────────────────────────────────────

function _renderInvokeHistory(detail, agentId) {
  _ensureInvokeStyles();
  const list = detail?.querySelector(`#cc-invoke-hist-list-${agentId}`);
  if (!list) return;
  const history = _readInvokeHistory(agentId);
  if (!history.length) {
    list.innerHTML = '<div class="cc-empty">// NO INVOCATIONS YET</div>';
    return;
  }
  list.innerHTML = history.map((entry, i) => {
    const promptPreview = _esc(_truncateInvokePrompt(entry.prompt));
    const tsAttr = _esc(entry.timestamp || '');
    const time   = _esc(_invokeRelativeTime(entry.timestamp));
    const fullPrompt = _esc(entry.prompt || '');
    // The newest entry is at index 0; diff against the current (index 0)
    // for any other row. Newest row has no diff target so the button is
    // suppressed for it.
    const diffBtn = i > 0
      ? `<button class="cc-invoke-btn" data-action="diff" data-index="${i}" type="button">// DIFF</button>`
      : '';
    return `<div class="cc-invoke-row" data-index="${i}" data-ts="${tsAttr}">
      <div class="cc-invoke-row-head">
        <button class="cc-invoke-prompt" data-action="rerun" data-prompt="${fullPrompt}" title="${fullPrompt}">${promptPreview}</button>
        <span class="cc-invoke-time">${time}</span>
        <button class="cc-invoke-btn" data-action="expand" data-index="${i}" type="button">// EXPAND</button>
        ${diffBtn}
      </div>
      <div class="cc-invoke-row-body" id="cc-invoke-body-${agentId}-${i}" hidden></div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    const action = btn.dataset.action;
    if (action === 'rerun') {
      btn.addEventListener('click', () => {
        const ta = detail.querySelector('.cc-ag-invoke-input');
        if (ta) { ta.value = btn.dataset.prompt || ''; ta.focus(); }
      });
    } else if (action === 'expand') {
      btn.addEventListener('click', () => _toggleExpand(detail, agentId, btn, history));
    } else if (action === 'diff') {
      btn.addEventListener('click', () => _toggleDiff(detail, agentId, btn, history));
    }
  });
}

function _toggleExpand(detail, agentId, btn, history) {
  const idx  = Number(btn.dataset.index);
  const body = detail.querySelector(`#cc-invoke-body-${agentId}-${idx}`);
  if (!body || !Number.isFinite(idx)) return;
  if (!body.hidden) {
    body.hidden = true;
    btn.textContent = '// EXPAND';
    return;
  }
  const entry = history[idx];
  if (!entry) return;
  body.innerHTML = `<pre class="cc-invoke-resp">${_esc(entry.response || '(empty)')}</pre>`;
  body.hidden = false;
  btn.textContent = '// COLLAPSE';
}

function _toggleDiff(detail, agentId, btn, history) {
  const idx  = Number(btn.dataset.index);
  const body = detail.querySelector(`#cc-invoke-body-${agentId}-${idx}`);
  if (!body || !Number.isFinite(idx) || idx === 0) return;
  if (!body.hidden && body.dataset.mode === 'diff') {
    body.hidden = true;
    body.dataset.mode = '';
    btn.textContent = '// DIFF';
    return;
  }
  const current = history[0]?.response || '';
  const prior   = history[idx]?.response || '';
  const ops = _diffResponses(prior, current);
  body.innerHTML = `<pre class="cc-invoke-diff">` + ops.map(op => {
    if (op.kind === 'add') return `<span class="cc-invoke-diff-add">+ ${_esc(op.text)}</span>`;
    if (op.kind === 'rem') return `<span class="cc-invoke-diff-rem">- ${_esc(op.text)}</span>`;
    return `<span class="cc-invoke-diff-ctx">  ${_esc(op.text)}</span>`;
  }).join('\n') + `</pre>`;
  body.dataset.mode = 'diff';
  body.hidden = false;
  btn.textContent = '// HIDE DIFF';
}

function _exportInvokeHistory(agentId, agentName) {
  const history = _readInvokeHistory(agentId);
  const md = _buildExportMarkdown(agentName, history);
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = String(agentName || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    a.href = url;
    a.download = `cerberus-invocations-${slug}.md`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (_) { /* download not available in this env — silent */ }
}

function _truncateInvokePrompt(s) {
  s = String(s ?? '');
  return s.length > INVOKE_PROMPT_PREVIEW
    ? s.slice(0, INVOKE_PROMPT_PREVIEW - 1) + '…'
    : s;
}

function _invokeRelativeTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const delta = (Date.now() - d.getTime()) / 1000;
    if (delta < 60)    return 'just now';
    if (delta < 3600)  return `${Math.floor(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
    return `${Math.floor(delta / 86400)}d ago`;
  } catch (_) { return ''; }
}

// Token-only inline styles — shipped here so the panel module is
// self-contained.
const _INVOKE_STYLE_ID = 'cc-invoke-history-styles';
function _ensureInvokeStyles() {
  if (typeof document === 'undefined') return;
  if (!document.head || typeof document.head.appendChild !== 'function') return;
  if (typeof document.getElementById === 'function'
      && document.getElementById(_INVOKE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = _INVOKE_STYLE_ID;
  style.textContent = `
.cc-invoke-history {
  margin-top: 10px;
  border-top: 1px solid var(--cc-border, var(--border, #3a2a2a));
  padding-top: 8px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
.cc-invoke-hist-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.cc-invoke-hist-clear, .cc-invoke-export-btn, .cc-invoke-btn {
  -webkit-appearance: none; appearance: none;
  background: transparent;
  border: 1px solid var(--cc-border, var(--border, #3a2a2a));
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 60%, transparent);
  font-family: inherit;
  font-size: 8.5px; letter-spacing: 0.12em; text-transform: uppercase;
  padding: 3px 8px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.cc-invoke-hist-clear:hover, .cc-invoke-export-btn:hover, .cc-invoke-btn:hover {
  color: var(--cc-crimson, var(--red, #c0392b));
  border-color: var(--cc-crimson, var(--red, #c0392b));
}
.cc-invoke-hist-list { display: flex; flex-direction: column; gap: 4px; }
.cc-invoke-row {
  border-bottom: 1px solid color-mix(in srgb, var(--cc-border, var(--border, #3a2a2a)) 55%, transparent);
  padding: 4px 0;
}
.cc-invoke-row-head { display: flex; align-items: center; gap: 8px; }
.cc-invoke-prompt {
  -webkit-appearance: none; appearance: none;
  background: transparent; border: none;
  flex: 1; min-width: 0;
  text-align: left;
  font-family: inherit; font-size: 11px; letter-spacing: 0.02em;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  cursor: pointer; padding: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cc-invoke-prompt:hover { color: var(--cc-crimson, var(--red, #c0392b)); }
.cc-invoke-time {
  font-family: inherit; font-size: 9px; letter-spacing: 0.06em;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 32%, transparent);
  white-space: nowrap;
}
.cc-invoke-row-body { margin-top: 4px; }
.cc-invoke-resp, .cc-invoke-diff {
  font-family: inherit;
  font-size: 10px; line-height: 1.4;
  white-space: pre-wrap; word-break: break-word;
  color: var(--cc-fg, var(--fg, #c5c9d0));
  background: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--cc-border, var(--border, #3a2a2a)) 60%, transparent);
  padding: 6px 8px;
  margin: 0;
}
.cc-invoke-diff-add {
  display: block;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 80%, var(--cc-crimson, var(--red, #c0392b)));
  background: color-mix(in srgb, var(--cc-crimson, var(--red, #c0392b)) 10%, transparent);
}
.cc-invoke-diff-rem {
  display: block;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 38%, transparent);
  text-decoration: line-through;
}
.cc-invoke-diff-ctx {
  display: block;
  color: color-mix(in srgb, var(--cc-fg, var(--fg, #c5c9d0)) 65%, transparent);
}
  `.trim();
  document.head.appendChild(style);
}

async function _streamSSE(body, resultEl) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventType = 'message';
  resultEl.textContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) { eventType = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) { eventType = 'message'; continue; }
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') { eventType = 'message'; return; }
      if (eventType === 'error') {
        try {
          const obj = JSON.parse(raw);
          resultEl.innerHTML += `<span style="color:var(--cc-crit,#f66)">[Error] ${_esc(obj.error || raw)}</span>`;
        } catch (_) {
          resultEl.innerHTML += `<span style="color:var(--cc-crit,#f66)">[Error] ${_esc(raw)}</span>`;
        }
        eventType = 'message';
        continue;
      }
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'usage') continue;
        resultEl.textContent += obj.delta || obj.text || obj.content || '';
      } catch (_) {
        resultEl.textContent += raw;
      }
      eventType = 'message';
    }
  }
}

// ---------------------------------------------------------------------------
// Agent memory panel
// ---------------------------------------------------------------------------
// Memories live in /api/memory keyed by owner; agent-scoped entries carry an
// `agent_id` field (verified against src/memory.py:217 — the only memory field
// that ties to an agent). Client-side filter on that field; if no matches,
// fall back to the 10 most recent so the panel is never empty for a freshly-
// created agent.

const MEM_FALLBACK_LIMIT = 10;

function _filterMemoriesForAgent(memories, agentId) {
  const list = Array.isArray(memories) ? memories : [];
  const matched = list.filter(m => m && m.agent_id === agentId);
  if (matched.length) return { entries: matched, isFallback: false };
  const sorted = list
    .slice()
    .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0))
    .slice(0, MEM_FALLBACK_LIMIT);
  return { entries: sorted, isFallback: true };
}

function _memMatchesQuery(m, q) {
  if (!q) return true;
  const haystack = ((m?.text || '') + ' ' + (m?.category || '')).toLowerCase();
  return haystack.includes(q);
}

function _applyMemorySearch(listEl, query) {
  const q = String(query || '').trim().toLowerCase();
  let shown = 0;
  listEl.querySelectorAll('.cc-ag-mem-row').forEach(row => {
    const txt = (row.dataset.memText || '').toLowerCase();
    const cat = (row.dataset.memCategory || '').toLowerCase();
    const match = !q || txt.includes(q) || cat.includes(q);
    row.classList.toggle('cc-ag-mem-row--hidden', !match);
    if (match) shown++;
  });
  return shown;
}

function _setMemCount(panel, n) {
  const el = panel?.querySelector('.cc-ag-mem-count');
  if (el) el.textContent = `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

function _setMemFallbackNote(panel, isFallback) {
  const el = panel?.querySelector('.cc-ag-mem-fallback-note');
  if (el) el.style.display = isFallback ? 'block' : 'none';
}

function _renderMemoryRow(entry, agentId, listEl, panel) {
  const row = document.createElement('div');
  row.className = 'cc-ag-mem-row';
  row.dataset.memId       = entry.id;
  row.dataset.memText     = entry.text || '';
  row.dataset.memCategory = entry.category || '';
  // Only memories tagged to this agent get the agent-scoped delete route;
  // fallback entries (no agent_id match) use the general /api/memory/{id}.
  const agentScoped = entry.agent_id === agentId;
  const cat = entry.category ? `<span class="cc-ag-mem-cat">${_esc(entry.category)}</span>` : '';
  row.innerHTML = `
    <div class="cc-ag-mem-text">${_esc(entry.text || '')}${cat}</div>
    <button class="cc-ag-mem-del-btn" title="Delete memory">✕</button>
  `.trim();
  row.querySelector('.cc-ag-mem-del-btn')?.addEventListener('click', async () => {
    try {
      const url = agentScoped
        ? `/api/agents/${encodeURIComponent(agentId)}/memories/${encodeURIComponent(entry.id)}`
        : `/api/memory/${encodeURIComponent(entry.id)}`;
      const dr = await fetch(url, { method: 'DELETE' });
      if (!dr.ok) throw new Error(`HTTP ${dr.status}`);
      row.remove();
      const remaining = listEl.querySelectorAll('.cc-ag-mem-row').length;
      _setMemCount(panel, remaining);
      if (!remaining) {
        listEl.innerHTML = '<div class="cc-empty">No memories yet. Start chatting to build agent memory.</div>';
      }
    } catch (_) {
      const btn = row.querySelector('.cc-ag-mem-del-btn');
      if (btn) btn.textContent = '!';
    }
  });
  listEl.appendChild(row);
}

async function _loadAgentMemories(agentId, listEl) {
  const panel = listEl.closest?.('.cc-ag-memory-panel') || null;
  listEl.innerHTML = '<div class="cc-empty cc-ag-mem-loading">Loading…</div>';
  _setMemCount(panel, 0);
  _setMemFallbackNote(panel, false);
  try {
    const res = await fetch('/api/memory');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const all  = Array.isArray(data) ? data : (data.memory || data.memories || []);
    const { entries, isFallback } = _filterMemoriesForAgent(all, agentId);
    if (!entries.length) {
      listEl.innerHTML = '<div class="cc-empty">No memories yet. Start chatting to build agent memory.</div>';
      _setMemCount(panel, 0);
      return;
    }
    _setMemFallbackNote(panel, isFallback);
    listEl.innerHTML = '';
    for (const m of entries) _renderMemoryRow(m, agentId, listEl, panel);
    _setMemCount(panel, entries.length);
    // Re-apply any text already in the search input
    const searchInput = panel?.querySelector('.cc-ag-mem-search-input');
    if (searchInput && searchInput.value) {
      const shown = _applyMemorySearch(listEl, searchInput.value);
      _setMemCount(panel, shown);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="cc-empty">Could not load memories — ${_esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Create form wiring
// ---------------------------------------------------------------------------

function _wireCreateForm(container, onCreated) {
  const form     = container.querySelector('#cc-ag-create-form');
  const submitEl = container.querySelector('#cc-create-submit');
  const cancelEl = container.querySelector('#cc-create-cancel');
  const msgEl    = container.querySelector('#cc-create-msg');

  cancelEl?.addEventListener('click', () => {
    form.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  });

  submitEl?.addEventListener('click', async () => {
    const body = {
      name:          (container.querySelector('#cc-create-name')?.value  || '').trim(),
      role:          (container.querySelector('#cc-create-role')?.value  || '').trim(),
      agent_type:    (container.querySelector('#cc-create-type')?.value  || '').trim(),
      model_alias:   (container.querySelector('#cc-create-model')?.value || 'default').trim(),
      system_prompt: (container.querySelector('#cc-create-prompt')?.value || ''),
      avatar:        (container.querySelector('#cc-create-avatar')?.value || '').trim(),
    };
    if (!body.name || !body.role || !body.agent_type || !body.system_prompt.trim()) {
      if (msgEl) msgEl.textContent = 'Name, role, type and system prompt are required';
      return;
    }
    submitEl.disabled = true;
    try {
      const res = await fetch('/api/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      form.style.display = 'none';
      if (msgEl) msgEl.textContent = '';
      ['#cc-create-name','#cc-create-role','#cc-create-type','#cc-create-prompt','#cc-create-avatar']
        .forEach(sel => { const el = container.querySelector(sel); if (el) el.value = ''; });
      const modelEl = container.querySelector('#cc-create-model');
      if (modelEl) modelEl.value = 'default';
      if (onCreated) onCreated();
    } catch (e) {
      if (msgEl) msgEl.textContent = `Error: ${e.message}`;
    } finally {
      submitEl.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

function _applyFilter(container, filter) {
  container.querySelectorAll('.cc-agent-row').forEach(row => {
    const visible = filter === 'all' || (row.dataset.status || 'idle') === filter;
    row.classList.toggle('cc-row-hidden', !visible);
    const id     = row.dataset.id;
    const detail = id ? container.querySelector(`#cc-detail-${id}`) : null;
    if (detail) detail.classList.toggle('cc-row-hidden', !visible);
  });
  container.querySelectorAll('.cc-cat-section').forEach(sec => {
    const hasVisible = [...sec.querySelectorAll('.cc-agent-row')]
      .some(r => !r.classList.contains('cc-row-hidden'));
    sec.classList.toggle('cc-row-hidden', !hasVisible);
  });
}

// ---------------------------------------------------------------------------
// Grid refresh
// ---------------------------------------------------------------------------

async function _refreshGrid(container) {
  const rosterBody = container.querySelector('#cc-ag-grid');
  const countEl    = container.querySelector('#cc-ag-count');
  if (!rosterBody) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { agents = [] } = await res.json();
    if (!agents.length) {
      rosterBody.innerHTML = '<div class="cc-empty">No agents registered.</div>';
      return;
    }
    if (countEl) countEl.textContent = agents.length;
    const grouped = _groupAgents(agents);
    rosterBody.innerHTML = CAT_ORDER
      .filter(cat => grouped[cat]?.length)
      .map(cat => {
        const rows = grouped[cat].map(a => _agentRow(a) + '\n' + _agentDetail(a)).join('\n');
        return `<div class="cc-cat-section" data-cat="${cat.toLowerCase()}">
<div class="cc-cat-head">
  <span class="cc-cat-head-prefix">//</span>
  <span class="cc-cat-head-label">${cat}</span>
  <span class="cc-cat-head-count">${grouped[cat].length}</span>
  <span class="cc-cat-head-chevron">›</span>
</div>
<div class="cc-cat-rows">${rows}</div>
</div>`;
      }).join('');
    _applyCollapsedState(container);
    container.querySelectorAll('.cc-cat-head').forEach(head => {
      head.addEventListener('click', () => {
        const sec = head.closest('.cc-cat-section');
        sec?.classList.toggle('collapsed');
        _toggleCollapsedFor(sec);
      });
    });
    agents.forEach(a => _wireRow(container, a.id));
  } catch (e) {
    rosterBody.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAgentsTab() {
  return `
<div class="cc-agents-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">AGENT ROSTER</span>
    <span class="cc-agents-tab-count" id="cc-ag-count">—</span>
    <div class="cc-filter-pills">
      <button class="cc-filter-pill active" data-filter="all">ALL</button>
      <button class="cc-filter-pill" data-filter="active">ACTIVE</button>
      <button class="cc-filter-pill" data-filter="idle">IDLE</button>
      <button class="cc-filter-pill" data-filter="standby">STANDBY</button>
      <button class="cc-filter-pill" data-filter="ready">READY</button>
    </div>
    <button class="cc-ag-new-btn" id="cc-ag-new-btn">+ New Agent</button>
  </div>
  ${_createForm()}
  <div class="cc-roster-col-header">
    <span></span><span></span>
    <span>Agent</span><span>Role</span><span>Model</span><span>Score</span>
    <span style="text-align:right">Actions</span>
  </div>
  <div class="cc-roster-body" id="cc-ag-grid">
    <div class="cc-empty">Loading agents…</div>
  </div>
</div>`.trim();
}

export async function loadAgents(container) {
  const newBtn     = container.querySelector('#cc-ag-new-btn');
  const createForm = container.querySelector('#cc-ag-create-form');
  newBtn?.addEventListener('click', () => {
    if (!createForm) return;
    createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
  });
  container.querySelectorAll('.cc-filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.cc-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      _applyFilter(container, pill.dataset.filter || 'all');
    });
  });
  _wireCreateForm(container, () => _refreshGrid(container));
  await _refreshGrid(container);
}
