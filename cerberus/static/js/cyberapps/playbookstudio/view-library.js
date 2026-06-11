/**
 * static/js/cyberapps/playbookstudio/view-library.js
 * Library view: grid of playbook cards with search/filter/sort.
 */

import * as State from './state.js';
import * as Api from './api.js';
import { VAPT_METHODOLOGIES, BUILTIN_PLAYBOOKS } from './data.js';

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'templates', label: 'Templates' },
  { id: 'web-app', label: 'Web App' },
  { id: 'network', label: 'Network' },
  { id: 'active-directory', label: 'Active Directory' },
  { id: 'linux', label: 'Linux' },
  { id: 'windows', label: 'Windows' },
  { id: 'ctf', label: 'CTF' },
  { id: 'ccna', label: 'CCNA' },
  { id: 'custom', label: 'Custom' },
];

const CAT_COLORS = {
  'web-app': '#e3b341',
  'network': '#58a6ff',
  'active-directory': '#bc8cff',
  'linux': '#3fb950',
  'windows': '#79c0ff',
  'ctf': '#ff7b72',
  'custom': '#8b949e',
  'ccna': '#f0883e',
};

function estimatedTime(stepCount) {
  const mins = stepCount * 3;
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

function highlightMatch(text, term) {
  if (!term.trim()) return escHtml(text);
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return escHtml(text);
  return (
    escHtml(text.slice(0, idx)) +
    `<em style="font-style:normal;color:#2dd4bf;background:rgba(45,212,191,.12);border-radius:2px">${escHtml(text.slice(idx, idx + term.length))}</em>` +
    escHtml(text.slice(idx + term.length))
  );
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runBadge(run) {
  if (!run) return '';
  if (run.status === 'running') return `<span style="background:rgba(210,153,34,.12);color:#d29922;border:1px solid rgba(210,153,34,.28)" class="ps-badge">Running</span>`;
  if (run.status === 'abandoned') return `<span style="background:rgba(248,81,73,.10);color:#f85149;border:1px solid rgba(248,81,73,.25)" class="ps-badge">Abandoned</span>`;
  const anyReq = run.steps.some(s => s.required && s.status !== 'done' && s.status !== 'skipped');
  if (anyReq) return `<span style="background:rgba(248,81,73,.10);color:#f85149;border:1px solid rgba(248,81,73,.25)" class="ps-badge">Fail</span>`;
  return `<span style="background:rgba(63,185,80,.10);color:#3fb950;border:1px solid rgba(63,185,80,.25)" class="ps-badge">Pass</span>`;
}

function renderCard(pb, searchTerm, runs) {
  const catColor = CAT_COLORS[pb.category] || '#8b949e';
  const pbRuns = runs.filter(r => r.playbookId === pb.id);
  const lastRun = pbRuns.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
  const runCount = pbRuns.length;
  const mitreTactics = [...new Set(pb.steps.flatMap(s => s.mitreTechniqueId ? [s.mitreTechniqueId.split('.')[0]] : []))];

  const lastRunLabel = (() => {
    if (!lastRun) return '';
    const diff = Date.now() - new Date(lastRun.startedAt).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  })();

  return `
<div class="ps-card" data-id="${escHtml(pb.id)}">
  <div class="ps-card-head">
    <div class="ps-card-meta">
      <div class="ps-card-badges">
        <span class="ps-badge" style="background:${catColor}18;color:${catColor};border:1px solid ${catColor}30">${escHtml(pb.category)}</span>
        ${pb.isBuiltIn ? `<span class="ps-badge" style="background:rgba(74,158,255,.08);color:#4a9eff;border:1px solid rgba(74,158,255,.18)">built-in</span>` : ''}
        ${mitreTactics.slice(0, 2).map(t => `<span class="ps-badge ps-badge-mono" style="background:rgba(188,140,255,.08);color:#bc8cff;border:1px solid rgba(188,140,255,.2)">${escHtml(t)}</span>`).join('')}
      </div>
      <div class="ps-card-name">${highlightMatch(pb.name, searchTerm)}</div>
      <div class="ps-card-desc">${escHtml(pb.description)}</div>
      ${pb.tags && pb.tags.length > 0 ? `<div class="ps-card-tags">${pb.tags.slice(0, 3).map(t => `<span class="ps-tag">#${escHtml(t)}</span>`).join('')}${pb.tags.length > 3 ? `<span style="color:#484f58;font-size:10px">+${pb.tags.length - 3}</span>` : ''}</div>` : ''}
    </div>
  </div>
  <div class="ps-card-foot">
    <div class="ps-card-stats">
      <span class="ps-badge ps-badge-mono" style="background:rgba(74,158,255,.08);color:#4a9eff;border:1px solid rgba(74,158,255,.2)">${pb.steps.length} steps</span>
      <span class="ps-badge" style="background:rgba(42,51,71,.25);color:#8b949e;border:1px solid rgba(42,51,71,.4)">${estimatedTime(pb.steps.length)}</span>
      ${runBadge(lastRun)}
      ${runCount > 0 ? `<span style="color:#8b949e;font-size:11px">Run ${runCount}x${lastRunLabel ? ` · ${lastRunLabel}` : ''}</span>` : ''}
    </div>
    <div class="ps-card-actions">
      <button class="ps-btn ps-btn-primary ps-card-run" data-id="${escHtml(pb.id)}">Run</button>
      ${!pb.isBuiltIn ? `<button class="ps-btn ps-card-edit" data-id="${escHtml(pb.id)}">Edit</button>` : ''}
      <button class="ps-btn ps-card-clone" data-id="${escHtml(pb.id)}">Clone</button>
      <button class="ps-btn ps-card-export" data-id="${escHtml(pb.id)}">Export</button>
      ${!pb.isBuiltIn ? `<button class="ps-btn ps-btn-danger ps-card-del" data-id="${escHtml(pb.id)}">Del</button>` : ''}
    </div>
  </div>
</div>`;
}

export function render(container) {
  const { playbooks, runs, categoryFilter } = State.getState();
  let searchTerm = '';
  let mitreFilter = '';
  let showVapt = false;
  let activeTags = new Set();
  const deleteArmed = new Set();

  function filtered() {
    let list = playbooks;
    if (categoryFilter === 'templates') list = list.filter(p => p.isBuiltIn);
    else if (categoryFilter === 'custom') list = list.filter(p => !p.isBuiltIn);
    else if (categoryFilter !== 'all') list = list.filter(p => p.category === categoryFilter);
    if (mitreFilter.trim()) {
      const q = mitreFilter.trim().toUpperCase();
      list = list.filter(p => p.steps.some(s =>
        (s.mitreTechniqueId || '').toUpperCase().includes(q) ||
        (s.mitreTechniqueName || '').toUpperCase().includes(q)
      ));
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    if (activeTags.size > 0) {
      list = list.filter(p => (p.tags || []).some(t => activeTags.has(t)));
    }
    return list;
  }

  function allTags() {
    const s = new Set();
    playbooks.forEach(p => (p.tags || []).forEach(t => t && s.add(t)));
    return Array.from(s).sort();
  }

  function draw() {
    const { playbooks: pbs, runs: rs, categoryFilter: cf } = State.getState();
    const list = filtered();
    const tags = allTags();

    container.innerHTML = `
<div class="ps-library">
  <div class="ps-toolbar">
    <div class="ps-cat-pills">
      ${CATEGORIES.map(cat => `<button class="ps-pill${cf === cat.id ? ' active' : ''}" data-cat="${cat.id}">${cat.label}</button>`).join('')}
    </div>
    <div class="ps-toolbar-right">
      <input id="ps-search" class="ps-input ps-input-sm" placeholder="Search playbooks…" value="${escHtml(searchTerm)}">
      <input id="ps-mitre" class="ps-input ps-input-sm ps-input-mono" placeholder="MITRE filter…" value="${escHtml(mitreFilter)}">
      <button id="ps-import-btn" class="ps-btn">Import</button>
      <button id="ps-vapt-btn" class="ps-btn${showVapt ? ' ps-btn-active' : ''}">VAPT Methods</button>
      <button id="ps-new-btn" class="ps-btn ps-btn-primary">+ New Playbook</button>
    </div>
  </div>

  ${tags.length > 0 ? `
  <div class="ps-tag-bar">
    <span class="ps-dim">Tags:</span>
    ${activeTags.size > 0 ? `<button id="ps-tag-clear" class="ps-btn ps-btn-danger-xs">clear</button>` : ''}
    ${tags.map(t => `<button class="ps-pill-tag${activeTags.has(t) ? ' active' : ''}" data-tag="${escHtml(t)}">#${escHtml(t)}</button>`).join('')}
  </div>` : ''}

  ${showVapt ? `
  <div class="ps-vapt-bar">
    <div class="ps-section-label">Import VAPT Methodology</div>
    <div class="ps-vapt-methods">
      ${VAPT_METHODOLOGIES.map(m => `<button class="ps-btn ps-vapt-import" data-vapt="${escHtml(m.id)}" title="${escHtml(m.description)}">${escHtml(m.name)}</button>`).join('')}
    </div>
    <div class="ps-dim" style="font-size:11px">Each phase becomes a step. Imports as a custom playbook you can edit.</div>
  </div>` : ''}

  <div id="ps-import-status" style="display:none" class="ps-status-bar"></div>

  <div class="ps-grid">
    ${list.length === 0 ? `
    <div class="ps-empty">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="4" y="8" width="40" height="32" rx="4" stroke="rgba(45,212,191,.25)" stroke-width="1.5" fill="rgba(45,212,191,.04)"/>
        <path d="M12 17h24M12 23h16M12 29h20" stroke="rgba(45,212,191,.25)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <p>No playbooks found</p>
      <button id="ps-empty-new" class="ps-btn ps-btn-primary">+ New Playbook</button>
    </div>` : list.map((pb, i) => renderCard(pb, searchTerm, rs)).join('')}
  </div>
</div>`;

    bindEvents();
  }

  function bindEvents() {
    // Category filter
    container.querySelectorAll('.ps-pill[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => { State.setCategoryFilter(btn.dataset.cat); draw(); });
    });

    // Search / MITRE
    const searchEl = container.querySelector('#ps-search');
    if (searchEl) searchEl.addEventListener('input', e => { searchTerm = e.target.value; draw(); });
    const mitreEl = container.querySelector('#ps-mitre');
    if (mitreEl) mitreEl.addEventListener('input', e => { mitreFilter = e.target.value; draw(); });

    // Tags
    container.querySelectorAll('.ps-pill-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tag;
        if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
        draw();
      });
    });
    const tagClear = container.querySelector('#ps-tag-clear');
    if (tagClear) tagClear.addEventListener('click', () => { activeTags = new Set(); draw(); });

    // New playbook
    [container.querySelector('#ps-new-btn'), container.querySelector('#ps-empty-new')]
      .filter(Boolean)
      .forEach(btn => btn.addEventListener('click', handleNew));

    // Import file
    const importBtn = container.querySelector('#ps-import-btn');
    if (importBtn) importBtn.addEventListener('click', handleImportFile);

    // VAPT toggle
    const vaptBtn = container.querySelector('#ps-vapt-btn');
    if (vaptBtn) vaptBtn.addEventListener('click', () => { showVapt = !showVapt; draw(); });

    // VAPT import
    container.querySelectorAll('.ps-vapt-import').forEach(btn => {
      btn.addEventListener('click', () => importVapt(btn.dataset.vapt));
    });

    // Card actions
    container.querySelectorAll('.ps-card-run').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleRun(btn.dataset.id); }));
    container.querySelectorAll('.ps-card-edit').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleEdit(btn.dataset.id); }));
    container.querySelectorAll('.ps-card-clone').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleClone(btn.dataset.id); }));
    container.querySelectorAll('.ps-card-export').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleExport(btn.dataset.id); }));
    container.querySelectorAll('.ps-card-del').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); handleDelete(btn.dataset.id, btn); }));
  }

  function showStatus(msg, isErr) {
    const el = container.querySelector('#ps-import-status');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    el.style.background = isErr ? 'rgba(248,81,73,.08)' : 'rgba(45,212,191,.06)';
    el.style.color = isErr ? '#f85149' : '#2dd4bf';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function handleNew() {
    const now = new Date().toISOString();
    State.setActivePlaybook({
      id: `custom-${Date.now()}`,
      name: 'New Playbook', description: '', category: 'custom',
      tags: [], version: '1.0', createdAt: now, updatedAt: now,
      steps: [], isBuiltIn: false,
    });
    State.setView('editor');
  }

  async function handleRun(id) {
    const { playbooks } = State.getState();
    const pb = playbooks.find(p => p.id === id);
    if (!pb) return;

    // If playbook has variables, show prompt modal
    const vars = pb.variables || {};
    const varKeys = Object.keys(vars);
    let filledVars = { ...vars };

    if (varKeys.length > 0) {
      filledVars = await promptVariables(vars);
      if (filledVars === null) return; // cancelled
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const run = {
      id: runId,
      playbookId: pb.id,
      playbookName: pb.name,
      startedAt: new Date().toISOString(),
      steps: pb.steps.map(s => ({ ...s, status: 'todo' })),
      status: 'running',
      variables: filledVars,
    };
    try {
      await Api.startRun(run);
      const runs = await Api.fetchRuns();
      State.setRuns(runs);
      State.setActiveRun(run);
      State.setView('run');
    } catch (err) {
      showStatus('Failed to start run: ' + err.message, true);
    }
  }

  function handleEdit(id) {
    const { playbooks } = State.getState();
    const pb = playbooks.find(p => p.id === id);
    if (pb) { State.setActivePlaybook(pb); State.setView('editor'); }
  }

  async function handleClone(id) {
    try {
      await Api.clonePlaybook(id);
      State.setPlaybooks([...(await Api.fetchPlaybooks()), ...BUILTIN_PLAYBOOKS]);
    } catch (err) {
      showStatus('Clone failed: ' + err.message, true);
    }
  }

  async function handleExport(id) {
    const { playbooks } = State.getState();
    const pb = playbooks.find(p => p.id === id);
    if (!pb) return;
    const blob = new Blob([JSON.stringify(pb, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${pb.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
  }

  async function handleDelete(id, btn) {
    if (!deleteArmed.has(id)) {
      deleteArmed.add(id);
      btn.textContent = 'Sure?';
      btn.style.background = 'rgba(248,81,73,.28)';
      setTimeout(() => { deleteArmed.delete(id); if (btn.isConnected) { btn.textContent = 'Del'; btn.style.background = ''; } }, 4000);
      return;
    }
    deleteArmed.delete(id);
    try {
      await Api.deletePlaybook(id);
      const custom = await Api.fetchPlaybooks();
      State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !BUILTIN_PLAYBOOKS.some(b => b.id === p.id))]);
    } catch (err) {
      showStatus('Delete failed: ' + err.message, true);
    }
  }

  async function handleImportFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
        if (!candidate?.name) throw new Error('Invalid playbook format');
        const now = new Date().toISOString();
        const pb = {
          id: candidate.id || `custom-${Date.now()}`,
          name: candidate.name,
          description: candidate.description || '',
          category: candidate.category || 'custom',
          tags: candidate.tags || [],
          version: candidate.version || '1.0',
          createdAt: candidate.createdAt || now,
          updatedAt: now,
          steps: candidate.steps || [],
          isBuiltIn: false,
        };
        const res = await Api.savePlaybook(pb);
        if (res.ok) {
          const custom = await Api.fetchPlaybooks();
          State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !BUILTIN_PLAYBOOKS.some(b => b.id === p.id))]);
          showStatus('Imported: ' + pb.name, false);
        }
      } catch (e) {
        showStatus('Parse failed: ' + e.message, true);
      }
    };
    input.click();
  }

  async function importVapt(methodologyId) {
    const method = VAPT_METHODOLOGIES.find(m => m.id === methodologyId);
    if (!method) return;
    const now = new Date().toISOString();
    const pb = {
      id: `custom-vapt-${method.id}-${Date.now()}`,
      name: method.name,
      description: method.description,
      category: 'web-app',
      tags: ['methodology', 'vapt'],
      version: '1.0',
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
      steps: method.phases.map((phase, idx) => ({
        id: `vapt-${method.id}-${idx + 1}`,
        order: idx + 1,
        title: phase.name,
        description: phase.description,
        category: 'recon',
        commands: [],
        notes: phase.description,
        required: true,
        stepType: 'documentation',
      })),
    };
    try {
      await Api.savePlaybook(pb);
      const custom = await Api.fetchPlaybooks();
      State.setPlaybooks([...BUILTIN_PLAYBOOKS, ...custom.filter(p => !BUILTIN_PLAYBOOKS.some(b => b.id === p.id))]);
      showStatus('Imported: ' + pb.name, false);
      showVapt = false;
      draw();
    } catch (err) {
      showStatus('Import failed: ' + err.message, true);
    }
  }

  function promptVariables(vars) {
    return new Promise(resolve => {
      const keys = Object.keys(vars);
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75)';
      overlay.innerHTML = `
<div style="width:420px;background:var(--panel,#161b22);border:1px solid var(--border,#3a2a2a);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 24px 64px rgba(0,0,0,.6)">
  <div>
    <div class="ps-section-label">Fill Variables</div>
    <p style="font-size:11px;color:#8b949e;margin:4px 0 0">These values will be substituted in commands during this run.</p>
  </div>
  <div id="pv-fields" style="display:flex;flex-direction:column;gap:8px">
    ${keys.map(k => `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;font-family:monospace;padding:2px 6px;background:rgba(74,158,255,.1);color:#4a9eff;border-radius:4px;min-width:80px;text-align:right;flex-shrink:0">{{${escHtml(k)}}}</span>
      <input data-key="${escHtml(k)}" class="ps-input" style="flex:1;font-family:monospace;font-size:12px" placeholder="required" value="${escHtml(vars[k] || '')}">
    </div>`).join('')}
  </div>
  <div style="display:flex;gap:8px">
    <button id="pv-cancel" class="ps-btn" style="flex:1">Cancel</button>
    <button id="pv-confirm" class="ps-btn ps-btn-primary" style="flex:1">Start Run</button>
  </div>
</div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#pv-cancel').onclick = () => { overlay.remove(); resolve(null); };
      overlay.querySelector('#pv-confirm').onclick = () => {
        const filled = {};
        overlay.querySelectorAll('[data-key]').forEach(el => { filled[el.dataset.key] = el.value; });
        overlay.remove();
        resolve(filled);
      };
    });
  }

  const unsub = State.subscribe(draw);
  draw();

  return { destroy: () => unsub() };
}
