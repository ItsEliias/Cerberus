/**
 * static/js/cyberapps/playbookstudio/view-editor.js
 * Editor view: create/edit playbooks and their steps.
 */

import * as State from './state.js';
import * as Api from './api.js';
import { BUILTIN_PLAYBOOKS } from './data.js';

const STEP_CATS = ['recon', 'enum', 'exploit', 'post', 'privesc', 'loot', 'report'];
const STEP_TYPES = ['action', 'verification', 'documentation', 'command', 'decision'];
const PB_CATS = ['web-app', 'network', 'active-directory', 'linux', 'windows', 'ctf', 'custom', 'ccna'];
const STEP_TYPE_COLORS = {
  action: '#4a9eff', verification: '#3fb950', documentation: '#8b949e',
  command: '#d29922', decision: '#bc8cff',
};

let _pb = null;
let _saving = false;
let _error = '';
let _openSteps = new Set();
let _deleteArmedSteps = new Set();

function uid() { return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStep(step, idx, total, knownVars) {
  const typeColor = STEP_TYPE_COLORS[step.stepType || 'action'];
  const isOpen = _openSteps.has(step.id);
  const disabled = _pb.isBuiltIn;

  return `
<div class="ps-step-row" data-step-id="${escHtml(step.id)}" style="border:1px solid var(--border,#3a2a2a);border-left:3px solid ${typeColor};border-radius:6px;overflow:hidden">
  <div class="ps-step-header" data-toggle="${escHtml(step.id)}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;background:var(--bg,#1a1d23)">
    <span style="font-size:11px;width:20px;height:20px;border-radius:4px;background:var(--border);color:var(--fg);display:flex;align-items:center;justify-content:center;font-family:monospace;flex-shrink:0">${idx + 1}</span>
    <span style="flex-shrink:0;width:18px;height:18px;border-radius:4px;background:${typeColor}18;display:flex;align-items:center;justify-content:center;font-size:9px;color:${typeColor}">${(step.stepType || 'A')[0].toUpperCase()}</span>
    <span style="flex:1;font-size:13px;font-weight:500;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(step.title || 'Untitled step')}</span>
    ${step.mitreTechniqueId ? `<span style="font-size:10px;padding:2px 5px;border-radius:4px;font-family:monospace;background:rgba(188,140,255,.12);color:#bc8cff;flex-shrink:0">${escHtml(step.mitreTechniqueId)}</span>` : ''}
    <span style="font-size:10px;padding:2px 5px;border-radius:4px;background:${typeColor}1a;color:${typeColor};flex-shrink:0">${escHtml(step.stepType || 'action')}</span>
    ${step.required ? `<span style="font-size:10px;color:#d29922;flex-shrink:0">req</span>` : ''}
    <span style="color:var(--fg);opacity:.4;flex-shrink:0">${isOpen ? '▲' : '▼'}</span>
  </div>
  ${isOpen ? `
  <div class="ps-step-body" style="padding:10px;border-top:1px solid var(--border);background:var(--bg);display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;gap:8px">
      <div style="flex:1">
        <label class="ps-label">Title</label>
        <input class="ps-input ps-step-title" data-step="${escHtml(step.id)}" value="${escHtml(step.title)}" ${disabled ? 'disabled' : ''}>
      </div>
      <div>
        <label class="ps-label">Category</label>
        <select class="ps-input ps-step-cat" data-step="${escHtml(step.id)}" ${disabled ? 'disabled' : ''}>
          ${STEP_CATS.map(c => `<option${c === step.category ? ' selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
    <div>
      <label class="ps-label">Step Type</label>
      <div style="display:flex;gap:4px;padding:3px;border-radius:20px;background:var(--bg);border:1px solid var(--border);width:fit-content">
        ${STEP_TYPES.map(t => {
          const tc = STEP_TYPE_COLORS[t];
          const active = (step.stepType || 'action') === t;
          return `<button class="ps-type-btn${active ? ' active' : ''}" data-step="${escHtml(step.id)}" data-type="${t}" ${disabled ? 'disabled' : ''}
            style="font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid ${active ? tc + '44' : 'transparent'};background:${active ? tc + '22' : 'transparent'};color:${active ? tc : 'var(--fg)'};font-weight:${active ? 600 : 400}">${t}</button>`;
        }).join('')}
      </div>
    </div>
    <div>
      <label class="ps-label">Description</label>
      <textarea class="ps-input ps-step-desc" data-step="${escHtml(step.id)}" rows="2" ${disabled ? 'disabled' : ''}>${escHtml(step.description)}</textarea>
    </div>
    <div>
      <label class="ps-label">Commands (one per line)</label>
      <textarea class="ps-input ps-input-mono ps-step-cmds" data-step="${escHtml(step.id)}" rows="${Math.max(3, step.commands.length + 1)}" ${disabled ? 'disabled' : ''}>${escHtml(step.commands.join('\n'))}</textarea>
    </div>
    <div>
      <label class="ps-label">Guidance notes</label>
      <textarea class="ps-input ps-step-notes" data-step="${escHtml(step.id)}" rows="2" ${disabled ? 'disabled' : ''}>${escHtml(step.notes)}</textarea>
    </div>
    <div style="display:flex;gap:8px">
      <div style="flex:1">
        <label class="ps-label">MITRE ID (e.g. T1059.001)</label>
        <input class="ps-input ps-input-mono ps-step-mitre" data-step="${escHtml(step.id)}" value="${escHtml(step.mitreTechniqueId || '')}" placeholder="T1234.001" ${disabled ? 'disabled' : ''}>
      </div>
      <div style="flex:1">
        <label class="ps-label">MITRE Technique Name</label>
        <input class="ps-input ps-step-mitre-name" data-step="${escHtml(step.id)}" value="${escHtml(step.mitreTechniqueName || '')}" placeholder="Command and Scripting Interpreter" ${disabled ? 'disabled' : ''}>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding-top:6px;border-top:1px solid var(--border)">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--fg)">
        <input type="checkbox" class="ps-step-req" data-step="${escHtml(step.id)}" ${step.required ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        Required
      </label>
      <div style="display:flex;gap:4px">
        <button class="ps-btn ps-step-up" data-step="${escHtml(step.id)}" ${idx === 0 || disabled ? 'disabled' : ''}>↑</button>
        <button class="ps-btn ps-step-down" data-step="${escHtml(step.id)}" ${idx === total - 1 || disabled ? 'disabled' : ''}>↓</button>
        <button class="ps-btn ps-step-dup" data-step="${escHtml(step.id)}" ${disabled ? 'disabled' : ''}>Dup</button>
        <button class="ps-btn ps-btn-danger-xs ps-step-del" data-step="${escHtml(step.id)}" ${disabled ? 'disabled' : ''}
          style="${_deleteArmedSteps.has(step.id) ? 'background:var(--red,#c0392b);color:#fff;font-weight:700' : ''}">
          ${_deleteArmedSteps.has(step.id) ? 'Confirm Del' : 'Del'}
        </button>
      </div>
    </div>
  </div>` : ''}
</div>`;
}

export function render(container) {
  const { activePlaybook } = State.getState();
  _pb = activePlaybook ? { ..._deepClone(activePlaybook) } : {
    id: `custom-${Date.now()}`,
    name: '', description: '', category: 'custom', tags: [],
    version: '1.0', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    steps: [], isBuiltIn: false, variables: {},
  };

  function _deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function draw() {
    const knownVars = Object.keys(_pb.variables || {});
    const disabled = _pb.isBuiltIn;

    container.innerHTML = `
<div class="ps-editor">
  <div class="ps-editor-header">
    <button id="ps-ed-back" class="ps-btn" style="display:flex;align-items:center;gap:4px">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2L3 6l5 4"/></svg>
      Library
    </button>
    <div style="width:1px;height:16px;background:var(--border);flex-shrink:0"></div>
    <span style="font-size:13px;font-weight:500;color:var(--fg)">${disabled ? escHtml(_pb.name) + ' (view only)' : escHtml(_pb.name || 'Untitled Playbook')}</span>
    ${_error ? `<span style="font-size:11px;color:#f85149;flex-shrink:0">${escHtml(_error)}</span>` : ''}
    <div style="flex:1"></div>
    ${!disabled ? `<button id="ps-ed-save" class="ps-btn ps-btn-primary" ${_saving ? 'disabled' : ''}>${_saving ? 'Saving…' : 'Save'}</button>` : ''}
  </div>

  <div class="ps-editor-body">
    <div class="ps-meta-panel">
      <div class="ps-section-label">Playbook Details</div>
      <div style="display:flex;gap:10px">
        <div style="flex:1">
          <label class="ps-label">Name</label>
          <input id="ps-ed-name" class="ps-input" value="${escHtml(_pb.name)}" ${disabled ? 'disabled' : ''}>
        </div>
        <div>
          <label class="ps-label">Category</label>
          <select id="ps-ed-cat" class="ps-input" ${disabled ? 'disabled' : ''}>
            ${PB_CATS.map(c => `<option${c === _pb.category ? ' selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="ps-label">Version</label>
          <input id="ps-ed-ver" class="ps-input" style="width:70px" value="${escHtml(_pb.version)}" ${disabled ? 'disabled' : ''}>
        </div>
      </div>
      <div>
        <label class="ps-label">Description</label>
        <textarea id="ps-ed-desc" class="ps-input" rows="2" ${disabled ? 'disabled' : ''}>${escHtml(_pb.description)}</textarea>
      </div>
      <div>
        <label class="ps-label">Tags (comma-separated)</label>
        <input id="ps-ed-tags" class="ps-input" value="${escHtml((_pb.tags || []).join(', '))}" ${disabled ? 'disabled' : ''}>
      </div>
    </div>

    <div class="ps-vars-panel">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="ps-section-label" style="color:#2dd4bf">Variables</div>
        <span style="font-size:11px;color:#484f58">Use {{'{{'}}key{{'}}'}} in commands</span>
      </div>
      ${Object.entries(_pb.variables || {}).map(([k, v]) => `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;font-family:monospace;padding:2px 6px;background:rgba(45,212,191,.08);color:#2dd4bf;border-radius:4px;border:1px solid rgba(45,212,191,.18);min-width:80px;text-align:right;flex-shrink:0">{{${escHtml(k)}}}</span>
        <input class="ps-input ps-var-val" data-key="${escHtml(k)}" value="${escHtml(v)}" placeholder="default value" style="flex:1;font-family:monospace;font-size:12px" ${disabled ? 'disabled' : ''}>
        ${!disabled ? `<button class="ps-btn ps-btn-danger-xs ps-var-del" data-key="${escHtml(k)}">✕</button>` : ''}
      </div>`).join('')}
      ${!disabled ? `
      <div id="ps-var-add-row" style="display:flex;gap:6px;padding-top:6px;border-top:1px solid var(--border)">
        <input id="ps-var-new-key" class="ps-input ps-input-mono" style="flex:1" placeholder="new variable name">
        <button id="ps-var-add" class="ps-btn">Add</button>
      </div>
      <div id="ps-var-err" style="display:none;font-size:11px;color:#f85149"></div>` : ''}
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin:8px 0 4px">
      <div style="display:flex;align-items:center;gap:6px">
        <div style="width:2px;height:14px;background:#4a9eff;border-radius:2px"></div>
        <span style="font-size:13px;font-weight:600;color:var(--fg)">Steps</span>
        <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(74,158,255,.08);color:#4a9eff;border:1px solid rgba(74,158,255,.18);font-family:monospace">${_pb.steps.length}</span>
      </div>
      ${!disabled ? `<button id="ps-add-step" class="ps-btn">+ Add Step</button>` : ''}
    </div>

    <div id="ps-steps-list" style="display:flex;flex-direction:column;gap:6px">
      ${_pb.steps.length === 0 ? `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;border:1px dashed rgba(42,51,71,.4);border-radius:6px;gap:8px">
        <p style="font-size:13px;color:#484f58">No steps yet. Add your first step above.</p>
      </div>` :
      _pb.steps.map((s, i) => renderStep(s, i, _pb.steps.length, knownVars)).join('')}
    </div>
  </div>
</div>`;

    bindEvents();
  }

  function bindEvents() {
    const q = sel => container.querySelector(sel);
    const qa = sel => container.querySelectorAll(sel);

    q('#ps-ed-back')?.addEventListener('click', () => State.setView('library'));
    q('#ps-ed-save')?.addEventListener('click', handleSave);
    q('#ps-ed-name')?.addEventListener('input', e => { _pb.name = e.target.value; });
    q('#ps-ed-cat')?.addEventListener('change', e => { _pb.category = e.target.value; });
    q('#ps-ed-ver')?.addEventListener('input', e => { _pb.version = e.target.value; });
    q('#ps-ed-desc')?.addEventListener('input', e => { _pb.description = e.target.value; });
    q('#ps-ed-tags')?.addEventListener('input', e => {
      _pb.tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
    });

    // Variables
    qa('.ps-var-val').forEach(el => {
      el.addEventListener('input', e => {
        if (!_pb.variables) _pb.variables = {};
        _pb.variables[e.target.dataset.key] = e.target.value;
      });
    });
    qa('.ps-var-del').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_pb.variables) { delete _pb.variables[btn.dataset.key]; }
        draw();
      });
    });
    const varAddBtn = q('#ps-var-add');
    const varKeyInput = q('#ps-var-new-key');
    if (varAddBtn && varKeyInput) {
      function addVar() {
        const key = varKeyInput.value.trim();
        const errEl = q('#ps-var-err');
        if (!key) return;
        if (/[{}]/.test(key)) { if (errEl) { errEl.textContent = 'Name cannot contain { or }'; errEl.style.display = ''; } return; }
        if (_pb.variables && Object.prototype.hasOwnProperty.call(_pb.variables, key)) {
          if (errEl) { errEl.textContent = `'${key}' already exists`; errEl.style.display = ''; }
          return;
        }
        if (!_pb.variables) _pb.variables = {};
        _pb.variables[key] = '';
        draw();
      }
      varAddBtn.addEventListener('click', addVar);
      varKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') addVar(); });
    }

    q('#ps-add-step')?.addEventListener('click', () => {
      const newStep = {
        id: uid(), order: _pb.steps.length + 1, title: '', description: '',
        category: 'recon', commands: [], notes: '', required: false, stepType: 'action',
      };
      _pb.steps.push(newStep);
      _openSteps.add(newStep.id);
      draw();
    });

    // Step toggles
    qa('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.toggle;
        if (_openSteps.has(id)) _openSteps.delete(id); else _openSteps.add(id);
        draw();
      });
    });

    // Step field updates
    qa('.ps-step-title').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { title: e.target.value }); }));
    qa('.ps-step-cat').forEach(el => el.addEventListener('change', e => { _updateStep(e.target.dataset.step, { category: e.target.value }); }));
    qa('.ps-step-desc').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { description: e.target.value }); }));
    qa('.ps-step-cmds').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { commands: e.target.value.split('\n') }); }));
    qa('.ps-step-notes').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { notes: e.target.value }); }));
    qa('.ps-step-mitre').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { mitreTechniqueId: e.target.value || undefined }); }));
    qa('.ps-step-mitre-name').forEach(el => el.addEventListener('input', e => { _updateStep(e.target.dataset.step, { mitreTechniqueName: e.target.value || undefined }); }));
    qa('.ps-step-req').forEach(el => el.addEventListener('change', e => { _updateStep(e.target.dataset.step, { required: e.target.checked }); }));
    qa('.ps-type-btn').forEach(btn => {
      btn.addEventListener('click', () => { _updateStep(btn.dataset.step, { stepType: btn.dataset.type }); draw(); });
    });

    // Step controls
    qa('.ps-step-up').forEach(btn => btn.addEventListener('click', () => { _moveStep(btn.dataset.step, -1); draw(); }));
    qa('.ps-step-down').forEach(btn => btn.addEventListener('click', () => { _moveStep(btn.dataset.step, 1); draw(); }));
    qa('.ps-step-dup').forEach(btn => btn.addEventListener('click', () => { _dupStep(btn.dataset.step); draw(); }));
    qa('.ps-step-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.step;
        if (!_deleteArmedSteps.has(id)) {
          _deleteArmedSteps.add(id);
          draw();
          setTimeout(() => { _deleteArmedSteps.delete(id); if (container.isConnected) draw(); }, 3000);
        } else {
          _deleteArmedSteps.delete(id);
          _pb.steps = _pb.steps.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i + 1 }));
          _openSteps.delete(id);
          draw();
        }
      });
    });
  }

  function _updateStep(id, patch) {
    const idx = _pb.steps.findIndex(s => s.id === id);
    if (idx !== -1) Object.assign(_pb.steps[idx], patch);
  }

  function _moveStep(id, dir) {
    const idx = _pb.steps.findIndex(s => s.id === id);
    if (idx === -1) return;
    const target = idx + dir;
    if (target < 0 || target >= _pb.steps.length) return;
    [_pb.steps[idx], _pb.steps[target]] = [_pb.steps[target], _pb.steps[idx]];
    _pb.steps.forEach((s, i) => { s.order = i + 1; });
  }

  function _dupStep(id) {
    const idx = _pb.steps.findIndex(s => s.id === id);
    if (idx === -1) return;
    const copy = { ..._deepClone(_pb.steps[idx]), id: uid(), order: idx + 2 };
    _pb.steps.splice(idx + 1, 0, copy);
    _pb.steps.forEach((s, i) => { s.order = i + 1; });
  }

  function _deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  async function handleSave() {
    if (!_pb.name.trim()) { _error = 'Playbook name is required.'; draw(); return; }
    _saving = true; _error = ''; draw();
    try {
      const res = await Api.savePlaybook(_pb);
      if (res.ok && res.playbook) {
        _pb = res.playbook;
        State.setActivePlaybook(_pb);
        const custom = await Api.fetchPlaybooks();
        State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !BUILTIN_PLAYBOOKS.some(b => b.id === p.id))]);
      } else {
        _error = 'Save failed';
      }
    } catch (err) {
      _error = err.message;
    }
    _saving = false;
    draw();
  }

  const unsub = State.subscribe(() => {}); // re-render only on explicit calls
  draw();

  return { destroy: () => { unsub(); _openSteps.clear(); _deleteArmedSteps.clear(); } };
}
