"""Cerberus OS agent report workers — LLM-backed report generation, no tool execution."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from src.cerberus_command_centre import load_active_project
from src.cerberus_config import (
    build_cerberus_system_context,
    data_dir,
    load_agents,
    load_aurelius_profile,
    load_projects,
    load_reports,
    profile_address,
    resolve_dynamic_focus,
    save_agents,
    save_reports,
)
from src.cerberus_council import STAGE_ACTIONS, STAGE_AGENTS, council_context_block, load_council, next_stage
from src.cerberus_mount_workspace import save_agent_report_markdown
from src.cerberus_project_index import (
    format_summaries_for_agents,
    load_all_summaries,
    load_summary,
)

logger = logging.getLogger(__name__)

REPORT_ACTIONS = ["approve", "revise", "archive"]

# action -> (required agent_id, report title template)
ACTION_SPECS: Dict[str, Dict[str, Any]] = {
    "developer_review": {
        "agent_id": "developer",
        "title": "Developer Review Plan",
    },
    "developer_project_review": {
        "agent_id": "developer",
        "title": "Developer Project Review",
    },
    "research_brief": {
        "agent_id": "research",
        "title": "Research Brief",
    },
    "business_ideas": {
        "agent_id": "research",
        "title": "Business Ideas Brief",
    },
    "marketing_ideas": {
        "agent_id": "marketing",
        "title": "Marketing Ideas",
    },
    "business_strategy": {
        "agent_id": "business",
        "title": "Business Strategy Brief",
    },
    "business_analysis": {
        "agent_id": "business",
        "title": "Business Analysis",
    },
    "monetisation_plan": {
        "agent_id": "business",
        "title": "Monetisation Plan",
    },
    "architecture_plan": {
        "agent_id": "architect",
        "title": "Architecture Plan",
    },
    "sync_agents": {
        "agent_id": None,
        "title": "Agent Network Sync",
    },
    # V2 project-specific reports
    "market_opportunity_report": {"agent_id": "research", "title": "Market Opportunity Report"},
    "competitor_angles": {"agent_id": "research", "title": "Competitor Angles"},
    "feature_opportunity_report": {"agent_id": "research", "title": "Feature Opportunity Report"},
    "monetisation_report": {"agent_id": "business", "title": "Monetisation Report"},
    "pricing_report": {"agent_id": "business", "title": "Pricing Report"},
    "business_model_report": {"agent_id": "business", "title": "Business Model Report"},
    "three_ways_to_make_money": {"agent_id": "business", "title": "3 Ways This Project Can Make Money"},
    "architecture_review": {"agent_id": "architect", "title": "Architecture Review"},
    "system_design_report": {"agent_id": "architect", "title": "System Design Report"},
    "database_workflow_report": {"agent_id": "architect", "title": "Database & Workflow Report"},
    "mvp_scope_report": {"agent_id": "architect", "title": "MVP Scope Report"},
    "codebase_review": {"agent_id": "developer", "title": "Codebase Review"},
    "cursor_prompt": {"agent_id": "developer", "title": "Cursor Prompt"},
    "bug_risk_report": {"agent_id": "developer", "title": "Bug Risk Report"},
    "implementation_plan": {"agent_id": "developer", "title": "Implementation Plan"},
    "launch_strategy": {"agent_id": "marketing", "title": "Launch Strategy"},
    "content_plan": {"agent_id": "marketing", "title": "Content Plan"},
    "ad_angle_report": {"agent_id": "marketing", "title": "Ad Angle Report"},
    "landing_page_copy_report": {"agent_id": "marketing", "title": "Landing Page Copy Report"},
}

# Legacy aliases from the mock endpoint
_ACTION_ALIASES = {
    "business_ask": "business_strategy",
    "architecture_review": "architecture_plan",
    "sync": "sync_agents",
}

def get_agent_system_prompts() -> Dict[str, str]:
    """Public copy of agent system prompts (for reasoning audit)."""
    return dict(_AGENT_PROMPTS)


_AGENT_PROMPTS: Dict[str, str] = {
    "developer": """You are the Developer Agent inside Cerberus OS.
Produce a **code/project review plan** or **Cursor prompt** for the user.
Do NOT execute code, modify files, or run shell commands.
Output a structured report with:
1. Executive summary (2-3 sentences)
2. Scope and files/areas to inspect
3. Review checklist (bugs, architecture, DX, tests)
4. Suggested Cursor prompt the user can paste to start implementation
5. Risks and quick wins
Be direct, practical, builder-focused.""",
    "architect": """You are the Architect Agent inside Cerberus OS.
Produce a **system design / specification** document.
Do NOT execute code or modify infrastructure.
Output a structured report with:
1. Executive summary
2. Problem statement and goals
3. Proposed architecture (components, data flow, boundaries)
4. API/route/data model outline
5. Key decisions and trade-offs
6. Phased implementation plan
Be direct, strategic, slightly futuristic — no generic waffle.""",
    "research": """You are the Research Agent inside Cerberus OS.
