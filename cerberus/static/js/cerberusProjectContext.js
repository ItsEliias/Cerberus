// Shared Project Context modal — Home + Projects

import cerberusActiveProject from './cerberusActiveProject.js';

let _ctx = null;
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

function _fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function _changeCount(p) {
  const ch = p?.recent_changes || _ctx?.recent_changes || {};
  return (ch.new_count || 0) + (ch.modified_count || 0) + (ch.deleted_count || 0);
}

async function _fetchContext(projectId) {
  const res = await fetch(`/api/cerberus/projects/${projectId}/context`, { credentials: 'same-origin' });
  return res.json();
}

async function _runAgent(agentId, action, projectId) {
  const res = await fetch('/api/cerberus/agents/run', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, action, project_id: projectId }),
  });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Report queued' : 'Failed'));
  return data;
}

async function _togglePin(projectId) {
  const res = await fetch(`/api/cerberus/projects/${projectId}/pin`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok && _ctx?.project) {
    _ctx.project.pinned = data.pinned;
    _renderModal();
  }
  if (_deps.onPinChange) _deps.onPinChange(data);
  if (_deps.showToast) _deps.showToast(data.pinned ? 'Project pinned' : 'Project unpinned');
}

function _renderModal() {
  const modal = _el('cerberus-project-context-modal');
  if (!modal || !_ctx?.ok) return;
  const p = _ctx.project || {};
  const meta = _ctx.index_meta || {};
  const fin = _ctx.finance || {};

  _el('cerberus-pctx-title').textContent = `Project Context: ${p.name || 'Project'}`;
  _el('cerberus-pctx-path').textContent = p.display_path || p.path || '—';
  _el('cerberus-pctx-stack').textContent = (p.detected_stack || []).join(' · ') || p.type || '—';
  _el('cerberus-pctx-files').textContent = `${meta.file_count || p.file_count || 0} files · ${_fmtBytes(meta.folder_size_bytes)}`;
  _el('cerberus-pctx-indexed').textContent = p.last_indexed_at
    ? `Last indexed ${new Date(p.last_indexed_at).toLocaleString()}`
    : 'Not indexed';
  _el('cerberus-pctx-changes').textContent = `${_changeCount(p)} recent changes`;
  _el('cerberus-pctx-potential').textContent = `Potential score: ${_ctx.potential_score ?? 0}/100`;
  _el('cerberus-pctx-direction').textContent = _ctx.proposed_direction || '—';

  const reportsEl = _el('cerberus-pctx-reports');
  if (reportsEl) {
    const reps = _ctx.reports || [];
    reportsEl.innerHTML = reps.length
      ? `<ul>${reps.slice(0, 5).map(r => `<li>${_esc(r.title || r.summary || 'Report')} <span class="cerberus-pctx-report-meta">${_esc(r.agent_name || '')}</span></li>`).join('')}</ul>`
      : '<p class="cerberus-panel-empty">No reports yet.</p>';
  }

  const finEl = _el('cerberus-pctx-finance');
  if (finEl) {
    finEl.textContent = fin.monetisation_strategy
      ? fin.monetisation_strategy.slice(0, 200)
      : 'No monetisation data — see Finance → Project Breakdown.';
  }

  const pinBtn = _el('cerberus-pctx-pin');
  if (pinBtn) pinBtn.textContent = p.pinned ? 'Unpin' : 'Pin';
}

export async function openProjectContext(projectId) {
  const data = await _fetchContext(projectId);
  if (!data.ok) {
    if (_deps.showToast) _deps.showToast(data.message || 'Could not load project context');
    return;
  }
  _ctx = data;
  const modal = _el('cerberus-project-context-modal');
  if (!modal) return;
  _renderModal();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  modal.dataset.projectId = projectId;
}

export function closeProjectContext() {
  const modal = _el('cerberus-project-context-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

export async function openSummaryFromContext(projectId) {
  if (_deps.openSummary) return _deps.openSummary(projectId);
  const res = await fetch(`/api/cerberus/projects/${projectId}/summary`, { credentials: 'same-origin' });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.ok ? 'Summary loaded in Projects' : (data.message || 'Index first'));
}

function _bindEvents() {
  const modal = _el('cerberus-project-context-modal');
  if (!modal) return;
  modal.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pctx-close]')) { closeProjectContext(); return; }
    const pid = modal.dataset.projectId;
    if (!pid) return;
    if (e.target.closest('[data-pctx-ask-chat]')) {
      cerberusActiveProject.openAssistantWithProject(pid, _ctx?.project?.name);
      closeProjectContext();
      return;
    }
    if (e.target.closest('[data-pctx-dev-review]')) {
      await _runAgent('developer', 'developer_project_review', pid);
      return;
    }
    if (e.target.closest('[data-pctx-architect]')) {
      await _runAgent('architect', 'architecture_plan', pid);
      return;
    }
    if (e.target.closest('[data-pctx-business]')) {
      await _runAgent('business', 'business_analysis', pid);
      return;
    }
    if (e.target.closest('[data-pctx-marketing]')) {
      await _runAgent('marketing', 'marketing_ideas', pid);
      return;
    }
    if (e.target.closest('[data-pctx-summary]')) {
      await openSummaryFromContext(pid);
      return;
    }
    if (e.target.closest('[data-pctx-pin]')) {
      await _togglePin(pid);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeProjectContext();
  });
}

export function initAtlasProjectContext(deps = {}) {
  _deps = deps;
  _bindEvents();
}

export function getProjectContextData() {
  return _ctx;
}

const cerberusProjectContext = {
  openProjectContext,
  closeProjectContext,
  initAtlasProjectContext,
  getProjectContextData,
};

export default cerberusProjectContext;
