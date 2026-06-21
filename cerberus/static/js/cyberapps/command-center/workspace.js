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

    <!-- GIT SUMMARY — POST /api/git/summarise (see routes/git_routes.py) -->
    <div class="cc-section cc-git-section" id="cc-git-section">
      <div class="cc-section-label cc-git-header">
        <span>// GIT CHANGES</span>
        <button class="cc-git-summarise-btn" id="cc-git-summarise-btn" type="button">// SUMMARISE LAST PUSH</button>
      </div>
      <div class="cc-git-result" id="cc-git-result" hidden></div>
    </div>

    <!-- WEBHOOKS — backed by /api/webhooks (see routes/webhook_routes.py) -->
    <div class="cc-section cc-webhook-section" id="cc-webhook-section">
      <div class="cc-section-label cc-webhook-header">
        <span>// WEBHOOKS</span>
        <button class="cc-webhook-new-btn" id="cc-webhook-new-btn" type="button">+ ADD WEBHOOK</button>
      </div>

      <div class="cc-webhook-list" id="cc-webhook-list">
        <div class="cc-webhook-empty">Loading…</div>
      </div>

      <div class="cc-webhook-toast" id="cc-webhook-toast" hidden></div>

      <form class="cc-webhook-form" id="cc-webhook-form" hidden>
        <div class="cc-webhook-form-grid">
          <label class="cc-webhook-form-wide">
            <span>NAME</span>
            <input class="cc-webhook-input" id="cc-webhook-f-name" type="text" maxlength="100" required>
          </label>
          <label class="cc-webhook-form-wide">
            <span>URL</span>
            <input class="cc-webhook-input" id="cc-webhook-f-url" type="url" maxlength="2048" required>
          </label>
          <fieldset class="cc-webhook-form-wide cc-webhook-events-fieldset">
            <legend>EVENTS</legend>
            <!-- Event names hardcoded from src/webhook_manager.py
                 ALLOWED_EVENTS (minus the internal "webhook.test"). No
                 list endpoint exists, so this stays in lock-step with
                 the server-side constant. -->
            <label class="cc-webhook-event-check">
              <input type="checkbox" name="event" value="session.created">
              <span>session.created</span>
            </label>
            <label class="cc-webhook-event-check">
              <input type="checkbox" name="event" value="chat.completed">
              <span>chat.completed</span>
            </label>
            <label class="cc-webhook-event-check">
              <input type="checkbox" name="event" value="chat.message">
              <span>chat.message</span>
            </label>
          </fieldset>
          <label class="cc-webhook-form-wide">
            <span>SECRET (OPTIONAL)</span>
            <input class="cc-webhook-input" id="cc-webhook-f-secret" type="password" maxlength="256" autocomplete="off">
          </label>
        </div>
        <div class="cc-webhook-form-actions">
          <button type="button" class="cc-webhook-cancel-btn" id="cc-webhook-cancel-btn">CANCEL</button>
          <button type="submit" class="cc-webhook-submit-btn" id="cc-webhook-submit-btn">CREATE WEBHOOK</button>
        </div>
        <div class="cc-webhook-form-error" id="cc-webhook-form-error" hidden></div>
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

  // 1b. WEBHOOKS section — same lifecycle pattern as scheduler.
  _initWebhooksSection(root);

  // 1c. GIT summary button — single click, in-place result panel.
  _initGitSummarySection(root);

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
    list.innerHTML = '<div class="cc-sched-empty">// NO SCHEDULED TASKS YET — click + NEW above to create one.</div>';
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


// ── WEBHOOKS section ────────────────────────────────────────────────────────
//
// Backed by /api/webhooks (routes/webhook_routes.py). Endpoints used:
//   GET    /api/webhooks                  → [{ id, name, url, has_secret,
//                                              events: [], is_active,
//                                              last_triggered_at,
//                                              last_status_code,
//                                              last_error, created_at }]
//   POST   /api/webhooks                  → Form: name, url, secret, events
//                                            (CSV) → { id, name }
//   PATCH  /api/webhooks/{id}             → toggles is_active → { id, is_active }
//   DELETE /api/webhooks/{id}             → { status: "deleted" }
//   POST   /api/webhooks/{id}/test        → { status: "sent" }
//
// All require admin auth (require_admin). The CC is mounted under the
// browser session cookie, so this works transparently for the operator.
// Event names are hardcoded — see comment in buildWorkspaceTab().

const _WEBHOOK_POLL_MS = 30_000;
const _WEBHOOK_POLL_KEY = '__webhookPollId';
const _WEBHOOK_URL_MAX = 40;