Based on the user's profile and active projects, generate **5 practical business/app ideas** suitable for the user.
Focus on fast-build SaaS, AI tools, marketplaces, automation, or viral micro-products aligned with their skills.
For each idea include: Idea name, Why it fits the user, MVP scope, Monetisation, Difficulty (1-5), First step.
Then add a short competitor/market note for the top 2 ideas.
Be direct and actionable — no generic waffle.""",
    "marketing": """You are the Marketing Agent inside Cerberus OS.
Produce **launch angles and content ideas** for the user's priority projects.
Output a structured report with:
1. Executive summary
2. Positioning angles (3 options)
3. Headline / hook ideas (at least 8)
4. Landing page section outline
5. Channel plan for small-audience testing
6. 7-day launch content calendar (bullets)
Be punchy, modern, slightly futuristic.""",
    "business": """You are the Business Agent inside Cerberus OS.
Produce **prioritisation, monetisation, and focus recommendations** for the user.
Output a structured report with:
1. Executive summary
2. Current priority stack (what to focus this week)
3. What to pause or defer (and why)
4. Monetisation paths for active projects
5. Fast validation experiments (low cost, 48-72h)
6. Recommended daily focus for the next 3 days
Be direct, strategic, practical — no generic waffle.""",
}


def normalize_action(action: str) -> str:
    action = (action or "").strip().lower()
    return _ACTION_ALIASES.get(action, action)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _summary_from_content(content: str, max_len: int = 220) -> str:
    text = re.sub(r"\s+", " ", (content or "").strip())
    if not text:
        return "Report generated."
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0]
    return (cut or text[:max_len]).rstrip() + "…"


def _strip_thinking(text: str) -> str:
    if not text:
        return ""
    try:
        from src.text_helpers import strip_thinking
        return strip_thinking(text).strip()
    except Exception:
        return text.strip()


def _resolve_llm(owner: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[Dict]]:
    try:
        from src.endpoint_resolver import resolve_endpoint
        return resolve_endpoint("utility", owner=owner)
    except Exception as exc:
        logger.warning("[cerberus-agents] endpoint resolve failed: %s", exc)
        return None, None, None


async def call_cerberus_llm(
    owner: Optional[str],
    system: str,
    user: str,
) -> Optional[str]:
    """Public LLM helper for Atlas modules (indexing, briefing, agents)."""
    return await _call_llm(owner, system, user)


async def _call_llm(
    owner: Optional[str],
    system: str,
    user_prompt: str,
    *,
    temperature: float = 0.4,
    max_tokens: int = 2500,
) -> Optional[str]:
    url, model, headers = _resolve_llm(owner)
    if not url or not model:
        return None
    try:
        from src.llm_core import llm_call_async
        raw = await llm_call_async(
            url=url,
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            headers=headers,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=90,
            max_retries=1,
        )
        body = _strip_thinking(raw or "")
        return body if body.strip() else None
    except Exception as exc:
        logger.warning("[cerberus-agents] LLM call failed: %s", exc)
        return None


def _project_is_indexed(project_id: Optional[str]) -> bool:
    if not project_id:
        return False
    if load_summary(data_dir(), project_id):
        return True
    proj = next((p for p in load_projects() if p.get("id") == project_id), None)
    return bool(proj and (proj.get("last_indexed_at") or proj.get("indexed")))


def _not_indexed_notice(project_id: Optional[str]) -> str:
    proj = next((p for p in load_projects() if p.get("id") == project_id), None) if project_id else None
    name = (proj or {}).get("name", "This project")
    return (
        f"**Note:** {name} is not indexed yet. Index it first for a better review.\n"
        "Limited metadata is available below until indexing completes."
    )


def _v2_context_block(project_id: Optional[str]) -> str:
    if not project_id:
        return ""
    summ = load_summary(data_dir(), project_id)
    if not summ or summ.get("index_version") != 2:
        return ""
    lines = ["### V2 Project Intelligence"]
    for key, label in (
        ("what_it_appears_to_do", "Purpose"),
        ("current_stage", "Stage"),
        ("project_type", "Type"),
        ("potential_score", "Potential score"),
    ):
        if summ.get(key):
            lines.append(f"- {label}: {summ[key]}")
    for key in ("strengths", "weaknesses", "missing_pieces", "monetisation_options", "recommended_next_steps", "risk_flags"):
        vals = summ.get(key)
        if isinstance(vals, list) and vals:
            lines.append(f"- {key.replace('_', ' ').title()}: {'; '.join(str(v) for v in vals[:4])}")
    extracts = summ.get("safe_key_file_extracts") or []
    if extracts:
        lines.append("- Key file extracts:")
        for ex in extracts[:4]:
            lines.append(f"  - {ex.get('path')}: {(ex.get('extract') or '')[:200]}")
    return "\n".join(lines)


def _resolve_target_project(
    projects: List[Dict[str, Any]],
    *,
    project_id: Optional[str] = None,
    focus: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if project_id:
        match = next((p for p in projects if p.get("id") == project_id), None)
        if match:
            return match
    focus = focus or resolve_dynamic_focus()
    focus_projects = focus.get("projects") or []
    if focus_projects:
        return focus_projects[0]
    active = [p for p in projects if (p.get("status") or "").lower() == "active"]
    return active[0] if active else None


def _linked_reports_block(agent_id: str, project_id: Optional[str] = None) -> str:
    reports = load_reports()
    agents = load_agents()
    agent = next((a for a in agents if a.get("id") == agent_id), None)
    history_ids = (agent or {}).get("report_history") or []
    if not isinstance(history_ids, list):
        history_ids = []
    linked: List[Dict[str, Any]] = []
    for rid in history_ids[-5:]:
        r = next((x for x in reports if x.get("id") == rid), None)
        if r:
            linked.append(r)
    if project_id:
        for r in reports[:12]:
            if r.get("project_id") == project_id and r not in linked:
                linked.append(r)
    if not linked:
        return ""
    lines = ["## Previous linked reports"]
    for r in linked[:5]:
        lines.append(
            f"- {r.get('title', 'Report')} ({r.get('status', '')})"
            + (f" — {r.get('summary', '')[:120]}" if r.get("summary") else "")
        )
    return "\n".join(lines)


def _agent_user_context_block(
    agent_id: str,
    *,
    project_id: Optional[str] = None,
) -> str:
    profile = load_aurelius_profile()
    focus = resolve_dynamic_focus()
    active_file = load_active_project()
    projects = load_projects()
    target = _resolve_target_project(projects, project_id=project_id, focus=focus)

    lines = [
        "## Agent context",
        f"- User: {profile.get('name', 'User')} ({profile_address(profile)})",
        f"- Focus rule: {profile.get('focus_selection_rule', '')}",
        f"- Dynamic focus ({focus.get('reason', 'unknown')}): {focus.get('label') or 'none'}",
    ]
    if focus.get("detail"):
        lines.append(f"- Focus detail: {focus['detail']}")
    if active_file and active_file.get("project_id"):
        ap = next((p for p in projects if p.get("id") == active_file["project_id"]), None)
        if ap:
            lines.append(f"- Active project: {ap.get('name')} ({ap.get('id')})")
    if target:
        ch = target.get("recent_changes") or {}
        if ch.get("new_count") or ch.get("modified_count"):
            lines.append(
                f"- Recent changes on {target.get('name')}: "
                f"{ch.get('new_count', 0)} new, {ch.get('modified_count', 0)} modified"
            )
    reports_block = _linked_reports_block(agent_id, project_id or (target or {}).get("id"))
    if reports_block:
        lines.append(reports_block)
    lines.append(
        "Do not assume any fixed focus project unless it appears above, is user-requested, "
        "or is linked to this report/pipeline item."
    )
    return "\n".join(lines)


def _project_context_block(project_id: Optional[str] = None) -> str:
    summaries = load_all_summaries(data_dir())
    if project_id:
        one = load_summary(data_dir(), project_id)
        if one:
            v2 = _v2_context_block(project_id)
            base = format_summaries_for_agents([one])
            return f"{base}\n\n{v2}" if v2 else base
        proj = next((p for p in load_projects() if p.get("id") == project_id), None)
        if proj:
            return (
                f"### {proj.get('name')}\n"
                f"- Path: {proj.get('path')}\n"
                f"- Stack: {', '.join(proj.get('detected_stack') or [])}\n"
                f"- Files: {proj.get('file_count', 0)} (not indexed yet)\n"
            )
    if summaries:
        return format_summaries_for_agents(summaries)
    return "No project summaries indexed yet."


def _build_user_prompt(
    action: str,
    agent_id: str,
    projects: List[Dict[str, Any]],
    *,
    project_id: Optional[str] = None,
) -> str:
    focus = resolve_dynamic_focus()
    focus_projects = focus.get("projects") or []
    listed = focus_projects or [p for p in projects if (p.get("status") or "").lower() == "active"]
    project_lines = "\n".join(
        f"- {p.get('name', 'Project')} ({p.get('priority', '')}): {p.get('description', '')}"
        + (f"\n  Stack: {', '.join(p.get('detected_stack') or [])}" if p.get("detected_stack") else "")
        + (f"\n  Next action: {p.get('suggested_next_action')}" if p.get("suggested_next_action") else "")
        for p in listed
    ) or "No projects in dynamic focus — ask user or scan workspace."
    summary_block = _project_context_block(project_id)
    context_block = _agent_user_context_block(agent_id, project_id=project_id)
    preamble = f"{context_block}\n\n"

    if action == "business_ideas" and agent_id == "research":
        return (
            preamble
            + "Generate the business/app ideas report now using the Atlas context below.\n\n"
            f"Focus projects ({focus.get('reason', 'dynamic')}):\n{project_lines}\n\n"
            "Prioritise ideas aligned with the dynamic focus project(s) above unless broader ideation is clearly better."
        )
    if action == "research_brief" and agent_id == "research":
        return (
            preamble
            + "Compile a research brief covering competitors, APIs, technical approaches, and market patterns "
            "relevant to the focus projects below. Be specific and cite categories of sources to check.\n\n"
            f"Focus projects:\n{project_lines}"
        )
    if action in ("developer_review", "developer_project_review"):
        target = _resolve_target_project(projects, project_id=project_id, focus=focus)
        name = (target or {}).get("name", "the selected project")
        indexed = _project_is_indexed(project_id or (target or {}).get("id"))
        notice = ""
        if project_id and not indexed:
            notice = _not_indexed_notice(project_id) + "\n\n"
        elif action == "developer_project_review" and target and not indexed:
            notice = _not_indexed_notice(target.get("id")) + "\n\n"
        summary_hint = (
            "Use the indexed project summary below for file-level pointers."
            if indexed
            else "Project is not indexed yet. Index it first for a better review."
        )
        return (
            preamble
            + f"Create a developer review plan and Cursor prompt for **{name}**.\n"
            f"{summary_hint}\n"
            "Reference specific files from the project summary when available — do NOT modify files.\n\n"
            f"{notice}"
            f"Project summaries (metadata only):\n{summary_block}\n\n"
            f"Focus projects:\n{project_lines}"
        )
    if action == "architecture_plan":
        target = _resolve_target_project(projects, project_id=project_id, focus=focus)
        primary = (target or {}).get("name", "the selected project")
        return (
            preamble
            + f"Create an architecture plan for **{primary}** using detected stack and important files.\n\n"
            f"Project summaries:\n{summary_block}\n\nFocus projects:\n{project_lines}"
        )
    if action == "marketing_ideas":
        return (
            preamble
            + f"Create marketing launch ideas.\n\nProject summaries:\n{summary_block}\n\nProjects:\n{project_lines}"
        )
    if action == "business_strategy":
        return (
            preamble
            + f"Create business strategy guidance.\n\nProject summaries:\n{summary_block}\n\nProjects:\n{project_lines}"
        )
    if action in ("business_analysis", "monetisation_plan"):
        target = None
        if project_id:
            target = next((p for p in projects if p.get("id") == project_id), None)
        name = (target or {}).get("name", "the selected project")
        return (
            preamble
            + f"Create a business/monetisation analysis for **{name}**.\n"
            "Include revenue models, pricing ideas, and a suggested finance update — "
            "present finance changes as a **suggested update report**, do not assume they are saved.\n\n"
            f"Project summaries:\n{summary_block}\n\nProjects:\n{project_lines}"
        )
    v2_actions = set(ACTION_SPECS.keys()) - {
        "developer_review", "developer_project_review", "research_brief", "business_ideas",
        "marketing_ideas", "business_strategy", "business_analysis", "monetisation_plan",
        "architecture_plan", "sync_agents",
    }
    if action in v2_actions and project_id:
        target = next((p for p in projects if p.get("id") == project_id), None)
        name = (target or {}).get("name", "the project")
        v2 = _v2_context_block(project_id)
        return (
            preamble
            + f"Generate the **{action.replace('_', ' ')}** report for **{name}**.\n"
            "Use V2 project summary and safe key-file extracts below — do NOT assume full codebase access.\n"
            "Include: Executive summary, Findings, Risks, Recommended actions, Suggested next agent.\n\n"
            f"Project context:\n{summary_block}\n\n{v2}\n\nAll projects:\n{project_lines}"
        )
    return (
        preamble
        + f"Generate the report.\n\nProject summaries:\n{summary_block}\n\nProjects:\n{project_lines}"
    )


def _fallback_report(
    action: str,
    agent: Dict[str, Any],
    projects: List[Dict[str, Any]],
    *,
    project_id: Optional[str] = None,
) -> str:
    """Useful offline report when no LLM endpoint is configured."""
    focus = resolve_dynamic_focus()
    focus_label = focus.get("label") or "no project selected yet"
    focus_reason = focus.get("reason", "dynamic")
    name = agent.get("name", "Agent")
    target_proj = _resolve_target_project(projects, project_id=project_id, focus=focus)
    target_name = (target_proj or {}).get("name", "the selected project")
    focus_names = focus.get("names") or [p.get("name") for p in projects if p.get("name")][:3]

    if action == "research_brief":
        project_sections = "\n\n".join(
            f"## {n}\n- Competitor patterns to document\n- APIs and integrations to evaluate\n- Technical approaches to compare"
            for n in (focus_names or ["Focus project"])
        )
        return f"""# Research Brief (offline fallback)

