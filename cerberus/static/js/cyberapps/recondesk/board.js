/**
 * ReconDesk — Attack Board (Kanban).
 * Kill-chain columns: recon → enum → exploit → post → privesc → loot.
 * Drag-and-drop between columns; click card to open detail modal.
 */
import { _esc } from './index.js';

const STAGES = [
  { id: 'recon',   label: 'Recon',   color: '#4a9eff', wip: 5 },
  { id: 'enum',    label: 'Enum',    color: '#d29922', wip: 5 },
  { id: 'exploit', label: 'Exploit', color: '#f85149', wip: 4 },
  { id: 'post',    label: 'Post',    color: '#b44fff', wip: 4 },
  { id: 'privesc', label: 'PrivEsc', color: '#ff8c42', wip: 3 },
  { id: 'loot',    label: 'Loot',    color: '#3fb950', wip: 5 },
];

const STATUS_COLORS = {
  todo: '#4a5568', inprogress: '#d29922', done: '#3fb950', blocked: '#f85149',
};

export function renderBoard(el, target, handlers) {
  const { onAddCard, onUpdateCard, onDeleteCard } = handlers;
  const cards = target.attack_cards || [];
  let draggingId = null;

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="rd-section-header">
        <span class="rd-section-title">Attack Board<span class="rd-section-sub">(${cards.length} cards)</span></span>
        <div style="display:flex;gap:10px;font-size:10px;color:#4a5568">
          ${['todo','inprogress','done','blocked'].map(s => {
            const n = cards.filter(c => c.status === s).length;
            if (n === 0) return '';
            return `<span style="display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:${STATUS_COLORS[s]}"></span><span style="color:${STATUS_COLORS[s]}">${n}</span> ${s}</span>`;
          }).join('')}
        </div>
      </div>

      <div style="flex:1;overflow-x:auto;overflow-y:hidden">
        <div style="display:flex;height:100%;min-width:max-content" id="rd-board-cols">
          ${STAGES.map(stage => {
            const sc = cards.filter(c => c.stage === stage.id);
            const atWip = sc.length >= stage.wip;
            return `
              <div class="rd-board-col" data-stage="${stage.id}"
                style="width:200px;display:flex;flex-direction:column;border-right:1px solid rgba(42,51,71,0.5);flex-shrink:0">
                <div style="padding:10px 12px;border-bottom:1px solid rgba(42,51,71,0.5);border-left:3px solid ${atWip ? 'rgba(210,153,34,0.55)' : stage.color+'55'};flex-shrink:0;display:flex;align-items:center;justify-content:space-between">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="width:6px;height:6px;border-radius:50%;background:${atWip ? '#d29922' : stage.color}"></span>
                    <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${atWip ? '#d29922' : stage.color}">${stage.label}</span>
                    ${atWip ? '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(210,153,34,0.12);border:1px solid rgba(210,153,34,0.25);color:#d29922">WIP</span>' : ''}
                  </div>
                  <span style="font-size:9px;font-weight:700;font-family:monospace;min-width:28px;text-align:center;padding:1px 5px;border-radius:10px;
                    color:${atWip ? '#d29922' : (sc.length > 0 ? stage.color : '#484f58')};
                    background:${atWip ? 'rgba(210,153,34,0.15)' : (sc.length > 0 ? stage.color+'18' : 'rgba(42,51,71,0.18)')};
                    border:1px solid ${atWip ? 'rgba(210,153,34,0.35)' : (sc.length > 0 ? stage.color+'30' : 'rgba(42,51,71,0.3)')}"
                    title="${sc.length} of ${stage.wip} WIP limit">${sc.length}/${stage.wip}</span>
                </div>
                <div class="rd-board-cards" data-stage="${stage.id}" style="flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px">
                  ${sc.map(card => _renderCard(card, target)).join('')}
                </div>
                <div style="padding:8px;flex-shrink:0">
                  <button class="rd-btn rd-board-add" data-stage="${stage.id}"
                    style="width:100%;font-size:10px;border-style:dashed;color:#4a5568">+ Add</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  // Drag & drop
  el.querySelectorAll('.rd-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggingId = card.dataset.cardId;
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  el.querySelectorAll('.rd-board-col').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.style.background = 'rgba(210,153,34,0.04)'; });
    col.addEventListener('dragleave', () => { col.style.background = ''; });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.style.background = '';
      if (!draggingId) return;
      const newStage = col.dataset.stage;
      const card = (target.attack_cards || []).find(c => c.id === draggingId);
      if (card && card.stage !== newStage) {
        await onUpdateCard(target.id, draggingId, { stage: newStage });
      }
      draggingId = null;
    });
  });

  // Add card
  el.querySelectorAll('.rd-board-add').forEach(btn => {
    btn.addEventListener('click', () => _showAddCardModal(btn.dataset.stage, target, onAddCard));
  });

  // Click card → detail modal
  el.querySelectorAll('.rd-card').forEach(card => {
    card.addEventListener('click', () => {
      const c = (target.attack_cards || []).find(x => x.id === card.dataset.cardId);
      if (c) _showCardModal(c, target, onUpdateCard, onDeleteCard);
    });
  });
}

function _renderCard(card, target) {
  const ports = (target.ports || []).filter(p => (card.linked_port_ids || []).includes(p.id));
  const creds = (target.credentials || []).filter(c => (card.linked_credential_ids || []).includes(c.id));
  const dot = STATUS_COLORS[card.status] || '#4a5568';
  const bg = card.status === 'done'
    ? 'background:rgba(63,185,80,0.04);border-color:rgba(63,185,80,0.18)'
    : card.status === 'blocked'
    ? 'background:rgba(248,81,73,0.04);border-color:rgba(248,81,73,0.18)'
    : 'background:#12131a;border-color:rgba(42,51,71,0.7)';
  return `
    <div class="rd-card" data-card-id="${_esc(card.id)}" draggable="true"
      style="border-radius:8px;border:1px solid;padding:10px;cursor:pointer;${bg}">
      <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px">
        <span style="width:6px;height:6px;border-radius:50%;background:${dot};flex-shrink:0;margin-top:4px"></span>
        <span style="font-size:11px;font-weight:500;color:${card.status === 'done' ? '#8b949e' : '#e2e8f0'};
          ${card.status === 'done' ? 'text-decoration:line-through' : ''};flex:1;word-break:break-word">${_esc(card.title)}</span>
      </div>
      ${card.description ? `<p style="font-size:10px;color:#4a5568;line-height:1.4;margin:0 0 6px 12px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${_esc(card.description)}</p>` : ''}
      ${ports.length > 0 || creds.length > 0 ? `
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin:0 0 4px 12px">
          ${ports.map(p => `<span class="rd-badge" style="color:rgba(74,158,255,0.8);background:rgba(74,158,255,0.1);border-color:rgba(74,158,255,0.15);font-family:monospace">:${p.port}</span>`).join('')}
          ${creds.map(c => `<span class="rd-badge" style="color:rgba(248,81,73,0.8);background:rgba(248,81,73,0.1);border-color:rgba(248,81,73,0.15);font-family:monospace">${_esc(c.username || 'cred')}</span>`).join('')}
        </div>
      ` : ''}
      <div style="display:flex;align-items:center;margin-left:12px">
        <span class="rd-badge" style="font-size:9px;color:${dot};background:${dot}15;border-color:${dot}25">
          ${card.status === 'inprogress' ? 'in progress' : card.status}
        </span>
      </div>
    </div>
  `;
}

function _showAddCardModal(stage, target, onAddCard) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rd-modal-backdrop';
  backdrop.innerHTML = `
    <div class="rd-modal" style="width:400px">
      <div class="rd-modal-header">
        <span>New Card — ${_esc(stage)}</span>
        <button class="rd-modal-close" id="rd-ac-close">✕</button>
      </div>
      <div class="rd-modal-body" style="display:flex;flex-direction:column;gap:10px">
        <input class="rd-input" id="rd-ac-title" placeholder="Card title..." autofocus />
        <textarea class="rd-input" id="rd-ac-desc" rows="3" placeholder="Short description..."></textarea>
        <button class="rd-btn rd-btn--primary" id="rd-ac-submit" style="align-self:flex-end">Add Card</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#rd-ac-close')?.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#rd-ac-submit')?.addEventListener('click', async () => {
    const title = backdrop.querySelector('#rd-ac-title').value.trim();
    if (!title) return;
    await onAddCard(target.id, {
      title,
      description: backdrop.querySelector('#rd-ac-desc').value.trim(),
      stage,
      status: 'todo',
      linked_port_ids: [],
      linked_credential_ids: [],
    });
    backdrop.remove();
  });
}

function _showCardModal(card, target, onUpdateCard, onDeleteCard) {
  const backdrop = document.createElement('div');
  backdrop.className = 'rd-modal-backdrop';
  const statusOpts = ['todo','inprogress','done','blocked'];
  backdrop.innerHTML = `
    <div class="rd-modal" style="width:520px">
      <div class="rd-modal-header">
        <input class="rd-input" id="rd-cm-title" value="${_esc(card.title)}" style="font-size:13px;font-weight:600;background:none;border:none;padding:0;flex:1" />
        <button class="rd-modal-close" id="rd-cm-close">✕</button>
      </div>
      <div class="rd-modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:8px">
          <div style="flex:1">
            <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Status</label>
            <select class="rd-input" id="rd-cm-status">
              ${statusOpts.map(s => `<option${card.status === s ? ' selected' : ''} value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1">
            <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Stage</label>
            <select class="rd-input" id="rd-cm-stage">
              ${['recon','enum','exploit','post','privesc','loot'].map(s => `<option${card.stage === s ? ' selected' : ''} value="${s}">${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Description</label>
          <textarea class="rd-input" id="rd-cm-desc" rows="3">${_esc(card.description || '')}</textarea>
        </div>
        <div>
          <label style="font-size:10px;color:#484f58;text-transform:uppercase;letter-spacing:.07em">Notes</label>
          <textarea class="rd-input" id="rd-cm-notes" rows="4" style="font-family:monospace">${_esc(card.notes || '')}</textarea>
        </div>
        <div style="display:flex;justify-content:space-between">
          <button class="rd-btn rd-btn--danger" id="rd-cm-delete">Delete</button>
          <button class="rd-btn rd-btn--primary" id="rd-cm-save">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#rd-cm-close')?.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#rd-cm-save')?.addEventListener('click', async () => {
    await onUpdateCard(target.id, card.id, {
      title:       backdrop.querySelector('#rd-cm-title').value.trim() || card.title,
      status:      backdrop.querySelector('#rd-cm-status').value,
      stage:       backdrop.querySelector('#rd-cm-stage').value,
      description: backdrop.querySelector('#rd-cm-desc').value,
      notes:       backdrop.querySelector('#rd-cm-notes').value,
    });
    backdrop.remove();
  });
  backdrop.querySelector('#rd-cm-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete card "${card.title}"?`)) return;
    await onDeleteCard(target.id, card.id);
    backdrop.remove();
  });
}
