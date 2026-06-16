// Cerberus OS V2 — contextual voice action engine

import AtlasVoiceContext from './cerberusVoiceContext.js';
import cerberusVoiceNavigation from './cerberusVoiceNavigation.js';
import cerberusOverlayTools from './cerberusOverlayTools.js';
import cerberusCalendarVoice from './cerberusCalendarVoice.js';
import atlasNotesVoice from './cerberusNotesVoice.js';
import cerberusPersonalisationVoice from './cerberusPersonalisationVoice.js';
import cerberusPersonality from './cerberusPersonality.js';
import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';

const AGENT_ALIASES = {
  research: ['research', 'research agent', 'r&d', 'r and d'],
  business: ['business', 'business agent', 'biz', 'strategy'],
  architect: ['architect', 'architect agent', 'architecture', 'arc'],
  developer: ['developer', 'developer agent', 'dev', 'engineering'],
  marketing: ['marketing', 'marketing agent', 'mkt', 'launch'],
};

const STAGE_SEND = {
  business: 'business',
  architect: 'architect',
  developer: 'developer',
  marketing: 'marketing',
};

const REPORT_TYPES = {
  research_report: ['research report', 'research'],
  business_proposal: ['business proposal', 'business report', 'proposal'],
  architecture_plan: ['architecture plan', 'architecture report', 'architecture'],
  developer_cursor_prompt: ['developer cursor prompt', 'cursor prompt', 'developer report'],
  marketing_launch_plan: ['marketing launch plan', 'launch plan', 'marketing report'],
};

const AGENT_DEFAULT_REPORT = {
  research: 'research_report',
  business: 'business_proposal',
  architect: 'architecture_plan',
  developer: 'developer_cursor_prompt',
  marketing: 'marketing_launch_plan',
};

let _capture = null;
let _awaiting = null;

function _debug(tag, data) {
  try {
    if (localStorage.getItem('cerberus_voice_debug') === 'true') {
      console.log(`[voice-action] ${tag}`, data);
    }
  } catch (_) {}
}

function _norm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _stripPrefixes(text) {
  return _norm(text)
    .replace(/^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?/i, '')
    .trim();
}

async function _fetchProjects() {
  try {
    const res = await fetch('/api/cerberus/projects', { credentials: 'same-origin' });
    const data = await res.json();
    return data.projects || [];
  } catch (_) {
    return [];
  }
}