## Executive summary
Competitor, API, and technical landscape scan for **{focus_label}** ({focus_reason}) — offline placeholder.

{project_sections}

## Recommended next research steps
1. Document 5 direct competitors per focus project
2. List integration candidates with pricing tiers
3. Re-run with LLM when endpoint is configured"""

    if action == "business_ideas":
        ideas_for = focus_label if focus_label != "no project selected yet" else "your active workspace projects"
        return f"""# Business Ideas Brief (offline fallback)

Atlas could not reach an LLM endpoint — structured placeholder. Re-run when a model is online.

## Executive summary
Five practical ideas aligned with the user's builder profile and dynamic focus on **{ideas_for}**.

## Ideas
1. **Niche workflow copilot** — AI assistant for the highest-scoring focus project's core workflow.
2. **Viral micro-tool** — Single-purpose SEO/shareable tool matching the focus project's audience.
3. **Ops inbox** — Unified queue where Atlas agents drop reports for approval (meta leverage).
4. **Integration wedge** — One high-value API integration for the focus project's stack.
5. **Concierge pilot** — Manual service validating willingness-to-pay before automation.

## Note
Configure a default chat model in Settings and re-run for tailored ideas."""

    if action in ("developer_review", "developer_project_review"):
        ctx = _project_context_block(project_id or (target_proj or {}).get("id"))
        indexed = _project_is_indexed(project_id or (target_proj or {}).get("id"))
        index_note = ""
        if (project_id or (target_proj or {}).get("id")) and not indexed:
            index_note = "\n\n> **Project is not indexed yet.** Index it first for a better review.\n"
        return f"""# Developer Review Plan (offline fallback)
{index_note}
## Project context (metadata)
{ctx}

