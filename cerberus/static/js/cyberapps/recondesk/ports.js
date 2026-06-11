/**
 * ReconDesk — Ports tab.
 * Port table with sort, inline notes, nmap XML import (browser-side parse).
 */
import { _esc } from './index.js';

const HIGH_RISK = new Set([21,23,25,110,135,137,139,445,512,513,514,1433,1521,3306,3389,5432,5900,6379,27017]);
const LOW_RISK  = new Set([22,80,443,8080,8443]);

function portRisk(n) {
  if (HIGH_RISK.has(n)) return 'high';
  if (LOW_RISK.has(n))  return 'low';
  return 'med';
}

const RISK_STYLE = {
  low:  'color:#3fb950;background:rgba(63,185,80,0.08);border-color:rgba(63,185,80,0.2)',
  med:  'color:#d29922;background:rgba(210,153,34,0.08);border-color:rgba(210,153,34,0.2)',
  high: 'color:#f85149;background:rgba(248,81,73,0.08);border-color:rgba(248,81,73,0.2)',
};

const STATE_STYLE = {
  open:     'color:#3fb950;background:rgba(63,185,80,0.1);border-color:rgba(63,185,80,0.25)',
  filtered: 'color:#d29922;background:rgba(210,153,34,0.1);border-color:rgba(210,153,34,0.25)',
  closed:   'color:#4a5568;background:rgba(74,85,104,0.1);border-color:rgba(74,85,104,0.25)',
};