async function _resolveProject(query, projects) {
  const q = _norm(query);
  if (!q) return null;
  for (const p of projects) {
    const id = (p.id || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    if (q === id || q === name || name.includes(q) || q.includes(name)) return p;
  }
  return null;
}

function _resolveAgent(query) {
  const q = _norm(query);
  if (!q) return null;
  for (const [id, aliases] of Object.entries(AGENT_ALIASES)) {
    if (aliases.some((a) => q === a || q.includes(a) || a.includes(q))) return id;
  }
  if (q.includes('this agent') || q === 'agent') {
    return AtlasVoiceContext.get().currentAgentId;
  }
  return null;
}

const OVERLAY_CLOSE = /^(?:close|exit|dismiss)\s+(?:the\s+)?(?:notes?|library|cook\s*book|calendar|brain|memory|tasks?)$/;

function _parseCloseOverlay(norm) {
  if (norm === 'close notes' || norm === 'close note') return 'notes';
  if (norm === 'close library') return 'library';
  if (norm === 'close cookbook' || norm === 'close cook book') return 'cookbook';
  if (norm === 'close calendar') return 'calendar';
  if (norm === 'close brain' || norm === 'close memory') return 'brain';
  if (norm === 'close tasks' || norm === 'close task') return 'tasks';
  return null;
}

function _isClosePhrase(norm) {
  return /^(?:close(?:\s+(?:it|report|agent|project|hq|modal))?|exit|dismiss|back)$/.test(norm)
    || norm === 'close project hq'
    || norm === 'close agent'
    || norm === 'close report'
    || OVERLAY_CLOSE.test(norm)
    || !!_parseCloseOverlay(norm);
}

function _isCloseAgentPhrase(norm) {
  return /^(?:close|exit|dismiss)(?:\s+(?:this\s+)?agent)$/.test(norm)
    || /^close\s+(?:research|business|architect|developer|marketing)\s+agent$/.test(norm);
}

function _isFinishPhrase(norm) {
  return /^(?:finish message|message over|send message|send it|submit message)$/.test(norm);
}

function _isCancelPhrase(norm) {
  return /^(?:cancel message|forget message|never mind|cancel)$/.test(norm);
}

export function getMessageCaptureState() {
  return _capture ? { ..._capture } : null;
}

export function clearMessageCapture() {
  _capture = null;
  _awaiting = null;
}

export function parseVoiceAction(transcript, context = AtlasVoiceContext.get()) {
  const raw = String(transcript || '').trim();
  const norm = _stripPrefixes(raw);
  if (!norm) return { handled: false };

  const out = {
    handled: false,
    action: null,
    objectType: null,
    objectName: null,
    confidence: 0,
    payload: {},
  };

  if (_isFinishPhrase(norm)) {
    return { handled: true, action: 'finish_message', objectType: 'agent', confidence: 0.95, payload: {} };
  }
  if (_isCancelPhrase(norm) && (_capture || norm.includes('message'))) {
    return { handled: true, action: 'cancel_message', objectType: 'agent', confidence: 0.95, payload: {} };
  }

  if (_capture?.mode === 'message_body' && !_isClosePhrase(norm) && !_isFinishPhrase(norm)) {
    const chunk = _stripPrefixes(raw);
    if (!chunk) return { handled: false };
    return {
      handled: true,
      action: 'message',
      objectType: 'agent',
      objectName: _capture.agentId,
      confidence: 0.9,
      payload: { message: chunk, append: true },
    };
  }

  if (_awaiting === 'project_name') {
    return {
      handled: true,
      action: 'select',
      objectType: 'project',
      objectName: raw.trim(),
      confidence: 0.85,
      payload: { fromAwaiting: true },
    };
  }

  const closeOverlay = _parseCloseOverlay(norm);
  if (closeOverlay) {
    return { handled: true, action: 'close_overlay', objectType: 'overlay', objectName: closeOverlay, confidence: 0.92, payload: { tool: closeOverlay } };
  }
  if (_isCloseAgentPhrase(norm)) {
    return { handled: true, action: 'close_agent', objectType: 'agent', confidence: 0.9, payload: {} };
  }
  if (_isClosePhrase(norm)) {
    return { handled: true, action: 'close', objectType: 'modal', confidence: 0.9, payload: {} };
  }

  const scrollDown = /^(?:scroll down|next)$/.test(norm);
  const scrollUp = /^(?:scroll up|previous|prev)$/.test(norm);
  if (scrollDown) return { handled: true, action: 'scroll', objectType: 'modal', objectName: 'down', confidence: 0.9, payload: { direction: 'down' } };
  if (scrollUp) return { handled: true, action: 'scroll', objectType: 'modal', objectName: 'up', confidence: 0.9, payload: { direction: 'up' } };

  const navMatch = norm.match(/^(?:move to|navigate to|switch to|go to|open)\s+(.+)$/);
  if (navMatch) {
    return { handled: true, action: 'open', objectType: 'route', objectName: navMatch[1], confidence: 0.88, payload: {} };
  }

  if (/^open project hq$/.test(norm)) {
    return { handled: true, action: 'open', objectType: 'modal', objectName: 'project_hq', confidence: 0.9, payload: { projectId: context.currentProjectId } };
  }

  const selectOnly = norm.match(/^select(?:\s+project)?\s+(.+)$/);
  if (selectOnly && !selectOnly[1].includes('agent') && !selectOnly[1].includes('report')) {
    return { handled: true, action: 'select', objectType: 'project', objectName: selectOnly[1], confidence: 0.86, payload: {} };
  }

  const openProj = norm.match(/^open(?:\s+project)?\s+(.+)$/);
  if (openProj && !openProj[1].includes('agent') && !openProj[1].includes('report') && !['cursor', 'browser', 'chrome', 'spotify'].includes(openProj[1])) {
    return { handled: true, action: 'open', objectType: 'project', objectName: openProj[1], confidence: 0.86, payload: { openHq: true } };
  }

  const showProj = norm.match(/^show(?:\s+project)?\s+(.+)$/);
  if (showProj) {
    return { handled: true, action: 'select', objectType: 'project', objectName: showProj[1], confidence: 0.84, payload: {} };
  }

  const deepIndex = norm.match(/^deep index(?:\s+project)?(?:\s+(.+))?$/);
  if (deepIndex) {
    return { handled: true, action: 'deep_index', objectType: 'project', objectName: deepIndex[1] || context.currentProjectName, confidence: 0.88, payload: {} };
  }

  const cursorPrompt = norm.match(/^(?:generate|create|run)\s+cursor prompt(?:\s+(?:for\s+)?(.+))?$/);
  if (cursorPrompt) {
    return { handled: true, action: 'generate', objectType: 'project', objectName: cursorPrompt[1] || context.currentProjectName, confidence: 0.88, payload: { kind: 'cursor_prompt' } };
  }

  const launchPlan = norm.match(/^(?:generate|create)\s+launch plan(?:\s+(?:for\s+)?(.+))?$/);
  if (launchPlan) {
    return { handled: true, action: 'generate', objectType: 'project', objectName: launchPlan[1] || context.currentProjectName, confidence: 0.88, payload: { kind: 'launch_plan' } };
  }

  const council = norm.match(/^(?:run\s+)?council review(?:\s+(?:for\s+)?(.+))?$/);
  if (council) {
    return { handled: true, action: 'review', objectType: 'project', objectName: council[1] || context.currentProjectName, confidence: 0.86, payload: {} };
  }

  const reviewProj = norm.match(/^review\s+(.+)$/);
  if (reviewProj) {
    return { handled: true, action: 'open', objectType: 'project', objectName: reviewProj[1], confidence: 0.84, payload: { openHq: true } };
  }

  const selectAgent = norm.match(/^(?:select|open|show)\s+(.+)$/);
  if (selectAgent && (selectAgent[1].includes('agent') || Object.values(AGENT_ALIASES).flat().some((a) => selectAgent[1].includes(a.split(' ')[0])))) {
    return { handled: true, action: 'select', objectType: 'agent', objectName: selectAgent[1], confidence: 0.86, payload: {} };
  }

  const directMessage = norm.match(/^(?:message|send message to|talk to)\s+(.+?)\s+(.{8,})$/);
  if (directMessage) {
    const agentId = _resolveAgent(directMessage[1]);
    if (agentId) {
      return {
        handled: true,
        action: 'message',
        objectType: 'agent',
        objectName: agentId,
        confidence: 0.9,
        payload: { message: directMessage[2], direct: true },
      };
    }
  }

  if (/^(?:message agent|message this agent|send this agent a message|send message)$/.test(norm)) {
    return { handled: true, action: 'message', objectType: 'agent', objectName: context.currentAgentId, confidence: 0.9, payload: { startCapture: true } };
  }

  const messageAgent = norm.match(/^message\s+(.+?)\s+(.{8,})$/);
  if (messageAgent) {
    const agentId = _resolveAgent(messageAgent[1]);
    if (agentId) {
      return {
        handled: true,
        action: 'message',
        objectType: 'agent',
        objectName: agentId,
        confidence: 0.88,
        payload: { message: messageAgent[2], direct: true },
      };
    }
  }

  if (norm === 'open latest report') {
    return { handled: true, action: 'open', objectType: 'report', objectName: 'latest', confidence: 0.9, payload: {} };
  }

  const openReport = norm.match(/^open report\s+(.+)$/);
  if (openReport) {
    return { handled: true, action: 'open', objectType: 'report', objectName: openReport[1], confidence: 0.86, payload: {} };
  }

  if (/^(?:approve|approve report|accept report|accept)$/.test(norm)) {
    return { handled: true, action: 'approve', objectType: 'report', confidence: 0.9, payload: {} };
  }
  if (/^(?:request revision|revise report|reject|revise)$/.test(norm)) {
    return { handled: true, action: 'revise', objectType: 'report', confidence: 0.9, payload: {} };
  }
  if (/^archive(?:\s+report)?$/.test(norm)) {
    return { handled: true, action: 'archive', objectType: 'report', confidence: 0.9, payload: {} };
  }
  if (/^read(?:\s+the)?\s+report(?:\s+aloud)?$/.test(norm) || norm === 'read it aloud' || norm === 'read it') {
    return { handled: true, action: 'read_report', objectType: 'report', confidence: 0.9, payload: {} };
  }
  if (/^summar(?:y|ise)(?:\s+report)?$/.test(norm)) {
    return { handled: true, action: 'summarise', objectType: 'report', confidence: 0.88, payload: {} };
  }

  const sendStage = norm.match(/^send to\s+(.+?)(?:\s+agent)?$/);
  if (sendStage) {
    const stage = _resolveAgent(sendStage[1]);
    if (stage) {
      return { handled: true, action: 'send_next', objectType: 'report', objectName: stage, confidence: 0.86, payload: { stage } };
    }
  }
  if (norm === 'send to next agent') {
    return { handled: true, action: 'send_next', objectType: 'report', confidence: 0.9, payload: {} };
  }

  if (norm === 'select project') {
    return { handled: true, action: 'select', objectType: 'project', confidence: 0.85, payload: { prompt: true } };
  }
  const selectProjVoice = norm.match(/^select project\s+(.+)$/);
  if (selectProjVoice) {
    return { handled: true, action: 'select', objectType: 'project', objectName: selectProjVoice[1], confidence: 0.86, payload: {} };
  }
  const projectOnly = norm.match(/^project\s+(.+)$/);
  if (projectOnly) {
    return { handled: true, action: 'select', objectType: 'project', objectName: projectOnly[1], confidence: 0.82, payload: {} };
  }

  if (norm === 'select report type') {
    return { handled: true, action: 'select', objectType: 'report_type', confidence: 0.85, payload: { prompt: true } };
  }
  const reportType = norm.match(/^select report type\s+(.+)$/);
  if (reportType) {
    return { handled: true, action: 'select', objectType: 'report_type', objectName: reportType[1], confidence: 0.86, payload: {} };
  }

  return out;
}

function _scrollActiveModal(direction) {
  const sel = direction === 'down'
    ? ['.cerberus-report-modal:not(.hidden) .cerberus-report-modal-body', '.cerberus-agent-office-reports-wrap', '.cerberus-project-hq-content', '.cerberus-hq-modal-body']
    : ['.cerberus-report-modal:not(.hidden) .cerberus-report-modal-body', '.cerberus-agent-office-reports-wrap', '.cerberus-project-hq-content', '.cerberus-hq-modal-body'];
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) {
      el.scrollBy({ top: direction === 'down' ? 220 : -220, behavior: 'smooth' });
      return true;
    }
  }
  return false;
}

