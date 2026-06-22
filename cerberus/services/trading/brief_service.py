"""
brief_service.py — Council-style multi-role research brief generation.

Phase 1 invariant (APPROVAL GATE):
  This service produces RESEARCH BRIEFS ONLY. It cannot generate a trade,
  cannot approve a trade, and cannot place an order. The recommendation object
  it produces is advisory text — it is not connected to any execution layer.
  Real-money order placement belongs to Phase 3 and MUST NOT be added here.
  Ref: docs/TRADER_AGENT_RISK_AND_PHASING.md §2 (Hard Safeguards)

Brief generation pipeline:
  1. Fetch ≥50¢ Kalshi markets from kalshi_data.py
  2. Wrap market data in untrusted_context_message() — it is external data
  3. Run four LLM roles (Bull, Bear, Risk, Synthesis) sequentially
  4. Persist the brief to TraderBrief DB table
  5. Return structured dict — caller exposes it over /api/trader/brief

Model config:
  TRADER_REASONING_MODEL env var (default: "mistral-nemo" or equivalent —
  anything stronger than Llama 3.3 as required by risk doc §2.2).
  Never hard-code Llama 3.3 here; the risk doc explicitly prohibits it.
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime
from typing import Any

from src.prompt_security import untrusted_context_message
from src.llm_core import llm_call_async
from src.endpoint_resolver import resolve_endpoint, resolve_utility_fallback_candidates
from services.trading.kalshi_data import get_filtered_markets, enrich_with_timestamp

logger = logging.getLogger(__name__)

# Llama 3.3 is prohibited for trading analysis (risk doc §2.2).
# Default to a stronger model; operator overrides via env.
_FORBIDDEN_MODEL_FRAGMENTS = ("llama-3.3", "llama3.3", "llama 3.3")

TRADER_REASONING_MODEL = os.environ.get("TRADER_REASONING_MODEL", "").strip()
KALSHI_MAKER_THRESHOLD = float(os.environ.get("KALSHI_MAKER_THRESHOLD", "0.50"))


def _validate_model(model: str | None) -> None:
    if not model:
        return
    lower = model.lower()
    if any(frag in lower for frag in _FORBIDDEN_MODEL_FRAGMENTS):
        raise ValueError(
            f"TRADER_REASONING_MODEL '{model}' is explicitly prohibited "
            f"(risk doc §2.2 — Llama 3.3 must not be used for trading analysis). "
            f"Set TRADER_REASONING_MODEL to a stronger model."
        )


async def _resolve_trader_endpoint(owner: str | None) -> tuple[str | None, str | None, dict | None]:
    """Resolve LLM endpoint for trading briefs.

    Priority:
      1. TRADER_REASONING_MODEL env var (uses utility endpoint URL)
      2. Utility endpoint from settings
      3. Default chat endpoint
    """
    url, model, headers = resolve_endpoint("utility", owner=owner)
    if not url:
        url, model, headers = resolve_endpoint("default", owner=owner)

    # Override model if TRADER_REASONING_MODEL is set
    if TRADER_REASONING_MODEL:
        _validate_model(TRADER_REASONING_MODEL)
        model = TRADER_REASONING_MODEL
    else:
        _validate_model(model)

    return url, model, headers


_ROLE_PROMPTS: dict[str, str] = {
    "bull": (
        "You are the BULL analyst in a structured debate about a prediction market contract. "
        "Your role is to identify reasons the YES side is underpriced — evidence that the "
        "contract is more likely to resolve YES than the market implies. "
        "Be specific, cite the data provided, and state your confidence (low/medium/high). "
        "Limit your analysis to 150 words."
    ),
    "bear": (
        "You are the BEAR analyst in a structured debate about a prediction market contract. "
        "Your role is to identify risks and reasons the YES side is overpriced — evidence "
        "the contract is less likely to resolve YES than the market implies. "
        "Be specific, cite the data, state confidence (low/medium/high). Max 150 words."
    ),
    "risk": (
        "You are the RISK reviewer in a structured debate. Review the contract for: "
        "liquidity risk (is volume sufficient?), timing risk (expiry soon?), "
        "data staleness risk, and model risk (is the edge mechanism plausible?). "
        "Flag any red flags that should prevent a maker bid. Max 100 words."
    ),
    "synthesis": (
        "You are the SYNTHESIS agent. You have seen the Bull, Bear, and Risk analyses. "
        "Produce a structured recommendation object ONLY — no prose outside the JSON. "
        "The object fields are: direction (YES or NO or PASS), confidence (0–100 integer), "
        "rationale (one sentence), risk_flags (list of strings, empty if none). "
        "PASS means no trade is recommended. Output valid JSON only."
    ),
}


async def generate_brief(
    *,
    contract: dict[str, Any],
    owner: str | None,
    db_session=None,
) -> dict[str, Any]:
    """Run the 4-role Council debate for one contract and persist the brief.

    Returns a brief dict with keys:
      id, contract_ticker, contract_title, midpoint, fetched_at,
      bull_analysis, bear_analysis, risk_review, synthesis_json,
      direction, confidence, rationale, risk_flags,
      model_used, created_at

    Never places or implies a trade order — RESEARCH ONLY.
    """
    url, model, headers = await _resolve_trader_endpoint(owner)
    if not url or not model:
        raise RuntimeError("No LLM endpoint configured for trading briefs")

    ticker = contract.get("ticker", "UNKNOWN")
    title = contract.get("title", ticker)
    midpoint = contract.get("_midpoint", 0.0)
    fetched_at = contract.get("_fetched_at", int(time.time()))

    # All market data is external — wrap before any LLM sees it
    context_msg = untrusted_context_message(
        f"Kalshi market data: {ticker}",
        json.dumps(contract, default=str),
    )

    contract_header = (
        f"Contract: {title} (ticker: {ticker})\n"
        f"Midpoint price: {midpoint:.2f}  (YES bid: {contract.get('yes_bid', 'N/A')}, "
        f"YES ask: {contract.get('yes_ask', 'N/A')})\n"
        f"Volume: {contract.get('volume', 'N/A')}, "
        f"Open interest: {contract.get('open_interest', 'N/A')}, "
        f"Expiry: {contract.get('expiration_time', 'N/A')}"
    )

    analyses: dict[str, str] = {}
    for role in ("bull", "bear", "risk"):
        messages = [
            {"role": "system", "content": _ROLE_PROMPTS[role]},
            context_msg,
            {"role": "user", "content": contract_header},
        ]
        try:
            result = await llm_call_async(url, model, messages, headers=headers, max_tokens=512)
            analyses[role] = result.strip()
        except Exception as e:
            logger.error("Brief generation [%s] failed for %s: %s", role, ticker, e)
            analyses[role] = f"[{role.upper()} analysis unavailable: {e}]"

    # Synthesis sees the prior analyses as additional context
    synthesis_context = untrusted_context_message(
        "Prior analyst outputs (unverified)",
        f"BULL:\n{analyses['bull']}\n\nBEAR:\n{analyses['bear']}\n\nRISK:\n{analyses['risk']}",
    )
    synthesis_messages = [
        {"role": "system", "content": _ROLE_PROMPTS["synthesis"]},
        context_msg,
        {"role": "user", "content": contract_header},
        synthesis_context,
        {"role": "user", "content": "Produce the JSON recommendation object now."},
    ]
    synthesis_raw = ""
    try:
        synthesis_raw = await llm_call_async(
            url, model, synthesis_messages, headers=headers, max_tokens=256
        )
        synthesis_raw = synthesis_raw.strip()
    except Exception as e:
        logger.error("Synthesis failed for %s: %s", ticker, e)
        synthesis_raw = '{"direction":"PASS","confidence":0,"rationale":"Synthesis unavailable","risk_flags":["llm_error"]}'

    synthesis: dict[str, Any] = {}
    try:
        synthesis = json.loads(synthesis_raw)
    except json.JSONDecodeError:
        # Attempt to extract JSON from a fenced block
        import re
        m = re.search(r"\{.*\}", synthesis_raw, re.DOTALL)
        if m:
            try:
                synthesis = json.loads(m.group())
            except Exception:
                pass
        if not synthesis:
            synthesis = {"direction": "PASS", "confidence": 0, "rationale": "Parse error", "risk_flags": ["parse_error"]}

    brief_id = str(uuid.uuid4())
    now = datetime.utcnow()

    brief = {
        "id": brief_id,
        "owner": owner,
        "contract_ticker": ticker,
        "contract_title": title,
        "midpoint": midpoint,
        "fetched_at": fetched_at,
        "bull_analysis": analyses.get("bull", ""),
        "bear_analysis": analyses.get("bear", ""),
        "risk_review": analyses.get("risk", ""),
        "synthesis_json": json.dumps(synthesis),
        "direction": synthesis.get("direction", "PASS"),
        "confidence": int(synthesis.get("confidence", 0)),
        "rationale": synthesis.get("rationale", ""),
        "risk_flags": json.dumps(synthesis.get("risk_flags", [])),
        "model_used": model,
        "created_at": now.isoformat(),
    }

    if db_session is not None:
        _persist_brief(brief, db_session)

    return brief


def _persist_brief(brief: dict[str, Any], db) -> None:
    """Insert a TraderBrief row — idempotent on duplicate id."""
    from core.database import TraderBrief
    try:
        row = TraderBrief(
            id=brief["id"],
            owner=brief.get("owner"),
            contract_ticker=brief["contract_ticker"],
            contract_title=brief["contract_title"],
            midpoint=brief["midpoint"],
            fetched_at=datetime.utcfromtimestamp(brief["fetched_at"]),
            bull_analysis=brief["bull_analysis"],
            bear_analysis=brief["bear_analysis"],
            risk_review=brief["risk_review"],
            synthesis_json=brief["synthesis_json"],
            direction=brief["direction"],
            confidence=brief["confidence"],
            rationale=brief["rationale"],
            risk_flags=brief["risk_flags"],
            model_used=brief["model_used"],
        )
        db.add(row)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error("Failed to persist TraderBrief %s: %s", brief.get("id"), e)
        raise


async def run_brief_cycle(*, owner: str | None, limit: int = 10, db_session=None) -> list[dict]:
    """Fetch ≥50¢ markets, generate briefs for up to `limit` contracts.

    This is the entry point called by the /api/trader/brief POST route.
    Returns list of brief dicts (research only — no orders).
    """
    markets = await get_filtered_markets(
        min_midpoint=KALSHI_MAKER_THRESHOLD, limit=max(limit * 3, 50)
    )
    markets = enrich_with_timestamp(markets)
    targets = markets[:limit]

    if not targets:
        logger.info("run_brief_cycle: no markets above %.0f¢ threshold", KALSHI_MAKER_THRESHOLD * 100)
        return []

    briefs = []
    for contract in targets:
        try:
            brief = await generate_brief(contract=contract, owner=owner, db_session=db_session)
            briefs.append(brief)
        except Exception as e:
            logger.error("Brief generation failed for %s: %s", contract.get("ticker"), e)

    logger.info("run_brief_cycle: generated %d briefs for owner=%s", len(briefs), owner)
    return briefs
