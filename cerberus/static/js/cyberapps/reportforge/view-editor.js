/**
 * static/js/cyberapps/reportforge/view-editor.js
 * ReportForge — report editor (section list + content editor + findings panel).
 */

import * as State from './state.js';
import { escHtml, makeBlankFinding, SEV_ORDER, SEV_COLORS, sevBadge, makeId } from './utils.js';

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const PLATFORMS  = ['THM', 'HTB', 'Client', 'Internal', 'CTF', 'Other'];

// ── Findings panel ──────────────────────────────────────────────────────────

function _renderFindingsList(container) {
  const report = State.get('activeReport');
  const findings = report?.findings ?? [];
  const sorted = [...findings].sort((a, b) =>
    SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
  );
  const activeId = State.get('activeFindingId');
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div style="padding:10px 12px;border-bottom:1px solid var(--border,#2a2a3a);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim,#666);">Findings (${findings.length})</span>
        <button id="rf-add-finding" style="font-size:10px;padding:3px 8px;border-radius:5px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.1);color:var(--red,#c0392b);cursor:pointer;font-weight:700;">+ Add</button>
      </div>
      <div id="rf-findings-list" style="flex:1;overflow-y:auto;padding:6px 0;">
        ${sorted.length ? sorted.map(f => `
          <div class="rf-finding-row" data-id="${f.id}" style="
            padding:8px 12px;cursor:pointer;border-left:3px solid ${SEV_COLORS[f.severity] ?? '#8b949e'};
            background:${activeId === f.id ? 'rgba(192,57,43,.08)' : 'transparent'};
            transition:background .12s;border-bottom:1px solid var(--border,#1a1a2a);">
            <div style="font-size:11px;font-weight:600;color:var(--fg,#c5c9d0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
              title="${escHtml(f.title)}">${escHtml(f.title) || '<em style="color:var(--text-dim,#666)">Untitled</em>'}</div>
            <div style="margin-top:3px;">${sevBadge(f.severity)}</div>
          </div>
        `).join('') : '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-dim,#666);">No findings yet.<br>Click + Add to record one.</div>'}
      </div>
    </div>
  `;
  container.querySelector('#rf-add-finding').addEventListener('click', () => {
    const f = makeBlankFinding({ id: makeId(), title: 'New Finding' });
    State.upsertFinding(f);
    State.setActiveFindingId(f.id);
    _renderFindingsList(container);
    _openFindingEditor(f.id, container);
  });
  container.querySelectorAll('.rf-finding-row').forEach(row => {
    row.addEventListener('click', () => {
      State.setActiveFindingId(row.dataset.id);
      _renderFindingsList(container);
      _openFindingEditor(row.dataset.id, container);
    });
  });
}

function _openFindingEditor(findingId, findingsPane) {
  // We render the finding editor in a modal overlay on the editor
  const existing = document.getElementById('rf-finding-editor-overlay');
  if (existing) existing.remove();

  const report = State.get('activeReport');
  const f = report?.findings?.find(x => x.id === findingId);
  if (!f) return;

  const overlay = document.createElement('div');
  overlay.id = 'rf-finding-editor-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;z-index:200;background:rgba(10,10,20,.92);display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--panel,#16181e);border:1px solid var(--border,#2a2a3a);border-radius:10px;
      width:min(560px,96%);max-height:90%;overflow-y:auto;padding:20px;position:relative;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <span style="font-size:14px;font-weight:700;color:var(--fg,#c5c9d0);">Edit Finding</span>
        <div style="display:flex;gap:8px;">
          <button id="rf-fe-delete" style="padding:4px 10px;border-radius:5px;background:rgba(192,57,43,.12);
            border:1px solid #c0392b;color:#c0392b;font-size:11px;cursor:pointer;">Delete</button>
          <button id="rf-fe-close" style="background:none;border:none;color:var(--text-dim,#666);cursor:pointer;font-size:18px;">&times;</button>
        </div>
      </div>
      ${_findingField('rf-fe-title', 'Title', 'text', f.title)}
      <div style="margin-bottom:10px;">
        <label style="font-size:11px;color:var(--text-dim,#666);display:block;margin-bottom:5px;">Severity</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${SEVERITIES.map(s => `<button class="rf-sev-btn" data-sev="${s}" style="
            padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;
            text-transform:uppercase;
            background:${f.severity === s ? SEV_COLORS[s] + '33' : 'transparent'};
            color:${SEV_COLORS[s]};border:1px solid ${f.severity === s ? SEV_COLORS[s] : SEV_COLORS[s] + '55'};">
            ${s}
          </button>`).join('')}
        </div>
      </div>
      ${_findingTextarea('rf-fe-description', 'Description', f.description, 3)}
      ${_findingTextarea('rf-fe-evidence', 'Evidence', f.evidence, 3)}
      ${_findingTextarea('rf-fe-impact', 'Impact', f.impact, 2)}
      ${_findingTextarea('rf-fe-recommendation', 'Recommendation', f.recommendation, 3)}
      ${_findingField('rf-fe-cvss', 'CVSS Score', 'text', f.cvss ?? '')}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button id="rf-fe-cancel" style="padding:6px 14px;border-radius:6px;background:none;
          border:1px solid var(--border,#2a2a3a);color:var(--fg,#c5c9d0);font-size:12px;cursor:pointer;">Cancel</button>
        <button id="rf-fe-save" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);
          background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;">Save Finding</button>
      </div>
    </div>
  `;

  // Severity toggle state
  let chosenSev = f.severity;
  overlay.querySelectorAll('.rf-sev-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chosenSev = btn.dataset.sev;
      overlay.querySelectorAll('.rf-sev-btn').forEach(b => {
        const s = b.dataset.sev;
        b.style.background = s === chosenSev ? SEV_COLORS[s] + '33' : 'transparent';
        b.style.border = `1px solid ${s === chosenSev ? SEV_COLORS[s] : SEV_COLORS[s] + '55'}`;
      });
    });
  });

  const val = id => overlay.querySelector(`#${id}`)?.value ?? '';
  overlay.querySelector('#rf-fe-save').addEventListener('click', () => {
    const updated = {
      ...f,
      title:          val('rf-fe-title'),
      severity:       chosenSev,
      description:    val('rf-fe-description'),
      evidence:       val('rf-fe-evidence'),
      impact:         val('rf-fe-impact'),
      recommendation: val('rf-fe-recommendation'),
      cvss:           val('rf-fe-cvss') || undefined,
    };
    State.upsertFinding(updated);
    overlay.remove();
    _renderFindingsList(findingsPane);
  });
  overlay.querySelector('#rf-fe-delete').addEventListener('click', () => {
    if (!confirm(`Delete finding "${f.title}"?`)) return;
    State.removeFinding(f.id);
    overlay.remove();
    _renderFindingsList(findingsPane);
  });
  overlay.querySelector('#rf-fe-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#rf-fe-close').addEventListener('click', () => overlay.remove());

  // Must append to the editor shell so position:absolute anchors correctly
  const shell = document.getElementById('rf-editor-shell');
  if (shell) shell.appendChild(overlay);
  else document.body.appendChild(overlay);
}

