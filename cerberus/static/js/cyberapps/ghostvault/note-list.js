/**
 * GhostVault — note list / sidebar view.
 * Renders a searchable, filterable list of notes grouped by folder.
 * Pinned notes appear in their own section at the top.
 *
 * @param {HTMLElement} container
 * @param {string} vaultToken
 * @param {object[]} notes          — notes array (no content field)
 * @param {string[]} folders
 * @param {(note: object) => void} onSelect
 * @param {() => void} onNewNote
 * @param {(folder: string) => void} onNewFolder
 * @param {(noteId: string) => void} onDelete
 */
export function renderNoteList(
  container, vaultToken, notes, folders,
  onSelect, onNewNote, onNewFolder, onDelete
) {
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'gv-notelist';

  shell.innerHTML = `
    <div class="gv-notelist-toolbar">
      <input type="text" class="gv-input gv-search-input" placeholder="Search notes…" id="gv-search" />
      <button class="gv-btn gv-btn-primary gv-new-note-btn" title="New note">+ Note</button>
    </div>
    <div class="gv-notelist-actions">
      <button class="gv-btn gv-btn-ghost gv-new-folder-btn">+ Folder</button>
      <select class="gv-select gv-folder-filter" title="Filter by folder">
        <option value="">All folders</option>
        ${folders.map(f => `<option value="${_esc(f)}">${_esc(f)}</option>`).join('')}
      </select>
    </div>
    <div class="gv-notelist-body" id="gv-notelist-body"></div>
  `;
  container.appendChild(shell);

  const searchEl = shell.querySelector('#gv-search');
  const folderFilter = shell.querySelector('.gv-folder-filter');
  const bodyEl = shell.querySelector('#gv-notelist-body');

  searchEl.addEventListener('input', _render);
  folderFilter.addEventListener('change', _render);
  shell.querySelector('.gv-new-note-btn').addEventListener('click', onNewNote);
  shell.querySelector('.gv-new-folder-btn').addEventListener('click', () => {
    const name = prompt('New folder name:');
    if (name && name.trim()) onNewFolder(name.trim());
  });

  _render();

  function _render() {
    const q = searchEl.value.toLowerCase();
    const filterFolder = folderFilter.value;

    let filtered = notes;
    if (q) {
      filtered = filtered.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.folder || '').toLowerCase().includes(q) ||
        (n.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    if (filterFolder) {
      filtered = filtered.filter(n => n.folder === filterFolder);
    }

    const pinned = filtered.filter(n => n.pinned);
    const unpinned = filtered.filter(n => !n.pinned);

    bodyEl.innerHTML = '';

    if (!filtered.length) {
      bodyEl.innerHTML = '<div class="gv-empty">No notes found</div>';
      return;
    }

    if (pinned.length) {
      bodyEl.appendChild(_section('Pinned', pinned));
    }

    // Group unpinned by folder
    const byFolder = {};
    for (const n of unpinned) {
      const f = n.folder || 'Notes';
      (byFolder[f] = byFolder[f] || []).push(n);
    }
    for (const [folder, fNotes] of Object.entries(byFolder)) {
      bodyEl.appendChild(_section(folder, fNotes));
    }
  }

  function _section(label, sNotes) {
    const sec = document.createElement('div');
    sec.className = 'gv-notelist-section';
    sec.innerHTML = `<div class="gv-section-header">${_esc(label)} <span class="gv-note-count">${sNotes.length}</span></div>`;
    for (const n of sNotes) {
      sec.appendChild(_noteRow(n));
    }
    return sec;
  }

  function _noteRow(n) {
    const row = document.createElement('div');
    row.className = 'gv-note-row';
    row.dataset.id = n.id;

    const tags = (n.tags || []).slice(0, 3).map(t => `<span class="gv-tag">${_esc(t)}</span>`).join('');
    const date = n.updated_at ? n.updated_at.slice(0, 10) : '';

    row.innerHTML = `
      <div class="gv-note-row-title">${_esc(n.title)}${n.pinned ? ' <span class="gv-pin-dot">●</span>' : ''}</div>
      <div class="gv-note-row-meta">${date}${tags ? ' · ' + tags : ''}</div>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.gv-note-delete-btn')) return;
      document.querySelectorAll('.gv-note-row.active').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      onSelect(n);
    });

    // Right-click context menu for delete
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showContextMenu(e.clientX, e.clientY, n, row);
    });

    return row;
  }

  function _showContextMenu(x, y, n, row) {
    document.querySelectorAll('.gv-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gv-context-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:500;`;
    menu.innerHTML = `
      <div class="gv-ctx-item gv-ctx-danger" id="gv-ctx-delete">Delete note</div>
    `;
    document.body.appendChild(menu);

    menu.querySelector('#gv-ctx-delete').addEventListener('click', () => {
      menu.remove();
      if (confirm(`Delete "${n.title}"?`)) onDelete(n.id);
    });

    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
  }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}