function _initWebhooksSection(root) {
  if (!root || !root.querySelector) return;

  const prev = root[_WEBHOOK_POLL_KEY];
  if (prev) clearInterval(prev);
  root[_WEBHOOK_POLL_KEY] = setInterval(() => _loadWebhooks(root), _WEBHOOK_POLL_MS);

  _loadWebhooks(root);

  const newBtn   = root.querySelector('#cc-webhook-new-btn');
  const cancelBt = root.querySelector('#cc-webhook-cancel-btn');
  const form     = root.querySelector('#cc-webhook-form');
  const list     = root.querySelector('#cc-webhook-list');

  if (newBtn)   newBtn.addEventListener('click', () => _showWebhookForm(root));
  if (cancelBt) cancelBt.addEventListener('click', () => _hideWebhookForm(root));
  if (form)     form.addEventListener('submit', (e) => _submitWebhookForm(root, e));
  if (list)     list.addEventListener('click', (e) => _onWebhookListClick(root, e));
}

async function _loadWebhooks(root) {
  const list = root.querySelector('#cc-webhook-list');
  if (!list) return;
  try {
    const r = await fetch('/api/webhooks', { credentials: 'same-origin' });
    if (!r.ok) {
      // Soft-fail — leave the last-known list visible so a transient hiccup
      // doesn't wipe pending Test/Delete confirms the user just clicked.
      // BUT a 401/403 means we shouldn't keep blank-rendering "Loading…".
      if ((r.status === 401 || r.status === 403) && /Loading…/.test(list.textContent)) {
        list.innerHTML = '<div class="cc-webhook-empty">Admin access required.</div>';
      }
      return;
    }
    const data = await r.json();
    _renderWebhooks(root, Array.isArray(data) ? data : []);
  } catch (_) {}
}

function _renderWebhooks(root, hooks) {
  const list = root.querySelector('#cc-webhook-list');
  if (!list) return;
  if (!hooks.length) {
    list.innerHTML = '<div class="cc-webhook-empty">// NO WEBHOOKS YET — click + ADD WEBHOOK above to create one.</div>';
    return;
  }
  list.innerHTML = hooks.map(_buildWebhookRow).join('');
}

function _buildWebhookRow(h) {
  const id    = String(h.id || '');
  const name  = String(h.name || '(unnamed)');
  const url   = String(h.url || '');
  const isOn  = !!h.is_active;
  const togglAction = isOn ? 'deactivate' : 'activate';
  const togglLabel  = isOn ? 'PAUSE' : 'ACTIVATE';

  const urlDisplay = url.length > _WEBHOOK_URL_MAX
    ? url.slice(0, _WEBHOOK_URL_MAX) + '…'
    : url;

  const events = Array.isArray(h.events) ? h.events : [];
  const chips = events.length
    ? events.map(e => `<span class="cc-webhook-chip">${_esc(e)}</span>`).join('')
    : '<span class="cc-webhook-chip cc-webhook-chip--muted">(no events)</span>';

  return `
    <div class="cc-webhook-row" data-id="${_esc(id)}" data-active="${isOn ? '1' : '0'}">
      <div class="cc-webhook-row-main">
        <div class="cc-webhook-row-name" title="${_esc(name)}">${_esc(name)}</div>
        <div class="cc-webhook-row-url" title="${_esc(url)}">${_esc(urlDisplay)}</div>
        <div class="cc-webhook-row-chips">${chips}</div>
      </div>
      <div class="cc-webhook-row-side">
        <span class="cc-webhook-row-status cc-webhook-row-status--${isOn ? 'on' : 'off'}">
          ${isOn ? 'ACTIVE' : 'INACTIVE'}
        </span>
        <button type="button" class="cc-webhook-test-btn"  data-action="test"   data-id="${_esc(id)}">TEST</button>
        <button type="button" class="cc-webhook-toggle-btn" data-action="${_esc(togglAction)}" data-id="${_esc(id)}">${togglLabel}</button>
        <button type="button" class="cc-webhook-delete-btn" data-action="delete" data-id="${_esc(id)}">DELETE</button>
      </div>
    </div>
  `.trim();
}

function _onWebhookListClick(root, e) {
  const btn = e.target && e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (!id) return;
  if (action === 'activate' || action === 'deactivate') {
    _toggleWebhook(root, id, btn);
  } else if (action === 'test') {
    _testWebhook(root, id, btn);
  } else if (action === 'delete') {
    _startWebhookDeleteConfirm(root, id, btn);
  } else if (action === 'confirm-delete') {
    _confirmWebhookDelete(root, id, btn);
  } else if (action === 'cancel-delete') {
    _cancelWebhookDeleteConfirm(btn);
  }
}

async function _toggleWebhook(root, id, btn) {
  // PATCH /api/webhooks/{id} flips is_active server-side; the next list
  // refresh swaps the row's polarity.
  btn.disabled = true;
  try {
    const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      _flashWebhookToast(root, '// TOGGLE FAILED');
      btn.disabled = false;
      return;
    }
    _loadWebhooks(root);
  } catch (_) {
    _flashWebhookToast(root, '// NETWORK ERROR');
    btn.disabled = false;
  }
}

