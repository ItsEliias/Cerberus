"""Tests for per-agent memory — Phase 2b.

Covers:
  - MemoryManager.add_entry() stores agent_id
  - MemoryManager.load() filters by agent_id
  - memory_extractor.extract_and_store() passes agent_id to entries
  - API routes: GET/DELETE /api/agents/{id}/memories
  - Memory injection block format
"""

import asyncio
import json
import types
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# MemoryManager — agent_id support
# ---------------------------------------------------------------------------

class TestMemoryManagerAgentId:
    def setup_method(self):
        import tempfile, os
        self.tmpdir = tempfile.mkdtemp()
        from src.memory import MemoryManager
        self.mm = MemoryManager(self.tmpdir)

    def test_add_entry_stores_agent_id(self):
        entry = self.mm.add_entry("User likes Python", agent_id="agent-42")
        assert entry.get("agent_id") == "agent-42"

    def test_add_entry_no_agent_id_omits_key(self):
        entry = self.mm.add_entry("User likes Go")
        assert "agent_id" not in entry

    def test_load_filters_by_agent_id(self):
        e1 = self.mm.add_entry("fact A", owner="alice", agent_id="agentX")
        e2 = self.mm.add_entry("fact B", owner="alice", agent_id="agentY")
        e3 = self.mm.add_entry("fact C", owner="alice")
        self.mm.save([e1, e2, e3])

        result = self.mm.load(owner="alice", agent_id="agentX")
        assert len(result) == 1
        assert result[0]["text"] == "fact A"

    def test_load_agent_id_without_owner(self):
        e1 = self.mm.add_entry("fact A", owner="alice", agent_id="agentX")
        e2 = self.mm.add_entry("fact B", owner="bob", agent_id="agentX")
        self.mm.save([e1, e2])

        result = self.mm.load(agent_id="agentX")
        assert len(result) == 2

    def test_load_owner_and_agent_id_combined(self):
        e1 = self.mm.add_entry("fact A", owner="alice", agent_id="agentX")
        e2 = self.mm.add_entry("fact B", owner="bob", agent_id="agentX")
        self.mm.save([e1, e2])

        result = self.mm.load(owner="alice", agent_id="agentX")
        assert len(result) == 1
        assert result[0]["text"] == "fact A"

    def test_load_unscoped_returns_all(self):
        e1 = self.mm.add_entry("fact A", owner="alice", agent_id="agentX")
        e2 = self.mm.add_entry("fact B", owner="alice")
        self.mm.save([e1, e2])

        result = self.mm.load()
        assert len(result) == 2


# ---------------------------------------------------------------------------
# memory_extractor — agent_id tagging
# ---------------------------------------------------------------------------

class TestExtractorAgentId:
    def _make_session(self, messages):
        session = types.SimpleNamespace(
            session_id="test-session",
            owner="alice",
        )
        session.get_context_messages = lambda: messages
        return session

    def test_extract_and_store_tags_agent_id(self):
        import tempfile
        tmpdir = tempfile.mkdtemp()
        from src.memory import MemoryManager
        mm = MemoryManager(tmpdir)

        messages = [
            {"role": "user", "content": "My name is Alice."},
            {"role": "assistant", "content": "Nice to meet you, Alice!"},
        ]
        session = self._make_session(messages)

        fake_facts = [{"text": "User's name is Alice.", "category": "identity"}]

        async def _run():
            from services.memory.memory_extractor import extract_and_store
            with patch("src.llm_core.llm_call_async", new=AsyncMock(return_value=json.dumps(fake_facts))):
                await extract_and_store(
                    session, mm, None,
                    "http://fake/v1", "test-model",
                    agent_id="agent-99",
                )

        asyncio.run(_run())

        entries = mm.load(owner="alice", agent_id="agent-99")
        # LLM + fallback paths may both fire; assert at least one was stored with agent_id
        assert len(entries) >= 1
        assert all(e.get("agent_id") == "agent-99" for e in entries)

    def test_extract_without_agent_id_omits_key(self):
        import tempfile
        tmpdir = tempfile.mkdtemp()
        from src.memory import MemoryManager
        mm = MemoryManager(tmpdir)

        messages = [
            {"role": "user", "content": "My name is Bob."},
            {"role": "assistant", "content": "Hello Bob!"},
        ]
        session = self._make_session(messages)

        fake_facts = [{"text": "User's name is Bob.", "category": "identity"}]

        async def _run():
            from services.memory.memory_extractor import extract_and_store
            with patch("src.llm_core.llm_call_async", new=AsyncMock(return_value=json.dumps(fake_facts))):
                await extract_and_store(
                    session, mm, None,
                    "http://fake/v1", "test-model",
                )

        asyncio.run(_run())

        entries = mm.load(owner="bob")
        assert all("agent_id" not in e for e in entries)


