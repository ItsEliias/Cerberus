/**
 * static/js/cyberapps/reportforge/view-export.js
 * ReportForge — export modal overlay.
 * Markdown: inline download. HTML: inline download (browser Print → PDF).
 */

import { api, downloadText, escHtml } from './utils.js';

const FORMATS = [
  { id: 'markdown', label: 'Markdown', ext: '.md' },
  { id: 'html',     label: 'HTML',     ext: '.html' },
];

function _chk(id, label, checked, accent = false) {
  const color = accent ? 'var(--red,#c0392b)' : 'var(--fg,#c5c9d0)';
  return `<label style="display:flex;align-items:center;gap:7px;cursor:pointer;">
    <div onclick="this.parentElement.querySelector('input').click()" style="width:13px;height:13px;border-radius:3px;flex-shrink:0;border:1.5px solid ${checked?'var(--red,#c0392b)':'var(--border,#2a2a3a)'};background:${checked?'var(--red,#c0392b)':'transparent'};display:flex;align-items:center;justify-content:center;cursor:pointer;">
      ${checked?'<svg width="9" height="7" viewBox="0 0 9 7"><path d="M1 3L3.5 5.5L8 1" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>':''}
    </div>
    <input id="${id}" type="checkbox" ${checked?'checked':''} style="display:none;">
    <span style="font-size:12px;color:${color};">${label}</span>
  </label>`;
}

export function showExportModal(reportId, reportTitle, onClose) {
  document.getElementById('rf-export-modal-overlay')?.remove();

  let fmt = 'markdown', includeToc = true, includeFindingsTable = true;
  let includeCredentials = true, redactCredentials = true, exporting = false;

  const overlay = document.createElement('div');
  overlay.id = 'rf-export-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:3000;';

  function _render() {
    overlay.innerHTML = `
      <div style="background:var(--panel,#16181e);border:1px solid var(--border,#2a2a3a);border-radius:10px;width:min(380px,96%);overflow:hidden;">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2a3a);display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:14px;font-weight:700;color:var(--fg,#c5c9d0);">Export Report</span>
          <button id="rf-exp-close" style="background:none;border:none;color:var(--text-dim,#666);cursor:pointer;font-size:18px;">&times;</button>
        </div>
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px;">
          <div>
            <p style="font-size:10px;color:var(--text-dim,#666);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;font-weight:600;">Format</p>
            <div style="display:flex;gap:6px;">
              ${FORMATS.map(f => `<button class="rf-fmt-btn" data-fmt="${f.id}" style="padding:6px 14px;font-size:12px;font-weight:${fmt===f.id?700:500};border-radius:99px;cursor:pointer;background:${fmt===f.id?'rgba(74,158,255,.18)':'transparent'};color:${fmt===f.id?'#4a9eff':'var(--text-dim,#999)'};border:1px solid ${fmt===f.id?'rgba(74,158,255,.4)':'var(--border,#2a2a3a)'};">${f.label}<span style="font-size:9px;margin-left:4px;opacity:.7;">${f.ext}</span></button>`).join('')}
            </div>
            ${fmt==='html'?'<p style="font-size:10px;color:var(--text-dim,#666);margin-top:5px;font-style:italic;">Use browser Print → Save as PDF for PDF output.</p>':''}
          </div>
          <div>
            <p style="font-size:10px;color:var(--text-dim,#666);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px;font-weight:600;">Include</p>
            <div style="display:flex;flex-direction:column;gap:7px;">
              ${_chk('rf-exp-toc','Table of contents',includeToc)}
              ${_chk('rf-exp-ftable','Finding severity table',includeFindingsTable)}
              ${_chk('rf-exp-creds','Credentials section',includeCredentials)}
              ${includeCredentials?`<div style="margin-left:18px;">${_chk('rf-exp-redact','Redact passwords [redacted]',redactCredentials,true)}</div>`:''}
            </div>
          </div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--border,#2a2a3a);display:flex;justify-content:flex-end;gap:8px;">
          <button id="rf-exp-cancel" style="padding:6px 14px;border-radius:6px;background:none;border:1px solid var(--border,#2a2a3a);color:var(--fg,#c5c9d0);font-size:12px;cursor:pointer;"${exporting?' disabled':''}>Cancel</button>
          <button id="rf-exp-go" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;"${exporting?' disabled':''}>${exporting?'Exporting…':'Export '+FORMATS.find(f=>f.id===fmt)?.label??fmt}</button>
        </div>
      </div>`;

    const close = () => { overlay.remove(); onClose?.(); };
    overlay.querySelector('#rf-exp-close').addEventListener('click', close);
    overlay.querySelector('#rf-exp-cancel').addEventListener('click', close);
    overlay.querySelectorAll('.rf-fmt-btn').forEach(btn => btn.addEventListener('click', () => { fmt = btn.dataset.fmt; _render(); }));
    const bind = (id, setter) => { const el = overlay.querySelector(`#${id}`); if (el) el.addEventListener('change', () => { setter(el.checked); _render(); }); };
    bind('rf-exp-toc',    v => { includeToc = v; });
    bind('rf-exp-ftable', v => { includeFindingsTable = v; });
    bind('rf-exp-creds',  v => { includeCredentials = v; });
    bind('rf-exp-redact', v => { redactCredentials = v; });
    overlay.querySelector('#rf-exp-go').addEventListener('click', _doExport);
  }

  async function _doExport() {
    exporting = true; _render();
    try {
      const params = new URLSearchParams({ include_toc: String(includeToc), include_findings_table: String(includeFindingsTable), include_credentials: String(includeCredentials), redact_credentials: String(redactCredentials) });
      const data = await api(`/api/cyberapps/reportforge/reports/${reportId}/export/${fmt}?${params}`, 'POST');
      if (fmt === 'markdown') downloadText(data.markdown, data.filename ?? `${reportTitle}.md`, 'text/markdown');
      else downloadText(data.html, data.filename ?? `${reportTitle}.html`, 'text/html');
      overlay.remove(); onClose?.();
    } catch (err) {
      exporting = false; _render();
      alert(`Export failed: ${err.message}`);
    }
  }

  _render();
  overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); onClose?.(); } });
  document.body.appendChild(overlay);
}
