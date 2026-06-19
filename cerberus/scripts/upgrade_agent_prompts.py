"""One-shot migration: write upgraded system_prompt values to live cerberus_agents rows.

Usage:
    python scripts/upgrade_agent_prompts.py
    python scripts/upgrade_agent_prompts.py --owner alice
    python scripts/upgrade_agent_prompts.py --dry-run

Exit codes: 0 = ok, 1 = no rows found at all (may indicate wrong owner), 2 = partial.
"""

import argparse
import sys
import os

# Allow running from repo root or cerberus/ subdirectory
_here = os.path.dirname(os.path.abspath(__file__))
_cerberus_root = os.path.dirname(_here)
if _cerberus_root not in sys.path:
    sys.path.insert(0, _cerberus_root)

from core.database import SessionLocal, CerberusAgent
from routes.cerberus_agent_defaults import _DEFAULT_AGENTS


def main() -> int:
    parser = argparse.ArgumentParser(description="Upgrade agent system prompts in live DB")
    parser.add_argument("--owner", default="itseliias", help="Agent owner (default: itseliias)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    args = parser.parse_args()

    prompt_map: dict[str, str] = {d["name"]: d["system_prompt"] for d in _DEFAULT_AGENTS}

    db = SessionLocal()
    try:
        updated = 0
        not_found = 0
        skipped = 0

        for name, new_prompt in prompt_map.items():
            agent = (
                db.query(CerberusAgent)
                .filter(CerberusAgent.owner == args.owner, CerberusAgent.name == name)
                .first()
            )
            if agent is None:
                not_found += 1
                print(f"  NOT FOUND  {name}")
                continue

            if agent.system_prompt == new_prompt:
                skipped += 1
                print(f"  UNCHANGED  {name}")
                continue

            if args.dry_run:
                print(f"  DRY-RUN    {name}  ({len(new_prompt)} chars)")
                updated += 1
            else:
                agent.system_prompt = new_prompt
                updated += 1
                print(f"  UPDATED    {name}  ({len(new_prompt)} chars)")

        if not args.dry_run:
            db.commit()

        label = "DRY-RUN" if args.dry_run else "DONE"
        print(f"\n[{label}] updated={updated}  not_found={not_found}  skipped={skipped}")

        if updated == 0 and not_found == len(prompt_map):
            return 1
        if not_found > 0:
            return 2
        return 0

    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
