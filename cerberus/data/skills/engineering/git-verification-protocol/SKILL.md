---
name: git-verification-protocol
description: How to verify work is done in Cerberus — committed and pushed to remote, never just local
version: 1.0.0
category: engineering
tags: [git, verification, devops, protocol]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

After any DEVOPS, CODER, or ARCHITECT task that produces file changes. "Done" means committed and pushed to the remote — not confirmed in a running container.

## Procedure

1. **Stage exactly the changed files** — never `git add -A` blindly; list files explicitly to avoid committing secrets or generated artifacts.

2. **Commit with conventional message** — format: `<type>(<scope>): <summary>`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. Example: `feat(agents): upgrade system prompts for all 16 default agents`.

3. **Push to remote** — `git push origin <branch>`. Verify the push succeeded (exit 0, no error output).

4. **Confirm via `git log --oneline -3 origin/<branch>`** — the commit must appear on the remote ref, not just locally.

5. **Never use `--no-verify`** — if a pre-commit hook fails, fix the underlying issue. Bypassing hooks masks real problems.

**Verification is against git, not the running container.** Docker containers may have stale or unrelated code. The source of truth is the remote git ref.

**Do not merge to the base branch** unless the user explicitly instructs it.
