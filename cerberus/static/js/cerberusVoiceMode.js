// Cerberus OS — Voice Assistant V5 (passive wake + phrase activation)

import { prepareSpeechText } from './cerberusVoiceTts.js';
import cerberusPersonality from './cerberusPersonality.js';
import { normalizeSubmitResult, cmdDebug } from './cerberusCommandResult.js';
import {
  ACTIVATION_PHRASES,
  findActivationPhrase,
  findStandbyPhrase,
  isActivationOnly,
  stripVoicePrefixes,
} from './cerberusVoicePhrases.js';

const DEFAULT_WAKE_PHRASES = [...ACTIVATION_PHRASES];

const STORAGE_KEY = 'cerberus_voice_prefs';
const DEFAULT_SILENCE_MS = 2000;
const DEFAULT_FOLLOW_UP_MS = 30000;
const SELF_TRANSCRIPT_COOLDOWN_MS = 700;
const RESPONSE_TIMEOUT_MS = 60000;
const COMMAND_START_TIMEOUT_MS = 5000;
const WAKE_RESTART_DELAY_MS = 120;

let _silenceSubmitMs = DEFAULT_SILENCE_MS;
let _followUpTimeoutMs = DEFAULT_FOLLOW_UP_MS;
let _eventsBound = false;
let _lastSubmittedText = '';
let _lastSubmittedAt = 0;

const RECOGNITION_ERROR_HINTS = {
  network: 'Browser/cloud speech service unreachable. Switch to Local Whisper below.',
  'not-allowed': 'Microphone permission denied.',
  'service-not-allowed': 'Speech recognition blocked by browser or page policy.',
  'audio-capture': 'No microphone detected or capture failed.',
  'start-failed': 'Recognition could not start. Check microphone permissions.',
  command_listen_failed: 'Command listening did not start after wake phrase. Returning to wake listening.',
  no_transcript: 'Microphone is active but Chrome SpeechRecognition returned no transcript. Try Test Recognition or switch to Local Whisper.',
  unknown: 'Unspecified speech recognition failure.',
};

// Conversation state machine phases
// idle | wake-listening | greeting | command-listening | processing | speaking | returning-standby
// whisper: recording | uploading | transcribing | transcript-ready

let _deps = {};
let _phase = 'idle';
let _sttMode = 'browser';
let _recognition = null;
let _listenMode = null;
let _wakeModeEnabled = false;
let _passiveWakeActive = false;
let _conversationActive = false;
let _speakReplies = true;
let _hudInterim = '';
let _hudFinal = '';
let _hudLastCommand = '';
let _autoSubmit = true;
let _selectedVoice = '';
let _ttsRate = 0.8;
let _ttsPitch = 1.0;
let _wakePhrases = [...DEFAULT_WAKE_PHRASES];
let _transcript = '';
let _finalTranscript = '';
let _open = false;
let _micPaused = false;
let _submitting = false;
let _commandSilenceTimer = null;
let _responseTimeout = null;
let _whisperAvailable = null;
let _manualListen = false;
let _homeDeps = null;
let _homeConversationActive = false;
let _followUpMode = false;
let _followUpTimer = null;
let _lastSpokenText = '';
let _lastSpokenAt = 0;
let _voiceReplyStyle = 'brief';
let _interruptionEnabled = true;

let _mediaRecorder = null;
let _mediaStream = null;
let _audioChunks = [];
let _recording = false;
let _recognitionActive = false;
let _wakeSessionText = '';
let _wakeHandling = false;
let _debugInterim = '';
let _debugFinal = '';
let _debugLastWake = '';
let _commandStartTimer = null;
let _wakeRestartTimer = null;
let _testRec = null;
let _testTimer = null;
let _noTranscriptTimer = null;
let _noTranscriptMarkResult = null;
let _engineSnapshot = null;
let _diag = {
  permission: 'unknown',
  counts: { onstart: 0, onaudiostart: 0, onspeechstart: 0, onresult: 0, onend: 0, onerror: 0 },
  lastError: '',
  lastNormalized: '',
  testMode: false,
};

const NO_TRANSCRIPT_WARN_MS = 8000;
const TEST_RECOGNITION_MS = 8000;

function _el(id) {
  return document.getElementById(id);
}

function _isDebugEnabled() {
  try {
    return localStorage.getItem('cerberus_voice_debug') === 'true';
  } catch (_) {
    return false;
  }
}

function _debug(event, ...args) {
  if (!_isDebugEnabled()) return;
  const tag = typeof event === 'string' ? event : 'log';
  console.log(`[cerberus-voice] [${tag}]`, ...args);
}

function _diagLog(event, detail = '') {
  const map = {
    start: 'onstart', onstart: 'onstart',
    audiostream: 'onaudiostart', onaudiostart: 'onaudiostart',
    speechstart: 'onspeechstart', onspeechstart: 'onspeechstart',
    result: 'onresult', onresult: 'onresult',
    end: 'onend', onend: 'onend',
    error: 'onerror', onerror: 'onerror',
    'state-change': null, 'wake-match': null, 'no-transcript': null,
  };
  const key = map[event] ?? event;
  if (key && _diag.counts[key] !== undefined) _diag.counts[key] += 1;
  _debug(event, detail);
  _updateLiveDebug();
}

async function _refreshMicPermission() {
  _diag.permission = 'unknown';
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'microphone' });
      _diag.permission = status.state;
      status.onchange = () => {
        _diag.permission = status.state;
        _updateLiveDebug();
      };
    }
  } catch (_) {
    _diag.permission = 'unavailable';
  }
  _updateLiveDebug();
}

function _clearNoTranscriptTimer() {
  if (_noTranscriptTimer) {
    clearTimeout(_noTranscriptTimer);
    _noTranscriptTimer = null;
  }
  _noTranscriptMarkResult = null;
}

function _startNoTranscriptWatchdog() {
  _clearNoTranscriptTimer();
  if (_diag.testMode) return;
  let hadResult = false;
  _noTranscriptTimer = setTimeout(() => {
    _noTranscriptTimer = null;
    if (hadResult) return;
    if (!_recognitionActive && !_testRec) return;
    const msg = 'Microphone is active but Chrome SpeechRecognition returned no transcript. Try Test Recognition or switch to Local Whisper.';
    _diagLog('no-transcript', msg);
    _showRecognitionDebug('no_transcript', msg);
  }, NO_TRANSCRIPT_WARN_MS);
  _noTranscriptMarkResult = () => { hadResult = true; _clearNoTranscriptTimer(); };
}

function _loadHomeSettings() {
  try {
    const raw = localStorage.getItem('cerberus_voice_settings');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function _loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.speakReplies === 'boolean') _speakReplies = p.speakReplies;
      if (typeof p.autoSubmit === 'boolean') _autoSubmit = p.autoSubmit;
      if (p.voice) _selectedVoice = p.voice;
      if (typeof p.ttsRate === 'number') _ttsRate = p.ttsRate;
      if (typeof p.ttsPitch === 'number') _ttsPitch = p.ttsPitch;
      if (p.sttMode === 'browser' || p.sttMode === 'whisper') _sttMode = p.sttMode;
      if (Array.isArray(p.wakePhrases) && p.wakePhrases.length) _wakePhrases = p.wakePhrases;
    }
  } catch (_) {}
  const home = _loadHomeSettings();
  if (typeof home.speak_replies === 'boolean') _speakReplies = home.speak_replies;
  if (typeof home.conversation_mode_enabled === 'boolean') _wakeModeEnabled = home.conversation_mode_enabled;
  if (typeof home.auto_submit === 'boolean') _autoSubmit = home.auto_submit;
  if (home.voice_reply_style) _voiceReplyStyle = home.voice_reply_style;
  if (typeof home.interruption_enabled === 'boolean') _interruptionEnabled = home.interruption_enabled;
  if (typeof home.rate === 'number') _ttsRate = home.rate;
  if (typeof home.pitch === 'number') _ttsPitch = home.pitch;
  if (home.selected_voice) _selectedVoice = home.selected_voice;
  if (typeof home.silence_submit_delay_ms === 'number') _silenceSubmitMs = home.silence_submit_delay_ms;
  if (typeof home.follow_up_timeout_ms === 'number') _followUpTimeoutMs = home.follow_up_timeout_ms;
}

