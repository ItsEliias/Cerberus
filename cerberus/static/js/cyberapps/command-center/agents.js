/**
 * agents.js — AGENTS/SWARM sub-tab for Command Center.
 *
 * Fetches /api/agents and renders a card grid. Each card supports:
 *   • Invoke (SSE streaming prompt)
 *   • Edit (inline fields for name/role/agent_type/prompt/model/avatar)
 *   • Delete (confirm step; seeded defaults stay gone after refresh)
 * "New Agent" button opens a create form at the top of the grid.
 */

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

const STATUS_META = {
  active:  { cls: 'cc-ag-status--active',  label: 'ACTIVE' },
  idle:    { cls: 'cc-ag-status--idle',    label: 'IDLE' },
  alert:   { cls: 'cc-ag-status--alert',   label: 'ALERT' },
  standby: { cls: 'cc-ag-status--standby', label: 'STANDBY' },
  ready:   { cls: 'cc-ag-status--ready',   label: 'READY' },
};

function _statusMeta(status) {
  return STATUS_META[status] || { cls: 'cc-ag-status--idle', label: _esc(status || 'UNKNOWN').toUpperCase() };
}

function _agentCard(agent) {
  const { cls, label } = _statusMeta(agent.status);
  const score = (agent.score != null && agent.score > 0) ? `<span class="cc-ag-score">${_esc(agent.score)}</span>` : '';
  const avatarHtml = agent.avatar
    ? `<span class="cc-ag-avatar">${_esc(agent.avatar)}</span>`
    : `<span class="cc-ag-avatar cc-ag-avatar--sigil">${_esc((agent.name || '?')[0])}</span>`;
  return `
<div class="cc-ag-card" data-agent-id="${_esc(agent.id)}">
  <div class="cc-ag-card-header">
    ${avatarHtml}
    <span class="cc-ag-name">${_esc(agent.name || agent.id)}</span>
    <span class="cc-ag-status ${cls}">${label}</span>
  </div>
  <div class="cc-ag-card-meta">
    <span class="cc-ag-role">${_esc(agent.role || agent.agent_type || '—')}</span>
    <span class="cc-ag-type-badge">${_esc(agent.agent_type || '—')}</span>
    ${score}
  </div>
  ${agent.model_alias ? `<div class="cc-ag-model-chip">${_esc(agent.model_alias)}</div>` : ''}
  <div class="cc-ag-card-actions">
    <button class="cc-ag-invoke-btn" data-agent-id="${_esc(agent.id)}">Invoke</button>
    <button class="cc-ag-edit-btn"   data-agent-id="${_esc(agent.id)}">Edit</button>
    <button class="cc-ag-delete-btn" data-agent-id="${_esc(agent.id)}">Delete</button>
  </div>
  <div class="cc-ag-invoke-form" id="cc-ag-invoke-${_esc(agent.id)}" style="display:none">
    <textarea class="cc-ag-invoke-input" placeholder="Enter prompt…" rows="3"></textarea>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-submit-btn"  data-agent-id="${_esc(agent.id)}">Send</button>
      <button class="cc-ag-cancel-btn"  data-agent-id="${_esc(agent.id)}">Cancel</button>
    </div>
    <div class="cc-ag-result" id="cc-ag-result-${_esc(agent.id)}"></div>
  </div>
  <div class="cc-ag-edit-form" id="cc-ag-edit-${_esc(agent.id)}" style="display:none">
    <label>Avatar (emoji)</label>
    <input class="cc-ag-edit-avatar"       value="${_esc(agent.avatar || '')}" placeholder="🤖" maxlength="4">
    <label>Name</label>
    <input class="cc-ag-edit-name"         value="${_esc(agent.name || '')}" placeholder="Agent name">
    <label>Role</label>
    <input class="cc-ag-edit-role"         value="${_esc(agent.role || '')}" placeholder="e.g. coder">
    <label>Type</label>
    <input class="cc-ag-edit-agent-type"   value="${_esc(agent.agent_type || '')}" placeholder="e.g. backend-dev">
    <label>Model alias</label>
    <input class="cc-ag-edit-model"        value="${_esc(agent.model_alias || 'default')}" placeholder="default">
    <label>System prompt</label>
    <textarea class="cc-ag-edit-prompt" rows="5">${_esc(agent.system_prompt || '')}</textarea>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-save-btn"   data-agent-id="${_esc(agent.id)}">Save</button>
      <button class="cc-ag-discard-btn" data-agent-id="${_esc(agent.id)}">Cancel</button>
    </div>
    <div class="cc-ag-edit-msg" id="cc-ag-edit-msg-${_esc(agent.id)}"></div>
  </div>
</div>`.trim();
}

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
    <button id="cc-create-submit">Create</button>
    <button id="cc-create-cancel">Cancel</button>
  </div>
  <div id="cc-create-msg" class="cc-ag-edit-msg"></div>
