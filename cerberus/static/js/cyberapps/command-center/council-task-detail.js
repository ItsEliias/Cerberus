/**
 * council-task-detail.js — Phase E5 task detail modal.
 *
 * Exports:
 *   openTaskDetail(root, agent, task, opts)  — open the detail/edit modal
 *   closeTaskDetail(root)                    — close and clean up
 */

const AGENTS_API = '/api/agents';
const VALID_STATUSES = ['proposed', 'approved', 'rejected', 'in_progress', 'done'];

// ---- Helpers ----

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _emitChanged(agentId, counts) {
  document.dispatchEvent(
    new CustomEvent('cerberus-agent-tasks-changed', { detail: { agent_id: agentId, counts } })
  );
}

// ---- Close ----

export function closeTaskDetail(root) {
  const overlay = root.querySelector('.cc-task-detail-overlay');
  if (overlay) overlay.remove();
}

// ---- Open ----

export function openTaskDetail(root, agent, task, opts = {}) {
  closeTaskDetail(root);

  const { onMutated } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'cc-task-detail-overlay';

  const statusOptions = VALID_STATUSES.map(s =>
    `<option value="${s}"${s === task.status ? ' selected' : ''}>${s.replace('_', ' ').toUpperCase()}</option>`
  ).join('');

  overlay.innerHTML = `
    <div class="cc-task-detail-panel jx2-hud-frame">
      <span class="jx2-bracket-tl" aria-hidden="true"></span>
      <span class="jx2-bracket-br" aria-hidden="true"></span>

      <div class="cc-task-detail-heading">
        <span class="cc-task-detail-title-text">TASK DETAIL</span>
        <button class="cc-task-detail-close" id="cc-task-detail-close">[ X ]</button>
      </div>

      <div class="cc-task-detail-row">
        <span class="cc-task-detail-label">TITLE</span>
        <input class="cc-task-detail-input" id="cc-task-title-input"
          type="text" value="${_esc(task.title)}" maxlength="200" />
      </div>

      <div class="cc-task-detail-row cc-task-detail-row--inline">
        <div style="flex:1">
          <span class="cc-task-detail-label">STATUS</span>
          <select class="cc-task-detail-select" id="cc-task-status-select">${statusOptions}</select>
        </div>
        <div>
          <span class="cc-task-detail-label">AGENT</span>
          <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--cc-fg)">${_esc(agent.name)}</span>
        </div>
      </div>

      <div class="cc-task-detail-row">
        <span class="cc-task-detail-label">DESCRIPTION</span>
        <textarea class="cc-task-detail-textarea" id="cc-task-desc-input"
          rows="4">${_esc(task.description || '')}</textarea>
      </div>

      <div class="cc-task-detail-row">
        <span class="cc-task-detail-label">CONTEXT (JSON)</span>
        <textarea class="cc-task-detail-textarea" id="cc-task-ctx-input"
          rows="3" style="font-size:10px">${_esc(task.context_json || '{}')}</textarea>
      </div>

      <div class="cc-task-detail-timestamps">
        <span>CREATED · ${_timeAgo(task.created_at)}</span>
        <span>UPDATED · ${_timeAgo(task.updated_at)}</span>
      </div>

      <div class="cc-task-action-row">
        <button class="cc-task-action-btn cc-task-btn--approve" id="cc-task-btn-approve">[ APPROVE ]</button>
        <button class="cc-task-action-btn cc-task-btn--reject"  id="cc-task-btn-reject">[ REJECT ]</button>
        <button class="cc-task-action-btn cc-task-btn--done"    id="cc-task-btn-done">[ MARK DONE ]</button>
        <button class="cc-task-action-btn cc-task-btn--delete"  id="cc-task-btn-delete">[ DEL ]</button>
        <button class="cc-task-action-btn cc-task-btn--cancel"  id="cc-task-btn-cancel">[ CANCEL ]</button>
        <button class="cc-task-action-btn cc-task-btn--save"    id="cc-task-btn-save">[ SAVE EDITS ]</button>
      </div>
    </div>
  `;

  root.appendChild(overlay);

  const titleInput  = overlay.querySelector('#cc-task-title-input');
  const statusSel   = overlay.querySelector('#cc-task-status-select');
  const descInput   = overlay.querySelector('#cc-task-desc-input');
  const ctxInput    = overlay.querySelector('#cc-task-ctx-input');

  // ---- Close handlers ----

  overlay.querySelector('#cc-task-detail-close').addEventListener('click', () => closeTaskDetail(root));
  overlay.querySelector('#cc-task-btn-cancel').addEventListener('click',   () => closeTaskDetail(root));

  // Click on backdrop area (outside panel)
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeTaskDetail(root);
  });

  const _onKey = e => {
    if (e.key === 'Escape') { document.removeEventListener('keydown', _onKey); closeTaskDetail(root); }
  };
  document.addEventListener('keydown', _onKey);

  // ---- PATCH helper ----

  async function _patch(body) {
    const res = await fetch(
      `${AGENTS_API}/${encodeURIComponent(agent.id)}/tasks/${encodeURIComponent(task.id)}`,
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = await res.json();
    return updated;
  }

  async function _fetchCounts() {
    try {
      const r = await fetch(
        `${AGENTS_API}/${encodeURIComponent(agent.id)}/tasks/counts`,
        { credentials: 'same-origin' }
      );
      if (r.ok) return await r.json();
    } catch (_) { /* silent */ }
    return null;
  }

  function _disableAll() {
    overlay.querySelectorAll('button').forEach(b => { b.disabled = true; });
    titleInput.disabled = true;
    statusSel.disabled  = true;
    descInput.disabled  = true;
    ctxInput.disabled   = true;
  }

  async function _doStatusChange(newStatus, btnEl) {
    _disableAll();
    try {
      await _patch({ status: newStatus });
      const counts = await _fetchCounts();
      closeTaskDetail(root);
      if (onMutated) onMutated(counts);
      if (counts) _emitChanged(agent.id, counts);
    } catch (err) {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '[ ERROR ]'; }
      setTimeout(() => overlay.querySelectorAll('button').forEach(b => { b.disabled = false; }), 2000);
    }
  }

  // ---- APPROVE ----
  overlay.querySelector('#cc-task-btn-approve').addEventListener('click', async function () {
    await _doStatusChange('approved', this);
  });

  // ---- REJECT ----
  overlay.querySelector('#cc-task-btn-reject').addEventListener('click', async function () {
    await _doStatusChange('rejected', this);
  });

  // ---- MARK DONE ----
  overlay.querySelector('#cc-task-btn-done').addEventListener('click', async function () {
    await _doStatusChange('done', this);
  });

  // ---- DELETE ----
  overlay.querySelector('#cc-task-btn-delete').addEventListener('click', async function () {
    if (!confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    _disableAll();
    try {
      const res = await fetch(
        `${AGENTS_API}/${encodeURIComponent(agent.id)}/tasks/${encodeURIComponent(task.id)}`,
        { method: 'DELETE', credentials: 'same-origin' }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const counts = await _fetchCounts();
      closeTaskDetail(root);
      if (onMutated) onMutated(counts);
      if (counts) _emitChanged(agent.id, counts);
    } catch (err) {
      overlay.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
  });

  // ---- SAVE EDITS ----
  overlay.querySelector('#cc-task-btn-save').addEventListener('click', async function () {
    const newTitle = titleInput.value.trim();
    if (!newTitle) { titleInput.focus(); return; }
    _disableAll();
    try {
      await _patch({
        title:        newTitle,
        description:  descInput.value,
        status:       statusSel.value,
        context_json: ctxInput.value,
      });
      const counts = await _fetchCounts();
      closeTaskDetail(root);
      if (onMutated) onMutated(counts);
      if (counts) _emitChanged(agent.id, counts);
    } catch (err) {
      overlay.querySelectorAll('button').forEach(b => { b.disabled = false; });
      this.textContent = '[ ERROR ]';
      setTimeout(() => { this.textContent = '[ SAVE EDITS ]'; }, 2000);
    }
  });
}
