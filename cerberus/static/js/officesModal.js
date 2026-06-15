// Cerberus OS CE — modular Offices (Office → Department → Agent → Sub-agent)

import { emitGraphChanged } from './cerberusGraphStore.js';

const STORAGE_KEY = 'atlas_offices_v2';
const LEGACY_KEY = 'atlas_offices_v1';

const RUNTIME_MODES = [
  'Manual only',
  'Local scheduled',
  'Local background',
  'Cloud/24-7',
  'Hybrid',
];

const PERMISSIONS = [
  'Read project files',
  'Write notes',
  'Create tasks',
  'Generate reports',
  'Draft emails',
  'Send emails only with approval',
  'Publish content only with approval',
  'Access APIs',
  'Run scheduled jobs',
];

let _offices = [];
let _activeOfficeId = null;
let _deps = {};
let _promptSubmit = null;

function _showPrompt({ title, label, submitLabel = 'Save', defaultName = '', defaultDesc = '', showDesc = false, onSubmit }) {
  const overlay = _el('cerberus-offices-prompt');
  const titleEl = _el('cerberus-offices-prompt-title');
  const labelEl = _el('cerberus-offices-prompt-label');
  const input = _el('cerberus-offices-prompt-input');
  const descLabel = _el('cerberus-offices-prompt-desc-label');
  const descInput = _el('cerberus-offices-prompt-desc');
  const submitBtn = _el('cerberus-offices-prompt-submit');
  if (!overlay || !input || !titleEl) {
    const name = window.prompt(label || 'Name:', defaultName);
    if (name && onSubmit) onSubmit({ name, description: '' });
    return;
  }
  titleEl.textContent = title || 'Create';
  labelEl.textContent = label || 'Name';
  input.value = defaultName || '';
  submitBtn.textContent = submitLabel;
  if (showDesc && descInput && descLabel) {
    descLabel.classList.remove('hidden');
    descInput.classList.remove('hidden');
    descInput.value = defaultDesc || '';
  } else if (descInput && descLabel) {
    descLabel.classList.add('hidden');
    descInput.classList.add('hidden');
    descInput.value = '';
  }
  _promptSubmit = onSubmit;
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function _hidePrompt() {
  const overlay = _el('cerberus-offices-prompt');
  if (overlay) overlay.classList.add('hidden');
  _promptSubmit = null;
}

function _bindPromptDialog() {
  const overlay = _el('cerberus-offices-prompt');
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = '1';
  const input = _el('cerberus-offices-prompt-input');
  const descInput = _el('cerberus-offices-prompt-desc');
  _el('cerberus-offices-prompt-cancel')?.addEventListener('click', _hidePrompt);
  _el('cerberus-offices-prompt-submit')?.addEventListener('click', () => {
    const name = (input?.value || '').trim();
    if (!name || !_promptSubmit) return;
    const description = (descInput?.value || '').trim();
    const fn = _promptSubmit;
    _hidePrompt();
    fn({ name, description });
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _el('cerberus-offices-prompt-submit')?.click();
    }
    if (e.key === 'Escape') _hidePrompt();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _hidePrompt();
  });
}

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

function _uid(prefix = 'o') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _now() {
  return new Date().toISOString();
}

function _load() {
  try {
    if (localStorage.getItem(LEGACY_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    _offices = raw ? JSON.parse(raw) : [];
    if (_offices.some((o) => /^office-demo-/i.test(o.id) || /^demo$/i.test(o.name))) {
      _offices = [];
      localStorage.setItem(STORAGE_KEY, '[]');
    }
  } catch (_) {
    _offices = [];
  }
}

function _save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_offices));
  } catch (_) {}
  emitGraphChanged();
}

function _newAgent(name) {
  return {
    id: _uid('a'),
    name: name || 'New Agent',
    avatar: '',
    jobTitle: '',
    jobDescription: '',
    taskFocuses: [],
    model: '',
    runtimeMode: 'Manual only',
    permissions: ['Read project files'],
    assignedProjectIds: [],
    officeId: '',
    departmentId: '',
    subAgents: [],
    createdAt: _now(),
    updatedAt: _now(),
  };
}

