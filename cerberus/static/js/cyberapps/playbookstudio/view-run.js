/**
 * static/js/cyberapps/playbookstudio/view-run.js
 * Run view: step-by-step playbook execution with live status tracking.
 */

import * as State from './state.js';
import * as Api from './api.js';

const STEP_TYPE_COLORS = {
  action: '#4a9eff', verification: '#3fb950', documentation: '#8b949e',
  command: '#d29922', decision: '#bc8cff',
};
const STATUS_COLOR = { todo: '#4a9eff', inprogress: '#d29922', done: '#3fb950', skipped: '#8b949e' };
const STATUS_BG = {
  todo: 'rgba(74,158,255,.15)', inprogress: 'rgba(210,153,34,.2)',
  done: 'rgba(63,185,80,.2)', skipped: 'rgba(139,148,158,.15)',
};
const STATUS_LABEL = { todo: 'Todo', inprogress: 'In Progress', done: 'Done', skipped: 'Skip' };

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function elapsed(startedAt) {
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function resolveCmd(cmd, vars) {
  let r = cmd;
  Object.entries(vars).forEach(([k, v]) => { r = r.replaceAll(`{{${k}}}`, v); });
  return r;
}

function highlightVars(text) {
  return escHtml(text).replace(/\{\{([^}]+)\}\}/g,
    (_, k) => `<span style="color:#2dd4bf;background:rgba(45,212,191,.10);border-radius:3px;padding:0 3px;font-family:monospace;font-size:.85em">{{${escHtml(k)}}}</span>`
  );
}

function isBlocked(step, steps) {
  if (!step.dependsOn || !step.dependsOn.length) return false;
  return step.dependsOn.some(depId => {
    const dep = steps.find(s => s.id === depId);
    return !dep || (dep.status !== 'done' && dep.status !== 'skipped');
  });
}

