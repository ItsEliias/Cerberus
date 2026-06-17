// Active project context for Assistant chat

const STORAGE_KEY = 'atlas-active-project-id';

let _activeId = null;
let _activeName = null;
let _deps = {};

function _el(id) {
  return document.getElementById(id);
}

export function getActiveProjectId() {
  if (_activeId) return _activeId;
  try {
    return sessionStorage.getItem(STORAGE_KEY) || null;
  } catch (_) {
    return null;
  }
}

export function getActiveProjectName() {
  return _activeName || '';
}

export function setActiveProject(project) {
  if (!project || !project.id) {
    clearActiveProject();
    return;
  }
  _activeId = project.id;
  _activeName = project.name || project.id;
  try {
    sessionStorage.setItem(STORAGE_KEY, _activeId);
    sessionStorage.setItem(`${STORAGE_KEY}-name`, _activeName);
  } catch (_) {}
  _renderBanner();
}

export function clearActiveProject() {
  _activeId = null;
  _activeName = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(`${STORAGE_KEY}-name`);
  } catch (_) {}
  _renderBanner();
}

function _renderBanner() {
  const bar = _el('atlas-project-context-bar');
  const label = _el('atlas-project-context-label');
  if (!bar) return;
  const id = getActiveProjectId();
  if (!id) {
    bar.classList.add('hidden');
    return;
  }
  let name = _activeName;
  if (!name) {
    try { name = sessionStorage.getItem(`${STORAGE_KEY}-name`) || id; } catch (_) { name = id; }
  }
  if (label) label.textContent = `Project Context: ${name}`;
  bar.classList.remove('hidden');
}

export async function openAssistantWithProject(projectId, projectName) {
  setActiveProject({ id: projectId, name: projectName });
  try {
    await fetch(`/api/atlas/projects/${projectId}/activity`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chat' }),
    });
  } catch (_) {}
  if (_deps.navigateAssistant) {
    _deps.navigateAssistant();
  } else if (typeof window !== 'undefined') {
    window.location.href = '/assistant';
  }
}

export function initAtlasActiveProject(deps = {}) {
  _deps = deps;
  try {
    _activeId = sessionStorage.getItem(STORAGE_KEY);
    _activeName = sessionStorage.getItem(`${STORAGE_KEY}-name`);
  } catch (_) {}
  _el('atlas-project-context-clear')?.addEventListener('click', clearActiveProject);
  _renderBanner();
}

const atlasActiveProject = {
  getActiveProjectId,
  getActiveProjectName,
  setActiveProject,
  clearActiveProject,
  openAssistantWithProject,
  initAtlasActiveProject,
};

export default atlasActiveProject;