function _getOffice(id) {
  return _offices.find((o) => o.id === id);
}

function _dataAttrName(key) {
  return String(key).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function _actionBtns(actions) {
  return `<div class="cerberus-entity-actions">${actions.map((a) =>
    `<button type="button" class="cerberus-entity-action" data-action="${a.id}" ${Object.entries(a.data || {}).map(([k, v]) => `data-${_dataAttrName(k)}="${_esc(v)}"`).join(' ')}>${a.label}</button>`
  ).join('')}</div>`;
}

function _renderOfficeList() {
  const list = _el('cerberus-offices-list');
  if (!list) return;
  if (!_offices.length) {
    list.innerHTML = '<p class="cerberus-offices-empty" style="padding:12px">No offices yet.<br><button type="button" class="cerberus-offices-add-btn" id="cerberus-offices-create-list">Create your first office</button></p>';
    _el('cerberus-offices-create-list')?.addEventListener('click', () => {
      _showPrompt({
        title: 'Create Office',
        label: 'Office name',
        submitLabel: 'Create',
        onSubmit: ({ name }) => createOffice(name),
      });
    });
    return;
  }
  list.innerHTML = _offices.map((o) => `
    <button type="button" class="cerberus-offices-item${o.id === _activeOfficeId ? ' active' : ''}" data-office-id="${_esc(o.id)}">
      ${_esc(o.name)}
    </button>
  `).join('');
}

function _renderSubAgentCard(sub, office, dept, agent) {
  return `
    <div class="cerberus-offices-agent-card atlas-offices-agent-card--sub" data-subagent-id="${_esc(sub.id)}">
      <div class="cerberus-offices-agent-avatar">${_esc((sub.name || '?')[0])}</div>
      <div class="cerberus-offices-agent-info">
        <div class="cerberus-offices-agent-name">${_esc(sub.name)}</div>
        <div class="cerberus-offices-agent-role">${_esc(sub.jobTitle || sub.title || '')}</div>
        ${_actionBtns([
          { id: 'open-subagent', label: 'Open', data: { subagentId: sub.id, agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'edit-subagent', label: 'Edit', data: { subagentId: sub.id, agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'delete-subagent', label: 'Delete', data: { subagentId: sub.id, agentId: agent.id, deptId: dept.id, officeId: office.id } },
        ])}
      </div>
    </div>`;
}

function _renderAgentCard(agent, office, dept) {
  const perms = (agent.permissions || []).slice(0, 2).map((p) =>
    `<span class="cerberus-offices-tag">${_esc(p)}</span>`
  ).join('');
  const subs = (agent.subAgents || []).map((s) => _renderSubAgentCard(s, office, dept, agent)).join('');
  return `
    <div class="cerberus-offices-agent-card" data-agent-id="${_esc(agent.id)}">
      <div class="cerberus-offices-agent-avatar">${_esc((agent.name || '?')[0])}</div>
      <div class="cerberus-offices-agent-info">
        <div class="cerberus-offices-agent-name">${_esc(agent.name)}</div>
        <div class="cerberus-offices-agent-role">${_esc(agent.jobTitle || agent.title || '')}</div>
        ${agent.runtimeMode ? `<div class="cerberus-offices-agent-meta"><span class="cerberus-offices-tag">${_esc(agent.runtimeMode)}</span>${perms}</div>` : ''}
        ${_actionBtns([
          { id: 'open-agent', label: 'Open', data: { agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'edit-agent', label: 'Edit', data: { agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'delete-agent', label: 'Delete', data: { agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'assign-agent-project', label: 'Assign Project', data: { agentId: agent.id, deptId: dept.id, officeId: office.id } },
          { id: 'add-subagent', label: '+ Sub-agent', data: { agentId: agent.id, deptId: dept.id, officeId: office.id } },
        ])}
      </div>
    </div>
    ${subs}
  `;
}

function _renderOfficeDetail() {
  const main = _el('cerberus-offices-main');
  if (!main) return;

  if (!_offices.length) {
    main.innerHTML = `
      <div class="cerberus-offices-empty">
        <p>No offices yet.</p>
        <button type="button" class="cerberus-offices-add-btn" id="cerberus-offices-create-inline">Create your first office</button>
      </div>`;
    _el('cerberus-offices-create-inline')?.addEventListener('click', () => {
      _showPrompt({
        title: 'Create Office',
        label: 'Office name',
        submitLabel: 'Create',
        onSubmit: ({ name }) => createOffice(name),
      });
    });
    return;
  }

  const office = _getOffice(_activeOfficeId);
  if (!office) {
    main.innerHTML = '<p class="cerberus-offices-empty">Select or create an office.</p>';
    return;
  }

  const depts = (office.departments || []).map((d) => `
    <section class="cerberus-offices-dept" data-dept-id="${_esc(d.id)}">
      <div class="cerberus-offices-dept-header">
        <h3 class="cerberus-offices-dept-title">${_esc(d.name)}</h3>
        ${_actionBtns([
          { id: 'edit-dept', label: 'Edit', data: { deptId: d.id, officeId: office.id } },
          { id: 'delete-dept', label: 'Delete', data: { deptId: d.id, officeId: office.id } },
          { id: 'assign-dept-project', label: 'Assign Project', data: { deptId: d.id, officeId: office.id } },
          { id: 'add-agent', label: '+ Agent', data: { deptId: d.id, officeId: office.id } },
        ])}
      </div>
      <p class="cerberus-offices-dept-desc">${_esc(d.description || '')}</p>
      ${d.responsibilities ? `<p class="cerberus-offices-dept-meta"><strong>Responsibilities:</strong> ${_esc(d.responsibilities)}</p>` : ''}
      ${d.projectId ? `<p class="cerberus-offices-dept-meta"><strong>Project:</strong> ${_esc(d.projectId)}</p>` : ''}
      ${(d.agents || []).map((a) => _renderAgentCard(a, office, d)).join('') || '<p class="cerberus-offices-empty" style="padding:8px">No employees yet.<br><button type="button" class="cerberus-entity-action" data-action="add-agent" data-dept-id="' + _esc(d.id) + '" data-office-id="' + _esc(office.id) + '">Create Employee</button></p>'}
    </section>
  `).join('');

  main.innerHTML = `
    <header class="cerberus-offices-office-header">
      <div>
        <h2 class="cerberus-offices-office-title">${_esc(office.name)}</h2>
        <p class="cerberus-offices-office-desc">${_esc(office.description || '')}</p>
        ${office.projectIds?.length ? `<p class="cerberus-offices-dept-meta">Connected projects: ${_esc(office.projectIds.join(', '))}</p>` : ''}
      </div>
      ${_actionBtns([
        { id: 'edit-office', label: 'Edit', data: { officeId: office.id } },
        { id: 'delete-office', label: 'Delete', data: { officeId: office.id } },
        { id: 'assign-office-project', label: 'Assign Project', data: { officeId: office.id } },
        { id: 'add-dept', label: '+ Department', data: { officeId: office.id } },
      ])}
    </header>
    <div class="cerberus-offices-depts">${depts || '<p class="cerberus-offices-empty">Add a department to get started.</p>'}</div>
  `;
}

async function _syncFromWorkspace() {
  try {
    const res = await fetch('/api/cerberus/workspace/offices', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.offices)) return false;
    _offices = data.offices.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description || '',
      projectIds: o.projectIds || [],
      departments: (o.departments || []).map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description || '',
        responsibilities: d.responsibilities || '',
        projectId: d.projectId || '',
        agents: (d.agents || []).map((a) => ({
          ...a,
          subAgents: a.subAgents || [],
        })),
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));
    _save();
    return true;
  } catch (_) {}
  return false;
}

