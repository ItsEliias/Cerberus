/**
 * agents.js — AGENTS/SWARM sub-tab for Command Center.
 *
 * Fetches /api/agents and renders a card grid. Each card shows the agent's
 * name, role, status pill, model alias, score, and an Invoke button that
 * opens an inline SSE-streaming form.
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
  return `
<div class="cc-ag-card" data-agent-id="${_esc(agent.id)}">
  <div class="cc-ag-card-header">
    <span class="cc-ag-name">${_esc(agent.name || agent.id)}</span>
    <span class="cc-ag-status ${cls}">${label}</span>
  </div>
  <div class="cc-ag-card-meta">
    <span class="cc-ag-role">${_esc(agent.role || agent.agent_type || '—')}</span>
    <span class="cc-ag-type-badge">${_esc(agent.agent_type || '—')}</span>
    ${score}
  </div>
  ${agent.model_alias ? `<div class="cc-ag-model-chip">${_esc(agent.model_alias)}</div>` : ''}
  <button class="cc-ag-invoke-btn" data-agent-id="${_esc(agent.id)}">Invoke</button>
  <div class="cc-ag-invoke-form" id="cc-ag-form-${_esc(agent.id)}" style="display:none">
    <textarea class="cc-ag-invoke-input" placeholder="Enter prompt…" rows="3"></textarea>
    <div class="cc-ag-invoke-actions">
      <button class="cc-ag-submit-btn" data-agent-id="${_esc(agent.id)}">Send</button>
      <button class="cc-ag-cancel-btn" data-agent-id="${_esc(agent.id)}">Cancel</button>
    </div>
    <div class="cc-ag-result" id="cc-ag-result-${_esc(agent.id)}"></div>
  </div>
</div>`.trim();
}

function _wireCard(container, agentId) {
  const card     = container.querySelector(`[data-agent-id="${agentId}"].cc-ag-card`);
  if (!card) return;
  const invokeBtn = card.querySelector(`.cc-ag-invoke-btn`);
  const form      = card.querySelector(`#cc-ag-form-${agentId}`);
  const submitBtn = card.querySelector(`.cc-ag-submit-btn`);
  const cancelBtn = card.querySelector(`.cc-ag-cancel-btn`);
  const textarea  = card.querySelector('.cc-ag-invoke-input');
  const result    = card.querySelector(`#cc-ag-result-${agentId}`);

  invokeBtn?.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  });
  cancelBtn?.addEventListener('click', () => { form.style.display = 'none'; result.textContent = ''; });
  submitBtn?.addEventListener('click', () => _invokeAgent(agentId, textarea, result, submitBtn));
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

// ---- Public API ----

export function buildAgentsTab() {
  return `
<div class="cc-agents-tab">
  <div class="cc-agents-tab-header">
    <span class="cc-agents-tab-title">AGENT ROSTER</span>
    <span class="cc-agents-tab-count" id="cc-ag-count">—</span>
  </div>
  <div class="cc-ag-grid" id="cc-ag-grid">
    <div class="cc-empty">Loading agents…</div>
  </div>
</div>`.trim();
}

export async function loadAgents(container) {
  const grid  = container.querySelector('#cc-ag-grid');
  const count = container.querySelector('#cc-ag-count');
  if (!grid) return;
  try {
    const res = await fetch('/api/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const agents = data.agents || (Array.isArray(data) ? data : []);
    if (!agents.length) {
      grid.innerHTML = '<div class="cc-empty">No agents registered.</div>';
      return;
    }
    if (count) count.textContent = agents.length;
    grid.innerHTML = agents.map(a => _agentCard(a)).join('');
    agents.forEach(a => _wireCard(container, a.id));
  } catch (e) {
    grid.innerHTML = `<div class="cc-empty">Could not load agents — ${_esc(e.message)}</div>`;
  }
}
