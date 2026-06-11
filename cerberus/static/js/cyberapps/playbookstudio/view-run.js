/**
 * static/js/cyberapps/playbookstudio/view-run.js
 * Run view: step-by-step execution with keyboard shortcuts, timer, condition evaluation.
 * Keyboard: ←/[ prev, →/] next, P=pass, S/F=skip, N=focus notes
 */

import * as State from './state.js';
import * as Api from './api.js';

const STATUS_COLORS = {
  todo: '#6b7280', inprogress: '#f59e0b', done: '#22c55e', skipped: '#a78bfa',
};

export function render(container) {
  const run = State.getState().activeRun;
  if (!run) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#666;">No active run. Start a run from the Library.</div>';
    return { destroy() {} };
  }

  let _currentIdx = 0;
  let _notesTimer = null;
  let _timerInterval = null;

  function _elapsed() {
    const start = new Date(run.startedAt).getTime();
    const ms = Date.now() - start;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  function _pct() {
    const done = run.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
    return run.steps.length ? Math.round((done / run.steps.length) * 100) : 0;
  }

  function _varReplace(text) {
    if (!text || !run.variables) return text || '';
    return text.replace(/\{\{(\w+)\}\}/g, (_, k) => run.variables[k] !== undefined ? run.variables[k] : `{{${k}}}`);
  }

  function _isBlocked(step) {
    if (!step.dependsOn?.length) return false;
    return step.dependsOn.some(depId => {
      const dep = run.steps.find(s => s.id === depId);
      return dep && dep.status !== 'done' && dep.status !== 'skipped';
    });
  }

  function _computeSkipSet() {
    const skipSet = new Set();
    run.steps.forEach(s => {
      if (s.status === 'done' && s.condition) {
        const { variableKey, operator, value, skipStepIds } = s.condition;
        const actual = (run.variables || {})[variableKey] || '';
        let matches = false;
        if (operator === 'equals') matches = actual === value;
        else if (operator === 'not_equals') matches = actual !== value;
        else if (operator === 'contains') matches = actual.includes(value);
        if (matches) skipStepIds.forEach(id => skipSet.add(id));
      }
    });
    return skipSet;
  }

  function _drawStep() {
    const step = run.steps[_currentIdx];
    if (!step) return;
    const skipSet = _computeSkipSet();
    const blocked = _isBlocked(step);
    const autoSkipped = skipSet.has(step.id);
    const pct = _pct();

    const detailEl = container.querySelector('#ps-run-detail');
    if (!detailEl) return;

    const description = _varReplace(step.description);
    const cmds = (step.commands || []).map(c => _varReplace(c));
    const notes = _varReplace(step.notes);

    detailEl.innerHTML = `
      <div style="padding:20px;overflow-y:auto;height:100%;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <span class="ps-badge" style="background:#ffffff0a;color:#aaa;">${step.stepType || 'action'}</span>
          <span class="ps-badge" style="background:#ffffff0a;color:#aaa;">${step.category}</span>
          ${step.required ? '<span class="ps-badge" style="color:#f43f5e;background:#f43f5e22;">Required</span>' : '<span class="ps-badge" style="color:#aaa;background:#ffffff0a;">Optional</span>'}
          ${step.mitreTechniqueId ? `<span class="ps-badge" style="background:#1a1a2e;color:#7c8cf8;">${step.mitreTechniqueId}: ${step.mitreTechniqueName || ''}</span>` : ''}
          ${blocked ? '<span class="ps-badge" style="color:#f59e0b;background:#f59e0b22;">BLOCKED (dependency not done)</span>' : ''}
          ${autoSkipped ? '<span class="ps-badge" style="color:#a78bfa;background:#a78bfa22;">AUTO-SKIP (condition)</span>' : ''}
        </div>
        <div style="font-size:18px;font-weight:600;color:#e2e8f0;margin-bottom:12px;">${step.title}</div>
        ${description ? `<div style="color:#aaa;font-size:13px;line-height:1.6;margin-bottom:16px;white-space:pre-wrap;">${description}</div>` : ''}
        ${cmds.length ? `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;color:#666;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">Commands</div>
            ${cmds.map(c => `
              <div style="display:flex;align-items:center;gap:8px;background:#0a0a1a;border:1px solid #2a2a4a;border-radius:4px;padding:8px;margin-bottom:4px;">
                <code style="flex:1;font-size:12px;color:#e2e8f0;font-family:monospace;word-break:break-all;">${_esc(c)}</code>
                <button class="ps-btn" style="padding:2px 8px;font-size:11px;" data-copy="${_esc(c)}">Copy</button>
              </div>`).join('')}
          </div>` : ''}
        ${notes ? `
          <div style="background:#0f1a0f;border:1px solid #1a3a1a;border-radius:6px;padding:12px;margin-bottom:16px;">
            <div style="font-size:11px;color:#4ade80;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">Guidance</div>
            <div style="font-size:12px;color:#aaa;white-space:pre-wrap;">${_esc(notes)}</div>
          </div>` : ''}
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#666;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">Quick Notes</div>
          <textarea id="ps-run-notes" class="ps-input" rows="3" placeholder="Add notes for this step...">${_esc(step.operatorNotes || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${['todo', 'inprogress', 'done', 'skipped'].map(st => `
            <button class="ps-btn ${step.status === st ? 'ps-btn-primary' : ''}"
              style="${step.status === st ? `background:${STATUS_COLORS[st]}22;border-color:${STATUS_COLORS[st]};` : ''}"
              data-setstatus="${st}">${st}</button>`).join('')}
        </div>
        ${step.stepType === 'decision' ? `<div style="margin-top:12px;padding:10px;background:#1a1a0a;border:1px solid #3a3a1a;border-radius:6px;color:#f59e0b;font-size:12px;">Decision step: completing this may skip subsequent steps based on condition rules.</div>` : ''}
        <div style="margin-top:20px;font-size:11px;color:#444;">Keyboard: ← prev | → next | P = pass | S/F = skip | N = notes</div>
      </div>`;

    // Bind copy buttons
    detailEl.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(btn.dataset.copy).catch(() => {});
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy', 1200);
      });
    });

    // Bind status buttons
    detailEl.querySelectorAll('[data-setstatus]').forEach(btn => {
      btn.addEventListener('click', () => _setStatus(step.id, btn.dataset.setstatus));
    });

    // Notes autosave
    const notesEl = detailEl.querySelector('#ps-run-notes');
    if (notesEl) {
      notesEl.addEventListener('input', () => {
        clearTimeout(_notesTimer);
        _notesTimer = setTimeout(() => {
          run.steps[_currentIdx].operatorNotes = notesEl.value;
          _patchStep(step.id, { operatorNotes: notesEl.value });
        }, 1200);
      });
    }
  }

  function _drawSidebar() {
    const sidebar = container.querySelector('#ps-run-sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = run.steps.map((s, i) => {
      const color = STATUS_COLORS[s.status] || '#6b7280';
      return `<div class="ps-step-item ${i === _currentIdx ? 'ps-step-item-active' : ''}" data-step-goto="${i}"
        style="${i === _currentIdx ? `border-left:3px solid ${color};background:${color}11;` : ''}">
        <span style="color:${color};font-size:12px;min-width:16px;">${i + 1}.</span>
        <span style="flex:1;font-size:12px;color:${i === _currentIdx ? '#e2e8f0' : '#888'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.title}</span>
        <span style="color:${color};font-size:10px;">${s.status === 'todo' ? '' : s.status}</span>
      </div>`;
    }).join('');

    sidebar.querySelectorAll('[data-step-goto]').forEach(el => {
      el.addEventListener('click', () => { _currentIdx = parseInt(el.dataset.stepGoto); _drawStep(); _drawSidebar(); _drawProgress(); });
    });
  }

  function _drawProgress() {
    const pct = _pct();
    const bar = container.querySelector('#ps-run-bar');
    if (bar) bar.style.width = pct + '%';
    const pctEl = container.querySelector('#ps-run-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const timerEl = container.querySelector('#ps-run-timer');
    if (timerEl) timerEl.textContent = _elapsed();
    const trackEl = container.querySelector('#ps-run-track');
    if (trackEl) {
      const dots = run.steps.slice(0, 30).map((s, i) => {
        const color = STATUS_COLORS[s.status] || '#333';
        return `<div style="width:10px;height:10px;border-radius:50%;background:${i === _currentIdx ? color : (s.status !== 'todo' ? color : '#333')};border:1px solid ${color};cursor:pointer;flex-shrink:0;" data-dot="${i}"></div>`;
      }).join('');
      trackEl.innerHTML = dots;
      trackEl.querySelectorAll('[data-dot]').forEach(d => {
        d.addEventListener('click', () => { _currentIdx = parseInt(d.dataset.dot); _drawStep(); _drawSidebar(); _drawProgress(); });
      });
    }
  }

  async function _setStatus(stepId, status) {
    const idx = run.steps.findIndex(s => s.id === stepId);
    if (idx < 0) return;
    run.steps[idx].status = status;
    if (status === 'inprogress' && !run.steps[idx].startedAt) run.steps[idx].startedAt = new Date().toISOString();
    if (status === 'done' || status === 'skipped') run.steps[idx].completedAt = new Date().toISOString();
    await _patchStep(stepId, { status, completedAt: run.steps[idx].completedAt });
    _drawStep();
    _drawSidebar();
    _drawProgress();
  }

  async function _patchStep(stepId, patch) {
    try {
      await Api.patchRunStep(run.id, stepId, patch);
      State.updateRun({ ...run });
    } catch { /* ignore patch errors */ }
  }

  async function _complete(abandoned = false) {
    const requiredLeft = run.steps.filter(s => s.required && s.status === 'todo').length;
    if (!abandoned && requiredLeft > 0) {
      if (!confirm(`${requiredLeft} required step(s) are not complete. Mark as completed anyway?`)) return;
    }
    const done = run.steps.filter(s => s.status === 'done').length;
    const skipped = run.steps.filter(s => s.status === 'skipped').length;
    const status = abandoned ? 'abandoned' : (done >= (run.steps.length - skipped) ? 'completed' : 'completed');
    const completedAt = new Date().toISOString();
    try {
      await Api.completeRun(run.id, { status, completedAt });
      run.status = status;
      run.completedAt = completedAt;
      State.updateRun({ ...run });
      State.setActiveRun(null);
      State.setView('history');
    } catch (err) {
      alert('Failed to complete run: ' + err.message);
    }
  }

  function _keyHandler(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    switch (e.key) {
      case 'ArrowLeft': case '[':
        if (_currentIdx > 0) { _currentIdx--; _drawStep(); _drawSidebar(); _drawProgress(); }
        break;
      case 'ArrowRight': case ']':
        if (_currentIdx < run.steps.length - 1) { _currentIdx++; _drawStep(); _drawSidebar(); _drawProgress(); }
        break;
      case 'p': case 'P':
        _setStatus(run.steps[_currentIdx].id, 'done');
        if (_currentIdx < run.steps.length - 1) { _currentIdx++; _drawStep(); _drawSidebar(); _drawProgress(); }
        break;
      case 's': case 'S': case 'f': case 'F':
        _setStatus(run.steps[_currentIdx].id, 'skipped');
        if (_currentIdx < run.steps.length - 1) { _currentIdx++; _drawStep(); _drawSidebar(); _drawProgress(); }
        break;
      case 'n': case 'N':
        container.querySelector('#ps-run-notes')?.focus();
        break;
    }
  }

  document.addEventListener('keydown', _keyHandler);

  container.innerHTML = `
    <div class="ps-run" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div class="ps-run-header" style="padding:10px 16px;border-bottom:1px solid #1a1a2e;display:flex;gap:12px;align-items:center;flex-shrink:0;">
        <span style="font-size:14px;font-weight:600;color:#e2e8f0;flex:1;">${run.playbookName}</span>
        <span id="ps-run-timer" style="font-size:12px;color:#aaa;font-family:monospace;">0s</span>
        <span id="ps-run-pct" style="font-size:12px;color:#4a9eff;">0%</span>
        <button class="ps-btn" id="ps-run-abandon" style="color:#f43f5e;">Abandon</button>
        <button class="ps-btn ps-btn-primary" id="ps-run-complete">Complete Run</button>
      </div>
      <div style="padding:4px 16px;background:#0a0a1a;flex-shrink:0;">
        <div style="background:#1a1a2e;border-radius:4px;height:6px;overflow:hidden;">
          <div id="ps-run-bar" style="height:100%;background:linear-gradient(90deg,#4a9eff,#22c55e);width:0%;transition:width 0.3s;"></div>
        </div>
        <div id="ps-run-track" style="display:flex;gap:4px;padding:6px 0;flex-wrap:wrap;"></div>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;">
        <div id="ps-run-sidebar" style="width:260px;overflow-y:auto;border-right:1px solid #1a1a2e;flex-shrink:0;"></div>
        <div id="ps-run-detail" style="flex:1;overflow:hidden;"></div>
      </div>
    </div>`;

  container.querySelector('#ps-run-complete')?.addEventListener('click', () => _complete(false));
  container.querySelector('#ps-run-abandon')?.addEventListener('click', () => { if (confirm('Abandon this run?')) _complete(true); });

  _drawSidebar();
  _drawStep();
  _drawProgress();

  _timerInterval = setInterval(() => {
    const el = container.querySelector('#ps-run-timer');
    if (el) el.textContent = _elapsed();
  }, 1000);

  return {
    destroy() {
      document.removeEventListener('keydown', _keyHandler);
      clearInterval(_timerInterval);
      clearTimeout(_notesTimer);
    },
  };
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
