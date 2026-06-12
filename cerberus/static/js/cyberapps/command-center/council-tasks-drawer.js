/**
 * council-tasks-drawer.js — Phase E5 per-agent tasks drawer.
 *
 * Exports:
 *   openTasksDrawer(root, agent)  — slide in the task drawer for `agent`
 *   closeTasksDrawer(root)        — slide out and clean up
 */

import { getGlyph } from './council-glyphs.js';
import { openTaskDetail } from './council-task-detail.js';

const AGENTS_API = '/api/agents';

const FILTER_LABELS = ['all', 'proposed', 'approved', 'in_progress', 'rejected', 'done'];

// ---- Helpers ----

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function _pillClass(status) {
  const map = {
    proposed:    'cc-task-status--proposed',
    approved:    'cc-task-status--approved',
    in_progress: 'cc-task-status--in_progress',
    rejected:    'cc-task-status--rejected',
    done:        'cc-task-status--done',
  };
  return map[status] || 'cc-task-status--proposed';
}

function _emitChanged(agentId, counts) {
  document.dispatchEvent(
    new CustomEvent('cerberus-agent-tasks-changed', { detail: { agent_id: agentId, counts } })
  );
}

// ---- Close ----

export function closeTasksDrawer(root) {
  const backdrop = root.querySelector('.cc-tasks-drawer-backdrop');
  const drawer   = root.querySelector('.cc-tasks-drawer');
  const reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function _remove() {
    backdrop && backdrop.remove();
    drawer   && drawer.remove();
  }

  if (reduced || !drawer) { _remove(); return; }

  drawer.classList.remove('cc-tasks-drawer--open');
  backdrop && backdrop.classList.remove('cc-tasks-backdrop--visible');
  setTimeout(_remove, 270);
}

// ---- Open ----

