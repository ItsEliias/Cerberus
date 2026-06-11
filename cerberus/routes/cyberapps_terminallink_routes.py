"""
routes/cyberapps_terminallink_routes.py

TerminalLink — Python PTY WebSocket bridge native to Cerberus.

Security gate: the WebSocket handler validates the Cerberus session cookie
via get_current_user() BEFORE PtyProcess.spawn().  Unauthenticated upgrades
are closed with code 4401 — no PTY is ever spawned for unauthed clients.

PTY management:
  - ptyprocess.PtyProcess.spawn() launches /bin/bash as the container user.
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

_DEFAULT_SHELL = os.environ.get("SHELL", "/bin/bash")
_DEFAULT_COLS = 80
_DEFAULT_ROWS = 24


def setup_cyberapps_terminallink_routes() -> APIRouter:
    router = APIRouter(prefix="/api/cyberapps/terminallink", tags=["cyberapps-terminallink"])

    @router.websocket("/ws")
    async def terminallink_ws(websocket: WebSocket):
        """WebSocket PTY bridge — session-cookie auth gate BEFORE pty.spawn()."""
        try:
            from ptyprocess import PtyProcess  # type: ignore[import]
        except ImportError:
            await websocket.close(code=1011, reason="ptyprocess not installed")
            return

        # Validate session cookie BEFORE accepting the WebSocket upgrade.
        # WebSocket objects expose cookies via websocket.cookies (Starlette).
        # The auth middleware runs on HTTP upgrade so request.state.current_user
        # is available — but WebSocket handlers receive a WebSocket, not Request.
        # We build a minimal duck-typed request wrapper so get_current_user works.
        user = _get_ws_user(websocket)
        if not user:
            # Reject before any PTY resource is touched
            await websocket.close(code=4401, reason="Unauthorized")
            return

        await websocket.accept()
        ws_id = id(websocket)
        pty_proc: object | None = None

        try:
            pty_proc = await asyncio.to_thread(
                _spawn_pty, _DEFAULT_COLS, _DEFAULT_ROWS
            )
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
    """Return authenticated username for a WebSocket connection, or None."""
    adapter = _WsRequestAdapter(ws)
    # Try middleware-stamped state first (present when auth middleware ran)
    user = getattr(ws.state, "current_user", None)
    if user:
        return user
    # Fall back to auth_helpers which reads cookies / state
    return get_current_user(adapter)  # type: ignore[arg-type]


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
