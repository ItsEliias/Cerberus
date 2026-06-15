// Cerberus OS — Atlas Headquarters / The Atlas Council

import AtlasVoiceContext from './cerberusVoiceContext.js';

const COUNCIL_ORDER = ['research', 'business', 'architect', 'developer', 'marketing'];

const COUNCIL_LAYOUT = [
  { id: 'research', pos: 'research', icon: '◎', short: 'R&D' },
  { id: 'business', pos: 'business', icon: '◆', short: 'BIZ' },
  { id: 'architect', pos: 'architect', icon: '⬡', short: 'ARC' },
  { id: 'developer', pos: 'developer', icon: '▣', short: 'DEV' },
  { id: 'marketing', pos: 'marketing', icon: '△', short: 'MKT' },
];

const STAGE_NEXT = {
  research: 'business',
  business: 'architect',
  architect: 'developer',
  developer: 'marketing',
};

const STAGE_AGENT = {
  research: 'research',
  business: 'business',
  architect: 'architect',
  developer: 'developer',
  marketing: 'marketing',
};

const AGENT_REPORT_TYPES = {
  research: [
    { id: 'research_report', label: 'Research Report' },
  ],
  business: [
    { id: 'business_proposal', label: 'Business Proposal' },
  ],
  architect: [
    { id: 'architecture_plan', label: 'Architecture Plan' },
  ],
  developer: [
    { id: 'developer_cursor_prompt', label: 'Developer Cursor Prompt' },
  ],
  marketing: [
    { id: 'marketing_launch_plan', label: 'Marketing Launch Plan' },
  ],
};

const CONTROL_ACTIONS = [
  { id: 'research_brief', label: 'Research Brief', agent_id: 'research', action: 'market_opportunity_report' },
  { id: 'business_ask', label: 'Monetisation Report', agent_id: 'business', action: 'monetisation_report' },
  { id: 'architect_plan', label: 'Architecture Review', agent_id: 'architect', action: 'architecture_review' },
  { id: 'developer_review', label: 'Codebase Review', agent_id: 'developer', action: 'codebase_review' },
  { id: 'marketing_ideas', label: 'Launch Strategy', agent_id: 'marketing', action: 'launch_strategy' },
  { id: 'sync', label: 'Sync Council', agent_id: 'developer', action: 'sync_agents' },
];

let _deps = {};
let _agents = [];
let _reports = [];
let _projects = [];
let _queue = { pending: [], waiting_for_approval: [], completed_today: [] };
let _council = null;
let _briefingV2 = null;
let _briefingFetchedAt = 0;
let _workingAgents = new Set();
let _activeReportId = null;
let _activeAgentOfficeId = null;
let _messageCaptureActive = false;
let _linesRaf = 0;
let _linesRunning = false;

