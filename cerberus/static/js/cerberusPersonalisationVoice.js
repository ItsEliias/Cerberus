// Cerberus OS — voice commands for profile, theme, address, and voice prefs

import cerberusUserSettings from './cerberusUserSettings.js';
import { cmdHandled, cmdUnhandled } from './cerberusCommandResult.js';

function _norm(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function _stripAtlas(text) {
  return _norm(text).replace(/^(?:(?:hey\s+)?atlas\s+)+/i, '').trim();
}

const THEME_RE = /^(?:change\s+theme\s+to|set\s+theme\s+to|switch\s+theme\s+to)\s+(.+)$/;
const IDENTITY_RE = /^(?:(?:switch\s+to|become)\s+)(atlas|atlasia)$/;
const ADDRESS_RE = /^(?:call\s+me|address\s+me\s+as)\s+(sir|boss|ma'?am|maam)$/;
const VOICE_GENDER_RE = /^use\s+(female|male)\s+voice$/;
const SPEECH_RATE_RE = /^speak\s+(slower|faster)$/;

export async function tryHandlePersonalisationVoice(transcript) {
  const raw = _stripAtlas(transcript);
  if (!raw) return cmdUnhandled();

  let m = raw.match(THEME_RE);
  if (m) {
    const themeId = cerberusUserSettings.resolveThemeId(m[1]);
    if (!themeId) {
      return cmdHandled(false, 'Theme not recognized. Try Matrix, Purple, Gold, Pink, or Blue.');
    }
    await cerberusUserSettings.patchAtlasUserSettings({ theme: themeId }, { animateTheme: true });
    const label = cerberusUserSettings.THEMES[themeId]?.label || themeId;
    cerberusUserSettings.toastThemeChange(themeId);
    return cmdHandled(true, `${label} theme activated.`, { uiActivity: `Theme: ${label}` });
  }

  m = raw.match(IDENTITY_RE);
  if (m) {
    const identity = m[1] === 'cerberusia' ? 'Cerberusia' : 'Cerberus';
    const patch = { assistant_identity: identity };
    if (identity === 'Cerberusia') {
      patch.voice_gender = 'female';
      patch.preferred_voice = 'Google UK English Female';
    } else {
      patch.voice_gender = 'male';
      patch.preferred_voice = 'Google UK English Male';
    }
    await cerberusUserSettings.patchAtlasUserSettings(patch);
    cerberusUserSettings.toastIdentityChange(identity);
    return cmdHandled(true, `${identity} activated.`, { uiActivity: `Identity: ${identity}` });
  }

  m = raw.match(ADDRESS_RE);
  if (m) {
    let addr = m[1];
    if (addr === 'maam') addr = "ma'am";
    await cerberusUserSettings.patchAtlasUserSettings({ preferred_address: addr, address_style: addr });
    cerberusUserSettings.toastAddressChange(addr);
    return cmdHandled(true, `Preferred address set to ${addr}.`, { uiActivity: `Address: ${addr}` });
  }

  m = raw.match(VOICE_GENDER_RE);
  if (m) {
    const female = m[1] === 'female';
    const patch = {
      voice_gender: female ? 'female' : 'male',
      preferred_voice: female ? 'Google UK English Female' : 'Google UK English Male',
    };
    await cerberusUserSettings.patchAtlasUserSettings(patch);
    return cmdHandled(true, `${female ? 'Female' : 'Male'} voice selected.`, {
      uiActivity: `Voice: ${patch.preferred_voice}`,
    });
  }

  m = raw.match(SPEECH_RATE_RE);
  if (m) {
    const current = cerberusUserSettings.getSpeechRate();
    const next = m[1] === 'slower'
      ? Math.max(0.5, Math.round((current - 0.1) * 10) / 10)
      : Math.min(2, Math.round((current + 0.1) * 10) / 10);
    await cerberusUserSettings.patchAtlasUserSettings({ speech_rate: next });
    return cmdHandled(true, `Speech rate set to ${next}.`, { uiActivity: `Speech rate: ${next}` });
  }

  return cmdUnhandled();
}

export default { tryHandlePersonalisationVoice };
