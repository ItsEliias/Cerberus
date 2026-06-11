/**
 * static/js/cyberapps/reportforge/view-library.js
 * ReportForge — report library (list/grid) view.
 */

import * as State from './state.js';
import { api, fmtDate, escHtml, SEV_COLORS } from './utils.js';

const STATUS_COLOR = { draft: '#f0a500', complete: '#3fb950' };

function _severityCounts(findings = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity]++;
  }
  return counts;
}

function _renderCard(report, onOpen, onDelete, onDuplicate) {
  const counts = _severityCounts(report.findings ?? []);
  const hasCritical = counts.critical > 0;
  const statusColor = STATUS_COLOR[report.status] ?? '#8b949e';
  const card = document.createElement('div');
  card.className = 'rf-card';
  card.style.cssText = `
    background:var(--panel,#16181e);border:1px solid var(--border,#2a2a3a);border-radius:8px;
    padding:16px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s;
    ${hasCritical ? 'border-left:3px solid #ff4444;' : ''}
  `;
  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--fg,#c5c9d0);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(report.title)}">
          ${escHtml(report.title)}
        </div>
        <div style="font-size:11px;color:var(--text-dim,#666);margin-top:4px;">
          ${escHtml(report.targetName)}${report.targetIP ? ` &middot; ${escHtml(report.targetIP)}` : ''}
          ${report.platform ? ` &middot; ${escHtml(report.platform)}` : ''}
        </div>
      </div>
      <span style="flex-shrink:0;font-size:10px;font-weight:700;text-transform:uppercase;
        color:${statusColor};border:1px solid ${statusColor}44;border-radius:10px;padding:2px 8px;">
        ${report.status}
      </span>
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center;">
      ${Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([sev, n]) => `<span style="font-size:10px;padding:1px 7px;border-radius:9px;
          background:${SEV_COLORS[sev]}22;color:${SEV_COLORS[sev]};border:1px solid ${SEV_COLORS[sev]}44;
          font-weight:700;text-transform:uppercase;">${sev[0].toUpperCase()} ${n}</span>`)
        .join('')}
      ${!report.findings?.length ? '<span style="font-size:10px;color:var(--text-dim,#666);">No findings</span>' : ''}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
      <span style="font-size:10px;color:var(--text-dim,#666);">${fmtDate(report.updatedAt)}</span>
      <div class="rf-card-actions" style="display:flex;gap:4px;opacity:0;transition:opacity .15s;">
        <button class="rf-btn-ghost rf-dup-btn" title="Duplicate" style="font-size:11px;padding:3px 8px;">⧉</button>
        <button class="rf-btn-ghost rf-del-btn" title="Delete" style="font-size:11px;padding:3px 8px;color:#c0392b;">✕</button>
      </div>
    </div>
  `;
  card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--red,#c0392b)'; card.style.boxShadow = '0 4px 16px rgba(192,57,43,.15)'; card.querySelector('.rf-card-actions').style.opacity = '1'; });
  card.addEventListener('mouseleave', () => { card.style.borderColor = hasCritical ? '#ff4444' : 'var(--border,#2a2a3a)'; card.style.boxShadow = ''; card.querySelector('.rf-card-actions').style.opacity = '0'; });
  card.addEventListener('click', e => {
    if (e.target.classList.contains('rf-del-btn')) { e.stopPropagation(); onDelete(report.id); return; }
    if (e.target.classList.contains('rf-dup-btn')) { e.stopPropagation(); onDuplicate(report.id); return; }
    onOpen(report);
  });
  return card;
}

export function renderLibraryView(container, { onNew, onOpen, onDelete, onDuplicate }) {
  const reports = State.get('reports');
  container.innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2a3a);
        display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-size:15px;font-weight:700;color:var(--fg,#c5c9d0);">Reports</div>
          <div style="font-size:11px;color:var(--text-dim,#666);margin-top:2px;">${reports.length} report${reports.length !== 1 ? 's' : ''}</div>
        </div>
        <button id="rf-new-btn" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);
          background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;">
          + New Report
        </button>
      </div>
      <div id="rf-grid" style="flex:1;overflow-y:auto;padding:16px 20px;
        display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;
        align-content:start;">
      </div>
    </div>
  `;
  container.querySelector('#rf-new-btn').addEventListener('click', onNew);
  const grid = container.querySelector('#rf-grid');
  if (!reports.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-dim,#666);">
      <div style="font-size:32px;margin-bottom:12px;">📋</div>
      <div style="font-size:14px;font-weight:600;color:var(--fg,#c5c9d0);">No reports yet</div>
      <div style="font-size:12px;margin-top:6px;">Click "New Report" to create your first pentest report.</div>
    </div>`;
    return;
  }
  for (const report of reports) {
    grid.appendChild(_renderCard(report, onOpen, onDelete, onDuplicate));
  }
}