function _savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      speakReplies: _speakReplies,
      autoSubmit: _autoSubmit,
      voice: _selectedVoice,
      ttsRate: _ttsRate,
      ttsPitch: _ttsPitch,
      sttMode: _sttMode,
      wakePhrases: _wakePhrases,
    }));
  } catch (_) {}
}

function _speechSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function _isWhisperMode() {
  return _sttMode === 'whisper';
}

function _isConversationActive() {
  return _wakeModeEnabled && !_isWhisperMode();
}

function _clearCommandTimer() {
  if (_commandSilenceTimer) {
    clearTimeout(_commandSilenceTimer);
    _commandSilenceTimer = null;
  }
}

function _setMicPaused(paused) {
  _micPaused = paused;
  if (paused) _setMicIndicator(false);
}

function _setMicIndicator(active) {
  const dot = _el('cerberus-voice-mic-indicator');
  if (!dot) return;
  dot.classList.toggle('cerberus-voice-mic-indicator--active', active && !_micPaused);
  dot.setAttribute('aria-hidden', active && !_micPaused ? 'false' : 'true');
  dot.title = active && !_micPaused ? 'Microphone active' : 'Microphone inactive';
}

function _setStatus(status) {
  const prev = _phase;
  _phase = status;
  if (prev !== status) _diagLog('state-change', `${prev} → ${status}`);
  const labels = {
    idle: 'Standby',
    'wake-listening': 'Wake listening',
    'wake-detected': 'Wake detected',
    greeting: 'Speaking',
    'command-listening': 'Command listening',
    recording: 'Recording',
    uploading: 'Uploading audio',
    transcribing: 'Transcribing locally',
    'transcript-ready': 'Transcript ready',
    processing: 'Processing',
    speaking: 'Speaking',
    'returning-standby': 'Returning to standby',
    paused: 'Paused',
    error: 'Error',
    listening: 'Listening',
  };
  const label = labels[status] || status;
  const pill = _el('cerberus-voice-status');
  if (pill) {
    pill.textContent = label;
    pill.dataset.status = status;
  }
  const micOn = ['wake-listening', 'command-listening', 'listening', 'recording'].includes(status);
  _setMicIndicator(micOn && !_micPaused);
  _updateLiveDebug();
  _updatePrivacyText();
  _syncHomeChip(status, label);
  const hudLabel = status === 'wake-listening' && !_conversationActive ? 'Wake Listening' : label;
  updateVoiceHud({ status, label: hudLabel });
  const listening = ['wake-listening', 'command-listening', 'listening', 'recording'].includes(status);
  window.cerberusVoiceService?.setListeningLabel?.(listening ? '…' : (status === 'processing' ? 'processing' : status === 'speaking' ? 'speaking' : ''));
  const chip = _el('cerberus-voice-status-chip');
  if (chip) chip.dataset.status = status;
  const chipText = chip?.querySelector('.cerberus-voice-status-chip-text');
  if (chipText) chipText.textContent = listening ? 'Wake Listening ●' : (hudLabel || 'Standby');
}

function _syncHomeChip(status, label) {
  if (!window.homeModule?.isHomeActive?.()) return;
  if (_homeDeps?.isPaused?.()) {
    _notifyStatus('paused', 'Paused');
    return;
  }
  const convOn = _homeConversationActive || _wakeModeEnabled || _homeDeps?.isConversationEnabled?.();
  if (convOn) {
    const chipLabel = status === 'command-listening' ? 'Listening' : label;
    _notifyStatus(status, chipLabel);
  } else if (status === 'idle' || !convOn) {
    _notifyStatus('idle', label || 'Standby');
  }
}

function _normalizeTranscript(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B\u0060']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function _findWakePhrase(text) {
  return findActivationPhrase(text);
}

function _matchesWakePhrase(text) {
  return !!_findWakePhrase(text);
}

export function updateVoiceHud({ status, label, interim, final, lastCommand } = {}) {
  if (typeof lastCommand === 'string') {
    _hudLastCommand = lastCommand;
    window.cerberusVoiceService?.setLastCommand?.(lastCommand);
  }
  _updateCommandInputDisplay(final ?? _transcript, { interim: interim ?? '' });
}

function _updateCommandInputDisplay(text, { interim = '' } = {}) {
  const input = _el('cerberus-home-command-input');
  if (!input) return;
  const display = interim ? `${text || ''} ${interim}`.trim() : (text || '');
  const listening = ['wake-listening', 'command-listening', 'listening', 'recording'].includes(_phase);
  if (display && listening && !_submitting) {
    input.value = display;
    input.classList.add('cerberus-mc-command-input--listening');
    input.placeholder = '';
  } else if (!listening && !_submitting) {
    input.classList.remove('cerberus-mc-command-input--listening');
    if (!input.matches(':focus')) {
      input.placeholder = 'Command Cerberus…';
    }
  }
}

export function clearCommandInput() {
  const input = _el('cerberus-home-command-input');
  if (input) {
    input.value = '';
    input.classList.remove('cerberus-mc-command-input--listening');
    input.placeholder = 'Command Cerberus…';
  }
}

export function clearVoiceHud() {
  _hudInterim = '';
  _hudFinal = '';
  _hudLastCommand = '';
  _finalTranscript = '';
  _transcript = '';
  clearCommandInput();
  window.cerberusVoiceService?.setLastCommand?.('');
}

function _updateLiveDebug() {
  const set = (id, val) => { const el = _el(id); if (el) el.textContent = val ?? '—'; };
  set('cerberus-voice-debug-state', _phase || 'idle');
  set('cerberus-voice-debug-supported', String(_speechSupported()));
  set('cerberus-voice-debug-instance', String(!!(_recognition || _testRec)));
  set('cerberus-voice-debug-running', String(!!(_recognitionActive || _testRec)));
  set('cerberus-voice-debug-permission', _diag.permission);
  set('cerberus-voice-debug-interim', _debugInterim || '—');
  set('cerberus-voice-debug-final', _debugFinal || '—');
  set('cerberus-voice-debug-normalized', _diag.lastNormalized || '—');
  set('cerberus-voice-debug-wake', _debugLastWake || '—');
  set('cerberus-voice-debug-code', _diag.lastError || 'none');
  const c = _diag.counts;
  set('cerberus-voice-debug-events', `start=${c.onstart} audio=${c.onaudiostart} speech=${c.onspeechstart} result=${c.onresult} end=${c.onend} err=${c.onerror}`);
  set('cerberus-voice-debug-locks', [
    `micPaused=${_micPaused}`,
    `speaking=${_phase === 'speaking'}`,
    `submitting=${_submitting}`,
    `wakeListening=${_listenMode === 'wake'}`,
    `commandListening=${_listenMode === 'command'}`,
    `wake=${_wakeModeEnabled}`,
    `home=${_homeConversationActive}`,
  ].join(' '));
}

function _updatePrivacyText() {
  const el = _el('cerberus-voice-privacy-browser');
  if (!el || _isWhisperMode()) return;
  if (_conversationActive) {
    el.textContent = "Conversation Mode is on. Say your command, or 'Cerberus standby' to stop.";
  } else if (_passiveWakeActive) {
    el.textContent = "Passive wake listening is on. Say 'Hey Cerberus' to activate — no clap detection.";
  } else {
    el.textContent = 'Microphone is off until you open Home or start listening.';
  }
}

function _clearCommandStartTimer() {
  if (_commandStartTimer) {
    clearTimeout(_commandStartTimer);
    _commandStartTimer = null;
  }
}

function _clearWakeRestartTimer() {
  if (_wakeRestartTimer) {
    clearTimeout(_wakeRestartTimer);
    _wakeRestartTimer = null;
  }
}

function _stripMarkdownForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*]\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _truncateForVoice(text, maxSentences = 4) {
  const clean = _stripMarkdownForSpeech(text);
  if (!clean) return '';
  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  return parts.slice(0, maxSentences).join(' ').trim();
}

