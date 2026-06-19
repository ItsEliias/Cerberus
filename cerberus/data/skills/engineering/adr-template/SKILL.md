---
name: adr-template
description: Architecture Decision Record template for Cerberus — captures context, options, and consequences
version: 1.0.0
category: engineering
tags: [adr, architecture, documentation, decision]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

When the ARCHITECT agent or a human needs to record a non-trivial technical decision — one that involves trade-offs, affects multiple components, or would surprise a future maintainer.

## Procedure

Produce an ADR using this structure:

```markdown
# ADR-NNN: <Short title>

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-NNN
**Deciders**: <roles or names>

## Context

<What is the situation or problem that forces this decision? Include relevant constraints — performance requirements, security invariants, infrastructure limits (e.g., CPU-only Mac, no CDN), team size.>

## Options Considered

### Option A: <Name>
- **Pros**: …
- **Cons**: …

### Option B: <Name>
- **Pros**: …
- **Cons**: …

## Decision

<Chosen option and the primary reason. One paragraph max.>

## Consequences

- **Positive**: …
- **Negative / risks**: …
- **Neutral**: …

## References

- <Link or file path to related code, issue, or prior ADR>
```

**Rules**
- Number ADRs sequentially; never reuse a number
- Status must be updated when superseded — do not delete old ADRs
- "Consequences" must include at least one negative or risk item; decisions without trade-offs don't need an ADR
