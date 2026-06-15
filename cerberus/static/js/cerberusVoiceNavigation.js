// Cerberus OS — voice navigation + project/council voice actions (client-side)

import cerberusActiveProject from './cerberusActiveProject.js';
import cerberusOverlayTools from './cerberusOverlayTools.js';
import cerberusPersonality from './cerberusPersonality.js';
import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';
import officesModal from './officesModal.js';

let _deps = {};
let _councilStatus = 'IDLE';

// Every target routes through _openModal → homeModule.openAtlasModal →
// cerberusShellModals.openShellModal. Voice MUST use the exact same path as a
// mouse click on the globe node, so the two can never drift apart again.
const NAV_TARGETS = {
  home: { label: 'Home', paths: ['/home', '/'], navigate: () => _goHome() },
  assistant: { label: 'Assistant', paths: ['/assistant'], navigate: () => _openModal('assistant') },
  projects: { label: 'Projects', paths: ['/projects'], navigate: () => _openModal('projects') },
  agents: { label: 'Agents', paths: ['/agents'], navigate: () => _openModal('offices') },
  offices: { label: 'Offices', paths: ['/agents'], navigate: () => _openModal('offices') },
  finance: { label: 'Finance', paths: ['/finance'], navigate: () => _openModal('finance') },
  brain: { label: 'Brain', paths: ['/memory'], navigate: () => _openModal('brain'), aliases: ['memory', 'the brain'] },
  tasks: { label: 'Tasks', paths: ['/tasks'], navigate: () => _openModal('tasks') },
  tools: { label: 'Tools', paths: [], navigate: () => _openModal('tools') },
  calendar: { label: 'Calendar', paths: ['/calendar'], navigate: () => _openModal('calendar') },
  notes: { label: 'Notes', paths: ['/notes'], navigate: () => _openModal('notes') },
  library: { label: 'Library', paths: ['/library'], navigate: () => _openModal('library') },
  cookbook: { label: 'Cookbook', paths: ['/cookbook'], navigate: () => _openModal('cookbook') },
  settings: { label: 'Settings', paths: [], navigate: () => _openModal('settings') },
  voice: {
    label: 'Voice Commands',
    paths: [],
    navigate: () => _openModal('voice'),
    aliases: ['voice command cheat sheet', 'voice cheat sheet', 'voice commands list', 'cheat sheet'],
  },
  monitor: {
    label: 'System Monitor',
    paths: [],
    navigate: () => _openModal('monitor'),
    aliases: ['system monitor', 'sys monitor', 'performance monitor'],
  },
};

const NAV_PREFIX = /^(?:(?:hey\s+)?atlas\s+)?(?:(?:can\s+you|could\s+you|please)\s+)?(?:move\s+to|navigate\s+to|switch\s+to|go\s+to|open|launch|start|run)\s+/i;

const DESTRUCTIVE = [
  /\bdelete\b/i,
  /\bshutdown\b/i,
  /\brestart\s+(?:the\s+)?(?:pc|computer)\b/i,
  /\bformat\b/i,
  /\bremove\s+project\b/i,
];

function _norm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function _goHome() {
  await window.homeModule?.showHome?.({ skipHistory: false });
  history.pushState({ atlasView: 'home' }, '', '/home');
}

async function _openModal(id) {
  await window.homeModule?.showHome?.({ skipHistory: true });
  await window.homeModule?.openAtlasModal?.(id);
}

function _openTool(id) {
  _deps.openTool?.(id);
}

async function _fetchJson(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts });
  return res.json();
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

export function setCouncilStatus(status) {
  _councilStatus = status || 'IDLE';
}

export function getCouncilStatus() {
  return _councilStatus;
}

export function isDestructiveCommand(text) {
  const t = String(text || '');
  return DESTRUCTIVE.some((re) => re.test(t));
}

/**
 * True when the text *looks like* an open/navigate command ("open …",
 * "go to …"). Used as the last step of the voice pipeline: a navigation-shaped
 * command that nothing recognised gets a quiet notification instead of being
 * sent to the LLM or surfaced as an error.
 */
export function looksLikeNavigationCommand(text) {
  return NAV_PREFIX.test(_norm(text));
}

