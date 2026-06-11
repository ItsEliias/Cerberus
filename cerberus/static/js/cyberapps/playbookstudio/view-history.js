/**
 * static/js/cyberapps/playbookstudio/view-history.js
 * History view: completed and abandoned runs with export.
 */

import * as State from './state.js';
import * as Api from './api.js';

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function fmtDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return '—';
  const ms = new Date(completedAt) - new Date(startedAt);
  if (ms < 0 || !isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusBadge(run) {
  if (run.status === 'running') return `<span class="ps-badge" style="background:rgba(210,153,34,.12);color:#d29922;border:1px solid rgba(210,153,34,.28)">Running</span>`;
  if (run.status === 'abandoned') return `<span class="ps-badge" style="background:rgba(248,81,73,.1);color:#f85149;border:1px solid rgba(248,81,73,.25)">Abandoned</span>`;
  const anyReq = run.steps.some(s => s.required && s.status !== 'done' && s.status !== 'skipped');
  if (anyReq) return `<span class="ps-badge" style="background:rgba(248,81,73,.1);color:#f85149;border:1px solid rgba(248,81,73,.25)">Fail</span>`;
  return `<span class="ps-badge" style="background:rgba(63,185,80,.1);color:#3fb950;border:1px solid rgba(63,185,80,.25)">Pass</span>`;
}

export function render(container) {
  function draw() {
    const { runs } = State.getState();
    const sorted = [...runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    container.innerHTML = `
<div class="ps-history">
  <div class="ps-toolbar" style="justify-content:space-between">
    <div class="ps-section-label">Run History (${sorted.length})</div>
    <button id="ps-hist-back" class="ps-btn">Back to Library</button>
  </div>
  ${sorted.length === 0 ? `<div class="ps-empty"><p>No runs yet. Start one from the Library.</p></div>` : `
  <div style="overflow-y:auto;flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:8px">
    ${sorted.map(run => {
      const done = run.steps.filter(s => s.status === 'done').length;
      const total = run.steps.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      return `
<div class="ps-hist-card" style="background:rgba(22,27,39,.75);border:1px solid rgba(42,51,71,.6);border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:8px">
  <div style="display:flex;align-items:start;justify-content:space-between;gap:8px">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
        ${statusBadge(run)}
        <span style="font-size:13px;font-weight:500;color:var(--fg)">${escHtml(run.playbookName)}</span>
      </div>
      <div style="font-size:11px;color:var(--fg);opacity:.5;display:flex;gap:12px;flex-wrap:wrap">
        <span>Started: ${fmtDate(run.startedAt)}</span>
        ${run.completedAt ? `<span>Completed: ${fmtDate(run.completedAt)}</span>` : ''}
        <span>Duration: ${fmtDuration(run.startedAt, run.completedAt)}</span>
        ${run.targetName ? `<span>Target: ${escHtml(run.targetName)}</span>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      <button class="ps-btn ps-hist-resume" data-run-id="${escHtml(run.id)}" ${run.status !== 'running' ? 'disabled style="opacity:.4"' : ''}>Resume</button>
      <button class="ps-btn ps-hist-export" data-run-id="${escHtml(run.id)}">Export</button>
      <button class="ps-btn ps-btn-danger-xs ps-hist-del" data-run-id="${escHtml(run.id)}">Del</button>
    </div>
  </div>
  <div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--fg);opacity:.4;margin-bottom:3px">
      <span>Steps</span>
      <span>${done}/${total} (${pct}%)</span>
    </div>
    <div style="height:3px;border-radius:3px;background:rgba(42,51,71,.5);overflow:hidden">
      <div style="height:3px;border-radius:3px;width:${pct}%;background:${pct === 100 ? '#3fb950' : '#4a9eff'}"></div>
    </div>
  </div>
</div>`;
    }).join('')}
  </div>`}
</div>`;

    bindEvents();
  }

  function bindEvents() {
    container.querySelector('#ps-hist-back')?.addEventListener('click', () => State.setView('library'));

    container.querySelectorAll('.ps-hist-resume').forEach(btn => {
      btn.addEventListener('click', () => {
        const run = State.getState().runs.find(r => r.id === btn.dataset.runId);
        if (run) { State.setActiveRun(run); State.setView('run'); }
      });
    });

    container.querySelectorAll('.ps-hist-export').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const res = await Api.exportRun(btn.dataset.runId);
          if (res.ok && res.markdown) {
            const run = State.getState().runs.find(r => r.id === btn.dataset.runId);
            const blob = new Blob([res.markdown], { type: 'text/markdown' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `run-${(run?.playbookName || 'report').replace(/[^a-z0-9]/gi, '_')}-${btn.dataset.runId.slice(-6)}.md`;
            a.click();
          }
        } catch (e) { console.error('export run:', e); }
      });
    });

    container.querySelectorAll('.ps-hist-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this run? This cannot be undone.')) return;
        try {
          await Api.deleteRun(btn.dataset.runId);
          const runs = await Api.fetchRuns();
          State.setRuns(runs);
        } catch (e) { console.error('delete run:', e); }
      });
    });
  }

  const unsub = State.subscribe(draw);
  draw();
  return { destroy: () => unsub() };
}
