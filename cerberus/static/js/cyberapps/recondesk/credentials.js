/**
 * ReconDesk — Credentials tab.
 * Username/hash table with reveal/copy and age badges. Passwords are NOT stored server-side.
 */
import { _esc } from './index.js';

const HASH_STYLE = {
  NTLM:   'color:#f85149;background:rgba(248,81,73,0.10);border-color:rgba(248,81,73,0.20)',
  MD5:    'color:#d29922;background:rgba(210,153,34,0.10);border-color:rgba(210,153,34,0.20)',
  SHA1:   'color:#4a9eff;background:rgba(74,158,255,0.10);border-color:rgba(74,158,255,0.20)',
  bcrypt: 'color:#b44fff;background:rgba(180,79,255,0.10);border-color:rgba(180,79,255,0.20)',
  other:  'color:#4a5568;background:rgba(74,85,104,0.10);border-color:rgba(74,85,104,0.20)',
};

function _ageDays(addedAt) {
  if (!addedAt) return 0;
  return Math.floor((Date.now() - new Date(addedAt).getTime()) / 86400000);
}

export function renderCreds(el, target, handlers) {
  const { onAddCred, onUpdateCred, onDeleteCred } = handlers;
  const creds = target.credentials || [];

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="rd-section-header">
        <span class="rd-section-title">Credentials<span class="rd-section-sub">(${creds.length})</span></span>
        <button class="rd-btn rd-btn--primary" id="rd-cred-add-toggle">+ Add</button>
      </div>

      <!-- Add form -->
      <div id="rd-cred-add-form" style="display:none;padding:12px 16px;background:rgba(13,14,24,0.8);border-bottom:1px solid rgba(42,51,71,0.5)">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Username<br>
            <input class="rd-input" id="rd-cf-user" placeholder="root" style="width:130px;font-family:monospace" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Hash (optional)<br>
            <input class="rd-input" id="rd-cf-hash" placeholder="NTLM hash…" style="width:180px;font-family:monospace" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Hash type<br>
            <select class="rd-input" id="rd-cf-hashtype" style="width:80px">
              <option value="">—</option><option>NTLM</option><option>MD5</option><option>SHA1</option><option>bcrypt</option><option>other</option>
            </select></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Service<br>
            <input class="rd-input" id="rd-cf-svc" placeholder="ssh" style="width:80px" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Port<br>
            <input class="rd-input" id="rd-cf-port" type="number" min="1" max="65535" placeholder="22" style="width:70px;font-family:monospace" /></label>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Source<br>
            <input class="rd-input" id="rd-cf-src" placeholder="gobuster…" style="width:110px" /></label>
          <button class="rd-btn rd-btn--primary" id="rd-cf-submit">Add</button>
          <button class="rd-btn" id="rd-cf-cancel">Cancel</button>
        </div>
      </div>

      <!-- Table -->
      <div style="flex:1;overflow-y:auto">
        ${creds.length === 0 ? `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:#484f58">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" style="opacity:.3"><circle cx="8" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M14.5 10H21M17 7.5l3 2.5-3 2.5M4 21v-1a4 4 0 0 1 4-4h1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <p style="font-size:12px;margin:0">No credentials captured</p>
          </div>
        ` : `
          <table class="rd-table">
            <thead><tr><th>Username</th><th>Hash</th><th>Service</th><th>Port</th><th>Status</th><th>Age</th><th></th></tr></thead>
            <tbody>
              ${creds.map((c, i) => {
                const days = _ageDays(c.added_at);
                const ageColor = days > 90 ? '#f85149' : days > 30 ? '#d29922' : '#484f58';
                const hashStyle = HASH_STYLE[c.hash_type] || HASH_STYLE.other;
                return `
                  <tr class="rd-cred-row" data-cred-id="${_esc(c.id)}" style="background:${i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}">
                    <td style="font-family:monospace;color:#e2e8f0;font-size:11px">${_esc(c.username || '—')}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:6px">
                        ${c.hash_value ? `
                          <span class="rd-hash-val" data-cid="${_esc(c.id)}" style="font-family:monospace;font-size:11px;color:#4a9eff;cursor:pointer" title="Click to reveal">••••••••</span>
                          ${c.hash_type ? `<span class="rd-badge" style="${hashStyle}">${_esc(c.hash_type)}</span>` : ''}
                        ` : '<span style="color:#484f58">—</span>'}
                      </div>
                    </td>
                    <td style="font-family:monospace;font-size:11px;color:#8b949e">${_esc(c.service || '—')}</td>
                    <td style="font-family:monospace;font-size:11px;color:#8b949e">${c.port ?? '—'}</td>
                    <td>
                      <button class="rd-btn rd-cred-verify" data-cid="${_esc(c.id)}" data-verified="${c.verified}"
                        style="${c.verified ? 'color:#3fb950;background:rgba(63,185,80,0.10);border-color:rgba(63,185,80,0.25)' : 'color:#484f58;background:transparent;border-color:rgba(42,51,71,0.4)'}; font-size:10px;padding:2px 8px">
                        ${c.verified ? '✓ verified' : '○ unverified'}
                      </button>
                    </td>
                    <td>${days > 0 ? `<span class="rd-badge" style="color:${ageColor};background:${ageColor}12;border-color:${ageColor}25">${days}d</span>` : ''}</td>
                    <td><button class="rd-btn rd-btn--danger" data-del-cred="${_esc(c.id)}" style="font-size:10px;padding:2px 8px">✕</button></td>
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
  const addForm = el.querySelector('#rd-cred-add-form');
  el.querySelector('#rd-cred-add-toggle')?.addEventListener('click', () => {
    addForm.style.display = addForm.style.display === 'none' ? '' : 'none';
  });
  el.querySelector('#rd-cf-cancel')?.addEventListener('click', () => { addForm.style.display = 'none'; });
  el.querySelector('#rd-cf-submit')?.addEventListener('click', async () => {
    const username = el.querySelector('#rd-cf-user').value.trim();
    const hash_value = el.querySelector('#rd-cf-hash').value.trim() || null;
    if (!username && !hash_value) return;
    await onAddCred(target.id, {
      username,
      hash_value,
      hash_type: el.querySelector('#rd-cf-hashtype').value || null,
      service:   el.querySelector('#rd-cf-svc').value.trim(),
      port:      parseInt(el.querySelector('#rd-cf-port').value) || null,
      source:    el.querySelector('#rd-cf-src').value.trim(),
      verified:  false,
    });
    addForm.style.display = 'none';
  });

  // Hash reveal toggle
  el.querySelectorAll('.rd-hash-val').forEach(span => {
    let revealed = false;
    const cid = span.dataset.cid;
    const cred = creds.find(c => c.id === cid);
    span.addEventListener('click', () => {
      revealed = !revealed;
      span.textContent = revealed ? (cred?.hash_value || '••••••••') : '••••••••';
      span.title = revealed ? 'Click to hide' : 'Click to reveal';
    });
  });

  // Toggle verified
  el.querySelectorAll('.rd-cred-verify').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.dataset.cid;
      const cur = btn.dataset.verified === 'true';
      onUpdateCred(target.id, cid, { verified: !cur });
    });
  });

  // Delete
  el.querySelectorAll('[data-del-cred]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteCred(target.id, btn.dataset.delCred));
  });
}