export function render(container) {
  const { activeRun, runs } = State.getState();
  if (!activeRun) {
    container.innerHTML = `<div class="ps-center-msg"><p>No active run.</p><button id="ps-run-back" class="ps-btn ps-btn-primary">Go to Library</button></div>`;
    container.querySelector('#ps-run-back')?.addEventListener('click', () => State.setView('library'));
    return { destroy: () => {} };
  }

  let _selectedStepId = null;
  let _showCompleteModal = false;
  let _timerInterval = null;
  let _autoScrollEnabled = true;
  let _notesSaveTimeout = null;
  let _pendingNotes = {};

  // Auto-select first non-done step
  const firstPending = activeRun.steps.find(s => s.status !== 'done' && s.status !== 'skipped');
  _selectedStepId = (firstPending || activeRun.steps[0])?.id || null;

  function getState() { return State.getState().activeRun || activeRun; }

  function draw() {
    const run = getState();
    if (!run) return;
    const steps = run.steps;
    const vars = run.variables || {};
    const done = steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
    const total = steps.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const selectedStep = steps.find(s => s.id === _selectedStepId) || steps[0];

    container.innerHTML = `
<div class="ps-run" style="display:flex;flex-direction:column;height:100%">
  <div class="ps-run-progress" style="padding:8px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;margin-bottom:5px">
      <span style="color:var(--fg);opacity:.5">Progress</span>
      <span style="color:${pct === 100 ? '#3fb950' : 'var(--fg)'};font-family:monospace">${done} / ${total} (${pct}%)</span>
    </div>
    <div style="height:4px;border-radius:4px;background:rgba(42,51,71,.5);overflow:hidden">
      <div style="height:4px;border-radius:4px;width:${pct}%;background:${pct === 100 ? 'linear-gradient(90deg,#3fb950,#58c464)' : 'linear-gradient(90deg,#4a9eff,#79bfff)'};transition:width 600ms ease"></div>
    </div>
  </div>

  ${steps.length <= 30 ? `
  <div class="ps-step-dots" style="display:flex;align-items:center;gap:3px;padding:6px 16px;border-bottom:1px solid var(--border);background:rgba(13,14,24,.6);overflow-x:auto;flex-shrink:0">
    ${steps.map((step, i) => {
      const st = step.status || 'todo';
      const isActive = step.id === _selectedStepId;
      let dc = 'rgba(42,51,71,.6)', dbg = 'transparent';
      if (st === 'done') { dc = '#3fb950'; dbg = 'rgba(63,185,80,.18)'; }
      else if (st === 'skipped') { dc = '#8b949e'; dbg = 'rgba(139,148,158,.18)'; }
      else if (st === 'inprogress') { dc = '#4a9eff'; dbg = 'rgba(74,158,255,.15)'; }
      else if (isActive) { dc = '#4a9eff'; dbg = 'rgba(74,158,255,.10)'; }
      return `<div style="display:flex;align-items:center">
        <div class="ps-dot" data-step-dot="${escHtml(step.id)}" title="${escHtml(step.title)}"
          style="width:${isActive ? 20 : 16}px;height:${isActive ? 20 : 16}px;border-radius:50%;border:1px solid ${dc};background:${dbg};display:flex;align-items:center;justify-content:center;font-size:9px;font-family:monospace;color:${dc};cursor:pointer;transition:all 200ms;box-shadow:${isActive ? '0 0 0 2px rgba(74,158,255,.18)' : 'none'}">
          ${st === 'done' ? '✓' : st === 'skipped' ? '↷' : i + 1}
        </div>
        ${i < steps.length - 1 ? `<div style="width:6px;height:1px;background:${st === 'done' ? 'rgba(63,185,80,.4)' : 'rgba(42,51,71,.4)'}"></div>` : ''}
      </div>`;
    }).join('')}
  </div>` : ''}

  <div style="display:flex;flex:1;min-height:0">
    <div id="ps-step-list" style="width:260px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--panel)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-bottom:1px solid rgba(42,51,71,.3);background:rgba(7,8,15,.4)">
        <span style="font-size:11px;color:var(--fg);opacity:.5">Steps</span>
        <button id="ps-scroll-lock" class="ps-btn" style="font-size:10px;padding:2px 6px;color:${_autoScrollEnabled ? '#2dd4bf' : '#484f58'}">
          ${_autoScrollEnabled ? 'lock' : 'free'}
        </button>
      </div>
      <div style="flex:1;overflow-y:auto">
        ${steps.map(step => {
          const st = step.status || 'todo';
          const isActive = step.id === _selectedStepId;
          const blocked = isBlocked(step, steps);
          const tc = STEP_TYPE_COLORS[step.stepType || 'action'];
          let icon = '○';
          if (st === 'done') icon = '✓';
          else if (st === 'inprogress') icon = '▶';
          else if (st === 'skipped') icon = '↷';
          else if (blocked) icon = '⊘';
          return `<button class="ps-step-list-item" data-step-nav="${escHtml(step.id)}"
            style="width:100%;text-align:left;display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;background:${isActive ? 'rgba(74,158,255,.1)' : 'transparent'};border-left:3px solid ${isActive ? tc : 'transparent'};color:${st === 'done' ? '#3fb950' : st === 'skipped' ? '#8b949e' : 'var(--fg)'};opacity:${blocked ? .45 : 1};text-decoration:${st === 'skipped' ? 'line-through' : 'none'}"
            ${blocked ? 'disabled' : ''}>
            <span style="width:14px;text-align:center;flex-shrink:0">${icon}</span>
            <span style="font-family:monospace;color:var(--fg);opacity:.5;flex-shrink:0">${step.order}.</span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(step.title)}</span>
            ${step.required && (st === 'todo' || st === 'inprogress') ? `<span style="width:6px;height:6px;border-radius:50%;background:#d29922;flex-shrink:0"></span>` : ''}
          </button>`;
        }).join('')}
      </div>
    </div>

    <div style="flex:1;min-width:0;overflow:hidden">
      ${selectedStep ? renderStepDetail(selectedStep, run.id, vars, run.playbookName) : `<div class="ps-center-msg"><p>Select a step.</p></div>`}
    </div>
  </div>

  <div class="ps-run-bar" style="display:flex;align-items:center;gap:8px;padding:8px 16px;border-top:1px solid var(--border);background:var(--panel);flex-shrink:0">
    <span style="font-size:10px;color:var(--fg);opacity:.4">[←/→] nav  [P] pass  [S] skip  [N] notes</span>
    <span id="ps-run-timer" class="ps-badge ps-badge-mono" style="background:rgba(74,158,255,.08);color:#4a9eff;border:1px solid rgba(74,158,255,.2)">
      ⬤ ${elapsed(run.startedAt)}
    </span>
    <div style="flex:1"></div>
    <span style="font-size:11px;color:var(--fg);opacity:.5">${done}/${total} steps</span>
    <button id="ps-run-end" class="ps-btn ps-btn-primary" style="background:${done === total ? '#3fb950' : '#4a9eff'}">
      ${done === total ? '✓ Complete Run' : 'End Run'}
    </button>
  </div>
</div>

${_showCompleteModal ? renderCompleteModal(run) : ''}`;

    bindEvents();

    // Start timer
    if (_timerInterval) clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      const timerEl = container.querySelector('#ps-run-timer');
      if (timerEl) timerEl.textContent = '⬤ ' + elapsed(run.startedAt);
    }, 1000);
  }

  function renderStepDetail(step, runId, vars, playbookTitle) {
    const st = step.status || 'todo';
    const tc = STEP_TYPE_COLORS[step.stepType || 'action'];
    const pendingNote = _pendingNotes[step.id] !== undefined ? _pendingNotes[step.id] : (step.operatorNotes || '');

    return `
<div class="ps-step-detail" style="display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:16px;gap:12px;border-left:3px solid ${tc}">
  <div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">
      <span class="ps-badge" style="background:${tc}1a;color:${tc}">${escHtml(step.stepType || 'action')}</span>
      <span class="ps-badge" style="background:var(--panel);color:var(--fg);opacity:.6">${escHtml(step.category)}</span>
      ${step.required ? `<span class="ps-badge" style="background:rgba(210,153,34,.12);color:#d29922">required</span>` : ''}
      ${step.mitreTechniqueId ? `<span class="ps-badge ps-badge-mono" style="background:rgba(188,140,255,.12);color:#bc8cff">${escHtml(step.mitreTechniqueId)}${step.mitreTechniqueName ? ' · ' + escHtml(step.mitreTechniqueName) : ''}</span>` : ''}
    </div>
    <h3 style="font-size:13px;font-weight:600;color:var(--fg);margin:0 0 6px">${step.order}. ${escHtml(step.title)}</h3>
    ${step.description ? `<p style="font-size:12px;line-height:1.6;color:var(--fg);opacity:.7;margin:0">${highlightVars(step.description)}</p>` : ''}
  </div>

  ${step.commands && step.commands.filter(Boolean).length > 0 ? `
  <div>
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--fg);opacity:.5;margin-bottom:6px">Commands</div>
    <div style="display:flex;flex-direction:column;gap:5px">
      ${step.commands.filter(Boolean).map((cmd, i) => {
        const resolved = resolveCmd(cmd, vars);
        return `<div style="display:flex;align-items:start;gap:6px;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:4px">
          <code style="flex:1;font-size:11px;font-family:monospace;color:#e2e8f0;word-break:break-all">${highlightVars(resolved)}</code>
          <div style="display:flex;gap:3px;flex-shrink:0;margin-top:1px">
            <button class="ps-btn ps-cmd-copy" data-cmd="${escHtml(resolved)}" style="font-size:10px;padding:2px 6px">Copy</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}

  ${step.notes ? `
  <div style="padding:10px;background:rgba(74,158,255,.06);border:1px solid rgba(74,158,255,.15);border-radius:4px">
    <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#4a9eff;margin-bottom:4px">Guidance</div>
    <p style="font-size:11px;line-height:1.6;color:var(--fg);opacity:.7;margin:0">${escHtml(step.notes)}</p>
  </div>` : ''}

  <div>
    <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--fg);opacity:.5;display:block;margin-bottom:4px">Quick Note</label>
    <textarea id="ps-quick-note" data-step-id="${escHtml(step.id)}" data-run-id="${escHtml(runId)}" rows="3"
      class="ps-input" style="width:100%;resize:vertical" placeholder="Add your findings here…">${escHtml(pendingNote)}</textarea>
  </div>

  <div style="display:flex;align-items:center;gap:6px;margin-top:auto;padding-top:10px;border-top:1px solid var(--border)">
    ${(['todo', 'inprogress', 'done', 'skipped']).map(s => `
    <button class="ps-btn ps-status-btn" data-status="${s}" data-step-id="${escHtml(step.id)}" data-run-id="${escHtml(runId)}"
      style="flex:1;padding:6px 4px;font-size:11px;background:${st === s ? STATUS_BG[s] : 'var(--border)'};color:${st === s ? STATUS_COLOR[s] : 'var(--fg)'};opacity:${st !== s ? .6 : 1};border:1px solid ${st === s ? STATUS_COLOR[s] + '40' : 'transparent'}">
      ${STATUS_LABEL[s]}
    </button>`).join('')}
  </div>
</div>`;
  }

  function renderCompleteModal(run) {
    const steps = run.steps;
    const done = steps.filter(s => s.status === 'done').length;
    const skipped = steps.filter(s => s.status === 'skipped').length;
    const todo = steps.filter(s => !s.status || s.status === 'todo' || s.status === 'inprogress').length;
    const req = steps.filter(s => s.required && s.status !== 'done' && s.status !== 'skipped');

    return `
<div style="position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.75)">
  <div style="width:360px;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px;box-shadow:0 24px 64px rgba(0,0,0,.6)">
    <div>
      <div class="ps-section-label">Complete Run</div>
      <p style="font-size:11px;color:var(--fg);opacity:.5;margin:4px 0 0">${escHtml(run.playbookName)}</p>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px;display:flex;flex-direction:column;gap:6px">
      ${[['Done', `${done} steps`, '#3fb950'], ['Skipped', `${skipped} steps`, '#8b949e'], ['Remaining', `${todo} steps`, todo > 0 ? '#d29922' : '#8b949e'], ['Elapsed', elapsed(run.startedAt), '#8b949e']].map(([l, v, c]) =>
        `<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--fg);opacity:.5">${l}</span><span style="font-weight:500;color:${c}">${v}</span></div>`
      ).join('')}
    </div>
    ${req.length > 0 ? `<div style="padding:8px 10px;background:rgba(210,153,34,.08);border:1px solid rgba(210,153,34,.2);border-radius:4px;font-size:11px;color:#d29922">${req.length} required step${req.length > 1 ? 's' : ''} not completed.</div>` : ''}
    <div style="display:flex;gap:6px">
      <button id="ps-modal-abandon" class="ps-btn ps-btn-danger" style="flex:1">Abandon</button>
      <button id="ps-modal-cancel" class="ps-btn" style="flex:1">Cancel</button>
      <button id="ps-modal-confirm" class="ps-btn ps-btn-primary" style="flex:1;background:#3fb950;color:#000">Complete</button>
    </div>
  </div>
