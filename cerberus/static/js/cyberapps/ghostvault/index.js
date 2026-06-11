/**
 * GhostVault — Cerberus native app entry point.
 *
 * GhostVault is the AI-powered markdown note workspace of the CYBERTOOLS
 * ecosystem — "Obsidian fused with a tactical cyber workspace."
 *
 * What makes GhostVault distinct from CredVault / VaultCore:
 *   - CredVault  → stores credentials (passwords, hashes, TOTP secrets)
 *   - VaultCore  → orchestrates external source scraping into a vault
 *   - GhostVault → markdown note capture, editing, and AI structuring
 *
 * All three share the same Cerberus-wide vault (one master password).
 * Note *content* is Fernet-encrypted at rest (domain key: ghostvault-notes-v1).
 *
 * Views: Notes (list + editor) | Templates | Settings
 *
 * Implements the CyberAppContext contract:
 *   init(container, ctx)  — render app
 *   destroy()             — clean up
 */

import { renderVaultGate }  from './vault-gate.js';
import { renderNoteList }   from './note-list.js';
import { renderEditor }     from './editor.js';
import { renderTemplates }  from './templates.js';
import { renderSettings }   from './settings-view.js';

// ---------------------------------------------------------------------------
// Module state (persists across panel open/close)
// ---------------------------------------------------------------------------
let _container   = null;
let _ctx         = null;
let _vaultToken  = null;
let _activeTab   = 'notes';
let _notes       = [];
let _folders     = [];
let _activeNote  = null;  // note object currently open in editor

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function init(container, ctx) {
  _container = container;
  _ctx = ctx;
  _vaultToken = sessionStorage.getItem('gv-vault-token') || null;
  _checkVaultAndRender();
}

export function destroy() {
  _container = null;
  _ctx = null;
}

// ---------------------------------------------------------------------------
// Vault gate
// ---------------------------------------------------------------------------

async function _checkVaultAndRender() {
  try {
    const res = await fetch('/api/cyberapps/vault/status');
    const data = await res.json();
    if (!data.initialized) {
      renderVaultGate(_container, 'setup', _onVaultUnlocked);
    } else if (data.locked || !_vaultToken) {
      renderVaultGate(_container, 'unlock', _onVaultUnlocked);
    } else {
      await _loadData();
      _renderApp();
    }
  } catch (err) {
    _container.innerHTML = `<div class="gv-error" style="padding:20px;">
      Failed to reach Cerberus backend: ${_esc(String(err))}
    </div>`;
  }
}

