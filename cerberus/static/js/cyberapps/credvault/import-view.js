/**
 * CredVault — Import View
 * Mirrors ImportView.tsx. Supports CSV import (1Password/Bitwarden/KeePass
 * auto-detect), manual add, and import history.
 * Note: ReconDesk live-push queue is Electron-specific and is omitted
 * (no shared cybertools-config.json in Cerberus web context).
 */
import { renderCredModal } from './cred-modal.js';

const ACCENT = '#c0392b';

const FORMAT_LABELS = { '1password': '1Password', bitwarden: 'Bitwarden', keepass: 'KeePass', unknown: 'Unknown format' };
const FORMAT_COLORS = { '1password': '#3fb950', bitwarden: '#4a9eff', keepass: '#d29922', unknown: '#8b949e' };

function detectFormat(header) {
  const h = header.toLowerCase();
  if (h.includes('notetype') || h.includes('ainfo')) return '1password';
  if (h.includes('reprompt') || h.includes('organizationid')) return 'bitwarden';
  if (h.includes('uuid') && h.includes('group')) return 'keepass';
  return 'unknown';
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { format: 'unknown', rows: [], errors: ['File is empty or has no data rows.'] };
  const header = lines[0].toLowerCase();
  const format = detectFormat(header);
  const cols   = lines[0].split(',').map(c => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const rows   = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < cols.length - 1) { errors.push(`Row ${i+1}: too few columns`); continue; }
    const r = {};
    cols.forEach((c, j) => { r[c] = (cells[j] || '').replace(/^"|"$/g, '').trim(); });
    const cred = {
      service:  r['title'] || r['name'] || r['group'] || 'Unknown',
      username: r['username'] || r['login_username'] || r['accountname'] || '',
      password: r['password'] || r['login_password'] || '',
      ip:       r['url'] || r['login_uri'] || r['url_1'] || undefined,
      notes:    r['notes'] || r['comment'] || undefined,
      source:   `CSV import (${FORMAT_LABELS[format]})`,
      tags:     [],
      verified: false,
      status:   'active',
    };
    if (cred.service) rows.push(cred);
  }
  return { format, rows, errors };
}

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQ  = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

/**
 * @param {HTMLElement} container
 * @param {string} vaultToken
 */
