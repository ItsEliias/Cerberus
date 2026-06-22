---
name: multi-platform-search
description: Search Twitter/X, Reddit, YouTube, GitHub, and the web simultaneously. Use when a single search engine is insufficient — community signal, code examples, video content, and news in parallel.
version: 1.0.0
category: research
tags: [search, reddit, github, youtube, twitter, multi-source]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-21T00:00:00Z"
---

## When to Use

When a single web search will not surface a complete answer — when you need community opinion, working code, video walkthroughs, *and* news at once. Use this when the obvious first search would underspecify the type of result you need. Adapted from github.com/Panniantong/Agent-Reach.

## Procedure

1. **Pick the platforms that match the question type** (use the selection guide below). Do not fan out to all five by default — picking the wrong platforms is how you get noise.

   **Platform selection guide:**
   - **GitHub** — code examples, open-source projects, technical issues.
   - **Reddit** — community opinions, real-world experiences, troubleshooting.
   - **YouTube** — tutorials, demos, reviews, conference talks.
   - **Twitter / X** — breaking news, real-time reactions, expert commentary.
   - **Web** — news articles, documentation, blog posts.

2. **Construct queries deliberately:**
   - Keep queries short (2–4 words). Long queries reduce recall.
   - Use platform-specific operators where available:
     - GitHub: `language:python stars:>100`
     - Reddit: `site:reddit.com {query}`
     - YouTube: append `tutorial` or `review` to bias toward actionable content.

3. **Synthesise by weighting source reliability for the *query type*:**
   - Technical how-to → **GitHub > YouTube > Reddit > Web**
   - Product opinions → **Reddit > YouTube > Twitter > Web**
   - Breaking news → **Twitter > Web > Reddit > GitHub**
   - Code examples → **GitHub > YouTube > Web > Reddit**

4. **Note contradictions explicitly.** If two high-weight sources disagree, surface that disagreement in the output — it is more useful than picking a side.

5. **Output the brief with one section per platform you actually queried**, plus a final `### Synthesis` paragraph that calls out where the platforms agreed, disagreed, and what's missing.

**Rules**
- Do not silently include a platform in the synthesis you didn't actually query — say "skipped" instead.
- A multi-platform search that returns only one platform's results is a single-platform search; downgrade the confidence accordingly.
- Always include the publication / post date next to each linked result; stale results are the most common failure mode.
