// Cerberus OS — Projects module + Docker-mounted Atlas Workspace

import workspaceModule from './workspace.js';
import cerberusActiveProject from './cerberusActiveProject.js';
import cerberusProjectContext from './cerberusProjectContext.js';
import AtlasVoiceContext from './cerberusVoiceContext.js';
import cerberusProjectHQ from './cerberusProjectHQ.js';

let _projects = [];
let _detailCtx = null;
let _workspace = {};
let _status = {};
let _selectedId = null;
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

async function _fetchWorkspace() {
  const res = await fetch('/api/cerberus/workspace', { credentials: 'same-origin' });
  const data = await res.json();
  _workspace = data.workspace || {};
  _status = data.status || {};
  if (Array.isArray(data.projects)) _projects = data.projects;
  return data;
}

async function _fetchProjects() {
  const res = await fetch('/api/cerberus/projects', { credentials: 'same-origin' });
  const data = await res.json();
  _projects = Array.isArray(data.projects) ? data.projects : [];
  return _projects;
}

function _renderWorkspace() {
  const mounted = !!_status.mounted;
  const badge = _el('cerberus-workspace-mount-badge');
  const warn = _el('cerberus-workspace-warning');
  const host = _el('cerberus-workspace-host-hint');
  const container = _el('cerberus-workspace-container-root');
  const projectsFolder = _el('cerberus-workspace-projects-folder');
  const rootHidden = _el('cerberus-workspace-root');
  const auto = _el('cerberus-workspace-auto-discover');
  const autoIndex = _el('cerberus-workspace-auto-index');
  const meta = _el('cerberus-workspace-meta');
  const discovered = _el('cerberus-workspace-discovered');

  if (badge) {
    badge.textContent = mounted ? 'Mounted' : 'Not mounted';
    badge.classList.toggle('cerberus-workspace-mount-badge--ok', mounted);
    badge.classList.toggle('cerberus-workspace-mount-badge--warn', !mounted);
  }
  if (host) host.textContent = _status.host_hint || _workspace.workspace_host_root_hint || '—';
  if (container) container.textContent = _status.container_root || _workspace.workspace_container_root || '/workspace';
  if (projectsFolder) {
    projectsFolder.textContent = _status.projects_folder || _workspace.workspace_root || '/workspace/Projects';
  }
  if (rootHidden) rootHidden.value = _workspace.workspace_root || '/workspace/Projects';
  if (auto) auto.checked = _workspace.auto_discover !== false;
  if (autoIndex) autoIndex.checked = !!_workspace.auto_index_on_scan;

  if (warn) {
    const msg = _status.warning || '';
    if (msg && !mounted) {
      warn.textContent = msg;
      warn.classList.remove('hidden');
    } else {
      warn.textContent = '';
      warn.classList.add('hidden');
    }
  }

  if (meta) {
    meta.textContent = _workspace.last_scan_at
      ? `Last scan: ${new Date(_workspace.last_scan_at).toLocaleString()}`
      : 'Last scan: never — create workspace folders, then create or import a project';
  }
  if (discovered) {
    const valid = _projects.filter(p => p.path_status === 'valid');
    const indexed = valid.filter(p => p.last_indexed_at || p.indexed);
    discovered.textContent = valid.length
      ? `${valid.length} project(s) linked · ${indexed.length} indexed`
      : 'No projects discovered yet — scan after adding folders to your Cerberus Workspace';
  }
}

function _changeCount(p) {
  const ch = p.recent_changes || {};
  return (ch.new_count || 0) + (ch.modified_count || 0) + (ch.deleted_count || 0);
}

function _pathLine(p) {
  if (p.path_status === 'invalid') {
    return '<p class="cerberus-project-path atlas-project-path--invalid">unmounted / invalid path</p>';
  }
  const display = p.display_path || p.path || '';
  const container = p.path ? `<span class="cerberus-project-path-container">${_esc(p.path)}</span>` : '';
  if (!display && !p.path) {
    return '<p class="cerberus-project-path atlas-project-path--unset">No path linked</p>';
  }
  return `<p class="cerberus-project-path" title="${_esc(p.path || '')}">${_esc(display)}${container ? `<br>${container}` : ''}</p>`;
}

function _v2Meta(p) {
  return p.summary_v2 || p.v2_summary || {};
}