function _pickDefaultVoice(voices) {
  const preferred = window.AtlasUserSettings?.getPreferredVoiceName?.();
  if (preferred) {
    const exact = voices.find(v => v.name === preferred || v.name.includes(preferred));
    if (exact) return exact.name;
  }
  const en = voices.filter(v => (v.lang || '').toLowerCase().startsWith('en'));
  const settings = window.AtlasUserSettings?.getAtlasUserSettings?.();
  if (settings?.assistant_identity === 'Cerberusia') {
    const ukFemale = en.find(v => v.name.includes('Google UK English Female'));
    if (ukFemale) return ukFemale.name;
  }
  const ukMale = en.find(v => v.name.includes('Google UK English Male'));
  if (ukMale) return ukMale.name;
  const prefer = [
    'Google UK English Male',
    'Microsoft David', 'Microsoft Mark', 'Microsoft Ryan',
    'Google US English', 'Daniel', 'George',
  ];
  for (const name of prefer) {
    const m = en.find(v => v.name.includes(name));
    if (m) return m.name;
  }
  const maleish = en.find(v => /male|david|mark|ryan|george|daniel/i.test(v.name));
  return maleish?.name || en[0]?.name || voices[0]?.name || '';
}

function _populateVoices() {
  const sels = [_el('cerberus-voice-tts-voice'), _el('cerberus-home-tts-voice')].filter(Boolean);
  if (!sels.length || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!_selectedVoice && voices.length) {
    _selectedVoice = _pickDefaultVoice(voices);
    _savePrefs();
  }
  const html = '<option value="">System default</option>' + voices.map(v => `
    <option value="${v.name.replace(/"/g, '&quot;')}"${_selectedVoice === v.name ? ' selected' : ''}>${v.name} (${v.lang})</option>
  `).join('');
  sels.forEach(sel => { sel.innerHTML = html; });

  const hint = _el('cerberus-voice-tts-hint');
  if (hint) {
    const enCount = voices.filter(v => (v.lang || '').startsWith('en')).length;
    hint.classList.toggle('hidden', enCount >= 3);
  }
}

function _notifyStatus(phase, label) {
  if (_homeDeps?.setStatus) _homeDeps.setStatus(phase, label);
}

function _isLikelySelfTranscription(text) {
  const low = (text || '').toLowerCase().trim();
  if (!low || !_lastSpokenText) return false;
  if (Date.now() - _lastSpokenAt > 8000) return false;
  const spoken = _lastSpokenText.toLowerCase();
  if (low.length < 4) return false;
  return spoken.includes(low) || low.includes(spoken.slice(0, Math.min(24, spoken.length)));
}

function _handleStandbyPhrase(text) {
  const hit = findStandbyPhrase(text);
  if (!hit) return false;
  void _onStandbyDetected(hit);
  return true;
}

async function _onStandbyDetected() {
  if (_wakeHandling) return;
  _wakeHandling = true;
  _stopRecognition();
  _clearCommandTimer();
  _finalTranscript = '';
  _updateTranscript('');
  _conversationActive = false;
  _wakeModeEnabled = false;
  _homeConversationActive = false;
  _followUpMode = false;
  _homeDeps?.onDeactivate?.();
  _setMicPaused(true);
  try {
    await speakText(cerberusPersonality.getStandby(), { short: false });
  } finally {
    _wakeHandling = false;
    _setMicPaused(false);
    _passiveWakeActive = true;
    _startWakeListening();
  }
}

function _handleControlCommand(text) {
  if (_handleStandbyPhrase(text)) return true;
  const low = text.toLowerCase().trim();
  if (/never\s*mind/.test(low)) {
    _finalTranscript = '';
    _updateTranscript('');
    _stopRecognition();
    if (_conversationActive) _startFollowUpOrWake();
    else if (_passiveWakeActive) _startWakeListening();
    else _setStatus('idle');
    return true;
  }
  if (/stop\s*talking/.test(low)) {
    window.speechSynthesis?.cancel();
    _setMicPaused(false);
    if (_interruptionEnabled && _conversationActive) _startCommandCapture();
    return true;
  }
  return false;
}

function _clearFollowUpTimer() {
  if (_followUpTimer) {
    clearTimeout(_followUpTimer);
    _followUpTimer = null;
  }
}

function _startFollowUpWindow() {
  _clearFollowUpTimer();
  if (!_conversationActive) return;
  _followUpMode = true;
  _followUpTimer = setTimeout(() => {
    _followUpMode = false;
    _debug('follow-up window ended → wake listening');
    if (_conversationActive) _startCommandCapture({ fromFollowUp: true });
    else if (_passiveWakeActive) _startWakeListening();
  }, _followUpTimeoutMs);
  _startCommandCapture({ fromFollowUp: true });
}

export function enterFollowUpListening() {
  if (_homeDeps?.isPaused?.()) return;
  _startFollowUpWindow();
}

function _startFollowUpOrWake() {
  if (_conversationActive) _startFollowUpWindow();
  else if (_passiveWakeActive) _startWakeListening();
  else _setStatus('idle');
}

export function speakText(text, { onEnd, short = true, style } = {}) {
  if (!text || !window.speechSynthesis) {
    if (onEnd) onEnd();
    return Promise.resolve();
  }
  window.speechSynthesis.cancel();
  const replyStyle = style || _voiceReplyStyle || 'brief';
  const spoken = short
    ? prepareSpeechText(text, replyStyle)
    : prepareSpeechText(text, 'normal');
  _lastSpokenText = spoken;
  _lastSpokenAt = Date.now();
  if (!spoken) {
    if (onEnd) onEnd();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(spoken.slice(0, 4000));
    if (_selectedVoice) {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.name === _selectedVoice);
      if (match) utt.voice = match;
    }
    utt.rate = window.AtlasUserSettings?.getSpeechRate?.() || _ttsRate;
    utt.pitch = _ttsPitch;
    _setMicPaused(true);
    _setStatus('speaking');
    utt.onstart = () => {
      _setStatus('speaking');
      _notifyStatus('speaking', 'Speaking');
    };
    const done = () => {
      setTimeout(() => {
        _setMicPaused(false);
        if (onEnd) onEnd();
        resolve();
      }, SELF_TRANSCRIPT_COOLDOWN_MS);
    };
    utt.onend = done;
    utt.onerror = done;
    window.speechSynthesis.speak(utt);
  });
}

function _showRecognitionDebug(code, message) {
  const panel = _el('cerberus-voice-debug');
  const msgEl = _el('cerberus-voice-debug-msg');
  const hasError = !!code && code !== 'none' && code !== 'test';
  if (hasError && code) _diag.lastError = code;
  if (panel) panel.classList.toggle('cerberus-voice-debug--error', hasError);
  const hint = RECOGNITION_ERROR_HINTS[code] || '';
  if (msgEl) {
    msgEl.textContent = message || (hasError ? (hint || code) : 'No recognition errors yet.');
  }
  _updateLiveDebug();
}

function _clearRecognitionDebug() {
  _showRecognitionDebug('none', 'No recognition errors yet.');
}

function _showSwitchWhisper(show) {
  const btn = _el('cerberus-voice-switch-whisper');
  if (btn) btn.classList.toggle('hidden', !show);
}

function _handleRecognitionError(code) {
  _diag.lastError = code;
  _showRecognitionDebug(code, RECOGNITION_ERROR_HINTS[code] || `Speech error: ${code}`);
  _stopRecognition();
  if (code === 'no-speech' || code === 'aborted') {
    if (_passiveWakeActive && !_conversationActive) {
      _scheduleWakeRestart();
      return;
    }
    if (_conversationActive) {
      _startFollowUpOrWake();
      return;
    }
    return;
  }
  if (code === 'network') {
    _wakeModeEnabled = false;
    _homeConversationActive = false;
    const wakeToggle = _el('cerberus-voice-wake-mode');
    if (wakeToggle) wakeToggle.checked = false;
    _homeDeps?.saveSettings?.({ conversation_mode_enabled: false });
    _setStatus('error');
    _showSwitchWhisper(true);
    if (_deps.showToast) _deps.showToast('Browser speech unavailable. Switch to Local Whisper.');
    return;
  }
  if (_passiveWakeActive && !_conversationActive) {
    _setStatus('wake-listening');
    _scheduleWakeRestart();
    return;
  }
  if (_conversationActive) {
    _startFollowUpOrWake();
    return;
  }
  _setStatus('error');
  if (_deps.showToast) _deps.showToast(`Speech error: ${code}`);
}