function _el(id) {
  return document.getElementById(id);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _statusLabel(status) {
  const map = {
    idle: 'Idle', ready: 'Ready', thinking: 'Working', waiting: 'Waiting',
    working: 'Working', pending: 'Pending', generating: 'Generating',
    waiting_for_review: 'Awaiting Approval', revision_requested: 'Revision',
    approved: 'Approved', archived: 'Archived',
  };
  return map[status] || status;
}

function _statusClass(status) {
  if (status === 'thinking' || status === 'working') return 'working';
  return status || 'idle';
}

function _agentStatus(agent) {
  if (_workingAgents.has(agent.id)) return 'working';
  return agent.status;
}

function _projectId(report) {
  return report?.linked_project_id || report?.project_id || '';
}

function _projectLabel(pid) {
  if (!pid) return 'General Council Report';
  const p = _projects.find(x => x.id === pid);
  return p?.name || pid;
}

function _projectMeta(pid) {
  const p = _projects.find(x => x.id === pid);
  if (!p) return null;
  return {
    name: p.name,
    score: p.potential_score ?? p.summary_v2?.potential_score,
    stage: p.current_stage ?? p.summary_v2?.current_stage,
  };
}

function _reportsForAgent(agentId) {
  return _reports.filter(r => r.agent_id === agentId);
}

function _bucketReports(agentId) {
  const all = _reportsForAgent(agentId);
  return {
    pending: all.filter(r => ['pending', 'generating', 'revision_requested'].includes(r.status)),
    waiting: all.filter(r => r.status === 'waiting_for_review'),
    approved: all.filter(r => r.status === 'approved'),
    archived: all.filter(r => r.status === 'archived'),
  };
}

async function _fetchProjects() {
  try {
    const res = await fetch('/api/cerberus/projects', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _projects = Array.isArray(data.projects) ? data.projects : [];
  } catch (_) {
    _projects = [];
  }
}

async function _fetchCouncil() {
  try {
    const res = await fetch('/api/cerberus/council', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _council = data.council || null;
  } catch (_) {
    _council = null;
  }
}

async function _getBriefingV2(force = false) {
  if (!force && _briefingV2 && Date.now() - _briefingFetchedAt < 120000) {
    return _briefingV2;
  }
  try {
    const res = await fetch('/api/cerberus/briefing/v2', { credentials: 'same-origin' });
    if (!res.ok) return _briefingV2;
    _briefingV2 = await res.json();
    _briefingFetchedAt = Date.now();
  } catch (_) {}
  return _briefingV2;
}

async function _fetchReports() {
  try {
    const res = await fetch('/api/cerberus/reports', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _reports = Array.isArray(data.reports) ? data.reports : [];
    _queue = data.queue || { pending: [], waiting_for_approval: [], completed_today: [] };
  } catch (_) {
    _reports = [];
    _queue = { pending: [], waiting_for_approval: [], completed_today: [] };
  }
}

async function _fetchAgents() {
  try {
    const res = await fetch('/api/cerberus/agents', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _agents = Array.isArray(data.agents) ? data.agents : [];
  } catch (_) {
    _agents = [];
  }
}

export async function refreshAgentsOffice() {
  await Promise.all([
    _fetchAgents(),
    _fetchReports(),
    _fetchProjects(),
    _fetchCouncil(),
    _getBriefingV2(),
  ]);
  _renderAll();
}

function _setAgentWorking(agentId, working) {
  if (working) _workingAgents.add(agentId);
  else _workingAgents.delete(agentId);
  _renderPods();
  _renderControls();
}

async function _runAction(agentId, action, projectId) {
  const btn = document.querySelector(`[data-agent-id="${agentId}"][data-action="${action}"]`);
  if (btn) btn.disabled = true;
  _setAgentWorking(agentId, true);
  try {
    const body = { agent_id: agentId, action };
    if (projectId) body.project_id = projectId;
    const res = await fetch('/api/cerberus/agents/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Report ready' : 'Action failed'));
    if (data.agents) _agents = data.agents;
    if (data.report) {
      await _fetchReports();
      openReport(data.report.id);
    } else {
      await refreshAgentsOffice();
    }
    return data;
  } catch (_) {
    if (_deps.showToast) _deps.showToast('Failed to run agent action');
    return null;
  } finally {
    _setAgentWorking(agentId, false);
    if (btn) btn.disabled = false;
    _renderPods();
    _renderSidebar();
  }
}

function _deptName(agent) {
  const d = agent.department || agent.id || 'Operations';
  return d.endsWith(' Department') ? d : `${d} Department`;
}

function _linkedProjectLine(agent) {
  const reports = _reportsForAgent(agent.id);
  const latest = reports.find(r => _projectId(r)) || reports[0];
  if (!latest) return '—';
  const pid = _projectId(latest);
  const meta = _projectMeta(pid);
  if (!meta) return _projectLabel(pid);
  const bits = [meta.name];
  if (meta.score != null) bits.push(`${meta.score}/100`);
  if (meta.stage) bits.push(meta.stage);
  return bits.join(' · ');
}

function _renderPods() {
  const wrap = _el('cerberus-agents-pods');
  if (!wrap) return;
  const byId = Object.fromEntries(_agents.map(a => [a.id, a]));

  wrap.classList.add('cerberus-council-grid');
  wrap.innerHTML = COUNCIL_LAYOUT.map(({ id, pos, icon, short }) => {
    const a = byId[id];
    if (!a) return '';
    const st = _statusClass(_agentStatus(a));
    const count = _reportsForAgent(id).length;
    const waiting = _bucketReports(id).waiting.length;
    const task = _workingAgents.has(id) ? 'Generating…' : (a.current_task || '—');
    const project = _linkedProjectLine(a);
    return `
      <article class="cerberus-agent-pod atlas-agent-pod--${pos}${_workingAgents.has(id) ? ' atlas-agent-pod--working' : ''}"
        data-agent-id="${_esc(a.id)}" data-agent-office="${_esc(a.id)}" role="button" tabindex="0"
        aria-label="Open ${_esc(_deptName(a))}">
        <header class="cerberus-agent-pod-head">
          <span class="cerberus-agent-pod-icon" aria-hidden="true">${icon}</span>
          <div class="cerberus-agent-pod-head-text">
            <span class="cerberus-agent-pod-dept">${_esc(_deptName(a))}</span>
            <span class="cerberus-agent-pod-code">${short}</span>
          </div>
          <span class="cerberus-agent-pod-status atlas-agent-pod-status--${_esc(st)}">${_workingAgents.has(id) ? 'Work' : _statusLabel(a.status)}</span>
        </header>
        <h3 class="cerberus-agent-pod-name">${_esc(a.name)}</h3>
        <ul class="cerberus-agent-pod-lines">
          <li><span>Task</span><em>${_esc(task)}</em></li>
          <li><span>Wait</span><em>${_esc(a.waiting_on || (waiting ? `${waiting} approval` : '—'))}</em></li>
          <li><span>Project</span><em>${_esc(project)}</em></li>
        </ul>
        <footer class="cerberus-agent-pod-foot">
          <span class="cerberus-agent-pod-count">${count}r</span>
          ${waiting ? `<span class="cerberus-agent-pod-approval">${waiting}✓</span>` : ''}
        </footer>
      </article>
    `;
  }).join('');
}

function _renderBriefingStrip() {
  const strip = _el('cerberus-hq-briefing-strip');
  if (!strip) return;
  const v = _briefingV2?.visual || {};
  const approval = (_queue.waiting_for_approval || []).length;
  const top = (v.priorities || [])[0];
  strip.innerHTML = `
    <span class="cerberus-hq-strip-item">${_esc(v.greeting || 'Atlas Council online')}</span>
    <span class="cerberus-hq-strip-item">${approval} pending approval${approval === 1 ? '' : 's'}</span>
    ${top ? `<span class="cerberus-hq-strip-item atlas-hq-strip-priority">Priority: ${_esc(top.name)}${top.potential_score != null ? ` (${top.potential_score})` : ''}</span>` : ''}
    ${v.recommendation ? `<span class="cerberus-hq-strip-rec">${_esc(v.recommendation)}</span>` : ''}
  `;
}

function _renderSidebar() {
  _renderBriefingStrip();
  const cards = _el('cerberus-hq-status-cards');
  if (!cards) return;
  const approval = (_queue.waiting_for_approval || []).length;
  const pending = (_queue.pending || []).length;
  const v = _briefingV2?.visual || {};
  const top = (v.priorities || [])[0];
  cards.innerHTML = `
    <div class="cerberus-hq-status-card">
      <span class="cerberus-hq-status-label">Awaiting approval</span>
      <strong class="cerberus-hq-status-value">${approval}</strong>
    </div>
    <div class="cerberus-hq-status-card">
      <span class="cerberus-hq-status-label">In progress</span>
      <strong class="cerberus-hq-status-value">${pending}</strong>
    </div>
    <div class="cerberus-hq-status-card atlas-hq-status-card--wide">
      <span class="cerberus-hq-status-label">Top project</span>
      <strong class="cerberus-hq-status-value">${_esc(top?.name || '—')}</strong>
      ${top?.stage ? `<span class="cerberus-hq-status-meta">${_esc(top.stage)}${top.potential_score != null ? ` · ${top.potential_score}/100` : ''}</span>` : ''}
    </div>
    <div class="cerberus-hq-status-card atlas-hq-status-card--wide">
      <span class="cerberus-hq-status-label">Recommendation</span>
      <p class="cerberus-hq-status-rec">${_esc(v.recommendation || 'Refresh briefing on Home for latest guidance.')}</p>
    </div>
  `;
}

function _renderControls() {
  const bar = _el('cerberus-agents-controls');
  if (!bar) return;
  bar.innerHTML = CONTROL_ACTIONS.map(c => {
    const busy = _workingAgents.has(c.agent_id);
    return `<button type="button" class="cerberus-agents-ctrl-btn" data-agent-id="${_esc(c.agent_id)}" data-action="${_esc(c.action)}"${busy ? ' disabled' : ''}>${_esc(c.label)}</button>`;
  }).join('');
}

function _renderAll() {
  _renderPods();
  _renderSidebar();
  _renderControls();
  requestAnimationFrame(() => {
    if (_linesRunning) _drawConnectionLines();
  });
}

export function renderAgentsOffice(agents = []) {
  if (Array.isArray(agents) && agents.length) _agents = agents;
  _renderAll();
  refreshAgentsOffice();
}

function _formatReportContent(content) {
  const text = String(content || '');
  const escaped = _esc(text);
  return escaped
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function _findReport(id) {
  return _reports.find(r => r.id === id);
}

function _closeReportModal() {
  const modal = _el('cerberus-report-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('cerberus-report-modal--stacked');
  modal.setAttribute('aria-hidden', 'true');
  _activeReportId = null;
  AtlasVoiceContext.clear('report');
  if (_activeAgentOfficeId) {
    AtlasVoiceContext.set({ currentModal: 'agent_office' });
  } else {
    AtlasVoiceContext.clear('modal');
  }
}

export async function openReportById(reportId) {
  if (!reportId) return false;
  let report = _findReport(reportId);
  if (!report) {
    try {
      const data = await fetch(`/api/cerberus/reports/${reportId}`, { credentials: 'same-origin' }).then((r) => r.json());
      if (data.ok && data.report) {
        _reports.unshift(data.report);
        report = data.report;
      }
    } catch (_) {}
  }
  if (!report) return false;
  _openReportPanel(report);
  return true;
}

export function openReport(reportId) {
  void openReportById(reportId);
}

function _openReportPanel(report) {
  _activeReportId = report.id;
  const modal = _el('cerberus-report-modal');
  if (modal && _activeAgentOfficeId) {
    modal.classList.add('cerberus-report-modal--stacked');
  }
  const agentEl = _el('cerberus-report-modal-agent');
  const titleEl = _el('cerberus-report-modal-title');
  const metaEl = _el('cerberus-report-modal-meta');
  const badgesEl = _el('cerberus-report-modal-badges');
  const contextEl = _el('cerberus-report-modal-context');
  const summaryEl = _el('cerberus-report-modal-summary');
  const bodyEl = _el('cerberus-report-modal-body');
  const actionsEl = _el('cerberus-report-modal-actions');
  if (!modal || !titleEl || !bodyEl) return;

  const pid = _projectId(report);
  const created = report.created_at ? new Date(report.created_at).toLocaleString() : '';
  const status = _statusLabel(report.status);

  if (agentEl) agentEl.textContent = report.agent_name || report.agent_id || 'Agent';
  titleEl.textContent = report.title || 'Report';
  if (metaEl) {
    metaEl.textContent = [
      _projectLabel(pid),
      report.title || 'Report',
      created,
    ].filter(Boolean).join(' · ');
  }
  if (badgesEl) {
    badgesEl.innerHTML = `
      <span class="cerberus-report-badge atlas-report-badge--status">${_esc(status)}</span>
      ${report.requires_approval ? '<span class="cerberus-report-badge atlas-report-badge--approval">Approval required</span>' : ''}
      ${report.next_agent_suggestion ? `<span class="cerberus-report-badge">Next: ${_esc(report.next_agent_suggestion)}</span>` : ''}
    `;
  }
  if (contextEl) {
    const meta = _projectMeta(pid);
    contextEl.innerHTML = meta ? `
      <p><strong>Project context</strong> ${_esc(meta.name)}${meta.score != null ? ` · Score ${meta.score}/100` : ''}${meta.stage ? ` · ${_esc(meta.stage)}` : ''}</p>
    ` : (pid ? '' : '<p><strong>General Council Report</strong> — not linked to a project.</p>');
  }
  if (summaryEl) {
    summaryEl.textContent = report.summary || '';
    summaryEl.style.display = report.summary ? '' : 'none';
  }
  bodyEl.innerHTML = _formatReportContent(report.content);
  bodyEl.scrollTop = 0;

  if (actionsEl) {
    const canAct = report.status === 'waiting_for_review';
    const nextAgent = report.next_agent_suggestion;
    const hasProject = !!pid;
    actionsEl.innerHTML = `
      ${canAct ? '<button type="button" class="cerberus-report-action-btn atlas-report-action-btn--approve" data-report-action="approve">Approve</button>' : ''}
      ${canAct ? '<button type="button" class="cerberus-report-action-btn" data-report-action="revise">Request Revision</button>' : ''}
      <button type="button" class="cerberus-report-action-btn" data-report-action="archive">Archive</button>
      ${canAct && nextAgent && hasProject ? '<button type="button" class="cerberus-report-action-btn atlas-report-action-btn--send" data-report-action="send_next">Send to Next Agent</button>' : ''}
      ${hasProject ? `<button type="button" class="cerberus-report-action-btn" data-report-action="open_project" data-project-id="${_esc(pid)}">Open Project</button>` : ''}
      <button type="button" class="cerberus-report-action-btn" data-report-action="ask_atlas">Ask Atlas About This</button>
    `;
  }

  AtlasVoiceContext.set({
    currentModal: 'report',
    currentReportId: report.id,
    currentReportTitle: report.title || 'Report',
    currentAgentId: report.agent_id || AtlasVoiceContext.get().currentAgentId,
    currentAgentName: report.agent_name || AtlasVoiceContext.get().currentAgentName,
  });

  modal.dataset.activeReportId = report.id;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function _agentStage(agentId) {
  return COUNCIL_ORDER.find(s => STAGE_AGENT[s] === agentId) || null;
}

async function _sendToNextAgent(report) {
  const pid = _projectId(report);
  const stage = _agentStage(report.agent_id);
  const nextStage = stage ? STAGE_NEXT[stage] : null;
  if (!pid || !nextStage) {
    if (_deps.showToast) _deps.showToast('No linked project or next stage for this report');
    return;
  }
  const agentName = STAGE_AGENT[nextStage] || nextStage;
  const ok = window.confirm(
    `Send council review to ${nextStage} agent for ${_projectLabel(pid)}?\n\nThis will generate a new report — nothing runs until you confirm.`
  );
  if (!ok) return;
  const res = await fetch(`/api/cerberus/council/review/${pid}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: nextStage }),
  });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Next stage started' : 'Failed'));
  if (data.ok) {
    await refreshAgentsOffice();
    if (data.report?.id) openReport(data.report.id);
    if (window.atlasPipelineRefresh) window.atlasPipelineRefresh();
  }
}

async function _reportAction(action, extra = {}) {
  if (!_activeReportId) return;
  const report = _findReport(_activeReportId);

  if (action === 'open_project' && extra.projectId) {
    const hq = await import('./atlasProjectHQ.js');
    _closeReportModal();
    await hq.default.openProjectHQ(extra.projectId);
    return;
  }

  if (action === 'ask_atlas') {
    const prompt = `Review this council report and advise next steps:\n\n**${report?.title || 'Report'}**\n${report?.summary || ''}`;
    if (_deps.openAssistant) _deps.openAssistant(prompt, { submit: false });
    return;
  }

  if (action === 'send_next') {
    if (report) await _sendToNextAgent(report);
    return;
  }

  try {
    const res = await fetch(`/api/cerberus/reports/${_activeReportId}/action`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (_deps.showToast) _deps.showToast(data.message || 'Updated');
    if (data.agents) _agents = data.agents;
    await _fetchReports();
    if (data.report) {
      const idx = _reports.findIndex(r => r.id === data.report.id);
      if (idx >= 0) _reports[idx] = data.report;
      _openReportPanel(data.report);
    }
    _renderPods();
    _renderSidebar();
    if (action === 'approve' && window.atlasPipelineRefresh) window.atlasPipelineRefresh();
    if (action === 'archive') _closeReportModal();
    if (_activeAgentOfficeId) _openAgentOffice(_activeAgentOfficeId);
  } catch (_) {
    if (_deps.showToast) _deps.showToast('Report action failed');
  }
}

function _closeAgentOffice() {
  const modal = _el('cerberus-agent-office-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  _activeAgentOfficeId = null;
  AtlasVoiceContext.clear('agent');
  AtlasVoiceContext.clear('modal');
}

function _officeReportRow(r) {
  const pid = _projectId(r);
  const created = r.created_at ? new Date(r.created_at).toLocaleString() : '';
  return `
    <li class="cerberus-office-report" data-report-id="${_esc(r.id)}" role="button" tabindex="0">
      <div class="cerberus-office-report-head">
        <strong>${_esc(r.title || 'Report')}</strong>
        <span class="cerberus-office-report-status">${_esc(_statusLabel(r.status))}</span>
      </div>
      <p class="cerberus-office-report-meta">${_esc(_projectLabel(pid))} · ${_esc(created)}</p>
      <p class="cerberus-office-report-summary">${_esc((r.summary || '').slice(0, 140))}</p>
    </li>
  `;
}

function _populateAgentMessageControls(agentId) {
  const projectSel = _el('cerberus-agent-message-project');
  const typeSel = _el('cerberus-agent-message-type');
  if (projectSel) {
    const current = projectSel.value;
    projectSel.innerHTML = '<option value="">General (no project)</option>'
      + _projects.map(p => `<option value="${_esc(p.id)}">${_esc(p.name)}</option>`).join('');
    if (current) projectSel.value = current;
  }
  if (typeSel) {
    const types = AGENT_REPORT_TYPES[agentId] || [{ id: 'research_report', label: 'Report' }];
    typeSel.innerHTML = types.map(t => `<option value="${_esc(t.id)}">${_esc(t.label)}</option>`).join('');
  }
}

function _renderAgentInbox(agent, buckets) {
  const inbox = _el('cerberus-agent-office-inbox');
  if (!inbox) return;
  const waiting = buckets.waiting;
  inbox.innerHTML = `
    <h3 class="cerberus-agent-section-title">Agent Inbox</h3>
    <dl class="cerberus-agent-inbox-meta">
      <div><dt>Status</dt><dd>${_esc(_statusLabel(_agentStatus(agent)))}</dd></div>
      <div><dt>Current task</dt><dd class="cerberus-agent-inbox-ellipsis">${_esc(agent.current_task || '—')}</dd></div>
      <div><dt>Waiting on</dt><dd class="cerberus-agent-inbox-ellipsis">${_esc(agent.waiting_on || '—')}</dd></div>
      <div><dt>Pending reports</dt><dd>${buckets.pending.length}</dd></div>
      <div><dt>Awaiting approval</dt><dd>${waiting.length}</dd></div>
    </dl>
    ${waiting.length ? `
      <h4 class="cerberus-agent-inbox-sub">Waiting for approval</h4>
      <ul class="cerberus-agent-inbox-list">
        ${waiting.slice(0, 5).map(r => `
          <li><button type="button" class="cerberus-agent-inbox-link" data-report-id="${_esc(r.id)}">${_esc((r.title || 'Report').slice(0, 48))}</button></li>
        `).join('')}
      </ul>
    ` : '<p class="cerberus-agent-inbox-empty">No reports awaiting approval.</p>'}
  `;
}

function _openAgentOffice(agentId) {
  const agent = _agents.find(a => a.id === agentId);
  if (!agent) return;
  _activeAgentOfficeId = agentId;
  const modal = _el('cerberus-agent-office-modal');
  const buckets = _bucketReports(agentId);

  _el('cerberus-agent-office-dept').textContent = _deptName(agent);
  _el('cerberus-agent-office-title').textContent = agent.name;
  _el('cerberus-agent-office-role').textContent = agent.role || '';

  _renderAgentInbox(agent, buckets);
  _populateAgentMessageControls(agentId);

  const input = _el('cerberus-agent-message-input');
  if (input && !input.dataset.touched) input.value = '';

  const sections = [
    ['Pending', buckets.pending],
    ['Waiting for Approval', buckets.waiting],
    ['Approved', buckets.approved],
    ['Archived', buckets.archived],
  ];

  _el('cerberus-agent-office-reports').innerHTML = sections.map(([label, items]) => `
    <section class="cerberus-office-report-section">
      <h3>${_esc(label)} <span class="cerberus-office-count">${items.length}</span></h3>
      <ul class="cerberus-office-report-list">
        ${items.length ? items.map(_officeReportRow).join('') : '<li class="cerberus-office-empty">None</li>'}
      </ul>
    </section>
  `).join('');

  AtlasVoiceContext.set({
    currentModal: 'agent_office',
    currentAgentId: agentId,
    currentAgentName: agent.name,
    currentSelectionType: 'agent',
    currentSelectionLabel: agent.name,
  });

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

export function openAgent(agentId) {
  _openAgentOffice(agentId);
}

function _setCaptureStatus(text, visible = true) {
  const status = _el('cerberus-agent-message-capture-status');
  if (!status) return;
  if (!visible || !text) {
    status.textContent = '';
    status.classList.add('hidden');
    return;
  }
  status.textContent = text;
  status.classList.remove('hidden');
}

export function enterMessageCapture(agentId, label) {
  const aid = agentId || _activeAgentOfficeId;
  if (aid && aid !== _activeAgentOfficeId) _openAgentOffice(aid);
  _messageCaptureActive = true;
  const agent = _agents.find((a) => a.id === aid);
  const name = label || agent?.name || 'Agent';
  const input = _el('cerberus-agent-message-input');
  if (input) {
    input.placeholder = 'Speak your message…';
    input.value = input.value || '';
    input.classList.add('cerberus-agent-message-input--capture');
    input.focus();
    input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  _setCaptureStatus(`Dictating to ${name}…`);
  const conv = _el('cerberus-agent-office-conversation');
  conv?.classList.add('cerberus-agent-conversation--capture');
}

export function exitMessageCapture() {
  _messageCaptureActive = false;
  const input = _el('cerberus-agent-message-input');
  if (input) {
    input.placeholder = 'Message this agent…';
    input.classList.remove('cerberus-agent-message-input--capture');
  }
  _setCaptureStatus('', false);
  _el('cerberus-agent-office-conversation')?.classList.remove('cerberus-agent-conversation--capture');
}

export function updateAgentMessageDraft(text, agentId) {
  if (agentId && agentId !== _activeAgentOfficeId) _openAgentOffice(agentId);
  const input = _el('cerberus-agent-message-input');
  if (input) {
    input.value = text || '';
    input.dataset.touched = '1';
  }
  if (_messageCaptureActive) {
    const agent = _agents.find((a) => a.id === (_activeAgentOfficeId || agentId));
    _setCaptureStatus(`Dictating to ${agent?.name || 'Agent'}… (${(text || '').split(/\s+/).length} words)`);
  }
}

export function setAgentGenerating(agentId, label) {
  if (agentId) _setAgentWorking(agentId, true);
  _setCaptureStatus(label || 'Generating report…');
  const sendBtn = _el('cerberus-agent-message-send');
  if (sendBtn) sendBtn.disabled = true;
}

export function focusAgentMessage(agentId) {
  enterMessageCapture(agentId);
}

export function setAgentReportType(agentId, reportType) {
  if (agentId && agentId !== _activeAgentOfficeId) _openAgentOffice(agentId);
  const typeSel = _el('cerberus-agent-message-type');
  if (typeSel && reportType) typeSel.value = reportType;
}

export async function sendAgentMessage(agentId, message, projectId, reportType) {
  if (agentId && agentId !== _activeAgentOfficeId) _openAgentOffice(agentId);
  const input = _el('cerberus-agent-message-input');
  if (input) input.value = message || '';
  if (projectId) {
    const projectSel = _el('cerberus-agent-message-project');
    if (projectSel) projectSel.value = projectId;
  }
  if (reportType) setAgentReportType(agentId, reportType);
  _activeAgentOfficeId = agentId;
  return _sendAgentMessage();
}

function _pickLatestReport(agentId, projectId) {
  const all = _reportsForAgent(agentId);
  const ctxProject = projectId || AtlasVoiceContext.get().currentProjectId;
  const prefer = (list) => {
    if (!ctxProject) return list;
    const linked = list.filter((r) => _projectId(r) === ctxProject);
    return linked.length ? linked : list;
  };
  const waiting = prefer(all.filter((r) => r.status === 'waiting_for_review'));
  if (waiting.length) {
    return waiting.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  }
  const pending = prefer(all.filter((r) => ['pending', 'generating', 'revision_requested'].includes(r.status)));
  if (pending.length) return pending[0];
  if (all.length) return all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  return null;
}

export async function pickLatestReportInfo(agentId) {
  const aid = agentId || _activeAgentOfficeId || AtlasVoiceContext.get().currentAgentId;
  if (!aid) return { ok: false, message: 'No agent selected.' };
  await _fetchReports();
  const latest = _pickLatestReport(aid);
  const agent = _agents.find((a) => a.id === aid);
  const label = agent?.name || aid;
  if (!latest) return { ok: false, message: `No report found for ${label}.` };
  return { ok: true, reportId: latest.id, report: latest, message: `Opening latest report for ${label}.` };
}

export async function openLatestReport(agentId) {
  const info = await pickLatestReportInfo(agentId);
  if (!info.ok) return info;
  await openReportById(info.reportId);
  return info;
}

export function showAgentNotice(message) {
  if (!message) return;
  _setCaptureStatus(message, true);
  if (_deps.showToast) _deps.showToast(message);
}

export function hasOpenModal() {
  const reportModal = _el('cerberus-report-modal');
  if (reportModal && !reportModal.classList.contains('hidden')) return true;
  const agentModal = _el('cerberus-agent-office-modal');
  if (agentModal && !agentModal.classList.contains('hidden')) return true;
  if (window.AtlasOverlayTools?.anyOverlayOpen?.()) return true;
  const council = _el('cerberus-council-modal');
  if (council && !council.classList.contains('hidden')) return true;
  const hq = _el('cerberus-project-hq');
  if (hq && !hq.classList.contains('hidden')) return true;
  return false;
}

export async function openReportByTitle(query, agentId) {
  const aid = agentId || _activeAgentOfficeId;
  const q = String(query || '').toLowerCase();
  const match = _reports.find((r) => {
    if (aid && r.agent_id !== aid) return false;
    const title = (r.title || '').toLowerCase();
    return title.includes(q) || q.includes(title);
  });
  if (!match) return false;
  openReport(match.id);
  return true;
}

export async function actOnReport(reportId, action) {
  _activeReportId = reportId;
  await _reportAction(action);
  return true;
}

export async function closeActiveModal() {
  const reportModal = _el('cerberus-report-modal');
  if (reportModal && !reportModal.classList.contains('hidden')) {
    _closeReportModal();
    return true;
  }
  const agentModal = _el('cerberus-agent-office-modal');
  if (agentModal && !agentModal.classList.contains('hidden')) {
    _closeAgentOffice();
    return true;
  }
  if (window.AtlasOverlayTools?.anyOverlayOpen?.()) {
    return window.AtlasOverlayTools.closeTopOverlay();
  }
  const council = _el('cerberus-council-modal');
  if (council && !council.classList.contains('hidden')) {
    _closeCouncilModal();
    return true;
  }
  const hq = _el('cerberus-project-hq');
  if (hq && !hq.classList.contains('hidden')) {
    const mod = await import('./atlasProjectHQ.js');
    mod.default.closeProjectHQ?.();
    return true;
  }
  return false;
}

async function _sendAgentMessage() {
  if (!_activeAgentOfficeId) return { ok: false, message: 'No agent selected.' };
  const input = _el('cerberus-agent-message-input');
  const message = (input?.value || '').trim();
  if (!message) {
    if (_deps.showToast) _deps.showToast('Enter a message for the agent');
    return { ok: false, message: 'No message to send.' };
  }
  const projectId = _el('cerberus-agent-message-project')?.value || '';
  const reportType = _el('cerberus-agent-message-type')?.value || '';
  const sendBtn = _el('cerberus-agent-message-send');
  if (sendBtn) sendBtn.disabled = true;
  if (input) input.dataset.touched = '1';
  _setAgentWorking(_activeAgentOfficeId, true);
  setAgentGenerating(_activeAgentOfficeId, 'Generating report…');

  try {
    const body = { message };
    if (projectId) body.project_id = projectId;
    if (reportType) body.report_type = reportType;
    const res = await fetch(`/api/cerberus/agents/${_activeAgentOfficeId}/message`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Report ready' : 'Message failed'));
    if (data.agents) _agents = data.agents;
    if (data.ok && data.report) {
      await _fetchReports();
      if (input) {
        input.value = '';
        delete input.dataset.touched;
      }
      exitMessageCapture();
      _openAgentOffice(_activeAgentOfficeId);
      await openReportById(data.report.id);
      return { ok: true, message: 'Research report ready.', report: data.report };
    }
    await refreshAgentsOffice();
    if (_activeAgentOfficeId) _openAgentOffice(_activeAgentOfficeId);
    return { ok: !!data.ok, message: data.message || 'Message failed.' };
  } catch (_) {
    if (_deps.showToast) _deps.showToast('Failed to send message to agent');
    return { ok: false, message: 'Failed to send message.' };
  } finally {
    _setAgentWorking(_activeAgentOfficeId, false);
    exitMessageCapture();
    if (sendBtn) sendBtn.disabled = false;
  }
}

function _closeCouncilModal() {
  const modal = _el('cerberus-council-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function _openCouncilModal() {
  await _getBriefingV2();
  const modal = _el('cerberus-council-modal');
  const body = _el('cerberus-council-modal-body');
  const sub = _el('cerberus-council-modal-sub');
  if (!modal || !body) return;

  const v = _briefingV2?.visual || {};
  const approval = _queue.waiting_for_approval || [];
  const deepReports = _reports.filter(r => {
    const t = (r.title || '').toLowerCase();
    return t.includes('market') || t.includes('monetisation') || t.includes('architecture')
      || t.includes('codebase') || t.includes('launch');
  }).slice(0, 6);

  const projectReviews = [...new Set(
    approval.map(r => _projectId(r)).filter(Boolean)
  )].map(pid => {
    const meta = _projectMeta(pid);
    return meta ? { id: pid, ...meta } : { id: pid, name: pid };
  });

  const nextDecision = approval[0]
    ? `Approve "${approval[0].title}" from ${approval[0].agent_name} (${_projectLabel(_projectId(approval[0]))})`
    : (v.recommendation || 'Run a council review on your top-priority project.');

  if (sub) {
    sub.textContent = _council?.rules?.[0] || 'Reports only — approval required between stages.';
  }

  const members = COUNCIL_ORDER.map(id => {
    const a = _agents.find(x => x.id === id);
    return a ? `<li><strong>${_esc(_deptName(a))}</strong> — ${_esc(a.name)} · ${_esc(_statusLabel(_agentStatus(a)))}</li>` : '';
  }).join('');

  body.innerHTML = `
    <section class="cerberus-council-section">
      <h3>1. Council Members</h3>
      <ul class="cerberus-council-list">${members}</ul>
    </section>
    <section class="cerberus-council-section">
      <h3>2. Active Project Reviews</h3>
      ${projectReviews.length ? `<ul class="cerberus-council-list">${projectReviews.map(p => `
        <li><strong>${_esc(p.name)}</strong>${p.score != null ? ` · ${p.score}/100` : ''}${p.stage ? ` · ${_esc(p.stage)}` : ''}</li>
      `).join('')}</ul>` : '<p class="cerberus-council-empty">No projects awaiting council approval.</p>'}
    </section>
    <section class="cerberus-council-section">
      <h3>3. Reports Waiting for Approval</h3>
      ${approval.length ? `<ul class="cerberus-council-list">${approval.slice(0, 8).map(r => `
        <li><button type="button" class="cerberus-council-report-link" data-report-id="${_esc(r.id)}">${_esc(r.title)}</button> — ${_esc(_projectLabel(_projectId(r)))}</li>
      `).join('')}</ul>` : '<p class="cerberus-council-empty">Nothing awaiting approval.</p>'}
    </section>
    <section class="cerberus-council-section">
      <h3>4. Recent Council Reports</h3>
      ${deepReports.length ? `<ul class="cerberus-council-list">${deepReports.map(r => `
        <li><button type="button" class="cerberus-council-report-link" data-report-id="${_esc(r.id)}">${_esc(r.title)}</button></li>
      `).join('')}</ul>` : '<p class="cerberus-council-empty">No recent council reports.</p>'}
    </section>
    <section class="cerberus-council-section">
      <h3>5. Daily Briefing</h3>
      <p>${_esc(v.headline || '')}</p>
      <p class="cerberus-council-rec">${_esc(v.recommendation || '')}</p>
    </section>
    <section class="cerberus-council-section atlas-council-section--decision">
      <h3>6. Recommended Next Decision</h3>
      <p class="cerberus-council-decision">${_esc(nextDecision)}</p>
    </section>
  `;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

export function startAgentLines() {
  _linesRunning = true;
  _drawConnectionLines();
}

export function stopAgentLines() {
  _linesRunning = false;
  if (_linesRaf) cancelAnimationFrame(_linesRaf);
  _linesRaf = 0;
  const canvas = _el('cerberus-agents-lines');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function _podCenter(pod, rect) {
  const pr = pod.getBoundingClientRect();
  return {
    x: pr.left + pr.width / 2 - rect.left,
    y: pr.top + pr.height / 2 - rect.top,
  };
}

function _drawConnectionLines() {
  if (!_linesRunning) return;
  const canvas = _el('cerberus-agents-lines');
  const network = _el('cerberus-agents-network');
  const hub = _el('cerberus-council-hub');
  if (!canvas || !network) return;

  const rect = network.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const t = performance.now() * 0.001;

  const pods = COUNCIL_ORDER.map(id => document.querySelector(`.atlas-agent-pod[data-agent-id="${id}"]`)).filter(Boolean);
  const points = pods.map(p => _podCenter(p, rect));

  function drawSegment(a, b, { alpha = 0.3, width = 1, dash = [6, 10], color = '80, 200, 255', speed = 45 } = {}) {
    const pulse = 0.25 + Math.sin(t * 2.5) * 0.15;
    ctx.strokeStyle = `rgba(${color}, ${alpha + pulse * 0.15})`;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -t * speed;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawArrow(a, b, progress) {
    const px = a.x + (b.x - a.x) * progress;
    const py = a.y + (b.y - a.y) * progress;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const size = 5;
    ctx.fillStyle = 'rgba(100, 220, 255, 0.75)';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ang) * size, py + Math.sin(ang) * size);
    ctx.lineTo(px + Math.cos(ang + 2.6) * size, py + Math.sin(ang + 2.6) * size);
    ctx.lineTo(px + Math.cos(ang - 2.6) * size, py + Math.sin(ang - 2.6) * size);
    ctx.closePath();
    ctx.fill();
  }

  let hubPt = null;
  if (hub) {
    const hr = hub.getBoundingClientRect();
    hubPt = { x: hr.left + hr.width / 2 - rect.left, y: hr.top + hr.height / 2 - rect.top };
    ctx.beginPath();
    ctx.arc(hubPt.x, hubPt.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(100, 220, 255, ${0.28 + Math.sin(t * 2) * 0.08})`;
    ctx.fill();
  }

  if (hubPt) {
    points.forEach((pt) => {
      drawSegment(hubPt, pt, { alpha: 0.12, width: 0.8, dash: [3, 12], speed: 20 });
    });
  }

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const working = pods[i]?.classList.contains('cerberus-agent-pod--working')
      || pods[i + 1]?.classList.contains('cerberus-agent-pod--working');
    drawSegment(a, b, {
      alpha: working ? 0.55 : 0.38,
      width: working ? 2.2 : 1.6,
      dash: [10, 8],
      color: '60, 180, 255',
      speed: 70,
    });
    const travel = (t * 0.35 + i * 0.18) % 1;
    drawArrow(a, b, travel);
    drawArrow(a, b, (travel + 0.35) % 1);
  }

  points.forEach((pt, i) => {
    const working = pods[i]?.classList.contains('cerberus-agent-pod--working');
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, working ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120, 230, 255, ${working ? 0.8 : 0.5})`;
    ctx.fill();
  });

  _linesRaf = requestAnimationFrame(_drawConnectionLines);
}

function _bindEvents() {
  _el('cerberus-agents-controls')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-agent-id][data-action]');
    if (!btn || btn.disabled) return;
    await _runAction(btn.dataset.agentId, btn.dataset.action);
  });

  _el('cerberus-council-hub')?.addEventListener('click', () => { void _openCouncilModal(); });
  _el('cerberus-hq-open-council')?.addEventListener('click', () => { void _openCouncilModal(); });

  const office = _el('cerberus-agents-office');
  if (office) {
    office.addEventListener('click', (e) => {
      const pod = e.target.closest('[data-agent-office]');
      if (pod) {
        _openAgentOffice(pod.dataset.agentOffice);
        return;
      }
    });
    office.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const pod = e.target.closest('[data-agent-office]');
      if (!pod) return;
      e.preventDefault();
      _openAgentOffice(pod.dataset.agentOffice);
    });
  }

  _el('cerberus-agent-office-modal')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-atlas-agent-office-close]')) _closeAgentOffice();
    const row = e.target.closest('[data-report-id]');
    if (row) openReport(row.dataset.reportId);
  });

  _el('cerberus-agent-message-send')?.addEventListener('click', () => { void _sendAgentMessage(); });

  _el('cerberus-agent-message-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void _sendAgentMessage();
    }
  });

  _el('cerberus-council-modal')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-atlas-council-close]')) _closeCouncilModal();
    const link = e.target.closest('[data-report-id]');
    if (link) {
      _closeCouncilModal();
      openReport(link.dataset.reportId);
    }
  });

  const modal = _el('cerberus-report-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-atlas-report-close]')) _closeReportModal();
      const actionBtn = e.target.closest('[data-report-action]');
      if (actionBtn) {
        _reportAction(actionBtn.dataset.reportAction, {
          projectId: actionBtn.dataset.projectId,
        });
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (_activeReportId) _closeReportModal();
    else if (_activeAgentOfficeId) _closeAgentOffice();
    else _closeCouncilModal();
  });

  window.addEventListener('resize', () => {
    if (_linesRunning) _drawConnectionLines();
  });
}

export function initAgentsOffice(deps = {}) {
  _deps = deps;
  _bindEvents();
}

const agentsOfficeModule = {
  initAgentsOffice,
  renderAgentsOffice,
  refreshAgentsOffice,
  startAgentLines,
  stopAgentLines,
  openReport,
  openReportById,
  openAgent,
  focusAgentMessage,
  enterMessageCapture,
  exitMessageCapture,
  updateAgentMessageDraft,
  setAgentGenerating,
  sendAgentMessage,
  openLatestReport,
  pickLatestReportInfo,
  openReportByTitle,
  actOnReport,
  closeActiveModal,
  hasOpenModal,
  showAgentNotice,
  setAgentReportType,
};

window.AtlasAgentsUI = {
  openAgent,
  focusAgentMessage,
  enterMessageCapture,
  exitMessageCapture,
  updateAgentMessageDraft,
  setAgentGenerating,
  sendAgentMessage,
  openReport,
  openReportById,
  openLatestReport,
  pickLatestReportInfo,
  openReportByTitle,
  actOnReport,
  closeActiveModal,
  hasOpenModal,
  showAgentNotice,
  setAgentReportType,
  refreshOffice: refreshAgentsOffice,
};

export default agentsOfficeModule;
