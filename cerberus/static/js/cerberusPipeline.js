// Cerberus OS — Council Pipeline UI V2

import agentsOfficeModule from './agentsOffice.js';

const STAGES = ['research', 'business', 'architect', 'developer', 'marketing'];

const STAGE_LABELS = {
  research: 'Research',
  business: 'Business',
  architect: 'Architect',
  developer: 'Developer',
  marketing: 'Marketing',
};

const SEND_ACTIONS = {
  research: 'send_to_business',
  business: 'send_to_architect',
  architect: 'send_to_developer',
  developer: 'send_to_marketing',
};

let _items = [];
let _reports = [];
let _projects = [];
let _deps = {};

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

async function _fetchPipeline() {
  try {
    const res = await fetch('/api/cerberus/pipeline', { credentials: 'same-origin' });
    const data = await res.json();
    _items = Array.isArray(data.items) ? data.items : [];
  } catch (_) {
    _items = [];
  }
  return _items;
}

async function _fetchContext() {
  try {
    const [repRes, projRes] = await Promise.all([
      fetch('/api/cerberus/reports', { credentials: 'same-origin' }),
      fetch('/api/cerberus/projects', { credentials: 'same-origin' }),
    ]);
    if (repRes.ok) {
      const d = await repRes.json();
      _reports = Array.isArray(d.reports) ? d.reports : [];
    }
    if (projRes.ok) {
      const d = await projRes.json();
      _projects = Array.isArray(d.projects) ? d.projects : [];
    }
  } catch (_) {}
}

function _projectForItem(item) {
  const reportIds = item.reports || [];
  for (const rid of reportIds) {
    const r = _reports.find(x => x.id === rid);
    const pid = r?.linked_project_id || r?.project_id;
    if (pid) {
      const p = _projects.find(x => x.id === pid);
      return { id: pid, name: p?.name || pid, score: p?.potential_score, stage: p?.current_stage };
    }
  }
  const title = (item.title || '').toLowerCase();
  const match = _projects.find(p => title.includes((p.name || '').toLowerCase()));
  if (match) {
    return { id: match.id, name: match.name, score: match.potential_score, stage: match.current_stage };
  }
  return { id: '', name: item.title || 'Council item', score: null, stage: null };
}

function _stageStatus(item, stage) {
  const current = item.current_stage || 'research';
  const status = item.status || 'active';
  const idx = STAGES.indexOf(stage);
  const curIdx = STAGES.indexOf(current);

  if (status === 'revision' && stage === current) return 'revision_requested';
  if (status === 'rejected') return 'not_started';
  if (status === 'completed') return idx <= curIdx ? 'approved' : 'not_started';
  if (idx < curIdx) return 'approved';
  if (idx === curIdx) {
    if (status === 'active') return 'in_progress';
    return 'waiting_approval';
  }
  return 'not_started';
}

function _latestReportForStage(item, stage) {
  const agentId = stage;
  const linked = (item.reports || [])
    .map(rid => _reports.find(r => r.id === rid))
    .filter(Boolean)
    .filter(r => r.agent_id === agentId);
  if (linked.length) return linked[linked.length - 1];
  const proj = _projectForItem(item);
  if (!proj.id) return null;
  return _reports.find(r => (r.linked_project_id || r.project_id) === proj.id && r.agent_id === agentId);
}

function _stageClass(status) {
  return `atlas-pipe-stage--${status.replace(/_/g, '-')}`;
}

