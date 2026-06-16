// Cerberus OS — Home conversation log + embedded voice panel (stay on Home)

import cerberusVoiceMode from './cerberusVoiceMode.js';
import cerberusCursorFx from './cerberusCursorFx.js';
import cerberusDesktopCommands from './cerberusDesktopCommands.js';
import cerberusActiveProject from './cerberusActiveProject.js';
import cerberusVoiceNavigation from './cerberusVoiceNavigation.js';
import cerberusVoiceActions from './cerberusVoiceActions.js';
import cerberusVoiceUi from './cerberusVoiceUi.js';
import {
  findActivationPhrase,
  findStandbyPhrase,
  isActivationOnly,
  stripVoicePrefixes,
} from './cerberusVoicePhrases.js';
import { cmdHandled, cmdDebug, resultMessage } from './cerberusCommandResult.js';
import cerberusPersonality from './cerberusPersonality.js';

const SETTINGS_KEY = 'cerberus_voice_settings';
const SETTINGS_VERSION = 5;
const MAX_MESSAGES = 5;
const PROCESSING_TIMEOUT_MS = 60000;

function _preferredVoice() {
  return window.AtlasUserSettings?.getPreferredVoiceName?.() || 'Google UK English Male';
}

const DEFAULT_SETTINGS = {
  settings_version: SETTINGS_VERSION,
  conversation_mode_enabled: false,
  speak_replies: false,
  passive_wake_enabled: true,
  auto_submit: true,
  selected_voice: _preferredVoice(),
  rate: 0.8,
  pitch: 1.0,
  voice_reply_style: 'brief',
  interruption_enabled: true,
  follow_up_timeout_ms: 30000,
  silence_submit_delay_ms: 2000,
  atlas_cursor_effects: true,
};

let _deps = {};
let _settings = { ...DEFAULT_SETTINGS };
let _paused = false;
let _messages = [];
let _eventsBound = false;

function _el(id) {
  return document.getElementById(id);
}

function _debug(...args) {
  try {
    if (localStorage.getItem('cerberus_voice_debug') === 'true') {
      console.log('[atlas-voice-home]', ...args);
    }
  } catch (_) {}
}

export function loadVoiceSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const stored = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    if (!stored.settings_version || stored.settings_version < SETTINGS_VERSION) {
      if (!stored.settings_version || stored.settings_version < 5) {
        merged.conversation_mode_enabled = false;
        merged.speak_replies = false;
        merged.passive_wake_enabled = true;
      }
      merged.auto_submit = merged.auto_submit !== false;
      merged.rate = merged.rate ?? DEFAULT_SETTINGS.rate;
      merged.voice_reply_style = merged.voice_reply_style || DEFAULT_SETTINGS.voice_reply_style;
      merged.follow_up_timeout_ms = merged.follow_up_timeout_ms ?? DEFAULT_SETTINGS.follow_up_timeout_ms;
      merged.silence_submit_delay_ms = merged.silence_submit_delay_ms ?? DEFAULT_SETTINGS.silence_submit_delay_ms;
      merged.atlas_cursor_effects = stored.atlas_cursor_effects !== false;
      merged.settings_version = SETTINGS_VERSION;
    }
    return merged;
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveVoiceSettings(patch = {}) {
  _settings = { ..._settings, ...patch, settings_version: SETTINGS_VERSION };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(_settings));
  } catch (_) {}
  cerberusVoiceMode.applySettings?.(_settings);
  _syncSettingsUI();
  window.cerberusVoiceService?.patchSettings?.(_settings);
  return _settings;
}

