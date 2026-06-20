"""Server-side tool safety policy."""

from __future__ import annotations

import logging
from typing import Optional, Set

logger = logging.getLogger(__name__)


# Tools regular/public users must not execute directly. These either expose
# server/runtime access, sensitive user data, external messaging, persistent
# state changes, or generic loopback/integration surfaces.
NON_ADMIN_BLOCKED_TOOLS = {
    "bash",
    "python",
    "read_file",
    "write_file",
    "edit_file",
    "grep",
    "glob",
    "ls",
    "search_chats",
    "manage_memory",
    "manage_skills",
    "manage_tasks",
    "manage_endpoints",
    "manage_mcp",
    "manage_webhooks",
    "manage_tokens",
    "manage_documents",
    "manage_settings",
    "api_call",
    "app_api",
    "send_email",
    "reply_to_email",
    "list_emails",
    "read_email",
    "resolve_contact",
    "manage_contact",
    "manage_calendar",
    "vault_search",
    "vault_get",
    "vault_unlock",
    "download_model",
    "serve_model",
    "serve_preset",
    "stop_served_model",
    "cancel_download",
    "adopt_served_model",
}


# ── V4 Phase 4a: gateway tool policy ──────────────────────────────────────────
# Flat policy across Discord/Telegram/Slack — same tier for every gateway
# platform (owner decision; see docs/V4_PHASE4_GATEWAY_THREATMODEL.md §7 Q4).
#
# The agent-loop tool gate is a DENYLIST. `build_effective_tool_policy` accepts
# an `agent_allowlist` parameter that it inverts into the equivalent denylist —
# so Tier A ∪ Tier B IS the entire set of tool names a gateway session is
# permitted to invoke. Everything else (bash, python, write_file,
# manage_webhooks, vault_*, the full NON_ADMIN_BLOCKED_TOOLS set, every other
# MCP tool, …) is automatically Tier C = blocked. This is the central
# enforcement decision for Phase 4a.

# Tier A — always allowed (read-only / reversible). For tools that mix read
# and write through an `action` parameter (manage_calendar, manage_memory,
# manage_notes), per-action gating happens at agent_loop level — the
# dispatcher-side allowlist gates the tool *name* only.
GATEWAY_TIER_A_TOOLS = frozenset({
    "web_search",
    "web_fetch",
    "search_chats",
    "manage_memory",
    "manage_notes",
    "manage_calendar",
})

# Tier B — allowed only behind the approval gate. `manage_calendar_write` is a
# sentinel name: agent_loop substitutes it for `manage_calendar` when the
# parsed action is create_event/update_event/delete_event, so the single
# `manage_calendar` tool covers both the Tier A read path and the Tier B
# write-with-approval path.
GATEWAY_TIER_B_TOOLS = frozenset({
    "mcp__email__send_email",
    "manage_calendar_write",
})

# Passed as `agent_allowlist=` to `build_effective_tool_policy` for gateway
# sessions. Anything outside this set is automatically blocked by inversion.
GATEWAY_TOOL_ALLOWLIST = GATEWAY_TIER_A_TOOLS | GATEWAY_TIER_B_TOOLS

# Passed as `approval_gated_tools=`. The agent-loop intercept already exists
# from Phase 3 (write_file/edit_file on thread agents); we reuse it here.
GATEWAY_APPROVAL_GATED_TOOLS = frozenset({
    "mcp__email__send_email",
    "manage_calendar_write",
})

# Calendar action names that count as writes. agent_loop checks the parsed
# `action` in the tool block and swaps `manage_calendar` for the sentinel
# `manage_calendar_write` when one of these matches, so the approval-gate
# check fires. Keep in lock-step with the action set in calendar tools.
GATEWAY_CALENDAR_WRITE_ACTIONS = frozenset({
    "create_event",
    "update_event",
    "delete_event",
})


