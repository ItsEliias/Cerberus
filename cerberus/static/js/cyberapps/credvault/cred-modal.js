/**
 * CredVault — Add/Edit Credential Modal
 * Mirrors CredentialModal.tsx + CredentialModalParts.tsx.
 * Fields: type, username, password (+ show/gen), hash/hashType, service, ip/port/protocol,
 *         source, labName, targetName, category, folder, tags, notes, status, expiresAt,
 *         totpSecret, verified. Tabs: Details / History / Notes.
 */
import { generatePassword, scorePassword } from './password.js';

const ACCENT = '#c0392b';
const CATEGORIES = ['SSH', 'API Key', 'Web', 'Database', 'Certificate', 'Token', 'Other'];
const CATEGORY_COLORS = {
  SSH: '#f78166', 'API Key': '#a78bfa', Web: '#4a9eff', Database: '#f85149',
  Certificate: '#3fb950', Token: '#e879f9', Other: '#8b949e',
};
const SOURCE_OPTS = ['Manual', 'ReconDesk import', 'CSV import', '1Password', 'Bitwarden', 'KeePass', 'HTB', 'Other'];
const SERVICE_OPTS = ['Web Panel', 'SSH', 'FTP', 'SMB', 'RDP', 'Telnet', 'VPN', 'API', 'Database', 'Other'];
const HASH_TYPES   = ['ntlm', 'sha256', 'md5', 'bcrypt', 'sha1', 'lm', 'other'];

/**
 * @param {HTMLElement} overlay  Full-screen overlay container
 * @param {object|null} existing  Existing credential to edit, or null for add
 * @param {string} vaultToken
 * @param {(data: object) => void} onSave
 * @param {() => void} onClose
 */
