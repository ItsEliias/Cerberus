"""Phone app (PWA) wiring and `tailscale serve` trust boundaries."""
import json
import re
from pathlib import Path
from types import SimpleNamespace

import importlib.util

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]

# Load the real module from its file: some other test files replace
# sys.modules["src.auth_helpers"] with a mock at collection time.
_spec = importlib.util.spec_from_file_location("_real_auth_helpers", ROOT / "src" / "auth_helpers.py")
_auth = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_auth)
PROXY_FORWARD_HEADERS = _auth.PROXY_FORWARD_HEADERS
is_direct_loopback = _auth.is_direct_loopback
require_user = _auth.require_user

STATIC = ROOT / "static"
APP_SRC = (ROOT / "app.py").read_text(encoding="utf-8")


def _req(host, headers=None, configured=False):
    return SimpleNamespace(
        client=SimpleNamespace(host=host),
        headers=headers or {},
        state=SimpleNamespace(),
        app=SimpleNamespace(state=SimpleNamespace(
            auth_manager=SimpleNamespace(is_configured=configured),
        )),
    )


def _png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


# ── Trust boundary ─────────────────────────────────────────────────────────

def test_direct_loopback_is_trusted():
    assert is_direct_loopback(_req("127.0.0.1"))
    assert is_direct_loopback(_req("::1"))


@pytest.mark.parametrize("header", ["Tailscale-User-Login", "X-Forwarded-For", "CF-Connecting-IP"])
def test_proxied_loopback_is_not_trusted(header):
    # tailscale serve / cloudflared connect from loopback; their headers mark
    # the request as remote.
    headers = {header.lower(): "x"}
    assert not is_direct_loopback(_req("127.0.0.1", headers))


def test_remote_host_is_not_trusted():
    assert not is_direct_loopback(_req("100.64.0.7"))


def test_unconfigured_first_run_rejects_tailnet_caller(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.delenv("LOCALHOST_BYPASS", raising=False)
    tailnet = _req("127.0.0.1", {"tailscale-user-login": "someone@example.com"})
    with pytest.raises(HTTPException) as exc:
        require_user(tailnet)
    assert exc.value.status_code == 401
    # A direct local caller still gets first-run access.
    assert require_user(_req("127.0.0.1")) == ""


def test_proxy_header_lists_agree():
    match = re.search(r"_PROXY_FWD_HEADERS = \((.*?)\)", APP_SRC, re.S)
    assert match is not None
    in_app = set(re.findall(r'"([a-z-]+)"', match.group(1)))
    assert in_app == set(PROXY_FORWARD_HEADERS)
    assert "tailscale-user-login" in in_app


# ── Service worker ─────────────────────────────────────────────────────────

def test_service_worker_route_is_root_scoped_and_public():
    assert '@app.get("/sw.js")' in APP_SRC
    assert '"Service-Worker-Allowed": "/"' in APP_SRC
    assert '"Cache-Control": "no-cache"' in APP_SRC
    assert '"/sw.js",' in APP_SRC.split("AUTH_EXEMPT_EXACT = {", 1)[1].split("}", 1)[0]


def test_index_registers_root_worker_and_drops_static_scope():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    assert "register('/sw.js',{scope:'/'})" in html
    assert "register('/static/sw.js'" not in html
    assert "pathname==='/static/')r.unregister()" in html


def test_service_worker_never_caches_api_or_login_redirect():
    src = (STATIC / "sw.js").read_text(encoding="utf-8")
    assert "url.pathname.startsWith('/api/')" in src
    assert "res.ok && !res.redirected" in src


# ── Manifest ───────────────────────────────────────────────────────────────

def test_manifest_has_separate_any_and_maskable_icons():
    manifest = json.loads((STATIC / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["display"] == "standalone"
    purposes = [icon["purpose"] for icon in manifest["icons"]]
    assert sorted(set(purposes)) == ["any", "maskable"]
    for icon in manifest["icons"]:
        path = STATIC / icon["src"].removeprefix("/static/")
        w, h = (int(n) for n in icon["sizes"].split("x"))
        assert _png_size(path) == (w, h), icon["src"]
