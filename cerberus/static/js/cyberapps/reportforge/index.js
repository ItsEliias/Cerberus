/**
 * static/js/cyberapps/reportforge/index.js
 * ReportForge — Cerberus native app entry point.
 *
 * Pentest report generator: library, template wizard, section editor,
 * findings tracker, Markdown/HTML export.
 *
 * Self-registers with window.CYBER_APPS_REGISTRY.
 */

import * as State from './state.js';
import { api, makeBlankReport, makeId } from './utils.js';
import { renderLibraryView } from './view-library.js';
import { renderWizardView } from './view-wizard.js';
import { renderEditorView } from './view-editor.js';
import { showExportModal } from './view-export.js';

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------
(function injectCSS() {
  if (document.querySelector('[data-reportforge-css]')) return;
  const style = document.createElement('style');
  style.dataset.reportforgeCss = '1';
  style.textContent = `
    #rf-editor-shell textarea:focus,
    #rf-editor-shell input:focus,
    #rf-editor-shell select:focus {
      outline: 1px solid var(--red, #c0392b);
      border-color: var(--red, #c0392b) !important;
    }
    .rf-card:hover { border-color: var(--red,#c0392b) !important; }
    .rf-btn-ghost {
      background: transparent;
      border: 1px solid var(--border,#2a2a3a);
      color: var(--fg,#c5c9d0);
      border-radius: 5px;
      cursor: pointer;
      transition: border-color .12s, color .12s;
    }
    .rf-btn-ghost:hover { border-color: var(--red,#c0392b); color: var(--red,#c0392b); }
    .rf-nav-tab {
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 5px;
      cursor: pointer;
      border: 1px solid transparent;
      color: var(--text-dim,#666);
      background: transparent;
      transition: color .12s, border-color .12s, background .12s;
    }
    .rf-nav-tab.active {
      color: var(--red,#c0392b);
      border-color: var(--red,#c0392b);
      background: rgba(192,57,43,.10);
    }
    .rf-nav-tab:hover:not(.active) { color: var(--fg,#c5c9d0); }
  `;
  document.head.appendChild(style);
})();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const BASE = '/api/cyberapps/reportforge';

let _container = null;
let _editorComp = null;

// ---------------------------------------------------------------------------
// API bootstrap
// ---------------------------------------------------------------------------

async function _bootstrap() {
  try {
    const data = await api(`${BASE}/reports`);
    State.setReports(data.reports ?? []);
  } catch (err) {
    console.warn('ReportForge: failed to load reports', err);
  }
  try {
    const data = await api(`${BASE}/templates`);
    State.set('builtinTemplates', data.builtin ?? []);
    State.set('customTemplates', data.custom ?? []);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Save / CRUD helpers
// ---------------------------------------------------------------------------

async function _saveReport(report) {
  try {
    const reports = State.get('reports');
    const exists = reports.some(r => r.id === report.id);
    if (exists) {
      const data = await api(`${BASE}/reports/${report.id}`, 'PUT', report);
      State.upsertReport(data.report);
    } else {
      const data = await api(`${BASE}/reports`, 'POST', report);
      State.upsertReport(data.report);
    }
    State.setDirty(false);
    return true;
  } catch (err) {
    console.error('ReportForge: save failed', err);
    return false;
  }
}

async function _deleteReport(id) {
  try {
    await api(`${BASE}/reports/${id}`, 'DELETE');
    State.removeReport(id);
    return true;
  } catch { return false; }
}

async function _duplicateReport(id) {
  try {
    const data = await api(`${BASE}/reports/${id}/duplicate`, 'POST');
    State.upsertReport(data.report);
    return data.report;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// View router
// ---------------------------------------------------------------------------

function _render() {
  if (!_container) return;
  const view = State.get('view');

  // Clean up previous editor component
  if (_editorComp && view !== 'editor') {
    _editorComp.destroy?.();
    _editorComp = null;
  }

  _container.innerHTML = '';

  if (view === 'library') {
    renderLibraryView(_container, {
      onNew:       () => State.setView('wizard'),
      onOpen:      r  => { State.setActiveReport(r); State.setView('editor'); },
      onDelete:    async id => {
        if (!confirm('Delete this report?')) return;
        await _deleteReport(id);
        _render();
      },
      onDuplicate: async id => {
        await _duplicateReport(id);
        _render();
      },
    });
    return;
  }

  if (view === 'wizard') {
    renderWizardView(_container, {
      builtinTemplates: State.get('builtinTemplates'),
      customTemplates:  State.get('customTemplates'),
      onComplete: async report => {
        const ok = await _saveReport(report);
        if (ok) {
          State.setActiveReport(report);
          State.setView('editor');
          _render();
        }
      },
      onCancel: () => { State.setView('library'); _render(); },
    });
    return;
  }

  if (view === 'editor') {
    const report = State.get('activeReport');
    if (!report) { State.setView('library'); _render(); return; }
    _editorComp = renderEditorView(_container, {
      onBack: async () => {
        const { activeReport: r, dirty: d } = { activeReport: State.get('activeReport'), dirty: State.get('dirty') };
        if (d && r) await _saveReport(r);
        State.setView('library');
        State.setActiveReport(null);
        _render();
      },
      onSave: async () => {
        const r = State.get('activeReport');
        if (r) await _saveReport(r);
        // Refresh library list
        try {
          const data = await api(`${BASE}/reports`);
          State.setReports(data.reports ?? []);
        } catch { /* ignore */ }
      },
      onExport: () => {
        const r = State.get('activeReport');
        if (r) showExportModal(r.id, r.title, null);
      },
    });
    return;
  }
}

// Subscribe to view changes
State.subscribe('view', () => _render());

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let _bootstrapped = false;

function init(container, _ctx) {
  _container = container;
  container.style.height = '100%';
  container.style.overflow = 'hidden';
  container.style.background = 'var(--bg,#1a1d23)';

  // Ensure we start at library
  State.setView('library');
  _render();

  if (!_bootstrapped) {
    _bootstrapped = true;
    _bootstrap().then(() => _render());
  }
}

function destroy() {
  if (_editorComp) {
    _editorComp.destroy?.();
    _editorComp = null;
  }
  // Remove any lingering overlay modals this app may have spawned
  document.getElementById('rf-export-modal-overlay')?.remove();
  document.getElementById('rf-finding-editor-overlay')?.remove();
  _container = null;
  // Reset view but keep report data in memory for quick re-open
  State.setView('library');
}

// ---------------------------------------------------------------------------
// Self-registration
// ---------------------------------------------------------------------------
if (window.CYBER_APPS_REGISTRY) {
  window.CYBER_APPS_REGISTRY.push({
    id:   'reportforge',
    name: 'ReportForge',
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    init,
    destroy,
    vault: false,
  });
}
