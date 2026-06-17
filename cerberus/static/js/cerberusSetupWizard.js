// Cerberus CE — first-run onboarding wizard (backend-driven setup state)

const STEP_COUNT = 7;
const STEP_KEY = 'cerberus_setup_wizard_step';

let _deps = {};
let _bound = false;
let _step = 0;
let _status = null;
let _gateResolve = null;
let _workspacePath = './CerberusWorkspace';

const _BUILDING_LABELS = {
  business: 'Business',
  startup: 'Startup',
  personal: 'Personal',
  content: 'Content',
  development: 'Development',
};

const _MODEL_LABELS = {
  gemma: 'Gemma',
  qwen: 'Qwen',
  mistral: 'Mistral',
  'gpt-oss': 'GPT OSS',
  skip: 'Skip for now',
};

function _el(id) {
  return document.getElementById(id);
}

function _show() {
  const overlay = _el('cerberus-setup-wizard');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cerberus-setup-wizard-open');
}

function _hide() {
  const overlay = _el('cerberus-setup-wizard');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cerberus-setup-wizard-open');
}

async function _fetchStatus() {
  const res = await fetch('/api/cerberus/setup/status', { credentials: 'same-origin' });
  const data = await res.json();
  if (!res.ok && data.shouldShowWizard !== false) {
    return {
      shouldShowWizard: true,
      workspacePath: './CerberusWorkspace',
      setupComplete: false,
    };
  }
  return data;
}

function _readForm() {
  return {
    userName: (_el('cerberus-setup-user-name')?.value || '').trim(),
    userRole: (_el('cerberus-setup-user-role')?.value || '').trim(),
    userCompany: (_el('cerberus-setup-user-company')?.value || '').trim(),
    userHobbies: (_el('cerberus-setup-user-hobbies')?.value || '').trim(),
    officeName: (_el('cerberus-setup-office-name')?.value || '').trim(),
    buildingType: document.querySelector('input[name="cerberus-setup-building"]:checked')?.value || 'personal',
    aiModel: document.querySelector('input[name="cerberus-setup-model"]:checked')?.value || 'gemma',
    workspacePath: _workspacePath,
  };
}

function _validateStep(step) {
  const form = _readForm();
  if (step === 1 && !form.userName) {
    _deps.showToast?.('Enter your name');
    _el('cerberus-setup-user-name')?.focus();
    return false;
  }
  if (step === 2 && !form.officeName) {
    _deps.showToast?.('Enter your first office name');
    _el('cerberus-setup-office-name')?.focus();
    return false;
  }
  return true;
}

function _updateProgress() {
  document.querySelectorAll('.cerberus-setup-progress-item').forEach((item) => {
    const idx = Number(item.dataset.stepIndex);
    item.classList.toggle('cerberus-setup-progress-item--active', idx === _step);
    item.classList.toggle('cerberus-setup-progress-item--done', idx < _step);
  });
}

function _updateNav() {
  const back = _el('cerberus-setup-back');
  const next = _el('cerberus-setup-next');
  const nav = _el('cerberus-setup-nav');
  const start = _el('cerberus-setup-start');
  const finish = _el('cerberus-setup-finish');

  const onWelcome = _step === 0;
  const onFinish = _step === STEP_COUNT - 1;

  if (nav) nav.hidden = onWelcome || onFinish;
  if (back) back.hidden = onWelcome || onFinish || _step <= 0;
  if (next) next.hidden = onWelcome || onFinish;
  if (start) start.hidden = !onWelcome;
  if (finish) finish.hidden = !onFinish;
}

function _showStep(step) {
  _step = Math.max(0, Math.min(STEP_COUNT - 1, step));
  try {
    sessionStorage.setItem(STEP_KEY, String(_step));
  } catch (_) {}

  document.querySelectorAll('.cerberus-setup-step').forEach((panel) => {
    const idx = Number(panel.dataset.setupStep);
    const active = idx === _step;
    panel.classList.toggle('cerberus-setup-step--active', active);
    panel.hidden = !active;
  });

  if (_step === STEP_COUNT - 1) _fillSummary();
  _updateProgress();
  _updateNav();
}

function _fillSummary() {
  const form = _readForm();
  const nameEl = _el('cerberus-setup-summary-name');
  const roleEl = _el('cerberus-setup-summary-role');
  const roleRow = _el('cerberus-setup-summary-role-row');
  const companyEl = _el('cerberus-setup-summary-company');
  const companyRow = _el('cerberus-setup-summary-company-row');
  const officeEl = _el('cerberus-setup-summary-office');
  const buildingEl = _el('cerberus-setup-summary-building');
  const modelEl = _el('cerberus-setup-summary-model');
  const storageEl = _el('cerberus-setup-summary-storage');
  if (nameEl) nameEl.textContent = form.userName || '—';
  if (roleEl) roleEl.textContent = form.userRole || '—';
  if (roleRow) roleRow.hidden = !form.userRole;
  if (companyEl) companyEl.textContent = form.userCompany || '—';
  if (companyRow) companyRow.hidden = !form.userCompany;
  if (officeEl) officeEl.textContent = form.officeName || '—';
  if (buildingEl) buildingEl.textContent = _BUILDING_LABELS[form.buildingType] || form.buildingType;
  if (modelEl) modelEl.textContent = _MODEL_LABELS[form.aiModel] || form.aiModel;
  if (storageEl) storageEl.textContent = form.workspacePath || './CerberusWorkspace';
}