def effective_approval_tool_name(tool_type: str, content: str) -> str:
    """Resolve the tool name used for approval-gate matching.

    Most tools approval-gate by their literal name (`mcp__email__send_email`,
    `write_file`). `manage_calendar` is special: only the write actions
    (create_event/update_event/delete_event) need approval; list/get pass
    through as Tier A. agent_loop calls this with the raw block tool_type and
    content; if the action parses as a write, this returns the sentinel
    `manage_calendar_write` (which the gateway allowlist + approval set use).
    Otherwise returns ``tool_type`` unchanged.

    The approve/reject endpoint must run the SAME logic against the stored
    tool_args to classify a request — that's why this lives in tool_security,
    not inline at the call sites.
    """
    if tool_type != "manage_calendar":
        return tool_type
    # Try JSON parse first (MCP-style argument blob)
    action = None
    if isinstance(content, str) and content.strip():
        try:
            import json as _json
            parsed = _json.loads(content)
            if isinstance(parsed, dict):
                action = str(parsed.get("action") or "").strip().lower()
        except Exception:
            action = None
    if action and action in GATEWAY_CALENDAR_WRITE_ACTIONS:
        return "manage_calendar_write"
    return tool_type


def is_gateway_session(sess) -> bool:
    """True when this session originated from the inbound gateway.

    Reads the persisted `is_gateway` flag (DB column added by
    `_migrate_add_is_gateway_column`, mirrored on the in-memory Session
    dataclass). Falls back to False for any object that doesn't carry the
    attribute — keeps non-gateway callers (tests, ad-hoc tooling) safe.
    """
    if sess is None:
        return False
    return bool(getattr(sess, "is_gateway", False))


# Plan mode: the agent may investigate but must not mutate anything. Only these
# read-only/inspection tools stay enabled; everything else (writes, sends,
# manage_*, model serving, MCP, etc.) is blocked. Allowlist rather than blocklist
# so any newly added tool defaults to BLOCKED in plan mode — fail safe.
#
# bash/python are deliberately NOT here: the shell can mutate (write files, hit
# the network) and can't be constrained to read-only at the tool layer, so plan
# mode blocks it outright rather than relying on a prompt to keep it well-behaved.
# Code/file discovery is covered by the dedicated read-only tools below
# (read_file, grep, glob, ls) instead of freestyle shell.
PLAN_MODE_READONLY_TOOLS = {
    "read_file",
    "grep",
    "glob",
    "ls",
    "web_search",
    "web_fetch",
    "search_chats",
    "list_models",
    "list_sessions",
    "list_emails",
    "read_email",
    "list_served_models",
    "list_downloads",
    "list_cached_models",
    "search_hf_models",
    "list_serve_presets",
    "list_cookbook_servers",
    "resolve_contact",
    "chat_with_model",
    "ask_teacher",
}


# The agent's tool gate is a DENYLIST: execute_tool_block blocks any tool whose
# name is in `disabled_tools`. Plan mode's policy is the opposite — an allowlist
# (PLAN_MODE_READONLY_TOOLS). To apply an allowlist through a denylist, plan mode
# returns the inverse: every known tool name minus the allowlist.
#
# Known tool names come from FUNCTION_TOOL_SCHEMAS, but that source is imperfect:
# some tools are only XML-invocable (e.g. manage_notes, generate_image) and never
# appear there, and the import can fail outright. Either gap would drop a mutating
# tool from the subtraction and silently leave it enabled. This set is the static
# backstop for both: union it in so known mutators are always subtracted, and so a
# failed import still blocks them (fail closed, never open). Only mutators belong
# here — read-only tools are covered by the allowlist. Keep in sync when adding
# new mutating tools.
_PLAN_MODE_KNOWN_MUTATORS = {
    "write_file", "create_document", "edit_document", "update_document",
    "suggest_document", "manage_documents", "create_session", "manage_session",
    "send_to_session", "pipeline", "manage_memory", "manage_skills",
    "manage_tasks", "manage_notes", "manage_endpoints", "manage_mcp",
    "manage_webhooks", "manage_tokens", "manage_settings", "manage_contact",
    "manage_calendar", "api_call", "app_api", "ui_control",
    "send_email", "reply_to_email", "bulk_email", "delete_email",
    "archive_email", "mark_email_read", "download_model", "serve_model",
    "stop_served_model", "cancel_download", "adopt_served_model", "serve_preset",
    "generate_image", "edit_image", "trigger_research", "manage_research",
    # Shell is never read-only-safe; block it explicitly so it stays out of plan
    # mode even if the schema list fails to load.
    "bash", "python",
}