## Summary
Structured review plan for **{target_name}** — generated without LLM.

## Scope
- Auth and onboarding flows
- Core domain models and API routes
- Frontend state management and error handling
- Test coverage on critical paths

## Cursor prompt
```
Review the {target_name} codebase for top risks, missing tests, and refactors.
Propose a 3-step implementation plan with file-level pointers. Do not modify files yet.
```

## Quick wins
1. Add smoke tests for primary user journeys
2. Document API contracts for the next feature slice
3. Identify dead code and inconsistent naming"""

    if action == "architecture_plan":
        return f"""# Architecture Plan (offline fallback)

## Summary
High-level system design outline for **{target_name}**.

## Components
- **Core API** — domain events and workflows
- **Data layer** — schema aligned with detected stack
- **AI assist layer** — suggestions and summaries (no auto-execution)
- **Dashboard** — operator view + audit log

## Phases
1. Core workflow + manual AI prompts
2. Integrations + reporting
3. Automation suggestions with human approval"""

    if action == "marketing_ideas":
        angles = "\n".join(
            f"{i + 1}. Positioning angle for **{n}**"
            for i, n in enumerate(focus_names[:3] or ["focus project"])
        )
        return f"""# Marketing Ideas (offline fallback)

## Positioning angles
{angles}

## 7-day micro-launch
- Day 1: landing hero + waitlist
- Day 2: 3 posts with demos
- Day 3: outreach to 10 niche users
- Day 4-7: iterate on one channel that responds"""

    if action in ("business_analysis", "monetisation_plan"):
        return f"""# Business Analysis (offline fallback)

