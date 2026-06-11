/**
 * ReconDesk — Overview tab.
 * Shows target metadata, quick stats, attack progress, notes editor.
 */
import { _esc } from './index.js';

const PLATFORM_STYLE = {
  HTB:      { color: '#f85149', bg: 'rgba(248,81,73,0.10)',   border: 'rgba(248,81,73,0.20)'   },
  THM:      { color: '#3fb950', bg: 'rgba(63,185,80,0.10)',   border: 'rgba(63,185,80,0.20)'   },
  CTF:      { color: '#b44fff', bg: 'rgba(180,79,255,0.10)',  border: 'rgba(180,79,255,0.20)'  },
  Client:   { color: '#4a9eff', bg: 'rgba(74,158,255,0.10)',  border: 'rgba(74,158,255,0.20)'  },
  Internal: { color: '#8b949e', bg: 'rgba(139,148,158,0.10)', border: 'rgba(139,148,158,0.20)' },
};
const STATUS_COLORS = { active: '#3fb950', completed: '#4a9eff', abandoned: '#484f58', paused: '#d29922' };
const DIFF_COLORS   = { Easy: '#3fb950', Medium: '#d29922', Hard: '#f85149', Insane: '#b44fff' };
const STAGES        = ['recon', 'enum', 'exploit', 'post', 'privesc', 'loot'];

