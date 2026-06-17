// Cerberus OS — user profile, theme, voice identity (Personalisation V2)

import cerberusPersonality from './cerberusPersonality.js';

export const THEMES = {
  'default-blue': { label: 'Cerberus Blue', toast: 'Cerberus Blue Theme Activated' },
  'matrix-green': { label: 'Matrix Green', toast: 'Matrix Theme Activated' },
  purple: { label: 'Purple', toast: 'Purple Theme Activated' },
  'red-gold': { label: 'Red Gold', toast: 'Red Gold Theme Activated' },
  pink: { label: 'Pink', toast: 'Pink Theme Activated' },
};

export const IDENTITY_DEFAULTS = {
  Atlas: {
    voice_gender: 'male',
    preferred_voice: 'Google UK English Male',
    preferred_address: 'sir',
    response_style: 'professional',
  },
  Cerberusia: {
    voice_gender: 'female',
    preferred_voice: 'Google UK English Female',
    preferred_address: 'sir',
    response_style: 'friendly',
  },
};

const THEME_ALIASES = {
  blue: 'default-blue',
  'cerberus blue': 'default-blue',
  default: 'default-blue',
  matrix: 'matrix-green',
  green: 'matrix-green',
  'matrix green': 'matrix-green',
  purple: 'purple',
  gold: 'red-gold',
  'red gold': 'red-gold',
  red: 'red-gold',
  pink: 'pink',
};

let _settings = null;
let _transitionTimer = 0;

function _normalizeSettings(raw) {
  const s = { ...raw };
  const addr = String(s.preferred_address || s.address_style || 'sir').trim().toLowerCase();
  s.preferred_address = addr === 'maam' || addr === 'madam' ? "ma'am" : addr;
  s.address_style = s.preferred_address || 'sir';
  s.speech_rate = Math.max(0.5, Math.min(2, Number(s.speech_rate) || 1));
  if (!THEMES[s.theme]) s.theme = 'default-blue';
  return s;
}

export function resolveThemeId(query) {
  const q = String(query || '').trim().toLowerCase();
  return THEME_ALIASES[q] || (THEMES[q] ? q : null);
}

export function getAtlasUserSettings() {
  if (_settings) return { ..._settings };
  return {
    assistant_identity: 'Cerberus',
    theme: 'default-blue',
    speech_rate: 1,
    response_style: 'professional',
    ...IDENTITY_DEFAULTS.Atlas,
  };
}

export function applyAtlasTheme(themeId, { animate = true } = {}) {
  const id = THEMES[themeId] ? themeId : 'default-blue';
  const root = document.documentElement;
  const body = document.body;
  if (animate && body.classList.contains('cerberus-os')) {
    body.classList.add('cerberus-theme-transitioning');
    clearTimeout(_transitionTimer);
    _transitionTimer = window.setTimeout(() => {
      body.classList.remove('cerberus-theme-transitioning');
    }, 280);
  }
  root.dataset.atlasTheme = id;
  if (body) body.dataset.atlasTheme = id;
  const theme = THEMES[id];
  root.style.setProperty('--atlas-accent', `var(--atlas-primary)`);
  return theme;
}

export function applyAtlasUserSettings(settings, opts = {}) {
  if (!settings) return;
  _settings = _normalizeSettings(settings);
  applyAtlasTheme(_settings.theme, opts);
  window.dispatchEvent(new CustomEvent('cerberus-user-settings-changed', { detail: getAtlasUserSettings() }));
}

export async function loadAtlasUserSettings() {
  try {
    const res = await fetch('/api/cerberus/user-settings', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.ok && data.settings) {
      applyAtlasUserSettings(data.settings, { animate: false });
      return data.settings;
    }
  } catch (_) {}
  applyAtlasUserSettings({ assistant_identity: 'Cerberus', theme: 'default-blue', ...IDENTITY_DEFAULTS.Atlas }, { animate: false });
  return getAtlasUserSettings();
}

export async function patchAtlasUserSettings(patch, { toast = null, animateTheme = true } = {}) {
  const res = await fetch('/api/cerberus/user-settings', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (data.ok && data.settings) {
    applyAtlasUserSettings(data.settings, { animate: animateTheme && 'theme' in patch });
    if (toast) _showToast(toast);
  }
  return data;
}

function _showToast(msg) {
  try {
    if (window.uiModule?.showToast) window.uiModule.showToast(msg);
    else if (window.showToast) window.showToast(msg);
  } catch (_) {}
}

export function toastThemeChange(themeId) {
  const t = THEMES[themeId];
  _showToast(t ? `✓ Theme changed — ${t.toast}` : '✓ Theme changed');
}

export function toastIdentityChange(identity) {
  const voice = identity === 'Cerberusia' ? 'British Female' : 'British Male';
  _showToast(`✓ ${identity} Activated — Voice: ${voice}`);
}

export function toastAddressChange(address) {
  const label = address || 'no title';
  _showToast(`✓ Preferred address updated — Cerberus will now refer to you as "${label}"`);
}

export function getActivationGreeting() {
  return cerberusPersonality.getGreeting();
}

export function getPreferredVoiceName() {
  return getAtlasUserSettings().preferred_voice || 'Google UK English Male';
}

export function getAddressStyle() {
  return getAtlasUserSettings().preferred_address || getAtlasUserSettings().address_style || 'sir';
}

export function getSpeechRate() {
  return getAtlasUserSettings().speech_rate || 1;
}

export const cerberusUserSettings = {
  THEMES,
  IDENTITY_DEFAULTS,
  THEME_ALIASES,
  resolveThemeId,
  loadAtlasUserSettings,
  patchAtlasUserSettings,
  applyAtlasUserSettings,
  applyAtlasTheme,
  getAtlasUserSettings,
  getActivationGreeting,
  getPreferredVoiceName,
  getAddressStyle,
  getSpeechRate,
  toastThemeChange,
  toastIdentityChange,
  toastAddressChange,
};

window.AtlasUserSettings = cerberusUserSettings;
export default cerberusUserSettings;