</div>`;
  }

  function bindEvents() {
    const q = sel => container.querySelector(sel);
    const qa = sel => container.querySelectorAll(sel);

    // Dot track navigation
    qa('[data-step-dot]').forEach(dot => dot.addEventListener('click', () => {
      _selectedStepId = dot.dataset.stepDot;
      draw();
    }));

    // Step list navigation
    qa('[data-step-nav]').forEach(btn => btn.addEventListener('click', () => {
      _selectedStepId = btn.dataset.stepNav;
      draw();
    }));

    // Scroll lock toggle
    q('#ps-scroll-lock')?.addEventListener('click', () => { _autoScrollEnabled = !_autoScrollEnabled; draw(); });

    // Copy command buttons
    qa('.ps-cmd-copy').forEach(btn => btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.cmd).catch(() => {});
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { if (btn.isConnected) btn.textContent = orig; }, 1500);
    }));

    // Status buttons
    qa('.ps-status-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { status, stepId, runId } = btn.dataset;
        const run = getState();
        const step = run.steps.find(s => s.id === stepId);
        if (!step) return;
        if (step.required && status === 'skipped') {
          if (!confirm(`"${step.title}" is a required step. Skip anyway?`)) return;
        }
        const now = new Date().toISOString();
        const patch = { status };
        if (status === 'done' && !step.completedAt) patch.completedAt = now;
        if (status === 'inprogress' && !step.startedAt) patch.startedAt = now;
        try {
          const res = await Api.patchRunStep(runId, stepId, patch);
          if (res.ok && res.run) State.updateRun(res.run);
          draw();
        } catch (e) { console.error('patch step:', e); }
      });
    });

    // Quick note autosave
    const noteEl = q('#ps-quick-note');
    if (noteEl) {
      noteEl.addEventListener('input', e => {
        _pendingNotes[e.target.dataset.stepId] = e.target.value;
        clearTimeout(_notesSaveTimeout);
        _notesSaveTimeout = setTimeout(() => saveNote(e.target.dataset.runId, e.target.dataset.stepId, e.target.value), 1200);
      });
    }

    // End run
    q('#ps-run-end')?.addEventListener('click', () => { _showCompleteModal = true; draw(); });

    // Complete modal
    q('#ps-modal-cancel')?.addEventListener('click', () => { _showCompleteModal = false; draw(); });
    q('#ps-modal-confirm')?.addEventListener('click', () => handleComplete('completed'));
    q('#ps-modal-abandon')?.addEventListener('click', () => handleComplete('abandoned'));

    // Keyboard shortcuts
    if (!container._psKeydownBound) {
      container._psKeydownBound = true;
      document.addEventListener('keydown', handleKeydown);
    }
  }

  function handleKeydown(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const run = getState();
    if (!run) return;
    const steps = run.steps;
    const curIdx = steps.findIndex(s => s.id === _selectedStepId);

    if (e.key === 'ArrowRight' || e.key === ']') {
      if (curIdx < steps.length - 1) { _selectedStepId = steps[curIdx + 1].id; draw(); }
    } else if (e.key === 'ArrowLeft' || e.key === '[') {
      if (curIdx > 0) { _selectedStepId = steps[curIdx - 1].id; draw(); }
    } else if ((e.key === 'p' || e.key === 'P') && _selectedStepId) {
      patchStep(run.id, _selectedStepId, { status: 'done', completedAt: new Date().toISOString() });
    } else if ((e.key === 's' || e.key === 'S' || e.key === 'f' || e.key === 'F') && _selectedStepId) {
      patchStep(run.id, _selectedStepId, { status: 'skipped' });
    } else if (e.key === 'n' || e.key === 'N') {
      container.querySelector('#ps-quick-note')?.focus();
    }
  }

  async function patchStep(runId, stepId, patch) {
    try {
      const res = await Api.patchRunStep(runId, stepId, patch);
      if (res.ok && res.run) { State.updateRun(res.run); draw(); }
    } catch (e) { console.error('patch step:', e); }
  }

  async function saveNote(runId, stepId, text) {
    try {
      const res = await Api.patchRunStep(runId, stepId, { operatorNotes: text });
      if (res.ok && res.run) State.updateRun(res.run);
    } catch (e) { /* best-effort */ }
  }

  async function handleComplete(status) {
    const run = getState();
    if (!run) return;
    try {
      const res = await Api.completeRun(run.id, status, new Date().toISOString());
      if (res.ok && res.run) {
        State.updateRun(res.run);
        State.setActiveRun(null);
        _showCompleteModal = false;
        State.setView(status === 'abandoned' ? 'library' : 'history');
      }
    } catch (e) { console.error('complete run:', e); }
  }

  const unsub = State.subscribe(draw);
  draw();

  return {
    destroy: () => {
      if (_timerInterval) clearInterval(_timerInterval);
      clearTimeout(_notesSaveTimeout);
      document.removeEventListener('keydown', handleKeydown);
      if (container._psKeydownBound) delete container._psKeydownBound;
      unsub();
    },
  };
}