## Project: {target_name}

## Suggested finance update (not saved automatically)
- Review monetisation strategy in Finance → Project Breakdown
- Consider per-seat SaaS + usage tier for {target_name}

## Revenue ideas
1. Pilot pricing with one design partner
2. Freemium wedge with paid automation tier
3. Usage-based pricing for high-value workflows

Re-run with LLM online for a full monetisation plan."""

    if action == "business_strategy":
        focus_lines = "\n".join(
            f"{i + 1}. **{n}** — validate next milestone and one paying design partner"
            for i, n in enumerate(focus_names[:5] or ["Set active or pinned project"])
        )
        return f"""# Business Strategy Brief (offline fallback)

## Dynamic focus ({focus_reason})
{focus_lines}

## 48h validation
- 5 user interviews per focus project
- One paid/manual concierge trial"""

    if action == "sync_agents":
        return f"""# Agent Network Sync

All agents polled at {_now_iso()}.

- Developer: ready for review tasks
- Architect: ready for system design
- Research: idle — run research_brief or business_ideas
- Marketing: check waiting_on fields
- Business: ready for strategy brief

No external actions taken. Reports-only mode active."""

    return f"# {name} Report (offline fallback)\n\nNo LLM endpoint configured. Configure a default chat model in Settings and re-run this action."


def _make_report(
    agent: Dict[str, Any],
    title: str,
    content: str,
    *,
    status: str = "waiting_for_review",
    project_id: Optional[str] = None,
    requires_approval: Optional[bool] = None,
    next_agent: Optional[str] = None,
    action: Optional[str] = None,
) -> Dict[str, Any]:
    summary = _summary_from_content(content)
    council = load_council()
    needs_approval = requires_approval if requires_approval is not None else bool(council.get("approval_required", True))
    report = {
        "id": str(uuid.uuid4()),
        "agent_id": agent.get("id", ""),
        "agent_name": agent.get("name", "Agent"),
        "title": title,
        "status": status,
        "created_at": _now_iso(),
        "summary": summary,
        "content": content,
        "actions": list(REPORT_ACTIONS),
        "requires_approval": needs_approval,
        "findings": summary,
        "risks": "",
        "recommended_actions": "",
        "next_agent_suggestion": next_agent or "",
    }
    if project_id:
        report["project_id"] = project_id
        report["linked_project_id"] = project_id
    if action:
        report["action"] = action
    return report


def _update_agent_after_report(
    agents: List[Dict[str, Any]],
    agent_id: str,
    report: Dict[str, Any],
    *,
    task_label: str,
) -> None:
    for agent in agents:
        if agent.get("id") != agent_id:
            continue
        agent["status"] = "waiting"
        agent["current_task"] = task_label
        agent["last_report"] = report.get("title") or report.get("summary", "")
        agent["waiting_on"] = "User review"
        agent["last_run_at"] = report.get("created_at")
        history = agent.get("report_history")
        if not isinstance(history, list):
            history = []
        history.append(report["id"])
        agent["report_history"] = history[-20:]
        break


_MESSAGE_REPORT_SPECS: Dict[str, Dict[str, Any]] = {
    "research_report": {
        "title": "Research Report",
        "action": "research_brief",
        "format": (
            "## Market overview\n## Competitors\n## Trends\n## Opportunities\n"
            "## Risks\n## Confidence score (1-10 with brief justification)\n## Recommendation"
        ),
    },
    "business_proposal": {
        "title": "Business Proposal",
        "action": "business_strategy",
        "format": (
            "## Revenue model\n## Pricing\n## Audience\n## Cost structure\n"
            "## Expected MRR (estimate)\n## Go / no-go recommendation"
        ),
    },
    "architecture_plan": {
        "title": "Architecture Plan",
        "action": "architecture_plan",
        "format": (
            "## System design\n## Database\n## Pages / routes\n## APIs\n"
            "## MVP / V2 / V3 roadmap"
        ),
    },
    "developer_cursor_prompt": {
        "title": "Developer Cursor Prompt",
        "action": "developer_review",
        "format": (
            "## Cursor prompt (ready to paste)\n## Implementation plan\n"
            "## Files / components\n## Migration plan\n## Tasks"
        ),
    },
    "marketing_launch_plan": {
        "title": "Marketing Launch Plan",
        "action": "marketing_ideas",
        "format": (
            "## Launch plan\n## Instagram / TikTok / SEO\n## Ad copy\n"
            "## Content calendar\n## Posting strategy"
        ),
    },
}

_AGENT_DEFAULT_MESSAGE_TYPE: Dict[str, str] = {
    "research": "research_report",
    "business": "business_proposal",
    "architect": "architecture_plan",
    "developer": "developer_cursor_prompt",
    "marketing": "marketing_launch_plan",
}


def _build_message_prompt(
    agent_id: str,
    message: str,
    *,
    report_type: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Tuple[str, str, str]:
    """Return (user_prompt, title_base, linked_action)."""
    msg = (message or "").strip()
    if not msg:
        msg = "Provide a concise strategic report based on current Atlas context."
    rtype = report_type or _AGENT_DEFAULT_MESSAGE_TYPE.get(agent_id, "research_report")
    spec = _MESSAGE_REPORT_SPECS.get(rtype) or _MESSAGE_REPORT_SPECS["research_report"]
    projects = load_projects()
    context_block = _agent_user_context_block(agent_id, project_id=project_id)
    summary_block = _project_context_block(project_id)
    prompt = (
        f"{context_block}\n\n"
        f"User message to this agent:\n\"{msg}\"\n\n"
        f"Generate a **{spec['title']}** responding to the message above.\n"
        f"Use this structure:\n{spec['format']}\n\n"
        f"Project context:\n{summary_block}\n\n"
        "Be specific, actionable, and grounded in available project data. "
        "Do not execute code or modify files."
    )
    return prompt, spec["title"], spec.get("action") or "research_brief"


def _fallback_message_report(
    agent: Dict[str, Any],
    message: str,
    *,
    report_type: Optional[str] = None,
    project_id: Optional[str] = None,
) -> str:
    rtype = report_type or _AGENT_DEFAULT_MESSAGE_TYPE.get(agent.get("id", ""), "research_report")
    spec = _MESSAGE_REPORT_SPECS.get(rtype) or _MESSAGE_REPORT_SPECS["research_report"]
    projects = load_projects()
    target = _resolve_target_project(projects, project_id=project_id)
    pname = (target or {}).get("name", "selected project")
    query = (message or "").strip() or "General strategic request"
    sections = spec["format"].replace("## ", "\n## ").strip()
    return f"""# {spec['title']} (offline fallback)

