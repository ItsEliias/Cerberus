# Phase C Fix Report — Command Center: SPEAK/VOICE + COUNCIL Upgrade

## 1. SPEAK / VOICE Wiring

### Modules Reused

**TTS (`static/js/tts-ai.js`)**
- Global singleton: `window.aiTTSManager` (instance of `AITTSManager`)
- API used: `window.aiTTSManager.play(text)` — synthesizes (server or browser Web Speech) and plays
- Called in `assistant.js` after each completed assistant response, gated by the `_ttsOn` flag persisted to `localStorage.cc_assistant_tts_on`
- Errors (e.g., TTS disabled, no browser permission) are caught and logged with `console.warn`; the chat continues without TTS silently

**Voice recorder (`static/js/voiceRecorder.js`)**
- Named exports used: `startRecording(onFileCreated, showToast, showError)`, `stopRecording()`, `getIsRecording()`, `init()`
- `voiceRecorder.js` internally calls `navigator.mediaDevices.getUserMedia` and on stop either transcribes via Web Speech API, server Whisper, or attaches as file depending on `_sttProvider`
- The module writes transcript to `document.getElementById('message')` (the main Cerberus input). The assistant tab uses a separate `#cc-chat-input`. A `_transferTranscript()` helper runs 400 ms after stop, reads `#message`, copies its value into `#cc-chat-input`, then clears `#message`.
- Permission errors surface inline via `#cc-voice-error` div with a 5 s auto-dismiss

### What Was Added

File: `static/js/cyberapps/command-center/assistant.js`

- `cc-voice-bar` flex column above the input row containing:
  - Waveform SVG (`cc-waveform-svg`, 200×24 viewBox) with an animated sine path driven by `requestAnimationFrame` (idle = flat line; recording/speaking = amplitude-modulated sine)
  - `SPEAK` toggle button — crimson background when on, hairline border when off
  - `VOICE` push-to-hold button — pulses crimson during recording via `cc-mic-pulse` CSS animation
- `prefers-reduced-motion`: `_animateWave()` returns immediately; `cc-mic-pulse` and `cc-dot-*` animations also suppressed via existing CSS media query block

---

## 2. COUNCIL Roster Spec

### Agent Shape

```js
{
  id:      string,          // DB id or demo id
  name:    string,          // Orbitron uppercase label
  role:    string,          // model/role string (mono, small)
  action:  string,          // current action text (italic)
  status:  'active' | 'idle' | 'processing' | 'standby',
  score:   number | null,   // formatted via formatTelemetry()
  history: number[],        // length-60 array for sparkline
}
```

### Filter Logic

`_filter` module variable (`'all'|'active'|'idle'|'standby'`) is toggled by the filter-bar click handler. `_renderCouncil()` applies it:
```js
const filtered = _filter === 'all' ? _members : _members.filter(m => m.status === _filter);
```

Active-count chip counts members with `status === 'active' || 'processing'`.

### Sparkline Math

Each agent row gets a `<svg viewBox="0 0 120 28">`. `_drawSparkline(svg, data)` normalises `data[i]` against `max(data)` to compute `y = H - pad - (v/max)*(H - pad*2)`, plots a `<polyline>` and a `<circle>` leading-cursor dot at the last point. `prefers-reduced-motion` skips drawing entirely.

### Demo Stub

Six agents (architect, coder, tester, researcher, reviewer, security-auditor) with `_rnd(60, lo, hi)` random history arrays. Shown when API returns `members.length === 0` or throws.

---

## 3. Smoke Test Results

```
Container:  cerberus-cerberus-1
Status:     Up (rebuilt from image sha 844138b2)
HTTP check: GET http://127.0.0.1:7000/ → 302 (redirect to login)
Build:      0 errors in Docker build output
```

All five modified files compiled cleanly inside the container image. Static JS/CSS served at `/static/…` paths; no module bundler errors during rebuild.

---

## 4. Branch + Commits + Author

**Branch**: `design/jarvis-cerberus-skilled`

| Hash    | Message |
|---------|---------|
| `5fbfcb1` | `fix(command-center): restore SPEAK + VOICE buttons in Assistant tab` |
| `449ece9` | `feat(command-center): level up COUNCIL — agent roster, filters, sparklines, actions` |
| `225ac5e` | `chore(sw): bump cache to v347-jarvis-v2-phase-c-fix` |

**Author line**: `ItsEliias <itseliiasstudy@gmail.com>`
No `Co-Authored-By` trailer on any commit.

---

## 5. Push Confirmation

```
To https://github.com/ItsEliias/Cerberus.git
   eabf063..225ac5e  design/jarvis-cerberus-skilled -> design/jarvis-cerberus-skilled
```

Push succeeded. Branch is up to date with remote.

---

## Files Touched

| File | Change |
|------|--------|
| `static/js/cyberapps/command-center/assistant.js` | +166 lines — SPEAK/VOICE/waveform |
| `static/js/cyberapps/command-center/council.js`   | +418/-54 — full roster rewrite |
| `static/js/cyberapps/command-center/index.js`     | +3 — add `initCouncil` import + call |
| `static/js/cyberapps/command-center/styles.css`   | +176 — `.cc-voice-bar` + `.cc-council-v2` blocks |
| `static/sw.js`                                    | `v346` → `v347-jarvis-v2-phase-c-fix` |