</div>`.trim();
}

// ---- Wire a single card's interaction buttons ----

function _wireCard(container, agentId) {
  const card = container.querySelector(`.cc-ag-card[data-agent-id="${agentId}"]`);
  if (!card) return;

  const invokeBtn  = card.querySelector('.cc-ag-invoke-btn');
  const invokeForm = card.querySelector(`#cc-ag-invoke-${agentId}`);
  const submitBtn  = card.querySelector('.cc-ag-submit-btn');
  const cancelBtn  = card.querySelector('.cc-ag-cancel-btn');
  const textarea   = card.querySelector('.cc-ag-invoke-input');
  const result     = card.querySelector(`#cc-ag-result-${agentId}`);

  const editBtn    = card.querySelector('.cc-ag-edit-btn');
  const editForm   = card.querySelector(`#cc-ag-edit-${agentId}`);
  const saveBtn    = card.querySelector('.cc-ag-save-btn');
  const discardBtn = card.querySelector('.cc-ag-discard-btn');
  const deleteBtn  = card.querySelector('.cc-ag-delete-btn');

  invokeBtn?.addEventListener('click', () => {
    invokeForm.style.display = invokeForm.style.display === 'none' ? 'block' : 'none';
    editForm.style.display = 'none';
  });
  cancelBtn?.addEventListener('click', () => { invokeForm.style.display = 'none'; result.textContent = ''; });
  submitBtn?.addEventListener('click', () => _invokeAgent(agentId, textarea, result, submitBtn));

  editBtn?.addEventListener('click', () => {
    editForm.style.display = editForm.style.display === 'none' ? 'block' : 'none';
    invokeForm.style.display = 'none';
  });
  discardBtn?.addEventListener('click', () => { editForm.style.display = 'none'; });
  saveBtn?.addEventListener('click', () => _saveAgent(agentId, card, editForm));
  deleteBtn?.addEventListener('click', () => _deleteAgent(agentId, card));
}

async function _saveAgent(agentId, card, editForm) {
  const msgEl = editForm.querySelector(`#cc-ag-edit-msg-${agentId}`);
  const body = {
    name:        editForm.querySelector('.cc-ag-edit-name')?.value?.trim(),
    role:        editForm.querySelector('.cc-ag-edit-role')?.value?.trim(),
    agent_type:  editForm.querySelector('.cc-ag-edit-agent-type')?.value?.trim(),
    model_alias: editForm.querySelector('.cc-ag-edit-model')?.value?.trim() || 'default',
    system_prompt: editForm.querySelector('.cc-ag-edit-prompt')?.value ?? '',
    avatar:      editForm.querySelector('.cc-ag-edit-avatar')?.value?.trim() || '',
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
    // Refresh the card header in-place
    const nameEl  = card.querySelector('.cc-ag-name');
    const roleEl  = card.querySelector('.cc-ag-role');
    const typeEl  = card.querySelector('.cc-ag-type-badge');
    const modelEl = card.querySelector('.cc-ag-model-chip');
    const avatarEl = card.querySelector('.cc-ag-avatar');
    if (nameEl)  nameEl.textContent  = data.name  || '';
    if (roleEl)  roleEl.textContent  = data.role  || data.agent_type || '—';
    if (typeEl)  typeEl.textContent  = data.agent_type || '—';
    if (modelEl) modelEl.textContent = data.model_alias || 'default';
    if (avatarEl) avatarEl.textContent = data.avatar || (data.name || '?')[0];
    editForm.style.display = 'none';
    if (msgEl) msgEl.textContent = '';
  } catch (e) {
    if (msgEl) msgEl.textContent = `Error: ${e.message}`;
  }
}