function _findingField(id, label, type, value) {
  return `<div style="margin-bottom:10px;">
    <label for="${id}" style="font-size:11px;color:var(--text-dim,#666);display:block;margin-bottom:5px;">${label}</label>
    <input id="${id}" type="${type}" value="${escHtml(value)}"
      style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#2a2a3a);
        background:var(--bg,#1a1d23);color:var(--fg,#c5c9d0);font-size:12px;box-sizing:border-box;">
  </div>`;
}

function _findingTextarea(id, label, value, rows = 3) {
  return `<div style="margin-bottom:10px;">
    <label for="${id}" style="font-size:11px;color:var(--text-dim,#666);display:block;margin-bottom:5px;">${label}</label>
    <textarea id="${id}" rows="${rows}"
      style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#2a2a3a);
        background:var(--bg,#1a1d23);color:var(--fg,#c5c9d0);font-size:12px;box-sizing:border-box;resize:vertical;
        font-family:inherit;">${escHtml(value)}</textarea>
  </div>`;
}

// ── Section list ─────────────────────────────────────────────────────────────

function _renderSectionList(container, onActivate) {
  const report = State.get('activeReport');
  const sections = [...(report?.sections ?? [])].sort((a, b) => a.order - b.order);
  const activeId = State.get('activeSectionId');
  container.innerHTML = sections.map(s => `
    <div class="rf-sec-row" data-id="${s.id}" style="
      padding:8px 12px;cursor:pointer;font-size:12px;
      background:${s.id === activeId ? 'rgba(192,57,43,.10)' : 'transparent'};
      border-left:3px solid ${s.id === activeId ? 'var(--red,#c0392b)' : 'transparent'};
      color:${s.id === activeId ? 'var(--fg,#c5c9d0)' : 'var(--text-dim,#999)'};
      border-bottom:1px solid var(--border,#1a1a2a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      transition:background .12s,color .12s;">
      ${escHtml(s.title)}
    </div>
  `).join('');
  container.querySelectorAll('.rf-sec-row').forEach(row => {
    row.addEventListener('click', () => {
      State.setActiveSectionId(row.dataset.id);
      onActivate();
    });
  });
}

