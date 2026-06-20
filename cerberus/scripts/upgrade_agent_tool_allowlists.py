"""V4 Phase 1–3 migration: add tool_allowlist column and back-fill default agents.

Run from the cerberus/ directory:
    python scripts/upgrade_agent_tool_allowlists.py

Safe to re-run — column addition and per-row updates are idempotent.
Phase 2 adds bash/python to execution agents (CODER, TESTER, DEVOPS, DATA-ANALYST,
DEBUGGER, OPTIMIZER). All execution is routed through OpenSandbox — never the host shell.
Phase 3 adds write_file/edit_file (approval-gated) to CODER, DEVOPS, OPTIMIZER.
"""

import json
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import inspect, text

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

_P1_FILE = ["read_file", "grep", "glob", "ls"]
_P2_EXEC = ["bash", "python"]
_P3_WRITE = ["write_file", "edit_file"]  # approval-gated

_ALLOWLISTS: dict[str, list[str]] = {
    "ARCHITECT":    _P1_FILE + ["web_search", "web_fetch", "manage_memory", "manage_skills"],
    "CODER":        _P1_FILE + _P2_EXEC + _P3_WRITE,
    "TESTER":       _P1_FILE + _P2_EXEC,
    "RESEARCHER":   ["web_search", "web_fetch", "search_chats", "manage_memory"],
    "REVIEWER":     _P1_FILE + ["search_chats"],
    "SECURITY":     _P1_FILE + ["web_search", "web_fetch"],
    "ORCHESTRATOR": ["manage_tasks", "search_chats", "manage_memory"],
    "DEVOPS":       _P1_FILE + ["bash"] + _P3_WRITE,
    "DATA-ANALYST": _P1_FILE + ["python"],
    "SCRIBE":       _P1_FILE + ["create_document", "edit_document", "update_document"],
    "DESIGNER":     _P1_FILE + ["create_document", "edit_document", "update_document"],
    "DEBUGGER":     _P1_FILE + ["search_chats"] + _P2_EXEC,
    "PLANNER":      ["manage_tasks", "manage_memory", "search_chats"],
    "LIBRARIAN":    ["manage_memory", "manage_skills", "search_chats"],
    "OPTIMIZER":    _P1_FILE + _P2_EXEC + _P3_WRITE,
    "PROMPTSMITH":  ["manage_skills", "search_chats", "manage_memory"],
}


def _add_column_if_missing(engine) -> bool:
    inspector = inspect(engine)
    cols = {c["name"] for c in inspector.get_columns("cerberus_agents")}
    if "tool_allowlist" in cols:
        log.info("Column tool_allowlist already exists — skipping ALTER TABLE")
        return False
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE cerberus_agents ADD COLUMN tool_allowlist TEXT"))
        conn.commit()
    log.info("Added column tool_allowlist")
    return True


def _backfill(engine) -> None:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, name, tool_allowlist FROM cerberus_agents")
        ).fetchall()
        updated = 0
        for row_id, name, existing in rows:
            allowlist = _ALLOWLISTS.get(name)
            if allowlist is None:
                continue  # custom agent — leave untouched
            new_val = json.dumps(allowlist)
            if existing == new_val:
                continue
            conn.execute(
                text("UPDATE cerberus_agents SET tool_allowlist = :v WHERE id = :id"),
                {"v": new_val, "id": row_id},
            )
            updated += 1
            log.info("  %-15s → %s", name, allowlist)
        conn.commit()
    log.info("Back-filled %d agent row(s)", updated)


def main() -> None:
    from core.database import engine
    log.info("Starting V4 Phase 1–3 tool_allowlist migration…")
    _add_column_if_missing(engine)
    _backfill(engine)
    log.info("Migration complete.")


if __name__ == "__main__":
    main()
