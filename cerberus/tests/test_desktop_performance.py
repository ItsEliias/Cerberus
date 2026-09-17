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
