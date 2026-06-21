"""MarkItDown document-import integration tests.

Covers:
 - converter helpers (is_supported, is_youtube_url)
 - the new POST /api/documents/import endpoint
 - the new POST /api/documents/import-url endpoint

Route handlers are invoked directly (the pattern used elsewhere in this
suite — see test_document_session_owner_scope.py). MarkItDown itself is
stubbed via monkeypatch so the tests don't need the upstream package
installed in the dev/CI env.
"""

import importlib.util
import io
import sys
import tempfile
import types
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from tests.helpers.import_state import clear_fake_database_modules

clear_fake_database_modules()

# Pre-register services / services.docs as lightweight namespace packages
# BEFORE the route handler imports services.docs.markitdown_converter.
# The real services/__init__.py eagerly pulls DocsService → rag_vector →
# numpy, none of which this test needs. Inserting an empty package shell
# satisfies the dotted import without triggering the heavy __init__.py.
_REPO = Path(__file__).resolve().parent.parent
for _pkg, _path in (
    ("services", _REPO / "services"),
    ("services.docs", _REPO / "services" / "docs"),
):
    if _pkg not in sys.modules:
        _m = types.ModuleType(_pkg)
        _m.__path__ = [str(_path)]
        sys.modules[_pkg] = _m
# Wire parent.child attributes so monkeypatch.setattr can walk the dotted
# path "services.docs.markitdown_converter.<attr>" (the resolver uses
# getattr, not sys.modules lookups, for the intermediate parents).
sys.modules["services"].docs = sys.modules["services.docs"]

_md_path = _REPO / "services" / "docs" / "markitdown_converter.py"
_spec = importlib.util.spec_from_file_location(
    "services.docs.markitdown_converter", _md_path,
)
mdc = importlib.util.module_from_spec(_spec)
sys.modules["services.docs.markitdown_converter"] = mdc
_spec.loader.exec_module(mdc)
sys.modules["services.docs"].markitdown_converter = mdc

import core.database as cdb
import routes.document_routes as droutes
from core.database import Document
from core.database import Session as DbSession
from routes.document_routes import _ImportURLBody


_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)


# ── shared test-rig helpers ──────────────────────────────────────────────

def _req(user="alice"):
    """Minimal Request stand-in. require_privilege walks request.app.state
    for an auth_manager; we leave it absent so the no-auth fall-through
    in require_privilege returns the user as-is."""
    app  = SimpleNamespace(state=SimpleNamespace(auth_manager=None))
    state = SimpleNamespace(current_user=user, api_token=False)
    client = SimpleNamespace(host="127.0.0.1")
    return SimpleNamespace(state=state, app=app, client=client)


def _endpoint(method, path):
    router = droutes.setup_document_routes(MagicMock(), None)
    for route in router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise RuntimeError(f"{method} {path} not found")


def _bind_test_db():
    previous = droutes.SessionLocal
    droutes.SessionLocal = _TS
    return previous


def _upload(name: str, data: bytes) -> UploadFile:
    return UploadFile(filename=name, file=io.BytesIO(data))


# ── 1. converter helpers ─────────────────────────────────────────────────

def test_is_supported_recognises_office_formats_and_rejects_pdf():
    """is_supported must accept the MarkItDown extensions and reject PDFs
    (PDFs go through the dedicated /import-pdf path) and unknown types."""
    for ok in ("notes.docx", "data.xlsx", "deck.pptx", "rows.csv",
               "book.epub", "nb.ipynb", "mail.msg", "page.html",
               "archive.zip", "REPORT.DOCX", "DECK.PPTX"):
        assert mdc.is_supported(ok), f"{ok!r} should be supported"
    for bad in ("", "noext", "report.pdf", "image.png", "script.exe"):
        assert not mdc.is_supported(bad), f"{bad!r} should NOT be supported"


def test_is_youtube_url_uses_host_match_not_substring():
    """Defence-in-depth: a hostname like 'youtube.com.evil.tld' must NOT
    pass — we parse the URL and compare the host, not the raw string."""
    for ok in ("https://www.youtube.com/watch?v=abc",
               "http://youtube.com/watch?v=abc",
               "https://youtu.be/abc",
               "https://m.youtube.com/watch?v=abc"):
        assert mdc.is_youtube_url(ok), f"{ok!r} should be recognised"
    for bad in ("", "https://example.com/abc",
                "https://youtube.com.evil.tld/watch",
                "https://evil.tld/?q=youtube.com",
                "not-a-url"):
        assert not mdc.is_youtube_url(bad), f"{bad!r} must NOT be recognised"


# ── 2. /api/documents/import — unsupported type → 415 ────────────────────

@pytest.mark.asyncio
async def test_import_rejects_unsupported_extension_with_415():
    previous = _bind_test_db()
    try:
        import_doc = _endpoint("POST", "/api/documents/import")
        with pytest.raises(HTTPException) as exc:
            await import_doc(_req("alice"), _upload("malware.exe", b"x" * 16), None)
        assert exc.value.status_code == 415
        assert ".exe" in str(exc.value.detail).lower() or "unsupported" in str(exc.value.detail).lower()
    finally:
        droutes.SessionLocal = previous


# ── 3. /api/documents/import — happy path (mocked MarkItDown) ────────────