async function _executeParsed(parsed) {
  const ctx = AtlasVoiceContext.get();
  const uiAgents = window.AtlasAgentsUI;
  const uiProjects = window.AtlasProjectsUI;

  if (parsed.action === 'cancel_message') {
    clearMessageCapture();
    uiAgents?.exitMessageCapture?.();
    return cmdHandled(true, 'Message cancelled.', {
      uiAction: { type: 'exit_message_capture', payload: {} },
      uiActivity: 'Done: Message cancelled',
    });
  }

  if (parsed.action === 'finish_message') {
    const agentId = _capture?.agentId || ctx.currentAgentId;
    if (!agentId) return cmdHandled(false, 'No agent selected.', { uiActivity: 'Error: No agent selected' });
    const msg = _capture?.message || document.getElementById('cerberus-agent-message-input')?.value?.trim();
    if (!msg) return cmdHandled(false, 'No message to send yet.', { uiActivity: 'Error: No message' });
    uiAgents?.updateAgentMessageDraft?.(msg, agentId);
    window.AtlasVoiceUi?.setCommandActivity?.('Generating: Research report', 'executing');
    const res = await uiAgents?.sendAgentMessage?.(
      agentId,
      msg,
      _capture?.projectId || ctx.currentProjectId,
      _capture?.reportType || AGENT_DEFAULT_REPORT[agentId],
    );
    clearMessageCapture();
    const short = res?.ok ? 'Research report ready.' : (res?.message || 'Failed to send message.');
    return cmdHandled(!!res?.ok, short, {
      uiActivity: res?.ok ? 'Done: Research report ready' : 'Error: Send failed',
      uiActions: res?.ok && res?.report ? [
        { type: 'refresh_agent', payload: { agentId } },
        { type: 'open_report', payload: { reportId: res.report.id } },
        { type: 'scroll_report_top', payload: {} },
      ] : [{ type: 'refresh_agent', payload: { agentId } }],
    });
  }

  if (parsed.action === 'message') {
    const agentId = _resolveAgent(parsed.objectName) || parsed.objectName || ctx.currentAgentId;
    if (!agentId) return cmdHandled(false, cerberusPersonality.formatQuestion('Which agent'), { uiActivity: 'Error: No agent' });

    if (parsed.payload?.direct || (parsed.payload?.message && !parsed.payload?.append)) {
      const msg = parsed.payload.message;
      uiAgents?.updateAgentMessageDraft?.(msg, agentId);
      window.AtlasVoiceUi?.setCommandActivity?.('Generating: Research report', 'executing');
      const res = await uiAgents?.sendAgentMessage?.(agentId, msg, ctx.currentProjectId, AGENT_DEFAULT_REPORT[agentId]);
      clearMessageCapture();
      const short = res?.ok ? 'Research report ready.' : (res?.message || 'Message failed.');
      return cmdHandled(!!res?.ok, short, {
        uiActivity: res?.ok ? 'Generating: Research report' : 'Error: Message failed',
        uiActions: res?.ok && res?.report ? [
          { type: 'open_agent', payload: { agentId } },
          { type: 'refresh_agent', payload: { agentId } },
          { type: 'open_report', payload: { reportId: res.report.id } },
          { type: 'scroll_report_top', payload: {} },
        ] : [{ type: 'open_agent', payload: { agentId } }],
      });
    }

    if (parsed.payload?.append) {
      _capture = _capture || { mode: 'message_body', agentId, message: '', projectId: ctx.currentProjectId, reportType: AGENT_DEFAULT_REPORT[agentId] };
      _capture.message = [_capture.message, parsed.payload.message].filter(Boolean).join(' ').trim();
      uiAgents?.updateAgentMessageDraft?.(_capture.message, agentId);
      return cmdHandled(true, 'Captured.', {
        uiAction: { type: 'update_agent_message', payload: { text: _capture.message, agentId } },
        uiActivity: 'Executing: Capture message',
      });
    }

    if (parsed.payload?.startCapture || !parsed.payload?.message) {
      _capture = {
        mode: 'message_body',
        agentId,
        message: '',
        projectId: ctx.currentProjectId || null,
        reportType: AGENT_DEFAULT_REPORT[agentId],
      };
      const agentRes = await fetch('/api/cerberus/agents', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
      const agent = (agentRes.agents || []).find((a) => a.id === agentId);
      const name = agent?.name || ctx.currentAgentName || agentId;
      return cmdHandled(true, `What should I send to ${name}?`, {
        uiActions: [
          { type: 'open_agent', payload: { agentId } },
          { type: 'focus_agent_message', payload: { agentId, label: name } },
        ],
        uiActivity: `Executing: Message ${name}`,
      });
    }
  }

  if (parsed.action === 'close_overlay') {
    const tool = parsed.payload?.tool || parsed.objectName;
    const closed = await cerberusOverlayTools.closeOverlayTool?.(tool);
    return cmdHandled(!!closed, closed ? 'Closed.' : 'Nothing to close.', {
      uiAction: closed ? { type: 'close_overlay', payload: { tool } } : null,
      uiActivity: closed ? 'Done: Closed' : 'Error: Nothing to close',
    });
  }

  if (parsed.action === 'close_agent') {
    const reportModal = document.getElementById('cerberus-report-modal');
    if (reportModal && !reportModal.classList.contains('hidden')) {
      await uiAgents?.closeActiveModal?.();
      return cmdHandled(true, 'Closed.', {
        uiAction: { type: 'close_modal', payload: {} },
        uiActivity: 'Done: Closed report',
      });
    }
    const agentModal = document.getElementById('cerberus-agent-office-modal');
    const had = agentModal && !agentModal.classList.contains('hidden');
    if (had) await uiAgents?.closeActiveModal?.();
    return cmdHandled(!!had, had ? 'Closed.' : 'No agent open.', {
      uiAction: had ? { type: 'close_modal', payload: {} } : null,
      uiActivity: had ? 'Done: Closed agent' : 'Error: No agent open',
    });
  }

  if (parsed.action === 'close') {
    const had = uiAgents?.hasOpenModal?.() ?? cerberusOverlayTools.anyOverlayOpen?.();
    return cmdHandled(had, had ? 'Closed.' : 'Nothing to close.', {
      uiAction: had ? { type: 'close_modal', payload: {} } : null,
      uiActivity: had ? 'Executing: Close' : 'Error: Nothing to close',
    });
  }

  if (parsed.action === 'scroll') {
    const ok = _scrollActiveModal(parsed.payload?.direction || 'down');
    return cmdHandled(ok, ok ? 'Scrolling.' : 'No scrollable panel open.');
  }

  if (parsed.action === 'open' && parsed.objectType === 'route') {
    const key = _norm(parsed.objectName).replace(/\s+/g, ' ').replace('cook book', 'cookbook').replace(/^memory$/, 'brain');
    if (cerberusOverlayTools.TOOL_IDS.includes(key)) {
      await cerberusOverlayTools.openOverlayTool(key);
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return cmdHandled(true, `Opening ${label}.`, {
        uiAction: { type: 'open_overlay', payload: { tool: key } },
        uiActivity: `Done: Opening ${label}`,
      });
    }
    const nav = await cerberusVoiceNavigation.tryHandleNavigation(`move to ${parsed.objectName}`);
    if (nav?.handled) return nav;
    return nav;
  }

  if (parsed.objectType === 'project') {
    const projects = await _fetchProjects();
    let proj = null;
    if (parsed.objectName) proj = await _resolveProject(parsed.objectName, projects);
    if (!proj && ctx.currentProjectId) proj = projects.find((p) => p.id === ctx.currentProjectId);

    if (parsed.payload?.prompt && !proj) {
      _awaiting = 'project_name';
      return cmdHandled(true, cerberusPersonality.formatQuestion('Which project'));
    }
    if (!proj) return cmdHandled(false, 'Project not found.');

    if (parsed.action === 'select') {
      return cmdHandled(true, `${proj.name} selected.`, {
        uiActions: [
          { type: 'navigate', payload: { route: 'projects' } },
          { type: 'open_project', payload: { projectId: proj.id } },
        ],
        uiActivity: `Done: ${proj.name} selected`,
      });
    }
    if (parsed.action === 'open') {
      return cmdHandled(true, `Opening ${proj.name}.`, {
        uiActions: [
          { type: 'navigate', payload: { route: 'projects' } },
          { type: 'open_project', payload: { projectId: proj.id } },
          { type: 'open_project_hq', payload: { projectId: proj.id } },
        ],
        uiActivity: `Done: Opening ${proj.name}`,
      });
    }
    if (parsed.action === 'deep_index') {
      const res = await fetch(`/api/cerberus/projects/${proj.id}/deep-index`, { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
      return cmdHandled(!!res.ok, res.message || `Deep indexing ${proj.name}.`, {
        uiAction: { type: 'open_project', payload: { projectId: proj.id } },
        uiActivity: `Done: Deep index ${proj.name}`,
      });
    }
    if (parsed.action === 'generate') {
      const path = parsed.payload?.kind === 'launch_plan'
        ? `/api/cerberus/projects/${proj.id}/create-launch-plan`
        : `/api/cerberus/projects/${proj.id}/generate-cursor-prompt`;
      const genLabel = parsed.payload?.kind === 'launch_plan' ? 'Launch plan' : 'Cursor prompt';
      window.AtlasVoiceUi?.setCommandActivity?.(`Generating: ${genLabel}`, 'executing');
      const res = await fetch(path, { method: 'POST', credentials: 'same-origin' }).then((r) => r.json());
      const short = parsed.payload?.kind === 'launch_plan' ? 'Launch plan ready.' : 'Cursor prompt generated.';
      const actions = [
        { type: 'navigate', payload: { route: 'projects' } },
        { type: 'open_project', payload: { projectId: proj.id } },
      ];
      if (res?.ok && res?.report?.id) {
        actions.push(
          { type: 'open_report', payload: { reportId: res.report.id } },
          { type: 'scroll_report_top', payload: {} },
        );
      }
      return cmdHandled(!!res.ok, res.ok ? short : (res.message || 'Request failed.'), {
        uiActions: actions,
        uiActivity: res.ok ? `Done: ${short}` : 'Error: Generate failed',
      });
    }
    if (parsed.action === 'review') {
      const res = await fetch(`/api/cerberus/projects/${proj.id}/council-review`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then((r) => r.json());
      const actions = [
        { type: 'navigate', payload: { route: 'projects' } },
        { type: 'open_project', payload: { projectId: proj.id } },
      ];
      if (res?.ok && res?.report?.id) {
        actions.push({ type: 'open_report', payload: { reportId: res.report.id } });
      }
      return cmdHandled(!!res.ok, res.ok ? 'Council review started.' : (res.message || 'Council review failed.'), {
        uiActions: actions,
        uiActivity: res.ok ? 'Done: Council review started' : 'Error: Council review failed',
      });
    }
  }

  if (parsed.objectType === 'agent') {
    const agentId = _resolveAgent(parsed.objectName) || parsed.objectName;
    if (!agentId) return cmdHandled(false, 'Agent not found.', { uiActivity: 'Error: Agent not found' });
    const agents = await fetch('/api/cerberus/agents', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
    const agent = (agents.agents || []).find((a) => a.id === agentId);
    const label = agent?.name || agentId;
    return cmdHandled(true, `${label} selected.`, {
      uiActions: [
        { type: 'navigate', payload: { route: 'agents' } },
        { type: 'open_agent', payload: { agentId } },
      ],
      uiActivity: `Done: ${label} selected`,
    });
  }

  if (parsed.objectType === 'report') {
    if (parsed.action === 'open') {
      if (parsed.objectName === 'latest') {
        const aid = ctx.currentAgentId;
        await uiAgents?.refreshOffice?.();
        const result = await uiAgents?.pickLatestReportInfo?.(aid);
        const ok = result?.ok;
        return cmdHandled(!!ok, ok ? 'Opening latest report.' : (result?.message || 'No report found.'), {
          uiActions: ok ? [
            { type: 'open_report', payload: { reportId: result.reportId } },
            { type: 'scroll_report_top', payload: {} },
          ] : [
            { type: 'refresh_agent', payload: { agentId: aid } },
            { type: 'show_command_result', payload: { message: result?.message || 'No report found.', ok: false } },
          ],
          uiActivity: ok ? 'Executing: Open latest report' : `Error: ${result?.message || 'No report'}`,
        });
      }
      const ok = await uiAgents?.openReportByTitle?.(parsed.objectName, ctx.currentAgentId);
      return cmdHandled(!!ok, ok ? 'Opening report.' : 'Report not found.', {
        uiActivity: ok ? 'Done: Opening report' : 'Error: Report not found',
      });
    }
    if (parsed.action === 'read_report') {
      const summary = document.getElementById('cerberus-report-modal-summary')?.textContent?.trim()
        || document.getElementById('cerberus-report-modal-body')?.textContent?.trim()?.slice(0, 1200);
      return cmdHandled(!!summary, summary || 'No report open to read.', {
        speakFull: true,
        uiActivity: 'Executing: Read report',
      });
    }
    if (['approve', 'revise', 'archive', 'send_next'].includes(parsed.action)) {
      const rid = ctx.currentReportId
        || document.getElementById('cerberus-report-modal')?.dataset?.activeReportId;
      if (!rid) return cmdHandled(false, 'No report open.', { uiActivity: 'Error: No report open' });
      await uiAgents?.actOnReport?.(rid, parsed.action);
      const labels = { approve: 'Approved.', revise: 'Revision requested.', archive: 'Archived.', send_next: 'Sent to next agent.' };
      return cmdHandled(true, labels[parsed.action] || 'Updated.', {
        uiActions: [
          { type: 'refresh_agent', payload: { agentId: ctx.currentAgentId } },
          { type: 'refresh_reports', payload: {} },
        ],
        uiActivity: `Done: ${labels[parsed.action]}`,
      });
    }
    if (parsed.action === 'summarise') {
      const summary = document.getElementById('cerberus-report-modal-summary')?.textContent?.trim()
        || document.getElementById('cerberus-report-modal-body')?.textContent?.trim()?.slice(0, 300);
      return cmdHandled(true, summary || 'No summary available.', {
        uiActivity: 'Done: Summary',
      });
    }
  }

  if (parsed.objectType === 'report_type') {
    const agentId = ctx.currentAgentId;
    if (!agentId) return cmdHandled(false, 'Select an agent first.');
    let typeId = null;
    const q = _norm(parsed.objectName || '');
    for (const [id, labels] of Object.entries(REPORT_TYPES)) {
      if (labels.some((l) => q.includes(l) || l.includes(q))) { typeId = id; break; }
    }
    if (!typeId && parsed.payload?.prompt) {
      return cmdHandled(true, 'Say a report type: research report, business proposal, architecture plan, developer cursor prompt, or marketing launch plan.');
    }
    if (typeId) {
      uiAgents?.setAgentReportType?.(agentId, typeId);
      if (_capture) _capture.reportType = typeId;
      return cmdHandled(true, 'Report type selected.');
    }
    return cmdHandled(false, 'Report type not recognized.');
  }

  if (parsed.action === 'open' && parsed.objectName === 'project_hq') {
    const pid = parsed.payload?.projectId || ctx.currentProjectId;
    if (!pid) return cmdHandled(false, 'No project selected.');
    await uiProjects?.openProjectHQ?.(pid);
    return cmdHandled(true, 'Opening Project HQ.');
  }

  return cmdUnhandled();
}

export async function tryHandleVoiceAction(transcript) {
  const ctx = AtlasVoiceContext.get();
  _debug('transcript', transcript);
  _debug('context', ctx);

  const personalResult = await cerberusPersonalisationVoice.tryHandlePersonalisationVoice(transcript);
  if (personalResult?.handled) return personalResult;

  const calResult = await cerberusCalendarVoice.tryHandleCalendarVoice(transcript);
  if (calResult?.handled) return calResult;

  const notesResult = await atlasNotesVoice.tryHandleNotesVoice(transcript);
  if (notesResult?.handled) return notesResult;

  const parsed = parseVoiceAction(transcript, ctx);
  _debug('parsed', parsed);

  if (!parsed.handled) {
    if (_capture?.mode === 'message_body') {
      const raw = _stripPrefixes(String(transcript || '').trim());
      if (raw) {
        _capture.message = [_capture.message, raw].filter(Boolean).join(' ').trim();
        window.AtlasAgentsUI?.updateAgentMessageDraft?.(_capture.message, _capture.agentId);
        return cmdHandled(true, 'Captured.', {
          uiAction: { type: 'update_agent_message', payload: { text: _capture.message, agentId: _capture.agentId } },
          uiActivity: 'Executing: Capture message',
        });
      }
    }
    return cmdUnhandled();
  }

  const result = await _executeParsed(parsed);
  _debug('executed', result);
  _debug('handled', result?.handled);
  if (_awaiting && parsed.objectType === 'project' && parsed.objectName) _awaiting = null;
  return result;
}

const cerberusVoiceActions = {
  parseVoiceAction,
  tryHandleVoiceAction,
  getMessageCaptureState,
  clearMessageCapture,
};

export default cerberusVoiceActions;