export function renderCredModal(overlay, existing, vaultToken, onSave, onClose) {
  let type       = existing?.type || 'credential';
  let activeTab  = 'details';
  let category   = existing?.category || '';
  let tags       = existing?.tags ? [...existing.tags] : [];
  let showPw     = false;
  let genOpts    = { length: 20, upper: true, lower: true, digits: true, symbols: true, noAmbiguous: true };

  function build() {
    overlay.innerHTML = `
      <div style="
        position:fixed;inset:0;z-index:300;background:rgba(7,8,15,.8);
        backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
        display:flex;align-items:center;justify-content:center;
      " id="cv-modal-backdrop">
        <div style="
          background:rgba(13,14,24,.95);border:1px solid rgba(192,57,43,.12);
          border-radius:12px;width:540px;max-height:90vh;overflow-y:auto;
          padding:24px 28px;display:flex;flex-direction:column;gap:16px;
          box-shadow:0 24px 64px rgba(0,0,0,.6);
        " id="cv-modal-box">

          <!-- Header -->
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:15px;color:#e2e8f0;">
              ${existing ? 'Edit' : 'Add'} ${type==='note' ? 'Secure Note' : 'Credential'}
            </span>
            <div style="display:flex;gap:6px;">
              <button id="cv-modal-type-toggle" style="font-size:11px;padding:3px 9px;border-radius:4px;cursor:pointer;
                border:1px solid var(--border,rgba(42,51,71,.5));background:transparent;
                color:${type==='note' ? ACCENT : '#8b949e'};">
                ${type==='note' ? 'Note' : 'Credential'}
              </button>
              <button id="cv-modal-cancel" style="font-size:12px;padding:3px 10px;border-radius:4px;cursor:pointer;
                border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;">Cancel</button>
            </div>
          </div>

          <!-- Tabs -->
          <div style="display:flex;gap:2px;border-bottom:1px solid rgba(42,51,71,.4);padding-bottom:0;">
            ${['details','history','notes'].map(tab => `
              <button class="cv-modal-tab" data-tab="${tab}" style="
                font-size:12px;padding:6px 14px;border-radius:6px 6px 0 0;border:none;cursor:pointer;
                font-weight:${activeTab===tab?600:400};
                background:${activeTab===tab?'rgba(192,57,43,.1)':'transparent'};
                color:${activeTab===tab?ACCENT:'#8b949e'};
                border-bottom:${activeTab===tab?`2px solid ${ACCENT}`:'2px solid transparent'};
                margin-bottom:-1px;transition:color .15s,background .15s;
              ">${tab.charAt(0).toUpperCase()+tab.slice(1)}${tab==='history'&&existing?'<span style="margin-left:5px;font-size:9px;background:rgba(192,57,43,.15);color:'+ACCENT+';border-radius:8px;padding:1px 5px;">5</span>':''}</button>
            `).join('')}
          </div>

          <!-- Tab content -->
          <div id="cv-modal-tab-content">
            ${renderTabContent()}
          </div>
        </div>
      </div>
    `;

    wire();
  }

  function renderTabContent() {
    if (activeTab === 'history') return renderHistoryTab();
    if (activeTab === 'notes')   return renderNotesTab();
    return renderDetailsTab();
  }

  function renderHistoryTab() {
    if (!existing) return `<div style="font-size:12px;color:#484f58;text-align:center;padding:24px 0;">No history yet — save first</div>`;
    const now = Date.now();
    const mock = [
      { time: now - 3600000*2,   action: 'Password copied' },
      { time: now - 86400000,    action: 'Credential viewed' },
      { time: now - 86400000*3,  action: 'Password copied' },
      { time: now - 86400000*7,  action: 'Credential edited' },
      { time: now - 86400000*14, action: 'Credential created' },
    ];
    return mock.map((entry, i) => {
      const d = new Date(entry.time);
      const daysAgo = Math.floor((Date.now()-entry.time)/86400000);
      const label = daysAgo===0?'Today':daysAgo===1?'Yesterday':`${daysAgo}d ago`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;background:rgba(42,51,71,.12);border:1px solid rgba(42,51,71,.2);margin-bottom:6px;">
        <span style="width:6px;height:6px;border-radius:50%;background:#484f58;flex-shrink:0;"></span>
        <span style="flex:1;font-size:12px;color:#c9d1d9;">${entry.action}</span>
        <span style="font-size:10px;color:#484f58;font-family:monospace;">${label} · ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
      </div>`;
    }).join('');
  }

  function renderNotesTab() {
    const notesVal = existing?.notes || '';
    return `
      <label style="font-size:11px;color:#8b949e;">Secure Notes</label>
      <textarea id="cv-extra-notes" placeholder="Add secure notes for this credential…"
        style="resize:vertical;min-height:140px;margin-top:8px;">${notesVal}</textarea>
      <button id="cv-save-notes" style="
        align-self:flex-end;margin-top:8px;font-size:12px;padding:5px 14px;
        background:${ACCENT};border:none;color:#fff;border-radius:6px;cursor:pointer;
      ">Save Notes</button>
    `;
  }

  function renderDetailsTab() {
    const e = existing || {};
    const pw = e.password || '';
    const strength = scorePassword(pw);

    return `
      <form id="cv-modal-form" style="display:flex;flex-direction:column;gap:14px;">

        <!-- Category + Folder -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;font-weight:600;display:block;margin-bottom:6px;">Category</label>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${CATEGORIES.map(cat => `
                <button type="button" class="cv-cat-btn" data-cat="${cat}" style="
                  font-size:10px;padding:2px 8px;border-radius:10px;cursor:pointer;
                  border:1px solid ${category===cat ? CATEGORY_COLORS[cat] : 'rgba(42,51,71,.5)'};
                  background:${category===cat ? CATEGORY_COLORS[cat]+'20' : 'transparent'};
                  color:${category===cat ? CATEGORY_COLORS[cat] : '#8b949e'};
                  font-weight:${category===cat?600:400};
                ">${cat}</button>
              `).join('')}
            </div>
          </div>
          <div>
            <label style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.07em;font-weight:600;display:block;margin-bottom:6px;">Folder</label>
            <input name="folder" value="${e.folder||''}" placeholder="e.g. HTB / Work" style="font-size:12px;" />
          </div>
        </div>

        <!-- Identity -->
        <div style="font-size:9px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.1em;">Identity</div>

        ${type === 'credential' ? `
        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Username *</label>
          <input name="username" value="${e.username||''}" placeholder="admin" required autofocus style="font-size:12px;" />
        </div>

        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Password</label>
          <div style="display:flex;gap:6px;">
            <div style="flex:1;position:relative;">
              <input id="cv-modal-pw" name="password" type="${showPw?'text':'password'}" value="${e.password||''}"
                placeholder="Cleartext password" style="width:100%;font-size:12px;padding-right:44px;box-sizing:border-box;" />
              <button type="button" id="cv-modal-pw-toggle" style="
                position:absolute;right:8px;top:50%;transform:translateY(-50%);
                background:none;border:none;cursor:pointer;font-size:10px;color:#8b949e;">
                ${showPw?'Hide':'Show'}
              </button>
            </div>
            <button type="button" id="cv-inline-gen" style="font-size:11px;padding:4px 9px;border-radius:6px;
              border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;flex-shrink:0;">Gen</button>
          </div>
          <!-- Strength -->
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
            <div style="flex:1;height:3px;border-radius:99px;background:rgba(42,51,71,.45);overflow:hidden;">
              <div id="cv-pw-strength-bar" style="height:100%;width:${strength.score}%;background:${strength.color};"></div>
            </div>
            <span id="cv-pw-strength-lbl" style="font-size:10px;color:${strength.color};font-weight:600;min-width:60px;text-align:right;">${strength.label}</span>
          </div>
          <!-- Inline generator -->
          <div id="cv-inline-gen-panel" style="display:none;margin-top:8px;"></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Hash</label>
            <input name="hash" value="${e.hash||''}" placeholder="NTLM / SHA256 / MD5…" style="font-family:monospace;font-size:12px;" />
          </div>
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Hash Type</label>
            <select name="hashType" style="font-size:12px;">
              <option value="">— none —</option>
              ${HASH_TYPES.map(h => `<option value="${h}" ${e.hashType===h?'selected':''}>${h.toUpperCase()}</option>`).join('')}
            </select>
          </div>
        </div>

        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">TOTP Secret</label>
          <input name="totpSecret" value="${e.totpSecret||''}" placeholder="Base32 TOTP secret (optional)" style="font-family:monospace;font-size:12px;" />
        </div>

        <!-- Context -->
        <div style="font-size:9px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.1em;">Context</div>

        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Service *</label>
          <select name="service" style="font-size:12px;">
            ${SERVICE_OPTS.map(s => `<option value="${s}" ${(e.service||'Web Panel')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>

        <div style="padding:10px 12px;border-radius:6px;background:rgba(42,51,71,.12);border:1px solid rgba(42,51,71,.3);">
          <div style="font-size:9px;font-weight:600;color:#484f58;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Network</div>
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">IP</label>
            <input name="ip" value="${e.ip||''}" placeholder="10.10.10.1" style="font-size:12px;" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
            <div>
              <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Port</label>
              <input name="port" type="number" value="${e.port||''}" placeholder="80" min="1" max="65535" style="font-size:12px;" />
            </div>
            <div>
              <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Protocol</label>
              <input name="protocol" value="${e.protocol||''}" placeholder="tcp" style="font-size:12px;" />
            </div>
          </div>
        </div>
        ` : `
        <!-- Secure note -->
        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Title *</label>
          <input name="service" value="${e.service||''}" placeholder="Note title" required autofocus style="font-size:12px;" />
        </div>
        `}

        <!-- Origin -->
        <div style="font-size:9px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.1em;">Origin</div>
        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Source</label>
          <select name="source" style="font-size:12px;">
            ${SOURCE_OPTS.map(s => `<option value="${s}" ${(e.source||'Manual')===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>

        ${type === 'credential' ? `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Lab Name</label>
            <input name="labName" value="${e.labName||''}" placeholder="Pickle Rick" style="font-size:12px;" />
          </div>
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Target Name</label>
            <input name="targetName" value="${e.targetName||''}" placeholder="Web server" style="font-size:12px;" />
          </div>
        </div>` : ''}

        <!-- Metadata -->
        <div style="font-size:9px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.1em;">Metadata</div>
        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Tags (comma-separated)</label>
          <input name="tags" value="${tags.join(', ')}" placeholder="htb, web, recon…" style="font-size:12px;" />
        </div>
        <div>
          <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Notes</label>
          <textarea name="notes" placeholder="${type==='note'?'Secure note content…':'Additional context…'}"
            style="resize:vertical;min-height:${type==='note'?100:56}px;font-size:12px;">${e.notes||''}</textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Status</label>
            <select name="status" style="font-size:12px;">
              ${['active','rotated','invalid'].map(s => `<option value="${s}" ${(e.status||'active')===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:4px;">Expires</label>
            <input name="expiresAt" type="date" value="${e.expiresAt?e.expiresAt.slice(0,10):''}" style="color-scheme:dark;font-size:12px;" />
          </div>
        </div>

        ${type === 'credential' ? `
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="cv-verified" name="verified" ${e.verified?'checked':''} style="width:14px;height:14px;cursor:pointer;" />
          <label for="cv-verified" style="font-size:12px;color:#8b949e;cursor:pointer;">Verified (successfully used)</label>
        </div>` : ''}

        <div id="cv-modal-err" style="font-size:12px;color:#f85149;display:none;"></div>

        <button type="submit" style="
          align-self:flex-end;margin-top:4px;border-radius:8px;padding:7px 16px;font-size:13px;
          background:${ACCENT};border:none;color:#fff;cursor:pointer;font-weight:600;
        ">
          ${existing ? 'Save Changes' : type==='note' ? 'Add Note' : 'Add Credential'}
        </button>
      </form>
    `;
  }

  function wire() {
    overlay.querySelector('#cv-modal-backdrop')?.addEventListener('click', e => {
      if (e.target === overlay.querySelector('#cv-modal-backdrop')) onClose();
    });
    overlay.querySelector('#cv-modal-cancel')?.addEventListener('click', onClose);

    overlay.querySelector('#cv-modal-type-toggle')?.addEventListener('click', () => {
      type = type === 'note' ? 'credential' : 'note';
      build();
    });

    overlay.querySelectorAll('.cv-modal-tab').forEach(btn =>
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; rebuildContent(); })
    );

    wireDetailsTab();
  }

  function rebuildContent() {
    const tc = overlay.querySelector('#cv-modal-tab-content');
    if (tc) tc.innerHTML = renderTabContent();
    wireDetailsTab();
  }

  function wireDetailsTab() {
    overlay.querySelectorAll('.cv-cat-btn').forEach(btn =>
      btn.addEventListener('click', () => { category = category === btn.dataset.cat ? '' : btn.dataset.cat; rebuildContent(); })
    );

    const pwInput = overlay.querySelector('#cv-modal-pw');
    const strengthBar = overlay.querySelector('#cv-pw-strength-bar');
    const strengthLbl = overlay.querySelector('#cv-pw-strength-lbl');
    if (pwInput) {
      pwInput.addEventListener('input', e => {
        const { score, color, label } = scorePassword(e.target.value);
        if (strengthBar) { strengthBar.style.width = score + '%'; strengthBar.style.background = color; }
        if (strengthLbl) { strengthLbl.textContent = label; strengthLbl.style.color = color; }
      });
    }

    overlay.querySelector('#cv-modal-pw-toggle')?.addEventListener('click', () => {
      showPw = !showPw;
      rebuildContent();
    });

    overlay.querySelector('#cv-inline-gen')?.addEventListener('click', () => {
      const panel = overlay.querySelector('#cv-inline-gen-panel');
      if (!panel) return;
      const visible = panel.style.display !== 'none';
      if (visible) { panel.style.display = 'none'; return; }
      panel.style.display = 'block';
      renderInlineGenerator(panel, (pw) => {
        const inp = overlay.querySelector('#cv-modal-pw');
        if (inp) { inp.value = pw; inp.dispatchEvent(new Event('input')); }
        panel.style.display = 'none';
      });
    });

    overlay.querySelector('#cv-save-notes')?.addEventListener('click', () => {
      const val = overlay.querySelector('#cv-extra-notes')?.value || '';
      if (existing) existing.notes = val;
      activeTab = 'details';
      rebuildContent();
    });

    overlay.querySelector('#cv-modal-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = overlay.querySelector('#cv-modal-err');
      const username = fd.get('username')?.trim() || '';
      const service  = fd.get('service')?.trim()  || '';
      if (type === 'credential' && !username) {
        if (errEl) { errEl.textContent = 'Username is required.'; errEl.style.display = 'block'; }
        return;
      }
      if (!service) {
        if (errEl) { errEl.textContent = 'Service / title is required.'; errEl.style.display = 'block'; }
        return;
      }
      const rawTags = (fd.get('tags') || '').toString().split(',').map(t => t.trim()).filter(Boolean);
      const portNum = parseInt(fd.get('port') || '', 10);
      const data = {
        type,
        username:   type==='credential' ? username : '—',
        password:   type==='credential' ? (fd.get('password')?.toString() || undefined) : undefined,
        hash:       type==='credential' ? (fd.get('hash')?.toString() || undefined) : undefined,
        hashType:   type==='credential' ? (fd.get('hashType')?.toString() || undefined) : undefined,
        totpSecret: type==='credential' ? (fd.get('totpSecret')?.toString() || undefined) : undefined,
        service,
        ip:         fd.get('ip')?.toString() || undefined,
        port:       isNaN(portNum) ? undefined : portNum,
        protocol:   fd.get('protocol')?.toString() || undefined,
        source:     fd.get('source')?.toString() || 'Manual',
        labName:    fd.get('labName')?.toString() || undefined,
        targetName: fd.get('targetName')?.toString() || undefined,
        category:   category || undefined,
        folder:     fd.get('folder')?.toString() || undefined,
        tags:       rawTags,
        notes:      fd.get('notes')?.toString() || undefined,
        status:     fd.get('status')?.toString() || 'active',
        expiresAt:  fd.get('expiresAt') ? new Date(fd.get('expiresAt').toString()).toISOString() : undefined,
        verified:   overlay.querySelector('#cv-verified')?.checked ?? false,
      };
      onSave(data);
    });
  }

  function renderInlineGenerator(panel, onFill) {
    let opts = { length: 20, upper: true, lower: true, digits: true, symbols: true, noAmbiguous: true };
    function regen() {
      const pw = generatePassword(opts);
      const prev = panel.querySelector('#cv-gen-preview');
      if (prev) prev.textContent = pw;
    }
    panel.innerHTML = `
      <div style="background:rgba(13,14,24,.98);border:1px solid rgba(42,51,71,.6);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;background:rgba(7,8,15,.85);border:1px solid rgba(42,51,71,.55);border-radius:8px;padding:10px 12px;">
          <span id="cv-gen-preview" style="flex:1;font-family:monospace;font-size:13px;color:#e6edf3;word-break:break-all;user-select:all;">—</span>
          <button type="button" id="cv-gen-regen" style="background:transparent;border:1px solid rgba(42,51,71,.5);color:#8b949e;border-radius:5px;padding:4px 6px;cursor:pointer;">↻</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:10px;color:#6b7280;font-weight:600;white-space:nowrap;">Length</label>
          <input type="range" id="cv-gen-len" min="8" max="64" step="1" value="20" style="flex:1;accent-color:${ACCENT};" />
          <span id="cv-gen-len-val" style="font-size:11px;color:#e6edf3;font-family:monospace;min-width:20px;">20</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${[['upper','A-Z'],['lower','a-z'],['digits','0-9'],['symbols','!@#$'],['noAmbiguous','No ambiguous']].map(([k,lbl]) => `
            <button type="button" class="cv-gen-toggle" data-key="${k}" style="
              font-size:10px;padding:3px 9px;border-radius:6px;cursor:pointer;transition:.15s;
              border:1px solid ${opts[k]?'rgba(192,57,43,.35)':'rgba(42,51,71,.4)'};
              background:${opts[k]?'rgba(192,57,43,.1)':'transparent'};
              color:${opts[k]?'#e6edf3':'#8b949e'};
            ">${lbl}</button>
          `).join('')}
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" id="cv-gen-fill" style="flex:1;padding:7px;border-radius:7px;font-size:12px;font-weight:600;background:${ACCENT};border:none;color:#fff;cursor:pointer;">Use this password</button>
        </div>
      </div>
    `;
    regen();
    panel.querySelector('#cv-gen-regen').addEventListener('click', regen);
    panel.querySelector('#cv-gen-len').addEventListener('input', e => {
      opts.length = parseInt(e.target.value, 10);
      panel.querySelector('#cv-gen-len-val').textContent = opts.length;
      regen();
    });
    panel.querySelectorAll('.cv-gen-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        opts[btn.dataset.key] = !opts[btn.dataset.key];
        btn.style.border = opts[btn.dataset.key]?'1px solid rgba(192,57,43,.35)':'1px solid rgba(42,51,71,.4)';
        btn.style.background = opts[btn.dataset.key]?'rgba(192,57,43,.1)':'transparent';
        btn.style.color = opts[btn.dataset.key]?'#e6edf3':'#8b949e';
        regen();
      })
    );
    panel.querySelector('#cv-gen-fill').addEventListener('click', () => {
      const pw = panel.querySelector('#cv-gen-preview').textContent;
      if (pw && pw !== '—') onFill(pw);
    });
  }

  build();
}
