/**
 * static/js/cyberapps/playbookstudio/view-library.js
 * Library view: browse, filter, run, edit, clone, delete playbooks.
 */

import * as State from './state.js';
import * as Api from './api.js';
import { VAPT_METHODOLOGIES, buildVaptPlaybook } from './data.js';

const CATEGORIES = ['all', 'web-app', 'network', 'active-directory', 'linux', 'windows', 'ctf', 'custom', 'ccna'];

const CAT_COLORS = {
  'web-app': '#4a9eff', 'network': '#22c55e', 'active-directory': '#a78bfa',
  'linux': '#f59e0b', 'windows': '#06b6d4', 'ctf': '#f43f5e',
  'custom': '#6b7280', 'ccna': '#10b981',
};

function _catColor(cat) { return CAT_COLORS[cat] || '#6b7280'; }

function _runCount(pb) {
  const runs = State.getState().runs;
  return runs.filter(r => r.playbookId === pb.id).length;
}

function _lastRun(pb) {
  const runs = State.getState().runs.filter(r => r.playbookId === pb.id);
  if (!runs.length) return null;
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

function _statusColor(status) {
  return { running: '#f59e0b', completed: '#22c55e', abandoned: '#f43f5e' }[status] || '#6b7280';
}

function _varNames(pb) {
  return Object.keys(pb.variables || {});
}

export function render(container) {
  let _unsub;

  function _draw() {
    const { playbooks, categoryFilter } = State.getState();
    const searchEl = container.querySelector('#ps-lib-search');
    const searchVal = searchEl ? searchEl.value.toLowerCase() : '';
    const mitreEl = container.querySelector('#ps-lib-mitre');
    const mitreVal = mitreEl ? mitreEl.value.toLowerCase() : '';

    let filtered = playbooks;
    if (categoryFilter !== 'all') filtered = filtered.filter(p => p.category === categoryFilter);
    if (searchVal) filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchVal) ||
      p.description.toLowerCase().includes(searchVal) ||
      (p.tags || []).some(t => t.toLowerCase().includes(searchVal)));
    if (mitreVal) filtered = filtered.filter(p =>
      (p.steps || []).some(s =>
        (s.mitreTechniqueId || '').toLowerCase().includes(mitreVal) ||
        (s.mitreTechniqueName || '').toLowerCase().includes(mitreVal)));

    const grid = container.querySelector('#ps-lib-grid');
    if (!grid) return;
    grid.innerHTML = filtered.map(pb => _cardHtml(pb)).join('');
    _bindCardEvents(grid);
  }

  function _cardHtml(pb) {
    const color = _catColor(pb.category);
    const last = _lastRun(pb);
    const rc = _runCount(pb);
    const mitreTechniques = [...new Set(
      (pb.steps || []).filter(s => s.mitreTechniqueId).map(s => s.mitreTechniqueId)
    )].slice(0, 3);

    return `
    <div class="ps-card" data-id="${pb.id}">
      <div class="ps-card-header">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <span class="ps-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">${pb.category}</span>
          ${pb.isBuiltIn ? '<span class="ps-badge" style="background:#ffffff0a;color:#aaa;border:1px solid #333;">built-in</span>' : ''}
          ${pb.tags ? pb.tags.slice(0, 3).map(t => `<span class="ps-badge ps-tag">${t}</span>`).join('') : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${rc > 0 ? `<span class="ps-badge" style="background:#ffffff0a;color:#aaa;">${rc} run${rc !== 1 ? 's' : ''}</span>` : ''}
          ${last ? `<span class="ps-badge" style="background:${_statusColor(last.status)}22;color:${_statusColor(last.status)};">${last.status}</span>` : ''}
        </div>
      </div>
      <div class="ps-card-title">${pb.name}</div>
      <div class="ps-card-desc">${pb.description}</div>
      ${mitreTechniques.length ? `<div style="margin-top:6px;font-size:11px;color:#666;">${mitreTechniques.map(t => `<span style="background:#1a1a2e;color:#7c8cf8;border-radius:3px;padding:1px 5px;margin-right:4px;">${t}</span>`).join('')}</div>` : ''}
      <div class="ps-card-meta">
        <span>${pb.steps ? pb.steps.length : 0} steps</span>
        <span>v${pb.version}</span>
      </div>
      <div class="ps-card-actions">
        <button class="ps-btn ps-btn-primary" data-action="run" data-id="${pb.id}">Run</button>
        <button class="ps-btn" data-action="edit" data-id="${pb.id}">Edit</button>
        <button class="ps-btn" data-action="clone" data-id="${pb.id}">Clone</button>
        <button class="ps-btn" data-action="export" data-id="${pb.id}">Export</button>
        ${!pb.isBuiltIn ? `<button class="ps-btn ps-btn-danger" data-action="delete" data-id="${pb.id}">Delete</button>` : ''}
      </div>
    </div>`;
  }

  function _bindCardEvents(grid) {
    grid.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const pb = State.getState().playbooks.find(p => p.id === id);
        if (!pb) return;
        switch (btn.dataset.action) {
          case 'run':    _promptRun(pb); break;
          case 'edit':   _editPlaybook(pb); break;
          case 'clone':  _clonePlaybook(pb); break;
          case 'export': _exportPlaybook(pb); break;
          case 'delete': _deletePlaybook(btn, pb); break;
        }
      });
    });
  }

  function _promptRun(pb) {
    const vars = _varNames(pb);
    if (!vars.length) { _startRun(pb, {}); return; }

    const modal = document.createElement('div');
    modal.className = 'ps-modal-backdrop';
    modal.innerHTML = `
      <div class="ps-modal">
        <div class="ps-modal-title">Set Variables for "${pb.name}"</div>
        ${vars.map(v => `
          <div class="ps-field-row">
            <label class="ps-label">${v}</label>
            <input class="ps-input" data-var="${v}" placeholder="${v}" value="${pb.variables[v] || ''}" />
          </div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end;">
          <button class="ps-btn" id="ps-run-cancel">Cancel</button>
          <button class="ps-btn ps-btn-primary" id="ps-run-start">Start Run</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#ps-run-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#ps-run-start').addEventListener('click', () => {
      const variables = {};
      modal.querySelectorAll('[data-var]').forEach(inp => { variables[inp.dataset.var] = inp.value; });
      modal.remove();
      _startRun(pb, variables);
    });
  }

  async function _startRun(pb, variables) {
    try {
      const now = new Date().toISOString();
      const run = {
        id: `run-${Date.now()}`,
        playbookId: pb.id,
        playbookName: pb.name,
        startedAt: now,
        status: 'running',
        variables,
        steps: pb.steps.map(s => ({ ...s, status: 'todo', operatorNotes: '' })),
      };
      const res = await Api.startRun(run);
      const saved = res.run || run;
      State.setRuns([...State.getState().runs, saved]);
      State.setActiveRun(saved);
      State.setView('run');
    } catch (err) {
      alert('Failed to start run: ' + err.message);
    }
  }

  function _editPlaybook(pb) {
    State.setActivePlaybook(pb);
    State.setView('editor');
  }

  async function _clonePlaybook(pb) {
    try {
      const res = await Api.clonePlaybook(pb.id);
      const cloned = res.playbook;
      State.setPlaybooks([...State.getState().playbooks, cloned]);
    } catch {
      const cloned = { ...pb, id: `${pb.id}-copy-${Date.now()}`, name: `${pb.name} (Copy)`, isBuiltIn: false };
      State.setPlaybooks([...State.getState().playbooks, cloned]);
    }
  }

  function _exportPlaybook(pb) {
    const json = JSON.stringify(pb, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pb.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function _deletePlaybook(btn, pb) {
    if (btn.dataset.armed !== 'true') {
      btn.dataset.armed = 'true';
      btn.textContent = 'Confirm?';
      setTimeout(() => { btn.dataset.armed = 'false'; btn.textContent = 'Delete'; }, 3000);
      return;
    }
    try {
      await Api.deletePlaybook(pb.id);
      State.setPlaybooks(State.getState().playbooks.filter(p => p.id !== pb.id));
    } catch (err) { alert('Delete failed: ' + err.message); }
  }

  function _importVapt(methodologyId) {
    const m = VAPT_METHODOLOGIES.find(v => v.id === methodologyId);
    if (!m) return;
    const template = buildVaptPlaybook(m);
    State.setActivePlaybook({ ...template, id: `vapt-${m.id}-${Date.now()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    State.setView('editor');
  }

  function _buildShell() {
    container.innerHTML = `
      <div class="ps-library">
        <div class="ps-toolbar">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1;">
            ${CATEGORIES.map(c => `<button class="ps-pill ${State.getState().categoryFilter === c ? 'ps-pill-active' : ''}" data-cat="${c}">${c}</button>`).join('')}
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="ps-input" id="ps-lib-search" placeholder="Search..." style="width:160px;" />
            <input class="ps-input" id="ps-lib-mitre" placeholder="MITRE..." style="width:100px;" />
            <button class="ps-btn ps-btn-primary" id="ps-lib-new">+ New</button>
          </div>
        </div>
        <details class="ps-vapt-panel">
          <summary style="cursor:pointer;padding:8px 12px;color:#aaa;font-size:12px;user-select:none;">VAPT Methodology Import</summary>
          <div style="padding:8px 12px;display:flex;gap:8px;flex-wrap:wrap;">
            ${VAPT_METHODOLOGIES.map(m => `
              <div style="flex:1;min-width:200px;background:#0f0f1a;border:1px solid #2a2a4a;border-radius:6px;padding:12px;">
                <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:4px;">${m.name}</div>
                <div style="font-size:11px;color:#aaa;margin-bottom:8px;">${m.description}</div>
                <button class="ps-btn ps-btn-primary" style="font-size:11px;" data-vapt="${m.id}">Import as Playbook</button>
              </div>`).join('')}
          </div>
        </details>
        <div class="ps-grid" id="ps-lib-grid"></div>
      </div>`;

    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => { State.setCategoryFilter(btn.dataset.cat); });
    });
    container.querySelectorAll('[data-vapt]').forEach(btn => {
      btn.addEventListener('click', () => _importVapt(btn.dataset.vapt));
    });
    container.querySelector('#ps-lib-new').addEventListener('click', () => {
      State.setActivePlaybook(null);
      State.setView('editor');
    });
    const search = container.querySelector('#ps-lib-search');
    const mitre = container.querySelector('#ps-lib-mitre');
    search.addEventListener('input', _draw);
    mitre.addEventListener('input', _draw);

    _draw();
  }

  _buildShell();
  _unsub = State.subscribe(() => {
    // Rebuild pills on filter change, redraw grid
    container.querySelectorAll('[data-cat]').forEach(btn => {
      btn.classList.toggle('ps-pill-active', btn.dataset.cat === State.getState().categoryFilter);
    });
    _draw();
  });

  return {
    destroy() {
      if (_unsub) _unsub();
    },
  };
}
