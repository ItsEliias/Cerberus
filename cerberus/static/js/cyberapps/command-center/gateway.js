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

export function loadGateway(root) {
  _loadPlatforms(root);
  _loadJobs(root);

  const addBtn    = root.querySelector('#gw-add-btn');
  const cancelBtn = root.querySelector('#gw-cancel-btn');
  const saveBtn   = root.querySelector('#gw-save-btn');
  const form      = root.querySelector('#gw-form');

  if (addBtn)    addBtn.addEventListener('click', () => _showForm(root));
  if (cancelBtn) cancelBtn.addEventListener('click', () => _hideForm(root));
  if (saveBtn)   saveBtn.addEventListener('click', () => _submitJob(root));
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