function _renderCards() {
  const grid = _el('cerberus-projects-grid');
  if (!grid) return;
  if (!_projects.length) {
    grid.innerHTML = `
      <div class="cerberus-panel-empty atlas-projects-empty">
        <p>No projects yet.</p>
        <div class="cerberus-projects-empty-actions">
          <button type="button" class="cerberus-project-btn atlas-project-btn--primary" id="cerberus-projects-empty-create">Create Project</button>
          <button type="button" class="cerberus-project-btn" id="cerberus-projects-empty-import">Import Project</button>
        </div>
      </div>`;
    _el('cerberus-projects-empty-create')?.addEventListener('click', () => _el('cerberus-projects-create-btn')?.click());
    _el('cerberus-projects-empty-import')?.addEventListener('click', () => _el('cerberus-projects-import-btn')?.click());
    return;
  }
  grid.innerHTML = _projects.map(p => {
    const stack = (p.detected_stack || []).join(' · ') || p.type || '—';
    const changes = _changeCount(p);
    const isIndexed = !!(p.last_indexed_at || p.indexed);
    const v2 = _v2Meta(p);
    const isV2 = !!(v2.index_version === 2 || v2.potential_score != null || p.index_version === 2);
    const score = v2.potential_score ?? p.potential_score;
    const stage = v2.current_stage || p.current_stage;
    const indexLabel = isIndexed
      ? `Last indexed ${new Date(p.last_indexed_at).toLocaleString()}`
      : 'Not indexed';
    const relinkBtn = p.can_relink
      ? `<button type="button" class="cerberus-project-btn" data-relink-project="${_esc(p.id)}">Relink</button>`
      : '';
    return `
    <article class="cerberus-project-card${p.id === _selectedId ? ' atlas-project-card--active' : ''}${p.path_status === 'invalid' ? ' atlas-project-card--invalid' : ''}" data-project-id="${_esc(p.id)}" tabindex="0">
      <header class="cerberus-project-card-head">
        <h3 class="cerberus-project-card-name">${_esc(p.name)}</h3>
        <span class="cerberus-project-index-badge${isIndexed ? ' atlas-project-index-badge--yes' : ' atlas-project-index-badge--no'}">${isIndexed ? 'Indexed' : 'Not indexed'}</span>
        ${p.officeName ? `<span class="cerberus-project-office-pill">${_esc(p.officeName)}</span>` : ''}
        ${p.storageMode ? `<span class="cerberus-project-storage-pill">${_esc(p.storageMode)}</span>` : ''}
        ${isV2 ? '<span class="cerberus-project-v2-badge atlas-project-v2-badge--yes">V2</span>' : ''}
      </header>
      ${_pathLine(p)}
      <p class="cerberus-project-card-stack"><span class="cerberus-project-card-stack-label">Stack</span> ${_esc(stack)}</p>
      <div class="cerberus-project-card-stats">
        <span class="cerberus-project-stat"><strong>${p.file_count || 0}</strong> files</span>
        <span class="cerberus-project-stat"><strong>${changes}</strong> recent changes</span>
        ${score != null ? `<span class="cerberus-project-stat atlas-project-score-pill"><strong>${score}</strong>/100</span>` : ''}
        ${stage ? `<span class="cerberus-project-stat">${_esc(stage)}</span>` : ''}
      </div>
      <p class="cerberus-project-indexed">${_esc(indexLabel)}</p>
      <div class="cerberus-project-card-actions">
        <button type="button" class="cerberus-project-btn" data-index-project="${_esc(p.id)}"${p.path_status !== 'valid' ? ' disabled title="Relink or scan first"' : ''}>Index</button>
        <button type="button" class="cerberus-project-btn" data-deep-index-project="${_esc(p.id)}"${p.path_status !== 'valid' ? ' disabled title="Relink or scan first"' : ''}>Deep Index</button>
        <button type="button" class="cerberus-project-btn" data-ask-assistant="${_esc(p.id)}">Ask Assistant</button>
        <button type="button" class="cerberus-project-btn" data-project-review="${_esc(p.id)}">Project Review</button>
        <button type="button" class="cerberus-project-btn" data-open-summary="${_esc(p.id)}">Summary</button>
        <button type="button" class="cerberus-project-btn atlas-project-btn--primary" data-open-hq="${_esc(p.id)}">HQ</button>
        ${relinkBtn}
      </div>
    </article>
  `;
  }).join('');
}