export function getVoiceSettings() {
  return { ..._settings };
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _timeLabel() {
  try {
    return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function _syncModePills() {
  window.cerberusVoiceService?.updateHudMeta?.(_settings);
}

function _playActivationAnimation(online) {
  const core = _el('cerberus-core');
  const bar = _el('cerberus-os-status-bar');
  const chip = _el('cerberus-voice-status-chip');
  [core, bar].forEach((el) => {
    if (!el) return;
    el.classList.remove('cerberus-voice-activate-on', 'cerberus-voice-activate-off');
    void el.offsetWidth;
    el.classList.add(online ? 'cerberus-voice-activate-on' : 'cerberus-voice-activate-off');
  });
  if (chip) {
    chip.classList.toggle('cerberus-voice-chip-online', online);
    chip.classList.toggle('cerberus-voice-chip-standby', !online);
  }
}

function _syncModalToggles() {
  const wakeEl = _el('cerberus-voice-wake-mode');
  const speakModal = _el('cerberus-voice-speak-replies');
  if (wakeEl) wakeEl.checked = !!_settings.conversation_mode_enabled;
  if (speakModal) speakModal.checked = !!_settings.speak_replies;
}

export function activateVoiceConversation({ speakGreeting = true, enableSpeak = true } = {}) {
  const patch = { conversation_mode_enabled: true };
  if (enableSpeak) patch.speak_replies = true;
  saveVoiceSettings(patch);
  _syncModalToggles();
  _paused = false;
  cerberusVoiceMode.enterConversationMode?.();
  setVoiceStatus('command-listening', 'ONLINE');
  _playActivationAnimation(true);
  _syncModePills();
  if (speakGreeting) {
    return cerberusVoiceMode.speakText?.(cerberusPersonality.getGreeting(), { short: false });
  }
  return Promise.resolve();
}

export async function deactivateVoiceConversation({ speakFarewell = true, disableSpeak = true } = {}) {
  const patch = { conversation_mode_enabled: false, passive_wake_enabled: true };
  if (disableSpeak) patch.speak_replies = false;
  saveVoiceSettings(patch);
  _syncModalToggles();
  cerberusVoiceMode.exitConversationMode?.();
  setVoiceStatus('wake-listening', 'Wake Listening');
  _playActivationAnimation(false);
  _syncModePills();
  if (speakFarewell) {
    await cerberusVoiceMode.speakText?.(cerberusPersonality.getStandby(), { short: false });
  }
  cerberusVoiceMode.startPassiveWakeListening?.();
}

function _syncStatusChip(status, label) {
  const chip = _el('cerberus-voice-status-chip');
  if (chip) {
    chip.dataset.status = status || 'idle';
    const text = chip.querySelector('.cerberus-voice-status-chip-text');
    const listening = ['wake-listening', 'command-listening', 'listening', 'recording'].includes(status);
    if (text) text.textContent = listening ? 'Wake Listening ●' : (label || 'Standby');
  }
  cerberusVoiceMode.updateVoiceHud?.({ status, label });
  _syncModePills();
}

function _notifyComplete(onComplete, result) {
  if (!onComplete) return;
  onComplete(result);
}

async function _applyHandledResult(result, { onComplete, skipUi, speakFn } = {}) {
  if (!result?.handled) return false;
  const message = resultMessage(result);
  const ok = result.ok !== false;
  cmdDebug('final handled/ok state', { handled: true, ok, spoken: !!result.spoken, message: message.slice(0, 80) });
  cmdDebug('skipped chat due to handled command');

  await cerberusVoiceUi.applyVoiceResultUi(result);

  cerberusVoiceMode.clearCommandInput?.();
  if (!skipUi && message) {
    const chatMsg = result.speakFull && message.length > 100 ? 'Reading report aloud.' : message;
    _pushMessage('cerberus', chatMsg);
  }

  const shortSpeak = result.speakFull
    ? message
    : (message.length > 120 ? `${message.slice(0, 117)}…` : message);

  let spoken = !!result.spoken;
  if (!spoken && speakFn && shortSpeak && _settings.speak_replies && !result.speakFull) {
    await speakFn(shortSpeak);
    spoken = true;
  } else if (!spoken && speakFn && message && _settings.speak_replies && result.speakFull) {
    await speakFn(message);
    spoken = true;
  } else if (!_settings.speak_replies) {
    setVoiceStatus(ok ? 'idle' : 'error', ok ? 'Standby' : 'Error');
  }

  _notifyComplete(onComplete, { ...result, spoken });
  return true;
}

export function setVoiceStatus(status, label) {
  _syncStatusChip(status, label);
}

function _trimMessages() {
  while (_messages.length > MAX_MESSAGES) _messages.shift();
}

function _pushMessage(role, text, { processing = false } = {}) {
  if (role === 'user') {
    if (!text) return;
    _messages.push({ role: 'user', text, time: _timeLabel() });
  } else if (processing) {
    const last = _messages[_messages.length - 1];
    if (last?.role === 'cerberus' && last?.processing) return;
    _messages.push({ role: 'cerberus', text: '', time: _timeLabel(), processing: true });
  } else {
    const procIdx = _messages.findIndex(m => m.role === 'cerberus' && m.processing);
    if (procIdx >= 0) {
      _messages[procIdx] = { role: 'cerberus', text: text || '', time: _timeLabel(), processing: false };
    } else if (text) {
      const last = _messages[_messages.length - 1];
      if (last?.role === 'cerberus' && last.text === text) return;
      _messages.push({ role: 'cerberus', text, time: _timeLabel() });
    }
  }
  _trimMessages();
  _renderConversation();
}

function _renderConversation() {
  const log = _el('cerberus-conv-log');
  if (!log) return;
  if (!_messages.length) {
    log.innerHTML = '';
    return;
  }
  log.innerHTML = _messages.map(m => {
    const roleLabel = m.role === 'user' ? 'You' : 'Cerberus';
    const body = m.processing
      ? '<span class="cerberus-conv-spinner"></span> Processing…'
      : _esc(m.text);
    return `
      <div class="cerberus-conv-entry atlas-conv-entry--${m.role}${m.processing ? ' atlas-conv-entry--processing' : ''}">
        <span class="cerberus-conv-entry-role">${roleLabel}</span>
        <span class="cerberus-conv-entry-text">${body}</span>
        ${m.processing ? '' : `<span class="cerberus-conv-entry-time">${_esc(m.time)}</span>`}
      </div>`;
  }).join('');
  log.scrollTop = log.scrollHeight;
}

export function showOverlay({ user = '', reply = '', processing = false } = {}) {
  if (user) _pushMessage('user', user);
  if (processing) _pushMessage('cerberus', '', { processing: true });
  else if (reply) _pushMessage('cerberus', reply);
}

export function hideOverlay() {}

export function updateOverlayReply(text, { processing = false } = {}) {
  if (processing) _pushMessage('cerberus', '', { processing: true });
  else _pushMessage('cerberus', text || '');
}

export function clearOverlay() {
  _messages = [];
  _renderConversation();
}

export async function submitHomeMessage(text, { onComplete, onError, skipUi = false, fromVoice = false } = {}) {
  let msg = (text || '').trim();
  if (!msg || _paused) return false;

  cmdDebug('input', msg.slice(0, 120));

  if (findStandbyPhrase(msg)) {
    if (!skipUi) _pushMessage('user', msg);
    await deactivateVoiceConversation({ speakFarewell: true });
    _notifyComplete(onComplete, cmdHandled(true, cerberusPersonality.getStandby(), { spoken: true }));
    return true;
  }

  if (isActivationOnly(msg)) {
    if (!skipUi) _pushMessage('user', msg);
    await activateVoiceConversation({ speakGreeting: true });
    cerberusVoiceMode.enterCommandListening?.();
    _notifyComplete(onComplete, cmdHandled(true, cerberusPersonality.getGreeting(), { spoken: true }));
    return true;
  }

  msg = stripVoicePrefixes(msg);
  if (!msg) {
    _notifyComplete(onComplete, { handled: false, ok: true, message: '', spoken: false });
    return true;
  }

  if (!skipUi) {
    _pushMessage('user', fromVoice ? text.trim() : msg);
  }
  if (fromVoice) cerberusVoiceMode.updateVoiceHud?.({ lastCommand: msg });

  const speakFn = async (reply) => {
    if (_settings.speak_replies && reply) {
      setVoiceStatus('speaking', 'Speaking');
      await cerberusVoiceMode.speakText?.(reply, { style: _settings.voice_reply_style });
    }
    if (_settings.conversation_mode_enabled && !_paused) {
      cerberusVoiceMode.enterFollowUpListening?.();
    } else {
      setVoiceStatus('idle', 'Standby');
    }
  };

  if (cerberusVoiceNavigation.isDestructiveCommand(msg)) {
    return _applyHandledResult(
      cmdHandled(false, 'That action requires confirmation in the UI.'),
      { onComplete, skipUi, speakFn },
    );
  }

  const voiceActionResult = await cerberusVoiceActions.tryHandleVoiceAction(msg);
  // Calendar voice capture handled inside tryHandleVoiceAction
  if (localStorage.getItem('cerberus_voice_debug') === 'true') {
    console.log('[voice-action] transcript', msg);
    console.log('[voice-action] context', window.AtlasVoiceContext?.get?.());
    console.log('[voice-action] executed', voiceActionResult);
  }
  if (await _applyHandledResult(voiceActionResult, { onComplete, skipUi, speakFn })) return true;

  const navResult = await cerberusVoiceNavigation.tryHandleNavigation(msg);
  cmdDebug('navigation result', navResult);
  if (await _applyHandledResult(navResult, { onComplete, skipUi, speakFn })) return true;

  const desktopResult = await cerberusDesktopCommands.handleDesktopMessage(msg, {
    activeProjectId: cerberusActiveProject.getActiveProjectId?.(),
    onLog: (role, body, opts = {}) => {
      if (!skipUi) {
        if (opts.processing) _pushMessage('cerberus', '', { processing: true });
        else if (body) _pushMessage(role, body);
      }
    },
    speak: _settings.speak_replies ? speakFn : null,
  });
  cmdDebug('desktop result', desktopResult);
  if (await _applyHandledResult(desktopResult, { onComplete, skipUi, speakFn: null })) return true;

  const projectResult = await cerberusVoiceNavigation.tryHandleProjectCommands(msg);
  cmdDebug('project result', projectResult);
  if (await _applyHandledResult(projectResult, { onComplete, skipUi, speakFn })) return true;

  const atlasResult = await cerberusVoiceNavigation.tryHandleAtlasCommands(msg);
  cmdDebug('cerberus result', atlasResult);
  if (await _applyHandledResult(atlasResult, { onComplete, skipUi, speakFn })) return true;

  // Navigation-shaped command ("open …", "go to …") that nothing recognised:
  // show a quiet notification instead of sending it to the LLM or erroring.
  if (cerberusVoiceNavigation.looksLikeNavigationCommand(msg)) {
    const unknownResult = cerberusVoiceNavigation.notifyUnknownCommand(msg);
    cmdDebug('unknown nav command', msg);
    if (await _applyHandledResult(unknownResult, { onComplete, skipUi, speakFn })) return true;
  }

  if (!skipUi) {
    _pushMessage('cerberus', '', { processing: true });
  }
  setVoiceStatus('processing', 'Processing');
  _debug('submit chat', msg.slice(0, 80));

  if (!_deps.submitChat) {
    if (!skipUi) _pushMessage('cerberus', cerberusPersonality.getError("chat isn't available"));
    if (onComplete) {
      _notifyComplete(onComplete, { handled: false, ok: false, message: '', spoken: false });
    } else {
      cerberusVoiceMode.recoverAfterProcessing?.();
    }
    if (onError) onError('Chat pipeline unavailable');
    return false;
  }

  let settled = false;
  const processingTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    _debug('processing timeout');
    if (!skipUi) _pushMessage('cerberus', cerberusPersonality.getError('that took too long'));
    if (onComplete) {
      _notifyComplete(onComplete, { handled: false, ok: false, message: '', spoken: false });
    } else {
      cerberusVoiceMode.recoverAfterProcessing?.();
    }
    if (onError) onError('timeout');
  }, PROCESSING_TIMEOUT_MS);

  try {
    const reply = await _deps.submitChat(msg, {
      speak: false,
      voiceSettings: _settings,
    });
    if (settled) return false;
    settled = true;
    clearTimeout(processingTimer);

    if (!skipUi) _pushMessage('cerberus', reply || '');
    _debug('reply', (reply || '').slice(0, 80));

    if (onComplete) {
      _notifyComplete(onComplete, { handled: false, ok: !!(reply || '').trim(), message: reply || '', spoken: false });
      return true;
    }

    if (_settings.speak_replies && reply) {
      setVoiceStatus('speaking', 'Speaking');
      await cerberusVoiceMode.speakText?.(reply, { style: _settings.voice_reply_style });
    }
    if (_settings.conversation_mode_enabled && !_paused) {
      cerberusVoiceMode.enterFollowUpListening?.();
    } else {
      setVoiceStatus('idle', 'Standby');
    }
    return true;
  } catch (err) {
    if (!settled) {
      settled = true;
      clearTimeout(processingTimer);
      if (!skipUi) _pushMessage('cerberus', cerberusPersonality.getError("I couldn't complete that request"));
      _debug('submit error', err?.message);
      if (onComplete) {
        _notifyComplete(onComplete, { handled: false, ok: false, message: '', spoken: false });
      } else {
        cerberusVoiceMode.recoverAfterProcessing?.();
      }
      if (onError) onError(err?.message || 'Request failed');
    }
    return false;
  }
}

function _toggleConversationMode() {
  if (_settings.conversation_mode_enabled) {
    void deactivateVoiceConversation({ speakFarewell: false, disableSpeak: false });
  } else {
    void activateVoiceConversation({ speakGreeting: false, enableSpeak: false });
    cerberusVoiceMode.enterCommandListening?.();
  }
}

function _toggleSpeakReplies() {
  const turnOn = !_settings.speak_replies;
  saveVoiceSettings({ speak_replies: turnOn });
  cerberusVoiceMode.applySettings?.(getVoiceSettings());
  _syncModalToggles();
  _syncModePills();
}

function _togglePassiveWake() {
  const turnOn = _settings.passive_wake_enabled === false;
  saveVoiceSettings({ passive_wake_enabled: turnOn });
  cerberusVoiceMode.applySettings?.(getVoiceSettings());
  if (turnOn && !_settings.conversation_mode_enabled && !_paused) {
    cerberusVoiceMode.startPassiveWakeListening?.();
    setVoiceStatus('wake-listening', 'Wake Listening');
  } else if (!turnOn) {
    cerberusVoiceMode.exitConversationMode?.();
    setVoiceStatus('idle', 'Standby');
  }
  _syncModePills();
}

function _syncSettingsUI() {
  _syncModalToggles();
  const auto = _el('cerberus-voice-auto-submit');
  if (auto) auto.checked = !!_settings.auto_submit;
  const interrupt = _el('cerberus-voice-settings-interrupt');
  if (interrupt) interrupt.checked = !!_settings.interruption_enabled;
  const style = _el('cerberus-voice-settings-style');
  if (style) style.value = _settings.voice_reply_style || 'brief';
  const rate = _el('cerberus-voice-tts-rate');
  if (rate) rate.value = String(_settings.rate ?? 0.8);
  const sttIds = ['cerberus-voice-stt-mode', 'cerberus-home-stt-mode'];
  const sttVal = cerberusVoiceMode.getSttMode?.() || 'browser';
  sttIds.forEach(id => {
    const el = _el(id);
    if (el) el.value = sttVal;
  });
  _syncModePills();
}

function _bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  _el('cerberus-conv-open-assistant')?.addEventListener('click', () => {
    if (_deps.openFullAssistant) {
      _deps.openFullAssistant();
    } else {
      window.location.href = '/';
    }
  });

  _el('cerberus-conv-clear')?.addEventListener('click', () => clearOverlay());

  _el('cerberus-voice-status-chip')?.addEventListener('click', () => {
    cerberusVoiceMode.openVoiceMode?.();
  });

  _el('cerberus-status-conversation')?.addEventListener('click', () => _toggleConversationMode());
  _el('cerberus-status-speak')?.addEventListener('click', () => _toggleSpeakReplies());
  _el('cerberus-status-passive')?.addEventListener('click', () => _togglePassiveWake());
}