/** Non-blocking "unknown command" notice (toast — never a blocking error). */
export function notifyUnknownCommand(text) {
  const short = String(text || '').trim().slice(0, 60);
  const fn = _deps.showToast || window.uiModule?.showToast;
  if (fn) {
    fn(`Unknown command: “${short}” — say “open voice commands” for the list`, 3200);
  }
  return cmdHandled(true, 'I don’t know that command yet. Say “open voice commands” to see what I understand.');
}

export async function tryHandleNavigation(text) {
  const raw = String(text || '').trim();
  let norm = _norm(raw);
  if (!norm) return cmdUnhandled();

  const m = norm.match(NAV_PREFIX);
  if (m) norm = norm.slice(m[0].length).trim();

  if (norm === 'show brain' || norm === 'show the brain') {
    await _openModal('brain');
    return cmdHandled(true, cerberusPersonality.formatAction('Opening Brain'));
  }

  if (norm === 'show pending reports' || norm === 'pending reports') {
    await _openModal('brain');
    return cmdHandled(true, cerberusPersonality.formatAction('Opening pending reports in Brain'));
  }

  for (const [key, cfg] of Object.entries(NAV_TARGETS)) {
    const aliases = cfg.aliases || [];
    if (norm === key || norm === cfg.label.toLowerCase() || aliases.includes(norm)) {
      await cfg.navigate();
      const isOverlay = cerberusOverlayTools.TOOL_IDS?.includes?.(key);
      return cmdHandled(true, cerberusPersonality.formatAction(`Opening ${cfg.label}`), {
        uiAction: isOverlay
          ? { type: 'open_overlay', payload: { tool: key } }
          : { type: 'open_modal', payload: { modal: key } },
        uiActivity: `Done: Opening ${cfg.label}`,
      });
    }
  }

  const openOffice = norm.match(/^open\s+office(?:\s+(.+))?$/);
  if (openOffice) {
    await _openModal('offices');
    if (openOffice[1]) {
      const office = officesModal.openOfficeByName(openOffice[1]);
      if (!office) {
        return cmdHandled(true, `Which office would you like to open? Available: ${officesModal.getOffices().map((o) => o.name).join(', ')}`);
      }
    }
    return cmdHandled(true, cerberusPersonality.formatAction('Opening Offices'));
  }

  const openNamed = norm.match(/^(?:open|launch|start|run)\s+(.+)$/);
  if (openNamed) {
    const name = openNamed[1];
    if (officesModal.openAgentByName(name)) {
      await _openModal('offices');
      return cmdHandled(true, cerberusPersonality.formatAction(`Opening ${name}`));
    }
  }

  if (norm === 'create agent' || norm.startsWith('create agent ')) {
    await _openModal('offices');
    return cmdHandled(true, 'Use the Offices modal to create a new agent in a department.');
  }

  const assignAgent = norm.match(/^assign\s+agent\s+to\s+(.+)$/);
  if (assignAgent) {
    await _openModal('offices');
    return cmdHandled(true, `Which department in ${assignAgent[1]}? Reply with the department name.`);
  }

  return cmdUnhandled();
}

export async function tryHandleAtlasCommands(text) {
  const norm = _norm(text);
  if (!norm) return cmdUnhandled();

  if (norm === 'stop speaking') {
    window.speechSynthesis?.cancel();
    return cmdHandled(true, 'Stopped speaking.');
  }
  if (norm === 'repeat') {
    return cmdHandled(true, 'Repeat is not available for the last reply yet.');
  }
  if (norm === 'continue') {
    return cmdHandled(true, 'Continuing.');
  }
  if (norm === 'refresh workspace') {
    await window.homeModule?.prefetchAtlasData?.();
    return cmdHandled(true, 'Workspace refreshed.');
  }

  return cmdUnhandled();
}

