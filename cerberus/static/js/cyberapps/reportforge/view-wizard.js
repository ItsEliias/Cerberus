/**
 * static/js/cyberapps/reportforge/view-wizard.js
 * ReportForge — new report wizard (template selection + metadata).
 */

import { makeId, sectionsFromTitles, makeBlankReport, escHtml } from './utils.js';

const PLATFORMS = ['THM', 'HTB', 'Client', 'Internal', 'CTF', 'Other'];

/** @param {Array<object>} templates */
function _buildTemplateGrid(templates, selectedId, onSelect) {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">
    ${templates.map(t => `
      <div class="rf-tpl-card" data-id="${t.id}" style="
        padding:12px;border-radius:7px;cursor:pointer;
        border:1px solid ${selectedId === t.id ? 'var(--red,#c0392b)' : 'var(--border,#2a2a3a)'};
        background:${selectedId === t.id ? 'rgba(192,57,43,.10)' : 'var(--panel,#16181e)'};
        transition:border-color .15s,background .15s;">
        <div style="font-size:12px;font-weight:700;color:var(--fg,#c5c9d0);">${escHtml(t.name)}</div>
        <div style="font-size:10px;color:var(--text-dim,#666);margin-top:4px;line-height:1.4;">
          ${escHtml(t.description)}
        </div>
      </div>
    `).join('')}
  </div>`;
}

/**
 * Render the new report wizard.
 * @param {HTMLElement} container
 * @param {{builtinTemplates: Array, customTemplates: Array, onComplete: Function, onCancel: Function}} opts
 */
export function renderWizardView(container, { builtinTemplates, customTemplates, onComplete, onCancel }) {
  const allTemplates = [...builtinTemplates, ...customTemplates];
  let selectedTemplateId = 'blank';
  let step = 0; // 0=template, 1=metadata

  function _render() {
    if (step === 0) _renderStep0();
    else _renderStep1();
  }

  function _renderStep0() {
    container.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2a3a);flex-shrink:0;
          display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:15px;font-weight:700;color:var(--fg,#c5c9d0);">New Report &mdash; Choose Template</div>
          <button id="rf-wiz-cancel" style="background:none;border:none;color:var(--text-dim,#666);cursor:pointer;font-size:18px;">&times;</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px 20px;">
          <div id="rf-tpl-grid">${_buildTemplateGrid(allTemplates, selectedTemplateId, id => { selectedTemplateId = id; _renderStep0(); })}</div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--border,#2a2a3a);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
          <button id="rf-wiz-back-0" style="padding:6px 14px;border-radius:6px;background:none;border:1px solid var(--border,#2a2a3a);color:var(--fg,#c5c9d0);cursor:pointer;font-size:12px;">Cancel</button>
          <button id="rf-wiz-next-0" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;">Next &rarr;</button>
        </div>
      </div>
    `;
    container.querySelector('#rf-wiz-cancel').addEventListener('click', onCancel);
    container.querySelector('#rf-wiz-back-0').addEventListener('click', onCancel);
    container.querySelector('#rf-wiz-next-0').addEventListener('click', () => { step = 1; _render(); });
    container.querySelectorAll('.rf-tpl-card').forEach(card => {
      card.addEventListener('click', () => {
        selectedTemplateId = card.dataset.id;
        _renderStep0();
      });
    });
  }

  function _renderStep1() {
    const now = new Date().toISOString().slice(0, 10);
    container.innerHTML = `
      <div style="height:100%;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border,#2a2a3a);flex-shrink:0;
          display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:15px;font-weight:700;color:var(--fg,#c5c9d0);">New Report &mdash; Details</div>
          <button id="rf-wiz-cancel2" style="background:none;border:none;color:var(--text-dim,#666);cursor:pointer;font-size:18px;">&times;</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:16px 20px;">
          <div style="display:flex;flex-direction:column;gap:14px;max-width:480px;">
            ${_field('rf-wiz-title', 'Report Title', 'text', 'Untitled Report', true)}
            ${_field('rf-wiz-target', 'Target Name', 'text', 'e.g. Machine or Client Name')}
            ${_field('rf-wiz-ip', 'Target IP', 'text', 'e.g. 10.10.10.1')}
            <div>
              <label style="font-size:11px;color:var(--text-dim,#666);display:block;margin-bottom:6px;">Platform</label>
              <select id="rf-wiz-platform" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#2a2a3a);background:var(--panel,#16181e);color:var(--fg,#c5c9d0);font-size:13px;">
                ${PLATFORMS.map(p => `<option value="${p}">${p}</option>`).join('')}
              </select>
            </div>
            ${_field('rf-wiz-date', 'Assessment Date', 'date', now)}
            ${_field('rf-wiz-operator', 'Operator', 'text', 'Your name or handle')}
          </div>
        </div>
        <div style="padding:14px 20px;border-top:1px solid var(--border,#2a2a3a);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
          <button id="rf-wiz-back-1" style="padding:6px 14px;border-radius:6px;background:none;border:1px solid var(--border,#2a2a3a);color:var(--fg,#c5c9d0);cursor:pointer;font-size:12px;">&larr; Back</button>
          <button id="rf-wiz-create" style="padding:6px 16px;border-radius:6px;border:1px solid var(--red,#c0392b);background:rgba(192,57,43,.12);color:var(--red,#c0392b);font-size:12px;font-weight:700;cursor:pointer;">Create Report</button>
        </div>
      </div>
    `;
    const get = id => container.querySelector(`#${id}`)?.value ?? '';
    container.querySelector('#rf-wiz-cancel2').addEventListener('click', onCancel);
    container.querySelector('#rf-wiz-back-1').addEventListener('click', () => { step = 0; _render(); });
    container.querySelector('#rf-wiz-create').addEventListener('click', () => {
      const tpl = allTemplates.find(t => t.id === selectedTemplateId);
      const sections = tpl ? sectionsFromTitles(tpl.sectionTitles) : sectionsFromTitles(['Cover', 'Executive Summary', 'Findings', 'Appendix']);
      const report = makeBlankReport({
        id:             makeId(),
        title:          get('rf-wiz-title') || 'Untitled Report',
        targetName:     get('rf-wiz-target'),
        targetIP:       get('rf-wiz-ip'),
        platform:       get('rf-wiz-platform'),
        assessmentDate: get('rf-wiz-date'),
        operator:       get('rf-wiz-operator'),
        sections,
      });
      onComplete(report);
    });
  }

  _render();
}

function _field(id, label, type, placeholder, required = false) {
  return `
    <div>
      <label for="${id}" style="font-size:11px;color:var(--text-dim,#666);display:block;margin-bottom:6px;">
        ${label}${required ? ' <span style="color:var(--red,#c0392b)">*</span>' : ''}
      </label>
      <input id="${id}" type="${type}" placeholder="${escHtml(placeholder)}"
        style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border,#2a2a3a);
          background:var(--panel,#16181e);color:var(--fg,#c5c9d0);font-size:13px;box-sizing:border-box;"
        ${type === 'date' ? `value="${placeholder}"` : ''}>
    </div>`;
}