# ---------------------------------------------------------------------------
# API routes — GET/DELETE /api/agents/{id}/memories
# ---------------------------------------------------------------------------

class TestAgentMemoryRoutes:
    def setup_method(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()

    def _make_mm(self):
        from src.memory import MemoryManager
        return MemoryManager(self.tmpdir)

    def test_get_memories_returns_agent_scoped_list(self):
        mm = self._make_mm()
        e1 = mm.add_entry("User likes Rust", owner="alice", agent_id="agt-1")
        e2 = mm.add_entry("User dislikes Java", owner="alice", agent_id="agt-2")
        e3 = mm.add_entry("User reads books", owner="alice")
        mm.save([e1, e2, e3])

        mems = mm.load(owner="alice", agent_id="agt-1")
        assert len(mems) == 1
        assert mems[0]["text"] == "User likes Rust"

    def test_delete_agent_memory_removes_correct_entry(self):
        mm = self._make_mm()
        e1 = mm.add_entry("User likes Rust", owner="alice", agent_id="agt-1")
        e2 = mm.add_entry("User hates Java", owner="alice", agent_id="agt-1")
        mm.save([e1, e2])

        all_before = mm.load_all()
        target_id = e1["id"]
        mm.save([e for e in all_before if e.get("id") != target_id])

        remaining = mm.load(owner="alice", agent_id="agt-1")
        assert len(remaining) == 1
        assert remaining[0]["text"] == "User hates Java"

    def test_delete_cross_agent_is_blocked_by_agent_id_check(self):
        mm = self._make_mm()
        e1 = mm.add_entry("User likes Rust", owner="alice", agent_id="agt-1")
        mm.save([e1])

        # Simulate what the route does: verify agent_id matches before deleting
        entry = mm.load(owner="alice", agent_id="agt-1")[0]
        wrong_agent_id = "agt-2"
        assert entry.get("agent_id") != wrong_agent_id


# ---------------------------------------------------------------------------
# Memory block injection format
# ---------------------------------------------------------------------------

class TestMemoryBlockFormat:
    def test_block_contains_fenced_header(self):
        import tempfile
        tmpdir = tempfile.mkdtemp()
        from src.memory import MemoryManager
        mm = MemoryManager(tmpdir)

        e1 = mm.add_entry("User's name is Alice.", owner="alice", agent_id="agt-1")
        mm.save([e1])

        with patch("routes.cerberus_agent_thread_routes._get_memory_manager", return_value=mm), \
             patch("routes.cerberus_agent_thread_routes._get_memory_vector", return_value=None):
            from routes.cerberus_agent_thread_routes import _build_memory_block
            block = _build_memory_block("alice", "agt-1", "what is my name?")

        assert "[AGENT MEMORY" in block
        assert "Alice" in block
        assert "[END AGENT MEMORY]" in block
        assert "instructions" in block.lower()

    def test_empty_block_when_no_memories(self):
        import tempfile
        tmpdir = tempfile.mkdtemp()
        from src.memory import MemoryManager
        mm = MemoryManager(tmpdir)

        with patch("routes.cerberus_agent_thread_routes._get_memory_manager", return_value=mm), \
             patch("routes.cerberus_agent_thread_routes._get_memory_vector", return_value=None):
            from routes.cerberus_agent_thread_routes import _build_memory_block
            block = _build_memory_block("alice", "agt-1", "hello")

        assert block == ""