function _updateModeUI() {
  const browserPrivacy = _el('cerberus-voice-privacy-browser');
  const whisperPrivacy = _el('cerberus-voice-privacy-whisper');
  const wakeNote = _el('cerberus-voice-wake-whisper-note');
  const wakeToggleWrap = document.querySelector('.cerberus-voice-wake-toggle');
  const modeSel = _el('cerberus-voice-stt-mode');
  const startBtn = _el('cerberus-voice-start-btn');
  const stopBtn = _el('cerberus-voice-stop-btn');
  const pttBtn = _el('cerberus-voice-ptt-btn');
  const setupNote = _el('cerberus-voice-whisper-setup');
  const convNote = _el('cerberus-voice-conversation-note');

  if (modeSel) modeSel.value = _sttMode;
  if (browserPrivacy) browserPrivacy.classList.toggle('hidden', _isWhisperMode());
  if (whisperPrivacy) whisperPrivacy.classList.toggle('hidden', !_isWhisperMode());
  if (wakeNote) wakeNote.classList.toggle('hidden', !_isWhisperMode());
  if (wakeToggleWrap) wakeToggleWrap.classList.toggle('hidden', _isWhisperMode());
  if (convNote) convNote.classList.toggle('hidden', _isWhisperMode());
  if (setupNote) setupNote.classList.toggle('hidden', !_isWhisperMode() || _whisperAvailable !== false);

  const whisper = _isWhisperMode();
  if (startBtn) startBtn.classList.toggle('hidden', whisper);
  if (stopBtn) stopBtn.classList.toggle('hidden', whisper);
  if (pttBtn) pttBtn.classList.toggle('hidden', !whisper);

  if (whisper) {
    if (pttBtn) pttBtn.textContent = _recording ? 'Stop & Send' : 'Click to Talk';
    _showSwitchWhisper(false);
  } else {
    if (startBtn) startBtn.textContent = _wakeModeEnabled ? 'Restart Conversation' : 'Start Listening';
    if (stopBtn) stopBtn.textContent = 'Stop Listening';
  }

  const rate = _el('cerberus-voice-tts-rate');
  const pitch = _el('cerberus-voice-tts-pitch');
  if (rate) rate.value = String(_ttsRate);
  if (pitch) pitch.value = String(_ttsPitch);

  _syncControlState();
  _updatePrivacyText();
}

function _syncControlState() {
  const startBtn = _el('cerberus-voice-start-btn');
  const stopBtn = _el('cerberus-voice-stop-btn');
  const pttBtn = _el('cerberus-voice-ptt-btn');
  const wakeToggle = _el('cerberus-voice-wake-mode');
  const modeSel = _el('cerberus-voice-stt-mode');
  const autoToggle = _el('cerberus-voice-auto-submit');
  const busy = ['processing', 'speaking', 'greeting', 'wake-detected', 'uploading', 'transcribing', 'returning-standby'].includes(_phase);

  if (autoToggle) autoToggle.checked = _autoSubmit;

  if (_isWhisperMode()) {
    if (pttBtn) pttBtn.disabled = busy && !_recording;
    if (wakeToggle) { wakeToggle.disabled = true; wakeToggle.checked = false; }
    if (modeSel) modeSel.disabled = _recording || busy;
    return;
  }

  const sttOk = _speechSupported();
  const listening = !!_listenMode;
  if (startBtn) startBtn.disabled = !sttOk || listening || busy || _wakeModeEnabled;
  if (stopBtn) stopBtn.disabled = !sttOk || (!listening && !_wakeModeEnabled) || busy;
  if (wakeToggle) {
    wakeToggle.disabled = !sttOk || busy;
    wakeToggle.checked = _wakeModeEnabled;
  }
  if (modeSel) modeSel.disabled = listening || _wakeModeEnabled || busy;
}

function _updateTranscript(text, { interim = '' } = {}) {
  _transcript = text;
  const ta = _el('cerberus-voice-transcript');
  if (ta) ta.value = text;
  if (_conversationActive || _passiveWakeActive) {
    _updateCommandInputDisplay(text, { interim });
  }
}

