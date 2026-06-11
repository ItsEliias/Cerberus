/**
 * VaultCore — Logs tab.
 * Historical scrape log viewer with filtering.
 */

const API = '';

let _container = null;
let _logs = [];
let _filterStatus = '';
let _filterSource = '';

export function renderLogs(container) {
  _container = container;
  _load();
}

async function _load() {
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (_filterStatus) params.set('status', _filterStatus);
    if (_filterSource) params.set('source_id', _filterSource);
    const res = await fetch(`${API}/api/cyberapps/vaultcore/logs?${params}`);
    _logs = await res.json();
  } catch { _logs = []; }
  _render();
}

function _render() {
  if (!_container) return;
  _container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vc-logs';

  const header = document.createElement('div');
  header.className = 'vc-section-header';
  header.innerHTML = `
    <span class="vc-section-title">Scrape Logs</span>
    <div style="display:flex;gap:6px;align-items:center">
      <select class="vc-select" id="vc-log-status-filter" style="font-size:11px;padding:3px 6px">
        <option value="">All statuses</option>
        <option value="queued"${_filterStatus==='queued'?' selected':''}>Queued</option>
        <option value="running"${_filterStatus==='running'?' selected':''}>Running</option>
        <option value="completed"${_filterStatus==='completed'?' selected':''}>Completed</option>
        <option value="error"${_filterStatus==='error'?' selected':''}>Error</option>
      </select>
      <button class="vc-btn vc-btn-ghost" id="vc-log-refresh" style="font-size:11px">Refresh</button>
      <button class="vc-btn vc-btn-danger" id="vc-log-clear" style="font-size:11px">Clear All</button>
    </div>
  `;
  wrap.appendChild(header);

  if (_logs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vc-empty';
    empty.textContent = 'No log entries.';
    wrap.appendChild(empty);
  } else {
    const table = document.createElement('div');
    table.className = 'vc-log-table';
    const reversed = [..._logs].reverse();
    reversed.forEach(entry => {
      const row = document.createElement('div');
      row.className = `vc-log-row vc-log-${entry.status || 'info'}`;
      row.innerHTML = `
        <span class="vc-log-ts">${_fmtTs(entry.ts)}</span>
        <span class="vc-log-status">${_esc(entry.status || '')}</span>
        <span class="vc-log-src">${_esc(entry.source_name || '—')}</span>
        <span class="vc-log-msg">${_esc(entry.message || '')}</span>
      `;
      table.appendChild(row);
    });
    wrap.appendChild(table);
  }

  _container.appendChild(wrap);

  _container.querySelector('#vc-log-status-filter').addEventListener('change', e => {
    _filterStatus = e.target.value;
    _load();
  });
  _container.querySelector('#vc-log-refresh').addEventListener('click', _load);
  _container.querySelector('#vc-log-clear').addEventListener('click', async () => {
    if (!confirm('Clear all log entries?')) return;
    await fetch(`${API}/api/cyberapps/vaultcore/logs`, { method: 'DELETE' });
    _logs = [];
    _render();
  });
}

function _fmtTs(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function _esc(str) { const d = document.createElement('div'); d.textContent = String(str || ''); return d.innerHTML; }
