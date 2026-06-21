---
name: feature-spec-writer
description: Write a concise, developer-ready feature specification — user story, acceptance criteria, edge cases, out-of-scope, open questions, and definition of done.
version: 1.0.0
category: planning
tags: [product, spec, planning, developer, agile]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-21T00:00:00Z"
---

## When to Use

Before kicking off an implementation that touches more than one file or one developer's slice of work. Use when there is ambiguity that would cost more in a code review than it would in a 30-minute writing session up front. Cherry-picked from github.com/phuryn/pm-skills.

## Procedure

Produce a spec using this exact template — each section is a required field, not a suggestion.

### Overview

One sentence: what does this feature do, and for whom?

### User Story

> "As a `[user type]`, I want to `[action]` so that `[outcome]`."

Keep to **one** story. If you need more than one user story, you have more than one feature; split the spec.

### Acceptance Criteria

Written as testable Given / When / Then statements:

- [ ] **Given** … **When** … **Then** …
- [ ] **Given** … **When** … **Then** …
- [ ] **Given** … **When** … **Then** …

**Minimum 3, maximum 8.** If you need more than 8 acceptance criteria, the feature is too big — split it.

### Edge Cases & Error States

Answer each explicitly:

- What happens when the input is **empty / null**?
- What happens when the **network fails** mid-action?
- What happens when the user **doesn't have permission**?
- What happens when the data **already exists** (duplicate)?

A spec that doesn't enumerate edge cases is a bug factory.

### Out of Scope (explicitly)

List what this feature does **not** do. This section is as important as the in-scope list — it is the contract for what won't show up in code review as "while you're at it…".

### Open Questions

Decisions that must be made before implementation starts. Each has:

- An **owner** (who decides)
- A **due date**

If there are no open questions, double-check; there are usually open questions.

### Definition of Done

- [ ] Code reviewed and merged
- [ ] Tests written and passing
- [ ] Deployed to staging
- [ ] Acceptance criteria manually verified

**Rules**
- One feature per spec. Multi-feature specs hide scope creep.
- Acceptance criteria must be testable by someone other than the author — "the UX feels good" is not testable.
- The Out-of-Scope section is the most-skipped section and the most-valuable one. Write it.
