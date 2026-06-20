/**
 * workspace.js — WORKSPACE sub-tab.
 *
 * Aggregates real workspace items from existing Cerberus endpoints:
 *   /api/notes            — Notes (GET)
 *   /api/tasks            — Scheduled Tasks (GET)
 *   /api/sessions         — Chat sessions (GET)
 *   /api/personal         — Library/personal docs (GET)
 *
 * Each row shows a type badge + title + date, clickable to open in Cerberus.
 */

const SOURCES = [
  { key: 'notes',    endpoint: '/api/notes',    badge: 'note',   label: 'Notes',    titleKey: 'title', dateKey: 'updated_at', link: '/notes' },
  { key: 'tasks',    endpoint: '/api/tasks',    badge: 'task',   label: 'Tasks',    titleKey: 'name',  dateKey: 'updated_at', link: '/tasks' },
  { key: 'chats',    endpoint: '/api/sessions', badge: 'chat',   label: 'Chats',    titleKey: 'title', dateKey: 'updated_at', link: '/' },
  { key: 'docs',     endpoint: '/api/personal', badge: 'doc',    label: 'Library',  titleKey: 'name',  dateKey: null,          link: '/library' },
];

export function buildWorkspaceTab() {
  // SCHEDULED TASKS section is rendered on top; the legacy aggregate grid
  // (notes/tasks/chats/library overview) is preserved below it.
  return `<div class="cc-workspace-tab">
    <!-- SCHEDULED TASKS — backed by /api/tasks (see routes/task_routes.py) -->
    <div class="cc-section cc-sched-section" id="cc-sched-section">
      <div class="cc-section-label cc-sched-header">
        <span>// SCHEDULED TASKS</span>
        <button class="cc-sched-new-btn" id="cc-sched-new-btn" type="button">+ NEW TASK</button>
      </div>

      <div class="cc-sched-list" id="cc-sched-list">
        <div class="cc-sched-empty">Loading…</div>
      </div>

      <div class="cc-sched-toast" id="cc-sched-toast" hidden></div>

      <!-- Create form (hidden by default) -->
      <form class="cc-sched-form" id="cc-sched-form" hidden>
        <div class="cc-sched-form-grid">
          <label class="cc-sched-form-wide">
            <span>NAME</span>
            <input class="cc-sched-input" id="cc-sched-f-name" type="text" maxlength="200" required>
          </label>
          <label class="cc-sched-form-wide">
            <span>PROMPT</span>
            <textarea class="cc-sched-input cc-sched-textarea" id="cc-sched-f-prompt" rows="3" maxlength="4000" required></textarea>
          </label>
          <label>
            <span>SCHEDULE</span>
            <select class="cc-sched-input" id="cc-sched-f-schedule">
              <option value="once">Once</option>
              <option value="daily" selected>Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            <span>TIME (UTC)</span>
            <input class="cc-sched-input" id="cc-sched-f-time" type="time" value="09:00">
          </label>
          <label>
            <span>AGENT</span>
            <select class="cc-sched-input" id="cc-sched-f-agent">
              <option value="">— none —</option>
            </select>
          </label>
        </div>
        <div class="cc-sched-form-actions">
          <button type="button" class="cc-sched-cancel-btn" id="cc-sched-cancel-btn">CANCEL</button>
          <button type="submit" class="cc-sched-submit-btn" id="cc-sched-submit-btn">CREATE TASK</button>
        </div>
        <div class="cc-sched-form-error" id="cc-sched-form-error" hidden></div>
      </form>
    </div>

    <div class="cc-section-header">Workspace</div>
    <div id="cc-ws-body"><div class="cc-empty">Loading workspace...</div></div>
  </div>`;
}

export async function loadWorkspace(root) {
  // 1. SCHEDULED TASKS section — wire FIRST so it's responsive even if the
  //    aggregate grid below is slow.
  _initScheduledTasksSection(root);

  // 2. Aggregate grid (notes/tasks/chats/library) — preserved verbatim.
  const body = root.querySelector('#cc-ws-body');
  if (!body) return;

  const results = await Promise.allSettled(
    SOURCES.map(s => _fetchSource(s))
  );

  const sections = results.map((r, i) => {
    const src = SOURCES[i];
    const items = r.status === 'fulfilled' ? r.value : [];
    if (items.length === 0) return null;
    const rows = items.slice(0, 8).map(item => {
      const title = item[src.titleKey] || '(untitled)';
      const date = src.dateKey && item[src.dateKey]
        ? _relDate(item[src.dateKey])
        : '';
      return `<div class="cc-ws-item-row" title="${_esc(title)}" data-link="${src.link}">
        <span class="cc-ws-badge ${src.badge}">${src.badge.toUpperCase()}</span>
        <span class="cc-ws-label">${_esc(title)}</span>
        <span class="cc-ws-meta">${_esc(date)}</span>
      </div>`;
    }).join('');
    return `<div class="cc-ws-item">
      <div class="cc-card-title">${src.label} (${items.length})</div>
      ${rows}
    </div>`;
  }).filter(Boolean);

  if (sections.length === 0) {
    body.innerHTML = '<div class="cc-empty">No workspace items found</div>';
    return;
  }

  body.innerHTML = `<div class="cc-ws-grid">${sections.join('')}</div>`;

  // JARVIS: stagger-in workspace items
  if (window.JX && typeof window.JX.staggerIn === 'function') {
    window.JX.staggerIn(body, '.cc-ws-item', 0);
  }

  // Wire clicks to open the right Cerberus section
  body.querySelectorAll('.cc-ws-item-row[data-link]').forEach(row => {
    row.addEventListener('click', () => {
      const link = row.dataset.link;
      if (link) window.location.href = link;
    });
  });
}


