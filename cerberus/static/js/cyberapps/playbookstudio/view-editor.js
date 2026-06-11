/**
 * static/js/cyberapps/playbookstudio/view-editor.js
 * Editor view: create and edit playbooks with steps and variables.
 */

import * as State from './state.js';
import * as Api from './api.js';

const STEP_TYPES = ['action', 'verification', 'documentation', 'command', 'decision'];
const STEP_CATEGORIES = ['recon', 'enum', 'exploit', 'post', 'privesc', 'loot', 'report'];
const PB_CATEGORIES = ['web-app', 'network', 'active-directory', 'linux', 'windows', 'ctf', 'custom', 'ccna'];

const TYPE_COLORS = {
  action: '#4a9eff', verification: '#22c55e', documentation: '#f59e0b',
  command: '#a78bfa', decision: '#f43f5e',
};

let _armedDeleteIdx = null;
let _armedTimer = null;

function _makeStep(order) {
  return {
    id: `step-${Date.now()}-${order}`,
    order,
    title: 'New Step',
    description: '',
    category: 'recon',
    commands: [],
    notes: '',
    required: true,
    stepType: 'action',
    mitreTechniqueId: '',
    mitreTechniqueName: '',
  };
}

export function render(container) {
  let pb = State.getState().activePlaybook
    ? JSON.parse(JSON.stringify(State.getState().activePlaybook))
    : {
        id: `custom-${Date.now()}`,
        name: 'New Playbook',
        description: '',
        category: 'custom',
        tags: [],
        version: '1.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: false,
        variables: {},
        steps: [],
        versions: [],
      };

  let _collapsedSteps = new Set();

  function _draw() {
    container.innerHTML = `
      <div class="ps-editor">
        <div class="ps-editor-header">
          <button class="ps-btn" id="ps-ed-back">← Library</button>
          <span style="color:#aaa;font-size:13px;">${pb.isBuiltIn ? 'Editing built-in (will save as custom copy)' : `Editing: ${pb.name}`}</span>
          <button class="ps-btn ps-btn-primary" id="ps-ed-save">Save</button>
        </div>

        <div class="ps-editor-body">
          <!-- Metadata panel -->
          <div class="ps-panel" style="margin-bottom:12px;">
            <div class="ps-panel-title">Playbook Metadata</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div class="ps-field-row">
                <label class="ps-label">Name</label>
                <input class="ps-input" id="ps-ed-name" value="${_esc(pb.name)}" />
              </div>
              <div class="ps-field-row">
                <label class="ps-label">Category</label>
                <select class="ps-input" id="ps-ed-cat">
                  ${PB_CATEGORIES.map(c => `<option value="${c}" ${pb.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
              </div>
              <div class="ps-field-row">
                <label class="ps-label">Version</label>
                <input class="ps-input" id="ps-ed-version" value="${_esc(pb.version)}" />
              </div>
              <div class="ps-field-row">
                <label class="ps-label">Tags (comma-separated)</label>
                <input class="ps-input" id="ps-ed-tags" value="${(pb.tags || []).join(', ')}" />
              </div>
            </div>
            <div class="ps-field-row" style="margin-top:8px;">
              <label class="ps-label">Description</label>
              <textarea class="ps-input" id="ps-ed-desc" rows="2">${_esc(pb.description)}</textarea>
            </div>
          </div>

          <!-- Variables panel -->
          <div class="ps-panel" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div class="ps-panel-title" style="margin:0;">Variables</div>
              <button class="ps-btn" id="ps-ed-addvar">+ Add Variable</button>
            </div>
            <div id="ps-ed-vars">
              ${Object.entries(pb.variables || {}).map(([k, v]) => _varRow(k, v)).join('')}
            </div>
            <div style="font-size:11px;color:#666;margin-top:6px;">Use <code style="color:#7c8cf8;">{{VAR_NAME}}</code> in commands and descriptions.</div>
          </div>

          <!-- Steps panel -->
          <div class="ps-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div class="ps-panel-title" style="margin:0;">Steps (${pb.steps.length})</div>
              <button class="ps-btn ps-btn-primary" id="ps-ed-addstep">+ Add Step</button>
            </div>
            <div id="ps-ed-steps">
              ${pb.steps.map((s, i) => _stepHtml(s, i)).join('')}
            </div>
          </div>
        </div>
      </div>`;

    _bindEditorEvents();
  }

  function _varRow(k, v) {
    return `<div class="ps-var-row" data-vkey="${_esc(k)}">
      <input class="ps-input" style="width:120px;" placeholder="KEY" value="${_esc(k)}" data-vk />
      <input class="ps-input" style="flex:1;" placeholder="default value" value="${_esc(v)}" data-vv />
      <button class="ps-btn ps-btn-danger" style="padding:4px 8px;" data-rm-var>X</button>
    </div>`;
  }

  function _stepHtml(s, i) {
    const color = TYPE_COLORS[s.stepType] || '#aaa';
    const collapsed = _collapsedSteps.has(i);
    return `
    <div class="ps-step-row" data-step-idx="${i}">
      <div class="ps-step-header" data-toggle="${i}">
        <span style="color:#666;font-size:12px;min-width:22px;">${i + 1}.</span>
        <span style="background:${color}33;color:${color};border-radius:3px;padding:1px 6px;font-size:11px;">${(s.stepType || 'action').charAt(0).toUpperCase()}</span>
        <span style="flex:1;font-size:13px;color:#e2e8f0;">${_esc(s.title)}</span>
        ${s.mitreTechniqueId ? `<span style="font-size:10px;color:#7c8cf8;background:#1a1a2e;border-radius:3px;padding:1px 5px;">${s.mitreTechniqueId}</span>` : ''}
        <span style="font-size:10px;color:#aaa;">${s.category}</span>
        ${s.required ? '<span style="color:#f43f5e;font-size:11px;">*</span>' : ''}
        <span style="color:#666;font-size:16px;">${collapsed ? '▶' : '▼'}</span>
      </div>
      ${collapsed ? '' : _stepBody(s, i)}
    </div>`;
  }

  function _stepBody(s, i) {
    return `
    <div class="ps-step-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
        <div class="ps-field-row">
          <label class="ps-label">Title</label>
          <input class="ps-input" data-sf="title" data-idx="${i}" value="${_esc(s.title)}" />
        </div>
        <div class="ps-field-row">
          <label class="ps-label">Category</label>
          <select class="ps-input" data-sf="category" data-idx="${i}">
            ${STEP_CATEGORIES.map(c => `<option value="${c}" ${s.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="ps-field-row" style="margin-bottom:8px;">
        <label class="ps-label">Step Type</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${STEP_TYPES.map(t => `<button class="ps-pill ${s.stepType === t ? 'ps-pill-active' : ''}" data-st="${t}" data-idx="${i}" style="font-size:11px;">${t}</button>`).join('')}
        </div>
      </div>
      <div class="ps-field-row" style="margin-bottom:8px;">
        <label class="ps-label">Description</label>
        <textarea class="ps-input" data-sf="description" data-idx="${i}" rows="2">${_esc(s.description)}</textarea>
      </div>
      <div class="ps-field-row" style="margin-bottom:8px;">
        <label class="ps-label">Commands (one per line)</label>
        <textarea class="ps-input" data-sf="commands" data-idx="${i}" rows="3">${(s.commands || []).join('\n')}</textarea>
      </div>
      <div class="ps-field-row" style="margin-bottom:8px;">
        <label class="ps-label">Notes / Guidance</label>
        <textarea class="ps-input" data-sf="notes" data-idx="${i}" rows="2">${_esc(s.notes)}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">
        <div class="ps-field-row">
          <label class="ps-label">MITRE Technique ID</label>
          <input class="ps-input" data-sf="mitreTechniqueId" data-idx="${i}" value="${_esc(s.mitreTechniqueId || '')}" placeholder="e.g. T1046" />
        </div>
        <div class="ps-field-row">
          <label class="ps-label">MITRE Technique Name</label>
          <input class="ps-input" data-sf="mitreTechniqueName" data-idx="${i}" value="${_esc(s.mitreTechniqueName || '')}" placeholder="e.g. Network Service Discovery" />
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;gap:6px;align-items:center;color:#aaa;font-size:12px;">
          <input type="checkbox" data-sf="required" data-idx="${i}" ${s.required ? 'checked' : ''} />
          Required
        </label>
        <button class="ps-btn" data-move="up" data-idx="${i}">↑</button>
        <button class="ps-btn" data-move="down" data-idx="${i}">↓</button>
        <button class="ps-btn" data-dup="${i}">Duplicate</button>
        <button class="ps-btn ps-btn-danger" data-del="${i}" ${_armedDeleteIdx === i ? 'data-armed' : ''}>
          ${_armedDeleteIdx === i ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>`;
  }

  function _bindEditorEvents() {
    container.querySelector('#ps-ed-back')?.addEventListener('click', () => { State.setView('library'); });
    container.querySelector('#ps-ed-save')?.addEventListener('click', _save);
    container.querySelector('#ps-ed-addstep')?.addEventListener('click', () => {
      pb.steps.push(_makeStep(pb.steps.length + 1));
      _draw();
    });
    container.querySelector('#ps-ed-addvar')?.addEventListener('click', () => {
      const varsDiv = container.querySelector('#ps-ed-vars');
      const row = document.createElement('div');
      row.innerHTML = _varRow('', '');
      varsDiv.appendChild(row.firstElementChild);
    });

    // Variable remove
    container.querySelectorAll('[data-rm-var]').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.ps-var-row').remove());
    });

    // Step collapse toggle
    container.querySelectorAll('[data-toggle]').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const idx = parseInt(hdr.dataset.toggle);
        if (_collapsedSteps.has(idx)) _collapsedSteps.delete(idx);
        else _collapsedSteps.add(idx);
        _readFields();
        _draw();
      });
    });

    // Step field changes
    container.querySelectorAll('[data-sf]').forEach(el => {
      el.addEventListener('change', _readFields);
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.addEventListener('input', () => {});
    });

    // Step type pills
    container.querySelectorAll('[data-st]').forEach(btn => {
      btn.addEventListener('click', () => {
        _readFields();
        const idx = parseInt(btn.dataset.idx);
        pb.steps[idx].stepType = btn.dataset.st;
        _draw();
      });
    });

    // Move up/down
    container.querySelectorAll('[data-move]').forEach(btn => {
      btn.addEventListener('click', () => {
        _readFields();
        const idx = parseInt(btn.dataset.idx);
        const dir = btn.dataset.move;
        if (dir === 'up' && idx > 0) {
          [pb.steps[idx - 1], pb.steps[idx]] = [pb.steps[idx], pb.steps[idx - 1]];
          _reorderSteps();
          _draw();
        } else if (dir === 'down' && idx < pb.steps.length - 1) {
          [pb.steps[idx + 1], pb.steps[idx]] = [pb.steps[idx], pb.steps[idx + 1]];
          _reorderSteps();
          _draw();
        }
      });
    });

    // Duplicate
    container.querySelectorAll('[data-dup]').forEach(btn => {
      btn.addEventListener('click', () => {
        _readFields();
        const idx = parseInt(btn.dataset.dup);
        const copy = { ...pb.steps[idx], id: `step-${Date.now()}` };
        pb.steps.splice(idx + 1, 0, copy);
        _reorderSteps();
        _draw();
      });
    });

    // Delete
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del);
        if (_armedDeleteIdx === idx) {
          clearTimeout(_armedTimer);
          _armedDeleteIdx = null;
          _readFields();
          pb.steps.splice(idx, 1);
          _reorderSteps();
          _draw();
        } else {
          _armedDeleteIdx = idx;
          _armedTimer = setTimeout(() => { _armedDeleteIdx = null; _draw(); }, 3000);
          _draw();
        }
      });
    });
  }

  function _readFields() {
    pb.name = container.querySelector('#ps-ed-name')?.value || pb.name;
    pb.category = container.querySelector('#ps-ed-cat')?.value || pb.category;
    pb.version = container.querySelector('#ps-ed-version')?.value || pb.version;
    const tagsVal = container.querySelector('#ps-ed-tags')?.value || '';
    pb.tags = tagsVal.split(',').map(t => t.trim()).filter(Boolean);
    pb.description = container.querySelector('#ps-ed-desc')?.value || '';

    // Read variables
    pb.variables = {};
    container.querySelectorAll('.ps-var-row').forEach(row => {
      const k = row.querySelector('[data-vk]')?.value?.trim();
      const v = row.querySelector('[data-vv]')?.value || '';
      if (k) pb.variables[k] = v;
    });

    // Read step fields
    container.querySelectorAll('[data-sf]').forEach(el => {
      const idx = parseInt(el.dataset.idx);
      if (isNaN(idx) || idx >= pb.steps.length) return;
      const field = el.dataset.sf;
      if (field === 'commands') {
        pb.steps[idx].commands = el.value.split('\n').map(c => c.trim()).filter(Boolean);
      } else if (field === 'required') {
        pb.steps[idx].required = el.checked;
      } else {
        pb.steps[idx][field] = el.value;
      }
    });
  }

  function _reorderSteps() {
    pb.steps.forEach((s, i) => { s.order = i + 1; });
  }

  async function _save() {
    _readFields();
    pb.updatedAt = new Date().toISOString();
    if (pb.isBuiltIn) {
      pb.isBuiltIn = false;
      pb.id = `${pb.id}-custom-${Date.now()}`;
    }
    try {
      const res = await Api.savePlaybook(pb);
      const saved = res.playbook || pb;
      const existing = State.getState().playbooks.findIndex(p => p.id === saved.id);
      if (existing >= 0) {
        const updated = [...State.getState().playbooks];
        updated[existing] = saved;
        State.setPlaybooks(updated);
      } else {
        State.setPlaybooks([...State.getState().playbooks, saved]);
      }
      State.setActivePlaybook(saved);
      State.setView('library');
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  function _esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _draw();
  return { destroy() {} };
}
