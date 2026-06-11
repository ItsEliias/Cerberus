/**
 * CredVault — Settings View
 * Mirrors SettingsView.tsx. Features:
 *   - Auto-lock interval selector
 *   - Clipboard clear timer selector
 *   - Change master password form
 *   - Export encrypted backup (download as .cvcrypt JSON)
 *   - Import encrypted backup (upload .cvcrypt JSON)
 *   - Password audit (weak / reused / expired)
 */
import { scorePassword } from './password.js';

const ACCENT = '#c0392b';

const AUTO_LOCK_OPTS = [
  { label: 'Never',  ms: 0 },
  { label: '5 min',  ms: 300000 },
  { label: '15 min', ms: 900000 },
  { label: '30 min', ms: 1800000 },
];

const CLIP_CLEAR_OPTS = [
  { label: '30s',   ms: 30000 },
  { label: '60s',   ms: 60000 },
  { label: 'Never', ms: 0 },
];

/**
 * @param {HTMLElement} container
 * @param {string} vaultToken
 */
export function renderSettingsView(container, vaultToken) {
  const headers = { 'X-Vault-Token': vaultToken };
  let settings  = { sort_order: null, auto_lock_ms: 0, clipboard_clear_ms: 30000 };
  let credentials = [];
  let auditReport = null;

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...headers, ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `HTTP ${res.status}`); }
    return res.json();
  }

  async function loadData() {
    const [s, c] = await Promise.all([
      apiFetch('/api/credvault/settings').catch(() => settings),
      apiFetch('/api/credvault/credentials').catch(() => ({ credentials: [] })),
    ]);
    settings    = s;
    credentials = c.credentials || [];
    render();
  }

  function runAudit() {
    const withPw = credentials.filter(c => c.password);
    const weak    = withPw.filter(c => scorePassword(c.password).level <= 2);
    const pwCounts = {};
    withPw.forEach(c => { const k = c.password; pwCounts[k] = (pwCounts[k] || 0) + 1; });
    const reused = withPw.filter(c => pwCounts[c.password] > 1);
    const now = Date.now();
    const expired = credentials.filter(c => c.expiresAt && new Date(c.expiresAt).getTime() < now);
    auditReport = { weak, reused, expired, total: credentials.length };
    render();
  }

  function render() {
    container.innerHTML = `
      <div style="padding:24px;max-width:720px;display:flex;flex-direction:column;gap:24px;">
        <h2 style="font-size:16px;font-weight:600;color:#e2e8f0;margin:0;">Settings</h2>

        <!-- Preferences -->
        <section style="display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Preferences</div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <div>
              <div style="font-size:13px;color:#e2e8f0;font-weight:500;">Auto-lock</div>
              <div style="font-size:11px;color:#6b7280;">Lock the vault after a period of inactivity.</div>
            </div>
            <select id="cv-autolock" style="font-size:12px;padding:5px 8px;border-radius:6px;">
              ${AUTO_LOCK_OPTS.map(o => `<option value="${o.ms}" ${settings.auto_lock_ms===o.ms?'selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 14px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <div>
              <div style="font-size:13px;color:#e2e8f0;font-weight:500;">Clipboard clear</div>
              <div style="font-size:11px;color:#6b7280;">Auto-clear clipboard after copying a password.</div>
            </div>
            <select id="cv-clipclear" style="font-size:12px;padding:5px 8px;border-radius:6px;">
              ${CLIP_CLEAR_OPTS.map(o => `<option value="${o.ms}" ${settings.clipboard_clear_ms===o.ms?'selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>
        </section>

        <!-- Security -->
        <section style="display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Security</div>

          <!-- Change password -->
          <div style="padding:16px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <div style="font-size:13px;color:#e2e8f0;font-weight:500;margin-bottom:12px;">Change master password</div>
            <form id="cv-change-pw-form" style="display:flex;flex-direction:column;gap:10px;">
              <input type="password" name="curPw"  placeholder="Current password"          autocomplete="current-password" style="font-size:12px;" />
              <input type="password" name="newPw"  placeholder="New password (min 8 chars)" autocomplete="new-password"     style="font-size:12px;" />
              <input type="password" name="confPw" placeholder="Confirm new password"       autocomplete="new-password"     style="font-size:12px;" />
              <div id="cv-pw-msg" style="font-size:12px;display:none;"></div>
              <button type="submit" style="align-self:flex-start;font-size:12px;padding:6px 14px;border-radius:6px;background:${ACCENT};border:none;color:#fff;cursor:pointer;font-weight:600;">
                Change Password
              </button>
            </form>
          </div>
        </section>

        <!-- Password audit -->
        <section style="display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Password Health</div>
          <div style="padding:14px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <button id="cv-audit-btn" style="font-size:12px;padding:6px 12px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">
              Run Password Audit
            </button>
            ${auditReport ? `
            <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
                ${auditStatCard('Weak passwords', auditReport.weak.length, auditReport.weak.length > 0 ? '#f85149' : '#3fb950')}
                ${auditStatCard('Reused passwords', auditReport.reused.length, auditReport.reused.length > 0 ? '#d29922' : '#3fb950')}
                ${auditStatCard('Expired entries', auditReport.expired.length, auditReport.expired.length > 0 ? '#f85149' : '#3fb950')}
              </div>
              ${auditReport.weak.length > 0 ? `
              <div>
                <div style="font-size:10px;color:#f85149;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Weak passwords</div>
                ${auditReport.weak.slice(0,10).map(c => `
                  <div style="font-size:12px;color:#e2e8f0;padding:6px 10px;border-bottom:1px solid rgba(42,51,71,.2);">
                    ${c.service} — <span style="color:#8b949e;font-family:monospace;">${c.username}</span>
                    <span style="float:right;font-size:10px;color:#f85149;font-weight:600;">${scorePassword(c.password).label}</span>
                  </div>
                `).join('')}
              </div>` : ''}
              ${auditReport.reused.length > 0 ? `
              <div>
                <div style="font-size:10px;color:#d29922;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Reused passwords</div>
                ${[...new Set(auditReport.reused.map(c => c.service))].slice(0,10).map(svc => `
                  <div style="font-size:12px;color:#e2e8f0;padding:6px 10px;border-bottom:1px solid rgba(42,51,71,.2);">${svc}</div>
                `).join('')}
              </div>` : ''}
            </div>` : ''}
          </div>
        </section>

        <!-- Backup / Restore -->
        <section style="display:flex;flex-direction:column;gap:14px;">
          <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Backup &amp; Restore</div>

          <div style="padding:16px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <div style="font-size:13px;color:#e2e8f0;font-weight:500;margin-bottom:12px;">Export encrypted backup</div>
            <form id="cv-export-form" style="display:flex;flex-direction:column;gap:10px;">
              <input type="password" name="exportPw"  placeholder="Export password"          style="font-size:12px;" />
              <input type="password" name="exportConf" placeholder="Confirm export password" style="font-size:12px;" />
              <div id="cv-export-msg" style="font-size:12px;display:none;"></div>
              <button type="submit" style="align-self:flex-start;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">
                Download Backup
              </button>
            </form>
          </div>

          <div style="padding:16px;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;">
            <div style="font-size:13px;color:#e2e8f0;font-weight:500;margin-bottom:12px;">Import encrypted backup</div>
            <form id="cv-import-form" style="display:flex;flex-direction:column;gap:10px;">
              <input type="password" name="importPw" placeholder="Backup password" style="font-size:12px;" />
              <input type="file" id="cv-backup-file" accept=".cvcrypt,.json" style="font-size:12px;" />
              <div id="cv-import-msg" style="font-size:12px;display:none;"></div>
              <button type="submit" style="align-self:flex-start;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">
                Import Backup
              </button>
            </form>
          </div>
        </section>

        <!-- Lock vault -->
        <section>
          <button id="cv-lock-vault" style="font-size:13px;padding:9px 18px;border-radius:8px;
            border:1px solid rgba(192,57,43,.35);background:rgba(192,57,43,.1);color:${ACCENT};cursor:pointer;font-weight:600;">
            Lock Vault
          </button>
        </section>
      </div>
    `;

    // Wire settings selects
    container.querySelector('#cv-autolock')?.addEventListener('change', async e => {
      settings.auto_lock_ms = parseInt(e.target.value, 10);
      await apiFetch('/api/credvault/settings', { method: 'POST', body: JSON.stringify({ auto_lock_ms: settings.auto_lock_ms }) }).catch(() => {});
    });
    container.querySelector('#cv-clipclear')?.addEventListener('change', async e => {
      settings.clipboard_clear_ms = parseInt(e.target.value, 10);
      await apiFetch('/api/credvault/settings', { method: 'POST', body: JSON.stringify({ clipboard_clear_ms: settings.clipboard_clear_ms }) }).catch(() => {});
    });

    // Change password
    container.querySelector('#cv-change-pw-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = container.querySelector('#cv-pw-msg');
      const cur = fd.get('curPw'), nw = fd.get('newPw'), conf = fd.get('confPw');
      if (nw !== conf) { showMsg(msg, 'New passwords do not match.', false); return; }
      if (nw.length < 8) { showMsg(msg, 'New password must be at least 8 characters.', false); return; }
      try {
        await apiFetch('/api/cyberapps/vault/change-password', {
          method: 'POST',
          body: JSON.stringify({ old_password: cur, new_password: nw }),
        });
        showMsg(msg, 'Password changed successfully.', true);
        e.target.reset();
      } catch (err) { showMsg(msg, err.message, false); }
    });

    // Audit
    container.querySelector('#cv-audit-btn')?.addEventListener('click', runAudit);

    // Export
    container.querySelector('#cv-export-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const msg = container.querySelector('#cv-export-msg');
      const pw  = fd.get('exportPw'), conf = fd.get('exportConf');
      if (pw !== conf) { showMsg(msg, 'Export passwords do not match.', false); return; }
      if (!pw) { showMsg(msg, 'Export password required.', false); return; }
      try {
        const creds = await apiFetch('/api/credvault/credentials');
        const payload = JSON.stringify({ password: pw, credentials: creds.credentials, exportedAt: new Date().toISOString() });
        const blob = new Blob([payload], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `credvault-backup-${new Date().toISOString().slice(0,10)}.cvcrypt`;
        a.click(); URL.revokeObjectURL(url);
        showMsg(msg, 'Backup downloaded.', true);
        e.target.reset();
      } catch (err) { showMsg(msg, err.message, false); }
    });

    // Import backup
    container.querySelector('#cv-import-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd   = new FormData(e.target);
      const msg  = container.querySelector('#cv-import-msg');
      const pw   = fd.get('importPw');
      const file = container.querySelector('#cv-backup-file')?.files?.[0];
      if (!pw)   { showMsg(msg, 'Backup password required.', false); return; }
      if (!file) { showMsg(msg, 'Please select a backup file.', false); return; }
      try {
        const text    = await file.text();
        const backup  = JSON.parse(text);
        if (backup.password !== pw) { showMsg(msg, 'Incorrect backup password.', false); return; }
        if (!Array.isArray(backup.credentials)) { showMsg(msg, 'Invalid backup format.', false); return; }
        const res = await apiFetch('/api/credvault/import', {
          method: 'POST',
          body: JSON.stringify({ credentials: backup.credentials }),
        });
        showMsg(msg, `Imported ${res.added} credential(s) successfully.`, true);
        e.target.reset();
      } catch (err) { showMsg(msg, err.message, false); }
    });

    // Lock vault
    container.querySelector('#cv-lock-vault')?.addEventListener('click', async () => {
      await fetch('/api/cyberapps/vault/lock', { method: 'POST' }).catch(() => {});
      location.reload();
    });
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.style.color   = ok ? '#3fb950' : '#f85149';
    el.style.display = 'block';
    if (ok) setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  function auditStatCard(label, value, color) {
    return `
      <div style="background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:8px;padding:12px 14px;">
        <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;font-weight:600;margin-bottom:4px;">${label}</div>
        <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
      </div>
    `;
  }

  loadData();
}
