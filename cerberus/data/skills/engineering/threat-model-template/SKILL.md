---
name: threat-model-template
description: Phase 0 threat model template for Cerberus features — STRIDE analysis before implementation
version: 1.0.0
category: engineering
tags: [security, threat-model, stride, phase-0, planning]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-19T00:00:00Z"
---

## When to Use

Required as Phase 0 for any feature that touches auth, external data ingestion, agent execution, new API routes, or secrets handling. Do not begin implementation until the threat model is reviewed.

## Procedure

Produce a threat model using this structure:

```markdown
# Threat Model: <Feature Name>

**Date**: YYYY-MM-DD
**Author**: <agent or human>
**Feature scope**: <one-sentence description of what is being built>

## Trust Boundaries

<List the boundaries data crosses: browser → FastAPI, FastAPI → OpenSandbox, FastAPI → Hermes, agent → external URL, etc.>

## Assets

<What is being protected? Examples: session tokens, user notes, agent system prompts, DB credentials, API keys.>

## STRIDE Analysis

| Threat | Vector | Likelihood | Impact | Mitigation |
|--------|--------|------------|--------|------------|
| **S**poofing | | L/M/H | L/M/H | |
| **T**ampering | | L/M/H | L/M/H | |
| **R**epudiation | | L/M/H | L/M/H | |
| **I**nformation Disclosure | | L/M/H | L/M/H | |
| **D**enial of Service | | L/M/H | L/M/H | |
| **E**levation of Privilege | | L/M/H | L/M/H | |

## Cerberus Invariant Checklist

- [ ] Auth always on, loopback bind only
- [ ] Execution always through OpenSandbox
- [ ] Untrusted content treated as data, not instructions
- [ ] Gateway channels are not action triggers
- [ ] No secrets in logs or frontend

## Residual Risks

<Threats not fully mitigated — document them explicitly with owner and acceptance rationale.>

## Open Questions

<Anything that requires design clarification before implementation begins.>
```

**Rules**
- Likelihood and Impact must be assessed independently (a low-likelihood / high-impact threat still warrants a mitigation)
- All five Cerberus invariants must be checked against the new feature, not assumed to hold
- Residual risks require explicit acceptance — "we accept this risk because…"
