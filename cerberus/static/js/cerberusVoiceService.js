// Cerberus OS V6.1 — Global voice singleton (wake, transcript, desktop, navigation)

import cerberusVoiceNavigation from './cerberusVoiceNavigation.js';

let _inited = false;
let _desktopBridgeLabel = '—';
let _settings = {};

const cerberusVoiceService = {
  async init(deps = {}) {
    if (_inited) return;
    _inited = true;
    await import('./cerberusVoiceContext.js');
    await import('./cerberusVoiceActionsPanel.js');
    await import('./cerberusVoiceUi.js');
    await import('./cerberusOverlayTools.js');
    await import('./cerberusPersonality.js');
    const userSettings = await import('./cerberusUserSettings.js');
    await userSettings.default.loadAtlasUserSettings();
    cerberusVoiceNavigation.initAtlasVoiceNavigation(deps);

    const voiceMod = await import('./cerberusVoiceMode.js');
    const cerberusVoiceMode = voiceMod.default;
    cerberusVoiceMode.initAtlasVoiceMode({
      showToast: deps.showToast,
      openAssistant: deps.openAssistant,
    });
    window.cerberusVoiceMode = cerberusVoiceMode;

    if (deps.submitHomeChat) {
      const homeConvMod = await import('./cerberusHomeConversation.js');
      const cerberusHomeConversation = homeConvMod.default;
      cerberusHomeConversation.initAtlasHomeConversation({
        submitChat: deps.submitHomeChat,
        openFullAssistant: deps.openFullAssistant || (() => deps.openAssistant?.('', { submit: false })),
        showToast: deps.showToast,
        voiceService: cerberusVoiceService,
      });
      window.cerberusHomeConversation = cerberusHomeConversation;
    }

    this.refreshDesktopBridgeStatus();
    requestAnimationFrame(() => this.startGlobalVoice());
    setInterval(() => this.refreshDesktopBridgeStatus(), 30000);
  },

  onRouteChange(route) {
    const r = route || 'home';
    window.AtlasVoiceContext?.set?.({ currentRoute: r });
    this.updateHudMeta();
    window.AtlasVoiceActionsPanel?.refresh?.();
  },

  async refreshDesktopBridgeStatus() {
    try {
      const data = await fetch('/api/cerberus/desktop/status', { credentials: 'same-origin' }).then((r) => r.json());
      const ready = data.state === 'ready' || (data.enabled && data.bridge_ready);
      const avail = (data.available_apps || []).length;
      const total = data.app_count;
      _desktopBridgeLabel = ready && total != null
        ? `Desktop Ready ${avail}/${total}`
        : (data.label || data.message || 'Desktop Offline').replace('Desktop Control: ', 'Desktop ');
    } catch (_) {
      _desktopBridgeLabel = 'Desktop Offline';
    }
    this.updateHudMeta();
  },

  patchSettings(settings) {
    _settings = { ..._settings, ...settings };
    this.updateHudMeta();
  },

  updateHudMeta(settings) {
    if (settings) _settings = { ..._settings, ...settings };
    const passive = document.getElementById('cerberus-status-passive');
    const conv = document.getElementById('cerberus-status-conversation');
    const speak = document.getElementById('cerberus-status-speak');
    const bridge = document.getElementById('cerberus-status-bridge');
    const paused = window.cerberusHomeConversation?.isPaused?.();

    if (passive) {
      const on = !paused && _settings.passive_wake_enabled !== false;
      passive.textContent = `Passive Wake: ${on ? 'ON' : 'OFF'}`;
      passive.dataset.on = on ? 'true' : 'false';
      passive.disabled = false;
    }
    if (conv) {
      const on = !!_settings.conversation_mode_enabled && !paused;
      conv.textContent = `Conversation: ${on ? 'ON' : 'OFF'}`;
      conv.dataset.on = on ? 'true' : 'false';
    }
    if (speak) {
      const on = !!_settings.speak_replies;
      speak.textContent = `Speak: ${on ? 'ON' : 'OFF'}`;
      speak.dataset.on = on ? 'true' : 'false';
    }
    if (bridge) bridge.textContent = _desktopBridgeLabel;
  },

  setListeningLabel(label) {
    const el = document.getElementById('cerberus-status-listening');
    if (el) el.textContent = label ? `Listening: ${label.replace(/^Listening:?\s*/i, '')}` : 'Listening: …';
  },

  setLastCommand(cmd) {
    const el = document.getElementById('cerberus-status-last');
    if (el) el.textContent = cmd ? `Last: ${cmd}` : 'Last: —';
  },

  triggerWakeAnimation() {
    const bar = document.getElementById('cerberus-os-status-bar');
    const core = document.getElementById('cerberus-core');
    [bar, core].forEach((el) => {
      if (!el) return;
      el.classList.remove('cerberus-voice-wake-pulse');
      void el.offsetWidth;
      el.classList.add('cerberus-voice-wake-pulse');
    });
  },

  startGlobalVoice() {
    window.cerberusHomeConversation?.onGlobalVoiceStart?.()
      || window.cerberusVoiceMode?.startPassiveWakeListening?.();
    this.updateHudMeta(window.cerberusHomeConversation?.getVoiceSettings?.() || {});
  },
};

window.cerberusVoiceService = cerberusVoiceService;
export default cerberusVoiceService;