export function renderImportView(container, vaultToken) {
  const headers = { 'X-Vault-Token': vaultToken };
  let csvPreview = null;
  let csvFormat  = null;
  let csvErrors  = [];
  let importHistory = JSON.parse(sessionStorage.getItem('cv-import-history') || '[]');

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...headers, ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `HTTP ${res.status}`); }
    return res.json();
  }

  function addHistory(entry) {
    importHistory.unshift(entry);
    sessionStorage.setItem('cv-import-history', JSON.stringify(importHistory.slice(0, 20)));
  }

  function render() {
    const selectedCount = csvPreview ? csvPreview.filter(r => r.selected).length : 0;
    container.innerHTML = `
      <div style="padding:24px;max-width:800px;display:flex;flex-direction:column;gap:24px;">
        <h2 style="font-size:16px;font-weight:600;color:#e2e8f0;margin:0;">Import Credentials</h2>

        <!-- CSV Import -->
        <div style="border:1px solid rgba(42,51,71,.5);border-radius:8px;overflow:hidden;">
          <div style="padding:10px 16px;background:rgba(13,14,24,.55);border-bottom:1px solid rgba(42,51,71,.5);font-size:12px;font-weight:500;color:#8b949e;">
            Import from CSV (1Password / Bitwarden / KeePass)
          </div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
            <p style="font-size:12px;color:#6b7280;margin:0;line-height:1.5;">
              Supports 1Password, Bitwarden, and KeePass CSV exports. Format is auto-detected from column headers.
            </p>
            <div style="display:flex;align-items:center;gap:10px;">
              <button id="cv-open-csv" style="font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">
                Open CSV File…
              </button>
              ${csvFormat ? `
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:11px;color:#6b7280;">Detected:</span>
                <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;
                  border:1px solid ${FORMAT_COLORS[csvFormat]}40;background:${FORMAT_COLORS[csvFormat]}18;color:${FORMAT_COLORS[csvFormat]};">
                  ${FORMAT_LABELS[csvFormat]}
                </span>
                ${csvPreview ? `<span style="font-size:11px;color:#6b7280;">${csvPreview.length} records found</span>` : ''}
              </div>` : ''}
            </div>
            ${csvErrors.length > 0 ? `
            <div style="font-size:11px;color:#d29922;">
              ${csvErrors.slice(0,3).map(e => `<div>${e}</div>`).join('')}
              ${csvErrors.length>3 ? `<div>…and ${csvErrors.length-3} more warnings</div>` : ''}
            </div>` : ''}
            ${csvPreview && csvPreview.length > 0 ? `
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:12px;color:#6b7280;">${selectedCount} of ${csvPreview.length} selected</span>
                <div style="display:flex;gap:6px;">
                  <button id="cv-csv-all" style="font-size:11px;padding:3px 9px;border-radius:5px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">All</button>
                  <button id="cv-csv-none" style="font-size:11px;padding:3px 9px;border-radius:5px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">None</button>
                  <button id="cv-csv-import" ${selectedCount===0?'disabled':''} style="font-size:12px;padding:4px 12px;border-radius:5px;background:${ACCENT};border:none;color:#fff;cursor:pointer;font-weight:600;">
                    Import Selected (${selectedCount})
                  </button>
                </div>
              </div>
              <div style="border:1px solid rgba(42,51,71,.5);border-radius:6px;overflow:hidden;max-height:280px;overflow-y:auto;">
                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr style="background:rgba(13,14,24,.55);border-bottom:1px solid rgba(42,51,71,.5);">
                      <th style="${thStyle}"></th>
                      <th style="${thStyle}">Service</th>
                      <th style="${thStyle}">Username</th>
                      <th style="${thStyle}">URL/IP</th>
                      <th style="${thStyle}">Has Password</th>
                    </tr>
                  </thead>
                  <tbody id="cv-csv-tbody">
                    ${csvPreview.map((row, i) => `
                      <tr class="cv-csv-row" data-idx="${i}" style="cursor:pointer;background:${row.selected?'rgba(192,57,43,.04)':'transparent'};border-bottom:1px solid rgba(42,51,71,.2);opacity:${row.selected?1:.45};">
                        <td style="${tdStyle}"><input type="checkbox" class="cv-csv-check" data-idx="${i}" ${row.selected?'checked':''} /></td>
                        <td style="${tdStyle}">${row.credential.service}</td>
                        <td style="${tdStyle};font-family:monospace;font-size:11px;">${row.credential.username}</td>
                        <td style="${tdStyle};font-size:10px;color:#6b7280;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row.credential.ip||'—'}</td>
                        <td style="${tdStyle}">${row.credential.password?'✓':'—'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>` : ''}
          </div>
        </div>

        <!-- Manual Add -->
        <div style="border:1px solid rgba(42,51,71,.5);border-radius:8px;overflow:hidden;">
          <div style="padding:10px 16px;background:rgba(13,14,24,.55);border-bottom:1px solid rgba(42,51,71,.5);font-size:12px;font-weight:500;color:#8b949e;">Manual Add</div>
          <div style="padding:14px 16px;">
            <button id="cv-manual-add" style="font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">+ Add Credential Manually</button>
          </div>
        </div>

        <!-- Import History -->
        ${importHistory.length > 0 ? `
        <div style="border:1px solid rgba(42,51,71,.5);border-radius:8px;overflow:hidden;">
          <div style="padding:10px 16px;background:rgba(13,14,24,.55);border-bottom:1px solid rgba(42,51,71,.5);font-size:12px;font-weight:500;color:#8b949e;">Import History</div>
          <div style="padding:14px 16px;display:flex;flex-direction:column;gap:6px;">
            ${importHistory.map(h => `<div style="font-size:12px;color:#6b7280;">${new Date(h.timestamp).toLocaleString()} — ${h.label}</div>`).join('')}
          </div>
        </div>` : ''}
      </div>
    `;

    // Wire events
    container.querySelector('#cv-open-csv')?.addEventListener('click', handleOpenCsv);
    container.querySelector('#cv-csv-all')?.addEventListener('click',  () => { csvPreview = csvPreview?.map(r => ({...r, selected:true})); render(); });
    container.querySelector('#cv-csv-none')?.addEventListener('click', () => { csvPreview = csvPreview?.map(r => ({...r, selected:false})); render(); });
    container.querySelector('#cv-csv-import')?.addEventListener('click', doCsvImport);
    container.querySelectorAll('.cv-csv-row').forEach(row =>
      row.addEventListener('click', () => toggleCsvRow(parseInt(row.dataset.idx, 10)))
    );
    container.querySelectorAll('.cv-csv-check').forEach(chk =>
      chk.addEventListener('click', e => { e.stopPropagation(); toggleCsvRow(parseInt(chk.dataset.idx, 10)); })
    );
    container.querySelector('#cv-manual-add')?.addEventListener('click', () => openManualModal());
  }

  function toggleCsvRow(idx) {
    if (!csvPreview) return;
    csvPreview[idx].selected = !csvPreview[idx].selected;
    render();
  }

  async function handleOpenCsv() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.csv';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = parseCsv(text);
      csvFormat  = result.format;
      csvErrors  = result.errors;
      csvPreview = result.rows.map(cred => ({ selected: true, credential: cred }));
      render();
    };
    input.click();
  }

  async function doCsvImport() {
    if (!csvPreview) return;
    const selected = csvPreview.filter(r => r.selected).map(r => r.credential);
    if (!selected.length) return;
    try {
      const res = await apiFetch('/api/credvault/import', {
        method: 'POST',
        body: JSON.stringify({ credentials: selected }),
      });
      addHistory({ timestamp: new Date().toISOString(), label: `${res.added} credential(s) from CSV (${FORMAT_LABELS[csvFormat] || 'unknown'})` });
      csvPreview = null;
      render();
    } catch (e) { alert('Import failed: ' + e.message); }
  }

  function openManualModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:300;';
    container.appendChild(overlay);
    renderCredModal(overlay, null, vaultToken, async (data) => {
      try {
        await apiFetch('/api/credvault/credentials', { method: 'POST', body: JSON.stringify(data) });
        addHistory({ timestamp: new Date().toISOString(), label: '1 credential added manually' });
        overlay.remove();
        render();
      } catch (e) { alert('Save failed: ' + e.message); }
    }, () => overlay.remove());
  }

  render();
}

const thStyle = 'padding:7px 12px;text-align:left;font-size:10px;font-weight:500;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;';
const tdStyle = 'padding:7px 12px;font-size:12px;color:#e2e8f0;';