function _onVaultUnlocked(token) {
  _vaultToken = token;
  sessionStorage.setItem('gv-vault-token', token);
  if (window.CyberApps && window.CyberApps.notifyVaultUnlocked) {
    window.CyberApps.notifyVaultUnlocked();
  }
  _loadData().then(() => _renderApp());
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function _loadData() {
  await Promise.all([_fetchNotes(), _fetchFolders()]);
}

async function _fetchNotes() {
  try {
    const res = await fetch('/api/cyberapps/ghostvault/notes', {
      headers: { 'X-Vault-Token': _vaultToken || '' },
    });
    if (res.ok) {
      const d = await res.json();
      _notes = d.notes || [];
    }
  } catch (_) {}
}

async function _fetchFolders() {
  try {
    const res = await fetch('/api/cyberapps/ghostvault/folders');
    if (res.ok) {
      const d = await res.json();
      _folders = d.folders || [];
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

function _renderApp() {
  if (!_container) return;
  _container.innerHTML = '';
  _injectStyles();

  const shell = document.createElement('div');
  shell.className = 'gv-shell';
  shell.innerHTML = `
    <div class="gv-header">
      <div class="gv-header-left">
        <span class="gv-logo-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </span>
        <span class="gv-title">GhostVault</span>
      </div>
      <span class="gv-vault-badge">vault unlocked</span>
    </div>
    <nav class="gv-tabs" role="tablist">
      ${_tabBtn('notes',     'Notes')}
      ${_tabBtn('templates', 'Templates')}
      ${_tabBtn('settings',  'Settings')}
    </nav>
    <div class="gv-body" id="gv-body"></div>
  `;
  _container.appendChild(shell);

  shell.querySelectorAll('.gv-tab-btn').forEach(btn =>
    btn.addEventListener('click', () => _switchTab(btn.dataset.tab))
  );

  _switchTab(_activeTab);
}

function _tabBtn(id, label) {
  return `<button class="gv-tab-btn${id === _activeTab ? ' active' : ''}" data-tab="${id}" role="tab">
    ${label}
  </button>`;
}

function _switchTab(tab) {
  _activeTab = tab;
  const body = document.getElementById('gv-body');
  if (!body) return;
  body.innerHTML = '';

  document.querySelectorAll('.gv-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );

  switch (tab) {
    case 'notes':
      _renderNotesTab(body);
      break;
    case 'templates':
      renderTemplates(body, _vaultToken, _folders, (note) => {
        _notes.unshift(note);
        _activeNote = note;
        _switchTab('notes');
      });
      break;
    case 'settings':
      renderSettings(body, _vaultToken, _onLock);
      break;
  }
}

// ---------------------------------------------------------------------------
// Notes tab — split: list on left, editor on right
// ---------------------------------------------------------------------------

function _renderNotesTab(body) {
  body.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'gv-notes-layout';

  const listPane = document.createElement('div');
  listPane.className = 'gv-list-pane';

  const editorPane = document.createElement('div');
  editorPane.className = 'gv-editor-pane';

  layout.appendChild(listPane);
  layout.appendChild(editorPane);
  body.appendChild(layout);

  const _mountList = () => {
    renderNoteList(
      listPane, _vaultToken, _notes, _folders,
      async (note) => {
        const res = await fetch(`/api/cyberapps/ghostvault/notes/${note.id}`, {
          headers: { 'X-Vault-Token': _vaultToken || '' },
        });
        if (res.ok) {
          const d = await res.json();
          _activeNote = d.note;
          _mountEditor();
        }
      },
      async () => {
        const title = prompt('New note title:');
        if (!title || !title.trim()) return;
        const folder = _folders[0] || 'Notes';
        const res = await fetch('/api/cyberapps/ghostvault/notes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Vault-Token': _vaultToken || '',
          },
          body: JSON.stringify({ title: title.trim(), folder }),
        });
        if (res.ok) {
          const d = await res.json();
          _notes.unshift(d.note);
          _activeNote = d.note;
          _mountList();
          _mountEditor();
        }
      },
      async (name) => {
        const res = await fetch('/api/cyberapps/ghostvault/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (res.ok) {
          const d = await res.json();
          _folders = d.folders;
          _mountList();
        }
      },
      async (noteId) => {
        const res = await fetch(`/api/cyberapps/ghostvault/notes/${noteId}`, {
          method: 'DELETE',
          headers: { 'X-Vault-Token': _vaultToken || '' },
        });
        if (res.ok) {
          _notes = _notes.filter(n => n.id !== noteId);
          if (_activeNote && _activeNote.id === noteId) {
            _activeNote = null;
            editorPane.innerHTML = '<div class="gv-empty" style="padding:40px;">Select a note to edit</div>';
          }
          _mountList();
        }
      }
    );
  };

  const _mountEditor = () => {
    if (!_activeNote) {
      editorPane.innerHTML = '<div class="gv-empty" style="padding:40px;">Select a note to edit</div>';
      return;
    }
    renderEditor(
      editorPane, _vaultToken, _activeNote, _folders,
      (saved) => {
        const idx = _notes.findIndex(n => n.id === saved.id);
        if (idx >= 0) {
          _notes[idx] = { ..._notes[idx], ...saved, content: undefined };
        }
        _activeNote = saved;
        _mountList();
      },
      () => {
        _activeNote = null;
        editorPane.innerHTML = '<div class="gv-empty" style="padding:40px;">Select a note to edit</div>';
      }
    );
  };

  _mountList();
  if (_activeNote) _mountEditor();
  else editorPane.innerHTML = '<div class="gv-empty" style="padding:40px;">Select a note to edit</div>';
}

// ---------------------------------------------------------------------------
// Vault lock
// ---------------------------------------------------------------------------

function _onLock() {
  fetch('/api/cyberapps/vault/lock', { method: 'POST' }).catch(() => {});
  _vaultToken = null;
  sessionStorage.removeItem('gv-vault-token');
  _notes = [];
  _activeNote = null;
  _checkVaultAndRender();
}

// ---------------------------------------------------------------------------
// Escape helper
// ---------------------------------------------------------------------------

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------------------------------------------------------------------------
// Styles (injected once)
// ---------------------------------------------------------------------------

function _injectStyles() {
  if (document.getElementById('gv-styles')) return;
  const style = document.createElement('style');
  style.id = 'gv-styles';
  style.textContent = `
    .gv-shell{display:flex;flex-direction:column;height:100%;background:var(--bg,#1a1d23);color:var(--fg,#c5c9d0);font-family:inherit;}
    .gv-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--border,#3a2a2a);flex-shrink:0;}
    .gv-header-left{display:flex;align-items:center;gap:8px;}
    .gv-logo-icon{color:var(--red,#c0392b);}
    .gv-title{font-weight:600;font-size:14px;letter-spacing:.5px;}
    .gv-vault-badge{font-size:10px;opacity:.5;text-transform:uppercase;letter-spacing:.5px;}
    .gv-tabs{display:flex;gap:2px;padding:6px 10px 0;border-bottom:1px solid var(--border,#3a2a2a);flex-shrink:0;overflow-x:auto;scrollbar-width:none;}
    .gv-tabs::-webkit-scrollbar{display:none;}
    .gv-tab-btn{background:none;border:none;color:var(--fg,#c5c9d0);opacity:.6;font-size:12px;padding:5px 10px;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;}
    .gv-tab-btn:hover{opacity:1;}
    .gv-tab-btn.active{opacity:1;color:var(--red,#c0392b);border-bottom-color:var(--red,#c0392b);}
    .gv-body{flex:1;overflow:hidden;display:flex;flex-direction:column;}
    .gv-btn{border:none;cursor:pointer;border-radius:4px;font-size:12px;padding:5px 10px;transition:all .15s;}
    .gv-btn-primary{background:var(--red,#c0392b);color:#fff;}
    .gv-btn-primary:hover{opacity:.85;}
    .gv-btn-ghost{background:transparent;color:var(--fg,#c5c9d0);border:1px solid var(--border,#3a2a2a);}
    .gv-btn-ghost:hover{background:rgba(255,255,255,.06);}
    .gv-btn-danger{background:rgba(192,57,43,.18);color:var(--red,#c0392b);border:1px solid rgba(192,57,43,.3);}
    .gv-btn-danger:hover{background:rgba(192,57,43,.3);}
    .gv-btn:disabled{opacity:.45;cursor:not-allowed;}
    .gv-pin-btn.active{color:var(--red,#c0392b);}
    .gv-input{background:rgba(255,255,255,.05);border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);border-radius:4px;padding:6px 9px;font-size:12px;width:100%;box-sizing:border-box;}
    .gv-input:focus{outline:none;border-color:var(--red,#c0392b);}
    .gv-select{background:rgba(255,255,255,.05);border:1px solid var(--border,#3a2a2a);color:var(--fg,#c5c9d0);border-radius:4px;padding:5px 8px;font-size:12px;}
    .gv-select:focus{outline:none;border-color:var(--red,#c0392b);}
    .gv-error{color:var(--red,#c0392b);font-size:12px;padding:8px;background:rgba(192,57,43,.1);border-radius:4px;margin-top:6px;}
    .gv-success{color:#27ae60;font-size:12px;padding:8px;background:rgba(39,174,96,.1);border-radius:4px;margin-top:6px;}
    .gv-empty{text-align:center;opacity:.45;padding:32px 0;font-size:13px;}
    .gv-section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}
    .gv-section-title{font-size:13px;font-weight:600;opacity:.8;}
    .gv-label{font-size:11px;opacity:.65;margin-bottom:3px;display:block;}
    .gv-field{margin-bottom:10px;}
    .gv-tag{background:rgba(192,57,43,.15);color:var(--red,#c0392b);font-size:10px;padding:1px 6px;border-radius:10px;display:inline-block;}
    .gv-pin-dot{color:var(--red,#c0392b);font-size:8px;}
    .gv-vault-gate{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center;height:100%;}
    .gv-vault-icon{color:var(--red,#c0392b);opacity:.6;margin-bottom:16px;}
    .gv-vault-title{font-size:16px;font-weight:600;margin-bottom:8px;}
    .gv-vault-desc{font-size:13px;opacity:.7;margin-bottom:12px;line-height:1.5;}
    .gv-vault-hint{font-size:11px;opacity:.5;}
    .gv-vault-form{display:flex;flex-direction:column;gap:8px;width:100%;max-width:300px;margin-top:12px;}
    .gv-notes-layout{display:flex;flex:1;overflow:hidden;}
    .gv-list-pane{width:260px;flex-shrink:0;border-right:1px solid var(--border,#3a2a2a);overflow-y:auto;display:flex;flex-direction:column;}
    .gv-editor-pane{flex:1;overflow-y:auto;display:flex;flex-direction:column;}
    .gv-notelist{display:flex;flex-direction:column;height:100%;}
    .gv-notelist-toolbar{display:flex;gap:6px;padding:8px;border-bottom:1px solid var(--border,#3a2a2a);flex-shrink:0;}
    .gv-notelist-actions{display:flex;gap:6px;padding:4px 8px;border-bottom:1px solid var(--border,#3a2a2a);flex-shrink:0;}
    .gv-notelist-body{flex:1;overflow-y:auto;padding:4px 0;}
    .gv-notelist-section{padding:0 0 8px;}
    .gv-note-row{padding:7px 10px;cursor:pointer;border-radius:4px;margin:1px 4px;transition:background .1s;}
    .gv-note-row:hover{background:rgba(255,255,255,.05);}
    .gv-note-row.active{background:rgba(192,57,43,.12);}
    .gv-note-row-title{font-size:12px;font-weight:500;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .gv-note-row-meta{font-size:10px;opacity:.5;display:flex;gap:4px;align-items:center;flex-wrap:wrap;}
    .gv-note-count{font-size:10px;opacity:.5;font-weight:normal;}
    .gv-context-menu{background:var(--bg,#1a1d23);border:1px solid var(--border,#3a2a2a);border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,.4);}
    .gv-ctx-item{padding:7px 14px;font-size:12px;cursor:pointer;}
    .gv-ctx-item:hover{background:rgba(255,255,255,.06);}
    .gv-ctx-danger{color:var(--red,#c0392b);}
    .gv-editor-shell{display:flex;flex-direction:column;height:100%;}
    .gv-editor-toolbar{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border,#3a2a2a);flex-shrink:0;}
    .gv-back-btn{display:flex;align-items:center;gap:4px;}
    .gv-editor-spacer{flex:1;}
    .gv-editor-title-row{padding:8px 10px 4px;flex-shrink:0;}
    .gv-title-input{background:transparent;border:none;border-bottom:1px solid var(--border,#3a2a2a);border-radius:0;font-size:15px;font-weight:600;padding:4px 2px;color:var(--fg,#c5c9d0);}
    .gv-title-input:focus{outline:none;border-bottom-color:var(--red,#c0392b);}
    .gv-editor-panes{flex:1;overflow:hidden;display:flex;}
    .gv-editor-textarea{flex:1;background:transparent;border:none;resize:none;color:var(--fg,#c5c9d0);font-family:monospace;font-size:13px;line-height:1.6;padding:10px 12px;outline:none;}
    .gv-editor-statusbar{display:flex;align-items:center;gap:12px;padding:4px 10px;font-size:10px;opacity:.5;border-top:1px solid var(--border,#3a2a2a);flex-shrink:0;}
    .gv-folder-select{font-size:11px;padding:3px 6px;}
    .gv-templates{padding:12px;height:100%;overflow-y:auto;}
    .gv-templates-header{margin-bottom:8px;}
    .gv-templates-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:10px;}
    .gv-tmpl-card{background:rgba(255,255,255,.04);border:1px solid var(--border,#3a2a2a);border-radius:6px;padding:10px;cursor:pointer;transition:background .15s;}
    .gv-tmpl-card:hover{background:rgba(192,57,43,.1);border-color:rgba(192,57,43,.3);}
    .gv-tmpl-name{font-size:12px;font-weight:500;margin-bottom:4px;}
    .gv-tmpl-folder{font-size:10px;opacity:.5;}
    .gv-settings{padding:12px;height:100%;overflow-y:auto;}
    .gv-health-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:4px;}
    .gv-stat-card{background:rgba(255,255,255,.04);border:1px solid var(--border,#3a2a2a);border-radius:6px;padding:10px;text-align:center;}
    .gv-stat-value{font-size:22px;font-weight:700;margin-bottom:4px;}
    .gv-stat-label{font-size:10px;opacity:.6;text-transform:uppercase;letter-spacing:.5px;}
    :root.light .gv-shell{background:var(--bg,#f5f5f7);color:var(--fg,#1a1d23);}
    :root.light .gv-input,:root.light .gv-select{background:#fff;color:#1a1d23;}
    :root.light .gv-note-row:hover{background:rgba(0,0,0,.04);}
    :root.light .gv-note-row.active{background:rgba(192,57,43,.08);}
    :root.light .gv-tmpl-card{background:rgba(0,0,0,.03);}
    :root.light .gv-stat-card{background:rgba(0,0,0,.03);}
    :root.light .gv-editor-textarea{color:#1a1d23;}
    :root.light .gv-title-input{color:#1a1d23;}
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Self-register in Cyber Apps registry
// ---------------------------------------------------------------------------

window.GhostVaultApp = { init, destroy };

if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id: 'ghostvault',
    name: 'GhostVault',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
    </svg>`,
    init: (container, ctx) => window.GhostVaultApp.init(container, ctx),
    destroy: () => window.GhostVaultApp.destroy(),
    vault: true,
  });
}
