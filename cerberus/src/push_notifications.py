"""Mobile push-notification dispatcher.

For now this is a logging stub — every notification is written at INFO
level so a developer tailing logs can see what _would_ be pushed once
FCM/APNs wiring lands. The shape mirrors the eventual integration: per
device-id payload, platform-keyed routing, structured `data` carrier.

Failure-safe: every error path is swallowed at WARNING. Notifications are
purely auxiliary — a logging blip MUST NOT propagate into an approval
flow or any other caller.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _list_tokens(owner: Optional[str]) -> List[Dict[str, Any]]:
    """Return owner's registered devices (token, platform, device_id).

    Returns an empty list if the owner has none, or on any DB error so the
    caller can continue without a guard."""
    from core.database import PushToken, SessionLocal

    db = None
    try:
        db = SessionLocal()
        rows = (
            db.query(PushToken)
            .filter(PushToken.owner == owner)
            .all()
        )
        return [
            {
                "token": r.token,
                "platform": r.platform,
                "device_id": r.device_id,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning("push token lookup failed: %s", exc)
        return []
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def send_push_notification(
    owner: Optional[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
) -> int:
    """Fan a notification out to every registered device for `owner`.

    Returns the number of targets dispatched (0 if the owner has no
    devices). Logs each target at INFO so devs can see the would-be
    pushes; the actual provider wire-up (FCM / APNs) lands in a follow-up.

    Best-effort: per-device failure is logged at WARNING and skipped — the
    rest of the targets are still attempted. The caller never sees an
    exception.
    """
    sent = 0
    try:
        targets = _list_tokens(owner)
        for t in targets:
            try:
                logger.info(
                    "PUSH → %s:%s: %s — %s%s",
                    t.get("platform"),
                    t.get("device_id"),
                    (title or "").strip(),
                    (body or "").strip(),
                    f" data={data!r}" if data else "",
                )
                sent += 1
            except Exception as exc:
                logger.warning(
                    "push dispatch failed for %s: %s",
                    t.get("device_id"), exc,
                )
    except Exception as exc:
        logger.warning("send_push_notification top-level failure: %s", exc)
    return sent
