/**
 * VaultCore — Vault Health tab.
 * Overview stats: sources, jobs, notes, recent errors.
 */

const API = '';

let _container = null;

export function renderHealth(container) {
  _container = container;
  _load();
}

async function _load() {
  if (!_container) return;
  _container.innerHTML = '<div class="vc-empty">Loading health data…</div>';
  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/health`);
    const data = await res.json();
    _render(data);
  } catch (e) {
    _container.innerHTML = `<div class="vc-error">Failed to load health data: ${_esc(String(e))}</div>`;
  }
}

function _render(data) {
  if (!_container) return;
  _container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vc-health';

  // Header + Refresh
  const hdr = document.createElement('div');
  hdr.className = 'vc-section-header';
  hdr.innerHTML = `
    <span class="vc-section-title">Vault Health</span>
    <button class="vc-btn vc-btn-ghost" id="vc-health-refresh" style="font-size:11px">Refresh</button>
  `;
  wrap.appendChild(hdr);

  // Stats grid
  const stats = data.sources || {};
  const jobs = data.jobs || {};
  const notes = data.notes || {};

  const grid = document.createElement('div');
  grid.className = 'vc-health-grid';
  grid.innerHTML = `
    ${_statCard('Total Sources', stats.total || 0, '#4a90d9')}
    ${_statCard('Healthy', stats.healthy || 0, '#27ae60')}
    ${_statCard('Errored', stats.errored || 0, '#c0392b')}
    ${_statCard('Total Notes', notes.total || 0, '#8e44ad')}
    ${_statCard('Jobs Completed', jobs.completed || 0, '#27ae60')}
    ${_statCard('Jobs Failed', jobs.failed || 0, '#c0392b')}
    ${_statCard('Jobs Queued', jobs.queued || 0, '#f39c12')}
    ${_statCard('Jobs Running', jobs.running || 0, '#3498db')}
  `;
  wrap.appendChild(grid);

  // Source type breakdown
  const byType = stats.by_type || {};
  if (Object.keys(byType).length > 0) {
    const typeSection = document.createElement('div');
    typeSection.className = 'vc-card';
    typeSection.style.marginTop = '12px';
    typeSection.innerHTML = `
      <div class="vc-section-title" style="margin-bottom:8px">Sources by Type</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${Object.entries(byType).map(([type, count]) =>
          `<span class="vc-tag" style="font-size:11px;padding:3px 8px">${_esc(type)}: ${count}</span>`
        ).join('')}
      </div>
    `;
    wrap.appendChild(typeSection);
  }

  // Recent errors
  const recentErrors = (data.logs || {}).recent_errors || [];
  if (recentErrors.length > 0) {
    const errSection = document.createElement('div');
    errSection.className = 'vc-card';
    errSection.style.marginTop = '12px';
    errSection.innerHTML = `
      <div class="vc-section-title" style="margin-bottom:8px;color:var(--red,#c0392b)">Recent Errors</div>
      ${recentErrors.map(e => `
        <div class="vc-log-row vc-log-error">
          <span class="vc-log-ts">${e.ts || ''}</span>
          <span>${_esc(e.source_name || '')}:</span>
          <span>${_esc(e.message || '')}</span>
        </div>
      `).join('')}
    `;
    wrap.appendChild(errSection);
  }

  _container.appendChild(wrap);
  _container.querySelector('#vc-health-refresh').addEventListener('click', _load);
}

function _statCard(label, value, color) {
  return `
    <div class="vc-stat-card">
      <div class="vc-stat-value" style="color:${color}">${value}</div>
      <div class="vc-stat-label">${_esc(label)}</div>
    </div>
  `;
}

function _esc(str) { const d = document.createElement('div'); d.textContent = String(str || ''); return d.innerHTML; }
