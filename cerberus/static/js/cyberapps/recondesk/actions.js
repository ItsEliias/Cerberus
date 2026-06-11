/**
 * ReconDesk — action handlers and modal helpers.
 * Receives shared state + renderAll/renderMain callbacks via init.
 */

import { rdApi } from './api.js';

export function _esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastContainer = null;

export function toast(message, type = 'info') {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.style.cssText = 'position:fixed;bottom:24px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(_toastContainer);
  }
  const colors = {
    success: { bg: 'rgba(63,185,80,0.12)',  border: 'rgba(63,185,80,0.3)',  text: '#3fb950' },
    error:   { bg: 'rgba(248,81,73,0.12)',   border: 'rgba(248,81,73,0.3)',  text: '#f85149' },
    info:    { bg: 'rgba(42,51,71,0.9)',      border: 'rgba(42,51,71,0.6)',   text: '#e2e8f0' },
  };
  const c = colors[type] || colors.info;
  const el = document.createElement('div');
  el.style.cssText = `background:${c.bg};border:1px solid ${c.border};color:${c.text};padding:8px 14px;border-radius:8px;font-size:12px;pointer-events:auto;box-shadow:0 4px 12px rgba(0,0,0,0.4)`;
  el.textContent = message;
  _toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Action factory ───────────────────────────────────────────────────────────

/**
 * Build action handlers bound to the given state + render callbacks.
 * @param {object} state - shared _state object
 * @param {function} renderAll
 * @param {function} renderMain
 * @returns {object} actions
 */
