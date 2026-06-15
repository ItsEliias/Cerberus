"""Atlas personal finance — bills, work days, deductions (local/manual only)."""

from __future__ import annotations

import json
import logging
import os
import uuid
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.cerberus_config import data_dir

logger = logging.getLogger(__name__)

DEFAULT_FULL_DAY_RATE = 0.0
DEFAULT_HALF_DAY_RATE = 0.0

DEFAULT_PERSONAL_FINANCE: Dict[str, Any] = {
    "bills": [],
    "work_log": [],
    "weekly_deductions": [],
    "settings": {
        "full_day_rate": 0,
        "half_day_rate": 0,
        "payout_weekday": 5,
    },
    "calendar_reminders": [],
}

_LEGACY_SEED_IDS = frozenset({"car-rental"})
_LEGACY_RATES = {134.61, 67.305}


def _sanitize_legacy_seed(data: Dict[str, Any]) -> Dict[str, Any]:
    """Strip bundled demo/personal finance seed data from existing installs."""
    out = dict(data)
    deds = out.get("weekly_deductions") or []
    if isinstance(deds, list):
        out["weekly_deductions"] = [
            d for d in deds
            if isinstance(d, dict) and (d.get("id") or "") not in _LEGACY_SEED_IDS
        ]
    settings = dict(out.get("settings") or {})
    if settings.get("full_day_rate") in _LEGACY_RATES:
        settings["full_day_rate"] = 0
    if settings.get("half_day_rate") in _LEGACY_RATES:
        settings["half_day_rate"] = 0
    out["settings"] = settings
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _personal_path() -> Path:
    return data_dir() / "personal_finance.json"


def load_personal_finance() -> Dict[str, Any]:
    path = _personal_path()
    data_dir().mkdir(parents=True, exist_ok=True)
    if not path.exists():
        save_personal_finance(dict(DEFAULT_PERSONAL_FINANCE))
        return dict(DEFAULT_PERSONAL_FINANCE)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return dict(DEFAULT_PERSONAL_FINANCE)
        merged = dict(DEFAULT_PERSONAL_FINANCE)
        merged.update(data)
        cleaned = _sanitize_legacy_seed(merged)
        if cleaned != merged:
            save_personal_finance(cleaned)
        return cleaned
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("[cerberus-finance] personal read failed: %s", exc)
        return dict(DEFAULT_PERSONAL_FINANCE)


def save_personal_finance(data: Dict[str, Any]) -> Dict[str, Any]:
    path = _personal_path()
    tmp = path.with_suffix(".json.tmp")
    payload = dict(DEFAULT_PERSONAL_FINANCE)
    payload.update(data)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    return payload


def _parse_date(s: str) -> Optional[date]:
    try:
        return date.fromisoformat((s or "")[:10])
    except ValueError:
        return None


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _next_due(bill: Dict[str, Any], today: date) -> Optional[date]:
    freq = (bill.get("frequency") or "monthly").lower()
    due_day = bill.get("due_day")
    due_date = _parse_date(bill.get("due_date") or bill.get("next_due_date") or "")
    if freq == "one-off" and due_date:
        return due_date if due_date >= today else None
    if freq == "weekly":
        base = due_date or today
        while base < today:
            base += timedelta(days=7)
        return base
    if freq == "yearly":
        base = due_date or date(today.year, due_day or 1, 1) if due_day else today
        while base < today:
            base = date(base.year + 1, base.month, base.day)
        return base
    # monthly default
    day = int(due_day or (due_date.day if due_date else 1))
    candidate = date(today.year, today.month, min(day, monthrange(today.year, today.month)[1]))
    if candidate < today:
        candidate = _add_months(candidate, 1)
        candidate = date(candidate.year, candidate.month, min(day, monthrange(candidate.year, candidate.month)[1]))
    return candidate


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _week_end(d: date) -> date:
    return _week_start(d) + timedelta(days=6)


def _friday_of_week(d: date) -> date:
    return _week_start(d) + timedelta(days=4)


def work_amount(entry_type: str, custom: float = 0, settings: Optional[Dict[str, Any]] = None) -> float:
    s = settings or {}
    full = float(s.get("full_day_rate") or DEFAULT_FULL_DAY_RATE)
    half = float(s.get("half_day_rate") or DEFAULT_HALF_DAY_RATE)
    t = (entry_type or "full").lower().replace(" ", "_")
    if t in ("half", "half_day"):
        return half
    if t == "custom":
        return float(custom or 0)
    return full