// ── SCHEDULED TASKS section ─────────────────────────────────────────────────
//
// Backed by /api/tasks (routes/task_routes.py). Endpoints used:
//   GET    /api/tasks               → { tasks: [...] }
//   POST   /api/tasks               → _task_to_dict
//   POST   /api/tasks/{id}/pause    → { ok: true, status: "paused" }
//   POST   /api/tasks/{id}/resume   → { ok: true, status: "active", next_run }
//   DELETE /api/tasks/{id}          → { ok: true }
//   GET    /api/agents              → { agents: [{ name, ... }] }
//
// pause/resume are POST in the live route — NOT PATCH. The status values are
// the literal strings "active" / "paused" / "completed" from
// ScheduledTask.status. All names and paths are read from task_routes.py;
// none are guessed.

const _SCHED_POLL_MS = 30_000;
const _SCHED_POLL_KEY = '__schedPollId';

function _initScheduledTasksSection(root) {
  if (!root || !root.querySelector) return;

  // Single 30s tick for the task list while the tab is mounted. Replaced
  // on every tab rebuild so we never leak intervals.
  const prev = root[_SCHED_POLL_KEY];
  if (prev) clearInterval(prev);
  root[_SCHED_POLL_KEY] = setInterval(() => _loadTasks(root), _SCHED_POLL_MS);

  // Initial loads
  _loadTasks(root);
  _loadAgentsIntoSelect(root);

  // Wire form open/close + submit, and event-delegated row actions.
  const newBtn   = root.querySelector('#cc-sched-new-btn');
  const cancelBt = root.querySelector('#cc-sched-cancel-btn');
  const form     = root.querySelector('#cc-sched-form');
  const list     = root.querySelector('#cc-sched-list');

  if (newBtn)   newBtn.addEventListener('click', () => _showSchedForm(root));
  if (cancelBt) cancelBt.addEventListener('click', () => _hideSchedForm(root));
  if (form)     form.addEventListener('submit', (e) => _submitSchedForm(root, e));
  if (list)     list.addEventListener('click', (e) => _onTaskListClick(root, e));
}

async function _loadTasks(root) {
  const list = root.querySelector('#cc-sched-list');
  if (!list) return;
  try {
    const r = await fetch('/api/tasks', { credentials: 'same-origin' });
    if (!r.ok) {
      // Don't wipe the last-known list on a transient failure — that would
      // erase pending Pause/Resume confirms the user just clicked.
      return;
    }
    const data = await r.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    _renderTasks(root, tasks);
  } catch (_) {
    // Same — leave the previous render in place on network errors.
  }
}

function _renderTasks(root, tasks) {
  const list = root.querySelector('#cc-sched-list');
  if (!list) return;
  if (!tasks.length) {
    list.innerHTML = '<div class="cc-sched-empty">No scheduled tasks yet.</div>';
    return;
  }
  list.innerHTML = tasks.map(t => _buildTaskRow(t)).join('');
}