export function openTasksDrawer(root, agent) {
  const existing = root.querySelector('.cc-tasks-drawer');
  if (existing) {
    closeTasksDrawer(root);
    if (existing.dataset.agentId === agent.id) return;
  }

  const reduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const portrait = getGlyph(agent.name);

  // State
  let _filter = 'all';
  let _tasks  = [];
  let _counts = { proposed: 0, approved: 0, in_progress: 0, rejected: 0, done: 0 };

  // Build backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'cc-tasks-drawer-backdrop';
  backdrop.addEventListener('click', () => closeTasksDrawer(root));

  // Build drawer
  const drawer = document.createElement('div');
  drawer.className = 'cc-tasks-drawer jx2-hud-frame';
  drawer.dataset.agentId = agent.id;
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', `Tasks for ${agent.name}`);

  drawer.innerHTML = `
    <span class="jx2-bracket-tl" aria-hidden="true"></span>
    <span class="jx2-bracket-br" aria-hidden="true"></span>
    <div class="cc-tasks-header">
      <div class="cc-tasks-header-portrait">${portrait}</div>
      <div class="cc-tasks-header-info">
        <span class="cc-tasks-header-name">${_esc(agent.name).toUpperCase()} — TASKS</span>
        <span class="cc-tasks-header-sub">${_esc(agent.role || '')}</span>
      </div>
      <button class="cc-tasks-close-btn" aria-label="Close tasks">[ X ]</button>
    </div>
    <div class="cc-tasks-filters" id="cc-tasks-filters-${_esc(agent.id)}"></div>
    <div class="cc-tasks-list" id="cc-tasks-list-${_esc(agent.id)}">
      <div class="cc-tasks-empty">Loading tasks...</div>
    </div>
    <div class="cc-tasks-footer" id="cc-tasks-footer-${_esc(agent.id)}">
      <button class="cc-tasks-new-btn" id="cc-tasks-new-btn-${_esc(agent.id)}">[ + NEW TASK ]</button>
    </div>
  `;

  root.appendChild(backdrop);
  root.appendChild(drawer);

  // Animate in
  requestAnimationFrame(() => {
    if (!reduced) {
      requestAnimationFrame(() => {
        drawer.classList.add('cc-tasks-drawer--open');
        backdrop.classList.add('cc-tasks-backdrop--visible');
      });
    } else {
      drawer.classList.add('cc-tasks-drawer--open');
      backdrop.classList.add('cc-tasks-backdrop--visible');
    }
  });

  // Wire close
  drawer.querySelector('.cc-tasks-close-btn').addEventListener('click', () => closeTasksDrawer(root));

  // Wire Esc
  const _onKey = e => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', _onKey);
      closeTasksDrawer(root);
    }
  };
  document.addEventListener('keydown', _onKey);

  // Wire new task
  const newBtn = drawer.querySelector(`#cc-tasks-new-btn-${agent.id}`);
  if (newBtn) newBtn.addEventListener('click', () => _showCreateForm(drawer, agent, _onMutated));

  // ---- Render helpers ----

  function _renderFilters() {
    const bar = drawer.querySelector(`#cc-tasks-filters-${agent.id}`);
    if (!bar) return;
    bar.innerHTML = FILTER_LABELS.map(f => {
      const count = f === 'all'
        ? Object.values(_counts).reduce((a, b) => a + b, 0)
        : (_counts[f] ?? 0);
      const active = f === _filter ? ' active' : '';
      return `<button class="cc-tasks-filter-btn${active}" data-filter="${f}">
        ${f.toUpperCase().replace('_', ' ')}
        <span class="cc-tasks-filter-count">${count}</span>
      </button>`;
    }).join('');

    bar.querySelectorAll('.cc-tasks-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _filter = btn.dataset.filter;
        _renderFilters();
        _renderList();
      });
    });
  }

  function _renderList() {
    const list = drawer.querySelector(`#cc-tasks-list-${agent.id}`);
    if (!list) return;
    const visible = _filter === 'all' ? _tasks : _tasks.filter(t => t.status === _filter);
    if (!visible.length) {
      list.innerHTML = `<div class="cc-tasks-empty">No tasks${_filter !== 'all' ? ` with status "${_filter}"` : ''}.</div>`;
      return;
    }
    list.innerHTML = visible.map(t => `
      <div class="cc-task-row" data-task-id="${_esc(t.id)}">
        <div class="cc-task-row-title">${_esc(t.title)}</div>
        <div class="cc-task-row-meta">
          <span class="cc-task-status-pill ${_pillClass(t.status)}">${_esc(t.status).replace('_', ' ')}</span>
          <span>${_timeAgo(t.created_at)}</span>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.cc-task-row').forEach(row => {
      row.addEventListener('click', () => {
        const task = _tasks.find(t => t.id === row.dataset.taskId);
        if (task) openTaskDetail(root, agent, task, { onMutated: _onMutated });
      });
    });
  }

  // ---- Fetch & mutate ----

  async function _fetch() {
    try {
      const res = await fetch(`${AGENTS_API}/${encodeURIComponent(agent.id)}/tasks`, {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      _tasks  = data.tasks  || [];
      _counts = data.counts || _counts;
      _renderFilters();
      _renderList();
    } catch (_) { /* silent */ }
  }

  function _onMutated(counts) {
    if (counts) _counts = { ..._counts, ...counts };
    _fetch().then(() => {
      _emitChanged(agent.id, _counts);
    });
  }

  _fetch();
}

// ---- Inline create form ----

function _showCreateForm(drawer, agent, onMutated) {
  const footer = drawer.querySelector(`#cc-tasks-footer-${agent.id}`);
  if (!footer) return;

  // Prevent duplicate forms
  if (footer.querySelector('.cc-tasks-create-form')) return;

  const newBtn = footer.querySelector(`#cc-tasks-new-btn-${agent.id}`);
  if (newBtn) newBtn.style.display = 'none';

  const form = document.createElement('div');
  form.className = 'cc-tasks-create-form';
  form.innerHTML = `
    <input class="cc-tasks-create-input" type="text" placeholder="Task title (required)" maxlength="200" />
    <textarea class="cc-tasks-create-textarea" rows="2" placeholder="Description (optional)"></textarea>
    <div class="cc-tasks-create-actions">
      <button class="cc-tasks-create-submit">[ CREATE ]</button>
      <button class="cc-tasks-create-cancel">[ CANCEL ]</button>
    </div>
  `;
  footer.appendChild(form);

  const titleInput = form.querySelector('.cc-tasks-create-input');
  const descInput  = form.querySelector('.cc-tasks-create-textarea');
  const submitBtn  = form.querySelector('.cc-tasks-create-submit');
  const cancelBtn  = form.querySelector('.cc-tasks-create-cancel');

  titleInput.focus();

  cancelBtn.addEventListener('click', () => {
    form.remove();
    if (newBtn) newBtn.style.display = '';
  });

  submitBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    submitBtn.disabled = true;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/tasks`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: descInput.value.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      form.remove();
      if (newBtn) newBtn.style.display = '';
      onMutated(null);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = '[ ERROR ]';
      setTimeout(() => { submitBtn.textContent = '[ CREATE ]'; }, 2000);
    }
  });

  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitBtn.click(); }
    if (e.key === 'Escape') cancelBtn.click();
  });
}
