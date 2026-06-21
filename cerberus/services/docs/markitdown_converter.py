"""MarkItDown converter — wraps the upstream library with a stable surface.

MarkItDown (https://github.com/microsoft/markitdown) reads a wide range of
office / structured-text formats and returns Markdown. The CC document
import endpoint calls into this module so the route layer can stay
format-agnostic.

The MarkItDown import is intentionally lazy + module-cached: the package
loads heavy optional deps (PIL, lxml, bs4, …) only when first used, and
we keep a single converter instance for the life of the process.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Extensions the route is willing to hand to MarkItDown. Conservative:
# `.pdf` is intentionally excluded because the dedicated /import-pdf path
# (PDF form detection + sidecar) does a better job than the generic
# converter. `.zip` is accepted (MarkItDown unpacks + indexes inner files
# itself) — `is_supported` does NOT do MIME sniffing, so the route still
# checks the multipart `content_type` separately as defence-in-depth.
SUPPORTED_EXTENSIONS = frozenset({
    ".docx", ".doc",
    ".xlsx", ".xls",
    ".pptx", ".ppt",
    ".csv",
    ".epub",
    ".ipynb",
    ".msg",
    ".html", ".htm",
    ".zip",
})

# YouTube URL recognisers — both the long and short forms. Used by the
# /import-url route to gate calls to MarkItDown.convert_url.
_YOUTUBE_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com",
                  "youtu.be", "www.youtu.be")


_md_instance: Any = None
_md_lock = threading.Lock()


def _get_md() -> Any:
    """Return a process-wide MarkItDown instance, lazy-initialised.

    Raises ImportError if the package isn't installed so the route can
    surface a clear 503/415 instead of crashing on first request."""
    global _md_instance
    if _md_instance is not None:
        return _md_instance
    with _md_lock:
        if _md_instance is not None:
            return _md_instance
        from markitdown import MarkItDown
        _md_instance = MarkItDown()
    return _md_instance


def is_supported(filename: str) -> bool:
    """True when the filename's extension is in SUPPORTED_EXTENSIONS.

    Case-insensitive. Returns False for empty / extensionless names rather
    than raising — callers can fall through to other handlers."""
    if not filename:
        return False
    ext = Path(filename).suffix.lower()
    return ext in SUPPORTED_EXTENSIONS


def convert_to_markdown(file_path: str, filename: str) -> str:
    """Convert a local file to Markdown via MarkItDown.

    Always returns a non-empty string. Raises:
      - ValueError if the file produces empty content (defensive — a
        silently-empty doc would land in the library with no body).
      - ImportError if the markitdown package isn't installed.
      - Any IO / parser exception that bubbles up from MarkItDown itself
        — the route catches these and returns 400 with the message."""
    md = _get_md()
    result = md.convert_local(file_path)
    text = getattr(result, "text_content", None) if result else None
    if not text or not str(text).strip():
        raise ValueError(f"MarkItDown returned empty content for {filename}")
    return str(text)


def is_youtube_url(url: str) -> bool:
    """True when the URL host matches a known YouTube domain.

    Uses urlparse rather than substring matching so 'youtube.com.evil.tld'
    can't sneak through."""
    if not url or not isinstance(url, str):
        return False
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url.strip())
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return host in _YOUTUBE_HOSTS


def convert_url(url: str) -> tuple[str, Optional[str]]:
    """Convert a remote URL (currently YouTube only) to Markdown.

    Returns (markdown_text, title). `title` is None when MarkItDown
    doesn't surface one; the caller should fall back to a sensible
    default. Raises ValueError on empty content; ImportError when the
    package is missing."""
    md = _get_md()
    result = md.convert_url(url)
    text  = getattr(result, "text_content", None) if result else None
    title = getattr(result, "title", None) if result else None
    if not text or not str(text).strip():
        raise ValueError(f"MarkItDown returned empty content for {url}")
    return str(text), (str(title) if title else None)