## User query
{query}

## Context
Project: **{pname}** — offline placeholder. Configure an LLM endpoint and re-send for a full report.

{sections}

> Re-run after configuring a default chat model in Settings."""


async def run_agent_message(
    agent_id: str,
    message: str,
    *,
    owner: Optional[str] = None,
    project_id: Optional[str] = None,
    report_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Event-driven agent chat — custom user query → structured report."""
    agent_id = (agent_id or "").strip().lower()
    agents = load_agents()
    agent = next((a for a in agents if a.get("id") == agent_id), None)
    if not agent:
        return {"ok": False, "message": "Unknown agent", "queued": False}
    if agent.get("can_run") is False:
        return {"ok": False, "message": f"{agent.get('name', 'Agent')} is not runnable", "queued": False}

    user_prompt, title_base, linked_action = _build_message_prompt(
        agent_id, message, report_type=report_type, project_id=project_id,
    )
    projects = load_projects()
    context = build_cerberus_system_context()
    council_block = council_context_block()
    system = f"{context}\n\n{council_block}\n\n{_AGENT_PROMPTS.get(agent_id, 'Produce a concise, actionable report.')}"

    for a in agents:
        if a.get("id") == agent_id:
            a["status"] = "working"
            a["current_task"] = f"Processing message…"
            break
    save_agents(agents)

    content = await _call_llm(owner, system, user_prompt)
    used_llm = content is not None
    if not content:
        content = _fallback_message_report(
            agent, message, report_type=report_type, project_id=project_id,
        )

    title = title_base
    if project_id:
        pname = next((p.get("name") for p in projects if p.get("id") == project_id), None)
        if pname:
            title = f"{title_base}: {pname}"
    query_snip = (message or "").strip()[:60]
    if query_snip and not project_id:
        title = f"{title_base} — {query_snip}"

    stage = None
    for st, aid in STAGE_AGENTS.items():
        if aid == agent_id:
            stage = st
            break
    stage_next = next_stage(stage) if stage else None

    report = _make_report(
        agent,
        title,
        content,
        project_id=project_id,
        next_agent=STAGE_AGENTS.get(stage_next or "", ""),
        action=linked_action,
    )
    report["source"] = "agent_message"
    report["user_message"] = (message or "").strip()

    reports = load_reports()
    reports.insert(0, report)
    save_reports(reports)

    if project_id:
        try:
            from src.cerberus_projects import record_activity
            record_activity(project_id, "agent_report")
        except Exception:
            pass

    md_path = save_agent_report_markdown(
        agent_id,
        linked_action or "agent_message",
        title,
        content,
        created_at=report.get("created_at"),
    )
    if md_path:
        report["workspace_markdown_path"] = md_path
        reports[0] = report
        save_reports(reports)

    agents = load_agents()
    _update_agent_after_report(
        agents,
        agent_id,
        report,
        task_label=f"Awaiting review: {title}",
    )
    save_agents(agents)

    msg = f"{agent.get('name', 'Agent')} completed: {title}"
    if not used_llm:
        msg += " (offline fallback — no LLM endpoint)"

    return {
        "ok": True,
        "queued": False,
        "completed": True,
        "message": msg,
        "report": report,
        "agents": agents,
        "used_llm": used_llm,
    }


