/**
 * static/js/cyberapps/playbookstudio/view-history.js
 * History view: browse past runs, resume, export to Markdown, delete.
 */

import * as State from './state.js';
import * as Api from './api.js';

const STATUS_COLORS = {
  running: '#f59e0b', completed: '#22c55e', abandoned: '#f43f5e',
};

function _duration(run) {
  if (!run.completedAt) return '—';
  const ms = new Date(run.completedAt) - new Date(run.startedAt);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function _miniBar(run) {
  const done = run.steps.filter(s => s.status === 'done').length;
  const skipped = run.steps.filter(s => s.status === 'skipped').length;
  const total = run.steps.length;
  const donePct = total ? (done / total) * 100 : 0;
  const skipPct = total ? (skipped / total) * 100 : 0;
  return `
    <div style="background:#1a1a2e;border-radius:3px;height:4px;width:120px;overflow:hidden;display:inline-flex;">
      <div style="height:100%;background:#22c55e;width:${donePct}%;"></div>
      <div style="height:100%;background:#a78bfa;width:${skipPct}%;"></div>
    </div>
    <span style="font-size:11px;color:#666;margin-left:6px;">${done}/${total}</span>`;
}

function _formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export function render(container) {
  let _unsub;

  function _draw() {
    const { runs } = State.getState();
    const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    container.innerHTML = `
      <div style="padding:20px;overflow-y:auto;height:100%;">
        <div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:16px;">Run History (${sorted.length})</div>
        ${sorted.length === 0 ? '<div style="color:#666;text-align:center;padding:40px;">No runs yet. Start a playbook from the Library.</div>' : ''}
        ${sorted.map(run => _runCard(run)).join('')}
      </div>`;

    container.querySelectorAll('[data-run-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const runId = btn.dataset.runId;
        const run = State.getState().runs.find(r => r.id === runId);
        if (!run) return;
        switch (btn.dataset.runAction) {
          case 'resume': _resumeRun(run); break;
          case 'export': _exportRun(run); break;
          case 'delete': _deleteRun(btn, runId); break;
        }
      });
    });
  }

  function _runCard(run) {
    const color = STATUS_COLORS[run.status] || '#6b7280';
    return `
      <div style="background:#0f0f1a;border:1px solid #1a1a2e;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:4px;">${run.playbookName}</div>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:#aaa;">
              <span class="ps-badge" style="background:${color}22;color:${color};">${run.status}</span>
              <span>${_miniBar(run)}</span>
              <span>${_formatDate(run.startedAt)}</span>
              <span>Duration: ${_duration(run)}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${run.status === 'running' ? `<button class="ps-btn ps-btn-primary" data-run-action="resume" data-run-id="${run.id}">Resume</button>` : ''}
            <button class="ps-btn" data-run-action="export" data-run-id="${run.id}">Export MD</button>
            <button class="ps-btn ps-btn-danger" data-run-action="delete" data-run-id="${run.id}">Delete</button>
          </div>
        </div>
      </div>`;
  }

  function _resumeRun(run) {
    State.setActiveRun(run);
    State.setView('run');
  }

  async function _exportRun(run) {
    try {
      const res = await Api.exportRun(run.id);
      const md = res.markdown || _buildMarkdown(run);
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `run-${run.id}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      const md = _buildMarkdown(run);
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `run-${run.id}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function _buildMarkdown(run) {
    const done = run.steps.filter(s => s.status === 'done').length;
    const skipped = run.steps.filter(s => s.status === 'skipped').length;
    let md = `# ${run.playbookName} — Run Report\n\n`;
    md += `**Status:** ${run.status}  \n`;
    md += `**Started:** ${run.startedAt}  \n`;
    md += `**Completed:** ${run.completedAt || 'N/A'}  \n`;
    md += `**Steps:** ${done} done, ${skipped} skipped, ${run.steps.length} total\n\n`;
    if (run.variables && Object.keys(run.variables).length) {
      md += `## Variables\n\n`;
      Object.entries(run.variables).forEach(([k, v]) => { md += `- **${k}**: ${v}\n`; });
      md += '\n';
    }
    md += `## Steps\n\n`;
    run.steps.forEach((s, i) => {
      md += `### ${i + 1}. ${s.title} [${s.status}]\n\n`;
      if (s.description) md += `${s.description}\n\n`;
      if (s.commands?.length) {
        md += '```\n' + s.commands.join('\n') + '\n```\n\n';
      }
      if (s.operatorNotes) md += `**Notes:** ${s.operatorNotes}\n\n`;
    });
    return md;
  }

  async function _deleteRun(btn, runId) {
    if (btn.dataset.armed !== 'true') {
      btn.dataset.armed = 'true';
      btn.textContent = 'Confirm?';
      setTimeout(() => { btn.dataset.armed = 'false'; btn.textContent = 'Delete'; }, 3000);
      return;
    }
    try {
      await Api.deleteRun(runId);
      State.setRuns(State.getState().runs.filter(r => r.id !== runId));
    } catch (err) { alert('Delete failed: ' + err.message); }
  }

  _draw();
  _unsub = State.subscribe(_draw);
  return { destroy() { if (_unsub) _unsub(); } };
}