@pytest.mark.asyncio
async def test_import_docx_creates_markdown_document(monkeypatch):
    previous = _bind_test_db()
    captured = {}
    def _fake_convert(path, filename):
        # Confirm the route actually wrote the bytes to disk before
        # handing the path to MarkItDown.
        captured["path"] = path
        captured["filename"] = filename
        captured["bytes"] = Path(path).read_bytes()
        return "# Imported\n\nHello from docx.\n"
    monkeypatch.setattr(
        "services.docs.markitdown_converter.convert_to_markdown",
        _fake_convert,
    )
    try:
        import_doc = _endpoint("POST", "/api/documents/import")
        payload = b"PK\x03\x04 fake docx body"
        doc_dict = await import_doc(
            _req("alice"), _upload("notes.docx", payload), None,
        )
        assert doc_dict["title"] == "notes"
        assert doc_dict["language"] == "markdown"
        assert "Hello from docx" in doc_dict["current_content"]
        assert captured["filename"] == "notes.docx"
        assert captured["bytes"] == payload
        # And the document landed in the DB owner-stamped.
        db = _TS()
        try:
            row = db.query(Document).filter(Document.id == doc_dict["id"]).first()
            assert row is not None
            assert row.owner == "alice"
        finally:
            db.close()
    finally:
        droutes.SessionLocal = previous


# ── 4. /api/documents/import — size cap → 413 ────────────────────────────

@pytest.mark.asyncio
async def test_import_rejects_oversized_file_with_413(monkeypatch):
    previous = _bind_test_db()
    # Drop the cap so we don't need to build a 20MB payload.
    monkeypatch.setattr(droutes, "_MARKITDOWN_MAX_BYTES", 64, raising=False)
    # Patch the cap captured by the closure at import-time. The route
    # reads droutes._MARKITDOWN_MAX_BYTES at module level inside the
    # closure body, so it picks up the patched value live.
    try:
        import_doc = _endpoint("POST", "/api/documents/import")
        with pytest.raises(HTTPException) as exc:
            await import_doc(
                _req("alice"),
                _upload("big.docx", b"x" * 256),
                None,
            )
        assert exc.value.status_code == 413
    finally:
        droutes.SessionLocal = previous


# ── 5. /api/documents/import — surfaces converter failure as 400 ─────────

@pytest.mark.asyncio
async def test_import_surfaces_markitdown_failure_as_400(monkeypatch):
    previous = _bind_test_db()
    def _boom(path, filename):
        raise RuntimeError("docx parse exploded")
    monkeypatch.setattr(
        "services.docs.markitdown_converter.convert_to_markdown",
        _boom,
    )
    try:
        import_doc = _endpoint("POST", "/api/documents/import")
        with pytest.raises(HTTPException) as exc:
            await import_doc(
                _req("alice"), _upload("bad.docx", b"PK garbage"), None,
            )
        assert exc.value.status_code == 400
        assert "bad.docx" in str(exc.value.detail) or "exploded" in str(exc.value.detail)
    finally:
        droutes.SessionLocal = previous


# ── 6. /api/documents/import — empty body short-circuits to 400 ──────────

@pytest.mark.asyncio
async def test_import_rejects_empty_file_with_400(monkeypatch):
    previous = _bind_test_db()
    # Converter must NOT run when the file is empty; sentinel to confirm.
    monkeypatch.setattr(
        "services.docs.markitdown_converter.convert_to_markdown",
        lambda *a, **k: pytest.fail("converter should not run for empty file"),
    )
    try:
        import_doc = _endpoint("POST", "/api/documents/import")
        with pytest.raises(HTTPException) as exc:
            await import_doc(_req("alice"), _upload("empty.docx", b""), None)
        assert exc.value.status_code == 400
        assert "empty" in str(exc.value.detail).lower()
    finally:
        droutes.SessionLocal = previous


# ── 7. /api/documents/import-url — non-YouTube → 415 ─────────────────────

@pytest.mark.asyncio
async def test_import_url_rejects_non_youtube_with_415():
    previous = _bind_test_db()
    try:
        import_url = _endpoint("POST", "/api/documents/import-url")
        with pytest.raises(HTTPException) as exc:
            await import_url(
                _req("alice"),
                _ImportURLBody(url="https://example.com/page"),
            )
        assert exc.value.status_code == 415
    finally:
        droutes.SessionLocal = previous


# ── 8. /api/documents/import-url — YouTube happy path ────────────────────

@pytest.mark.asyncio
async def test_import_url_youtube_creates_document(monkeypatch):
    previous = _bind_test_db()
    monkeypatch.setattr(
        "services.docs.markitdown_converter.convert_url",
        lambda url: ("# transcript\nhello world\n", "My Video"),
    )
    try:
        import_url = _endpoint("POST", "/api/documents/import-url")
        doc_dict = await import_url(
            _req("alice"),
            _ImportURLBody(url="https://www.youtube.com/watch?v=abc"),
        )
        assert doc_dict["title"] == "My Video"
        assert doc_dict["language"] == "markdown"
        assert "transcript" in doc_dict["current_content"]
        db = _TS()
        try:
            row = db.query(Document).filter(Document.id == doc_dict["id"]).first()
            assert row is not None
            assert row.owner == "alice"
        finally:
            db.close()
    finally:
        droutes.SessionLocal = previous
