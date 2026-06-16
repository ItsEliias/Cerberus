// Cerberus OS — dynamic assistant personality, addressing, and phrasing

const ASSISTANT_PROFILES = {
  Atlas: { id: 'Cerberus', label: 'Cerberus', tone: 'professional', defaultGender: 'male' },
  Cerberusia: { id: 'Cerberusia', label: 'Cerberusia', tone: 'conversational', defaultGender: 'female' },
  Athena: { id: 'Athena', label: 'Athena', tone: 'professional', reserved: true },
  Oracle: { id: 'Oracle', label: 'Oracle', tone: 'executive', reserved: true },
  Sentinel: { id: 'Sentinel', label: 'Sentinel', tone: 'minimal', reserved: true },
  Nova: { id: 'Nova', label: 'Nova', tone: 'friendly', reserved: true },
};

function _settings() {
  return window.AtlasUserSettings?.getAtlasUserSettings?.() || {};
}

function _pick(list) {
  return list[Math.floor(Math.random() * list.length)] || '';
}

function _normalizeAddress(raw) {
  const val = String(raw || 'sir').trim().toLowerCase();
  if (val === 'maam' || val === 'madam') return "ma'am";
  if (val === 'none' || val === '') return '';
  if (val === 'sir' || val === 'boss' || val === "ma'am") return val;
  return 'sir';
}

export function getProfile() {
  const s = _settings();
  const identity = s.assistant_identity || 'Cerberus';
  const base = { ...(ASSISTANT_PROFILES[identity] || ASSISTANT_PROFILES.Atlas) };
  return {
    ...base,
    identity,
    preferred_address: _normalizeAddress(s.preferred_address || s.address_style),
    response_style: s.response_style || 'professional',
    speech_rate: Number(s.speech_rate) || 1.0,
  };
}

export function getAddress() {
  return getProfile().preferred_address;
}

export function appendAddress(text) {
  const addr = getAddress();
  const clean = String(text || '').trim().replace(/[.!?]+$/, '');
  if (!clean) return '';
  if (!addr) return `${clean}.`;
  return `${clean}, ${addr}.`;
}

export function getGreeting() {
  const { identity, preferred_address: addr, response_style: style } = getProfile();
  if (identity === 'Cerberusia') {
    const map = {
      professional: ['Online.', 'Ready when you are.', "I'm here."],
      friendly: ["Hey — I'm here.", 'Ready when you are.', 'Online.'],
      executive: ['Ready.', 'Online.', 'Standing by.'],
      minimal: ['Ready.', 'Online.'],
    };
    return _pick(map[style] || map.professional);
  }
  if (addr === 'boss') return _pick(['Online boss.', 'Yes boss.', 'Standing by boss.']);
  if (addr === "ma'am") return _pick(["Online ma'am.", "Yes ma'am.", "Standing by ma'am."]);
  if (addr === 'sir') return _pick(['Online sir.', 'Yes sir.', 'Standing by sir.']);
  return _pick(['Online.', 'Ready.', 'Standing by.']);
}

export function getStandby() {
  if (getProfile().identity === 'Cerberusia') {
    return _pick(['Standing by.', "I'll be here.", 'On standby.']);
  }
  return appendAddress('Standing by');
}

export function getCompletion() {
  if (getProfile().identity === 'Cerberusia') {
    return _pick(['All set.', 'Done.', 'Finished.', 'Everything is ready.', 'Research finished.']);
  }
  return appendAddress(_pick(['Done', 'Completed', 'Research complete']));
}

export function getConfirmation(action) {
  const text = String(action || '').trim().replace(/[.!?]+$/, '');
  if (!text) return getCompletion();
  if (getProfile().identity === 'Cerberusia') return `${text}.`;
  return appendAddress(text);
}

export function getError(message) {
  const msg = String(message || 'something went wrong').trim().replace(/[.!?]+$/, '');
  if (getProfile().identity === 'Cerberusia') {
    return msg.toLowerCase().startsWith('sorry') ? `${msg}.` : `Sorry — ${msg.toLowerCase()}.`;
  }
  if (!getAddress()) return `Sorry, ${msg.toLowerCase()}.`;
  return appendAddress(`Sorry, ${msg}`);
}

export function formatAction(action) {
  return getConfirmation(action);
}

export function formatQuestion(question) {
  const q = String(question || '').trim().replace(/\?$/, '');
  if (!q) return '';
  if (getProfile().identity === 'Cerberusia') return `${q}?`;
  const addr = getAddress();
  if (!addr) return `${q}?`;
  return `${q}, ${addr}?`;
}

export const cerberusPersonality = {
  ASSISTANT_PROFILES,
  getProfile,
  getAddress,
  appendAddress,
  getGreeting,
  getStandby,
  getCompletion,
  getConfirmation,
  getError,
  formatAction,
  formatQuestion,
};

window.AtlasProfile = cerberusPersonality;
export default cerberusPersonality;