export function buildActions(state, renderAll, renderMain) {

  async function loadTarget(id) {
    try {
      const t = await rdApi.getTarget(id);
      const idx = state.targets.findIndex(x => x.id === id);
      if (idx >= 0) state.targets[idx] = { ...state.targets[idx], ...t };
      return t;
    } catch (e) {
      toast(`Error loading target: ${e.message}`, 'error');
      return null;
    }
  }

  function selectTarget(id) {
    state.activeTargetId = id;
    state.activeTab = 'overview';
    loadTarget(id).then(() => renderAll());
  }

  function showAddTargetModal() {
    _showModal(_buildAddTargetModal(state, renderAll), state, renderAll);
  }

  async function deleteTarget(id) {
    const t = state.targets.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`Delete target "${t.name}"? This removes all ports, credentials, and cards.`)) return;
    try {
      await rdApi.deleteTarget(id);
      state.targets = state.targets.filter(x => x.id !== id);
      if (state.activeTargetId === id) state.activeTargetId = null;
      renderAll();
      toast('Target deleted', 'info');
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function updateTarget(id, patch) {
    try {
      const updated = await rdApi.updateTarget(id, patch);
      const idx = state.targets.findIndex(x => x.id === id);
      if (idx >= 0) state.targets[idx] = { ...state.targets[idx], ...updated };
      renderAll();
    } catch (e) {
      toast(`Update failed: ${e.message}`, 'error');
    }
  }

  async function addEngagement(name) {
    try {
      const e = await rdApi.createEngagement({ name });
      state.engagements.push(e);
      renderAll();
      return e;
    } catch (err) {
      toast(`Could not create engagement: ${err.message}`, 'error');
      return null;
    }
  }

  async function addPort(targetId, portData) {
    try {
      const p = await rdApi.addPort(targetId, portData);
      const t = state.targets.find(x => x.id === targetId);
      if (t) { if (!t.ports) t.ports = []; t.ports.push(p); }
      renderMain();
      return p;
    } catch (e) {
      toast(`Add port failed: ${e.message}`, 'error');
      return null;
    }
  }

  async function updatePort(targetId, portId, patch) {
    try {
      const p = await rdApi.updatePort(targetId, portId, patch);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.ports) {
        const idx = t.ports.findIndex(x => x.id === portId);
        if (idx >= 0) t.ports[idx] = p;
      }
      renderMain();
    } catch (e) {
      toast(`Update port failed: ${e.message}`, 'error');
    }
  }

  async function deletePort(targetId, portId) {
    try {
      await rdApi.deletePort(targetId, portId);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.ports) t.ports = t.ports.filter(x => x.id !== portId);
      renderMain();
    } catch (e) {
      toast(`Delete port failed: ${e.message}`, 'error');
    }
  }

  async function importNmap(targetId, xml) {
    try {
      const res = await rdApi.importNmap(targetId, xml);
      await loadTarget(targetId);
      renderMain();
      toast(`Imported ${res.imported} port(s), skipped ${res.skipped}`, 'success');
    } catch (e) {
      toast(`Nmap import failed: ${e.message}`, 'error');
    }
  }

  async function addCredential(targetId, credData) {
    try {
      const c = await rdApi.addCredential(targetId, credData);
      const t = state.targets.find(x => x.id === targetId);
      if (t) { if (!t.credentials) t.credentials = []; t.credentials.push(c); }
      renderMain();
      return c;
    } catch (e) {
      toast(`Add credential failed: ${e.message}`, 'error');
      return null;
    }
  }

  async function updateCredential(targetId, credId, patch) {
    try {
      const c = await rdApi.updateCredential(targetId, credId, patch);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.credentials) {
        const idx = t.credentials.findIndex(x => x.id === credId);
        if (idx >= 0) t.credentials[idx] = c;
      }
      renderMain();
    } catch (e) {
      toast(`Update credential failed: ${e.message}`, 'error');
    }
  }

  async function deleteCredential(targetId, credId) {
    try {
      await rdApi.deleteCredential(targetId, credId);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.credentials) t.credentials = t.credentials.filter(x => x.id !== credId);
      renderMain();
    } catch (e) {
      toast(`Delete credential failed: ${e.message}`, 'error');
    }
  }

  async function addCard(targetId, cardData) {
    try {
      const c = await rdApi.addCard(targetId, cardData);
      const t = state.targets.find(x => x.id === targetId);
      if (t) { if (!t.attack_cards) t.attack_cards = []; t.attack_cards.push(c); }
      renderMain();
      return c;
    } catch (e) {
      toast(`Add card failed: ${e.message}`, 'error');
      return null;
    }
  }

  async function updateCard(targetId, cardId, patch) {
    try {
      const c = await rdApi.updateCard(targetId, cardId, patch);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.attack_cards) {
        const idx = t.attack_cards.findIndex(x => x.id === cardId);
        if (idx >= 0) t.attack_cards[idx] = c;
      }
      renderMain();
    } catch (e) {
      toast(`Update card failed: ${e.message}`, 'error');
    }
  }

  async function deleteCard(targetId, cardId) {
    try {
      await rdApi.deleteCard(targetId, cardId);
      const t = state.targets.find(x => x.id === targetId);
      if (t && t.attack_cards) t.attack_cards = t.attack_cards.filter(x => x.id !== cardId);
      renderMain();
    } catch (e) {
      toast(`Delete card failed: ${e.message}`, 'error');
    }
  }

  async function addTimelineEntry(targetId, entryType, description) {
    try {
      const e = await rdApi.addTimelineEntry(targetId, entryType, description);
      const t = state.targets.find(x => x.id === targetId);
      if (t) { if (!t.timeline) t.timeline = []; t.timeline.push(e); }
      renderMain();
    } catch (err) {
      toast(`Timeline add failed: ${err.message}`, 'error');
    }
  }

  return {
    selectTarget, showAddTargetModal, deleteTarget, updateTarget, addEngagement,
    addPort, updatePort, deletePort, importNmap,
    addCredential, updateCredential, deleteCredential,
    addCard, updateCard, deleteCard, addTimelineEntry,
  };
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function _buildAddTargetModal(state, renderAll) {
  const engOptions = state.engagements.map(e =>
    `<option value="${_esc(e.id)}">${_esc(e.name)}</option>`
  ).join('');
  return `
    <div class="rd-modal-backdrop" id="rd-modal-backdrop">
      <div class="rd-modal">
        <div class="rd-modal-header">
          <span>New Target</span>
          <button class="rd-modal-close" id="rd-modal-close">&#x2715;</button>
        </div>
        <form id="rd-add-target-form" class="rd-modal-body" style="display:flex;flex-direction:column;gap:10px">
          <div class="rd-form-row">
            <label>Name<input class="rd-input" name="name" placeholder="10.10.11.1" autofocus required /></label>
            <label>IP<input class="rd-input" name="ip" placeholder="10.10.11.1" required /></label>
          </div>
          <div class="rd-form-row">
            <label>Platform
              <select class="rd-input" name="platform">
                <option>HTB</option><option>THM</option><option>CTF</option>
                <option>Client</option><option>Internal</option>
              </select>
            </label>
            <label>OS<input class="rd-input" name="os" placeholder="Linux" /></label>
          </div>
          <div class="rd-form-row">
            <label>Difficulty
              <select class="rd-input" name="difficulty">
                <option value="">—</option>
                <option>Easy</option><option>Medium</option><option>Hard</option><option>Insane</option>
              </select>
            </label>
            <label>Engagement
              <select class="rd-input" name="engagement_id">${engOptions}</select>
            </label>
          </div>
          <button type="submit" class="rd-btn rd-btn--primary" style="align-self:flex-end">Add Target</button>
        </form>
      </div>
    </div>
  `;
}

function _showModal(html, state, renderAll) {
  const existing = document.getElementById('rd-modal-backdrop');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div.firstElementChild);

  const backdrop = document.getElementById('rd-modal-backdrop');
  const closeBtn = document.getElementById('rd-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', () => backdrop && backdrop.remove());
  if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  const form = document.getElementById('rd-add-target-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = {
        name:          fd.get('name') || '',
        ip:            fd.get('ip') || '',
        platform:      fd.get('platform') || 'HTB',
        os:            fd.get('os') || 'Unknown',
        difficulty:    fd.get('difficulty') || null,
        engagement_id: fd.get('engagement_id') || 'default',
        tags: [], notes: '',
      };
      try {
        const t = await rdApi.createTarget(body);
        state.targets.unshift(t);
        state.activeTargetId = t.id;
        state.activeTab = 'overview';
        backdrop && backdrop.remove();
        renderAll();
        toast(`Target "${t.name}" added`, 'success');
      } catch (err) {
        toast(`Add target failed: ${err.message}`, 'error');
      }
    });
  }
}