export function renderPorts(el, target, handlers) {
  const { onAddPort, onUpdatePort, onDeletePort, onImportNmap } = handlers;
  const ports = target.ports || [];
  const openCount = ports.filter(p => p.state === 'open').length;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="rd-section-header">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="rd-section-title">Ports<span class="rd-section-sub">(${openCount} open)</span></span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="rd-btn" id="rd-port-import">Import nmap XML</button>
          <button class="rd-btn rd-btn--primary" id="rd-port-add-toggle">+ Add</button>
        </div>
      </div>

      <!-- Add form (hidden initially) -->
      <div id="rd-port-add-form" style="display:none;padding:12px 16px;background:rgba(13,14,24,0.8);border-bottom:1px solid rgba(42,51,71,0.5)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Port<br>
            <input class="rd-input" id="rd-pf-port" type="number" min="1" max="65535" placeholder="80" style="width:70px;font-family:monospace" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Proto<br>
            <select class="rd-input" id="rd-pf-proto" style="width:70px"><option>tcp</option><option>udp</option></select></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">State<br>
            <select class="rd-input" id="rd-pf-state"><option>open</option><option>filtered</option><option>closed</option></select></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Service<br>
            <input class="rd-input" id="rd-pf-service" placeholder="http" style="width:100px" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Version<br>
            <input class="rd-input" id="rd-pf-version" placeholder="Apache 2.4" style="width:150px" /></label>
          <button class="rd-btn rd-btn--primary" id="rd-pf-submit">Add Port</button>
          <button class="rd-btn" id="rd-pf-cancel">Cancel</button>
        </div>
      </div>

      <!-- Table -->
      <div style="flex:1;overflow-y:auto">
        ${ports.length === 0 ? `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:#484f58">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="opacity:.3"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <p style="font-size:12px;margin:0">No ports recorded</p>
            <p style="font-size:11px;color:#484f58;margin:0">Import nmap XML or add manually</p>
          </div>
        ` : `
          <table class="rd-table">
            <thead><tr>
              <th>Port</th><th>Proto</th><th>Service</th><th>Version</th><th>State</th><th>Risk</th><th></th>
            </tr></thead>
            <tbody>
              ${ports.sort((a,b) => a.port - b.port).map(p => {
                const risk = portRisk(p.port);
                return `
                  <tr data-port-id="${_esc(p.id)}" style="cursor:pointer">
                    <td style="font-family:monospace;font-weight:700;color:#e2e8f0">${p.port}</td>
                    <td style="font-family:monospace;color:#8b949e">${_esc(p.protocol)}</td>
                    <td style="color:#e2e8f0">${_esc(p.service || '—')}</td>
                    <td style="color:#8b949e;max-width:200px"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${_esc(p.version)}">${_esc(p.version || '—')}</span></td>
                    <td><span class="rd-badge" style="${STATE_STYLE[p.state] || STATE_STYLE.closed}">${_esc(p.state)}</span></td>
                    <td>${p.state === 'open' ? `<span class="rd-badge" style="${RISK_STYLE[risk]}">${risk}</span>` : ''}</td>
                    <td><button class="rd-btn rd-btn--danger" data-del-port="${_esc(p.id)}" style="font-size:10px;padding:2px 8px;opacity:0">✕</button></td>
                  </tr>
                  <tr data-notes-for="${_esc(p.id)}" style="display:none;background:rgba(13,14,24,0.7)">
                    <td colspan="7" style="padding:8px 16px">
                      <textarea class="rd-input rd-port-notes" data-pid="${_esc(p.id)}" rows="2"
                        placeholder="Notes for this port..." style="font-family:monospace;resize:none">${_esc(p.notes || '')}</textarea>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `}
      </div>
    </div>
  `;

  // Toggle add form
  const addForm = el.querySelector('#rd-port-add-form');
  el.querySelector('#rd-port-add-toggle')?.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
  });
  el.querySelector('#rd-pf-cancel')?.addEventListener('click', () => { addForm.style.display = 'none'; });

  el.querySelector('#rd-pf-submit')?.addEventListener('click', async () => {
    const portNum = parseInt(el.querySelector('#rd-pf-port').value);
    if (!portNum || portNum < 1 || portNum > 65535) return;
    await onAddPort(target.id, {
      port:     portNum,
      protocol: el.querySelector('#rd-pf-proto').value,
      state:    el.querySelector('#rd-pf-state').value,
      service:  el.querySelector('#rd-pf-service').value,
      version:  el.querySelector('#rd-pf-version').value,
      source:   'manual',
    });
    addForm.style.display = 'none';
  });

  // Import nmap
  el.querySelector('#rd-port-import')?.addEventListener('click', () => _showNmapModal(target.id, onImportNmap));

  // Row click → show notes
  el.querySelectorAll('tr[data-port-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-port]')) return;
      const id = row.dataset.portId;
      const notesRow = el.querySelector(`tr[data-notes-for="${id}"]`);
      if (notesRow) notesRow.style.display = notesRow.style.display === 'none' ? '' : 'none';
    });
    row.addEventListener('mouseenter', () => { row.querySelector('[data-del-port]').style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { row.querySelector('[data-del-port]').style.opacity = '0'; });
  });

  // Delete port
  el.querySelectorAll('[data-del-port]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeletePort(target.id, btn.dataset.delPort);
    });
  });

  // Notes blur → save
  el.querySelectorAll('.rd-port-notes').forEach(ta => {
    ta.addEventListener('blur', () => onUpdatePort(target.id, ta.dataset.pid, { notes: ta.value }));
  });
}

function _showNmapModal(targetId, onImportNmap) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rd-modal-backdrop';
  backdrop.innerHTML = `
    <div class="rd-modal">
      <div class="rd-modal-header">
        <span>Import nmap XML</span>
        <button class="rd-modal-close" id="rd-nmap-close">✕</button>
      </div>
      <div class="rd-modal-body" style="display:flex;flex-direction:column;gap:10px">
        <p style="font-size:11px;color:#8b949e;margin:0">Paste the contents of your <code>nmap -oX</code> output file below.</p>
        <textarea class="rd-input" id="rd-nmap-xml" rows="10" placeholder="&lt;?xml version=&quot;1.0&quot;?&gt;..." style="font-family:monospace;font-size:11px;resize:vertical"></textarea>
        <button class="rd-btn rd-btn--primary" id="rd-nmap-submit" style="align-self:flex-end">Import</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#rd-nmap-close')?.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#rd-nmap-submit')?.addEventListener('click', async () => {
    const xml = backdrop.querySelector('#rd-nmap-xml').value.trim();
    if (!xml) return;
    await onImportNmap(targetId, xml);
    backdrop.remove();
  });
}
