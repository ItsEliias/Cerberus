/**
 * workspace.js — WORKSPACE sub-tab.
 *
 * Aggregates real workspace items from existing Cerberus endpoints:
 *   /api/notes            — Notes (GET)
 *   /api/tasks            — Scheduled Tasks (GET)
 *   /api/sessions         — Chat sessions (GET)
 *   /api/personal         — Library/personal docs (GET)
 *
 * Each row shows a type badge + title + date, clickable to open in Cerberus.
 */

const SOURCES = [
  { key: 'notes',    endpoint: '/api/notes',    badge: 'note',   label: 'Notes',    titleKey: 'title', dateKey: 'updated_at', link: '/notes' },
  { key: 'tasks',    endpoint: '/api/tasks',    badge: 'task',   label: 'Tasks',    titleKey: 'name',  dateKey: 'updated_at', link: '/tasks' },
  { key: 'chats',    endpoint: '/api/sessions', badge: 'chat',   label: 'Chats',    titleKey: 'title', dateKey: 'updated_at', link: '/' },
  { key: 'docs',     endpoint: '/api/personal', badge: 'doc',    label: 'Library',  titleKey: 'name',  dateKey: null,          link: '/library' },
];

export function buildWorkspaceTab() {
  return `<div class="cc-workspace-tab">
    <div class="cc-section-header">Workspace</div>
    <div id="cc-ws-body"><div class="cc-empty">Loading workspace...</div></div>
  </div>`;
}

export async function loadWorkspace(root) {
  const body = root.querySelector('#cc-ws-body');
  if (!body) return;

  const results = await Promise.allSettled(
    SOURCES.map(s => _fetchSource(s))
  );

  const sections = results.map((r, i) => {
    const src = SOURCES[i];
    const items = r.status === 'fulfilled' ? r.value : [];
    if (items.length === 0) return null;
    const rows = items.slice(0, 8).map(item => {
      const title = item[src.titleKey] || '(untitled)';
      const date = src.dateKey && item[src.dateKey]
        ? _relDate(item[src.dateKey])
        : '';
      return `<div class="cc-ws-item-row" title="${_esc(title)}" data-link="${src.link}">
        <span class="cc-ws-badge ${src.badge}">${src.badge.toUpperCase()}</span>
        <span class="cc-ws-label">${_esc(title)}</span>
        <span class="cc-ws-meta">${_esc(date)}</span>
      </div>`;
    }).join('');
    return `<div class="cc-ws-item">
      <div class="cc-card-title">${src.label} (${items.length})</div>
      ${rows}
    </div>`;
  }).filter(Boolean);

  if (sections.length === 0) {
    body.innerHTML = '<div class="cc-empty">No workspace items found</div>';
    return;
  }

  body.innerHTML = `<div class="cc-ws-grid">${sections.join('')}</div>`;

  // Wire clicks to open the right Cerberus section
  body.querySelectorAll('.cc-ws-item-row[data-link]').forEach(row => {
    row.addEventListener('click', () => {
      const link = row.dataset.link;
      if (link) window.location.href = link;
    });
  });
}

async function _fetchSource(src) {
  const res = await fetch(src.endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Each endpoint returns data differently
  if (src.key === 'notes')  return (data.notes    || data) || [];
  if (src.key === 'tasks')  return (data.tasks    || []);
  if (src.key === 'chats')  return (data.sessions || []);
  if (src.key === 'docs')   return (data.files    || data.documents || []);
  return Array.isArray(data) ? data : [];
}

function _relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = Math.round((Date.now() - d) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.round(diff/60)}m ago`;
  if (diff < 86400) return `${Math.round(diff/3600)}h ago`;
  return `${Math.round(diff/86400)}d ago`;
}

function _esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}