def add_bill(bill: Dict[str, Any]) -> Dict[str, Any]:
    data = load_personal_finance()
    bills = data.get("bills") or []
    entry = {
        "id": bill.get("id") or str(uuid.uuid4())[:8],
        "name": (bill.get("name") or "Bill").strip(),
        "amount": float(bill.get("amount") or 0),
        "due_day": bill.get("due_day"),
        "due_date": bill.get("due_date"),
        "frequency": bill.get("frequency") or "monthly",
        "category": bill.get("category") or "general",
        "notes": bill.get("notes") or "",
        "active": bill.get("active", True),
        "remind": bill.get("remind", True),
        "next_due_date": bill.get("next_due_date"),
    }
    today = date.today()
    nd = _next_due(entry, today)
    if nd:
        entry["next_due_date"] = nd.isoformat()
    bills.append(entry)
    data["bills"] = bills
    if entry.get("remind"):
        reminders = data.get("calendar_reminders") or []
        reminders.append({
            "id": f"bill-{entry['id']}",
            "type": "finance_bill",
            "title": f"Bill due: {entry['name']}",
            "due_date": entry.get("next_due_date"),
            "amount": entry["amount"],
            "source_id": entry["id"],
            "created_at": _now_iso(),
        })
        data["calendar_reminders"] = reminders[-50:]
    save_personal_finance(data)
    return {"ok": True, "bill": entry, "personal": data}


def add_work_log(entry: Dict[str, Any]) -> Dict[str, Any]:
    data = load_personal_finance()
    logs = data.get("work_log") or []
    settings = data.get("settings") or {}
    wtype = entry.get("type") or "Full Day"
    amount = work_amount(wtype, float(entry.get("amount") or 0), settings)
    row = {
        "id": entry.get("id") or str(uuid.uuid4())[:8],
        "date": (entry.get("date") or date.today().isoformat())[:10],
        "type": wtype,
        "amount": amount,
        "notes": entry.get("notes") or "",
        "created_at": _now_iso(),
    }
    logs.append(row)
    data["work_log"] = logs[-500:]
    save_personal_finance(data)
    return {"ok": True, "entry": row, "personal": data}


def add_deduction(entry: Dict[str, Any]) -> Dict[str, Any]:
    data = load_personal_finance()
    deds = data.get("weekly_deductions") or []
    row = {
        "id": entry.get("id") or str(uuid.uuid4())[:8],
        "name": (entry.get("name") or "Deduction").strip(),
        "amount": float(entry.get("amount") or 0),
        "frequency": entry.get("frequency") or "weekly",
        "active": entry.get("active", True),
        "notes": entry.get("notes") or "",
    }
    existing = next((i for i, d in enumerate(deds) if d.get("id") == row["id"]), None)
    if existing is not None:
        deds[existing] = row
    else:
        deds.append(row)
    data["weekly_deductions"] = deds
    save_personal_finance(data)
    return {"ok": True, "deduction": row, "personal": data}


def compute_overview(today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    data = load_personal_finance()
    bills = [b for b in (data.get("bills") or []) if b.get("active", True)]
    logs = data.get("work_log") or []
    deds = [d for d in (data.get("weekly_deductions") or []) if d.get("active", True)]

    upcoming = []
    for b in bills:
        nd = _next_due(b, today)
        if not nd:
            continue
        days = (nd - today).days
        upcoming.append({
            **b,
            "next_due_date": nd.isoformat(),
            "days_until": days,
        })
    upcoming.sort(key=lambda x: x.get("days_until", 9999))

    next_bill = upcoming[0] if upcoming else None
    week_start = _week_start(today)
    week_end = _week_end(today)
    month_start = date(today.year, today.month, 1)

    week_gross = sum(
        float(l.get("amount") or 0)
        for l in logs
        if week_start <= (_parse_date(l.get("date") or "") or today) <= week_end
    )
    week_deductions = sum(float(d.get("amount") or 0) for d in deds if (d.get("frequency") or "weekly") == "weekly")
    week_net = week_gross - week_deductions

    last_week_start = week_start - timedelta(days=7)
    last_week_end = week_start - timedelta(days=1)
    last_week_total = sum(
        float(l.get("amount") or 0)
        for l in logs
        if last_week_start <= (_parse_date(l.get("date") or "") or today) <= last_week_end
    )

    mtd_income = sum(
        float(l.get("amount") or 0)
        for l in logs
        if (_parse_date(l.get("date") or "") or today) >= month_start
    )

    week_due = sum(
        float(u.get("amount") or 0)
        for u in upcoming
        if (_parse_date(u.get("next_due_date") or "") or today) <= week_end
    )
    month_due = sum(
        float(u.get("amount") or 0)
        for u in upcoming
        if (_parse_date(u.get("next_due_date") or "") or today).month == today.month
        and (_parse_date(u.get("next_due_date") or "") or today).year == today.year
    )

    return {
        "upcoming_bills": upcoming[:12],
        "days_until_next_bill": next_bill.get("days_until") if next_bill else None,
        "next_bill": next_bill,
        "weekly_gross": round(week_gross, 2),
        "weekly_deductions": round(week_deductions, 2),
        "weekly_net": round(week_net, 2),
        "friday_payout_date": _friday_of_week(today).isoformat(),
        "last_week_total": round(last_week_total, 2),
        "month_to_date_income": round(mtd_income, 2),
        "weekly_due": round(week_due, 2),
        "monthly_due": round(month_due, 2),
        "monthly_income_estimate": round(mtd_income, 2),
    }
