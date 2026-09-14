"""
Cerberus desktop launcher — a native Windows/macOS/Linux program, not a browser tab.

Boots the FastAPI app in-process on a random loopback port (uvicorn in a daemon
thread), waits for /api/health, then opens it in a native OS webview window
(WebView2 on Windows, WebKit on macOS, GTK on Linux). The server is bound to
127.0.0.1 on a random port and dies with the window — nothing is exposed on a
fixed, browsable port.

Run (dev):   python desktop.py
Package:     pyinstaller cerberus.spec      → dist/Cerberus(.exe/.app)

Config precedence (highest first):
  1. process environment (e.g. set by an installer or the shell)
  2. <user-data-dir>/desktop_settings.json  (written by the in-app settings UI)
  3. built-in defaults

Docker-backed features (OpenSandbox code execution, chromadb vectors, searxng
search) stay OFF unless enabled in desktop_settings.json — the sandbox module
reads its endpoint config at import time, so this file must populate os.environ
*before* importing app. Changing these settings therefore takes effect on the
next launch (the settings UI surfaces a "restart to apply" note).
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path

APP_NAME = "Cerberus"

# ── Sandbox / Docker keys we bridge from desktop_settings.json into the env ──
# Only these are honored from the settings file, and only when the value is not
# already present in the process environment (env wins, so an installer or an
# operator can always override the persisted UI choice).
_SANDBOX_ENV_KEYS = (
    "CERBERUS_SANDBOX_ENABLED",
    "SANDBOX_URL",
    "SANDBOX_API_KEY",
    "SANDBOX_IMAGE",
    "SANDBOX_TIMEOUT",
    "SANDBOX_EGRESS_ALLOWLIST",
    "SEARCH_SEARXNG_INSTANCE",   # searxng (SearchConfig env_prefix=SEARCH_)
    "CHROMA_URL",                # vector store, when enabled
)


def _is_frozen() -> bool:
    """True when running from a PyInstaller bundle."""
    return getattr(sys, "frozen", False)


def _bundle_dir() -> Path:
    """Directory the app resources live in (the bundle when frozen, else here)."""
    if _is_frozen():
        # PyInstaller unpacks datas next to the executable / into _MEIPASS.
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def _user_data_dir() -> Path:
    """
    Per-user writable data directory. A packaged app installs under a read-only
    location (Program Files / Applications), so all persisted state must live
    here instead of next to the executable.
    """
    if os.name == "nt":
        base = os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _apply_persisted_env(data_dir: Path) -> None:
    """Load desktop_settings.json and export sandbox/Docker keys to os.environ.

    Existing environment variables always win, so this only fills gaps. Must run
    before `import app` so the sandbox module picks the values up at import time.
    """
    settings_path = data_dir / "desktop_settings.json"
    try:
        raw = settings_path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return
    except OSError as exc:
        print(f"[{APP_NAME}] could not read {settings_path}: {exc}", file=sys.stderr)
        return
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        print(f"[{APP_NAME}] ignoring malformed {settings_path}: {exc}", file=sys.stderr)
        return
    if not isinstance(data, dict):
        return
    for key in _SANDBOX_ENV_KEYS:
        if key in data and data[key] is not None and key not in os.environ:
            os.environ[key] = str(data[key])


def _free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()


def _serve(port: int) -> None:
    import uvicorn
    # Import the app *object* (not the "app:app" import string). Two reasons:
    #  1. String-target uvicorn re-imports "app" by name, which fails inside a
    #     PyInstaller bundle; passing the object sidesteps that.
    #  2. A real `from app import app` here puts app.py (and its transitive
    #     route/service imports) into PyInstaller's dependency graph so they get
    #     bundled — a string target is invisible to static analysis.
    # Imported here (not at module top) so main()'s pre-import env setup has
    # already run before app.py — and, transitively, the sandbox module — read
    # their configuration.
    from app import app as fastapi_app
    uvicorn.run(
        fastapi_app,
        host="127.0.0.1",
        port=port,
        log_level=os.environ.get("CERBERUS_LOG_LEVEL", "warning"),
    )


def _wait_ready(port: int, timeout_s: float = 90.0) -> bool:
    """Poll /api/health until the server answers or we give up."""
    url = f"http://127.0.0.1:{port}/api/health"
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status < 500:
                    return True
        except urllib.error.HTTPError as exc:
            # Any HTTP response (even 401/403/404) means the server is up.
            if exc.code < 500:
                return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def main() -> int:
    # 1. Redirect all persisted state to a per-user writable dir (unless the
    #    caller already pinned one). Must precede any import that reads DATA_DIR.
    #    Ensure the target exists — the SQLite DB is sqlite:///{DATA_DIR}/app.db
    #    and its engine connects at import time, so the directory must be there.
    data_dir = _user_data_dir()
    os.environ.setdefault("CERBERUS_DATA_DIR", str(data_dir))
    try:
        data_dir = Path(os.environ["CERBERUS_DATA_DIR"])
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"[{APP_NAME}] cannot create data dir {data_dir}: {exc}", file=sys.stderr)
        return 1

    # 2. When frozen, run from the bundle dir so relative static/template paths
    #    resolve against the unpacked resources.
    if _is_frozen():
        try:
            os.chdir(_bundle_dir())
        except OSError:
            pass

    # 3. Bridge persisted sandbox/Docker settings into the environment BEFORE
    #    importing the app (sandbox config is read at import time).
    _apply_persisted_env(data_dir)

    # 4. Boot the server on a private loopback port.
    port = int(os.environ.get("CERBERUS_PORT", "0")) or _free_port()
    threading.Thread(target=_serve, args=(port,), daemon=True).start()

    if not _wait_ready(port):
        print(f"[{APP_NAME}] server did not become ready — aborting", file=sys.stderr)
        return 1

    # Smoke mode: CI (and `--smoke`) verify the frozen bundle can boot the server
    # and answer /api/health, then exit — no display or webview runtime needed.
    if os.environ.get("CERBERUS_DESKTOP_SMOKE") == "1" or "--smoke" in sys.argv:
        print(f"[{APP_NAME}] smoke OK — server healthy on 127.0.0.1:{port}")
        return 0

    # 5. Open the native window. Imported late so headless CI (which only builds
    #    the bundle) never needs a display or the webview runtime present.
    try:
        import webview
    except ImportError:
        # No webview runtime (e.g. a headless smoke check) — fall back to the
        # default browser so the launcher is still useful.
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:{port}/")
        print(f"[{APP_NAME}] pywebview unavailable; opened in default browser.")
        # Keep the daemon server thread alive until interrupted.
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    # Window icon: the build step renders these from docs/cerberus.jpg into
    # desktop_assets/. Fall back to None (default icon) if unavailable.
    bundle = _bundle_dir()
    icon = None
    for candidate in ("desktop_assets/cerberus.png", "docs/cerberus.jpg"):
        p = bundle / candidate
        if p.exists():
            icon = str(p)
            break
    window_kwargs = dict(width=1440, height=920, min_size=(1024, 680))
    webview.create_window(APP_NAME, f"http://127.0.0.1:{port}/", **window_kwargs)
    # gui is auto-detected (edgechromium on Windows). Blocks until window closes.
    webview.start(icon=icon)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
