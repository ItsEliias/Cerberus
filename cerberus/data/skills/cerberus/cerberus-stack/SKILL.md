---
name: cerberus-stack
description: Cerberus technology stack reference — runtimes, frameworks, infrastructure, and LLM endpoints
version: 1.1.0
category: cerberus
tags: [stack, architecture, infrastructure, reference]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

When making implementation decisions that depend on available libraries, execution environment, or infrastructure constraints.

## Procedure

Reference the canonical stack before proposing a solution:

**Backend**
- Runtime: Python 3.11, FastAPI, SQLAlchemy 2.x, Pydantic v2
- Database: SQLite (`data/app.db`); no ORM migrations — schema managed via `Base.metadata.create_all`
- Auth: cookie-based (`cerberus_session`); `src/auth_helpers.py` for owner scoping
- Execution sandbox: OpenSandbox (Docker, `code-interpreter` image, CPU-only on Mac)
- AI connectivity: Odysseus backbone; endpoint resolver via `src/endpoint_resolver.py`
- Default LLM: Groq `llama-3.3-70b-versatile` (fast, free tier)
- Local LLM: Ollama at `http://host.docker.internal:11434` (Mac host bridge)
- External connectivity: Hermes agent (mail, calendar, webhooks)
- Search: SearXNG (self-hosted)
- Vector store: ChromaDB

**Frontend**
- Shell: Claude Code iframe (`/cc` route); served at `http://localhost:7000`
- Static assets: vanilla JS + Vite build under `cerberus/static/`
- No CDN dependencies; all assets must be bundled or served locally
- Remote access: Tailscale (owner only)

**Docker Compose services**
| Container | Role |
|-----------|------|
| `cerberus-cerberus-1` | Main FastAPI app (port 7000) |
| `cerberus-cerberus-gateway-1` | Hermes gateway (mail/calendar/webhooks) |
| `cerberus-search` | SearXNG |
| `cerberus-vectors` | ChromaDB |
| `cerberus-notifications` | Push notification relay |

**Hard constraints**
- No external package CDN at runtime (`<script src="https://...">` is forbidden)
- No hardcoded credentials anywhere in source
- No host-side shell execution from agent code paths
- Docker images are CPU-only; no CUDA/GPU assumptions
- `-webkit-appearance: none; appearance: none` required on all custom form elements (WebKit Safari compat)