function _renderItems() {
  const list = _el('cerberus-pipeline-items');
  if (!list) return;
  if (!_items.length) {
    list.innerHTML = '<p class="cerberus-panel-empty">No council pipeline items yet. Approve a research report or run Full Council Review on a project.</p>';
    return;
  }

  list.innerHTML = _items.map(item => {
    const proj = _projectForItem(item);
    const current = item.current_stage || 'research';
    const currentReport = _latestReportForStage(item, current);
    const nextAction = item.next_agent
      ? `Awaiting ${item.next_agent} agent`
      : (item.status === 'completed' ? 'Council review complete' : `Stage: ${current}`);

    const stagesHtml = STAGES.map((s, i) => {
      const st = _stageStatus(item, s);
      const rep = _latestReportForStage(item, s);
      return `
        <div class="cerberus-pipe-stage ${_stageClass(st)}" data-stage="${s}">
          <span class="cerberus-pipe-stage-label">${STAGE_LABELS[s]}</span>
          <span class="cerberus-pipe-stage-state">${st.replace(/_/g, ' ')}</span>
          ${rep ? `<button type="button" class="cerberus-pipe-stage-report" data-report-id="${_esc(rep.id)}">${_esc((rep.title || '').slice(0, 28))}</button>` : ''}
          ${i < STAGES.length - 1 ? '<span class="cerberus-pipe-stage-arrow" aria-hidden="true">→</span>' : ''}
        </div>
      `;
    }).join('');

    return `
      <article class="cerberus-pipeline-card" data-pipeline-id="${_esc(item.id)}">
        <header class="cerberus-pipeline-card-head">
          <div>
            <h4>${_esc(proj.name)}</h4>
            <p class="cerberus-pipeline-card-meta">
              ${proj.score != null ? `Score ${proj.score}/100` : ''}
              ${proj.stage ? ` · ${_esc(proj.stage)}` : ''}
              · Current: <strong>${_esc(STAGE_LABELS[current] || current)}</strong>
            </p>
          </div>
          <span class="cerberus-pipeline-card-status">${_esc(item.status || 'active')}</span>
        </header>
        <div class="cerberus-pipeline-card-flow">${stagesHtml}</div>
        <p class="cerberus-pipeline-card-next">${_esc(nextAction)}</p>
        <div class="cerberus-pipeline-card-actions">
          ${proj.id ? `<button type="button" class="cerberus-pipeline-btn" data-pipeline-action="open_project" data-project-id="${_esc(proj.id)}">Open Project</button>` : ''}
          ${currentReport ? `<button type="button" class="cerberus-pipeline-btn" data-pipeline-action="open_report" data-report-id="${_esc(currentReport.id)}">Open Current Report</button>` : ''}
          <button type="button" class="cerberus-pipeline-btn" data-pipeline-action="approve" data-id="${_esc(item.id)}">Approve Current Stage</button>
          ${SEND_ACTIONS[current] ? `<button type="button" class="cerberus-pipeline-btn atlas-pipeline-btn--send" data-pipeline-action="${SEND_ACTIONS[current]}" data-id="${_esc(item.id)}">Send to Next Agent</button>` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function _pipelineAction(id, action, extra = {}) {
  if (action === 'open_report' && extra.reportId) {
    agentsOfficeModule.openReport(extra.reportId);
    return;
  }
  if (action === 'open_project' && extra.projectId) {
    const hq = await import('./cerberusProjectHQ.js');
    await hq.default.openProjectHQ(extra.projectId);
    return;
  }

  if (action.startsWith('send_to_')) {
    const ok = window.confirm(
      'Send to next agent? This may generate a new report using the existing pipeline flow. Confirm to proceed.'
    );
    if (!ok) return;
  }

  const res = await fetch(`/api/cerberus/pipeline/${id}/action`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Updated' : 'Failed'));
  if (data.items) _items = data.items;
  await _fetchContext();
  _renderItems();
  if (_deps.onPipelineUpdate) _deps.onPipelineUpdate(data);
  if (data.run_result?.report?.id) {
    agentsOfficeModule.openReport(data.run_result.report.id);
  }
  return data;
}

function _bindEvents() {
  const wrap = _el('cerberus-pipeline-section');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const reportBtn = e.target.closest('[data-report-id]');
    if (reportBtn && !e.target.closest('[data-pipeline-action]')) {
      agentsOfficeModule.openReport(reportBtn.dataset.reportId);
      return;
    }
    const btn = e.target.closest('[data-pipeline-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.pipelineAction;
    _pipelineAction(id || '', action, {
      reportId: btn.dataset.reportId,
      projectId: btn.dataset.projectId,
    });
  });
}

export async function renderPipeline() {
  await Promise.all([_fetchPipeline(), _fetchContext()]);
  _renderItems();
}

export function initAtlasPipeline(deps = {}) {
  _deps = deps;
  _bindEvents();
}

const cerberusPipelineModule = {
  initAtlasPipeline,
  renderPipeline,
};

export default cerberusPipelineModule;
