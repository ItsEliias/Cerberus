# COUNCIL Phase E3 — Voice Call View Report

## Call Flow Diagram

```
User holds [ HOLD TO SPEAK ] (mouse/touch) or spacebar
  │
  ▼
_startRecordingPhase(ctx)
  │  clears #message
  │  sets state → recording
  │  waveform → recording (animated accent wave)
  │  button → "[ RELEASE TO SEND ]"
  │  voiceRecorder.startRecording(null, null, onError)
  │
User releases button / spacebar
  │
  ▼
_endRecordingPhase(ctx)
  │  voiceRecorder.stopRecording()
  │  → voiceRecorder writes transcript into #message (browser STT or server Whisper)
  │
  ▼
_captureTranscript()  [polls #message every 120ms, max 3000ms]
  │  captures text, clears #message so main chat isn't polluted
  │
  ▼
Append user bubble to transcript pane
  │
  ▼
state → speaking
waveform → speaking (lighter tinted wave)
  │
  ▼
_sendToAgent(agentId, transcript, agentBubble, list)
  │  POST /api/agents/{id}/messages  { content: transcript }
  │  SSE stream → delta chunks → agentBubble.textContent updated live
  │  returns fullReply string
  │
  ▼
window.aiTTSManager.play(fullReply)   [always-on in call mode]
  │  waits for TTS end (onEnd callback or 70ms/char estimate)
  │
  ▼
state → idle
waveform → idle (static hairline)
button → "[ HOLD TO SPEAK ]" re-enabled
```

## TTS / Voice Wiring

| Component | Source |
|-----------|--------|
| Voice input | `static/js/voiceRecorder.js` — `startRecording` / `stopRecording` (existing module, unmodified) |
| Transcript capture | Polls `document.getElementById('message')` for changes after stop; clears input after capture |
| Agent reply stream | `POST /api/agents/{id}/messages` SSE (E2 endpoint, reused) |
| TTS playback | `window.aiTTSManager.play(text)` — always on; wait via `onEnd` callback or content-length estimate |
| Waveform | Inline SVG with three path elements toggled by state; CSS keyframe animations via `@keyframes cc-wf-rec-wave` and `cc-wf-spk-wave` |

## Files Touched

| File | Change |
|------|--------|
| `static/js/cyberapps/command-center/council-call-view.js` | **New** — `openCallView(root, agent)` + `closeCallView(root)` (435 lines) |
| `static/js/cyberapps/command-center/styles-e3.css` | **New** — full call overlay stylesheet, all theme-reactive, `prefers-reduced-motion` respected (270 lines) |
| `static/js/cyberapps/command-center/council.js` | Import `openCallView`; replace "Coming soon" toast with `openCallView(root, member)` |
| `static/js/cyberapps/command-center/styles.css` | Added `@import './styles-e3.css'` after E2 import |
| `static/sw.js` | Bumped `CACHE_NAME` from `cerberus-v355-council-e2` → `cerberus-v356-council-e3` |

## Reused Modules

- `voiceRecorder.js` — `startRecording` / `stopRecording` (existing, no modifications)
- `council-glyphs.js` — `getGlyph(name)` for 192×192 portrait
- `council-message-drawer.js` bubble style classes (`cc-msg-bubble-*`) referenced as design baseline; E3 uses `cc-call-bubble-*` parallels in styles-e3.css
- `/api/agents/{id}/messages` POST + SSE — E2 endpoint, zero changes to backend

## Smoke Test Results

1. `docker compose up -d --build --force-recreate cerberus` — container built and started successfully
2. `GET /static/js/cyberapps/command-center/council-call-view.js` → HTTP 200
3. `GET /static/js/cyberapps/command-center/styles-e3.css` → HTTP 200
4. `GET /static/sw.js` confirms `cerberus-v356-council-e3`
5. `GET /static/js/cyberapps/command-center/council.js` confirms `openCallView` import and call-action handler

## Branch + Commits

- **Branch**: `design/jarvis-cerberus-skilled`
- **Commit 1 (feature)**: `aa838bb` — `feat(council): voice call view per agent — push-to-talk + waveform + TTS playback`
- **Commit 2 (SW bump)**: `c22d1b2` — `chore(sw): bump cache to v356-council-e3`
- **Author**: ItsEliias <itseliiasstudy@gmail.com> (no Co-Authored-By trailer)

## Push Confirmation

```
To https://github.com/ItsEliias/Cerberus.git
   2f405f1..c22d1b2  design/jarvis-cerberus-skilled -> design/jarvis-cerberus-skilled
```

## Phase E3 Acceptance Checklist

- [x] CALL button on each card opens a full-screen call view
- [x] Push-to-talk via mouse hold OR spacebar
- [x] User voice transcribed, sent to agent endpoint, agent streams + speaks back
- [x] Waveform reflects state (idle / recording / speaking)
- [x] Call exchange persists in agent conversation history (via reused /messages endpoint)
- [x] Theme-reactive: `var(--cc-accent)` / `rgba(var(--cc-accent-rgb), X)` throughout
- [x] `prefers-reduced-motion` respected — waveform static, animations disabled
- [x] Esc closes the overlay
- [x] Mic unavailable → inline error in call view
- [x] TTS error → logs + skips speech, text still shown
- [x] Demo agents handled gracefully (backend returns error, shown in bubble)
- [x] SW cache bumped to `cerberus-v356-council-e3`
- [x] No new API endpoints introduced
- [x] Files under 500 lines
- [x] No CDN, no Co-Authored-By trailer