async function _deleteAgent(agentId, card) {
  const name = card.querySelector('.cc-ag-name')?.textContent || 'this agent';
  if (!confirm(`Delete ${name}? Seeded defaults won't come back on refresh.`)) return;
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `HTTP ${res.status}`);
    }
    card.remove();
    const grid = document.getElementById('cc-ag-grid');
    const count = document.getElementById('cc-ag-count');
    if (count && grid) count.textContent = grid.querySelectorAll('.cc-ag-card').length;
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
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith('data:')) { eventType = 'message'; continue; }
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') { eventType = 'message'; return; }
      if (eventType === 'error') {
        try {
          const obj = JSON.parse(raw);
          resultEl.innerHTML += `<span style="color:var(--cc-danger,#f66)">[Error] ${_esc(obj.error || raw)}</span>`;
        } catch (_) {
          resultEl.innerHTML += `<span style="color:var(--cc-danger,#f66)">[Error] ${_esc(raw)}</span>`;
        }
        eventType = 'message';
        continue;
      }
      try {
        const obj = JSON.parse(raw);
        if (obj.type === 'usage') continue;
        const chunk = obj.delta || obj.text || obj.content || '';
        resultEl.textContent += chunk;
      } catch (_) {
        resultEl.textContent += raw;
      }
      eventType = 'message';
    }
  }
}

// ---- Wire the "New Agent" create form ----

function _wireCreateForm(container) {
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
      name:          (container.querySelector('#cc-create-name')?.value || '').trim(),
      role:          (container.querySelector('#cc-create-role')?.value || '').trim(),
      agent_type:    (container.querySelector('#cc-create-type')?.value || '').trim(),
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      // Append new card to grid
      const grid = container.querySelector('#cc-ag-grid');
      const countEl = container.querySelector('#cc-ag-count');
      const tmp = document.createElement('div');
      tmp.innerHTML = _agentCard(data);
      const card = tmp.firstChild;
      grid.appendChild(card);
      _wireCard(container, data.id);
      if (countEl) countEl.textContent = grid.querySelectorAll('.cc-ag-card').length;
      form.style.display = 'none';
      if (msgEl) msgEl.textContent = '';
      // Reset fields
      ['#cc-create-name','#cc-create-role','#cc-create-type','#cc-create-prompt','#cc-create-avatar'].forEach(sel => {
        const el = container.querySelector(sel);
        if (el) el.value = '';
      });
      const modelEl = container.querySelector('#cc-create-model');
      if (modelEl) modelEl.value = 'default';
    } catch (e) {
      if (msgEl) msgEl.textContent = `Error: ${e.message}`;
    } finally {
      submitEl.disabled = false;
    }
  });
}

// ---- Public API ----

export function buildAgentsTab() {
  return `
<div class="cc-agents-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">AGENT ROSTER</span>
    <span class="cc-agents-tab-count" id="cc-ag-count">—</span>
    <button class="cc-ag-new-btn" id="cc-ag-new-btn">+ New Agent</button>
  </div>
  ${_createForm()}
  <div class="cc-ag-grid" id="cc-ag-grid">
    <div class="cc-empty">Loading agents…</div>
  </div>
</div>`.trim();
}

export async function loadAgents(container) {
  const grid    = container.querySelector('#cc-ag-grid');
  const countEl = container.querySelector('#cc-ag-count');
  const newBtn  = container.querySelector('#cc-ag-new-btn');
  const createForm = container.querySelector('#cc-ag-create-form');
  if (!grid) return;

  newBtn?.addEventListener('click', () => {
    if (!createForm) return;
    createForm.style.display = createForm.style.display === 'none' ? 'block' : 'none';
  });
  _wireCreateForm(container);

  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const agents = data.agents || (Array.isArray(data) ? data : []);
    if (!agents.length) {
      grid.innerHTML = '<div class="cc-empty">No agents registered.</div>';
      return;
    }
    if (countEl) countEl.textContent = agents.length;
    grid.innerHTML = agents.map(a => _agentCard(a)).join('');
    agents.forEach(a => _wireCard(container, a.id));
  } catch (e) {
    grid.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
  }
}