export function renderOfficesModal() {
  void _syncFromWorkspace().then((synced) => {
    if (!synced) _load();
    if (!_activeOfficeId && _offices.length) _activeOfficeId = _offices[0].id;
    _renderOfficeList();
    _renderOfficeDetail();
  });
}

export function openOfficeByName(name) {
  const q = String(name || '').trim().toLowerCase();
  const office = _offices.find((o) => o.name.toLowerCase() === q || o.name.toLowerCase().includes(q));
  if (office) {
    _activeOfficeId = office.id;
    renderOfficesModal();
    return office;
  }
  return null;
}

export function openAgentByName(name) {
  const q = String(name || '').trim().toLowerCase();
  for (const office of _offices) {
    for (const dept of office.departments || []) {
      for (const agent of dept.agents || []) {
        if (agent.name.toLowerCase() === q) {
          _activeOfficeId = office.id;
          renderOfficesModal();
          return { office, dept, agent };
        }
        for (const sub of agent.subAgents || []) {
          if (sub.name.toLowerCase() === q) {
            _activeOfficeId = office.id;
            renderOfficesModal();
            return { office, dept, agent: sub };
          }
        }
      }
    }
  }
  return null;
}

export async function createOffice(name, description = '') {
  try {
    const res = await fetch('/api/cerberus/workspace/offices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: name || 'New Office', description }),
    });
    const data = await res.json();
    if (data.ok && data.office) {
      _load();
      const remote = data.office;
      const office = {
        id: remote.id,
        name: remote.name,
        description: remote.description || '',
        projectIds: remote.projectIds || [],
        departments: [],
        createdAt: remote.createdAt || _now(),
        updatedAt: remote.updatedAt || _now(),
      };
      _offices.push(office);
      _activeOfficeId = office.id;
      _save();
      renderOfficesModal();
      return office;
    }
  } catch (_) {}
  const office = {
    id: _uid('o'),
    name: name || 'New Office',
    description: description || '',
    projectIds: [],
    departments: [],
    createdAt: _now(),
    updatedAt: _now(),
  };
  _offices.push(office);
  _activeOfficeId = office.id;
  _save();
  renderOfficesModal();
  return office;
}

