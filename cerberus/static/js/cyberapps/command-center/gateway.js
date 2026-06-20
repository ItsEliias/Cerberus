/**
 * gateway.js — GATEWAY sub-tab: platform status + cron job management.
 *
 * Shows Telegram / Discord / Slack connection status and allows creating,
 * toggling, and deleting gateway cron jobs that run on a schedule and
 * deliver LLM responses back to a messaging platform.
 */

const BASE = '';

// ---- Status colours (shared with command.js _GW_COLORS) ----

const _STATUS_COLOR = {
  active: '#2ecc71',
  idle: '#f1c40f',
  offline: 'rgba(192,57,43,0.6)',
  unconfigured: 'rgba(255,255,255,0.15)',
};

function _relTime(iso) {
  if (!iso) return 'never';
  const delta = (Date.now() - new Date(iso).getTime()) / 1000;
  if (delta < 60)    return 'just now';
  if (delta < 3600)  return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

// ---- Build HTML ----

export function buildGatewayTab() {
  return `
<div class="cc-gw-tab">
  <!-- GATEWAY STATUS (V5 dashboard — backed by /api/gateway/status) -->
  <div class="cc-gw-section cc-gw-status-section" id="gw-status-section">
    <div class="cc-section-label">GATEWAY STATUS</div>

    <div class="cc-gw-status-platforms" id="gw-status-platforms">
      <div class="cc-gw-status-row" data-platform="discord">
        <span class="cc-gw-status-dot"></span>
        <span class="cc-gw-status-name">DISCORD</span>
        <span class="cc-gw-status-state">—</span>
      </div>
      <div class="cc-gw-status-row" data-platform="telegram">
        <span class="cc-gw-status-dot"></span>
        <span class="cc-gw-status-name">TELEGRAM</span>
        <span class="cc-gw-status-state">—</span>
      </div>
      <div class="cc-gw-status-row" data-platform="slack">
        <span class="cc-gw-status-dot"></span>
        <span class="cc-gw-status-name">SLACK</span>
        <span class="cc-gw-status-state">—</span>
      </div>
    </div>

    <div class="cc-gw-status-row cc-gw-status-email" id="gw-status-email">
      <span class="cc-gw-status-mark">—</span>
      <span class="cc-gw-status-name">EMAIL</span>
      <span class="cc-gw-status-state">—</span>
    </div>

    <div class="cc-gw-status-row cc-gw-status-pending" id="gw-status-pending" title="Jump to pending approvals">
      <span class="cc-gw-status-name">PENDING APPROVALS</span>
      <span class="cc-gw-status-badge" id="gw-status-pending-badge">0</span>
    </div>

    <div class="cc-gw-status-activity-label">RECENT ACTIVITY</div>
    <div class="cc-gw-status-activity" id="gw-status-activity">
      <div class="cc-gw-status-empty">No recent activity.</div>
    </div>
  </div>

  <!-- PENDING APPROVALS — owner-actionable cards.
       Hidden when /api/gateway/approvals returns an empty list. -->
  <div class="cc-gw-section cc-gw-approvals-section" id="gw-approvals-section" hidden>
    <div class="cc-section-label">PENDING APPROVALS</div>
    <div class="cc-gw-approvals-list" id="gw-approvals-list"></div>
  </div>

  <div class="cc-gw-section">
    <div class="cc-section-label">PLATFORM STATUS</div>
    <div class="cc-gw-platforms" id="gw-platforms">
      <div class="cc-gw-platform-row" data-platform="telegram">
        <span class="cc-gw-dot" style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.15);flex-shrink:0"></span>
        <span class="cc-gw-pname">Telegram</span>
        <span class="cc-gw-pstatus">—</span>
      </div>
      <div class="cc-gw-platform-row" data-platform="discord">
        <span class="cc-gw-dot" style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.15);flex-shrink:0"></span>
        <span class="cc-gw-pname">Discord</span>
        <span class="cc-gw-pstatus">—</span>
      </div>
      <div class="cc-gw-platform-row" data-platform="slack">
        <span class="cc-gw-dot" style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.15);flex-shrink:0"></span>
        <span class="cc-gw-pname">Slack</span>
        <span class="cc-gw-pstatus">—</span>
      </div>
    </div>
  </div>

  <div class="cc-gw-section">
    <div class="cc-section-label" style="display:flex;align-items:center;justify-content:space-between">
      <span>CRON JOBS</span>
      <button class="cc-gw-add-btn" id="gw-add-btn">+ ADD</button>
    </div>
    <div class="cc-gw-jobs" id="gw-jobs">
      <div class="cc-gw-empty" id="gw-empty">Loading…</div>
    </div>
  </div>

  <!-- Add job form (hidden by default) -->
  <div class="cc-gw-form" id="gw-form" style="display:none">
    <div class="cc-section-label">NEW CRON JOB</div>
    <div class="cc-gw-form-grid">
      <label>Name<input class="cc-gw-input" id="gw-f-name" placeholder="Daily summary" maxlength="200"></label>
      <label>Cron<input class="cc-gw-input" id="gw-f-cron" placeholder="0 9 * * *" maxlength="64"></label>
      <label>Platform
        <select class="cc-gw-input" id="gw-f-platform">
          <option value="telegram">Telegram</option>
          <option value="discord">Discord</option>
          <option value="slack">Slack</option>
        </select>
      </label>
      <label>Chat ID<input class="cc-gw-input" id="gw-f-chat" placeholder="123456789"></label>
      <label class="cc-gw-form-wide">Prompt<textarea class="cc-gw-input cc-gw-textarea" id="gw-f-prompt" rows="3" placeholder="Give me a brief daily news summary" maxlength="2000"></textarea></label>
    </div>
    <div class="cc-gw-form-actions">
      <button class="cc-gw-cancel-btn" id="gw-cancel-btn">Cancel</button>
      <button class="cc-gw-save-btn" id="gw-save-btn">Save Job</button>
    </div>
    <div class="cc-gw-form-error" id="gw-form-error" style="display:none"></div>
  </div>
</div>`.trim();
}

// ---- Load / render ----

// One polling interval per CC instance — cleared when the tab is rebuilt by
// stashing the handle on the root element.
const _STATUS_POLL_MS = 30_000;
const _STATUS_POLL_KEY = '__gwStatusPollId';

export function loadGateway(root) {
  _loadGatewayStatus(root);
  _loadApprovals(root);
  _loadPlatforms(root);
  _loadJobs(root);

  // Replace any previous interval owned by an earlier tab build. The single
  // 30s tick refreshes BOTH the status snapshot and the approvals list so
  // there's only one wake-up per cycle.
  const prev = root && root[_STATUS_POLL_KEY];
  if (prev) clearInterval(prev);
  if (root) {
    root[_STATUS_POLL_KEY] = setInterval(() => {
      _loadGatewayStatus(root);
      _loadApprovals(root);
    }, _STATUS_POLL_MS);
  }

  // PENDING APPROVALS status row jumps focus to the approvals section.
  const pendRow = root.querySelector('#gw-status-pending');
  if (pendRow) pendRow.addEventListener('click', () => {
    const section = root.querySelector('#gw-approvals-section');
    if (section && !section.hidden) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Event delegation for dynamically-rendered approve/reject buttons.
  const approvals = root.querySelector('#gw-approvals-list');
  if (approvals) approvals.addEventListener('click', (e) => _onApprovalClick(root, e));

  const addBtn    = root.querySelector('#gw-add-btn');
  const cancelBtn = root.querySelector('#gw-cancel-btn');
  const saveBtn   = root.querySelector('#gw-save-btn');
  const form      = root.querySelector('#gw-form');

  if (addBtn)    addBtn.addEventListener('click', () => _showForm(root));
  if (cancelBtn) cancelBtn.addEventListener('click', () => _hideForm(root));
  if (saveBtn)   saveBtn.addEventListener('click', () => _submitJob(root));
}

// ---- V5 GATEWAY STATUS panel (POST-Phase-4a) -----------------------------

async function _loadGatewayStatus(root) {
  if (!root || !root.querySelector) return;
  try {
    const r = await fetch(`${BASE}/api/gateway/status`, { credentials: 'same-origin' });
    if (!r.ok) {
      _renderStatusOffline(root);
      return;
    }
    const data = await r.json();
    _renderGatewayStatus(root, data);
  } catch (_) {
    _renderStatusOffline(root);
  }
}

function _renderStatusOffline(root) {
  // Network/auth dropped — show a single state row instead of stale data.
  ['discord','telegram','slack'].forEach(p => {
    const row = root.querySelector(`.cc-gw-status-row[data-platform="${p}"]`);
    if (!row) return;
    row.classList.remove('cc-gw-status-on');
    const state = row.querySelector('.cc-gw-status-state');
    if (state) state.textContent = 'OFFLINE';
  });
}

function _renderGatewayStatus(root, data) {
  const platforms = (data && data.platforms) || {};
  ['discord','telegram','slack'].forEach(p => {
    const row = root.querySelector(`.cc-gw-status-row[data-platform="${p}"]`);
    if (!row) return;
    const state = row.querySelector('.cc-gw-status-state');
    const isOn  = platforms[p] === 'configured';
    row.classList.toggle('cc-gw-status-on', isOn);
    if (state) state.textContent = isOn ? 'CONNECTED' : 'NOT CONFIGURED';
  });

  const emailRow   = root.querySelector('#gw-status-email');
  const emailMark  = emailRow ? emailRow.querySelector('.cc-gw-status-mark') : null;
  const emailState = emailRow ? emailRow.querySelector('.cc-gw-status-state') : null;
  if (emailRow) {
    const enabled = !!data.email_enabled;
    const count = Number(data.email_allowlist_count || 0);
    emailRow.classList.toggle('cc-gw-status-on', enabled);
    if (emailMark)  emailMark.textContent  = enabled ? '✓ ENABLED' : '✗ BLOCKED';
    if (emailState) emailState.textContent = enabled
      ? `${count} ADDRESS${count === 1 ? '' : 'ES'} IN ALLOWLIST`
      : 'NO ALLOWLIST CONFIGURED';
  }

  const pendCount = Number(data.pending_approvals || 0);
  const badge = root.querySelector('#gw-status-pending-badge');
  const pendRow = root.querySelector('#gw-status-pending');
  if (badge) badge.textContent = String(pendCount);
  if (pendRow) pendRow.classList.toggle('cc-gw-status-on', pendCount > 0);

  _renderRecentActivity(root, data.recent_approvals || []);
}

function _renderRecentActivity(root, items) {
  const container = root.querySelector('#gw-status-activity');
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<div class="cc-gw-status-empty">No recent activity.</div>';
    return;
  }
  container.innerHTML = items.map(it => `
    <div class="cc-gw-status-activity-row">
      <span class="cc-gw-status-activity-tool">${_esc(it.tool || '')}</span>
      <span class="cc-gw-status-activity-ago">${_esc(it.ago || '')}</span>
    </div>
  `).join('');
}

// ---- Approval cards (backed by /api/gateway/approvals) -------------------

async function _loadApprovals(root) {
  if (!root || !root.querySelector) return;
  const section = root.querySelector('#gw-approvals-section');
  const list = root.querySelector('#gw-approvals-list');
  if (!section || !list) return;
  try {
    const r = await fetch(`${BASE}/api/gateway/approvals`, { credentials: 'same-origin' });
    if (!r.ok) {
      section.hidden = true;
      return;
    }
    const data = await r.json();
    const items = Array.isArray(data.pending) ? data.pending : [];
    _renderApprovals(root, items);
  } catch (_) {
    // Network drop — keep last-known cards visible rather than wiping them.
  }
}

function _renderApprovals(root, items) {
  const section = root.querySelector('#gw-approvals-section');
  const list = root.querySelector('#gw-approvals-list');
  if (!section || !list) return;
  if (!items.length) {
    section.hidden = true;
    list.innerHTML = '';
    return;
  }
  section.hidden = false;
  list.innerHTML = items.map(it => _buildApprovalCard(it)).join('');
}

function _buildApprovalCard(it) {
  const rid = String(it.request_id || '');
  const tool = String(it.tool || '');
  const preview = String(it.preview || '');
  return `
    <div class="cc-gw-approval-card" data-id="${_esc(rid)}">
      <div class="cc-gw-approval-tool">// ${_esc(tool)}</div>
      <div class="cc-gw-approval-preview">${_esc(preview)}</div>
      <div class="cc-gw-approval-actions">
        <button class="cc-gw-approve-btn" data-id="${_esc(rid)}" data-action="approve">✓ APPROVE</button>
        <button class="cc-gw-reject-btn"  data-id="${_esc(rid)}" data-action="reject">✕ REJECT</button>
      </div>
      <div class="cc-gw-approval-state" hidden></div>
    </div>
  `.trim();
}

function _onApprovalClick(root, e) {
  const btn = e.target && e.target.closest && e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (!id || (action !== 'approve' && action !== 'reject')) return;
  _decideApproval(root, id, action);
}

async function _decideApproval(root, id, action) {
  const card = root.querySelector(`.cc-gw-approval-card[data-id="${CSS && CSS.escape ? CSS.escape(id) : id}"]`);
  if (!card) return;
  const buttons = card.querySelectorAll('button[data-action]');
  const stateEl = card.querySelector('.cc-gw-approval-state');
  // Disable BOTH buttons during the in-flight request to prevent double-submit.
  buttons.forEach(b => { b.disabled = true; });
  if (stateEl) { stateEl.hidden = false; stateEl.textContent = '// WAITING…'; stateEl.className = 'cc-gw-approval-state'; }

  const method = action === 'approve' ? 'PATCH' : 'DELETE';
  const url = `${BASE}/api/gateway/approve/${encodeURIComponent(id)}`;

  try {
    const r = await fetch(url, { method, credentials: 'same-origin' });
    if (!r.ok) {
      const detail = await _readErrorDetail(r);
      _markCardFailure(card, buttons, stateEl, detail || `// FAILED (${r.status})`);
      return;
    }
    // Success: brief in-card toast, then remove and refresh counts.
    if (stateEl) {
      stateEl.textContent = action === 'approve' ? '// APPROVED' : '// REJECTED';
      stateEl.classList.add('cc-gw-approval-state--ok');
    }
    setTimeout(() => {
      card.remove();
      _loadGatewayStatus(root);    // refresh badge + recent activity
      _loadApprovals(root);        // ensure section hides if list is now empty
    }, 600);
  } catch (_) {
    _markCardFailure(card, buttons, stateEl, '// NETWORK ERROR');
  }
}

async function _readErrorDetail(resp) {
  try {
    const j = await resp.json();
    if (j && (j.detail || j.message)) return `// ${j.detail || j.message}`;
  } catch (_) {}
  return '';
}

function _markCardFailure(card, buttons, stateEl, message) {
  buttons.forEach(b => { b.disabled = false; });
  if (stateEl) {
    stateEl.hidden = false;
    stateEl.textContent = message;
    stateEl.className = 'cc-gw-approval-state cc-gw-approval-state--err';
  }
}

// ---- Platform status ----

async function _loadPlatforms(root) {
  try {
    const r = await fetch(`${BASE}/api/cyberapps/operations/gateway`);
    if (!r.ok) return;
    const data = await r.json();
    _applyPlatforms(root, data);
  } catch (_) {}
}

function _applyPlatforms(root, data) {
  const platforms = (data && data.platforms) || [];
  for (const p of platforms) {
    const row = root.querySelector(`.cc-gw-platform-row[data-platform="${p.name}"]`);
    if (!row) continue;
    const dot    = row.querySelector('.cc-gw-dot');
    const status = row.querySelector('.cc-gw-pstatus');
    const color  = _STATUS_COLOR[p.status] || _STATUS_COLOR.unconfigured;
    if (dot) {
      dot.style.background  = color;
      dot.style.boxShadow   = p.status === 'active' ? `0 0 5px ${color}` : 'none';
    }
    if (status) {
      if (p.status === 'unconfigured') {
        status.textContent = 'not configured';
      } else {
        status.textContent = `${p.status} · ${_relTime(p.last_seen)}`;
      }
    }
  }
}

// ---- Cron jobs list ----

async function _loadJobs(root) {
  const container = root.querySelector('#gw-jobs');
  const empty     = root.querySelector('#gw-empty');
  if (!container) return;
  try {
    const r = await fetch(`${BASE}/api/gateway/cron/jobs`);
    if (!r.ok) {
      if (empty) empty.textContent = 'Failed to load jobs.';
      return;
    }
    const data = await r.json();
    _renderJobs(root, data.jobs || []);
  } catch (_) {
    if (empty) empty.textContent = 'Failed to load jobs.';
  }
}

function _renderJobs(root, jobs) {
  const container = root.querySelector('#gw-jobs');
  if (!container) return;
  container.innerHTML = '';

  if (!jobs.length) {
    container.innerHTML = '<div class="cc-gw-empty">No cron jobs configured.</div>';
    return;
  }

  for (const job of jobs) {
    const row = document.createElement('div');
    row.className = 'cc-gw-job-row';
    row.dataset.jobId = job.id;

    const enabledClass = job.enabled ? 'cc-gw-job-active' : 'cc-gw-job-disabled';
    row.innerHTML = `
      <div class="cc-gw-job-main">
        <span class="cc-gw-job-badge ${enabledClass}">${job.enabled ? 'ON' : 'OFF'}</span>
        <div class="cc-gw-job-info">
          <span class="cc-gw-job-name">${_esc(job.name)}</span>
          <span class="cc-gw-job-meta">${_esc(job.cron)} · ${_esc(job.platform)}</span>
        </div>
      </div>
      <div class="cc-gw-job-actions">
        <button class="cc-gw-toggle-btn" title="${job.enabled ? 'Disable' : 'Enable'}">${job.enabled ? 'Disable' : 'Enable'}</button>
        <button class="cc-gw-delete-btn" title="Delete">✕</button>
      </div>
    `.trim();

    row.querySelector('.cc-gw-toggle-btn').addEventListener('click', async () => {
      await _toggleJob(root, job.id, !job.enabled);
    });
    row.querySelector('.cc-gw-delete-btn').addEventListener('click', async () => {
      if (confirm(`Delete job "${job.name}"?`)) await _deleteJob(root, job.id);
    });

    container.appendChild(row);
  }
}

// ---- CRUD actions ----

async function _toggleJob(root, id, enabled) {
  try {
    const r = await fetch(`${BASE}/api/gateway/cron/jobs/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (r.ok) _loadJobs(root);
  } catch (_) {}
}

async function _deleteJob(root, id) {
  try {
    await fetch(`${BASE}/api/gateway/cron/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' });
    _loadJobs(root);
  } catch (_) {}
}

function _showForm(root) {
  const form = root.querySelector('#gw-form');
  const err  = root.querySelector('#gw-form-error');
  if (form) form.style.display = '';
  if (err)  { err.style.display = 'none'; err.textContent = ''; }
}

function _hideForm(root) {
  const form = root.querySelector('#gw-form');
  if (form) { form.style.display = 'none'; _clearForm(root); }
}

function _clearForm(root) {
  ['gw-f-name','gw-f-cron','gw-f-chat','gw-f-prompt'].forEach(id => {
    const el = root.querySelector(`#${id}`);
    if (el) el.value = '';
  });
  const platform = root.querySelector('#gw-f-platform');
  if (platform) platform.value = 'telegram';
}

async function _submitJob(root) {
  const name     = (root.querySelector('#gw-f-name')?.value || '').trim();
  const cron     = (root.querySelector('#gw-f-cron')?.value || '').trim();
  const platform = root.querySelector('#gw-f-platform')?.value || 'telegram';
  const chat     = (root.querySelector('#gw-f-chat')?.value || '').trim();
  const prompt   = (root.querySelector('#gw-f-prompt')?.value || '').trim();
  const errEl    = root.querySelector('#gw-form-error');

  const _err = (msg) => {
    if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
  };

  if (!name)   return _err('Name is required.');
  if (!cron)   return _err('Cron expression is required.');
  if (!prompt) return _err('Prompt is required.');

  const body = { name, cron, platform, prompt, enabled: true };
  if (chat) body.chat_id = isNaN(Number(chat)) ? chat : Number(chat);

  try {
    const r = await fetch(`${BASE}/api/gateway/cron/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return _err(d.detail || `Error ${r.status}`);
    }
    _hideForm(root);
    _loadJobs(root);
  } catch (e) {
    _err('Network error. Please try again.');
  }
}

// ---- Helpers ----

function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
