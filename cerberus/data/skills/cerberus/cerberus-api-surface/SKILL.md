---
name: cerberus-api-surface
description: Key Cerberus API endpoints — paths, methods, auth requirements, and request/response shapes
version: 1.0.0
category: cerberus
tags: [api, endpoints, cerberus, reference]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

When calling Cerberus APIs from agents, scripts, or the gateway — to verify the correct path, method, and payload shape without reading source.

## Procedure

All endpoints require the `cerberus_session` cookie (set by `POST /api/auth/login`). Base URL: `http://localhost:7000`.

**Auth**
| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/auth/login` | Body: `{username, password}`; sets `cerberus_session` cookie |

**Agents**
| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/agents` | List all agents for the authed owner |
| `PATCH` | `/api/agents/{id}` | Update agent fields (name, system_prompt, tts_voice, etc.) |
| `POST` | `/api/agents/{id}/thread/send` | SSE stream; body: `{message}`; returns `event:delta` + `[DONE]` |
| `GET` | `/api/agents/{id}/thread` | Full thread history: `{messages[], context_window}` |
| `DELETE` | `/api/agents/{id}/thread` | Clear thread |

**TTS / STT**
| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/tts/synthesize` | Body: `{text, format: "base64" \| "wav", voice?}`; returns `{audio_base64}` |
| `GET` | `/api/tts/voices` | Returns list of available Kokoro voice objects |
| `GET` | `/api/tts/stats` | Returns `{provider, available, model, voice, cache_entries}` |
| `POST` | `/api/stt/transcribe` | Multipart form: `file` (audio blob); returns `{text}` |
| `GET` | `/api/stt/stats` | Returns `{provider, available}` |

**Conference Rooms**
| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/rooms` | List all rooms for owner |
| `POST` | `/api/rooms` | Body: `{name, agent_ids[]}`; create new room |
| `DELETE` | `/api/rooms/{id}` | Delete room |
| `POST` | `/api/rooms/{id}/send` | SSE stream; body: `{message}`; multi-agent council reply |

**System**
| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | Liveness check; returns `{status: "ok"}` |
| `GET` | `/api/diagnostics/services` | Service health + latency for all integrations |