export async function deleteOffice(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/cerberus/workspace/offices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.ok) {
      _deps.showToast?.(data.message || 'Failed to delete office');
      return;
    }
  } catch (err) {
    _deps.showToast?.('Failed to delete office');
    return;
  }
  _offices = _offices.filter((o) => o.id !== id);
  if (_activeOfficeId === id) _activeOfficeId = _offices[0]?.id || null;
  _save();
  renderOfficesModal();
}

export function editOffice(id, patch) {
  const o = _getOffice(id);
  if (!o) return null;
  Object.assign(o, patch, { updatedAt: _now() });
  _save();
  renderOfficesModal();
  return o;
}

export async function createDepartment(officeId, name, description = '') {
  try {
    const res = await fetch('/api/cerberus/workspace/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ officeId, name, description }),
    });
    const data = await res.json();
    if (data.ok && data.department) {
      const office = _getOffice(officeId);
      if (office) {
        office.departments = office.departments || [];
        if (!office.departments.some((d) => d.id === data.department.id)) {
          office.departments.push({
            ...data.department,
            agents: data.department.agents || [],
          });
        }
        _save();
      }
      renderOfficesModal();
      return data.department;
    }
    if (data.message && _deps.showToast) _deps.showToast(data.message);
  } catch (_) {}
  const office = _getOffice(officeId);
  if (!office) return null;
  const dept = {
    id: _uid('d'),
    name: name || 'New Department',
    description: '',
    responsibilities: '',
    projectId: '',
    agents: [],
    reports: [],
    tasks: [],
    createdAt: _now(),
    updatedAt: _now(),
  };
  office.departments = office.departments || [];
  office.departments.push(dept);
  _save();
  renderOfficesModal();
  return dept;
}

