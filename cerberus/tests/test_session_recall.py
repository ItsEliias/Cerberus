"""Tests for proactive session recall injected by ChatProcessor.build_context_preface."""

from unittest.mock import MagicMock, patch

from src.session_search import SessionSearchResult


def _make_processor():
    from src.chat_processor import ChatProcessor
    memory_manager = MagicMock()
    memory_manager.load.return_value = []
    personal_docs = MagicMock()
    personal_docs.rag_manager = None
    return ChatProcessor(memory_manager, personal_docs)


def _make_session(sid, history_count=1):
    sess = MagicMock()
    sess.id = sid
    sess.history = [MagicMock()] * history_count
    return sess


def _make_result(session_id, session_name, snippet="...match..."):
    return SessionSearchResult(
        message_id="m1",
        session_id=session_id,
        session_name=session_name,
        role="user",
        content="full content here",
        content_snippet=snippet,
        timestamp=None,
        context_before=[],
        context_after=[],
    )


def _run_preface(proc, message, session, owner="alice", incognito=False):
    return proc.build_context_preface(
        message=message,
        session=session,
        use_memory=True,
        use_web=False,
        use_rag=False,
        owner=owner,
        incognito=incognito,
    )


def _recall_blocks(preface):
    return [
        m["content"]
        for m in preface
        if m.get("role") == "user" and "past session recall" in m.get("content", "")
    ]


# ── Tests ────────────────────────────────────────────────────────────────────


def test_recall_injects_related_past_session():
    """First-turn message with a matching past session gets a recall block."""
    proc = _make_processor()
    sess = _make_session("current-s", history_count=1)

    past = _make_result("past-s", "Python debugging session", "Python ImportError fix")
    with patch("src.session_search.search_session_messages", return_value=[past]):
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
        )

    blocks = _recall_blocks(preface)
    assert blocks, "Expected a recall block in preface"
    assert "Python debugging session" in blocks[0]


def test_recall_excludes_current_session():
    """Matches inside the current session are not re-injected."""
    proc = _make_processor()
    sess = _make_session("current-s", history_count=1)

    # Only hit is in the current session
    current_hit = _make_result("current-s", "Active session")
    with patch("src.session_search.search_session_messages", return_value=[current_hit]):
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
        )

    assert not _recall_blocks(preface)


def test_recall_skipped_when_use_memory_false():
    """No recall when use_memory=False (incognito-like bypass)."""
    proc = _make_processor()
    sess = _make_session("s", history_count=1)

    with patch("src.session_search.search_session_messages") as mock_search:
        preface, _, _ = proc.build_context_preface(
            message="How do I fix Python ImportError traceback error",
            session=sess,
            use_memory=False,
            use_web=False,
            use_rag=False,
            owner="alice",
            incognito=False,
        )
        mock_search.assert_not_called()

    assert not _recall_blocks(preface)


def test_recall_skipped_in_incognito():
    """No recall in incognito mode (use_memory is forced False)."""
    proc = _make_processor()
    sess = _make_session("s", history_count=1)

    with patch("src.session_search.search_session_messages") as mock_search:
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
            incognito=True,
        )
        mock_search.assert_not_called()

    assert not _recall_blocks(preface)


def test_recall_skipped_for_long_sessions():
    """No recall once the session has > 4 messages (already has rich context)."""
    proc = _make_processor()
    sess = _make_session("s", history_count=5)

    past = _make_result("past-s", "Old session")
    with patch("src.session_search.search_session_messages") as mock_search:
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
        )
        mock_search.assert_not_called()

    assert not _recall_blocks(preface)


def test_recall_skipped_for_short_messages():
    """Messages with < 4 content tokens don't trigger a recall search."""
    proc = _make_processor()
    sess = _make_session("s", history_count=1)

    with patch("src.session_search.search_session_messages") as mock_search:
        preface, _, _ = _run_preface(proc, "hi", sess)
        mock_search.assert_not_called()

    assert not _recall_blocks(preface)


def test_recall_caps_at_two_sessions():
    """Even with many matching past sessions, at most 2 are injected."""
    proc = _make_processor()
    sess = _make_session("current-s", history_count=1)

    many_hits = [_make_result(f"past-{i}", f"Session {i}") for i in range(10)]
    with patch("src.session_search.search_session_messages", return_value=many_hits):
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
        )

    blocks = _recall_blocks(preface)
    assert blocks
    bullet_lines = [l for l in blocks[0].split("\n") if l.startswith("—")]
    assert len(bullet_lines) <= 2


def test_recall_no_block_when_search_returns_nothing():
    """If search finds no hits, no recall block is added."""
    proc = _make_processor()
    sess = _make_session("s", history_count=1)

    with patch("src.session_search.search_session_messages", return_value=[]):
        preface, _, _ = _run_preface(
            proc,
            "How do I fix Python ImportError traceback error",
            sess,
        )

    assert not _recall_blocks(preface)