async def run_agent_action(
    agent_id: str,
    action: str,
    *,
    owner: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a report for an agent action. Reports only — no tools or shell."""
    action = normalize_action(action)
    spec = ACTION_SPECS.get(action)
    if not spec:
        return {"ok": False, "message": f"Unknown action: {action}", "queued": False}

    required_agent = spec.get("agent_id")
    if required_agent and required_agent != agent_id:
        return {
            "ok": False,
            "message": f"Action {action} must be run by agent '{required_agent}'",
            "queued": False,
        }

    agents = load_agents()
    if action == "sync_agents":
        content = _fallback_report(action, {"name": "Atlas Core"}, load_projects())
        report = _make_report(
            {"id": "system", "name": "Atlas Core"},
            spec["title"],
            content,
            status="approved",
        )
        reports = load_reports()
        reports.insert(0, report)
        save_reports(reports)
        return {
            "ok": True,
            "queued": False,
            "completed": True,
            "message": "Agent network synced — status summary recorded.",
            "report": report,
            "agents": agents,
        }

    agent = next((a for a in agents if a.get("id") == agent_id), None)
    if not agent:
        return {"ok": False, "message": "Unknown agent", "queued": False}
    if agent.get("can_run") is False:
        return {"ok": False, "message": f"{agent.get('name', 'Agent')} is not runnable", "queued": False}

    projects = load_projects()
    context = build_cerberus_system_context()
    council_block = council_context_block()
    system = f"{context}\n\n{council_block}\n\n{_AGENT_PROMPTS.get(agent_id, 'Produce a concise, actionable report.')}"
    user_prompt = _build_user_prompt(action, agent_id, projects, project_id=project_id)

    # Mark working before LLM (persist so UI can show in-flight state)
    for a in agents:
        if a.get("id") == agent_id:
            a["status"] = "working"
            a["current_task"] = f"Generating {spec['title']}…"
            break
    save_agents(agents)

    content = await _call_llm(owner, system, user_prompt)
    used_llm = content is not None
    if not content:
        content = _fallback_report(action, agent, projects, project_id=project_id)

    title = spec["title"]
    if project_id:
        pname = next((p.get("name") for p in projects if p.get("id") == project_id), None)
        if pname:
            title = f"{spec['title']}: {pname}"
    else:
        focus = resolve_dynamic_focus()
        focus_name = (focus.get("names") or [None])[0]
        if focus_name and action in ("developer_review", "developer_project_review", "architecture_plan"):
            title = f"{spec['title']}: {focus_name}"

    stage_next = None
    for stage, act in STAGE_ACTIONS.items():
        if act == action:
            stage_next = next_stage(stage)
            break
    report = _make_report(
        agent, title, content, project_id=project_id,
        next_agent=STAGE_AGENTS.get(stage_next or "", ""),
        action=action,
    )
    reports = load_reports()
    reports.insert(0, report)
    save_reports(reports)

    if project_id:
        try:
            from src.cerberus_projects import record_activity
            record_activity(project_id, "agent_report")
        except Exception:
            pass

    md_path = save_agent_report_markdown(
        agent_id,
        action,
        title,
        content,
        created_at=report.get("created_at"),
    )
    if md_path:
        report["workspace_markdown_path"] = md_path
        reports[0] = report
        save_reports(reports)

    agents = load_agents()
    _update_agent_after_report(
        agents,
        agent_id,
        report,
        task_label=f"Awaiting review: {title}",
    )
    save_agents(agents)

    msg = f"{agent.get('name', 'Agent')} completed: {title}"
    if not used_llm:
        msg += " (offline fallback — no LLM endpoint)"

    return {
        "ok": True,
        "queued": False,
        "completed": True,
        "message": msg,
        "report": report,
        "agents": agents,
        "used_llm": used_llm,
    }


def apply_report_action(report_id: str, action: str) -> Dict[str, Any]:
    """Lightweight report lifecycle — approve, revise, or archive."""
    action = (action or "").strip().lower()
    if action not in REPORT_ACTIONS:
        return {"ok": False, "message": f"Unknown report action: {action}"}

    reports = load_reports()
    report = next((r for r in reports if r.get("id") == report_id), None)
    if not report:
        return {"ok": False, "message": "Report not found"}

    agents = load_agents()
    agent_id = report.get("agent_id")

    if action == "approve":
        report["status"] = "approved"
        for agent in agents:
            if agent.get("id") == agent_id:
                agent["status"] = "idle"
                agent["waiting_on"] = None
                agent["current_task"] = None
                agent["last_report"] = report.get("title") or report.get("summary", "")
                break
    elif action == "archive":
        report["status"] = "archived"
        for agent in agents:
            if agent.get("id") == agent_id:
                if agent.get("waiting_on") == "User review":
                    agent["waiting_on"] = None
                    agent["status"] = "ready"
                    agent["current_task"] = None
                break
    elif action == "revise":
        report["status"] = "revision_requested"
        for agent in agents:
            if agent.get("id") == agent_id:
                agent["status"] = "ready"
                agent["waiting_on"] = None
                agent["current_task"] = f"Revise: {report.get('title', 'report')}"
                break

    save_reports(reports)
    save_agents(agents)

    return {
        "ok": True,
        "message": f"Report {action}d",
        "report": report,
        "agents": agents,
    }


async def run_council_review(
    project_id: str,
    *,
    owner: Optional[str] = None,
    stage: Optional[str] = None,
) -> Dict[str, Any]:
    """Run one council stage for a project. Does not auto-advance — approval required."""
    council = load_council()
    if not council.get("enabled", True):
        return {"ok": False, "message": "Atlas Council is disabled"}

    stages = list(council.get("stages") or [])
    target_stage = stage or (stages[0] if stages else None)
    if not target_stage or target_stage not in STAGE_ACTIONS:
        return {"ok": False, "message": f"Unknown council stage: {target_stage}"}

    agent_id = STAGE_AGENTS.get(target_stage)
    action = STAGE_ACTIONS.get(target_stage)
    if not agent_id or not action:
        return {"ok": False, "message": "Stage not configured"}

    result = await run_agent_action(agent_id, action, owner=owner, project_id=project_id)
    if not result.get("ok"):
        return result

    following = next_stage(target_stage)
    return {
        **result,
        "council_stage": target_stage,
        "next_stage": following,
        "stopped_for_approval": bool(council.get("approval_required", True)),
        "message": (
            f"Council stage '{target_stage}' complete. "
            + ("Approve before running the next stage." if following else "Council review complete.")
        ),
    }


def reports_for_queue() -> Dict[str, List[Dict[str, Any]]]:
    """Bucket reports for the Agents Office queue UI."""
    reports = load_reports()
    today = _today_utc()
    pending = [r for r in reports if r.get("status") in ("pending", "generating", "revision_requested")]
    approval = [r for r in reports if r.get("status") == "waiting_for_review"]
    completed = [
        r for r in reports
        if r.get("status") == "approved"
        and (r.get("created_at") or "").startswith(today)
    ]
    return {
        "pending": pending,
        "waiting_for_approval": approval,
        "completed_today": completed,
        "all": reports,
    }