async function _testWebhook(root, id, btn) {
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = 'TESTING…';
  try {
    const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      const detail = await _readErrDetail(r);
      _flashWebhookToast(root, detail ? `// TEST FAILED: ${detail}` : '// TEST FAILED');
      return;
    }
    _flashWebhookToast(root, '// TEST PING SENT');
    // Server records last_triggered_at / last_status_code asynchronously;
    // refresh shortly to pick the updated badge state up.
    setTimeout(() => _loadWebhooks(root), 1000);
  } catch (_) {
    _flashWebhookToast(root, '// NETWORK ERROR');
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

function _startWebhookDeleteConfirm(root, id, btn) {
  const row = btn.closest('.cc-webhook-row');
  if (!row) return;
  const side = row.querySelector('.cc-webhook-row-side');
  if (!side) return;
  side.dataset.preConfirm = side.innerHTML;
  side.innerHTML = `
    <span class="cc-webhook-confirm-label">// CONFIRM?</span>
    <button type="button" class="cc-webhook-confirm-btn"        data-action="confirm-delete" data-id="${_esc(String(id))}">YES</button>
    <button type="button" class="cc-webhook-confirm-cancel-btn" data-action="cancel-delete"  data-id="${_esc(String(id))}">NO</button>
  `;
}

function _cancelWebhookDeleteConfirm(btn) {
  const side = btn.closest('.cc-webhook-row-side');
  if (!side) return;
  const prior = side.dataset.preConfirm;
  if (prior !== undefined) {
    side.innerHTML = prior;
    delete side.dataset.preConfirm;
  }
}

async function _confirmWebhookDelete(root, id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      _flashWebhookToast(root, '// DELETE FAILED');
      btn.disabled = false;
      return;
    }
    _flashWebhookToast(root, '// WEBHOOK DELETED');
    _loadWebhooks(root);
  } catch (_) {
    _flashWebhookToast(root, '// NETWORK ERROR');
    btn.disabled = false;
  }
}

function _showWebhookForm(root) {
  const form   = root.querySelector('#cc-webhook-form');
  const err    = root.querySelector('#cc-webhook-form-error');
  const newBtn = root.querySelector('#cc-webhook-new-btn');
  if (form)   form.hidden = false;
  if (err)    { err.hidden = true; err.textContent = ''; }
  if (newBtn) newBtn.disabled = true;
}

function _hideWebhookForm(root) {
  const form   = root.querySelector('#cc-webhook-form');
  const newBtn = root.querySelector('#cc-webhook-new-btn');
  if (form) {
    form.hidden = true;
    form.reset();
  }
  if (newBtn) newBtn.disabled = false;
}

async function _submitWebhookForm(root, e) {
  e.preventDefault();
  const form   = root.querySelector('#cc-webhook-form');
  const name   = (root.querySelector('#cc-webhook-f-name')?.value || '').trim();
  const url    = (root.querySelector('#cc-webhook-f-url')?.value || '').trim();
  const secret = (root.querySelector('#cc-webhook-f-secret')?.value || '').trim();
  const errEl  = root.querySelector('#cc-webhook-form-error');
  const showErr = (msg) => { if (errEl) { errEl.hidden = false; errEl.textContent = msg; } };

  if (!name) return showErr('Name is required.');
  if (!url)  return showErr('URL is required.');

  // Collect checked event names; webhook_routes expects a comma-separated string.
  const events = Array.from(form ? form.querySelectorAll('input[name="event"]:checked') : [])
    .map(input => input.value);
  if (!events.length) return showErr('Pick at least one event.');

  const body = new FormData();
  body.append('name', name);
  body.append('url', url);
  body.append('secret', secret);
  body.append('events', events.join(','));

  const submitBtn = root.querySelector('#cc-webhook-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
  if (errEl) errEl.hidden = true;

  try {
    const r = await fetch('/api/webhooks', {
      method: 'POST',
      credentials: 'same-origin',
      body,
    });
    if (!r.ok) {
      const detail = await _readErrDetail(r);
      showErr(detail || `Error ${r.status}`);
      return;
    }
    _hideWebhookForm(root);
    _flashWebhookToast(root, '// WEBHOOK CREATED');
    _loadWebhooks(root);
  } catch (_) {
    showErr('Network error. Please try again.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function _flashWebhookToast(root, message) {
  const toast = root.querySelector('#cc-webhook-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast.__hideId);
  toast.__hideId = setTimeout(() => { toast.hidden = true; }, 2500);
}

// ─── GIT SUMMARY section ──────────────────────────────────────────────────
// Single button + inline result panel. The summary itself is also saved as
// a Note (see routes/git_routes.py), so this panel is just for in-context
// feedback — fading after each click would lose the result before the user
// reads it, so the panel sticks until the next click.

function _initGitSummarySection(root) {
  const btn = root.querySelector('#cc-git-summarise-btn');
  const out = root.querySelector('#cc-git-result');
  if (!btn || !out) return;
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '// SUMMARISING…';
    out.hidden = false;
    out.textContent = '…';
    try {
      const res = await fetch('/api/git/summarise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const e = await res.json();
          if (e?.detail) detail = String(e.detail);
        } catch (_) { /* keep HTTP code */ }
        throw new Error(detail);
      }
      const data = await res.json();
      const summary = (data?.summary || '').trim()
        || '(empty summary returned)';
      out.textContent = summary;
    } catch (e) {
      out.textContent = `// SUMMARY FAILED — ${e.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}