export async function tryHandleProjectCommands(text) {
  const norm = _norm(text);
  if (!norm) return cmdUnhandled();

  let projects = [];
  try {
    const data = await _fetchJson('/api/cerberus/projects');
    projects = data.projects || data || [];
  } catch (_) {
    return cmdUnhandled();
  }

  const activeId = cerberusActiveProject.getActiveProjectId?.();
  const active = projects.find((p) => p.id === activeId) || projects[0];

  const openHq = norm.match(/^(?:open\s+)?(?:project\s+)?hq(?:\s+for\s+(.+))?$/);
  if (openHq) {
    const proj = openHq[1] ? await _resolveProject(openHq[1], projects) : active;
    if (proj) {
      const mod = await import('./cerberusProjectHQ.js');
      mod.default.openProjectHQ(proj.id);
      return cmdHandled(true, cerberusPersonality.formatAction(`Opening Project HQ for ${proj.name || proj.id}`));
    }
  }

  const review = norm.match(/^review\s+(.+)$/);
  if (review) {
    const proj = await _resolveProject(review[1], projects);
    if (proj) {
      const mod = await import('./cerberusProjectHQ.js');
      mod.default.openProjectHQ(proj.id);
      return cmdHandled(true, cerberusPersonality.formatAction(`Opening ${proj.name} for review`));
    }
  }

  const council = norm.match(/^(?:run\s+)?council\s+review(?:\s+(?:for\s+)?(.+))?$/);
  if (council) {
    const proj = council[1] ? await _resolveProject(council[1], projects) : active;
    if (!proj) return cmdHandled(false, 'No project found for council review.');
    setCouncilStatus('RUNNING');
    const res = await _fetchJson(`/api/cerberus/projects/${proj.id}/council-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    setCouncilStatus(res.ok ? 'READY' : 'IDLE');
    return cmdHandled(!!res.ok, res.message || (res.ok ? 'Council review started.' : 'Council review failed.'));
  }

  const cursorPrompt = norm.match(/^generate\s+cursor\s+prompt(?:\s+(?:for\s+)?(.+))?$/);
  if (cursorPrompt) {
    const proj = cursorPrompt[1] ? await _resolveProject(cursorPrompt[1], projects) : active;
    if (!proj) return cmdHandled(false, 'No project found.');
    const res = await _fetchJson(`/api/cerberus/projects/${proj.id}/generate-cursor-prompt`, { method: 'POST' });
    return cmdHandled(!!res.ok, res.message || (res.ok ? 'Cursor prompt generated.' : 'Failed to generate prompt.'));
  }

  const launchPlan = norm.match(/^generate\s+launch\s+plan(?:\s+(?:for\s+)?(.+))?$/);
  if (launchPlan) {
    const proj = launchPlan[1] ? await _resolveProject(launchPlan[1], projects) : active;
    if (!proj) return cmdHandled(false, 'No project found.');
    const res = await _fetchJson(`/api/cerberus/projects/${proj.id}/create-launch-plan`, { method: 'POST' });
    return cmdHandled(!!res.ok, res.message || (res.ok ? 'Launch plan created.' : 'Failed to create launch plan.'));
  }

  const deepIndex = norm.match(/^deep\s+index(?:\s+project)?(?:\s+(?:for\s+)?(.+))?$/);
  if (deepIndex) {
    const proj = deepIndex[1] ? await _resolveProject(deepIndex[1], projects) : active;
    if (!proj) return cmdHandled(false, 'No project found.');
    const res = await _fetchJson(`/api/cerberus/projects/${proj.id}/deep-index`, { method: 'POST' });
    return cmdHandled(!!res.ok, res.message || (res.ok ? 'Deep index started.' : 'Deep index failed.'));
  }

  if (norm === 'open active project' || norm === 'open latest project') {
    const proj = active;
    if (!proj) return cmdHandled(false, 'No active project set.');
    const mod = await import('./cerberusProjectHQ.js');
    mod.default.openProjectHQ(proj.id);
    return cmdHandled(true, cerberusPersonality.formatAction(`Opening ${proj.name || proj.id}`));
  }

  return cmdUnhandled();
}

export function initAtlasVoiceNavigation(deps = {}) {
  _deps = deps;
}

const cerberusVoiceNavigation = {
  tryHandleNavigation,
  tryHandleAtlasCommands,
  tryHandleProjectCommands,
  isDestructiveCommand,
  looksLikeNavigationCommand,
  notifyUnknownCommand,
  setCouncilStatus,
  getCouncilStatus,
  initAtlasVoiceNavigation,
};

export default cerberusVoiceNavigation;