function _applyStatus(status) {
  _status = status;
  _workspacePath = status.workspacePath || status.storagePath || './CerberusWorkspace';
  const pathEl = _el('cerberus-setup-storage-path');
  if (pathEl) pathEl.textContent = _workspacePath;
}

async function _completeSetup() {
  const btn = _el('cerberus-setup-finish');
  const form = _readForm();
  if (!form.userName || !form.officeName) {
    _deps.showToast?.('Enter your name and first office name');
    _showStep(1);
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Setting up…';
  }

  try {
    const res = await fetch('/api/cerberus/setup/complete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: form.userName,
        userRole: form.userRole,
        userCompany: form.userCompany,
        userHobbies: form.userHobbies,
        officeName: form.officeName,
        buildingType: form.buildingType,
        aiProvider: 'local',
        aiModel: form.aiModel,
        workspacePath: form.workspacePath,
        createFirstEmployee: false,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      _deps.showToast?.(data.message || 'Setup failed');
      return;
    }

    try {
      sessionStorage.removeItem(STEP_KEY);
      localStorage.removeItem('cerberus_offices_v1');
      localStorage.removeItem('cerberus_offices_v2');
      localStorage.removeItem('cerberus_graph_tasks_v1');
    } catch (_) {}

    _hide();
    _deps.showToast?.(data.message || 'Cerberus workspace ready.');
    await _deps.onComplete?.(data);
    _gateResolve?.(true);
    _gateResolve = null;
  } catch (_) {
    _deps.showToast?.('Setup failed — try again');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Finish Setup';
    }
  }
}

function _bind() {
  if (_bound) return;
  _bound = true;

  _el('cerberus-setup-start')?.addEventListener('click', () => _showStep(1));
  _el('cerberus-setup-back')?.addEventListener('click', () => _showStep(_step - 1));
  _el('cerberus-setup-next')?.addEventListener('click', () => {
    if (!_validateStep(_step)) return;
    _showStep(_step + 1);
  });
  _el('cerberus-setup-finish')?.addEventListener('click', () => void _completeSetup());

  _el('cerberus-setup-storage-default')?.addEventListener('click', () => {
    _workspacePath = _status?.workspacePath || './CerberusWorkspace';
    const pathEl = _el('cerberus-setup-storage-path');
    if (pathEl) pathEl.textContent = _workspacePath;
  });

  _el('cerberus-setup-user-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (_validateStep(1)) _showStep(2);
    }
  });
  _el('cerberus-setup-office-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (_validateStep(2)) _showStep(3);
    }
  });
}

/**
 * Block app boot until setup is complete or wizard is dismissed as unnecessary.
 * Resolves when the user may use Atlas normally.
 */
export function bootSetupGate(deps = {}) {
  _deps = { ..._deps, ...deps };
  _bind();

  return new Promise(async (resolve) => {
    _gateResolve = resolve;
    try {
      const status = await _fetchStatus();
      if (!status.shouldShowWizard) {
        _gateResolve = null;
        resolve(false);
        return;
      }

      _applyStatus(status);
      let resumeStep = 0;
      try {
        const saved = Number(sessionStorage.getItem(STEP_KEY));
        if (saved >= 1 && saved < STEP_COUNT) resumeStep = saved;
      } catch (_) {}
      _show();
      _showStep(resumeStep);
    } catch (_) {
      _gateResolve = null;
      resolve(false);
    }
  });
}

/** @deprecated Use bootSetupGate — kept for manual/testing hooks */
export async function maybeShowSetupWizard(deps = {}) {
  _deps = { ..._deps, ...deps };
  _bind();
  const status = await _fetchStatus();
  if (!status.shouldShowWizard) return false;
  _applyStatus(status);
  _show();
  _showStep(0);
  return true;
}

export function initAtlasSetupWizard(deps = {}) {
  _deps = { ..._deps, ...deps };
  _bind();
}

async function resetForTesting() {
  try {
    const res = await fetch('/api/cerberus/setup/reset', {
      method: 'POST',
      credentials: 'same-origin',
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('[AtlasSetup] reset failed:', data.message || res.status);
      return data;
    }
    try {
      sessionStorage.removeItem(STEP_KEY);
    } catch (_) {}
    console.info('[AtlasSetup] reset OK — reload the page to see the wizard.');
    return data;
  } catch (err) {
    console.warn('[AtlasSetup] reset error:', err);
    return { ok: false, message: String(err) };
  }
}

if (typeof window !== 'undefined') {
  window.AtlasSetup = {
    resetForTesting,
    bootSetupGate,
    maybeShowSetupWizard,
    initAtlasSetupWizard,
  };
}

export default {
  initAtlasSetupWizard,
  bootSetupGate,
  maybeShowSetupWizard,
  resetForTesting,
};
