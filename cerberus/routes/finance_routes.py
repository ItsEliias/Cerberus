"""Finance routes — LLM cost & usage summary for the FINANCE CC tab.

Rate is configurable via LLM_COST_PER_TOKEN env var (default 0.000003,
matching the rate in session_routes.py). Set to 0 for free-tier plans
(e.g. Groq free tier) — token consumption is still tracked.
"""
import os
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Request

from core.database import Session as DbSession, CerberusAgent, SessionLocal
from src.auth_helpers import require_user

logger = logging.getLogger(__name__)

_LOCAL_HINTS = ("localhost", "127.", "0.0.0.0", "::1")
_DEFAULT_RATE = 0.000003
_BREAKDOWN_CAP = 8


def _is_local(url: str | None) -> bool:
    if not url:
        return True
    return any(h in url for h in _LOCAL_HINTS)


def _cost_rate() -> float:
    try:
        return float(os.environ.get("LLM_COST_PER_TOKEN", _DEFAULT_RATE))
    except (TypeError, ValueError):
        return _DEFAULT_RATE


def setup_finance_routes() -> APIRouter:
    router = APIRouter(prefix="/api/finance", tags=["finance"])

    @router.get("/summary")
    def finance_summary(request: Request):
        from sqlalchemy import func

        owner = require_user(request)
        rate = _cost_rate()
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            cutoff_30 = now - timedelta(days=30)

            # ── This-month session tokens ──────────────────────────────────
            sess_agg = db.query(
                func.coalesce(func.sum(DbSession.total_input_tokens), 0).label("si"),
                func.coalesce(func.sum(DbSession.total_output_tokens), 0).label("so"),
            ).filter(
                DbSession.owner == owner,
                DbSession.created_at >= month_start,
            ).one()
            sess_in = int(sess_agg.si)
            sess_out = int(sess_agg.so)

            # ── Agent token totals ─────────────────────────────────────────
            agent_rows = db.query(
                CerberusAgent.name,
                CerberusAgent.model_alias,
                CerberusAgent.total_input_tokens,
                CerberusAgent.total_output_tokens,
                CerberusAgent.last_run_url,
            ).filter(CerberusAgent.owner == owner).all()

            agent_in = sum(int(r.total_input_tokens or 0) for r in agent_rows)
            agent_out = sum(int(r.total_output_tokens or 0) for r in agent_rows)

            total_in = sess_in + agent_in
            total_out = sess_out + agent_out
            total = total_in + total_out

            # ── Paid-token count (non-local only) ─────────────────────────
            paid = 0
            sess_urls = db.query(
                DbSession.total_input_tokens,
                DbSession.total_output_tokens,
                DbSession.endpoint_url,
            ).filter(
                DbSession.owner == owner,
                DbSession.created_at >= month_start,
            ).all()
            for r in sess_urls:
                if not _is_local(r.endpoint_url):
                    paid += int(r.total_input_tokens or 0) + int(r.total_output_tokens or 0)
            for r in agent_rows:
                if not _is_local(r.last_run_url):
                    paid += int(r.total_input_tokens or 0) + int(r.total_output_tokens or 0)

            estimated_cost = round(paid * rate, 6)

            # ── 30-day by-day breakdown (zero-filled to exactly 30 entries) ─
            daily_q = db.query(
                func.date(DbSession.created_at).label("day"),
                func.sum(
                    DbSession.total_input_tokens + DbSession.total_output_tokens
                ).label("tokens"),
            ).filter(
                DbSession.owner == owner,
                DbSession.created_at >= cutoff_30,
            ).group_by(func.date(DbSession.created_at)).order_by("day").all()

            day_map = {str(r.day): int(r.tokens or 0) for r in daily_q}
            by_day = []
            for i in range(30):
                d = (cutoff_30 + timedelta(days=i + 1)).date()
                tokens = day_map.get(str(d), 0)
                by_day.append({
                    "date": str(d),
                    "tokens": tokens,
                    "cost": round(tokens * rate, 6),
                })

            # ── By-agent top 8 ────────────────────────────────────────────
            by_agent = sorted(
                [
                    {
                        "name": str(r.name),
                        "model": str(r.model_alias or "—"),
                        "tokens": int(r.total_input_tokens or 0) + int(r.total_output_tokens or 0),
                    }
                    for r in agent_rows
                    if (int(r.total_input_tokens or 0) + int(r.total_output_tokens or 0)) > 0
                ],
                key=lambda x: x["tokens"],
                reverse=True,
            )[:_BREAKDOWN_CAP]
            for a in by_agent:
                a["cost"] = round(a["tokens"] * rate, 6)

            # ── By-model top 8 (agents + session endpoint hostnames) ──────
            model_map: dict[str, int] = {}
            for r in agent_rows:
                m = str(r.model_alias or "—")
                model_map[m] = model_map.get(m, 0) + int(r.total_input_tokens or 0) + int(r.total_output_tokens or 0)
            sess_model_q = db.query(
                DbSession.endpoint_url,
                func.sum(
                    DbSession.total_input_tokens + DbSession.total_output_tokens
                ).label("tokens"),
            ).filter(DbSession.owner == owner).group_by(DbSession.endpoint_url).all()
            for row in sess_model_q:
                label = (row.endpoint_url or "local").split("//")[-1].split("/")[0][:32] or "local"
                tokens = int(row.tokens or 0)
                if tokens:
                    model_map[label] = model_map.get(label, 0) + tokens
            by_model = sorted(
                [{"model": m, "tokens": t, "cost": round(t * rate, 6)} for m, t in model_map.items() if t > 0],
                key=lambda x: x["tokens"],
                reverse=True,
            )[:_BREAKDOWN_CAP]

            # ── Projected monthly ─────────────────────────────────────────
            daily_avg = sum(d["tokens"] for d in by_day) / 30
            projected_tokens = round(daily_avg * 30)
            projected_cost = round(daily_avg * 30 * rate, 6)

            return {
                "total_tokens": total,
                "input_tokens": total_in,
                "output_tokens": total_out,
                "estimated_cost": estimated_cost,
                "by_day": by_day,
                "by_agent": by_agent,
                "by_model": by_model,
                "projected_monthly_tokens": projected_tokens,
                "projected_monthly_cost": projected_cost,
                "is_free_tier": estimated_cost == 0.0,
                "rate": rate,
            }
        finally:
            db.close()

    return router