def plan_mode_disabled_tools() -> Set[str]:
    """Tool names to add to the denylist in plan mode.

    Plan mode allows only PLAN_MODE_READONLY_TOOLS. The gate is a denylist, so
    return the inverse: every known tool name minus the allowlist. Known names
    come from the function-tool schemas, backstopped by _PLAN_MODE_KNOWN_MUTATORS
    (see above) so XML-only tools and a failed schema import can't leave a mutator
    enabled. MCP tools are handled separately — the loop drops the MCP manager
    entirely in plan mode."""
    try:
        # agent_tools / tool_parsing / tool_schemas form a mutually-circular
        # cluster that only resolves cleanly when entered via agent_tools.
        # Import it first so the lazy schema import works even from a cold
        # import (e.g. tests) — not just after the app has wired everything up.
        import src.agent_tools  # noqa: F401
        from src.tool_schemas import FUNCTION_TOOL_SCHEMAS

        all_names = {
            (t.get("function") or {}).get("name")
            for t in FUNCTION_TOOL_SCHEMAS
        }
        all_names.discard(None)
    except Exception as exc:
        logger.warning("Unable to load tool schemas for plan-mode gating: %s", exc)
        all_names = set()
    # Subtract the allowlist from all known tool names (schema-derived plus the
    # static mutator backstop). Fail closed: if the schema import failed above,
    # the backstop alone still blocks known mutators.
    return (all_names | _PLAN_MODE_KNOWN_MUTATORS) - PLAN_MODE_READONLY_TOOLS


def is_public_blocked_tool(tool_name: Optional[str]) -> bool:
    """Return True when a non-admin/public user must not execute this tool.

    This is a security gate, so it fails CLOSED: a malformed non-string tool
    name can't be matched against the blocklist or the ``mcp__`` namespace, so
    it is treated as blocked rather than silently allowed through. ``None`` /
    empty string means there is no tool to gate.
    """
    if tool_name is None or tool_name == "":
        return False
    if not isinstance(tool_name, str):
        return True
    return tool_name in NON_ADMIN_BLOCKED_TOOLS or tool_name.startswith("mcp__")


def owner_is_admin_or_single_user(owner: Optional[str]) -> bool:
    """Return True for admins, or in intentional single-user mode.

    Single-user mode means the operator explicitly disabled auth
    (``AUTH_ENABLED=false``) — the local/self-host default where the owner has
    full access to their own box.

    The pre-setup window (auth ENABLED but no admin created yet) is treated as
    NON-admin: returning True there would hand server-execution tools
    (``bash``/``python``) to any caller before setup completes. The auth
    middleware already 401s ``/api/`` requests pre-setup, so this is
    defense-in-depth for callers that bypass it (e.g. trusted loopback).
    """
    try:
        from core.auth import AuthManager

        auth = AuthManager()
        if not auth.is_configured:
            from src.auth_helpers import _auth_disabled

            return _auth_disabled()
        return bool(owner and auth.is_admin(owner))
    except Exception as exc:
        logger.warning("Unable to evaluate owner admin status: %s", exc)
        return False


def blocked_tools_for_owner(owner: Optional[str]) -> Set[str]:
    """Tools to hide/disable for this owner under public-user policy."""
    if owner_is_admin_or_single_user(owner):
        return set()
    return set(NON_ADMIN_BLOCKED_TOOLS)