function _buildTaskRow(t) {
  const id      = String(t.id || '');
  const name    = String(t.name || '(untitled)');
  const status  = String(t.status || '').toLowerCase();      // active / paused / completed
  const sched   = _prettySchedule(t);
  const nextRun = t.next_run ? _formatTimestamp(t.next_run) : '—';

  // Pause/Resume button polarity tracks current status.
  // "completed" tasks can be resumed (re-armed) but not paused.
  const isPaused   = status === 'paused';
  const isActive   = status === 'active';
  const togglAct   = isActive ? 'pause' : 'resume';
  const togglLbl   = isActive ? 'PAUSE' : 'RESUME';

  return `
    <div class="cc-sched-row" data-id="${_esc(id)}" data-status="${_esc(status)}">
      <div class="cc-sched-row-main">
        <div class="cc-sched-row-name" title="${_esc(name)}">${_esc(name)}</div>
        <div class="cc-sched-row-meta">
          <span class="cc-sched-row-schedule">${_esc(sched)}</span>
          <span class="cc-sched-row-sep">·</span>
          <span class="cc-sched-row-next">NEXT ${_esc(nextRun)}</span>
        </div>
      </div>
      <div class="cc-sched-row-side">
        <span class="cc-sched-row-status cc-sched-row-status--${_esc(status || 'unknown')}">${_esc((status || 'unknown').toUpperCase())}</span>
        <button type="button" class="cc-sched-toggle-btn" data-action="${_esc(togglAct)}" data-id="${_esc(id)}">${togglLbl}</button>
        <button type="button" class="cc-sched-delete-btn" data-action="delete" data-id="${_esc(id)}">DELETE</button>
      </div>
    </div>
  `.trim();
}

function _prettySchedule(t) {
  const s = String(t.schedule || '').toLowerCase();
  const at = t.scheduled_time ? ` at ${t.scheduled_time}` : '';
  if (s === 'daily')   return `Daily${at}`;
  if (s === 'weekly')  return `Weekly ${_weekday(t.scheduled_day)}${at}`.trim();
  if (s === 'monthly') return `Monthly day ${t.scheduled_day || 1}${at}`;
  if (s === 'once') {
    if (t.scheduled_date) return `Once at ${_formatTimestamp(t.scheduled_date)}`;
    return `Once${at}`;
  }
  if (s === 'cron')    return `Cron ${t.cron_expression || ''}`;
  if (!s && (t.trigger_type === 'event' || t.trigger_type === 'webhook')) {
    return (t.trigger_type || '').toUpperCase();
  }
  return s ? s.toUpperCase() : '—';
}

function _weekday(n) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  return (n !== null && n !== undefined && n >= 0 && n < 7) ? days[n] : '';
}

function _formatTimestamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  // YYYY-MM-DD HH:MM in UTC — task_routes returns ISO UTC ("...Z").
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yr}-${mo}-${dy} ${hh}:${mm}`;
}

async function _loadAgentsIntoSelect(root) {
  const sel = root.querySelector('#cc-sched-f-agent');
  if (!sel) return;
  try {
    const r = await fetch('/api/agents', { credentials: 'same-origin' });
    if (!r.ok) return;
    const data = await r.json();
    const agents = Array.isArray(data.agents) ? data.agents : [];
    // Preserve the "— none —" placeholder, then append each agent's name.
    const opts = ['<option value="">— none —</option>']
      .concat(agents.map(a => `<option value="${_esc(a.name || '')}">${_esc(a.name || '')}</option>`));
    sel.innerHTML = opts.join('');
  } catch (_) {}
}

function _showSchedForm(root) {
  const form = root.querySelector('#cc-sched-form');
  const err  = root.querySelector('#cc-sched-form-error');
  const newBtn = root.querySelector('#cc-sched-new-btn');
  if (form) form.hidden = false;
  if (err)  { err.hidden = true; err.textContent = ''; }
  if (newBtn) newBtn.disabled = true;
}

function _hideSchedForm(root) {
  const form = root.querySelector('#cc-sched-form');
  const newBtn = root.querySelector('#cc-sched-new-btn');
  if (form) {
    form.hidden = true;
    form.reset();
    const sched = form.querySelector('#cc-sched-f-schedule');
    if (sched) sched.value = 'daily';
    const time = form.querySelector('#cc-sched-f-time');
    if (time) time.value = '09:00';
  }
  if (newBtn) newBtn.disabled = false;
}

async function _submitSchedForm(root, e) {
  e.preventDefault();
  const name     = (root.querySelector('#cc-sched-f-name')?.value || '').trim();
  const promptRaw = (root.querySelector('#cc-sched-f-prompt')?.value || '').trim();
  const schedule = (root.querySelector('#cc-sched-f-schedule')?.value || '').trim();
  const time     = (root.querySelector('#cc-sched-f-time')?.value || '').trim();
  const agent    = (root.querySelector('#cc-sched-f-agent')?.value || '').trim();
  const errEl    = root.querySelector('#cc-sched-form-error');
  const showErr  = (msg) => { if (errEl) { errEl.hidden = false; errEl.textContent = msg; } };

  if (!name)     return showErr('Name is required.');
  if (!promptRaw) return showErr('Prompt is required.');
  if (!schedule)  return showErr('Schedule is required.');

  // TaskCreate has no agent field — surface the selection in the prompt so
  // the LLM picks up the context. (ScheduledTask.crew_member_id exists in
  // the schema but is not part of the create-task request model — see
  // task_routes.py TaskCreate. Patching that is out of scope for this PR.)
  const prompt = agent ? `[Agent: ${agent}] ${promptRaw}` : promptRaw;

  // schedule="once" needs a scheduled_date instead of recurring HH:MM. The
  // simplified form here doesn't ask for a date — fall back to today's
  // HH:MM in UTC, which task_routes will validate / next-roll if past.
  const body = {
    name,
    prompt,
    task_type: 'llm',
    trigger_type: 'schedule',
    schedule,
    scheduled_time: time || '09:00',
  };
  if (schedule === 'once') {
    body.scheduled_date = _todayAtUTC(time || '09:00');
  }

  const submitBtn = root.querySelector('#cc-sched-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  if (errEl) errEl.hidden = true;

  try {
    const r = await fetch('/api/tasks', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await _readErrDetail(r) || `Error ${r.status}`;
      showErr(detail);
      return;
    }
    _hideSchedForm(root);
    _flashToast(root, '// TASK CREATED');
    _loadTasks(root);
  } catch (_) {
    showErr('Network error. Please try again.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function _todayAtUTC(hhmm) {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  const d = new Date();
  d.setUTCHours(Number.isFinite(h) ? h : 9);
  d.setUTCMinutes(Number.isFinite(m) ? m : 0);
  d.setUTCSeconds(0);
  d.setUTCMilliseconds(0);
  return d.toISOString();
}

function _flashToast(root, message) {
  const toast = root.querySelector('#cc-sched-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast.__hideId);
  toast.__hideId = setTimeout(() => { toast.hidden = true; }, 2500);
}

async function _readErrDetail(resp) {
  try {
    const j = await resp.json();
    if (j && (j.detail || j.message)) return String(j.detail || j.message);
  } catch (_) {}
  return '';
}

function _onTaskListClick(root, e) {
  const btn = e.target && e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (!id) return;
  if (action === 'pause' || action === 'resume') {
    _toggleTask(root, id, action, btn);
  } else if (action === 'delete') {
    _startDeleteConfirm(root, id, btn);
  } else if (action === 'confirm-delete') {
    _confirmDelete(root, id, btn);
  } else if (action === 'cancel-delete') {
    _cancelDeleteConfirm(btn);
  }
}

async function _toggleTask(root, id, action, btn) {
  // action is "pause" or "resume" — matches POST /api/tasks/{id}/<action> path.
  btn.disabled = true;
  try {
    const r = await fetch(`/api/tasks/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      _flashToast(root, `// ${action.toUpperCase()} FAILED`);
      btn.disabled = false;
      return;
    }
    _loadTasks(root);
  } catch (_) {
    _flashToast(root, '// NETWORK ERROR');
    btn.disabled = false;
  }
}