function _fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function _detailActionsHtml(id) {
  return `
    <button type="button" class="cerberus-project-btn" data-detail-ask="${_esc(id)}">Ask Assistant</button>
    <button type="button" class="cerberus-project-btn" data-index-project="${_esc(id)}">Index</button>
    <button type="button" class="cerberus-project-btn" data-deep-index-project="${_esc(id)}">Deep Index</button>
    <button type="button" class="cerberus-project-btn" data-project-review="${_esc(id)}">Generate Project Review</button>
    <button type="button" class="cerberus-project-btn" data-open-summary="${_esc(id)}">Open Summary</button>
    <button type="button" class="cerberus-project-btn" data-detail-pin="${_esc(id)}">Pin / Unpin</button>
  `;
}

const _V2_AGENT_ACTIONS = {
  research: 'market_opportunity_report',
  business: 'monetisation_report',
  architect: 'architecture_review',
  developer: 'codebase_review',
  marketing: 'launch_strategy',
};

async function _loadDetailContext(projectId) {
  try {
    const res = await fetch(`/api/cerberus/projects/${projectId}/context`, { credentials: 'same-origin' });
    _detailCtx = await res.json();
  } catch (_) {
    _detailCtx = null;
  }
}

function _renderDetail() {
  const p = _projects.find(x => x.id === _selectedId);
  const changesEl = _el('cerberus-projects-changes');
  const detailBody = _el('cerberus-projects-detail-body');
  const detailName = _el('cerberus-projects-detail-name');
  const detailActions = _el('cerberus-projects-detail-actions');
  if (!p) {
    if (changesEl) changesEl.innerHTML = '<p class="cerberus-panel-empty">Select a project.</p>';
    if (detailBody) detailBody.innerHTML = '<p class="cerberus-panel-empty">Select a project.</p>';
    if (detailActions) detailActions.classList.add('hidden');
    return;
  }
  if (detailName) detailName.textContent = p.name;
  const ctx = _detailCtx?.ok && _detailCtx.project?.id === p.id ? _detailCtx : null;
  const meta = ctx?.index_meta || {};
  const fin = ctx?.finance || {};
  const v2 = ctx?.summary_v2 || (ctx?.summary?.index_version === 2 ? ctx.summary : null) || _v2Meta(p) || {};
  const potential = v2.potential_score ?? ctx?.potential_score ?? '—';
  const stage = v2.current_stage || 'unknown';
  const purpose = v2.what_it_appears_to_do || ctx?.proposed_direction || 'Run Deep Index to generate project understanding.';
  const nextStep = (v2.recommended_next_steps || [])[0] || '';
  const missing = (v2.missing_pieces || []).slice(0, 3);
  const monetisation = (v2.monetisation_options || []).slice(0, 3);
  if (detailBody) {
    detailBody.innerHTML = `
      <p class="cerberus-detail-path">${_esc(p.display_path || p.path || 'No path')}</p>
      <p><strong>Stack</strong> ${_esc((p.detected_stack || []).join(' · ') || p.type || '—')}</p>
      <p><strong>Files</strong> ${meta.file_count || p.file_count || 0} · ${_fmtBytes(meta.folder_size_bytes)}</p>
      <p><strong>Indexed</strong> ${p.last_indexed_at ? new Date(p.last_indexed_at).toLocaleString() : 'Not indexed'}</p>
      <p><strong>V2 stage</strong> ${_esc(stage)} · <strong>Score</strong> ${potential}/100</p>
      <p><strong>Changes</strong> ${_changeCount(p)}</p>
      <p class="cerberus-detail-direction">${_esc(purpose)}</p>
      ${nextStep ? `<p><strong>Next step</strong> ${_esc(nextStep)}</p>` : ''}
      ${missing.length ? `<p><strong>Missing</strong> ${_esc(missing.join('; '))}</p>` : ''}
      ${monetisation.length ? `<p><strong>Monetisation</strong> ${_esc(monetisation.join('; '))}</p>` : ''}
      ${fin.monetisation_strategy ? `<p><strong>Finance note</strong> ${_esc(fin.monetisation_strategy.slice(0, 160))}</p>` : ''}
      ${ctx?.reports?.length ? `<p><strong>Reports</strong> ${ctx.reports.length} recent</p>` : ''}
    `;
  }
  if (detailActions) {
    detailActions.innerHTML = _detailActionsHtml(p.id);
    detailActions.classList.remove('hidden');
  }
  const ch = p.recent_changes || {};
  if (changesEl) {
    const sections = [
      ['New', ch.new_files || []],
      ['Modified', ch.modified_files || []],
      ['Deleted', ch.deleted_files || []],
    ];
    changesEl.innerHTML = sections.map(([label, files]) => `
      <section class="cerberus-changes-section">
        <h4>${label} (${files.length})</h4>
        <ul>${files.length ? files.slice(0, 12).map(f => `<li>${_esc(f)}</li>`).join('') : '<li class="cerberus-panel-empty">None</li>'}</ul>
      </section>
    `).join('');
    if (p.last_indexed_at) {
      changesEl.insertAdjacentHTML('afterbegin', `<p class="cerberus-indexed-at">Last indexed: ${new Date(p.last_indexed_at).toLocaleString()}</p>`);
    }
  }
}

