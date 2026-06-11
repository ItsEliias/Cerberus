/**
 * agents.js — Active agents/tasks table for the Operations panel.
 *
 * Renders rows from /api/cyberapps/operations/agents.
 * Each row: status dot, name, current_action, score.
 */

/** @param {HTMLElement} container */
export function createAgentsTable(container) {
  container.innerHTML = '<div class="ops-empty">Loading agents...</div>';
}

/**
 * @param {HTMLElement} container
 * @param {Array<{id:string, name:string, status:string, current_action:string, score:number}>} agents
 */
export function updateAgentsTable(container, agents) {
  if (!agents || agents.length === 0) {
    container.innerHTML = '<div class="ops-empty">No active tasks (no source for live agents)</div>';
    return;
  }

  const rows = agents.map(a => {
    const dotClass = a.status === 'running' ? 'running'
                   : a.status === 'active'  ? 'active'
                   : 'standby';
    const name = _esc(a.name || a.id || '—');
    const action = _esc(a.current_action || '—');
    const score = a.score != null ? a.score : '—';

    return `<div class="ops-agent-row">
      <span class="ops-agent-dot ${dotClass}"></span>
      <span class="ops-agent-name" title="${name}">${name}</span>
      <span class="ops-agent-action" title="${action}">${action}</span>
      <span class="ops-agent-score">${score}</span>
    </div>`;
  }).join('');

  container.innerHTML = rows;
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
