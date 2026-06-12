"""
routes/cyberapps_terminallink_routes.py

TerminalLink — Python PTY WebSocket bridge native to Cerberus.

Security gate: the WebSocket handler validates the Cerberus session cookie
directly from the WS cookie jar BEFORE PtyProcess.spawn().  Starlette's
BaseHTTPMiddleware does NOT run for WebSocket upgrade requests, so
request.state.current_user is never set for WS connections.  We therefore
read and validate the cerberus_session cookie ourselves against the
app-level auth_manager.

PTY management:
  - ptyprocess.PtyProcess.spawn() launches the user's shell (TERMINALLINK_DEFAULT_SHELL
    env var, or SHELL env var, fallback to /bin/sh — always present).
  - Active PTYs are tracked in a module-level dict keyed by WebSocket id.
  - Resize control messages: {"type":"resize","cols":N,"rows":M}
  - On disconnect/error: pty.terminate() is called to prevent orphans.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from src.auth_helpers import get_current_user

logger = logging.getLogger(__name__)

# PTY tracking — keyed by id(websocket) to survive reconnects
_active_ptys: Dict[int, object] = {}

# Shell resolution: operator sets TERMINALLINK_DEFAULT_SHELL to override.
# Fallback chain: env SHELL → /bin/bash → /bin/sh (always present).
_DEFAULT_SHELL = (
    os.environ.get("TERMINALLINK_DEFAULT_SHELL")
    or os.environ.get("SHELL")
    or ("/bin/bash" if os.path.exists("/bin/bash") else "/bin/sh")
)
_DEFAULT_COLS = 80
_DEFAULT_ROWS = 24

# Cookie name must match app.py / auth_routes.py SESSION_COOKIE constant.
_SESSION_COOKIE = "cerberus_session"


def setup_cyberapps_terminallink_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/terminallink", tags=["cyberapps-terminallink"])

    @router.websocket("/ws")
    async def terminallink_ws(websocket: WebSocket):
        """WebSocket PTY bridge — session-cookie auth gate BEFORE pty.spawn().

        NOTE: Starlette BaseHTTPMiddleware does not dispatch for WebSocket
        upgrade requests, so request.state.current_user is never populated.
        Auth is performed by reading cerberus_session directly from the WS
        cookie jar and validating against app.state.auth_manager.
        """
        try:
            from ptyprocess import PtyProcess  # type: ignore[import]
        except ImportError:
            await websocket.close(code=1011, reason="ptyprocess not installed")
            return

        user = _get_ws_user(websocket)
        if not user:
            await websocket.close(code=4401, reason="Unauthorized")
            return

        await websocket.accept()
        ws_id = id(websocket)
        pty_proc: object | None = None

        try:
            try:
                pty_proc = await asyncio.to_thread(
                    _spawn_pty, _DEFAULT_COLS, _DEFAULT_ROWS
                )
            except Exception as spawn_err:
                err_msg = str(spawn_err)
                if "ptmx" in err_msg.lower() or "permission" in err_msg.lower():
                    reason = "PTY permission denied — container missing tty group"
                elif "not found" in err_msg.lower() or "no such file" in err_msg.lower():
                    reason = f"Shell not found: {_DEFAULT_SHELL}"
                else:
                    reason = f"PTY spawn failed: {err_msg}"
                logger.error("[terminallink] spawn failed: %s", spawn_err)
                await websocket.send_text(
                    '{"type":"error","message":' + _json_str(reason) + '}'
                )
                await websocket.close(1011)
                return

            _active_ptys[ws_id] = pty_proc

            # Send ready signal
            await websocket.send_text('{"type":"ready"}')

            # Bidirectional bridge
            pty_reader_task = asyncio.create_task(
                _pty_to_ws(pty_proc, websocket)
            )

            try:
                while True:
                    raw = await websocket.receive_text()
                    await _handle_ws_message(raw, pty_proc)
            except WebSocketDisconnect:
                pass
            finally:
                pty_reader_task.cancel()
                try:
                    await pty_reader_task
                except (asyncio.CancelledError, Exception):
                    pass

        except Exception as exc:
            logger.error("[terminallink] ws error: %s", exc)
        finally:
            _cleanup_pty(ws_id)
            if websocket.client_state == WebSocketState.CONNECTED:
                try:
                    await websocket.close(1000)
                except Exception:
                    pass

    return router


def _json_str(s: str) -> str:
    """Return a JSON-encoded string literal for inline embedding."""
    import json
    return json.dumps(s)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _WsRequestAdapter:
    """Duck-typed adapter so get_current_user(request) works on a WebSocket."""

    def __init__(self, ws: WebSocket) -> None:
        self.state = getattr(ws, "state", _EmptyState())
        self.cookies = ws.cookies
        self.headers = ws.headers
        self.client = ws.client
        self.app = ws.app


class _EmptyState:
    pass


def _get_ws_user(ws: WebSocket) -> str | None:
    """Return authenticated username for a WebSocket connection, or None.

    Starlette's BaseHTTPMiddleware skips WebSocket upgrade requests, so
    ws.state.current_user is never stamped.  We validate the session cookie
    directly against app.state.auth_manager — the same path the HTTP
    middleware takes but inlined here for the WS fast path.

    Falls back to AUTH_ENABLED=false (single-user / dev) pass-through.
    """
    import os

    # Fast path: middleware DID run (e.g. future ASGI middleware migration)
    user = getattr(ws.state, "current_user", None)
    if user:
        return user

    # AUTH_ENABLED=false — operator explicitly disabled auth
    if os.getenv("AUTH_ENABLED", "true").lower() == "false":
        return "_anon"

    # Validate session cookie directly against auth_manager
    auth_mgr = getattr(ws.app.state, "auth_manager", None)
    if auth_mgr is None:
        # App not fully initialised (rare) — fallback to adapter path
        adapter = _WsRequestAdapter(ws)
        return get_current_user(adapter)  # type: ignore[arg-type]

    if not getattr(auth_mgr, "is_configured", False):
        # First-run / unconfigured: allow loopback only
        client_host = ws.client.host if ws.client else None
        if client_host in ("127.0.0.1", "::1"):
            return "_anon"
        return None

    token = ws.cookies.get(_SESSION_COOKIE)
    if not token:
        return None
    if not auth_mgr.validate_token(token):
        return None
    return auth_mgr.get_username_for_token(token) or "_session"


def _spawn_pty(cols: int, rows: int) -> object:
    """Spawn /bin/bash (or $SHELL) as a PTY.  Runs in a thread pool."""
    from ptyprocess import PtyProcess  # type: ignore[import]

    env = {**os.environ, "TERM": "xterm-256color", "COLORTERM": "truecolor"}
    proc = PtyProcess.spawn(
        [_DEFAULT_SHELL],
        dimensions=(rows, cols),
        env=env,
    )
    return proc


async def _pty_to_ws(pty_proc: object, ws: WebSocket) -> None:
    """Read PTY output and forward to the WebSocket (runs in task)."""
    loop = asyncio.get_running_loop()
    try:
        while True:
            data: bytes = await loop.run_in_executor(None, pty_proc.read, 1024)  # type: ignore[attr-defined]
            if not data:
                break
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_bytes(data)
    except EOFError:
        # PTY exited cleanly
        if ws.client_state == WebSocketState.CONNECTED:
            try:
                await ws.send_text('{"type":"exit"}')
            except Exception:
                pass
    except Exception as exc:
        logger.debug("[terminallink] pty_to_ws ended: %s", exc)


async def _handle_ws_message(raw: str, pty_proc: object) -> None:
    """Route a message from the browser to the PTY."""
    import json

    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        # Not JSON — treat as raw keystroke data
        await asyncio.to_thread(pty_proc.write, raw.encode())  # type: ignore[attr-defined]
        return

    if msg.get("type") == "resize":
        cols = int(msg.get("cols") or _DEFAULT_COLS)
        rows = int(msg.get("rows") or _DEFAULT_ROWS)
        await asyncio.to_thread(pty_proc.setwinsize, rows, cols)  # type: ignore[attr-defined]
        return

    # Fallback: forward JSON as raw input (covers typed characters sent as JSON)
    await asyncio.to_thread(pty_proc.write, raw.encode())  # type: ignore[attr-defined]


def _cleanup_pty(ws_id: int) -> None:
    """Terminate and remove the PTY for the given WebSocket id."""
    proc = _active_ptys.pop(ws_id, None)
    if proc is not None:
        try:
            proc.terminate(force=True)  # type: ignore[attr-defined]
        except Exception:
            pass