async function _selectProject(id) {
  _selectedId = id;
  const proj = _projects.find((p) => p.id === id);
  AtlasVoiceContext.set({
    currentProjectId: id,
    currentProjectName: proj?.name || id,
    currentSelectionType: 'project',
    currentSelectionLabel: proj?.name || id,
  });
  _renderCards();
  await _loadDetailContext(id);
  _renderDetail();
}

async function _saveWorkspace() {
  const body = {
    workspace_root: _el('cerberus-workspace-root')?.value || '/workspace/Projects',
    auto_discover: !!_el('cerberus-workspace-auto-discover')?.checked,
    auto_index_on_scan: !!_el('cerberus-workspace-auto-index')?.checked,
  };
  const res = await fetch('/api/cerberus/workspace', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ok) {
    _workspace = data.workspace;
    _status = data.status || _status;
    _renderWorkspace();
    if (_deps.showToast) _deps.showToast('Workspace settings saved');
  }
}

async function _fetchOffices() {
  try {
    const res = await fetch('/api/cerberus/workspace/offices', { credentials: 'same-origin' });
    const data = await res.json();
    return Array.isArray(data.offices) ? data.offices : [];
  } catch (_) {
    return [];
  }
}

async function _createManagedProject() {
  const name = window.prompt('Project name:');
  if (!name?.trim()) return;
  const offices = await _fetchOffices();
  let officeId = offices[0]?.id;
  if (!officeId) {
    const officeName = window.prompt('No office found. Create office name:', 'My Office');
    if (!officeName?.trim()) return;
    const created = await fetch('/api/cerberus/workspace/offices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: officeName.trim(), description: '' }),
    }).then((r) => r.json());
    officeId = created?.office?.id;
    if (!officeId) {
      if (_deps.showToast) _deps.showToast(created?.message || 'Could not create office');
      return;
    }
  }
  let storageMode = 'managed';
  try {
    const settings = await fetch('/api/cerberus/workspace/ce/settings', { credentials: 'same-origin' }).then((r) => r.json());
    storageMode = settings?.settings?.defaultProjectStorage || 'managed';
  } catch (_) {}
  const res = await fetch('/api/cerberus/workspace/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name: name.trim(), officeId, storageMode }),
  });
  const data = await res.json();
  if (!data.ok) {
    if (_deps.showToast) _deps.showToast(data.message || 'Create failed');
    return;
  }
  _projects = data.projects || _projects;
  _renderCards();
  _renderWorkspace();
  if (_deps.showToast) _deps.showToast(`Created project “${name.trim()}”`);
  window.dispatchEvent(new CustomEvent('cerberus-graph-changed'));
}

async function _importLinkedProject() {
  const linkedPath = window.prompt('Full path to existing project folder:');
  if (!linkedPath?.trim()) return;
  const name = window.prompt('Project name:', linkedPath.split(/[/\\]/).filter(Boolean).pop() || 'Imported Project');
  if (!name?.trim()) return;
  const offices = await _fetchOffices();
  let officeId = offices[0]?.id;
  if (!officeId) {
    const officeName = window.prompt('Create office name:', 'My Office');
    if (!officeName?.trim()) return;
    const created = await fetch('/api/cerberus/workspace/offices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: officeName.trim() }),
    }).then((r) => r.json());
    officeId = created?.office?.id;
    if (!officeId) return;
  }
  const res = await fetch('/api/cerberus/workspace/projects/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      name: name.trim(),
      officeId,
      storageMode: 'linked',
      linkedPath: linkedPath.trim(),
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    if (_deps.showToast) _deps.showToast(data.message || 'Import failed');
    return;
  }
  _projects = data.projects || _projects;
  _renderCards();
  if (_deps.showToast) _deps.showToast('Linked project imported (files stay in place)');
  window.dispatchEvent(new CustomEvent('cerberus-graph-changed'));
}