async function _refreshWhisperStatus() {
  try {
    const res = await fetch('/api/cerberus/voice/status', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    _whisperAvailable = !!data.whisper_available;
    const setupNote = _el('cerberus-voice-whisper-setup');
    if (setupNote) setupNote.classList.toggle('hidden', !_isWhisperMode() || _whisperAvailable !== false);
  } catch (_) {
    _whisperAvailable = null;
  }
}

async function _refreshDesktopStatus() {
  try {
    const res = await fetch('/api/cerberus/desktop/status', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    const el = _el('cerberus-voice-desktop-status');
    if (el) el.textContent = data.label || 'Desktop Control: Disabled';
  } catch (_) {}
}

function _stopRecognition({ keepMode = false } = {}) {
  _clearCommandTimer();
  _clearWakeRestartTimer();
  _clearNoTranscriptTimer();
  _recognitionActive = false;
  if (_recognition) {
    try { _recognition.stop(); } catch (_) {}
    _recognition.onresult = null;
    _recognition.onend = null;
    _recognition.onerror = null;
    _recognition.onaudiostart = null;
    _recognition.onspeechstart = null;
    _recognition.onstart = null;
    _recognition = null;
  }
  if (!keepMode) _listenMode = null;
  _manualListen = false;
  _updateLiveDebug();
  _syncControlState();
}

function _stopTestRecognition() {
  if (_testTimer) {
    clearTimeout(_testTimer);
    _testTimer = null;
  }
  _diag.testMode = false;
  if (_testRec) {
    try { _testRec.stop(); } catch (_) {}
    _testRec = null;
  }
  _updateLiveDebug();
}

function _restoreEngineAfterTest() {
  const snap = _engineSnapshot;
  _engineSnapshot = null;
  if (!snap) return;
  _homeConversationActive = snap.home;
  _wakeModeEnabled = snap.wake;
  if (snap.home || snap.wake) {
    if (snap.mode === 'wake') _startWakeListening();
    else if (snap.mode === 'command') _startCommandCapture();
    else _startWakeListening();
  } else if (snap.phase && snap.phase !== 'idle') {
    _setStatus(snap.phase);
  }
}

function _stopMediaTracks() {
  if (_mediaStream) {
    _mediaStream.getTracks().forEach(t => t.stop());
    _mediaStream = null;
  }
}

function _stopRecording() {
  _recording = false;
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    try { _mediaRecorder.stop(); } catch (_) {}
  } else {
    _stopMediaTracks();
  }
  _updateModeUI();
}

function _recorderMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function _scheduleCommandFinish() {
  _clearCommandTimer();
  if (!['command-listening', 'listening'].includes(_phase) || _micPaused || _submitting) return;
  _commandSilenceTimer = setTimeout(() => {
    _commandSilenceTimer = null;
    if (['command-listening', 'listening'].includes(_phase)) _finishCommandCapture();
  }, _silenceSubmitMs);
}

function _finishCommandCapture() {
  _clearCommandTimer();
  _stopRecognition();
  const raw = (_el('cerberus-voice-transcript')?.value || '').trim();
  if (!raw) {
    if (_conversationActive) {
      speakText(cerberusPersonality.appendAddress('I did not catch that'), { onEnd: () => _startFollowUpOrWake() });
    } else if (_passiveWakeActive) {
      _startWakeListening();
    } else {
      _setStatus('idle');
    }
    return;
  }
  if (_handleControlCommand(raw)) return;
  const text = stripVoicePrefixes(raw);
  if (!text || isActivationOnly(text)) {
    if (_conversationActive) _startCommandCapture();
    else if (_passiveWakeActive) _startWakeListening();
    return;
  }
  _finalTranscript = text;
  _updateTranscript(text);
  _submitToAssistant();
}

async function _onWakeDetected(matchedPhrase = '') {
  if (_wakeHandling || _conversationActive) return;
  _wakeHandling = true;
  window.cerberusVoiceService?.triggerWakeAnimation?.();
  _debugLastWake = matchedPhrase || 'hey atlas';
  _debug('activation phrase', _debugLastWake);
  _updateLiveDebug();

  _stopRecognition();
  _wakeSessionText = '';
  _setMicPaused(true);
  _setStatus('wake-detected');

  _finalTranscript = '';
  _updateTranscript('');

  try {
    _homeDeps?.onActivate?.();
    _conversationActive = true;
    _wakeModeEnabled = true;
    _homeConversationActive = true;
    _speakReplies = true;
    _homeDeps?.saveSettings?.({ conversation_mode_enabled: true, speak_replies: true });

    const greeting = window.AtlasUserSettings?.getActivationGreeting?.() || cerberusPersonality.getGreeting();
    await speakText(greeting, { short: false });
    const started = _startCommandCapture();
    if (!started) {
      _showRecognitionDebug('command_listen_failed', 'Could not start command listening after activation.');
      _setStatus('error');
      _setMicPaused(false);
      _passiveWakeActive = true;
      _startWakeListening();
    }
  } catch (err) {
    _debug('activation flow error', err?.message);
    _setStatus('error');
    _setMicPaused(false);
    _passiveWakeActive = true;
    _startWakeListening();
  } finally {
    _wakeHandling = false;
  }
}

export function simulateWakePhrase() {
  _onWakeDetected('hey atlas (simulated)');
}

function _canRunHomeEngine() {
  return _passiveWakeActive || _conversationActive || _followUpMode;
}

function _startCommandCapture({ fromFollowUp = false } = {}) {
  if (_submitting) return false;
  if (_micPaused) _setMicPaused(false);
  _syncHomeEngineFlags();
  if (!_open && !_canRunHomeEngine()) return false;
  if (_homeDeps?.isPaused?.()) return false;
  _finalTranscript = '';
  _updateTranscript('');
  if (!fromFollowUp) _followUpMode = false;
  _setStatus('command-listening');
  _startRecognition({ mode: 'command', conversation: true });
  _clearCommandStartTimer();
  return true;
}

function _startWakeListening() {
  if (!_speechSupported() || _submitting) return;
  if (_homeDeps?.isPaused?.()) return;
  _syncHomeEngineFlags();
  if (_micPaused) _setMicPaused(false);
  _followUpMode = false;
  _manualListen = false;
  _wakeSessionText = '';
  _finalTranscript = '';
  _updateTranscript('');
  _debugInterim = '';
  _debugFinal = '';
  _startRecognition({ mode: 'wake', conversation: true });
}

function _syncHomeEngineFlags() {
  if (_homeDeps?.isConversationEnabled?.()) {
    _conversationActive = true;
    _wakeModeEnabled = true;
    _homeConversationActive = true;
  }
}

function _shouldRestartWake() {
  const recoverablePhase = ['wake-listening', 'idle', 'error'].includes(_phase);
  return _listenMode === 'wake'
    && _passiveWakeActive
    && !_conversationActive
    && recoverablePhase
    && !_micPaused
    && !_submitting
    && !_wakeHandling
    && !_homeDeps?.isPaused?.();
}

function _scheduleWakeRestart() {
  _clearWakeRestartTimer();
  _wakeRestartTimer = setTimeout(() => {
    _wakeRestartTimer = null;
    if (_shouldRestartWake()) _startWakeListening();
  }, WAKE_RESTART_DELAY_MS);
}

function _handleWakeResult(interim, final) {
  if (_conversationActive) return false;
  if (_wakeHandling || ['wake-detected', 'greeting', 'speaking', 'processing'].includes(_phase)) return false;

  if (interim) _debugInterim = interim.trim();
  if (final) {
    _debugFinal = final.trim();
    _wakeSessionText = `${_wakeSessionText} ${final}`.trim();
  } else if (interim) {
    _wakeSessionText = `${_wakeSessionText} ${interim}`.trim();
  }
  if (_wakeSessionText.length > 240) {
    _wakeSessionText = _wakeSessionText.slice(-240);
  }
  _updateLiveDebug();

  const candidates = [
    final?.trim(),
    interim?.trim(),
    _wakeSessionText,
    `${_wakeSessionText} ${interim || ''}`.trim(),
  ].filter(Boolean);

  for (const c of candidates) {
    const hit = _findWakePhrase(c);
    if (hit) {
      _diag.lastNormalized = _normalizeTranscript(c);
      _debugLastWake = hit;
      _diagLog('wake-match', `${hit} ← "${c}"`);
      try { _recognition?.stop(); } catch (_) {}
      _onWakeDetected(hit);
      return true;
    }
    if (c) _diag.lastNormalized = _normalizeTranscript(c);
  }
  _updateLiveDebug();
  return false;
}

function _bindRecognitionHandlers(rec, { conversation = false } = {}) {
  rec.onstart = () => {
    _recognitionActive = true;
    _diagLog('onstart', _listenMode);
    _startNoTranscriptWatchdog();
  };

  rec.onaudiostart = () => {
    _diagLog('onaudiostart');
  };

  rec.onspeechstart = () => {
    _diagLog('onspeechstart');
  };

  rec.onresult = (e) => {
    if (_noTranscriptMarkResult) _noTranscriptMarkResult();
    _diagLog('onresult', `idx=${e.resultIndex} len=${e.results.length}`);

    if (_submitting) return;

    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }

    const listenMode = _listenMode;
    const allowWhilePaused = listenMode === 'wake' || listenMode === 'command';
    if (_micPaused && !allowWhilePaused) return;

    if (listenMode === 'wake') {
      _handleWakeResult(interim, final);
      return;
    }

    if (_conversationActive && conversation) {
      const probe = `${_finalTranscript} ${final || interim}`.trim();
      if (probe && _handleStandbyPhrase(probe)) return;
    }

    if (final) {
      const chunk = final.trim();
      if (_isLikelySelfTranscription(chunk)) return;
      _debugFinal = chunk;
      _diag.lastNormalized = _normalizeTranscript(chunk);
      const next = `${_finalTranscript} ${chunk}`.trim();
      if (next === _finalTranscript) return;
      _finalTranscript = next;
      _updateTranscript(_finalTranscript, { interim: '' });
      _updateLiveDebug();
      if (conversation) _scheduleCommandFinish();
    } else if (interim) {
      if (!_isLikelySelfTranscription(interim)) {
        _debugInterim = interim.trim();
        _diag.lastNormalized = _normalizeTranscript(interim);
        _updateTranscript(`${_finalTranscript} ${interim}`.trim(), { interim: interim.trim() });
        _updateLiveDebug();
      }
    }
  };

  rec.onerror = (ev) => {
    const code = ev.error || 'unknown';
    _diag.lastError = code;
    _recognitionActive = false;
    _diagLog('onerror', code);
    _clearNoTranscriptTimer();
    if (code === 'no-speech') {
      if (_shouldRestartWake()) _scheduleWakeRestart();
      return;
    }
    if (code === 'aborted') return;
    _handleRecognitionError(code);
  };

  rec.onend = () => {
    _recognitionActive = false;
    const endedMode = _listenMode;
    const endedConversation = conversation;
    if (_recognition === rec) _recognition = null;
    _diagLog('onend', endedMode);
    _clearNoTranscriptTimer();
    _updateLiveDebug();

    if (_micPaused || _submitting || _wakeHandling || _diag.testMode) return;

    if (endedMode === 'wake' && _shouldRestartWake()) {
      _scheduleWakeRestart();
      return;
    }

    if (endedMode === 'command' && endedConversation
        && (_phase === 'command-listening' || _phase === 'listening')) {
      if (_followUpMode && !_finalTranscript.trim()) {
        _startCommandCapture();
        return;
      }
      _scheduleCommandFinish();
      return;
    }

    if (_followUpMode && _canRunHomeEngine() && !_homeDeps?.isPaused?.()) {
      _startCommandCapture();
      return;
    }

    if (endedMode === 'command' && _manualListen) {
      setTimeout(() => {
        if (_listenMode === 'command' && _manualListen) {
          _startRecognition({ mode: 'command', conversation: false });
        }
      }, WAKE_RESTART_DELAY_MS);
      return;
    }

    if (!_wakeModeEnabled && !_homeConversationActive) {
      _setStatus('idle');
      _syncControlState();
    }
  };
}

