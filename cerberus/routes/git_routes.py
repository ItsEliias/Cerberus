"""Git summary routes — POST /api/git/summarise.

Reads recent commits via `git log` + `git diff --stat`, asks the default
LLM to render a plain-English bullet summary, and saves the result as a
Note so the user can review what landed without re-reading the diff.

Subprocess invocation mirrors routes/shell_routes.py: we use
`asyncio.create_subprocess_exec` (argv form, not shell) so the repo_path
+ branch values are never word-split and quoted into a shell command.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.database import Note, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_GIT_TIMEOUT_SEC = 20
_DIFF_CHAR_CAP = 16_000        # cap diff text sent to the LLM
_SUMMARY_MAX_TOKENS = 600
_BRANCH_RE = re.compile(r"^[A-Za-z0-9._/-]{1,128}$")


class GitSummariseBody(BaseModel):
    repo_path: Optional[str] = None
    branch: Optional[str] = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _git(args: list[str], cwd: str) -> tuple[int, str, str]:
    """Run `git ARGS` in cwd. Returns (returncode, stdout, stderr).

    Times out at _GIT_TIMEOUT_SEC. Captures both streams as UTF-8 with
    `errors=replace` so binary diff bytes never raise."""
    proc = await asyncio.create_subprocess_exec(
        "git", *args, cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(
            proc.communicate(), timeout=_GIT_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise HTTPException(504, "git timed out")
    return (
        proc.returncode or 0,
        (out or b"").decode("utf-8", errors="replace"),
        (err or b"").decode("utf-8", errors="replace"),
    )


def _validate_repo_path(repo_path: Optional[str]) -> str:
    """Resolve and validate the repo path. Defaults to BASE_DIR."""
    from src.constants import BASE_DIR
    if repo_path is None or not str(repo_path).strip():
        path = BASE_DIR
    else:
        path = os.path.realpath(str(repo_path).strip())
    if not os.path.isdir(path):
        raise HTTPException(400, "repo_path must be an existing directory")
    if not os.path.isdir(os.path.join(path, ".git")):
        raise HTTPException(400, "repo_path is not a git repository")
    return path


def _validate_branch(branch: Optional[str]) -> Optional[str]:
    """Branch must match a conservative whitelist — passed straight to git."""
    if branch is None or not str(branch).strip():
        return None
    b = str(branch).strip()
    if not _BRANCH_RE.fullmatch(b):
        raise HTTPException(400, "branch contains unsafe characters")
    return b


def _truncate(text: str, cap: int) -> str:
    if len(text) <= cap:
        return text
    return text[:cap] + f"\n... (truncated, {len(text) - cap} more chars)"


def _format_diff(log_text: str, stat_text: str) -> str:
    parts = []
    if log_text.strip():
        parts.append("## Commits\n" + log_text.strip())
    if stat_text.strip():
        parts.append("## Files changed\n" + stat_text.strip())
    return "\n\n".join(parts).strip()


async def _summarise_with_llm(owner: str, diff_text: str) -> str:
    """Send the diff to the default chat LLM. Returns the bullet summary
    text (or a graceful fallback when no provider is configured)."""
    from src.endpoint_resolver import resolve_endpoint
    from src.llm_core import llm_call_async

    url, model, headers = resolve_endpoint("default", owner=owner)
    if not url or not model:
        # No provider — return the raw diff with a header so the note isn't
        # empty. The route still succeeds; the user just gets a literal
        # change report instead of a prose summary.
        return (
            "_(No default model configured — raw change report below.)_\n\n"
            + diff_text
        )
    messages = [
        {
            "role": "system",
            "content": (
                "You are a release-notes writer. Summarise git changes in "
                "plain English for a non-technical reader. Output 3–5 bullet "
                "points, each one sentence, no jargon, no quoting commit "
                "hashes. Group related commits."
            ),
        },
        {
            "role": "user",
            "content": _truncate(diff_text, _DIFF_CHAR_CAP),
        },
    ]
    try:
        out = await llm_call_async(
            url, model, messages,
            temperature=0.2, max_tokens=_SUMMARY_MAX_TOKENS, headers=headers,
        )
    except Exception as exc:
        logger.warning("git summarise LLM call failed: %s", exc)
        return (
            "_(LLM summary failed — raw change report below.)_\n\n"
            + diff_text
        )
    return (out or "").strip() or diff_text


def _save_summary_note(
    owner: Optional[str], branch_label: str, summary: str,
) -> Optional[str]:
    """Persist the summary as a Note. Returns the new note id (or None
    on best-effort failure)."""
    title = f"// CHANGES: {branch_label} {_utcnow().date().isoformat()}"
    db = None
    try:
        db = SessionLocal()
        note = Note(
            id=str(uuid.uuid4()),
            owner=owner,
            title=title,
            content=summary,
            note_type="note",
            source="git",
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        return note.id
    except Exception as exc:
        logger.warning("git summary note insert failed: %s", exc)
        return None
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def setup_git_routes() -> APIRouter:
    router = APIRouter(prefix="/api/git", tags=["git"])

    @router.post("/summarise")
    async def summarise(
        request: Request, body: GitSummariseBody,
    ) -> Dict[str, Any]:
        owner = require_user(request)
        repo_path = _validate_repo_path(body.repo_path)
        branch = _validate_branch(body.branch)

        # Resolve the upstream range. When no branch is given, fall back to
        # the current branch's tracking ref so the summary covers "what I
        # haven't pushed yet"; otherwise compare HEAD against origin/{branch}.
        if branch:
            range_spec = f"origin/{branch}..HEAD"
        else:
            range_spec = "@{u}..HEAD"

        # 1. `git log` for the commit list. Falls back to last 10 commits
        #    when the upstream/range doesn't exist (e.g. fresh branch).
        rc, log_text, log_err = await _git(
            ["log", "--no-merges", "--oneline", range_spec], cwd=repo_path,
        )
        if rc != 0:
            # Fall back to the last 10 commits — `range_spec` may be invalid
            # on a never-pushed branch.
            rc2, log_text, _ = await _git(
                ["log", "--no-merges", "--oneline", "-n", "10"], cwd=repo_path,
            )
            if rc2 != 0:
                raise HTTPException(
                    500,
                    f"git log failed: {(log_err or '').strip().splitlines()[:1]}",
                )

        # 2. Diff stat — same range when possible, last commit otherwise.
        rc, stat_text, _ = await _git(
            ["diff", "--stat", range_spec], cwd=repo_path,
        )
        if rc != 0:
            rc2, stat_text, _ = await _git(
                ["diff", "--stat", "HEAD~10..HEAD"], cwd=repo_path,
            )
            if rc2 != 0:
                stat_text = ""

        diff_text = _format_diff(log_text, stat_text).strip()
        if not diff_text:
            raise HTTPException(400, "No recent commits to summarise")

        summary = await _summarise_with_llm(owner, diff_text)
        branch_label = branch or "HEAD"
        note_id = _save_summary_note(owner, branch_label, summary)

        return {"note_id": note_id, "summary": summary}

    return router
