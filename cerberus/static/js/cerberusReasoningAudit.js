// Atlas Reasoning Audit V1 — read-only context health UI

let _deps = {};
let _lastAudit = null;

function _el(id) {
  return document.getElementById(id);
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _clientStorageAudit() {
  const keys = [
    'cerberus-active-project-id',
    'cerberus_voice_settings',
    'lastSessionId',
    'odysseus-session-sort',
    'cerberus_cursor_fx',
  ];
  const hits = [];
  keys.forEach((key) => {
    try {
      const ls = localStorage.getItem(key);
      const ss = sessionStorage.getItem(key);
      if (ls != null) hits.push({ key, storage: 'localStorage', preview: ls.slice(0, 120) });
      if (ss != null) hits.push({ key, storage: 'sessionStorage', preview: ss.slice(0, 120) });
    } catch (_) {}
  });
  return hits;
}

function _section(title, bodyHtml) {
  return `<section class="cerberus-audit-section"><h3 class="cerberus-audit-section-title">${_esc(title)}</h3>${bodyHtml}</section>`;
}

function _list(items) {
  if (!items?.length) return '<p class="cerberus-audit-empty">None</p>';
  return `<ul class="cerberus-audit-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
}

function _renderAudit(data) {
  const body = _el('cerberus-reasoning-audit-body');
  if (!body) return;
  const s = data.summary || {};
  const wh = data.workspace_health || {};
  const focus = data.active_focus || {};
  const seeds = data.old_seed_warnings || {};
  const flagged = data.flagged_project_audit;
  const client = _clientStorageAudit();

  let html = '';

  html += _section('Workspace Health', `
    <p>Projects: ${wh.project_count ?? 0} · Indexed: ${wh.indexed_count ?? 0} · Deep indexed: ${wh.deep_indexed_count ?? 0}</p>
    <p>Using real project files: <strong class="${wh.using_real_project_files ? 'cerberus-audit-ok' : 'cerberus-audit-warn'}">${wh.using_real_project_files ? 'Yes' : 'No'}</strong></p>
    <p>Workspace root: <code>${_esc(wh.workspace_root)}</code></p>
    <p>Last scan: ${_esc(wh.last_scan_at || 'never')}</p>
  `);

  html += _section('Active Focus Source', `
    ${_list((focus.sources || []).map(src => `${_esc(src.source)} → ${_esc(JSON.stringify(src.value))}`))}
    <p>Client storage (read-only):</p>
    ${_list(client.map(c => `${_esc(c.key)} (${c.storage}): ${_esc(c.preview)}`))}
  `);

  html += _section('Old Seed Data Warnings', `
    <p>Profile seed focus: <strong class="${seeds.profile_seed_focus ? 'cerberus-audit-warn' : 'cerberus-audit-ok'}">${seeds.profile_seed_focus ? 'Yes' : 'No'}</strong></p>
    <p>Unlinked seed projects: ${_esc((seeds.unlinked_seed_projects || []).join(', ') || 'none')}</p>
    <p>Hardcoded references: ${(seeds.hardcoded_references || []).length}</p>
    ${_list((seeds.hardcoded_references || []).slice(0, 12).map(h => `${_esc(h.file)}:${h.line} — ${_esc(h.excerpt)}`))}
  `);

  html += _section('Project Context Health', (data.projects || []).map(p => `
    <div class="cerberus-audit-project">
      <h4>${_esc(p.name)} <span class="cerberus-audit-score">${p.confidence_score ?? 0}%</span></h4>
      <p>Path: <code>${_esc(p.path)}</code> · Files: ${p.file_count ?? 0} · Source: ${_esc(p.summary_source)}</p>
      <p>Indexed: ${p.indexed ? 'yes' : 'no'} · Deep: ${p.deep_indexed ? 'yes' : 'no'} · Stale: ${p.stale_summary ? 'yes' : 'no'}</p>
      ${(p.auth_summary_warnings || []).map(w => `<p class="cerberus-audit-warn">${_esc(w)}</p>`).join('')}
    </div>
  `).join('') || '<p class="cerberus-audit-empty">No projects</p>');

  if (flagged) {
    const c = flagged.checks || {};
    const pname = flagged.project_name || flagged.project_id || 'Project';
    html += _section(`${pname} Feature Audit`, `
      <p>Indexed features: ${flagged.indexed_features_count ?? 0}/6</p>
      <p>Auth: ${c.auth_files ? '✓' : '—'} · DB/schema: ${c.database_schema ? '✓' : '—'} · Supabase/Base44: ${c.supabase_base44 ? '✓' : '—'}</p>
      <p>Routes/pages: ${c.routes_pages ? '✓' : '—'} · Dashboard: ${c.dashboard_logic ? '✓' : '—'} · Login logic: ${c.login_auth_logic ? '✓' : '—'}</p>
      ${(flagged.warnings || []).map(w => `<p class="cerberus-audit-warn">${_esc(w)}</p>`).join('')}
    `);
  }

  html += _section('Agent Context Health', (data.agents || []).map(a => `
    <div class="cerberus-audit-agent">
      <h4>${_esc(a.name)} <span class="cerberus-audit-pill">${_esc(a.status)}</span></h4>
      <p>V2 access: ${a.has_summary_v2_access ? 'yes' : 'no'} · Fallback: ${a.using_generic_fallback ? 'yes' : 'no'}</p>
      <p>Last report: ${_esc(a.last_report_source)}</p>
    </div>
  `).join('') || '<p class="cerberus-audit-empty">No agents</p>');

  html += _section('Recommended Fixes', `
    ${_list((data.recommended_fixes || []).map(r => `[P${r.priority}] ${_esc(r.fix)}`))}
    <p class="cerberus-audit-summary-line"><strong>Fix first:</strong> ${_esc((s.fix_first || []).join(' · '))}</p>
  `);

  body.innerHTML = html;
  const meta = _el('cerberus-reasoning-audit-meta');
  if (meta) meta.textContent = `Generated ${data.generated_at || ''}`;
}

export async function runReasoningAudit() {
  const btn = _el('cerberus-run-reasoning-audit');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/cerberus/audit/reasoning', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || `Audit failed (${res.status})`);
    _lastAudit = data;
    _renderAudit(data);
    openReasoningAuditModal();
    _deps.showToast?.('Reasoning audit complete');
    return data;
  } catch (err) {
    _deps.showToast?.(err?.message || 'Reasoning audit failed');
    throw err;
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function openReasoningAuditModal() {
  const modal = _el('cerberus-reasoning-audit-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeReasoningAuditModal() {
  const modal = _el('cerberus-reasoning-audit-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function _bindEvents() {
  _el('cerberus-run-reasoning-audit')?.addEventListener('click', () => void runReasoningAudit());
  _el('cerberus-run-reasoning-audit-settings')?.addEventListener('click', () => void runReasoningAudit());
  const modal = _el('cerberus-reasoning-audit-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-audit-close]')) closeReasoningAuditModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeReasoningAuditModal();
  });
}

export function initAtlasReasoningAudit(deps = {}) {
  _deps = deps;
  _bindEvents();
}

const cerberusReasoningAudit = {
  initAtlasReasoningAudit,
  runReasoningAudit,
  openReasoningAuditModal,
  closeReasoningAuditModal,
};

export default cerberusReasoningAudit;
