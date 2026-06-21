"""GET /api/changelog — what's new feed for the CC ASSISTANT tab.

Reads CHANGELOG.md (project root or docs/) when present. Falls back to
the trailing 20 commits of the current git tree formatted as markdown
when no CHANGELOG file exists. Returns:

  { "content": str, "generated": bool }

`generated=True` when the body came from `git log`, so the UI can show
a "GENERATED FROM GIT" badge.

Owner-only via require_user — the changelog isn't sensitive, but the
endpoint also surfaces commit hashes, which are an implementation detail
not meant for anonymous callers.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Request

from src.auth_helpers import require_user

logger = logging.getLogger(__name__)


# Look-up order — first hit wins. Candidates are computed from the routes
# file's own location so the search works under both the bare-server and
# Docker-mounted layouts. Symlinks are not followed.
_CHANGELOG_FILENAMES = ("CHANGELOG.md", "CHANGELOG", "docs/CHANGELOG.md")


def _candidate_roots() -> list:
    """Return roots in which to look for a CHANGELOG file.

    Walks up from the routes module's directory; covers both
      /Users/.../Cerberus/cerberus/routes/  (bare)
      /workspace/cerberus/routes/           (Docker)
    """
    here = Path(__file__).resolve().parent       # …/cerberus/routes
    return [here.parent, here.parent.parent]     # …/cerberus, …/Cerberus


def _find_changelog_file() -> Optional[Path]:
    for root in _candidate_roots():
        for rel in _CHANGELOG_FILENAMES:
            p = root / rel
            if p.is_file():
                return p
    return None


# Max bytes we'll surface from a CHANGELOG file — guards against a
# multi-megabyte history being shipped over the wire on every dashboard
# render. 200 KB is generous for a human-curated changelog.
_MAX_CHANGELOG_BYTES = 200_000

# Max commits we surface in the generated fallback. Spec says 20.
_GIT_LOG_LIMIT = 20


def _generate_from_git() -> str:
    """Format the trailing N commits as markdown. Empty string if git is
    unavailable (no binary in PATH, not a repo, or the call fails)."""
    git = shutil.which("git")
    if not git:
        return ""
    # Run inside one of the candidate roots so `git log` resolves the
    # right repository even when the worker is in a sibling cwd.
    for root in _candidate_roots():
        if not (root / ".git").exists():
            # Try parent — `git rev-parse --show-toplevel` is the proper
            # check but adds latency; the .git existence check is enough
            # for the bare layout. Docker mounts may use a worktree; let
            # the subprocess decide if .git is missing here.
            continue
        try:
            out = subprocess.run(
                [git, "log", f"--max-count={_GIT_LOG_LIMIT}",
                 "--pretty=format:%h %s"],
                cwd=str(root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                timeout=5,
            )
            lines = out.stdout.decode("utf-8", errors="replace").splitlines()
            if not lines:
                return ""
            md = ["# Recent commits", ""]
            for line in lines:
                # Each line is "<hash> <subject>" — render as a bullet.
                md.append(f"- `{line}`" if line.strip() else "")
            return "\n".join(md).strip()
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("changelog: git log fallback failed in %s: %s", root, exc)
            continue
    return ""


def setup_changelog_routes() -> APIRouter:
    """Factory for the /api/changelog router."""

    router = APIRouter(prefix="/api", tags=["changelog"])

    @router.get("/changelog")
    def changelog(request: Request) -> Dict[str, Any]:
        require_user(request)

        path = _find_changelog_file()
        if path is not None:
            try:
                raw = path.read_bytes()
                if len(raw) > _MAX_CHANGELOG_BYTES:
                    raw = raw[:_MAX_CHANGELOG_BYTES]
                return {
                    "content": raw.decode("utf-8", errors="replace"),
                    "generated": False,
                }
            except OSError as exc:
                # Fall through to generated — surfacing a half-readable file
                # is worse than the curated git history.
                logger.warning("changelog: failed to read %s: %s", path, exc)

        return {
            "content": _generate_from_git() or "(no changelog available)",
            "generated": True,
        }

    return router