function _startDeleteConfirm(root, id, btn) {
  // Replace the DELETE button cluster with an inline "// CONFIRM?" prompt.
  // Same pattern as the gateway approval cards.
  const row = btn.closest('.cc-sched-row');
  if (!row) return;
  const side = row.querySelector('.cc-sched-row-side');
  if (!side) return;
  side.dataset.preConfirm = side.innerHTML;
  side.innerHTML = `
    <span class="cc-sched-confirm-label">// CONFIRM?</span>
    <button type="button" class="cc-sched-confirm-btn" data-action="confirm-delete" data-id="${_esc(String(id))}">YES</button>
    <button type="button" class="cc-sched-confirm-cancel-btn" data-action="cancel-delete" data-id="${_esc(String(id))}">NO</button>
  `;
}

function _cancelDeleteConfirm(btn) {
  const side = btn.closest('.cc-sched-row-side');
  if (!side) return;
  const prior = side.dataset.preConfirm;
  if (prior !== undefined) {
    side.innerHTML = prior;
    delete side.dataset.preConfirm;
  }
}

async function _confirmDelete(root, id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      _flashToast(root, '// DELETE FAILED');
      btn.disabled = false;
      return;
    }
    _flashToast(root, '// TASK DELETED');
    _loadTasks(root);
  } catch (_) {
    _flashToast(root, '// NETWORK ERROR');
    btn.disabled = false;
  }
}

async function _fetchSource(src) {
  const res = await fetch(src.endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Each endpoint returns data differently
  if (src.key === 'notes')  return (data.notes    || data) || [];
  if (src.key === 'tasks')  return (data.tasks    || []);
  if (src.key === 'chats')  return (data.sessions || []);
  if (src.key === 'docs')   return (data.files    || data.documents || []);
  return Array.isArray(data) ? data : [];
}

function _relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = Math.round((Date.now() - d) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.round(diff/60)}m ago`;
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`;
  return `${Math.round(diff/86400)}d ago`;
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}