// ── Section content editor ──────────────────────────────────────────────────

function _renderSectionEditor(container, refreshSections) {
  const report = State.get('activeReport');
  const secId  = State.get('activeSectionId');
  const section = report?.sections?.find(s => s.id === secId);
  if (!section) { container.innerHTML = '<div style="padding:20px;color:var(--text-dim,#666);font-size:12px;">Select a section.</div>'; return; }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border,#2a2a3a);flex-shrink:0;display:flex;gap:8px;align-items:center;">
        <input id="rf-sec-title-input" type="text" value="${escHtml(section.title)}"
          style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid var(--border,#2a2a3a);
            background:var(--bg,#1a1d23);color:var(--fg,#c5c9d0);font-size:13px;font-weight:600;">
        <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-dim,#666);cursor:pointer;">
          <input id="rf-sec-visible" type="checkbox" ${section.visible ? 'checked' : ''} style="cursor:pointer;"> Visible
        </label>
      </div>
      <textarea id="rf-sec-content" style="flex:1;width:100%;padding:14px;box-sizing:border-box;
        border:none;background:var(--bg,#1a1d23);color:var(--fg,#c5c9d0);font-size:13px;
        font-family:'Courier New',monospace;resize:none;line-height:1.6;">${escHtml(section.content)}</textarea>
      <div style="padding:6px 14px;border-top:1px solid var(--border,#2a2a3a);flex-shrink:0;
        display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:10px;color:var(--text-dim,#666);">Markdown supported</span>
        <span id="rf-sec-saved-msg" style="font-size:10px;color:#3fb950;opacity:0;transition:opacity .3s;"></span>
      </div>
    </div>
  `;

  const titleEl   = container.querySelector('#rf-sec-title-input');
  const contentEl = container.querySelector('#rf-sec-content');
  const visibleEl = container.querySelector('#rf-sec-visible');
  const savedMsg  = container.querySelector('#rf-sec-saved-msg');

  let saveTimer;
  function _scheduleUpdate() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      State.updateSection(secId, {
        title:   titleEl.value,
        content: contentEl.value,
        visible: visibleEl.checked,
      });
      savedMsg.textContent = 'Auto-saved';
      savedMsg.style.opacity = '1';
      setTimeout(() => { savedMsg.style.opacity = '0'; }, 1800);
      refreshSections();
    }, 600);
  }

  titleEl.addEventListener('input', _scheduleUpdate);
  contentEl.addEventListener('input', _scheduleUpdate);
  visibleEl.addEventListener('change', _scheduleUpdate);
}

// ── Report meta editor ────────────────────────────────────────────────────────

function _renderMetaBar(container) {
  const r = State.get('activeReport');
  if (!r) return;
  container.innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border,#2a2a3a);flex-shrink:0;align-items:center;">
      <input id="rf-meta-title" type="text" value="${escHtml(r.title)}" placeholder="Report title"
        style="flex:2;min-width:120px;padding:5px 8px;border-radius:5px;border:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);color:var(--fg,#c5c9d0);font-size:12px;font-weight:700;">
      <input id="rf-meta-target" type="text" value="${escHtml(r.targetName)}" placeholder="Target"
        style="flex:1;min-width:100px;padding:5px 8px;border-radius:5px;border:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);color:var(--fg,#c5c9d0);font-size:12px;">
      <select id="rf-meta-status" style="padding:5px 8px;border-radius:5px;border:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);color:var(--fg,#c5c9d0);font-size:12px;">
        <option value="draft" ${r.status === 'draft' ? 'selected' : ''}>Draft</option>
        <option value="complete" ${r.status === 'complete' ? 'selected' : ''}>Complete</option>
      </select>
    </div>
  `;
  ['rf-meta-title', 'rf-meta-target', 'rf-meta-status'].forEach(id => {
    container.querySelector(`#${id}`).addEventListener('change', () => {
      State.patchReportMeta({
        title:      container.querySelector('#rf-meta-title').value,
        targetName: container.querySelector('#rf-meta-target').value,
        status:     container.querySelector('#rf-meta-status').value,
      });
    });
  });
}

// ── Main editor render ────────────────────────────────────────────────────────

export function renderEditorView(container, { onBack, onSave, onExport }) {
  container.innerHTML = `
    <div id="rf-editor-shell" style="height:100%;display:flex;flex-direction:column;overflow:hidden;position:relative;">
      <!-- Top bar -->
      <div style="padding:8px 14px;border-bottom:1px solid var(--border,#2a2a3a);display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button id="rf-back-btn" style="padding:4px 10px;border-radius:5px;background:none;border:1px solid var(--border,#2a2a3a);color:var(--text-dim,#999);font-size:11px;cursor:pointer;">&larr; Library</button>
        <span id="rf-dirty-indicator" style="font-size:10px;color:#f0a500;margin-left:4px;opacity:0;transition:opacity .2s;">Unsaved</span>
        <div style="flex:1;"></div>
        <button id="rf-save-btn" style="padding:5px 12px;border-radius:5px;border:1px solid #3fb950;background:rgba(63,185,80,.12);color:#3fb950;font-size:11px;font-weight:700;cursor:pointer;">Save</button>
        <button id="rf-export-btn" style="padding:5px 12px;border-radius:5px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:11px;font-weight:700;cursor:pointer;">Export &darr;</button>
      </div>
      <!-- Meta bar -->
      <div id="rf-meta-bar"></div>
      <!-- Three-panel body -->
      <div style="flex:1;display:flex;overflow:hidden;">
        <!-- Section list -->
        <div id="rf-sections-panel" style="width:180px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);"></div>
        <!-- Section content -->
        <div id="rf-section-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
        <!-- Findings -->
        <div id="rf-findings-panel" style="width:200px;flex-shrink:0;border-left:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);overflow:hidden;display:flex;flex-direction:column;"></div>
      </div>
    </div>
  `;

  const metaBar       = container.querySelector('#rf-meta-bar');
  const sectionsPanel = container.querySelector('#rf-sections-panel');
  const sectionContent= container.querySelector('#rf-section-content');
  const findingsPanel = container.querySelector('#rf-findings-panel');

  // Wire dirty indicator
  const unsubDirty = State.subscribe('dirty', d => {
    container.querySelector('#rf-dirty-indicator').style.opacity = d ? '1' : '0';
  });

  function _refreshAll() {
    _renderMetaBar(metaBar);
    _renderSectionList(sectionsPanel, () => _renderSectionEditor(sectionContent, () => _renderSectionList(sectionsPanel, () => {})));
    _renderSectionEditor(sectionContent, () => _renderSectionList(sectionsPanel, () => {}));
    _renderFindingsList(findingsPanel);
  }

  _refreshAll();

  container.querySelector('#rf-back-btn').addEventListener('click', onBack);
  container.querySelector('#rf-save-btn').addEventListener('click', onSave);
  container.querySelector('#rf-export-btn').addEventListener('click', onExport);

  return {
    destroy() {
      unsubDirty();
      const overlay = document.getElementById('rf-finding-editor-overlay');
      if (overlay) overlay.remove();
    },
  };
}