export function renderOverview(el, target, state, handlers) {
  const { onUpdate, onSwitchTab } = handlers;
  const ports       = target.ports || [];
  const cards       = target.attack_cards || [];
  const openPorts   = ports.filter(p => p.state === 'open').length;
  const doneCards   = cards.filter(c => c.status === 'done').length;
  const progressPct = cards.length > 0 ? Math.round((doneCards / cards.length) * 100) : 0;
  const pStyle      = PLATFORM_STYLE[target.platform] || PLATFORM_STYLE.HTB;

  el.innerHTML = `
    <div style="padding:16px;overflow-y:auto;height:100%;box-sizing:border-box">
      <div style="max-width:900px">
        <!-- Header -->
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
              <span style="width:10px;height:10px;border-radius:50%;background:${STATUS_COLORS[target.status] || '#484f58'};flex-shrink:0;display:inline-block"></span>
              <h1 style="font-size:18px;font-weight:700;color:#e6edf3;margin:0">${_esc(target.name)}</h1>
              ${target.difficulty ? `<span style="font-size:11px;font-weight:600;color:${DIFF_COLORS[target.difficulty] || '#484f58'}">${_esc(target.difficulty)}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${target.ip ? `<span style="font-family:monospace;font-size:13px;color:rgba(210,153,34,0.80)">${_esc(target.ip)}</span>` : ''}
              <span style="color:#484f58">·</span>
              <span class="rd-badge" style="color:${pStyle.color};background:${pStyle.bg};border-color:${pStyle.border}">${_esc(target.platform)}</span>
              ${target.os ? `<span style="font-size:11px;color:#8b949e">${_esc(target.os)}</span>` : ''}
              <span style="font-size:11px;text-transform:capitalize;color:${STATUS_COLORS[target.status] || '#484f58'}">${_esc(target.status)}</span>
            </div>
            ${(target.tags || []).length > 0 ? `
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                ${(target.tags || []).map(tag => `<span class="rd-badge" style="color:#8b949e;background:rgba(42,51,71,0.4);border-color:rgba(42,51,71,0.6)">${_esc(tag)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button class="rd-btn" id="rd-ov-edit">Edit</button>
            <button class="rd-btn rd-btn--primary" id="rd-ov-export">Export</button>
          </div>
        </div>

        <!-- Stats grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px">
          <!-- Quick stats -->
          <div class="rd-panel">
            <span class="rd-label-caps">Quick Stats</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              ${[
                { label: 'Open Ports', value: openPorts, color: '#4a9eff' },
                { label: 'Credentials', value: (target.credentials || []).length, color: '#f85149' },
                { label: 'Cards', value: cards.length, color: '#d29922' },
                { label: 'Total Ports', value: ports.length, color: '#4a5568' },
              ].map(s => `
                <div>
                  <div style="font-size:22px;font-weight:700;color:${s.color};line-height:1">${s.value}</div>
                  <div style="font-size:10px;color:#484f58;margin-top:2px">${s.label}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Attack progress -->
          <div class="rd-panel">
            <span class="rd-label-caps">Attack Progress</span>
            ${cards.length === 0 ? `<p style="font-size:11px;color:#484f58;margin:0">No attack cards yet</p>` : `
              <div style="margin-bottom:8px">
                <div style="height:6px;border-radius:3px;background:rgba(42,51,71,0.4);overflow:hidden;margin-bottom:4px">
                  <div style="height:100%;border-radius:3px;background:linear-gradient(90deg,#3fb950,#d29922);width:${progressPct}%;transition:width 0.5s"></div>
                </div>
                <span style="font-size:11px;color:${progressPct === 100 ? '#3fb950' : '#8b949e'}">${progressPct}% (${doneCards}/${cards.length})</span>
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                ${STAGES.map(stage => {
                  const sc = cards.filter(c => c.stage === stage);
                  if (sc.length === 0) return '';
                  const done = sc.filter(c => c.status === 'done').length;
                  return `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(42,51,71,0.4);color:#8b949e">${stage} ${done}/${sc.length}</span>`;
                }).join('')}
              </div>
            `}
          </div>

          <!-- Context -->
          <div class="rd-panel">
            <span class="rd-label-caps">Context</span>
            <div style="display:flex;flex-direction:column;gap:4px;font-size:11px">
              <div><span style="color:#484f58">Added: </span><span style="color:#8b949e">${target.created_at ? new Date(target.created_at).toLocaleDateString() : '—'}</span></div>
              ${target.scheduled_date ? `<div><span style="color:#484f58">Scheduled: </span><span style="color:#d29922">${_esc(target.scheduled_date)}</span></div>` : ''}
              ${target.completed_at ? `<div><span style="color:#484f58">Completed: </span><span style="color:#3fb950">${new Date(target.completed_at).toLocaleDateString()}</span></div>` : ''}
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div class="rd-panel" style="margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span class="rd-label-caps" style="margin:0">Notes</span>
            <button class="rd-btn" id="rd-ov-save-notes" style="font-size:10px;padding:3px 10px">Save</button>
          </div>
          <textarea id="rd-ov-notes" rows="8" class="rd-input" placeholder="Markdown notes for this target..."
            style="resize:vertical;font-family:monospace;line-height:1.5">${_esc(target.notes || '')}</textarea>
        </div>
      </div>
    </div>
  `;

  // Edit modal
  el.querySelector('#rd-ov-edit')?.addEventListener('click', () => _showEditModal(target, onUpdate));

  // Export shortcut
  el.querySelector('#rd-ov-export')?.addEventListener('click', () => onSwitchTab('export'));

  // Save notes
  el.querySelector('#rd-ov-save-notes')?.addEventListener('click', () => {
    const notes = el.querySelector('#rd-ov-notes')?.value || '';
    onUpdate(target.id, { notes });
  });
}

function _showEditModal(target, onUpdate) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rd-modal-backdrop';
  backdrop.innerHTML = `
    <div class="rd-modal">
      <div class="rd-modal-header">
        <span>Edit Target</span>
        <button class="rd-modal-close" id="rd-edit-close">✕</button>
      </div>
      <form id="rd-edit-form" class="rd-modal-body" style="display:flex;flex-direction:column;gap:10px">
        <div class="rd-form-row">
          <label>Name<input class="rd-input" name="name" value="${_esc(target.name)}" required /></label>
          <label>IP<input class="rd-input" name="ip" value="${_esc(target.ip)}" /></label>
        </div>
        <div class="rd-form-row">
          <label>Platform
            <select class="rd-input" name="platform">
              ${['HTB','THM','CTF','Client','Internal'].map(p =>
                `<option${target.platform === p ? ' selected' : ''}>${p}</option>`
              ).join('')}
            </select>
          </label>
          <label>OS<input class="rd-input" name="os" value="${_esc(target.os || '')}" /></label>
        </div>
        <div class="rd-form-row">
          <label>Status
            <select class="rd-input" name="status">
              ${['active','paused','completed','abandoned'].map(s =>
                `<option${target.status === s ? ' selected' : ''}>${s}</option>`
              ).join('')}
            </select>
          </label>
          <label>Difficulty
            <select class="rd-input" name="difficulty">
              <option value="">—</option>
              ${['Easy','Medium','Hard','Insane'].map(d =>
                `<option${target.difficulty === d ? ' selected' : ''}>${d}</option>`
              ).join('')}
            </select>
          </label>
        </div>
        <label>Tags (comma-separated)
          <input class="rd-input" name="tags" value="${_esc((target.tags || []).join(', '))}" />
        </label>
        <button type="submit" class="rd-btn rd-btn--primary" style="align-self:flex-end">Save</button>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#rd-edit-close')?.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#rd-edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {
      name:       fd.get('name') || target.name,
      ip:         fd.get('ip') || target.ip,
      platform:   fd.get('platform'),
      os:         fd.get('os'),
      status:     fd.get('status'),
      difficulty: fd.get('difficulty') || null,
      tags:       (fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean),
    };
    backdrop.remove();
    await onUpdate(target.id, patch);
  });
}
