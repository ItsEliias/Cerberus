"""Guards for the Windows desktop lag/freeze fixes (v0.1.1 regression)."""
import asyncio
import sys
import threading

import pytest


def test_python_interpreter_never_returns_frozen_exe(monkeypatch):
    from core import platform_compat as pc
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", r"C:\Program Files\Cerberus\Cerberus.exe")
    monkeypatch.setattr(pc, "which_tool", lambda name: None)
    assert pc.python_interpreter() is None
    store_stub = r"C:\Users\x\AppData\Local\Microsoft\WindowsApps\python.exe"
    monkeypatch.setattr(pc, "which_tool", lambda name: store_stub)
    assert pc.python_interpreter() is None
    monkeypatch.setattr(pc, "which_tool", lambda name: r"C:\Python312\python.exe" if name == "python" else None)
    assert pc.python_interpreter() == r"C:\Python312\python.exe"


def test_frozen_desktop_refuses_interpreter_style_argv(monkeypatch):
    import desktop
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "argv", ["Cerberus.exe", "-I", "-c", "print(1)"])
    assert desktop._reject_interpreter_style_invocation() is True
    monkeypatch.setattr(sys, "argv", ["Cerberus.exe", "--smoke"])
    assert desktop._reject_interpreter_style_invocation() is False
    monkeypatch.setattr(sys, "argv", ["Cerberus.exe"])
    assert desktop._reject_interpreter_style_invocation() is False


def test_desktop_prefers_stable_port(monkeypatch):
    import desktop
    monkeypatch.delenv("CERBERUS_PORT", raising=False)
    port = desktop._pick_port()
    assert isinstance(port, int) and port > 0


def test_llmlingua_never_loads_model_on_event_loop(monkeypatch):
    import src.llmlingua_compressor as lc
    lc._reset_for_tests()
    monkeypatch.setattr(lc, "LLMLINGUA_ENABLED", True)
    loaded = threading.Event()
    load_thread = []

    def slow_load():
        load_thread.append(threading.current_thread().name)
        loaded.set()
        return None

    monkeypatch.setattr(lc, "_get_compressor", slow_load)
    text = "x" * 500

    async def run():
        return lc.compress_tool_output(text)

    assert asyncio.run(run()) == text
    assert loaded.wait(5)
    assert load_thread == ["llmlingua-load"], "cold load must happen off the loop thread"
    lc._reset_for_tests()


# ── Animations: lightweight in the desktop window, full everywhere else ──────

from pathlib import Path  # noqa: E402

_ROOT = Path(__file__).resolve().parents[1]


def _src(rel):
    return (_ROOT / rel).read_text(encoding="utf-8")


def test_desktop_window_announces_itself():
    assert '/login?shell=desktop' in _src("desktop.py")
    login = _src("static/login.html")
    assert "sessionStorage.setItem('cerberus-shell', 'desktop')" in login
    index = _src("static/index.html")
    assert "document.documentElement.classList.add('shell-desktop')" in index
    # Auth-off /login redirect keeps the marker.
    assert 'url="/" + (f"?{query}" if query else "")' in _src("app.py")


def test_dashboard_glow_animates_outside_desktop_shell():
    js = _src("static/js/dashboard.js")
    body = js.split("function _startBgAnimation()", 1)[1].split("\n}\n", 1)[0]
    assert "classList.contains('shell-desktop')" in body
    assert "if (!animate) { draw(performance.now()); return; }" in body
    assert "_rafId = requestAnimationFrame(frame)" in body
    assert "Math.sin(t + phase)" in body
    assert "prefers-reduced-motion" in body  # still honoured


def test_cc_crit_dial_full_glow_except_desktop():
    css = _src("static/js/cyberapps/command-center/styles.css")
    full = css.split("@keyframes cc-dial-pulse-crit {", 1)[1].split("}", 2)
    assert "drop-shadow" in "".join(full[:2])
    assert "html.shell-desktop .cc-arc-fill.crit" in css
    assert "animation-name: cc-dial-pulse-crit-lite" in css
    assert "classList.add('shell-desktop')" in _src("static/js/cyberapps/command-center/index.js")
