'use strict';

/* Cerberus · Recon — renderer.
   Scope + sessions persist in userData; findings are folder-backed and live
   (the main process watches .cerberus/findings and pushes updates). */

const api = window.cerberus;
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

const state = {
  scope: { targets: [] },
  sessions: { sessions: [] },
  findings: [],
  workdir: null,
  expanded: new Set(),   // finding ids showing their repro body
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtTime = (ts) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── Tabs ──────────────────────────────────────────────────────────────
function switchView(name) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $$('.view-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$$('.nav-item').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });

// ── Scope ─────────────────────────────────────────────────────────────
function renderScope() {
  const list = $('#scope-list'); list.innerHTML = '';
  const t = state.scope.targets;
  if (!t.length) list.appendChild(el('div', 'empty', 'No targets yet. Add the assets you are authorized to test.'));
  t.forEach((tg) => list.appendChild(renderTarget(tg)));
  const inN = t.filter((x) => x.inScope).length;
  $('#scope-count').textContent = t.length;
  $('#scope-in').textContent = inN;
  $('#nav-scope').textContent = t.length;
}

function renderTarget(tg) {
  const item = el('div', 'scope-item');
  const row = el('div', 'scope-row');
  const dot = el('span', 'dot ' + (tg.inScope ? 'in' : 'out'));
  dot.title = tg.inScope ? 'In scope — click to toggle' : 'Out of scope — click to toggle';
  dot.onclick = () => { tg.inScope = !tg.inScope; persistScope(); };
  const host = el('span', 'host', tg.host);
  const tag = el('span', 'tag', tg.inScope ? 'in scope' : 'out');
  const edit = el('button', 'ed', '✎'); edit.title = 'Edit target + notes';
  edit.onclick = () => openTargetModal(tg);
  const rm = el('button', 'rm', '✕');
  rm.onclick = () => { state.scope.targets = state.scope.targets.filter((x) => x !== tg); persistScope(); };
  row.append(dot, host, tag, edit, rm);
  item.append(row);
  if (tg.notes && tg.notes.trim()) {
    const notes = el('div', 'scope-notes');
    notes.append(el('div', 'note-tag', 'testing'));
    notes.append(el('div', null, tg.notes.trim()));
    item.append(notes);
  }
  if (tg.checklist && tg.checklist.trim()) {
    const chk = el('div', 'scope-check');
    chk.append(el('div', 'note-tag', 'submission · prod'));
    chk.append(el('div', null, tg.checklist.trim()));
    item.append(chk);
  }
  return item;
}
function persistScope() { api.saveScope(state.scope).then(renderScope); }

function openTargetModal(existing) {
  const notesPh = 'Test URL, scope boundary, goal, out-of-scope classes…';
  const checkPh = 'Your prod steps before filing a report…';
  openModal(`
  <h3>${existing ? 'Edit target' : 'Add target'}</h3>
  <label>Host / domain / asset</label>
  <input id="m-host" placeholder="app.example.com" />
  <label style="text-transform:none;letter-spacing:0"><input type="checkbox" id="m-inscope" checked style="width:auto;margin-right:6px" />In scope</label>
  <label>Testing notes <span class="opt">what the agent works from</span></label>
  <textarea id="m-notes" rows="4" placeholder="${notesPh.replace(/\n/g, '&#10;')}"></textarea>
  <label>Submission checklist <span class="opt">prod · human-only</span></label>
  <textarea id="m-check" rows="4" placeholder="${checkPh.replace(/\n/g, '&#10;')}"></textarea>
  <div class="row"><button data-cancel>Cancel</button><button class="primary" data-submit>${existing ? 'Save' : 'Add'}</button></div>`, (m) => {
    const host = m.querySelector('#m-host').value.trim();
    if (!host) return false;
    const inScope = m.querySelector('#m-inscope').checked;
    const notes = m.querySelector('#m-notes').value;
    const checklist = m.querySelector('#m-check').value;
    if (existing) { existing.host = host; existing.inScope = inScope; existing.notes = notes; existing.checklist = checklist; }
    else state.scope.targets.push({ id: uid(), host, inScope, notes, checklist });
    persistScope();
  });
  if (existing) {
    $('#m-host').value = existing.host || '';
    $('#m-inscope').checked = existing.inScope !== false;
    $('#m-notes').value = existing.notes || '';
    $('#m-check').value = existing.checklist || '';
  }
}

// ── Sessions ──────────────────────────────────────────────────────────
function renderSessions() {
  const list = $('#session-list'); list.innerHTML = '';
  const items = state.sessions.sessions.slice().sort((a, b) => b.startedAt - a.startedAt);
  if (!items.length) list.appendChild(el('div', 'empty', 'No sessions yet.'));
  items.forEach((s) => {
    const row = el('div', 'session-item');
    const dot = el('span', 'dot ' + (s.endedAt ? 'out' : 'live'));
    const meta = el('div', 'meta');
    meta.append(el('div', 't', fmtTime(s.startedAt)));
    meta.append(el('div', 's', (s.workdir || '~') + (s.endedAt ? ` · ended ${fmtTime(s.endedAt)}` : ' · live')));
    row.append(dot, meta);
    list.appendChild(row);
  });
  $('#nav-sessions').textContent = state.sessions.sessions.length;
}
function persistSessions() { api.saveSessions(state.sessions).then(renderSessions); }

// ── Findings (folder-backed, live) ─────────────────────────────────────
function renderFindings() {
  const list = $('#findings-list'); list.innerHTML = '';
  const items = state.findings.slice().sort((a, b) =>
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (b.ts || 0) - (a.ts || 0));
  if (!items.length) {
    list.appendChild(el('div', 'empty', 'No findings yet. Recon surfaces the attack surface — validated logic bugs land here, and anything the agent writes to the findings folder shows up automatically.'));
  }
  items.forEach((f) => list.appendChild(renderFindingCard(f)));
  $('#finding-total').textContent = `${items.length} logged`;
  $('#nav-findings').textContent = items.length;
}

function renderFindingCard(f) {
  const card = el('div', 'finding ' + (f.severity || 'info'));

  const top = el('div', 'finding-top');
  const badge = el('span', 'badge ' + (f.severity || 'info'), f.severity || 'info');
  const mid = el('div');
  mid.append(el('div', 'title', f.title || 'Untitled'));
  mid.append(el('div', 'sub', `${f.target || 'unscoped'} · ${f.ts ? fmtTime(f.ts) : ''}${f.note ? ' · ' + f.note : ''}`));
  if (f.source === 'agent') mid.append(el('div', 'src', 'auto · from session'));

  const actions = el('div', 'finding-actions');
  const hasBody = (f.steps && f.steps.length) || true;
  const expandBtn = el('button', null, state.expanded.has(f.id) ? 'Hide' : 'Details');
  expandBtn.onclick = () => toggleBody(f, card, expandBtn);
  const rm = el('button', 'rm', '✕');
  rm.onclick = () => api.deleteFinding(f.id);
  actions.append(expandBtn, rm);

  top.append(badge, mid, actions);
  card.append(top);

  const body = el('div', 'finding-body');
  body.hidden = !state.expanded.has(f.id);
  card.append(body);
  if (!body.hidden) fillBody(f, body);
  return card;
}

function toggleBody(f, card, btn) {
  const body = card.querySelector('.finding-body');
  if (state.expanded.has(f.id)) { state.expanded.delete(f.id); body.hidden = true; btn.textContent = 'Details'; }
  else { state.expanded.add(f.id); body.hidden = false; btn.textContent = 'Hide'; fillBody(f, body); }
}

async function fillBody(f, body) {
  body.innerHTML = '';
  if (f.steps && f.steps.length) {
    const ol = el('ol', 'steps');
    f.steps.forEach((s) => ol.appendChild(el('li', null, typeof s === 'string' ? s : s.text)));
    body.appendChild(ol);
  } else {
    body.appendChild(el('div', 'repro-note', 'No reproduction steps recorded. Add them via Log finding, or let the agent write them.'));
  }

  const repro = el('button', 'primary', 'Show how to reproduce');
  repro.onclick = async () => {
    repro.textContent = 'Retracing in session…';
    const r = await api.reproduce(f);
    if (!r.ok) { repro.textContent = r.error || 'No live session'; return; }
    focusTerminal();
    repro.textContent = 'Sent — watch the session';
    setTimeout(() => { repro.textContent = 'Show how to reproduce'; }, 4000);
  };
  body.appendChild(repro);

  // Screenshots (data URLs from main)
  const shots = await api.findingAssets(f.id);
  if (shots.length) {
    const grid = el('div', 'shots');
    shots.forEach((s) => {
      const cell = el('div', 'shot');
      const img = el('img'); img.src = s.dataUrl; img.alt = s.name;
      img.onclick = () => openLightbox(s.dataUrl);
      cell.append(img, el('div', 'cap', s.name));
      grid.appendChild(cell);
    });
    body.appendChild(grid);
  } else {
    body.appendChild(el('div', 'repro-note', 'No screenshots yet. They appear here automatically as the agent saves them during a reproduce run.'));
  }
}

// ── Modals ────────────────────────────────────────────────────────────
function openModal(html, onSubmit) {
  const modal = $('#modal'); modal.innerHTML = html;
  $('#modal-back').classList.add('show');
  const close = () => $('#modal-back').classList.remove('show');
  modal.querySelector('[data-cancel]')?.addEventListener('click', close);
  modal.querySelector('[data-submit]')?.addEventListener('click', () => { if (onSubmit(modal) !== false) close(); });
  modal.querySelector('input,select,textarea')?.focus();
}
$('#modal-back').addEventListener('click', (e) => { if (e.target.id === 'modal-back') $('#modal-back').classList.remove('show'); });

$('#add-target').onclick = () => openTargetModal(null);

$('#add-finding').onclick = () => {
  const opts = state.scope.targets.map((t) => `<option>${t.host}</option>`).join('');
  openModal(`
  <h3>Log finding</h3>
  <div class="modal-hint">Only a title is required. Add steps now, later, or let the agent fill them in on reproduce.</div>
  <label>Title</label>
  <input id="m-title" placeholder="Bonus claimable twice via race condition" />
  <div class="modal-inline">
    <div>
      <label>Target <span class="opt">optional</span></label>
      <select id="m-target"><option value="">(unscoped)</option>${opts}</select>
    </div>
    <div>
      <label>Severity</label>
      <select id="m-sev">${SEVERITIES.map((s) => `<option${s === 'medium' ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
  </div>
  <details class="modal-more">
    <summary>Add details <span class="opt">optional</span></summary>
    <label>Reproduction steps <span class="opt">one per line</span></label>
    <textarea id="m-steps" rows="4" placeholder="Log in and open the wallet page&#10;Send 20 parallel POST /wallet/redeem with the same code&#10;Observe balance credited 20x"></textarea>
    <label>Note</label>
    <input id="m-note" placeholder="No idempotency key on redeem endpoint" />
  </details>
  <div class="row"><button data-cancel>Cancel</button><button class="primary" data-submit>Log</button></div>`, (m) => {
    const title = m.querySelector('#m-title').value.trim();
    if (!title) return false;
    const steps = m.querySelector('#m-steps').value.split('\n').map((s) => s.trim()).filter(Boolean);
    api.writeFinding({
      id: uid(), title,
      target: m.querySelector('#m-target').value,
      severity: m.querySelector('#m-sev').value,
      note: m.querySelector('#m-note').value.trim(),
      steps, source: 'manual', ts: Date.now(),
    });
  });
};

// ── Lightbox ──────────────────────────────────────────────────────────
let lightbox;
function openLightbox(src) {
  if (!lightbox) {
    lightbox = el('div', 'lightbox');
    lightbox.onclick = () => lightbox.classList.remove('show');
    lightbox.appendChild(el('img'));
    document.body.appendChild(lightbox);
  }
  lightbox.querySelector('img').src = src;
  lightbox.classList.add('show');
}

// ── Terminal ──────────────────────────────────────────────────────────
let term, fitAddon, currentSession = null;

function setTermStatus(live, label) {
  $('#term-dot').className = 'dot ' + (live ? 'live' : 'out');
  $('#term-status').textContent = label;
}
function focusTerminal() { if (term) term.focus(); }

function initTerminal() {
  term = new window.Terminal({
    fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, cursorBlink: true,
    theme: {
      background: '#050607', foreground: '#c5c9d0', cursor: '#c0392b',
      selectionBackground: 'rgba(192,57,43,0.32)',
      black: '#0d0f12', red: '#c0392b', green: '#2ecc71', yellow: '#f1c40f',
      blue: '#3498db', magenta: '#9b59b6', cyan: '#1abc9c', white: '#c5c9d0', brightRed: '#e04535',
    },
  });
  fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open($('#terminal'));
  fit();
  term.onData((d) => api.ptyInput(d));
  api.onPtyData((d) => term.write(d));
  api.onPtyExit((code) => {
    term.write(`\r\n\x1b[2m[cerberus] session ended (exit ${code}). Restart to launch a new one.\x1b[0m\r\n`);
    setTermStatus(false, 'exited');
    if (currentSession) { currentSession.endedAt = Date.now(); persistSessions(); currentSession = null; }
  });
}
function fit() {
  if (!fitAddon) return;
  try { fitAddon.fit(); api.ptyResize({ cols: term.cols, rows: term.rows }); } catch (_) {}
}

async function startSession() {
  const res = await api.ptyStart(state.workdir);
  if (!res.ok) { term.write(`\r\n\x1b[31m[cerberus] ${res.error}\x1b[0m\r\n`); setTermStatus(false, 'error'); return; }
  setTermStatus(true, 'live');
  currentSession = { id: uid(), startedAt: Date.now(), endedAt: null, workdir: state.workdir };
  state.sessions.sessions.push(currentSession);
  persistSessions();
  setTimeout(fit, 60);
}

$('#btn-restart').onclick = () => {
  if (currentSession) { currentSession.endedAt = Date.now(); persistSessions(); }
  term.reset(); startSession();
};
$('#btn-workdir').onclick = async () => {
  const res = await api.pickDir();
  if (res.ok) { state.workdir = res.path; updateWorkdirChip(res.path); }
};
function updateWorkdirChip(p) {
  $('#workdir-name').textContent = p ? p.split('/').pop() : 'no workdir';
  $('#term-cmd').textContent = p ? `claude · ${p.split('/').pop()}` : 'claude';
  $('#watch-note').innerHTML = p
    ? `Watching <b>${p.split('/').pop()}/.cerberus/findings/</b> — findings written here appear live.`
    : 'Set a Workdir to auto-ingest findings the agent writes to <b>.cerberus/findings/</b>.';
}

// ── Resizer ───────────────────────────────────────────────────────────
(function wireResizer() {
  const main = $('.main'), resizer = $('#resizer');
  let dragging = false;
  resizer.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'row-resize'; });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; fit(); } });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = main.getBoundingClientRect();
    const termH = Math.min(Math.max(rect.bottom - e.clientY, 120), rect.height - 140);
    main.style.gridTemplateRows = `1fr 6px ${termH}px`;
    fit();
  });
})();
window.addEventListener('resize', fit);

// ── Boot ──────────────────────────────────────────────────────────────
async function boot() {
  const [scope, sessions, workdir, findings] = await Promise.all([
    api.getScope(), api.getSessions(), api.getWorkdir(), api.listFindings(),
  ]);
  state.scope = scope; state.sessions = sessions; state.workdir = workdir; state.findings = findings;
  api.onFindingsList((list) => { state.findings = list; renderFindings(); });
  renderScope(); renderSessions(); renderFindings();
  updateWorkdirChip(workdir);
  initTerminal();
  startSession();
}
boot();