async function _bootstrapWorkspace() {
  const res = await fetch('/api/cerberus/workspace/bootstrap', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok) {
    _status = data.status || _status;
    _renderWorkspace();
    if (_deps.showToast) _deps.showToast(data.message || 'Workspace folders created');
  } else if (_deps.showToast) {
    _deps.showToast(data.message || 'Bootstrap failed');
  }
}

async function _scanWorkspace() {
  if (_deps.showToast) _deps.showToast('Scanning /workspace/Projects…');
  const res = await fetch('/api/cerberus/workspace/scan', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok) {
    _workspace = data.workspace || _workspace;
    _status = data.status || _status;
    _projects = data.projects || _projects;
    _renderWorkspace();
    _renderCards();
    _renderDetail();
    let msg = data.message || 'Scan complete';
    if (data.indexed_count != null && data.indexed_count > 0) {
      msg += ` (${data.indexed_count} indexed`;
      if (data.skipped_count) msg += `, ${data.skipped_count} skipped`;
      msg += ')';
    }
    if (_deps.showToast) _deps.showToast(msg);
  } else {
    if (data.status) _status = data.status;
    _renderWorkspace();
    if (_deps.showToast) _deps.showToast(data.message || 'Scan failed');
  }
}

async function _indexAllProjects() {
  if (_deps.showToast) _deps.showToast('Indexing all projects…');
  const res = await fetch('/api/cerberus/projects/index-all', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok) {
    _projects = data.projects || _projects;
    _renderWorkspace();
    _renderCards();
    _renderDetail();
    let msg = data.message || 'Index complete';
    if (data.errors?.length) msg += ` (${data.errors.length} error(s))`;
    if (_deps.showToast) _deps.showToast(msg);
  } else if (_deps.showToast) {
    _deps.showToast(data.message || 'Index all failed');
  }
}

async function _deepIndexAllProjects() {
  if (_deps.showToast) _deps.showToast('Deep indexing all projects (V2)…');
  const res = await fetch('/api/cerberus/projects/index-all-v2', {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok) {
    _projects = data.projects || _projects;
    _renderWorkspace();
    _renderCards();
    if (_selectedId) await _loadDetailContext(_selectedId);
    _renderDetail();
    let msg = data.message || 'Deep index complete';
    if (data.errors?.length) msg += ` (${data.errors.length} error(s))`;
    if (_deps.showToast) _deps.showToast(msg);
  } else if (_deps.showToast) {
    _deps.showToast(data.message || 'Deep index all failed');
  }
}

function _browseWorkspaceRoot() {
  if (!_status.mounted) {
    if (_deps.showToast) _deps.showToast(_status.warning || 'Cerberus Workspace is not mounted');
    return;
  }
  const start = _status.browse_start || _status.container_root || '/workspace';
  workspaceModule.openWorkspaceBrowser({
    startPath: start,
    onSelect: () => {
      if (_deps.showToast) _deps.showToast('Projects are discovered from /workspace/Projects — use Scan Projects');
    },
  });
}

function _openSetupModal() {
  document.getElementById('settings-btn')?.click();
  import('./settings.js').then(() => {
    document.querySelector('[data-settings-tab="storage"]')?.click();
  });
}

function _closeSetupModal() {}

async function _relinkProject(id) {
  const res = await fetch(`/api/cerberus/projects/${id}/relink`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = await res.json();
  if (data.ok) {
    if (data.project) {
      const i = _projects.findIndex(p => p.id === id);
      if (i >= 0) _projects[i] = data.project;
    } else if (data.projects) {
      _projects = data.projects;
    }
    _renderCards();
    _renderDetail();
    if (_deps.showToast) _deps.showToast(data.message || 'Project relinked');
  } else if (_deps.showToast) {
    _deps.showToast(data.message || 'Relink failed — scan projects first');
  }
}

function _showForm(project = null) {
  const form = _el('cerberus-project-form');
  if (!form) return;
  form.classList.remove('hidden');
  _el('cerberus-project-form-id').value = project?.id || '';
  _el('cerberus-project-form-name').value = project?.name || '';
  _el('cerberus-project-form-path').value = project?.path || '';
  _el('cerberus-project-form-desc').value = project?.description || '';
  _el('cerberus-project-form-type').value = project?.type || 'SaaS';
  _el('cerberus-project-form-status').value = project?.status || 'active';
  _el('cerberus-project-form-priority').value = project?.priority || 'medium';
}

async function _saveProject(e) {
  e.preventDefault();
  const body = {
    id: _el('cerberus-project-form-id')?.value || undefined,
    name: _el('cerberus-project-form-name')?.value,
    path: _el('cerberus-project-form-path')?.value,
    description: _el('cerberus-project-form-desc')?.value,
    type: _el('cerberus-project-form-type')?.value,
    status: _el('cerberus-project-form-status')?.value,
    priority: _el('cerberus-project-form-priority')?.value,
  };
  const res = await fetch('/api/cerberus/projects', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ok) {
    _projects = data.projects || _projects;
    _selectedId = data.project?.id || _selectedId;
    _el('cerberus-project-form')?.classList.add('hidden');
    _renderCards();
    _renderDetail();
    if (_deps.showToast) _deps.showToast('Project saved');
  }
}

async function _indexProject(id) {
  const card = document.querySelector(`[data-project-id="${id}"]`);
  if (card) card.classList.add('cerberus-project-card--indexing');
  try {
    const res = await fetch('/api/cerberus/projects/index', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: id }),
    });
    const data = await res.json();
    if (data.ok) {
      if (data.project) {
        const i = _projects.findIndex(p => p.id === id);
        if (i >= 0) _projects[i] = data.project;
      }
      _selectedId = id;
      await _loadDetailContext(id);
      _renderCards();
      _renderDetail();
      if (_deps.showToast) _deps.showToast(data.briefing || data.summary?.summary || 'Index complete');
    } else if (_deps.showToast) {
      _deps.showToast(data.message || 'Index failed');
    }
  } finally {
    if (card) card.classList.remove('cerberus-project-card--indexing');
  }
}

