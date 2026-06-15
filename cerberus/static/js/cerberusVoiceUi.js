// Cerberus OS — apply voice command UI actions + status feedback

import AtlasVoiceContext from './cerberusVoiceContext.js';
import cerberusOverlayTools from './cerberusOverlayTools.js';

function _uiDebug(tag, data) {
  try {
    if (localStorage.getItem('cerberus_voice_debug') === 'true') {
      console.log(`[voice-ui] ${tag}`, data);
    }
  } catch (_) {}
}

function _modalStack() {
  const stack = [];
  const report = document.getElementById('cerberus-report-modal');
  const agent = document.getElementById('cerberus-agent-office-modal');
  const council = document.getElementById('cerberus-council-modal');
  const hq = document.getElementById('cerberus-project-hq');
  if (report && !report.classList.contains('hidden')) stack.push('report');
  if (agent && !agent.classList.contains('hidden')) stack.push('agent_office');
  if (council && !council.classList.contains('hidden')) stack.push('council');
  if (hq && !hq.classList.contains('hidden')) stack.push('project_hq');
  return stack;
}

export function setCommandActivity(label, state = 'done') {
  const el = document.getElementById('cerberus-status-activity');
  if (!el) return;
  el.textContent = label || '';
  el.dataset.state = state || 'done';
  window.cerberusVoiceService?.setLastCommand?.(label?.replace(/^(Executing|Generating|Done|Error):\s*/i, '') || '');
}

export async function ensureRoute(route) {
  const hm = window.homeModule;
  if (!hm) return;
  const current = AtlasVoiceContext.get().currentRoute;
  if (current === route) return;
  if (route === 'agents') await hm.showAgentsOffice?.({ skipHistory: false });
  else if (route === 'projects') await hm.showProjects?.({ skipHistory: false });
  else if (route === 'home') await hm.showHome?.({ skipHistory: false });
  else if (route === 'finance') await hm.showFinance?.({ skipHistory: false });
}

export async function applyVoiceUiAction(uiAction) {
  if (!uiAction?.type) return;
  const before = AtlasVoiceContext.get();
  _uiDebug('requested uiAction', uiAction);
  _uiDebug('context before', before);
  _uiDebug('modal stack', _modalStack());

  const agents = window.AtlasAgentsUI;
  const projects = window.AtlasProjectsUI;
  const p = uiAction.payload || {};

  try {
    switch (uiAction.type) {
      case 'navigate':
        await ensureRoute(p.route);
        break;
      case 'open_agent':
        await ensureRoute('agents');
        agents?.openAgent?.(p.agentId);
        break;
      case 'focus_agent_message':
        await ensureRoute('agents');
        agents?.enterMessageCapture?.(p.agentId, p.label);
        break;
      case 'update_agent_message':
        agents?.updateAgentMessageDraft?.(p.text, p.agentId);
        break;
      case 'exit_message_capture':
        agents?.exitMessageCapture?.();
        break;
      case 'generating_report':
        agents?.setAgentGenerating?.(p.agentId, p.label || 'Generating report…');
        break;
      case 'open_report':
        if (p.reportId) {
          await agents?.openReportById?.(p.reportId);
        }
        break;
      case 'open_project':
        await ensureRoute('projects');
        await projects?.selectProject?.(p.projectId);
        break;
      case 'open_project_hq':
        await ensureRoute('projects');
        await projects?.openProjectHQ?.(p.projectId);
        break;
      case 'open_overlay':
        await cerberusOverlayTools.openOverlayTool?.(p.tool);
        break;
      case 'close_overlay':
        if (p.tool) await cerberusOverlayTools.closeOverlayTool?.(p.tool);
        else await cerberusOverlayTools.closeTopOverlay?.();
        break;
      case 'close_modal':
        await agents?.closeActiveModal?.();
        break;
      case 'refresh_agent':
        await agents?.refreshOffice?.();
        if (p.agentId) agents?.openAgent?.(p.agentId);
        break;
      case 'refresh_reports':
        await agents?.refreshOffice?.();
        break;
      case 'show_command_result':
        if (p.message) {
          setCommandActivity(p.ok === false ? `Error: ${p.message}` : p.message, p.ok === false ? 'error' : 'done');
          agents?.showAgentNotice?.(p.message);
        }
        break;
      case 'scroll_report_top': {
        const body = document.querySelector('.atlas-report-modal:not(.hidden) .atlas-report-modal-body');
        if (body) body.scrollTop = 0;
        break;
      }
      default:
        break;
    }
  } catch (err) {
    _uiDebug('apply error', err?.message);
  }

  _uiDebug('applied uiAction', uiAction.type);
  _uiDebug('context after', AtlasVoiceContext.get());
  _uiDebug('modal stack after', _modalStack());
}

export async function applyVoiceResultUi(result) {
  if (!result?.handled) return;
  const actions = [];
  if (result.uiAction) actions.push(result.uiAction);
  if (Array.isArray(result.uiActions)) actions.push(...result.uiActions);

  if (result.uiActivity) {
    setCommandActivity(result.uiActivity, result.ok === false ? 'error' : 'executing');
  }

  for (const action of actions) {
    await applyVoiceUiAction(action);
  }

  if (result.ok !== false && result.uiActivity) {
    const done = result.uiActivity.replace(/^Executing:\s*/i, 'Done: ')
      .replace(/^Generating:\s*/i, 'Done: ');
    setCommandActivity(done, 'done');
  } else if (result.ok === false) {
    setCommandActivity(result.message ? `Error: ${result.message}` : 'Error', 'error');
  }
}

const cerberusVoiceUi = {
  applyVoiceUiAction,
  applyVoiceResultUi,
  setCommandActivity,
  ensureRoute,
};

window.AtlasVoiceUi = cerberusVoiceUi;
export default cerberusVoiceUi;
