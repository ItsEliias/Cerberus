"""Calendar tool retrieval must survive common typos and recipe-word distractions.

Regression: an admin Discord turn "add to calander for tongiht 6pm remind liv
to start mince and eggs" failed because:

  * ToolIndex._KEYWORD_HINTS only matched "calendar"/"event"/"meeting"/...
    so "calander" was a miss and only manage_notes ("remind") was force-included.
  * _classify_agent_request used the same vocabulary in its regex, so the
    "notes_calendar_tasks" domain never fired.
  * The recipe-ish words ("mince and eggs") triggered the "cookbook" domain,
    which crowded the retrieval budget with serve_/download_ tools.

These tests pin both fixes:

  1. Keyword-hint typos / plurals in src/tool_index.py
  2. Regex typos in src/agent_loop._classify_agent_request
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from src.tool_index import ToolIndex
from src.agent_loop import _classify_agent_request


def _keyword_hits(query: str) -> set[str]:
    """Replay get_tools_for_query's keyword-hint loop without the embedder.

    The real ToolIndex needs vector-DB infrastructure to construct; this
    function exercises the same regex match against the class-level
    _KEYWORD_HINTS so we can unit-test the keyword tier in isolation.
    """
    ql = query.lower()
    tools: set[str] = set()
    for keywords, hinted in ToolIndex._KEYWORD_HINTS.items():
        if any(re.search(rf"\b{re.escape(kw)}\b", ql) for kw in keywords):
            tools.update(hinted)
    return tools


# ---------------------------------------------------------------------------
# Keyword-hint tier — src/tool_index.py
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "query",
    [
        "add to calander tonight 6pm",
        "put it on my calander please",
        "calander event tomorrow",
    ],
)
def test_calander_typo_surfaces_manage_calendar(query):
    assert "manage_calendar" in _keyword_hits(query)


@pytest.mark.parametrize(
    "query",
    [
        "add to my calender for 9am",
        "my calender is full",
    ],
)
def test_calender_typo_surfaces_manage_calendar(query):
    assert "manage_calendar" in _keyword_hits(query)


@pytest.mark.parametrize(
    "query",
    [
        "remind me about meeting",
        "remind me about the meeting at 5",
        "reminder for the 3pm appointment",
    ],
)
def test_remind_plus_meeting_surfaces_manage_calendar(query):
    tools = _keyword_hits(query)
    assert "manage_calendar" in tools
    # Notes still co-fires — calendar reminders are also routed through Notes.
    assert "manage_notes" in tools


def test_real_discord_message_surfaces_calendar_despite_recipe_words():
    """The exact message from the bug report. Calendar must not be crowded out."""
    query = "add to calander for tongiht 6pm remind liv to start mince and eggs"
    tools = _keyword_hits(query)
    assert "manage_calendar" in tools, f"calendar missing — got {sorted(tools)}"
    # "remind" should also surface notes, same as before the fix.
    assert "manage_notes" in tools


def test_plural_event_meeting_forms_match():
    """Plural variants must hit too — "set my meetings up" once missed."""
    assert "manage_calendar" in _keyword_hits("show me my meetings tomorrow")
    assert "manage_calendar" in _keyword_hits("clear my appointments next week")
    assert "manage_calendar" in _keyword_hits("list events this weekend")


def test_unrelated_message_does_not_surface_calendar():
    """Word-boundary matching prevents typo keywords from over-firing."""
    # Substring "event" inside "eventually" must NOT trigger.
    assert "manage_calendar" not in _keyword_hits("eventually i'll buy a car")
    # Unrelated message shouldn't pull calendar in via the typo set either.
    assert "manage_calendar" not in _keyword_hits("hello there")


# ---------------------------------------------------------------------------
# Domain-classifier tier — src/agent_loop._classify_agent_request
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "query",
    [
        "add to calander tonight 6pm",
        "put on my calender please",
        "schedule a meeting tomorrow",
        "what's on my calendar today",
    ],
)
def test_classifier_picks_notes_calendar_tasks_domain(query):
    out = _classify_agent_request([], query)
    assert "notes_calendar_tasks" in out["domains"], (
        f"expected notes_calendar_tasks domain for {query!r}, got {out['domains']}"
    )


def test_classifier_real_discord_message_picks_calendar_and_cookbook():
    """The exact Discord turn — cookbook still fires (mince/eggs) but calendar
    must also be detected so _DOMAIN_TOOL_MAP unions manage_calendar in."""
    query = "add to calander for tongiht 6pm remind liv to start mince and eggs"
    out = _classify_agent_request([], query)
    assert "notes_calendar_tasks" in out["domains"], out["domains"]