function _startRecognition({ mode = 'command', conversation = false } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (_diag.testMode) _stopTestRecognition();
  if (_micPaused && mode === 'wake') _setMicPaused(false);

  _stopRecognition({ keepMode: true });
  _listenMode = mode;
  _manualListen = !conversation && mode === 'command';

  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-GB';

  _bindRecognitionHandlers(rec, { conversation });
  _recognition = rec;

  if (mode === 'wake') {
    _wakeSessionText = '';
    _setStatus('wake-listening');
  } else if (conversation) {
    _setStatus(_followUpMode ? 'listening' : 'command-listening');
  } else {
    _setStatus('listening');
  }

  _syncControlState();

  try {
    rec.start();
    _diagLog('start', `recognition.start() mode=${mode}`);
  } catch (err) {
    _recognitionActive = false;
    _recognition = null;
    _diag.lastError = err?.message || 'start-failed';
    _updateLiveDebug();
    _handleRecognitionError('start-failed');
    if (_deps.showToast) _deps.showToast(`Could not start microphone: ${err?.message || 'unknown'}`);
    if (_shouldRestartWake()) _scheduleWakeRestart();
  }
}

export function runTestRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    _showRecognitionDebug('start-failed', 'SpeechRecognition not supported in this browser.');
    return;
  }

  _stopTestRecognition();
  _engineSnapshot = {
    home: _homeConversationActive,
    wake: _wakeModeEnabled,
    mode: _listenMode,
    phase: _phase,
  };
  _stopRecognition();

  _diag.testMode = true;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-GB';
  _testRec = rec;

  rec.onstart = () => {
    _recognitionActive = true;
    _diagLog('onstart', 'test');
    _showRecognitionDebug('test', 'Test Recognition running — speak now (8 seconds).');
  };
  rec.onaudiostart = () => _diagLog('onaudiostart', 'test');
  rec.onspeechstart = () => _diagLog('onspeechstart', 'test');
  rec.onresult = (e) => {
    _diagLog('onresult', 'test');
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (interim) _debugInterim = interim.trim();
    if (final) _debugFinal = final.trim();
    const combined = (final || interim).trim();
    if (combined) {
      _diag.lastNormalized = _normalizeTranscript(combined);
      _updateTranscript(combined);
    }
    _updateLiveDebug();
  };
  rec.onerror = (ev) => {
    _diag.lastError = ev.error || 'unknown';
    _diagLog('onerror', `test: ${ev.error}`);
    _showRecognitionDebug(ev.error, RECOGNITION_ERROR_HINTS[ev.error] || ev.error);
  };
  rec.onend = () => {
    _diagLog('onend', 'test');
    _testRec = null;
    _recognitionActive = false;
    _updateLiveDebug();
  };

  try {
    rec.start();
    _setStatus('listening');
    _testTimer = setTimeout(() => {
      _stopTestRecognition();
      _showRecognitionDebug('test', 'Test Recognition ended (8s). Restoring prior engine state.');
      _restoreEngineAfterTest();
    }, TEST_RECOGNITION_MS);
  } catch (err) {
    _diag.testMode = false;
    _testRec = null;
    _showRecognitionDebug('start-failed', err?.message || 'Test Recognition could not start.');
    _restoreEngineAfterTest();
  }
}

export function forceCommandMode() {
  _stopTestRecognition();
  _wakeHandling = false;
  _homeConversationActive = true;
  _wakeModeEnabled = true;
  const toggle = _el('cerberus-voice-wake-mode');
  if (toggle) toggle.checked = true;
  _homeDeps?.saveSettings?.({ conversation_mode_enabled: true });
  _followUpMode = true;
  _setMicPaused(false);
  _diagLog('state-change', 'force command mode');
  _startCommandCapture();
}

async function _startWhisperRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    _setStatus('error');
    return;
  }
  _stopRecognition();
  _audioChunks = [];
  _finalTranscript = '';
  _updateTranscript('');

  try {
    _mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = _recorderMimeType();
    _mediaRecorder = new MediaRecorder(_mediaStream, mimeType ? { mimeType } : {});
    _mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) _audioChunks.push(e.data);
    };
    _mediaRecorder.onstop = () => _uploadWhisperRecording();
    _mediaRecorder.start(250);
    _recording = true;
    _setStatus('recording');
    _updateModeUI();
  } catch (err) {
    _setStatus('error');
    if (_deps.showToast) _deps.showToast(`Microphone denied: ${err?.message || 'unknown'}`);
  }
}

async function _uploadWhisperRecording() {
  _stopMediaTracks();
  _recording = false;
  _updateModeUI();

  if (!_audioChunks.length) {
    _setStatus('idle');
    return;
  }

  const mimeType = _mediaRecorder?.mimeType || 'audio/webm';
  const blob = new Blob(_audioChunks, { type: mimeType });
  _audioChunks = [];
  const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('audio', blob, `voice.${ext}`);
  form.append('language', 'en');

  _setStatus('uploading');
  try {
    const res = await fetch('/api/cerberus/voice/transcribe', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
    });
    _setStatus('transcribing');
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      _whisperAvailable = data.error === 'whisper_not_installed' ? false : _whisperAvailable;
      _updateModeUI();
      _setStatus('error');
      _showRecognitionDebug(data.error || 'transcribe_failed', data.message || 'Transcription failed');
      if (_deps.showToast) _deps.showToast(data.message || 'Transcription failed');
      return;
    }

    const text = (data.text || '').trim();
    _finalTranscript = text;
    _updateTranscript(text);
    _setStatus('transcript-ready');

    if (_autoSubmit && text) {
      _submitToAssistant();
    }
  } catch (err) {
    _setStatus('error');
    _showRecognitionDebug('upload_failed', err?.message || 'Upload failed');
  } finally {
    _syncControlState();
  }
}

function _togglePtt() {
  if (_recording) _stopRecording();
  else _startWhisperRecording();
}

function _startManualListening() {
  if (!_speechSupported()) {
    _setStatus('error');
    return;
  }
  if (_homeDeps?.isConversationEnabled?.() || _homeConversationActive || _wakeModeEnabled) {
    _syncHomeEngineFlags();
    _startWakeListening();
    return;
  }
  _finalTranscript = '';
  _updateTranscript('');
  _startRecognition({ mode: 'command', conversation: false });
}

function _stopManualListening() {
  _stopRecognition();
  const text = (_el('cerberus-voice-transcript')?.value || '').trim();
  if (text) _submitToAssistant();
  else {
    _setStatus('idle');
    _syncControlState();
  }
}

async function _returnToWakeStandby() {
  if (_isWhisperMode()) {
    _setStatus('idle');
    _syncControlState();
    return;
  }
  if (_homeDeps?.isPaused?.()) {
    _setStatus('paused');
    _syncControlState();
    return;
  }
  if (!_conversationActive && !_passiveWakeActive) {
    _setStatus('idle');
    _syncControlState();
    return;
  }
  if (!_conversationActive) {
    _startWakeListening();
    return;
  }
  _debug('enter follow-up listening');
  _setMicPaused(false);
  _startFollowUpWindow();
}

export function recoverAfterProcessing() {
  _submitting = false;
  _clearResponseTimeout();
  _setMicPaused(false);
  if (_homeDeps?.isPaused?.()) {
    _setStatus('paused');
    return;
  }
  if (_conversationActive) _startFollowUpWindow();
  else if (_passiveWakeActive) _startWakeListening();
  else _setStatus('idle');
}

function _clearResponseTimeout() {
  if (_responseTimeout) {
    clearTimeout(_responseTimeout);
    _responseTimeout = null;
  }
}

function _handleAssistantResponse(text, { failed = false } = {}) {
  _clearResponseTimeout();
  _submitting = false;
  _debug('assistant response', { failed, len: (text || '').length });

  if (failed || !(text || '').trim()) {
    speakText(cerberusPersonality.getError("I couldn't complete that request"), {
      onEnd: () => _returnToWakeStandby(),
    });
    return;
  }

  if (_speakReplies) {
    speakText(text, {
      onEnd: () => _returnToWakeStandby(),
    });
  } else {
    _returnToWakeStandby();
  }
}