async function _deepIndexProject(id) {
  const card = document.querySelector(`[data-project-id="${id}"]`);
  if (card) card.classList.add('cerberus-project-card--indexing');
  if (_deps.showToast) _deps.showToast('Deep indexing project (V2)…');
  try {
    const res = await fetch(`/api/cerberus/projects/${id}/index-v2`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json();
    if (data.ok) {
      if (data.project) {
        const i = _projects.findIndex(p => p.id === id);
        if (i >= 0) _projects[i] = data.project;
      }
      _selectedId = id;
      await _loadDetailContext(id);
      _renderCards();
      _renderDetail();
      const score = data.summary?.potential_score;
      const msg = score != null
        ? `Deep index complete — score ${score}/100`
        : (data.briefing || data.message || 'Deep index complete');
      if (_deps.showToast) _deps.showToast(msg);
    } else if (_deps.showToast) {
      _deps.showToast(data.message || 'Deep index failed');
    }
  } finally {
    if (card) card.classList.remove('cerberus-project-card--indexing');
  }
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

async function _runAgentV2(agentKey, projectId) {
  const action = _V2_AGENT_ACTIONS[agentKey];
  if (!action) return;
  return _runAgent(agentKey, action, projectId);
}

async function _runCouncilReview(projectId, stage) {
  if (_deps.showToast) _deps.showToast(stage ? `Council stage: ${stage}…` : 'Starting council review (research)…');
  const res = await fetch(`/api/cerberus/council/review/${projectId}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(stage ? { stage } : {}),
  });
  const data = await res.json();
  if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Council report ready' : 'Council review failed'));
  return data;
}

async function _developerReview(id) {
  try {
    const res = await fetch('/api/cerberus/agents/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'developer',
        action: 'developer_project_review',
        project_id: id,
      }),
    });
    const data = await res.json();
    if (_deps.showToast) _deps.showToast(data.message || (data.ok ? 'Review queued' : 'Failed'));
  } catch (_) {
    if (_deps.showToast) _deps.showToast('Developer review failed');
  }
}

function _closeSummaryModal() {
  const modal = _el('cerberus-project-summary-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function _openSummary(id) {
  const res = await fetch(`/api/cerberus/projects/${id}/summary`, { credentials: 'same-origin' });
  const data = await res.json();
  const modal = _el('cerberus-project-summary-modal');
  if (!data.ok || !modal) {
    if (_deps.showToast) _deps.showToast(data.message || 'Index project first to generate summary');
    return;
  }
  const s = data.summary;
  const p = _projects.find(x => x.id === id);
  const isV2 = s.index_version === 2 || s.potential_score != null;
  _el('cerberus-project-summary-agent').textContent = [
    (p?.detected_stack || []).join(' · ') || s.project_type || 'Project',
    isV2 ? `V2 · ${s.current_stage || 'unknown'} · ${s.potential_score ?? '—'}/100` : '',
  ].filter(Boolean).join(' · ');
  _el('cerberus-project-summary-title').textContent = s.name || p?.name || 'Summary';
  _el('cerberus-project-summary-meta').textContent = [
    s.last_indexed_at ? new Date(s.last_indexed_at).toLocaleString() : '',
    `${s.file_count || 0} files`,
    s.folder_size_mb ? `${s.folder_size_mb} MB` : '',
    s.ignored_count ? `${s.ignored_count} ignored` : '',
  ].filter(Boolean).join(' · ');
  _el('cerberus-project-summary-text').textContent = s.what_it_appears_to_do || s.summary || '';
  const body = _el('cerberus-project-summary-body');
  if (body) {
    const imp = (s.important_files || []).map(f => `<li>${_esc(f)}</li>`).join('') || '<li>None</li>';
    const ch = (s.recent_changes || []).map(f => `<li>${_esc(f)}</li>`).join('') || '<li>None</li>';
    const steps = (s.recommended_next_steps || s.next_questions || []).map(q => `<li>${_esc(q)}</li>`).join('');
    const missing = (s.missing_pieces || []).map(m => `<li>${_esc(m)}</li>`).join('');
    const money = (s.monetisation_options || []).map(m => `<li>${_esc(m)}</li>`).join('');
    const risks = (s.risk_flags || []).map(r => `<li>${_esc(r)}</li>`).join('');
    body.innerHTML = `
      ${s.strengths?.length ? `<h3>Strengths</h3><ul>${s.strengths.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>` : ''}
      ${s.weaknesses?.length ? `<h3>Weaknesses</h3><ul>${s.weaknesses.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>` : ''}
      <h3>Important files</h3><ul>${imp}</ul>
      <h3>Recent changes</h3><ul>${ch}</ul>
      ${missing ? `<h3>Missing pieces</h3><ul>${missing}</ul>` : ''}
      ${money ? `<h3>Monetisation options</h3><ul>${money}</ul>` : ''}
      ${steps ? `<h3>Recommended next steps</h3><ul>${steps}</ul>` : ''}
      ${risks ? `<h3>Risk flags</h3><ul>${risks}</ul>` : ''}
    `;
  }
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function _bindEvents() {
  _el('cerberus-workspace-save')?.addEventListener('click', _saveWorkspace);
  _el('cerberus-workspace-scan')?.addEventListener('click', _scanWorkspace);
  _el('cerberus-workspace-index-all')?.addEventListener('click', _indexAllProjects);
  _el('cerberus-workspace-deep-index-all')?.addEventListener('click', _deepIndexAllProjects);
  _el('cerberus-workspace-browse')?.addEventListener('click', _browseWorkspaceRoot);
  _el('cerberus-workspace-bootstrap')?.addEventListener('click', _bootstrapWorkspace);
  _el('cerberus-workspace-setup')?.addEventListener('click', _openSetupModal);
  _el('cerberus-workspace-auto-discover')?.addEventListener('change', _saveWorkspace);
  _el('cerberus-workspace-auto-index')?.addEventListener('change', _saveWorkspace);
  _el('cerberus-projects-create-btn')?.addEventListener('click', () => void _createManagedProject());
  _el('cerberus-projects-import-btn')?.addEventListener('click', () => void _importLinkedProject());
  _el('cerberus-projects-add-btn')?.addEventListener('click', () => _showForm());
  _el('cerberus-project-form-cancel')?.addEventListener('click', () => _el('cerberus-project-form')?.classList.add('hidden'));
  _el('cerberus-project-form')?.addEventListener('submit', _saveProject);

  const panel = _el('cerberus-projects-panel');
  if (panel) {
    panel.addEventListener('click', (e) => {
      const indexBtn = e.target.closest('[data-index-project]');
      if (indexBtn && !indexBtn.disabled) { _indexProject(indexBtn.dataset.indexProject); return; }
      const deepBtn = e.target.closest('[data-deep-index-project]');
      if (deepBtn && !deepBtn.disabled) { _deepIndexProject(deepBtn.dataset.deepIndexProject); return; }
      const askAssistBtn = e.target.closest('[data-ask-assistant]');
      if (askAssistBtn) {
        const p = _projects.find((x) => x.id === askAssistBtn.dataset.askAssistant);
        cerberusActiveProject.openAssistantWithProject(askAssistBtn.dataset.askAssistant, p?.name);
        return;
      }
      const reviewBtn = e.target.closest('[data-project-review]');
      if (reviewBtn) { _runCouncilReview(reviewBtn.dataset.projectReview); return; }
      const agentV2Btn = e.target.closest('[data-agent-v2]');
      if (agentV2Btn) {
        _runAgentV2(agentV2Btn.dataset.agentV2, agentV2Btn.dataset.projectId);
        return;
      }
      const councilBtn = e.target.closest('[data-council-review]');
      if (councilBtn) { _runCouncilReview(councilBtn.dataset.councilReview); return; }
      const summaryBtn = e.target.closest('[data-open-summary]');
      if (summaryBtn) { _openSummary(summaryBtn.dataset.openSummary); return; }
      const hqBtn = e.target.closest('[data-open-hq]');
      if (hqBtn) { cerberusProjectHQ.openProjectHQ(hqBtn.dataset.openHq); return; }
      const relinkBtn = e.target.closest('[data-relink-project]');
      if (relinkBtn) { _relinkProject(relinkBtn.dataset.relinkProject); return; }
      const askBtn = e.target.closest('[data-detail-ask]');
      if (askBtn) {
        const p = _projects.find(x => x.id === askBtn.dataset.detailAsk);
        cerberusActiveProject.openAssistantWithProject(askBtn.dataset.detailAsk, p?.name);
        return;
      }
      const archBtn = e.target.closest('[data-detail-architect]');
      if (archBtn) { _runAgent('architect', 'architecture_plan', archBtn.dataset.detailArchitect); return; }
      const bizBtn = e.target.closest('[data-detail-business]');
      if (bizBtn) { _runAgent('business', 'business_analysis', bizBtn.dataset.detailBusiness); return; }
      const mktBtn = e.target.closest('[data-detail-marketing]');
      if (mktBtn) { _runAgent('marketing', 'marketing_ideas', mktBtn.dataset.detailMarketing); return; }
      const pinBtn = e.target.closest('[data-detail-pin]');
      if (pinBtn) {
        fetch(`/api/cerberus/projects/${pinBtn.dataset.detailPin}/pin`, { method: 'POST', credentials: 'same-origin' })
          .then(r => r.json()).then(async (d) => {
            if (d.ok) { await _fetchProjects(); _renderCards(); await _selectProject(pinBtn.dataset.detailPin); }
          });
        return;
      }
      const card = e.target.closest('[data-project-id]');
      if (card && !e.target.closest('button')) {
        cerberusProjectHQ.openProjectHQ(card.dataset.projectId);
      }
    });
  }

  const setupModal = _el('cerberus-workspace-setup-modal');
  if (setupModal) {
    setupModal.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerberus-workspace-setup-close]')) _closeSetupModal();
    });
  }

  const sumModal = _el('cerberus-project-summary-modal');
  if (sumModal) {
    sumModal.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerberus-summary-close]')) _closeSummaryModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      _closeSummaryModal();
      _closeSetupModal();
    }
  });
}

export async function renderProjectsPanel() {
  await _fetchWorkspace();
  if (!_projects.length) await _fetchProjects();
  _renderWorkspace();
  _renderCards();
  if (!_selectedId && _projects.length) await _selectProject(_projects[0].id);
  else if (_selectedId) {
    await _loadDetailContext(_selectedId);
    _renderDetail();
  }
}

export async function openProjectSummary(id) {
  return _openSummary(id);
}

export function initAtlasProjects(deps = {}) {
  _deps = deps;
  cerberusProjectContext.initAtlasProjectContext({
    showToast: deps.showToast,
    openSummary: openProjectSummary,
  });
  cerberusProjectHQ.initAtlasProjectHQ({ showToast: deps.showToast });
  _bindEvents();
}

export async function selectProject(projectId) {
  if (!projectId) return;
  await _selectProject(projectId);
}

export async function openProjectHQ(projectId) {
  const pid = projectId || _selectedId;
  if (!pid) return;
  await _selectProject(pid);
  return cerberusProjectHQ.openProjectHQ(pid);
}

const cerberusProjectsModule = {
  initAtlasProjects,
  renderProjectsPanel,
  openProjectSummary,
  selectProject,
  openProjectHQ,
};

window.AtlasProjectsUI = {
  selectProject,
  openProjectHQ,
  getSelectedProjectId: () => _selectedId,
};

export default cerberusProjectsModule;
