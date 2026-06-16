// Cerberus OS — dynamic available voice actions panel

import AtlasVoiceContext from './cerberusVoiceContext.js';

const ACTIONS_BY_CONTEXT = {
  projects: [
    'Select project',
    'Open project HQ',
    'Deep index project',
    'Run council review',
    'Generate cursor prompt',
    'Close it',
  ],
  agents: [
    'Select agent',
    'Message agent',
    'Open latest report',
    'Approve report',
    'Send to next agent',
    'Close it',
  ],
  agent_selected: [
    'Message this agent',
    'Select project',
    'Select report type',
    'Finish message',
    'Cancel message',
  ],
  report_open: [
    'Approve report',
    'Request revision',
    'Archive report',
    'Send to next agent',
    'Summarise report',
    'Scroll down',
    'Close report',
  ],
  general: [
    'Move to Projects',
    'Move to Agents',
    'Open Cursor',
    'Cerberus standby',
  ],
};

function _el(id) {
  return document.getElementById(id);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _resolveList(ctx) {
  if (ctx.currentModal === 'report' || ctx.currentReportId) return ACTIONS_BY_CONTEXT.report_open;
  if (ctx.currentModal === 'agent_office' || ctx.currentAgentId) {
    if (ctx.currentRoute === 'agents') return [...ACTIONS_BY_CONTEXT.agent_selected];
    return ACTIONS_BY_CONTEXT.agent_selected;
  }
  if (ctx.currentRoute === 'projects') return ACTIONS_BY_CONTEXT.projects;
  if (ctx.currentRoute === 'agents') return ACTIONS_BY_CONTEXT.agents;
  return ACTIONS_BY_CONTEXT.general;
}

export function refreshVoiceActionsPanel() {
  const host = _el('cerberus-voice-actions-panel');
  if (!host) return;
  const ctx = AtlasVoiceContext.get();
  const actions = _resolveList(ctx);
  const desc = AtlasVoiceContext.describe();
  host.innerHTML = `
    <p class="cerberus-voice-actions-context">${_esc(desc)}</p>
    <ul class="cerberus-voice-actions-list">
      ${actions.map((a) => `<li>${_esc(a)}</li>`).join('')}
    </ul>
  `;
}

AtlasVoiceContext.onChange(refreshVoiceActionsPanel);

window.AtlasVoiceActionsPanel = { refresh: refreshVoiceActionsPanel };

export default window.AtlasVoiceActionsPanel;