function _finishSubmitResult(result) {
  const r = normalizeSubmitResult(result);
  _clearResponseTimeout();
  _submitting = false;
  cmdDebug('voice pipeline result', r);

  if (r.handled) {
    if (r.spoken) {
      _returnToWakeStandby();
      return;
    }
    if (r.message) {
      _handleAssistantResponse(r.message, { failed: false });
      return;
    }
    _returnToWakeStandby();
    return;
  }

  if (!r.ok || !r.message) {
    _handleAssistantResponse('', { failed: true });
    return;
  }
  _handleAssistantResponse(r.message, { failed: false });
}

function _submitToAssistant() {
  const raw = (_el('cerberus-voice-transcript')?.value || '').trim();
  const text = stripVoicePrefixes(raw);
  if (!text || _submitting) {
    if (!text) _returnToWakeStandby();
    return;
  }
  if (isActivationOnly(text)) {
    _returnToWakeStandby();
    return;
  }
  updateVoiceHud({ lastCommand: text });
  clearCommandInput();
  if (text === _lastSubmittedText && Date.now() - _lastSubmittedAt < 4000) {
    _debug('duplicate submit blocked', text.slice(0, 40));
    return;
  }
  _lastSubmittedText = text;
  _lastSubmittedAt = Date.now();

  _submitting = true;
  _setStatus('processing');
  _setMicPaused(true);
  _stopRecognition();
  _stopRecording();

  _clearResponseTimeout();
  _responseTimeout = setTimeout(() => {
    if (_submitting) _handleAssistantResponse('', { failed: true });
  }, RESPONSE_TIMEOUT_MS);

  const onDone = (result) => {
    try {
      _finishSubmitResult(result);
    } catch (err) {
      _submitting = false;
      _handleAssistantResponse('', { failed: true });
    }
  };

  const failResult = { handled: false, ok: false, message: '', spoken: false };

  const useHome = !!(_homeDeps?.submitMessage);
  if (useHome && _homeDeps?.submitMessage) {
    _homeDeps.submitMessage(text, {
      onComplete: onDone,
      onError: () => onDone(failResult),
    }).catch(() => onDone(failResult));
  } else if (_deps.openAssistant) {
    const stayOnHome = useHome;
    _deps.openAssistant(text, {
      submit: true,
      stayOnHome,
      onComplete: onDone,
    });
  } else {
    _handleAssistantResponse('', { failed: true });
  }

  _finalTranscript = '';
  _updateTranscript('');
}

function _setWakeMode(enabled) {
  if (_isWhisperMode()) return;
  _wakeModeEnabled = enabled;
  const toggle = _el('cerberus-voice-wake-mode');
  if (toggle) toggle.checked = enabled;
  _homeDeps?.saveSettings?.({ conversation_mode_enabled: enabled });

  if (!enabled) {
    _homeConversationActive = false;
    _followUpMode = false;
    _stopRecognition();
    const online = _el('cerberus-voice-wake-indicator');
    if (online) {
      online.classList.remove('cerberus-voice-wake-indicator--active');
      online.textContent = '';
    }
    _setStatus('idle');
    _syncControlState();
    return;
  }

  if (!_speechSupported()) {
    _wakeModeEnabled = false;
    if (toggle) toggle.checked = false;
    _setStatus('error');
    return;
  }

  _speakReplies = true;
  const speakToggle = _el('cerberus-voice-speak-replies');
  if (speakToggle) speakToggle.checked = true;
  _savePrefs();

  if (window.homeModule?.isHomeActive?.()) {
    _homeConversationActive = true;
  }
  if (_deps.showToast) _deps.showToast('Conversation mode — say a wake phrase');
  const online = _el('cerberus-voice-wake-indicator');
  if (online) {
    online.textContent = 'Say “Hey Cerberus”…';
  }
  _startWakeListening();
}

function _setSttMode(mode) {
  if (mode !== 'browser' && mode !== 'whisper') return;
  if (_sttMode === mode) return;

  const wasHomeEngine = _homeConversationActive || _wakeModeEnabled;
  _sttMode = mode;
  if (mode === 'whisper') _autoSubmit = true;
  _savePrefs();

  if (mode === 'whisper') {
    _stopRecognition();
    _stopRecording();
  }

  const homeStt = _el('cerberus-home-stt-mode');
  if (homeStt) homeStt.value = mode;
  _updateModeUI();

  if (wasHomeEngine && mode === 'browser' && _homeDeps?.isConversationEnabled?.() && !_homeDeps?.isPaused?.()) {
    _homeConversationActive = true;
    _wakeModeEnabled = true;
    _startWakeListening();
  } else if (mode === 'whisper' && wasHomeEngine) {
    _setStatus('idle');
  }
}

export function setSttMode(mode) {
  _setSttMode(mode);
}

export function getSttMode() {
  return _sttMode;
}

function _switchToWhisperMode() {
  _setSttMode('whisper');
  _clearRecognitionDebug();
  if (_deps.showToast) _deps.showToast('Local Whisper — Click to Talk');
}