export async function deleteDepartment(officeId, deptId) {
  if (!officeId || !deptId) return;
  try {
    const res = await fetch(
      `/api/cerberus/workspace/departments/${encodeURIComponent(deptId)}?officeId=${encodeURIComponent(officeId)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.ok) {
      _deps.showToast?.(data.message || 'Failed to delete department');
      return;
    }
  } catch (_) {
    _deps.showToast?.('Failed to delete department');
    return;
  }
  const office = _getOffice(officeId);
  if (!office) {
    renderOfficesModal();
    return;
  }
  office.departments = (office.departments || []).filter((d) => d.id !== deptId);
  _save();
  renderOfficesModal();
}

export function createAgent(officeId, deptId, name) {
  const office = _getOffice(officeId);
  const dept = office?.departments?.find((d) => d.id === deptId);
  if (!dept) return null;
  const agent = _newAgent(name);
  agent.officeId = officeId;
  agent.departmentId = deptId;
  dept.agents = dept.agents || [];
  dept.agents.push(agent);
  _save();
  renderOfficesModal();
  return agent;
}

export function deleteAgent(officeId, deptId, agentId) {
  const office = _getOffice(officeId);
  const dept = office?.departments?.find((d) => d.id === deptId);
  if (!dept) return;
  dept.agents = (dept.agents || []).filter((a) => a.id !== agentId);
  _save();
  renderOfficesModal();
}

export function editAgent(officeId, deptId, agentId, patch) {
  const office = _getOffice(officeId);
  const dept = office?.departments?.find((d) => d.id === deptId);
  const agent = dept?.agents?.find((a) => a.id === agentId);
  if (!agent) return null;
  Object.assign(agent, patch, { updatedAt: _now() });
  _save();
  renderOfficesModal();
  return agent;
}

export function createSubAgent(officeId, deptId, agentId, name) {
  const office = _getOffice(officeId);
  const dept = office?.departments?.find((d) => d.id === deptId);
  const agent = dept?.agents?.find((a) => a.id === agentId);
  if (!agent) return null;
  const sub = {
    id: _uid('s'),
    name: name || 'New Sub-agent',
    jobTitle: '',
    title: '',
    description: '',
    createdAt: _now(),
    updatedAt: _now(),
  };
  agent.subAgents = agent.subAgents || [];
  agent.subAgents.push(sub);
  _save();
  renderOfficesModal();
  return sub;
}

export function deleteSubAgent(officeId, deptId, agentId, subId) {
  const office = _getOffice(officeId);
  const dept = office?.departments?.find((d) => d.id === deptId);
  const agent = dept?.agents?.find((a) => a.id === agentId);
  if (!agent) return;
  agent.subAgents = (agent.subAgents || []).filter((s) => s.id !== subId);
  _save();
  renderOfficesModal();
}

export function getOffices() {
  _load();
  return _offices;
}

function _handleAction(action, dataset) {
  const { officeId, deptId, agentId, subagentId } = dataset;

  if (action === 'edit-office') {
    const o = _getOffice(officeId);
    _showPrompt({
      title: 'Edit Office',
      label: 'Office name',
      submitLabel: 'Save',
      defaultName: o?.name || '',
      defaultDesc: o?.description || '',
      showDesc: true,
      onSubmit: ({ name, description }) => editOffice(officeId, { name, description: description || '' }),
    });
    return;
  }
  if (action === 'delete-office') {
    if (window.confirm('Delete this office and all its departments and agents?')) deleteOffice(officeId);
    return;
  }
  if (action === 'assign-office-project') {
    const pid = window.prompt('Project ID to connect:');
    if (!pid) return;
    const o = _getOffice(officeId);
    o.projectIds = [...new Set([...(o.projectIds || []), pid])];
    _save();
    renderOfficesModal();
    return;
  }
  if (action === 'add-dept') {
    _showPrompt({
      title: 'Create Department',
      label: 'Department name',
      submitLabel: 'Create',
      onSubmit: ({ name }) => createDepartment(officeId, name),
    });
    return;
  }
  if (action === 'edit-dept') {
    const office = _getOffice(officeId);
    const dept = office?.departments?.find((d) => d.id === deptId);
    _showPrompt({
      title: 'Edit Department',
      label: 'Department name',
      submitLabel: 'Save',
      defaultName: dept?.name || '',
      defaultDesc: dept?.description || '',
      showDesc: true,
      onSubmit: ({ name, description }) => {
        if (!dept) return;
        dept.name = name;
        dept.description = description || '';
        dept.updatedAt = _now();
        _save();
        renderOfficesModal();
      },
    });
    return;
  }
  if (action === 'delete-dept') {
    if (window.confirm('Delete this department and all its agents?')) deleteDepartment(officeId, deptId);
    return;
  }
  if (action === 'assign-dept-project') {
    const pid = window.prompt('Project ID:');
    if (!pid) return;
    const office = _getOffice(officeId);
    const dept = office?.departments?.find((d) => d.id === deptId);
    if (dept) { dept.projectId = pid; dept.updatedAt = _now(); _save(); renderOfficesModal(); }
    return;
  }
  if (action === 'add-agent') {
    const name = window.prompt('Agent name:');
    if (name) createAgent(officeId, deptId, name);
    return;
  }
  if (action === 'edit-agent') {
    const office = _getOffice(officeId);
    const dept = office?.departments?.find((d) => d.id === deptId);
    const agent = dept?.agents?.find((a) => a.id === agentId);
    const name = window.prompt('Agent name:', agent?.name || '');
    if (!name) return;
    const title = window.prompt('Job title:', agent?.jobTitle || agent?.title || '');
    const model = window.prompt('LLM model:', agent?.model || '');
    editAgent(officeId, deptId, agentId, { name, jobTitle: title || '', title: title || '', model: model || '' });
    return;
  }
  if (action === 'delete-agent') {
    if (window.confirm('Delete this agent and all sub-agents?')) deleteAgent(officeId, deptId, agentId);
    return;
  }
  if (action === 'assign-agent-project') {
    const pid = window.prompt('Project ID (context isolation applies):');
    if (!pid) return;
    const office = _getOffice(officeId);
    const dept = office?.departments?.find((d) => d.id === deptId);
    const agent = dept?.agents?.find((a) => a.id === agentId);
    if (agent) {
      agent.assignedProjectIds = [...new Set([...(agent.assignedProjectIds || []), pid])];
      agent.updatedAt = _now();
      _save();
      renderOfficesModal();
    }
    return;
  }
  if (action === 'add-subagent') {
    const name = window.prompt('Sub-agent name:');
    if (name) createSubAgent(officeId, deptId, agentId, name);
    return;
  }
  if (action === 'edit-subagent') {
    const office = _getOffice(officeId);
    const dept = office?.departments?.find((d) => d.id === deptId);
    const agent = dept?.agents?.find((a) => a.id === agentId);
    const sub = agent?.subAgents?.find((s) => s.id === subagentId);
    const name = window.prompt('Sub-agent name:', sub?.name || '');
    if (!name) return;
    const title = window.prompt('Role:', sub?.jobTitle || sub?.title || '');
    if (sub) {
      sub.name = name;
      sub.jobTitle = title || '';
      sub.title = title || '';
      sub.updatedAt = _now();
      _save();
      renderOfficesModal();
    }
    return;
  }
  if (action === 'delete-subagent') {
    if (window.confirm('Delete this sub-agent?')) deleteSubAgent(officeId, deptId, agentId, subagentId);
  }
}

function _bindEvents() {
  const list = _el('cerberus-offices-list');
  if (list && !list.dataset.bound) {
    list.dataset.bound = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-office-id]');
      if (!btn) return;
      _activeOfficeId = btn.dataset.officeId;
      _renderOfficeList();
      _renderOfficeDetail();
    });
  }

  const main = _el('cerberus-offices-main');
  if (main && !main.dataset.bound) {
    main.dataset.bound = '1';
    main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      _handleAction(btn.dataset.action, btn.dataset);
    });
  }

  _el('cerberus-offices-create')?.addEventListener('click', () => {
    _showPrompt({
      title: 'Create Office',
      label: 'Office name',
      submitLabel: 'Create',
      onSubmit: ({ name }) => createOffice(name),
    });
  });
}

export function initOfficesModal(deps = {}) {
  _deps = deps;
  _load();
  _bindPromptDialog();
  _bindEvents();
}

export { RUNTIME_MODES, PERMISSIONS };

export default {
  renderOfficesModal,
  openOfficeByName,
  openAgentByName,
  createOffice,
  deleteOffice,
  editOffice,
  createDepartment,
  deleteDepartment,
  createAgent,
  deleteAgent,
  editAgent,
  createSubAgent,
  deleteSubAgent,
  getOffices,
  initOfficesModal,
};
