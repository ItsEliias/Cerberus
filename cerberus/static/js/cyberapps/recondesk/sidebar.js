/**
 * ReconDesk sidebar — target list, engagement grouping, add/delete.
 */
import { _esc } from './index.js';

const PLATFORM_COLORS = {
  HTB:      '#f85149',
  THM:      '#3fb950',
  CTF:      '#b44fff',
  Client:   '#4a9eff',
  Internal: '#8b949e',
};

const STATUS_DOT = {
  active:    '#3fb950',
  paused:    '#d29922',
  completed: '#4a9eff',
  abandoned: '#484f58',
};

export function renderSidebar(el, state, handlers) {
  const { targets, engagements, activeTargetId } = state;
  const { onSelectTarget, onAddTarget, onDeleteTarget, onAddEngagement } = handlers;

  const grouped = {};
  for (const t of targets) {
    const eid = t.engagement_id || 'default';
    if (!grouped[eid]) grouped[eid] = [];
    grouped[eid].push(t);
  }

  const engList = engagements.length
    ? engagements
    : [{ id: 'default', name: 'Default', color: '#d29922' }];

  let html = `
    <div class="rd-sb-header">
      <span style="font-size:11px;font-weight:700;color:#e6edf3;letter-spacing:0.05em">RECONDESK</span>
      <button class="rd-sb-add" id="rd-add-target" title="New target">+</button>
    </div>
    <div class="rd-sb-scroll">
  `;

  for (const eng of engList) {
    const engTargets = grouped[eng.id] || [];
    if (engTargets.length === 0 && engList.length <= 1) continue;
    html += `
      <div class="rd-sb-eng-label" style="border-left:2px solid ${_esc(eng.color)}">
        <span>${_esc(eng.name)}</span>
        <span class="rd-sb-eng-count">${engTargets.length}</span>
      </div>
    `;
    for (const t of engTargets) {
      const isActive = t.id === activeTargetId;
      const pColor = PLATFORM_COLORS[t.platform] || '#8b949e';
      const dot = STATUS_DOT[t.status] || '#484f58';
      const openPorts = (t.ports || []).filter(p => p.state === 'open').length;
      html += `
        <div class="rd-sb-target${isActive ? ' rd-sb-target--active' : ''}" data-id="${_esc(t.id)}">
          <span class="rd-sb-dot" style="background:${dot}"></span>
          <div class="rd-sb-target-info">
            <span class="rd-sb-target-name">${_esc(t.name)}</span>
            <span class="rd-sb-target-meta">
              <span style="color:${pColor};font-size:9px">${_esc(t.platform)}</span>
              ${t.ip ? `<span style="color:#484f58;font-size:9px;font-family:monospace">${_esc(t.ip)}</span>` : ''}
              ${openPorts > 0 ? `<span style="color:#4a9eff;font-size:9px">${openPorts}p</span>` : ''}
            </span>
          </div>
          <button class="rd-sb-del" data-del="${_esc(t.id)}" title="Delete target">✕</button>
        </div>
      `;
    }
  }

  html += `</div>`;

  if (!document.getElementById('rd-sb-styles')) {
    const style = document.createElement('style');
    style.id = 'rd-sb-styles';
    style.textContent = `
      .rd-sb-header { display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
                      border-bottom:1px solid var(--border); flex-shrink:0; }
      .rd-sb-add { background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.3);
                   color:#d29922;border-radius:6px;cursor:pointer;width:24px;height:24px;
                   font-size:16px;line-height:1;display:flex;align-items:center;justify-content:center; }
      .rd-sb-add:hover { background:rgba(210,153,34,0.22); }
      .rd-sb-scroll { flex:1;overflow-y:auto; }
      .rd-sb-eng-label { display:flex;align-items:center;justify-content:space-between;
                         padding:8px 14px 4px;font-size:9px;text-transform:uppercase;
                         letter-spacing:0.1em;color:#484f58;margin-top:4px; }
      .rd-sb-eng-count { font-size:9px;background:rgba(42,51,71,0.5);border-radius:10px;
                          padding:1px 5px;color:#8b949e; }
      .rd-sb-target { display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer;
                      transition:background 80ms;position:relative; }
      .rd-sb-target:hover { background:rgba(255,255,255,0.03); }
      .rd-sb-target--active { background:rgba(210,153,34,0.06);border-right:2px solid #d29922; }
      .rd-sb-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }
      .rd-sb-target-info { flex:1;min-width:0; }
      .rd-sb-target-name { display:block;font-size:12px;color:#e6edf3;font-weight:500;
                           white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      .rd-sb-target-meta { display:flex;gap:6px;margin-top:2px; }
      .rd-sb-del { opacity:0;background:none;border:none;color:#484f58;cursor:pointer;font-size:11px;
                   padding:2px 4px;border-radius:4px;transition:all 80ms;flex-shrink:0; }
      .rd-sb-target:hover .rd-sb-del { opacity:1; }
      .rd-sb-del:hover { color:#f85149;background:rgba(248,81,73,0.1); }
    `;
    document.head.appendChild(style);
  }

  el.innerHTML = html;

  el.querySelector('#rd-add-target')?.addEventListener('click', onAddTarget);

  el.querySelectorAll('.rd-sb-target').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.rd-sb-del')) return;
      onSelectTarget(row.dataset.id);
    });
  });

  el.querySelectorAll('.rd-sb-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeleteTarget(btn.dataset.del);
    });
  });
}