export function openVoiceMode({ startListening = false, sttMode = null } = {}) {
  _open = true;
  if (sttMode === 'browser' || sttMode === 'whisper') _sttMode = sttMode;

  const modal = _el('cerberus-voice-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  _clearRecognitionDebug();
  _populateVoices();
  _refreshWhisperStatus();
  _refreshDesktopStatus();

  const speakToggle = _el('cerberus-voice-speak-replies');
  if (speakToggle) speakToggle.checked = _speakReplies;
  const autoToggle = _el('cerberus-voice-auto-submit');
  if (autoToggle) autoToggle.checked = _autoSubmit;

  const wakeToggle = _el('cerberus-voice-wake-mode');
  if (wakeToggle) wakeToggle.checked = _wakeModeEnabled || _homeConversationActive;

  _renderWakePhrases();
  _updateModeUI();
  _refreshMicPermission();
  _updateLiveDebug();

  const engineRunning = _recognitionActive || _homeConversationActive || _wakeModeEnabled;
  if (!engineRunning) {
    _setStatus('idle');
  } else {
    _updatePrivacyText();
    _syncControlState();
  }

  if (startListening) {
    setTimeout(() => {
      if (_isWhisperMode()) _startWhisperRecording();
      else if (_speechSupported()) _startManualListening();
    }, 120);
  }
}

export function closeVoiceMode() {
  _open = false;
  const settingsOn = _homeDeps?.isConversationEnabled?.() ?? false;
  const keepEngine = (_homeConversationActive || _wakeModeEnabled || settingsOn)
    && !_homeDeps?.isPaused?.()
    && window.homeModule?.isHomeActive?.()
    && !_isWhisperMode();

  const modal = _el('cerberus-voice-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  if (keepEngine) {
    _debug('modal closed — engine keeps running');
    _syncHomeEngineFlags();
    const wakeToggle = _el('cerberus-voice-wake-mode');
    if (wakeToggle) wakeToggle.checked = true;
    _syncControlState();
    return;
  }

  _wakeModeEnabled = false;
  _homeConversationActive = false;
  _submitting = false;
  _setMicPaused(false);
  _clearCommandTimer();
  _clearResponseTimeout();
  _stopRecognition();
  _stopRecording();
  window.speechSynthesis?.cancel();

  const online = _el('cerberus-voice-wake-indicator');
  if (online) {
    online.classList.remove('cerberus-voice-wake-indicator--active');
    online.textContent = '';
  }
  const wakeToggle = _el('cerberus-voice-wake-mode');
  if (wakeToggle) wakeToggle.checked = false;
  _setStatus('idle');
  _syncControlState();
}

function _renderWakePhrases() {
  const el = _el('cerberus-voice-wake-phrases');
  if (!el) return;
  el.innerHTML = _wakePhrases.map(p => `<span class="cerberus-voice-wake-chip">${p}</span>`).join('');
}

function _bindEvents() {
  if (_eventsBound) return;
  _eventsBound = true;

  const modal = _el('cerberus-voice-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-cerberus-voice-close]')) closeVoiceMode();
    });
  }

  _el('cerberus-voice-start-btn')?.addEventListener('click', () => {
    if (_wakeModeEnabled) _startWakeListening();
    else _startManualListening();
  });

  _el('cerberus-voice-stop-btn')?.addEventListener('click', () => {
    if (_wakeModeEnabled || _homeConversationActive) {
      stopHomeConversation();
      if (_deps.showToast) _deps.showToast('Conversation Mode disabled');
      return;
    }
    _stopManualListening();
  });

  _el('cerberus-voice-ptt-btn')?.addEventListener('click', () => _togglePtt());
  _el('cerberus-voice-submit-btn')?.addEventListener('click', () => _submitToAssistant());

  _el('cerberus-voice-speak-replies')?.addEventListener('change', (e) => {
    _speakReplies = e.target.checked;
    _savePrefs();
    _homeDeps?.saveSettings?.({ speak_replies: _speakReplies });
  });

  _el('cerberus-voice-auto-submit')?.addEventListener('change', (e) => {
    _autoSubmit = e.target.checked;
    _savePrefs();
    _homeDeps?.saveSettings?.({ auto_submit: _autoSubmit });
  });

  _el('cerberus-voice-tts-voice')?.addEventListener('change', (e) => {
    _selectedVoice = e.target.value;
    _savePrefs();
    _homeDeps?.saveSettings?.({ selected_voice: _selectedVoice });
  });

  _el('cerberus-voice-tts-rate')?.addEventListener('input', (e) => {
    _ttsRate = parseFloat(e.target.value) || 0.95;
    _savePrefs();
    _homeDeps?.saveSettings?.({ rate: _ttsRate });
  });

  _el('cerberus-voice-tts-pitch')?.addEventListener('input', (e) => {
    _ttsPitch = parseFloat(e.target.value) || 1;
    _savePrefs();
    _homeDeps?.saveSettings?.({ pitch: _ttsPitch });
  });

  _el('cerberus-voice-tts-test')?.addEventListener('click', () => {
    speakText(cerberusPersonality.getGreeting(), { short: false });
  });

  _el('cerberus-voice-wake-mode')?.addEventListener('change', (e) => {
    _setWakeMode(e.target.checked);
  });

  _el('cerberus-voice-settings-interrupt')?.addEventListener('change', (e) => {
    _interruptionEnabled = e.target.checked;
    _homeDeps?.saveSettings?.({ interruption_enabled: _interruptionEnabled });
  });

  _el('cerberus-voice-settings-style')?.addEventListener('change', (e) => {
    _voiceReplyStyle = e.target.value || 'brief';
    _homeDeps?.saveSettings?.({ voice_reply_style: _voiceReplyStyle });
  });

  _el('cerberus-voice-stt-mode')?.addEventListener('change', (e) => {
    _setSttMode(e.target.value);
    const homeStt = _el('cerberus-home-stt-mode');
    if (homeStt) homeStt.value = e.target.value;
  });

  _el('cerberus-voice-switch-whisper')?.addEventListener('click', () => {
    _switchToWhisperMode();
  });

  _el('cerberus-voice-debug-simulate-wake')?.addEventListener('click', () => {
    simulateWakePhrase();
  });

  _el('cerberus-voice-debug-test')?.addEventListener('click', () => {
    runTestRecognition();
  });

  _el('cerberus-voice-debug-force-cmd')?.addEventListener('click', () => {
    forceCommandMode();
  });

  _el('cerberus-voice-fallback-whisper')?.addEventListener('click', () => {
    _switchToWhisperMode();
    if (_deps.showToast) _deps.showToast('Local Whisper — Click to Talk');
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = _populateVoices;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _open) closeVoiceMode();
  });
}

export function initAtlasVoiceMode(deps = {}) {
  _deps = deps;
  _loadPrefs();
  _bindEvents();
  _updateModeUI();
  _refreshMicPermission();
  _updateLiveDebug();
  _populateVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', _populateVoices);
  }
}

export function initHomeConversation(homeDeps = {}) {
  _homeDeps = homeDeps;
  const s = homeDeps.settings?.() || {};
  applySettings(s);
}

export function applySettings(s = {}) {
  if (typeof s.speak_replies === 'boolean') _speakReplies = s.speak_replies;
  if (typeof s.auto_submit === 'boolean') _autoSubmit = s.auto_submit;
  if (s.voice_reply_style) _voiceReplyStyle = s.voice_reply_style;
  if (typeof s.interruption_enabled === 'boolean') _interruptionEnabled = s.interruption_enabled;
  if (typeof s.rate === 'number') _ttsRate = s.rate;
  if (typeof s.pitch === 'number') _ttsPitch = s.pitch;
  if (s.selected_voice) _selectedVoice = s.selected_voice;
  if (typeof s.silence_submit_delay_ms === 'number') _silenceSubmitMs = s.silence_submit_delay_ms;
  if (typeof s.follow_up_timeout_ms === 'number') _followUpTimeoutMs = s.follow_up_timeout_ms;
  if (typeof s.conversation_mode_enabled === 'boolean') {
    _conversationActive = s.conversation_mode_enabled;
    _wakeModeEnabled = s.conversation_mode_enabled;
    _homeConversationActive = s.conversation_mode_enabled;
  }
  if (typeof s.passive_wake_enabled === 'boolean') {
    _passiveWakeActive = s.passive_wake_enabled;
  }
}

export function startPassiveWakeListening() {
  if (_homeDeps?.isPaused?.()) return;
  if (_isWhisperMode()) return;
  _passiveWakeActive = true;
  _debug('start passive wake');
  _refreshMicPermission();
  if (!_conversationActive && _speechSupported() && !_micPaused && !_submitting) {
    _startWakeListening();
    updateVoiceHud({ status: 'wake-listening', label: 'Passive wake' });
  }
}

export function enterConversationMode() {
  _conversationActive = true;
  _wakeModeEnabled = true;
  _homeConversationActive = true;
  const toggle = _el('cerberus-voice-wake-mode');
  if (toggle) toggle.checked = true;
}

export function exitConversationMode() {
  _conversationActive = false;
  _wakeModeEnabled = false;
  _homeConversationActive = false;
  _followUpMode = false;
  _submitting = false;
  _clearFollowUpTimer();
  _clearResponseTimeout();
  _stopRecognition();
  const toggle = _el('cerberus-voice-wake-mode');
  if (toggle) toggle.checked = false;
  if (_passiveWakeActive) {
    _setStatus('wake-listening');
    _startWakeListening();
  } else {
    _setStatus('idle');
  }
}

export function enterCommandListening() {
  if (_homeDeps?.isPaused?.()) return;
  if (!_conversationActive) return;
  if (_speechSupported() && !_micPaused && !_submitting) {
    _startCommandCapture();
    updateVoiceHud({ status: 'command-listening', label: 'Listening' });
  }
}

export function startHomeConversation() {
  enterConversationMode();
  enterCommandListening();
}

export function stopHomeConversation() {
  exitConversationMode();
  _homeDeps?.saveSettings?.({ conversation_mode_enabled: false, speak_replies: false });
  _notifyStatus('wake-listening', 'Passive wake');
  if (_passiveWakeActive) _startWakeListening();
}

export function pauseHomeConversation() {
  _micPaused = true;
  _stopRecognition();
  _notifyStatus('paused', 'Paused');
}

export function resumeHomeConversation() {
  _micPaused = false;
  if (_passiveWakeActive) startPassiveWakeListening();
  if (_conversationActive) enterCommandListening();
}

const cerberusVoiceMode = {
  initAtlasVoiceMode,
  initHomeConversation,
  applySettings,
  startPassiveWakeListening,
  enterConversationMode,
  exitConversationMode,
  enterCommandListening,
  startHomeConversation,
  stopHomeConversation,
  pauseHomeConversation,
  resumeHomeConversation,
  enterFollowUpListening,
  recoverAfterProcessing,
  openVoiceMode,
  closeVoiceMode,
  speakText,
  simulateWakePhrase,
  runTestRecognition,
  forceCommandMode,
  setSttMode,
  getSttMode,
  updateVoiceHud,
  clearVoiceHud,
  clearCommandInput,
};

export default cerberusVoiceMode;
