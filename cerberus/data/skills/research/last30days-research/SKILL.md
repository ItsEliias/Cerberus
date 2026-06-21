---
name: last30days-research
description: Research a topic across Reddit, Hacker News, YouTube, X, and the web. Returns a grounded multi-source summary of recent activity over the last 30 days.
version: 1.0.0
category: research
tags: [research, reddit, hackernews, youtube, web, trends]
status: published
confidence: 1.0
source: authored
owner: itseliias
created: "2026-06-21T00:00:00Z"
---

## When to Use

When the RESEARCHER agent (or a human) needs a fast, grounded snapshot of what has happened around a topic over the last 30 days — not deep-history research, but the *current* state of the conversation across communities. Use this when "what changed lately?" is the question. Adapted from github.com/mvanhorn/last30days-skill.

## Procedure

1. **SCOPE the question first.** Write the exact question in one sentence. Ambiguous queries return noise. If the question doesn't fit in one sentence, the topic is two topics — split them and run the protocol twice.

2. **CHECK SOURCES, in this order of signal quality:**
   - **Hacker News** (`news.ycombinator.com/search`) — technical community signal, opinions from people who ship.
   - **Reddit** (`reddit.com/search`) — community discussion, real-user sentiment, troubleshooting threads.
   - **YouTube** — tutorials, reviews, demos published in the last 30 days; sort by upload date.
   - **Web search** — news articles, blog posts, vendor announcements.
   - **X / Twitter** — real-time reactions and links; lower signal-to-noise, treat as supplementary.

3. **FOR EACH SOURCE, capture:**
   - What is the dominant narrative or sentiment?
   - What are the top 3 most upvoted / most engaged posts saying?
   - Are there any contrarian views worth noting?

4. **SYNTHESIS rules:**
   - What's the consensus across sources?
   - Where do sources disagree?
   - What's changed in the last 30 days vs. prior understanding?
   - Confidence rating: **HIGH** (3+ sources agree) / **MEDIUM** (mixed) / **LOW** (sparse).

5. **OUTPUT FORMAT** — use exactly these section headers so downstream consumers can parse the brief:

   ```
   ## // TOPIC: {topic}
   ## // PERIOD: Last 30 days

   ### Consensus Finding
   ### Source Breakdown
   ### Contrarian Views
   ### Confidence: HIGH / MEDIUM / LOW
   ### Key Links
   ```

**Rules**
- Do not pad the brief with prior-history context unless explicitly asked — this skill is about the *last 30 days*.
- Cite the upvote / engagement count for any "top post" claim; an uncited claim is opinion, not signal.
- If only one source has anything to say, the confidence is automatically LOW regardless of how confident that one source sounds.
