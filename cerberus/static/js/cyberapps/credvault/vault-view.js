/**
 * CredVault — VaultView
 * Left panel: search/filter/sort list. Right panel: detail card or dashboard.
 * Mirrors VaultView.tsx + VaultDashboard.tsx + CredentialDetailPanel.tsx.
 */

import { scorePassword }    from './password.js';
import { renderGenerator }  from './generator.js';
import { renderCredModal }  from './cred-modal.js';

const ACCENT = '#c0392b';
const MONO   = 'JetBrains Mono, monospace';

const STATUS_COLORS = { active: '#3fb950', rotated: '#d29922', invalid: '#4a5568' };
const CATEGORY_COLORS = {
  SSH: '#f78166', 'API Key': '#a78bfa', Web: '#4a9eff', Database: '#f85149',
  Certificate: '#3fb950', Token: '#e879f9', Other: '#8b949e',
};

// Minimalist fuzzy match
function fuzzyMatch(query, str) {
  if (!query) return true;
  const q = query.toLowerCase(), s = (str || '').toLowerCase();
  if (s.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * @param {HTMLElement} container
 * @param {string} vaultToken
 * @param {() => void} onLockRequest
 */
export function renderVaultView(container, vaultToken, onLockRequest) {
  let credentials = [];
  let selected    = null;
  let searchQuery = '';
  let sortOrder   = null;
  let scopeTab    = 'All';
  let filterSource = null;
  let filterTag    = null;
  let filterStatus = null;
  let breachMap    = {};
  let breachRunning = false;

  const headers = { 'X-Vault-Token': vaultToken };

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...headers, ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadCredentials() {
    try {
      const data = await apiFetch('/api/credvault/credentials');
      credentials = data.credentials || [];
      render();
    } catch (e) {
      console.error('[CredVault] load failed', e);
    }
  }

  async function recordUsage(id) {
    await apiFetch(`/api/credvault/usage/${id}`, { method: 'POST' }).catch(() => {});
    const c = credentials.find(x => x.id === id);
    if (c) { c.lastUsed = new Date().toISOString(); c.useCount = (c.useCount || 0) + 1; }
  }

  async function deleteCredential(id) {
    if (!confirm('Delete this credential?')) return;
    await apiFetch(`/api/credvault/credentials/${id}`, { method: 'DELETE' });
    if (selected?.id === id) selected = null;
    await loadCredentials();
  }

  async function rotateCredential(id) {
    await apiFetch(`/api/credvault/credentials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rotated' }),
    });
    await loadCredentials();
  }

  async function runHibpCheck() {
    const withPw = credentials.filter(c => c.password);
    if (!withPw.length) return;
    breachRunning = true;
    renderList();
    for (const c of withPw) {
      try {
        const res = await apiFetch(`/api/credvault/hibp/${c.id}`);
        breachMap[c.id] = res;
      } catch {
        breachMap[c.id] = { ok: false };
      }
    }
    breachRunning = false;
    render();
  }

  function getFiltered() {
    let result = credentials.filter(c => {
      if (scopeTab === 'Logins' && c.category !== 'SSH' && c.category !== 'Web' && c.type !== 'credential') return false;
      if (scopeTab === 'Cards'  && c.category !== 'API Key' && c.category !== 'Token') return false;
      if (scopeTab === 'Notes'  && c.type !== 'note') return false;
      if (filterTag    && !(c.tags || []).includes(filterTag)) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (filterSource && c.source !== filterSource) return false;
      if (searchQuery) {
        const fields = [c.service, c.username, c.ip || '', c.notes || '', c.source, ...(c.tags || [])];
        if (!fields.some(f => fuzzyMatch(searchQuery, f))) return false;
      }
      return true;
    });
    if (sortOrder === 'alpha')   result = [...result].sort((a, b) => (a.service || '').localeCompare(b.service || ''));
    if (sortOrder === 'newest')  result = [...result].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (sortOrder === 'lastUsed') result = [...result].sort((a, b) => (b.lastUsed ? new Date(b.lastUsed) : 0) - (a.lastUsed ? new Date(a.lastUsed) : 0));
    if (sortOrder === 'strength') result = [...result].sort((a, b) => scorePassword(b.password || '').score - scorePassword(a.password || '').score);
    return result;
  }

  function render() {
    renderList();
    renderRight();
  }

  function renderList() {
    const listEl = container.querySelector('#cv-list-pane');
    if (!listEl) return;
    const filtered = getFiltered();
    const allTags    = [...new Set(credentials.flatMap(c => c.tags || []))].sort();
    const allSources = [...new Set(credentials.map(c => c.source))].sort();
    const breachedCount = Object.values(breachMap).filter(r => r.ok && (r.breachCount || 0) > 0).length;

    listEl.innerHTML = `
      <!-- Header -->
      <div style="padding:8px 12px 4px;display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Vault</span>
        <span style="font-size:10px;color:#4a5568;font-family:${MONO};">${credentials.length}</span>
      </div>

      <!-- Search -->
      <div style="padding:6px 12px;border-bottom:1px solid rgba(42,51,71,.25);">
        <div style="position:relative;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:#4a5568;pointer-events:none;z-index:1;">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="cv-search" type="text" placeholder="Fuzzy search…" value="${searchQuery}"
            style="width:100%;padding-left:28px;font-size:12px;box-sizing:border-box;" />
        </div>
      </div>

      <!-- Scope tabs -->
      <div style="display:flex;gap:2px;padding:6px 10px;border-bottom:1px solid rgba(42,51,71,.25);">
        ${['All','Logins','Cards','Notes'].map(t => `
          <button class="cv-scope" data-tab="${t}" style="
            flex:1;font-size:10px;padding:3px 0;border-radius:20px;border:none;cursor:pointer;
            background:${scopeTab===t ? ACCENT : 'transparent'};
            color:${scopeTab===t ? '#fff' : '#8b949e'};
            font-weight:${scopeTab===t ? 600 : 400};transition:background .15s,color .15s;
          ">${t}</button>
        `).join('')}
      </div>

      <!-- Filters -->
      ${(allSources.length > 0 || allTags.length > 0) ? `
      <div style="padding:4px 10px;display:flex;gap:3px;flex-wrap:wrap;border-bottom:1px solid rgba(42,51,71,.2);">
        ${allSources.slice(0,3).map(s => `
          <button class="cv-filter-src" data-src="${s}" style="
            font-size:10px;padding:2px 7px;border-radius:10px;cursor:pointer;
            border:1px solid ${filterSource===s ? ACCENT : 'rgba(42,51,71,.5)'};
            background:${filterSource===s ? `${ACCENT}22` : 'transparent'};
            color:${filterSource===s ? ACCENT : '#6b7280'};
          ">${s}</button>
        `).join('')}
        ${allTags.slice(0,4).map(t => `
          <button class="cv-filter-tag" data-tag="${t}" style="
            font-size:10px;padding:2px 7px;border-radius:10px;cursor:pointer;
            border:1px solid ${filterTag===t ? '#4a9eff' : 'rgba(42,51,71,.5)'};
            background:${filterTag===t ? '#4a9eff22' : 'transparent'};
            color:${filterTag===t ? '#4a9eff' : '#6b7280'};
          ">#${t}</button>
        `).join('')}
        ${(filterSource || filterTag || filterStatus) ? `
          <button id="cv-reset-filters" style="
            font-size:10px;padding:2px 7px;border-radius:10px;cursor:pointer;
            border:1px solid rgba(192,57,43,.3);background:transparent;color:${ACCENT};
          ">Clear</button>
        ` : ''}
      </div>` : ''}

      <!-- Sort + HIBP + Add row -->
      <div style="display:flex;align-items:center;gap:4px;padding:5px 10px;border-bottom:1px solid rgba(42,51,71,.25);">
        <select id="cv-sort" style="flex:1;font-size:10px;padding:3px 6px;border-radius:5px;
          border:1px solid rgba(42,51,71,.6);background:rgba(13,14,24,.9);color:#8b949e;cursor:pointer;">
          <option value="">Default</option>
          <option value="lastUsed" ${sortOrder==='lastUsed'?'selected':''}>Last Used</option>
          <option value="alpha"    ${sortOrder==='alpha'?'selected':''}>A→Z</option>
          <option value="newest"   ${sortOrder==='newest'?'selected':''}>Newest</option>
          <option value="strength" ${sortOrder==='strength'?'selected':''}>Strength</option>
        </select>
        <button id="cv-hibp-btn" title="HIBP breach check" style="
          font-size:10px;padding:2px 6px;border-radius:5px;cursor:pointer;min-width:52px;
          border:1px solid rgba(42,51,71,.5);background:transparent;
          color:${breachedCount>0?'#f85149':Object.keys(breachMap).length>0?'#3fb950':'#8b949e'};
        ">${breachRunning ? '…' : breachedCount > 0 ? `⚠ ${breachedCount}` : 'HIBP'}</button>
        <button id="cv-add-btn" style="
          font-size:11px;padding:3px 10px;font-weight:600;border-radius:5px;
          background:${ACCENT};border:none;color:#fff;cursor:pointer;
        ">+ Add</button>
      </div>

      <!-- Credential list -->
      <div id="cv-cred-list" style="flex:1;overflow-y:auto;">
        ${filtered.length === 0 ? `
          <div style="padding:24px;text-align:center;color:#4a5568;font-size:12px;">
            ${credentials.length === 0 ? 'No credentials yet — click + Add to start.' : 'No results for current filters.'}
          </div>
        ` : filtered.map(c => {
          const isActive = selected?.id === c.id;
          const breach = breachMap[c.id];
          const catColor = CATEGORY_COLORS[c.category] || '#8b949e';
          return `
            <button class="cv-cred-row" data-id="${c.id}" style="
              width:100%;text-align:left;padding:9px 12px;background:${isActive ? `${ACCENT}14` : 'transparent'};
              border-left:2px solid ${isActive ? ACCENT : 'transparent'};border:none;cursor:pointer;
              border-bottom:1px solid rgba(42,51,71,.2);transition:background .15s;display:flex;flex-direction:column;gap:3px;
            ">
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="font-size:13px;color:#e2e8f0;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${c.service || '—'}
                </span>
                ${breach?.ok && breach.breachCount > 0 ? '<span title="Breached" style="font-size:9px;color:#f85149;">⚠</span>' : ''}
              </div>
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="font-size:11px;color:#8b949e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:${MONO};">
                  ${c.username || ''}
                </span>
                ${c.category ? `<span style="
                  font-size:9px;font-weight:600;padding:1px 5px;border-radius:6px;
                  border:1px solid ${catColor}40;background:${catColor}14;color:${catColor};
                  text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;
                ">${c.category}</span>` : ''}
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;

    // Wire events
    listEl.querySelector('#cv-search')?.addEventListener('input', e => {
      searchQuery = e.target.value;
      renderList();
    });
    listEl.querySelectorAll('.cv-scope').forEach(btn =>
      btn.addEventListener('click', () => { scopeTab = btn.dataset.tab; renderList(); })
    );
    listEl.querySelectorAll('.cv-filter-src').forEach(btn =>
      btn.addEventListener('click', () => { filterSource = filterSource === btn.dataset.src ? null : btn.dataset.src; renderList(); })
    );
    listEl.querySelectorAll('.cv-filter-tag').forEach(btn =>
      btn.addEventListener('click', () => { filterTag = filterTag === btn.dataset.tag ? null : btn.dataset.tag; renderList(); })
    );
    listEl.querySelector('#cv-reset-filters')?.addEventListener('click', () => {
      filterSource = filterTag = filterStatus = null;
      renderList();
    });
    listEl.querySelector('#cv-sort')?.addEventListener('change', e => {
      sortOrder = e.target.value || null;
      renderList();
    });
    listEl.querySelector('#cv-hibp-btn')?.addEventListener('click', () => runHibpCheck());
    listEl.querySelector('#cv-add-btn')?.addEventListener('click', () => openCredModal(null));
    listEl.querySelectorAll('.cv-cred-row').forEach(btn =>
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        selected = selected?.id === id ? null : credentials.find(c => c.id === id) || null;
        render();
      })
    );
  }

  function renderRight() {
    const rightEl = container.querySelector('#cv-right-pane');
    if (!rightEl) return;
    if (selected) {
      renderDetailPanel(rightEl, selected);
    } else {
      renderDashboard(rightEl);
    }
  }

  function renderDashboard(el) {
    const total      = credentials.length;
    const withPw     = credentials.filter(c => c.password);
    const strong     = withPw.filter(c => scorePassword(c.password).level >= 3).length;
    const breached   = Object.values(breachMap).filter(r => r.ok && (r.breachCount || 0) > 0).length;
    const score      = withPw.length ? Math.round(strong / withPw.length * 100) : null;
    const scoreColor = score == null ? '' : score >= 80 ? '#3fb950' : score >= 50 ? '#d29922' : '#f85149';
    const recent     = [...credentials].filter(c => c.lastUsed).sort((a,b) => new Date(b.lastUsed)-new Date(a.lastUsed)).slice(0,5);
    const weakest    = credentials.filter(c => c.password).map(c => ({ c, s: scorePassword(c.password) })).filter(x => x.s.level <= 2).sort((a,b) => a.s.score-b.s.score).slice(0,5);

    const TIPS = [
      { title: 'Use a unique password per service', body: 'Reuse means one breach unlocks every account that shares it.' },
      { title: 'Prefer passphrases for human-typed secrets', body: 'Four random words beat a short jumble of symbols.' },
      { title: 'Rotate API tokens on a schedule', body: 'Mark Token / API Key entries with an expiry note so you remember.' },
      { title: 'Check HIBP after onboarding', body: 'Pull in your imports first, then run the breach check from the toolbar.' },
    ];
    const tip = TIPS[(total + new Date().getDate()) % TIPS.length];

    el.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;gap:18px;padding:18px 22px;overflow-y:auto;">
        <!-- Header -->
        <div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.12em;font-weight:600;margin-bottom:4px;">
            ${total === 0 ? 'Welcome' : 'Vault overview'}
          </div>
          <h2 style="font-size:20px;font-weight:700;color:#e6edf3;margin:0;letter-spacing:-.01em;">
            ${total === 0 ? 'Get started with CredVault' : 'At a glance'}
          </h2>
          ${total === 0 ? '<p style="font-size:12px;color:#8b949e;max-width:460px;margin:4px 0 0;line-height:1.5;">Local-first credential vault. Add your first secret, import an existing list, or generate a strong password to get started.</p>' : ''}
        </div>

        <!-- Stats grid -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;">
          ${statCard('Credentials', total, `${[...new Set(credentials.map(c=>c.category).filter(Boolean))].length} categories`)}
          ${statCard('Strong passwords', withPw.length===0 ? '—' : `${strong}/${withPw.length}`, score==null?'no passwords':score>=80?'looking healthy':score>=50?'room to improve':'needs attention', scoreColor)}
          ${statCard('Breached', breached, breached>0?'rotate these soon':'no known breaches', breached>0?'#f85149':undefined)}
        </div>

        <!-- Quick actions -->
        <section>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:8px;">Quick actions</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
            ${actionCard('cv-dash-add', 'Add credential', 'Login, API key, SSH, note…', true)}
            ${actionCard('cv-dash-gen', 'Generate password', 'Strong, random, copyable')}
            ${actionCard('cv-dash-import', 'Import credentials', 'CSV · JSON')}
            ${actionCard('cv-dash-hibp', breachRunning?'Checking HIBP…':'Check HIBP', 'Scan known breaches')}
          </div>
        </section>

        <!-- Weakest passwords -->
        ${weakest.length > 0 ? `
        <section>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;font-weight:600;">Needs attention</span>
            <span style="font-size:10px;color:#f85149;font-weight:600;">${weakest.length} weak password${weakest.length===1?'':'s'}</span>
          </div>
          <div style="background:rgba(13,14,24,.55);border:1px solid rgba(248,81,73,.25);border-radius:10px;overflow:hidden;">
            ${weakest.map(({c, s}, i) => `
              <button class="cv-weak-row" data-id="${c.id}" style="
                width:100%;padding:10px 14px;display:flex;align-items:center;gap:10px;
                background:transparent;border:none;cursor:pointer;text-align:left;
                border-bottom:${i===weakest.length-1?'none':'1px solid rgba(42,51,71,.25)'};
                transition:background .15s;
              ">
                <div style="width:28px;height:28px;border-radius:6px;background:${s.color}1f;color:${s.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                  ⚠
                </div>
                <div style="display:flex;flex-direction:column;min-width:0;flex:1;">
                  <span style="font-size:12.5px;color:#e2e8f0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.service}</span>
                  <span style="font-size:10.5px;color:#8b949e;font-family:${MONO};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.username}</span>
                </div>
                <span style="font-size:10px;color:${s.color};font-weight:700;text-transform:uppercase;">${s.label}</span>
              </button>
            `).join('')}
          </div>
        </section>` : ''}

        <!-- Recently used -->
        ${recent.length > 0 ? `
        <section>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:8px;">Recently used</div>
          <div style="background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:10px;overflow:hidden;">
            ${recent.map((c, i) => `
              <button class="cv-recent-row" data-id="${c.id}" style="
                width:100%;padding:10px 14px;display:flex;align-items:center;gap:10px;
                background:transparent;border:none;cursor:pointer;text-align:left;
                border-bottom:${i===recent.length-1?'none':'1px solid rgba(42,51,71,.25)'};
                transition:background .15s;
              ">
                <div style="width:28px;height:28px;border-radius:6px;background:${ACCENT}1a;color:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">
                  ${(c.service||'?').slice(0,2).toUpperCase()}
                </div>
                <div style="display:flex;flex-direction:column;min-width:0;flex:1;">
                  <span style="font-size:12.5px;color:#e2e8f0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.service}</span>
                  <span style="font-size:10.5px;color:#8b949e;font-family:${MONO};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.username}</span>
                </div>
                <span style="font-size:10px;color:#4a5568;">${c.lastUsed ? new Date(c.lastUsed).toLocaleDateString() : ''}</span>
              </button>
            `).join('')}
          </div>
        </section>` : ''}

        <!-- Tip -->
        <section style="margin-top:auto;background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:flex-start;">
          <div style="width:28px;height:28px;border-radius:6px;background:rgba(74,158,255,.1);color:#4a9eff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">💡</div>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:11px;color:#4a9eff;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">Security tip</span>
            <span style="font-size:12.5px;color:#e2e8f0;font-weight:600;">${tip.title}</span>
            <span style="font-size:11.5px;color:#8b949e;line-height:1.5;">${tip.body}</span>
          </div>
        </section>
      </div>
    `;

    el.querySelector('#cv-dash-add')?.addEventListener('click',    () => openCredModal(null));
    el.querySelector('#cv-dash-gen')?.addEventListener('click',    () => openGeneratorModal());
    el.querySelector('#cv-dash-import')?.addEventListener('click', () => onLockRequest('import'));
    el.querySelector('#cv-dash-hibp')?.addEventListener('click',   () => runHibpCheck());
    el.querySelectorAll('.cv-weak-row,.cv-recent-row').forEach(btn =>
      btn.addEventListener('click', () => {
        selected = credentials.find(c => c.id === btn.dataset.id) || null;
        render();
      })
    );
  }

  function renderDetailPanel(el, cred) {
    const statusColor = STATUS_COLORS[cred.status] || '#4a5568';
    el.innerHTML = `
      <div style="padding:16px;">
        <div style="background:rgba(22,27,39,.75);border:1px solid rgba(42,51,71,.6);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:14px;">

          <!-- Header -->
          <div style="display:flex;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${cred.service || '—'}</div>
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span style="font-size:12px;color:#8b949e;font-family:${MONO};">${cred.username || ''}</span>
                ${cred.category ? `<span style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:6px;border:1px solid ${ACCENT}40;background:${ACCENT}1a;color:${ACCENT};text-transform:uppercase;letter-spacing:.04em;">${cred.category}</span>` : ''}
                <span style="display:inline-flex;align-items:center;gap:4px;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block;"></span>
                  <span style="font-size:11px;color:${statusColor};">${cred.status}</span>
                </span>
                ${cred.expiresAt ? `<span style="font-size:9px;padding:1px 5px;border-radius:6px;border:1px solid #d2992240;background:#d2992214;color:#d29922;">exp ${new Date(cred.expiresAt).toLocaleDateString()}</span>` : ''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              <button id="cv-detail-edit" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;">Edit</button>
              <button id="cv-detail-delete" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(248,81,73,.3);background:transparent;color:#f85149;cursor:pointer;">Delete</button>
            </div>
          </div>

          <div style="height:1px;background:rgba(42,51,71,.4);"></div>

          <!-- Username -->
          ${copyRow('Username', cred.username || '', 'cv-copy-username', true)}

          <!-- Password -->
          ${cred.password ? `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.07em;">Password</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span id="cv-pw-display" style="flex:1;font-family:${MONO};font-size:13px;color:#e2e8f0;background:rgba(10,10,15,.8);border-radius:5px;padding:5px 9px;border:1px solid rgba(42,51,71,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.2em;">••••••••</span>
              <button id="cv-pw-toggle" style="font-size:11px;padding:4px 9px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;flex-shrink:0;">Show</button>
              <button id="cv-copy-pw" style="font-size:11px;padding:4px 9px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;flex-shrink:0;">Copy</button>
            </div>
            ${pwStrengthBar(cred.password)}
          </div>` : ''}

          <!-- Hash -->
          ${cred.hash ? copyRow(`Hash${cred.hashType ? ` (${cred.hashType.toUpperCase()})` : ''}`, cred.hash, 'cv-copy-hash', true) : ''}

          <!-- Copy toast -->
          <div id="cv-copy-toast" style="display:none;padding:5px 10px;border-radius:6px;background:rgba(63,185,80,.08);border:1px solid rgba(63,185,80,.2);color:#3fb950;font-size:11px;"></div>

          <!-- Secondary fields -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            ${cred.ip ? copyRow('IP / Port', `${cred.ip}${cred.port ? ':' + cred.port : ''}`, 'cv-copy-ip', true) : ''}
            ${cred.protocol ? infoField('Protocol', cred.protocol) : ''}
            ${cred.labName   ? infoField('Lab', cred.labName) : ''}
            ${cred.targetName ? infoField('Target', cred.targetName) : ''}
            ${cred.folder    ? infoField('Folder', cred.folder) : ''}
            ${cred.source    ? infoField('Source', cred.source) : ''}
            ${cred.lastUsed  ? infoField('Last Used', new Date(cred.lastUsed).toLocaleDateString()) : ''}
            ${infoField('Created', new Date(cred.createdAt).toLocaleDateString())}
          </div>

          <!-- Tags -->
          ${cred.tags?.length ? `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.07em;">Tags</span>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              ${cred.tags.map(t => `<span style="font-size:11px;padding:2px 8px;border-radius:10px;border:1px solid rgba(42,51,71,.5);color:#8b949e;">${t}</span>`).join('')}
            </div>
          </div>` : ''}

          <!-- Notes -->
          ${cred.notes ? `
          <div style="display:flex;flex-direction:column;gap:4px;">
            <span style="font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.07em;">${cred.type==='note'?'Content':'Notes'}</span>
            <p style="font-size:12px;color:#8b949e;white-space:pre-wrap;line-height:1.6;margin:0;">${cred.notes}</p>
          </div>` : ''}

          <!-- Mark rotated -->
          ${cred.status !== 'rotated' ? `
          <button id="cv-detail-rotate" style="
            align-self:flex-start;font-size:11px;padding:4px 10px;border-radius:6px;
            border:1px solid rgba(210,153,34,.35);background:transparent;color:#d29922;cursor:pointer;
          ">Mark Rotated</button>` : ''}
        </div>
      </div>
    `;

    // Wire detail panel events
    el.querySelector('#cv-detail-edit')?.addEventListener('click',   () => openCredModal(cred));
    el.querySelector('#cv-detail-delete')?.addEventListener('click', () => deleteCredential(cred.id));
    el.querySelector('#cv-detail-rotate')?.addEventListener('click', () => rotateCredential(cred.id));

    let pwRevealed = false;
    el.querySelector('#cv-pw-toggle')?.addEventListener('click', () => {
      pwRevealed = !pwRevealed;
      const disp = el.querySelector('#cv-pw-display');
      const btn  = el.querySelector('#cv-pw-toggle');
      if (disp) disp.textContent = pwRevealed ? cred.password : '••••••••';
      if (disp) disp.style.letterSpacing = pwRevealed ? '.04em' : '.2em';
      if (btn)  btn.textContent = pwRevealed ? 'Hide' : 'Show';
    });

    el.querySelector('#cv-copy-pw')?.addEventListener('click', () => copyToClip(cred.password, 'Password', el, cred.id));
    el.querySelector('#cv-copy-username')?.addEventListener('click', () => copyToClip(cred.username, 'Username', el, cred.id));
    el.querySelector('#cv-copy-hash')?.addEventListener('click', () => copyToClip(cred.hash, 'Hash', el, cred.id));
    el.querySelector('#cv-copy-ip')?.addEventListener('click', () => copyToClip(cred.ip, 'IP', el, cred.id));
  }

  async function copyToClip(text, label, el, credId) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      await recordUsage(credId);
      const toast = el.querySelector('#cv-copy-toast');
      if (toast) { toast.textContent = `${label} copied`; toast.style.display = 'flex'; }
      setTimeout(() => { if (toast) toast.style.display = 'none'; }, 1500);
    } catch {}
  }

  function openCredModal(existing) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:300;';
    container.appendChild(overlay);
    renderCredModal(overlay, existing, vaultToken, async (data) => {
      try {
        if (existing) {
          await apiFetch(`/api/credvault/credentials/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
          });
        } else {
          await apiFetch('/api/credvault/credentials', {
            method: 'POST',
            body: JSON.stringify(data),
          });
        }
        overlay.remove();
        await loadCredentials();
      } catch (e) { alert('Save failed: ' + e.message); }
    }, () => overlay.remove());
  }

  function openGeneratorModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:300;';
    container.appendChild(overlay);
    renderGenerator(overlay, null, () => overlay.remove());
  }

  // Initial render skeleton
  container.innerHTML = `
    <div style="display:flex;height:100%;overflow:hidden;">
      <div id="cv-list-pane" style="width:260px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid rgba(42,51,71,.35);background:rgba(10,10,15,.7);overflow:hidden;"></div>
      <div id="cv-right-pane" style="flex:1;min-width:0;overflow-y:auto;"></div>
    </div>
  `;

  loadCredentials();
}

