/**
 * council.js — COUNCIL sub-tab: Named agent roles / CrewMember list.
 *
 * Data source: /api/cyberapps/operations/council
 * (proxies CrewMember rows from the Cerberus DB)
 *
 * Agent activate/idle: PATCH /api/cyberapps/operations/council/{id}
 * If that endpoint is unavailable, buttons are shown in read-only mode.
 */

export function buildCouncilTab() {
  return `<div class="cc-council-tab">
    <div class="cc-section-header">Agent Council</div>
    <div id="cc-council-rows"><div class="cc-empty">Loading council...</div></div>
    <div class="cc-council-note" id="cc-council-note"></div>
  </div>`;
}

export async function loadCouncil(root) {
  const container = root.querySelector('#cc-council-rows');
  const note = root.querySelector('#cc-council-note');
  if (!container) return;
  try {
    const res = await fetch('/api/cyberapps/operations/council');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const members = data.members || [];
    if (members.length === 0) {
      container.innerHTML = '<div class="cc-empty">No crew members configured</div>';
      if (note) note.textContent = '(no source) — Create crew members in Cerberus settings to populate this view.';
      return;
    }
    container.innerHTML = members.map(m => _rowHtml(m)).join('');
    // JARVIS: stagger-in council rows
    if (window.JX && typeof window.JX.staggerIn === 'function') {
      window.JX.staggerIn(container, '.cc-council-row', 0);
    }
    if (note) note.textContent = data.toggle_supported
      ? ''
      : '(read-only) — No agent-toggle endpoint found; activate/idle buttons are display-only.';

    // Wire toggle buttons
    container.querySelectorAll('.cc-council-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (!data.toggle_supported) return;
        try {
          await fetch(`/api/cyberapps/operations/council/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: action === 'activate' }),
          });
          await loadCouncil(root);
        } catch (e) { console.warn('[Council] toggle failed', e); }
      });
    });
  } catch (e) {
    container.innerHTML = `<div class="cc-empty">Error loading council: ${_esc(String(e))}</div>`;
  }
}

function _rowHtml(m) {
  const status = m.is_active ? 'active' : 'standby';
  const dotClass = m.is_active ? 'active' : 'idle';
  const btnClass = m.is_active ? '' : 'active-btn';
  const btnLabel = m.is_active ? 'IDLE' : 'ACTIVATE';
  const btnAction = m.is_active ? 'idle' : 'activate';
  const scoreNum = typeof m.score === 'number'
    ? `<span class="cc-council-score jx-number-tick" data-jx-tick="${m.score}">${m.score}</span>`
    : `<span class="cc-council-score">${_esc(m.status || status)}</span>`;
  return `<div class="cc-council-row">
    <span class="cc-dot jx-status-dot ${dotClass}"></span>
    <span class="cc-council-role">${_esc(m.name)}</span>
    <span class="cc-council-type">${_esc(m.model || '—')}</span>
    ${scoreNum}
    <button class="cc-council-btn ${btnClass}" data-id="${_esc(m.id)}" data-action="${btnAction}">
      ${btnLabel}
    </button>
  </div>`;
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}