export function onGlobalVoiceStart() {
  _syncSettingsUI();
  if (_paused) {
    setVoiceStatus('paused', 'Paused');
    return;
  }
  cerberusVoiceMode.startPassiveWakeListening?.();
  if (_settings.conversation_mode_enabled) {
    cerberusVoiceMode.enterConversationMode?.();
    cerberusVoiceMode.enterCommandListening?.();
    setVoiceStatus('command-listening', 'Listening');
  } else {
    setVoiceStatus('wake-listening', 'Passive wake');
  }
  _syncModePills();
}

export function onHomeShown() {
  onGlobalVoiceStart();
}

export function setPaused(paused) {
  if (_paused === paused) return;
  _paused = paused;
  if (_paused) {
    cerberusVoiceMode.pauseHomeConversation?.();
    setVoiceStatus('paused', 'Paused');
  } else {
    cerberusVoiceMode.startPassiveWakeListening?.();
    if (_settings.conversation_mode_enabled) {
      cerberusVoiceMode.enterCommandListening?.();
      setVoiceStatus('command-listening', 'Listening');
    } else {
      setVoiceStatus('wake-listening', 'Passive wake');
    }
  }
  _syncModePills();
}

export function isPaused() {
  return _paused;
}

export function initAtlasHomeConversation(deps = {}) {
  _deps = deps;
  _settings = loadVoiceSettings();
  if (!_settings.selected_voice) {
    _settings.selected_voice = _preferredVoice();
  }
  window.addEventListener('cerberus-user-settings-changed', () => {
    _settings.selected_voice = _preferredVoice();
    saveVoiceSettings(_settings);
    _syncSettingsUI();
  });
  saveVoiceSettings(_settings);
  _syncSettingsUI();
  _bindEvents();
  cerberusVoiceMode.initHomeConversation?.({
    settings: () => _settings,
    saveSettings: saveVoiceSettings,
    submitMessage: (t, opts) => submitHomeMessage(t, { ...opts, fromVoice: true }),
    setStatus: setVoiceStatus,
    showOverlay,
    updateOverlayReply,
    isPaused: () => _paused,
    setPaused,
    isConversationEnabled: () => _settings.conversation_mode_enabled,
    onActivate: () => activateVoiceConversation({ speakGreeting: false }),
    onDeactivate: () => deactivateVoiceConversation({ speakFarewell: false }),
  });

  try {
    cerberusCursorFx.initAtlasCursorFx?.();
    const cursorOff = _settings.atlas_cursor_effects === false
      || (typeof localStorage !== 'undefined' && localStorage.getItem('cerberus_cursor_fx') === 'off');
    if (cursorOff) {
      cerberusCursorFx.setCursorFxEnabled?.(false);
    }
  } catch (_) {}

  requestAnimationFrame(() => onGlobalVoiceStart());
}

const cerberusHomeConversation = {
  initAtlasHomeConversation,
  submitHomeMessage,
  showOverlay,
  hideOverlay,
  clearOverlay,
  updateOverlayReply,
  setVoiceStatus,
  getVoiceSettings,
  saveVoiceSettings,
  onHomeShown,
  onGlobalVoiceStart,
  setPaused,
  isPaused,
  activateVoiceConversation,
  deactivateVoiceConversation,
};

export default cerberusHomeConversation;
