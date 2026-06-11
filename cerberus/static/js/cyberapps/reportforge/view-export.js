/**
 * static/js/cyberapps/reportforge/view-export.js
 * ReportForge — export modal overlay.
 * Formats: Markdown (inline download) and HTML (inline download).
 * PDF is browser-print via the HTML export + @media print stylesheet.
 */

import { api, downloadText, escHtml } from './utils.js';

const FORMATS = [
  { id: 'markdown', label: 'Markdown', ext: '.md',   tip: 'Plain Markdown file' },
  { id: 'html',     label: 'HTML',     ext: '.html', tip: 'Standalone HTML — use browser Print → PDF for PDF output' },
];

/**
 * @param {string} reportId
 * @param {string} reportTitle
 * @param {Function} onClose
 */
export function showExportModal(reportId, reportTitle, onClose) {
  const existing = document.getElementById('rf-export-modal-overlay');
  if (existing) existing.remove();

  let fmt = 'markdown';
  let includeToc = true;
  let includeFindingsTable = true;
  let includeCredentials = true;
  let redactCredentials = true;
  let exporting = false;

  const overlay = document.createElement('div');
  overlay.id = 'rf-export-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:3000;';

  function _render() {
    overlay.innerHTML = `
      <div style="background:var(--panel,#16181e);border:1px solid var(--border,#2a2a3a);border-radius:10px;
        width:min(380px,96%);overflow:hidden;">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2a3a);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:700;color:var(--fg,#c5c9d0);">Export Report</span>
          <button id="rf-exp-close" style="background:none;border:none;color:var(--text-dim,#666);cursor:pointer;font-size:18px;">&times;</button>
        </div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px;">
          <!-- Format pills -->
          <div>
            <p style="font-size:10px;color:var(--text-dim,#666);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;font-weight:600;">Format</p>
            <div style="display:flex;gap:6px;">
              ${FORMATS.map(f => `<button class="rf-fmt-btn" data-fmt="${f.id}" style="
                padding:6px 14px;font-size:12px;font-weight:${fmt === f.id ? 700 : 500};border-radius:99px;cursor:pointer;
                background:${fmt === f.id ? 'rgba(74,158,255,.18)' : 'transparent'};
                color:${fmt === f.id ? '#4a9eff' : 'var(--text-dim,#999)'};
                border:1px solid ${fmt === f.id ? 'rgba(74,158,255,.4)' : 'var(--border,#2a2a3a)'};">
                ${f.label}<span style="font-size:9px;margin-left:4px;opacity:.7;">${f.ext}</span>
              </button>`).join('')}
            </div>
            ${fmt === 'html' ? `<p style="font-size:10px;color:var(--text-dim,#666);margin-top:5px;font-style:italic;">Use browser Print → Save as PDF for PDF output.</p>` : ''}
          </div>
          <!-- Options -->
          <div>
            <p style="font-size:10px;color:var(--text-dim,#666);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;font-weight:600;">Include</p>
            <div style="display:flex;flex-direction:column;gap:7px;">
              ${_chk('rf-exp-toc', 'Table of contents', includeToc)}
              ${_chk('rf-exp-ftable', 'Finding severity table', includeFindingsTable)}
              ${_chk('rf-exp-creds', 'Credentials section', includeCredentials)}
              ${includeCredentials ? `<div style="margin-left:18px;">${_chk('rf-exp-redact', 'Redact passwords [redacted]', redactCredentials, '#c0392b')}</div>` : ''}
            </div>
          </div>
        </div>
        ${exporting ? `<div style="padding:6px 20px 0;">
          <div style="height:3px;background:rgba(74,158,255,.15);border-radius:99px;overflow:hidden;">
            <div id="rf-exp-bar" style="height:100%;width:10%;background:#4a9eff;transition:width .1s linear;"></div>
          </div>
        </div>` : ''}
        <div style="padding:14px 20px;border-top:1px solid var(--border,#2a2a3a);display:flex;justify-content:flex-end;gap:8px;">
          <button id="rf-exp-cancel" style="padding:6px 14px;border-radius:6px;background:none;border:1px solid var(--border,#2a2a3a);color:var(--fg,#c5c9d0);font-size:12px;cursor:pointer;"
            ${exporting ? 'disabled' : ''}>Cancel</button>
          <button id="rf-exp-go" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;"
            ${exporting ? 'disabled' : ''}>${exporting ? 'Exporting…' : `Export ${FORMATS.find(f => f.id === fmt)?.label ?? ''}`}</button>
        </div>
      </div>
    `;

    overlay.querySelector('#rf-exp-close').addEventListener('click', () => { overlay.remove(); onClose?.(); });
    overlay.querySelector('#rf-exp-cancel').addEventListener('click', () => { overlay.remove(); onClose?.(); });
    overlay.querySelectorAll('.rf-fmt-btn').forEach(btn => {
      btn.addEventListener('click', () => { fmt = btn.dataset.fmt; _render(); });
    });
    ['rf-exp-toc', 'rf-exp-ftable', 'rf-exp-creds', 'rf-exp-redact'].forEach(id => {
      const el = overlay.querySelector(`#${id}`);
      if (!el) return;
      el.addEventListener('change', () => {
        if (id === 'rf-exp-toc')    includeToc = el.checked;
        if (id === 'rf-exp-ftable') includeFindingsTable = el.checked;
        if (id === 'rf-exp-creds')  includeCredentials = el.checked;
        if (id === 'rf-exp-redact') redactCredentials = el.checked;
        _render();
      });
    });
    overlay.querySelector('#rf-exp-go').addEventListener('click', _doExport);
  }

  async function _doExport() {
    exporting = true;
    _render();
    try {
      const params = new URLSearchParams({
        include_toc:            String(includeToc),
        include_findings_table: String(includeFindingsTable),
        include_credentials:    String(includeCredentials),
        redact_credentials:     String(redactCredentials),
      });
      const url = `/api/cyberapps/reportforge/reports/${reportId}/export/${fmt}?${params}`;
      const data = await api(url, 'POST');
      if (fmt === 'markdown') {
        downloadText(data.markdown, data.filename ?? `${reportTitle}.md`, 'text/markdown');
      } else {
        downloadText(data.html, data.filename ?? `${reportTitle}.html`, 'text/html');
      }
      overlay.remove();
      onClose?.();
    } catch (err) {
      exporting = false;
      _render();
      alert(`Export failed: ${err.message}`);
    }
  }

  _render();
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onClose?.(); } });
  document.body.appendChild(overlay);
}

function _chk(id, label, checked, accentColor = null) {
  const color = accentColor ?? 'var(--fg,#c5c9d0)';
  return `<label style="display:flex;align-items:center;gap:7px;cursor:pointer;">
    <div onclick="this.parentElement.querySelector('input').click()"
      style="width:13px;height:13px;border-radius:3px;flex-shrink:0;
        border:1.5px solid ${checked ? 'var(--red,#c0392b)' : 'var(--border,#2a2a3a)'};
        background:${checked ? 'var(--red,#c0392b)' : 'transparent'};
        display:flex;align-items:center;justify-content:center;cursor:pointer;">
      ${checked ? '<svg width="9" height="7" viewBox="0 0 9 7"><path d="M1 3L3.5 5.5L8 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
    </div>
    <input id="${id}" type="checkbox" ${checked ? 'checked' : ''} style="display:none;">
    <span style="font-size:12px;color:${color};">${label}</span>
  </label>`;
}
