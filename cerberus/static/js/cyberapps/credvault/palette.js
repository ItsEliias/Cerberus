/**
 * CredVault — Cmd+K Command Palette
 * Mirrors CommandPalette.tsx. Actions: add, generate, HIBP, lock,
 * navigate vault/import/settings, copy last-used username/password,
 * fuzzy-open credential by service name.
 */

const ACCENT = '#c0392b';

/**
 * @param {HTMLElement} overlay
 * @param {object[]} credentials
 * @param {{ navigate: (view: string) => void, openAdd: () => void, openGen: () => void, runHibp: () => void, lock: () => void }} actions
 * @param {() => void} onClose
 */
export function renderPalette(overlay, credentials, actions, onClose) {
  let query    = '';
  let activeIdx = 0;

  const lastUsed = [...credentials].filter(c => c.lastUsed).sort((a,b) => new Date(b.lastUsed)-new Date(a.lastUsed))[0] || null;

  function buildCommands() {
    const base = [
      { id:'cv:add',      label:'Add credential',    hint:'Create new',       group:'Action',   accent:ACCENT,    run:()=>{actions.openAdd();onClose();} },
      { id:'cv:generate', label:'Generate password',  hint:'Open generator',   group:'Action',   accent:ACCENT,    run:()=>{actions.openGen();onClose();} },
      { id:'cv:hibp',     label:'Run HIBP check',     hint:'Scan for breaches',group:'Action',   accent:'#f85149', run:()=>{actions.runHibp();onClose();} },
      { id:'cv:lock',     label:'Lock vault',          hint:'Require password', group:'Vault',    accent:'#d29922', run:async()=>{await actions.lock();onClose();} },
      { id:'nav:vault',   label:'Open Vault',          hint:'View credentials', group:'Navigate', accent:'#3fb950', run:()=>{actions.navigate('vault');onClose();} },
      { id:'nav:import',  label:'Open Import',         hint:'Bring data in',    group:'Navigate', accent:'#3fb950', run:()=>{actions.navigate('import');onClose();} },
      { id:'nav:settings',label:'Open Settings',       hint:'Preferences',      group:'Navigate', accent:'#3fb950', run:()=>{actions.navigate('settings');onClose();} },
    ];
    if (lastUsed?.username) base.push({ id:'cv:copy-user',label:`Copy username — ${lastUsed.service}`,hint:'Last used',group:'Credential',accent:'#4a9eff',run:async()=>{await navigator.clipboard.writeText(lastUsed.username).catch(()=>{});onClose();} });
    if (lastUsed?.password) base.push({ id:'cv:copy-pw',label:`Copy password — ${lastUsed.service}`,hint:'Last used',group:'Credential',accent:'#a78bfa',run:async()=>{await navigator.clipboard.writeText(lastUsed.password).catch(()=>{});onClose();} });
    if (query.trim()) {
      const q = query.toLowerCase();
      const scored = credentials.map(c => ({ c, s: fuzzyScore(q, c.service||'') })).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,5);
      for (const {c} of scored) {
        base.push({ id:`open:${c.id}`, label:`Open: ${c.service}`, hint:c.username||c.category||'', group:'Credential', accent:ACCENT, run:()=>{actions.navigate('vault');onClose();} });
      }
    }
    return base;
  }

  function fuzzyScore(q, t) {
    const target = (t||'').toLowerCase();
    if (target.includes(q)) return 100 - target.indexOf(q);
    let ti=0, matched=0;
    for (const ch of q) { const i=target.indexOf(ch,ti); if(i===-1)return 0; matched++;ti=i+1; }
    return matched;
  }

  function getFiltered(cmds) {
    if (!query) return cmds;
    return cmds.map(c => {
      if (c.id.startsWith('open:')) return { c, score: 1000 };
      const text = [c.label, c.hint, ...(c.keywords||[])].filter(Boolean).join(' ');
      return { c, score: fuzzyScore(query, text) };
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).map(x=>x.c);
  }

  function render() {
    const cmds    = buildCommands();
    const filtered = getFiltered(cmds);
    if (activeIdx >= filtered.length) activeIdx = 0;
    const groups = { Action:[], Credential:[], Navigate:[], Vault:[] };
    for (const c of filtered) groups[c.group]?.push(c);

    overlay.innerHTML = `
      <div id="cv-pal-backdrop" style="
        position:fixed;inset:0;z-index:400;background:rgba(5,6,12,.55);
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
        display:flex;align-items:flex-start;justify-content:center;padding-top:80px;
      ">
        <div onclick="event.stopPropagation()" style="
          width:480px;max-width:calc(100vw - 32px);
          background:rgba(13,14,24,.98);border:1px solid ${ACCENT}33;
          border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.55),0 0 0 1px ${ACCENT}1a;
          overflow:hidden;display:flex;flex-direction:column;
        ">
          <!-- Input -->
          <div style="padding:12px 14px;border-bottom:1px solid rgba(42,51,71,.5);display:flex;align-items:center;gap:10px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input id="cv-pal-input" value="${query}" placeholder="Search actions or credentials…"
              style="flex:1;background:transparent;border:none;outline:none;color:#e6edf3;font-size:14px;font-family:inherit;" />
            <span style="font-size:9px;color:#4a5568;font-family:monospace;border:1px solid rgba(42,51,71,.6);padding:1px 5px;border-radius:4px;">⌘K</span>
          </div>

          <!-- Results -->
          <div style="max-height:380px;overflow-y:auto;padding:6px 4px;">
            ${filtered.length === 0 ? `<div style="padding:24px;text-align:center;color:#4a5568;font-size:12px;">No matches</div>` : ''}
            ${['Action','Credential','Navigate','Vault'].map(group =>
              groups[group].length > 0 ? `
              <div style="margin-bottom:4px;">
                <div style="padding:6px 12px 4px;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#4a5568;">${group}</div>
                ${groups[group].map(c => {
                  const flatIdx = filtered.indexOf(c);
                  const active  = flatIdx === activeIdx;
                  return `
                    <button class="cv-pal-cmd" data-idx="${flatIdx}" style="
                      width:100%;text-align:left;padding:7px 12px;display:flex;align-items:center;gap:10px;
                      background:${active?`${ACCENT}14`:'transparent'};border:none;cursor:pointer;
                      border-left:2px solid ${active?ACCENT:'transparent'};
                    ">
                      <span style="width:7px;height:7px;border-radius:99px;background:${c.accent};flex-shrink:0;box-shadow:0 0 6px ${c.accent}60;"></span>
                      <div style="flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;">
                        <span style="font-size:12.5px;color:#e6edf3;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.label}</span>
                        ${c.hint ? `<span style="font-size:10px;color:#6b7280;">${c.hint}</span>` : ''}
                      </div>
                      ${active ? `<span style="font-size:9px;color:${ACCENT};font-family:monospace;">↵</span>` : ''}
                    </button>
                  `;
                }).join('')}
              </div>` : ''
            ).join('')}
          </div>

          <!-- Footer -->
          <div style="padding:8px 12px;border-top:1px solid rgba(42,51,71,.5);display:flex;align-items:center;justify-content:space-between;font-size:10px;font-family:monospace;color:#4a5568;">
            <span>↑↓ navigate · ↵ run · ⎋ close</span>
            <span>${filtered.length} command${filtered.length===1?'':'s'}</span>
          </div>
        </div>
      </div>
    `;

    overlay.querySelector('#cv-pal-backdrop').addEventListener('click', onClose);
    const input = overlay.querySelector('#cv-pal-input');
    input.focus();
    input.addEventListener('input', e => { query = e.target.value; activeIdx = 0; render(); });

    overlay.querySelectorAll('.cv-pal-cmd').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        getFiltered(buildCommands())[idx]?.run();
      })
    );

    overlay.querySelector('#cv-pal-backdrop').addEventListener('keydown', e => {
      const filtered2 = getFiltered(buildCommands());
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(filtered2.length-1, activeIdx+1); render(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(0, activeIdx-1); render(); }
      else if (e.key === 'Enter')     { e.preventDefault(); filtered2[activeIdx]?.run(); }
    });
  }

  render();
}
