/**
 * GhostVault — note editor view.
 * Renders a split-pane markdown editor with autosave, tag editing,
 * folder assignment, pin toggle, and word-count status bar.
 *
 * @param {HTMLElement} container
 * @param {string} vaultToken
 * @param {object} note   — full note object from API
 * @param {string[]} folders
 * @param {(note: object) => void} onSaved   — called after successful save
 * @param {() => void} onBack                — called to return to note list
 */
export function renderEditor(container, vaultToken, note, folders, onSaved, onBack) {
  container.innerHTML = '';

  let _content = note.content || '';
  let _dirty = false;
  let _autosaveTimer = null;

  const shell = document.createElement('div');
  shell.className = 'gv-editor-shell';
  shell.innerHTML = `
    <div class="gv-editor-toolbar">
      <button class="gv-btn gv-btn-ghost gv-back-btn" title="Back to notes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Notes
      </button>
      <select class="gv-select gv-folder-select" title="Folder">
        ${folders.map(f => `<option value="${_esc(f)}"${note.folder === f ? ' selected' : ''}>${_esc(f)}</option>`).join('')}
      </select>
      <button class="gv-btn gv-pin-btn${note.pinned ? ' active' : ''}" title="Pin note">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${note.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
      </button>
      <div class="gv-editor-spacer"></div>
      <button class="gv-btn gv-btn-primary gv-save-btn" id="gv-save-btn">Save</button>
    </div>
    <div class="gv-editor-title-row">
      <input type="text" class="gv-input gv-title-input" value="${_esc(note.title)}" placeholder="Note title…" />
    </div>
    <div class="gv-editor-panes" id="gv-editor-panes">
      <textarea class="gv-editor-textarea" id="gv-textarea" spellcheck="true" placeholder="Start writing in Markdown…">${_esc(_content)}</textarea>
    </div>
    <div class="gv-editor-statusbar">
      <span id="gv-word-count">0 words</span>
      <span id="gv-dirty-indicator"></span>
    </div>
  `;
  container.appendChild(shell);

  const textarea = shell.querySelector('#gv-textarea');
  const saveBtn = shell.querySelector('#gv-save-btn');
  const backBtn = shell.querySelector('.gv-back-btn');
  const pinBtn = shell.querySelector('.gv-pin-btn');
  const folderSel = shell.querySelector('.gv-folder-select');
  const titleInput = shell.querySelector('.gv-title-input');
  const wordCountEl = shell.querySelector('#gv-word-count');
  const dirtyEl = shell.querySelector('#gv-dirty-indicator');

  _updateWordCount();

  // -- Events ---------------------------------------------------------------

  textarea.addEventListener('input', () => {
    _content = textarea.value;
    _dirty = true;
    dirtyEl.textContent = '● unsaved';
    _updateWordCount();
    _scheduleAutosave();
  });

  titleInput.addEventListener('input', () => {
    _dirty = true;
    dirtyEl.textContent = '● unsaved';
  });

  saveBtn.addEventListener('click', _doSave);

  backBtn.addEventListener('click', () => {
    clearTimeout(_autosaveTimer);
    onBack();
  });

  pinBtn.addEventListener('click', async () => {
    try {
      const res = await fetch(`/api/cyberapps/ghostvault/notes/${note.id}/pin`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken },
      });
      if (res.ok) {
        const d = await res.json();
        note.pinned = d.pinned;
        pinBtn.classList.toggle('active', d.pinned);
        pinBtn.querySelector('svg').setAttribute('fill', d.pinned ? 'currentColor' : 'none');
      }
    } catch (_) {}
  });

  // Cmd/Ctrl+S to save
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      _doSave();
    }
  });

  // -- Helpers --------------------------------------------------------------

  function _updateWordCount() {
    const words = _content.trim() ? _content.trim().split(/\s+/).length : 0;
    wordCountEl.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  }

  function _scheduleAutosave() {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(_doSave, 2000);
  }

  async function _doSave() {
    clearTimeout(_autosaveTimer);
    const title = titleInput.value.trim();
    if (!title) { dirtyEl.textContent = '⚠ title required'; return; }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const res = await fetch(`/api/cyberapps/ghostvault/notes/${note.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': vaultToken,
        },
        body: JSON.stringify({
          title,
          content: _content,
          folder: folderSel.value,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        note = d.note;
        _dirty = false;
        dirtyEl.textContent = '✓ saved';
        setTimeout(() => { if (!_dirty) dirtyEl.textContent = ''; }, 2000);
        onSaved(note);
      } else {
        dirtyEl.textContent = '⚠ save failed';
      }
    } catch (_) {
      dirtyEl.textContent = '⚠ network error';
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}
