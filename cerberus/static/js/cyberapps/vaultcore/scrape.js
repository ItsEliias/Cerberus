/**
 * VaultCore — Scrape tab.
 * Submit a new scrape job and view recent job status.
 */

const API = '';

const SOURCE_TYPES = [
  'website', 'github', 'obsidian-publish', 'youtube',
  'reddit', 'twitter', 'notion', 'medium', 'cve', 'rss', 'pdf',
];

const TYPE_LABELS = {
  'website': 'Website', 'github': 'GitHub', 'obsidian-publish': 'Obsidian Publish',
  'youtube': 'YouTube', 'reddit': 'Reddit', 'twitter': 'Twitter/X',
  'notion': 'Notion', 'medium': 'Medium/Substack', 'cve': 'CVE (NVD)',
  'rss': 'RSS Feed', 'pdf': 'PDF',
};

const STATUS_ICONS = {
  queued: '⏳', running: '⚡', completed: '✓', failed: '✗',
};

let _container = null;
let _jobs = [];
let _sources = [];

export function renderScrape(container) {
  _container = container;
  Promise.all([_loadJobs(), _loadSources()]).then(() => _render());
}

async function _loadJobs() {
  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/jobs?limit=20`);
    _jobs = await res.json();
  } catch { _jobs = []; }
}

async function _loadSources() {
  try {
    const res = await fetch(`${API}/api/cyberapps/vaultcore/sources`);
    _sources = await res.json();
  } catch { _sources = []; }
}

function _render() {
  if (!_container) return;
  _container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'vc-scrape';

  // New job form
  const formSection = document.createElement('div');
  formSection.className = 'vc-card';
  formSection.style.marginBottom = '16px';
  formSection.innerHTML = `
    <div class="vc-section-title" style="margin-bottom:10px">New Scrape Job</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="vc-field">
        <label class="vc-label">Source Type</label>
        <select class="vc-select" id="vscrape-type" style="width:100%">
          ${SOURCE_TYPES.map(t => `<option value="${t}">${TYPE_LABELS[t]||t}</option>`).join('')}
        </select>
      </div>
      <div class="vc-field">
        <label class="vc-label">Saved Source (optional)</label>
        <select class="vc-select" id="vscrape-source" style="width:100%">
          <option value="">— none —</option>
          ${_sources.map(s => `<option value="${s.id}" data-url="${_esc(s.url)}" data-type="${s.type}" data-name="${_esc(s.name)}">${_esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="vc-field">
      <label class="vc-label">URL *</label>
      <input class="vc-input" id="vscrape-url" placeholder="https://…">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div class="vc-field">
        <label class="vc-label">Source Name</label>
        <input class="vc-input" id="vscrape-name" placeholder="auto">
      </div>
      <div class="vc-field">
        <label class="vc-label">Output Subfolder</label>
        <input class="vc-input" id="vscrape-subfolder" placeholder="optional">
      </div>
      <div class="vc-field">
        <label class="vc-label">Conflict Strategy</label>
        <select class="vc-select" id="vscrape-conflict" style="width:100%">
          <option value="skip">Skip existing</option>
          <option value="overwrite">Overwrite</option>
          <option value="keepBoth">Keep both</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div class="vc-field">
        <label class="vc-label">Depth (website)</label>
        <input class="vc-input" id="vscrape-depth" type="number" value="3" min="1" max="10">
      </div>
      <div class="vc-field">
        <label class="vc-label">Max Pages</label>
        <input class="vc-input" id="vscrape-maxpages" type="number" value="50" min="1" max="500">
      </div>
      <div class="vc-field">
        <label class="vc-label">Delay (sec)</label>
        <input class="vc-input" id="vscrape-delay" type="number" value="1" min="0" max="30">
      </div>
    </div>
    <div class="vc-error" id="vscrape-error" style="display:none"></div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="vc-btn vc-btn-primary" id="vscrape-submit">Queue Job</button>
      <span class="vc-hint" style="align-self:center">Jobs are queued and run by the Cerberus scraping engine.</span>
    </div>
  `;

  wrap.appendChild(formSection);

  // Recent jobs
  const jobsSection = document.createElement('div');
  jobsSection.innerHTML = `
    <div class="vc-section-header">
      <span class="vc-section-title">Recent Jobs</span>
      <button class="vc-btn vc-btn-ghost" id="vscrape-refresh" style="font-size:11px">Refresh</button>
    </div>
  `;

  const jobList = document.createElement('div');
  jobList.id = 'vscrape-job-list';
  if (_jobs.length === 0) {
    jobList.innerHTML = '<div class="vc-empty">No jobs yet.</div>';
  } else {
    const reversed = [..._jobs].reverse();
    reversed.forEach(job => jobList.appendChild(_jobCard(job)));
  }
  jobsSection.appendChild(jobList);
  wrap.appendChild(jobsSection);
  _container.appendChild(wrap);

  // Wire saved source autofill
  const srcSelect = _container.querySelector('#vscrape-source');
  srcSelect.addEventListener('change', () => {
    const opt = srcSelect.options[srcSelect.selectedIndex];
    if (opt.value) {
      _container.querySelector('#vscrape-url').value = opt.dataset.url || '';
      _container.querySelector('#vscrape-type').value = opt.dataset.type || 'website';
      _container.querySelector('#vscrape-name').value = opt.dataset.name || '';
    }
  });

  _container.querySelector('#vscrape-submit').addEventListener('click', _submitJob);
  _container.querySelector('#vscrape-refresh').addEventListener('click', () => {
    _loadJobs().then(() => {
      const list = document.getElementById('vscrape-job-list');
      if (!list) return;
      list.innerHTML = '';
      if (_jobs.length === 0) {
        list.innerHTML = '<div class="vc-empty">No jobs yet.</div>';
      } else {
        [..._jobs].reverse().forEach(job => list.appendChild(_jobCard(job)));
      }
    });
  });
}

function _jobCard(job) {
  const card = document.createElement('div');
  card.className = 'vc-card';
  const icon = STATUS_ICONS[job.status] || '?';
  const statusClass = `vc-job-${job.status}`;
  const ts = job.created_at ? new Date(job.created_at).toLocaleString() : '—';
  const result = job.result;
  const resultStr = result
    ? `Saved: ${result.saved || 0} | Updated: ${result.updated || 0} | Failed: ${result.failed || 0}`
    : (job.progress?.message || '');

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div style="flex:1;min-width:0">
        <div class="vc-card-title">
          <span class="${statusClass}">${icon}</span>
          ${_esc(job.source_name || job.url)}
          <span class="vc-tag">${job.source_type}</span>
        </div>
        <div class="vc-card-meta">
          <span>${ts}</span>
          ${resultStr ? `<span>${_esc(resultStr)}</span>` : ''}
          ${job.url ? `<span style="font-family:monospace;font-size:10px">${_esc(_truncate(job.url, 40))}</span>` : ''}
        </div>
      </div>
      <button class="vc-btn vc-btn-ghost vc-job-del" data-id="${job.id}" title="Remove" style="flex-shrink:0;margin-left:8px">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    ${job.status === 'running' && job.progress ? `
      <div style="margin-top:6px">
        <div class="vc-progress-bar"><div class="vc-progress-fill" style="width:${job.progress.percent||0}%"></div></div>
        <span class="vc-hint">${_esc(job.progress.message || '')}</span>
      </div>` : ''}
  `;

  card.querySelector('.vc-job-del').addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.id;
    await fetch(`${API}/api/cyberapps/vaultcore/jobs/${id}`, { method: 'DELETE' });
    card.remove();
  });

  return card;
}

async function _submitJob() {
  const errEl = _container.querySelector('#vscrape-error');
  errEl.style.display = 'none';

  const url = _container.querySelector('#vscrape-url').value.trim();
  if (!url) { errEl.textContent = 'URL is required'; errEl.style.display = 'block'; return; }

  const payload = {
    source_id: _container.querySelector('#vscrape-source').value || null,
    source_type: _container.querySelector('#vscrape-type').value,
    url,
    source_name: _container.querySelector('#vscrape-name').value.trim(),
    output_subfolder: _container.querySelector('#vscrape-subfolder').value.trim(),
    conflict_strategy: _container.querySelector('#vscrape-conflict').value,
    update_mode: 'all',
    depth: parseInt(_container.querySelector('#vscrape-depth').value) || 3,
    max_pages: parseInt(_container.querySelector('#vscrape-maxpages').value) || 50,
    delay: parseInt(_container.querySelector('#vscrape-delay').value) || 1,
  };

  try {
    const btn = _container.querySelector('#vscrape-submit');
    btn.disabled = true;
    btn.textContent = 'Queuing…';
    const res = await fetch(`${API}/api/cyberapps/vaultcore/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'Queue Job';
    if (!res.ok) {
      errEl.textContent = data.detail || 'Failed to queue job';
      errEl.style.display = 'block';
      return;
    }
    // Reload jobs
    await _loadJobs();
    const list = document.getElementById('vscrape-job-list');
    if (list) {
      list.innerHTML = '';
      if (_jobs.length === 0) {
        list.innerHTML = '<div class="vc-empty">No jobs yet.</div>';
      } else {
        [..._jobs].reverse().forEach(j => list.appendChild(_jobCard(j)));
      }
    }
    _container.querySelector('#vscrape-url').value = '';
  } catch (e) {
    errEl.textContent = String(e);
    errEl.style.display = 'block';
    const btn = _container.querySelector('#vscrape-submit');
    if (btn) { btn.disabled = false; btn.textContent = 'Queue Job'; }
  }
}

function _truncate(str, max) { return str.length > max ? str.slice(0, max) + '…' : str; }
function _esc(str) { const d = document.createElement('div'); d.textContent = String(str || ''); return d.innerHTML; }