// --- helpers ---------------------------------------------------------------

function statCard(label, value, sub, accent) {
  return `
    <div style="background:rgba(13,14,24,.55);border:1px solid rgba(42,51,71,.45);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0;">
      <span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;font-weight:600;">${label}</span>
      <span style="font-size:22px;color:${accent||'#e2e8f0'};font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;">${value}</span>
      ${sub ? `<span style="font-size:10px;color:#4a5568;">${sub}</span>` : ''}
    </div>
  `;
}

function actionCard(id, label, hint, accent = false) {
  return `
    <button id="${id}" style="
      background:${accent ? 'rgba(192,57,43,.08)' : 'rgba(13,14,24,.55)'};
      border:1px solid ${accent ? 'rgba(192,57,43,.35)' : 'rgba(42,51,71,.45)'};
      border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;
      cursor:pointer;text-align:left;transition:border-color .15s,background .15s;
    ">
      <div style="width:32px;height:32px;border-radius:8px;background:${accent?'rgba(192,57,43,.15)':'rgba(192,57,43,.08)'};display:flex;align-items:center;justify-content:center;color:#c0392b;flex-shrink:0;font-size:16px;">
        ${accent ? '+' : '→'}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;">
        <span style="font-size:12.5px;color:#e2e8f0;font-weight:600;">${label}</span>
        ${hint ? `<span style="font-size:10.5px;color:#6b7280;">${hint}</span>` : ''}
      </div>
    </button>
  `;
}

function copyRow(label, value, id, mono = false) {
  return `
    <div style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.07em;">${label}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="flex:1;font-size:13px;color:#e2e8f0;${mono?`font-family:${MONO};`:''}background:rgba(10,10,15,.8);border-radius:5px;padding:5px 9px;border:1px solid rgba(42,51,71,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${value}</span>
        <button id="${id}" style="font-size:11px;padding:4px 9px;border-radius:6px;border:1px solid rgba(42,51,71,.5);background:transparent;color:#8b949e;cursor:pointer;flex-shrink:0;">Copy</button>
      </div>
    </div>
  `;
}

function infoField(label, value) {
  return `
    <div style="display:flex;flex-direction:column;gap:2px;">
      <span style="font-size:10px;font-weight:600;color:#4a5568;text-transform:uppercase;letter-spacing:.07em;">${label}</span>
      <span style="font-size:12px;color:#8b949e;">${value}</span>
    </div>
  `;
}

function pwStrengthBar(pw) {
  const { score, color, label } = scorePassword(pw);
  return `
    <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
      <div style="flex:1;height:3px;border-radius:99px;background:rgba(42,51,71,.5);overflow:hidden;">
        <div style="height:100%;width:${score}%;background:${color};"></div>
      </div>
      <span style="font-size:10px;color:${color};font-weight:600;min-width:60px;text-align:right;">${label}</span>
    </div>
  `;
}
