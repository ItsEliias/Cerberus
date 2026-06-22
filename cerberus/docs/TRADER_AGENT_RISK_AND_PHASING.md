# TRADER AGENT — Risk Framework & Phasing Plan
*Design document · June 2026 · T2 companion to `docs/TRADER_AGENT_ARCHITECTURE.md` (T1)*

> **This is a design document only.** No trading code, no execution code, no dependencies are
> introduced here. The architecture layers and integration points live in T1's companion doc.
> Owner must review and sign off on both documents before any Phase 1 build begins.

---

## 1. THE RESEARCH REALITY

**Read this section first. It sets hard constraints on every decision that follows.**

### 1.1 Verdict: LLMs Do Not Reliably Beat the Market

The 2025–2026 academic literature is unambiguous. The summary below draws from the research
catalogued in APEX `FAILURE_PATTERNS.md` and `_research_financial.md`.

**The profit mirage (information leakage).** LLM trading strategies perform strongly in
backtests that overlap with the model's training data — and collapse immediately past the
training cutoff. FINSABER (KDD 2026, Oxford/Edinburgh, 20 years of data, 100+ symbols)
documented this precisely: "previously reported LLM advantages deteriorate significantly under
broader cross-section and over longer-term evaluation." The best agent dropped ~50% in
out-of-sample performance. The model was not predicting — it was reciting memorised
post-hoc rationalizations of price moves it had already "seen."

**LLMs beaten by simple baselines.** The same research found LLMs were "overly conservative
in bull markets, underperforming passive benchmarks" and "overly aggressive in bear markets,
incurring heavy losses." Simple models — ARIMA, Bollinger Band strategies — consistently
outperformed LLMs on risk-adjusted metrics. Larger LLMs did not improve results;
model scale is not the lever.

**Llama 3.3 is specifically a poor choice for trading reasoning.** Cerberus's default model
was among the worst performers in trading model construction benchmarks. Any trading
reasoning must use a stronger model — Llama 3.3 must not be used for trade decisions.
This is a hard constraint, not a preference.

**TradeTrap: trading agents are an attack surface.** Small input perturbations in news
headlines, analyst summaries, or gateway messages cascade into runaway exposure. A single
poisoned input can route the agent into a position it cannot justify a moment later.
This ties directly to Cerberus's untrusted-content invariant (§4.3 below).

**PredictionMarketBench (Kalshi).** On the specific market Cerberus's MVP targets — Kalshi
prediction markets — a fee-aware simple algorithm beat the active LLM. The LLM's analysis
added noise, not signal, once fees were accounted for.

**ScienceDirect 2024.** Out-of-sample accuracy for ML price prediction "converged to 50%."
Only 13.63% of hyperparameter combinations tested yielded gains above buy-and-hold pre-COVID.

**Hallucination cascades (multi-agent).** In multi-agent systems, one agent's fabricated fact
becomes the next agent's input. There is no ground-truth check in the chain. This is a
structural failure of LLM-in-the-loop trading, not a tunable parameter.

### 1.2 Where Value Actually Comes From

The research is consistent across all communities: value is in the **disciplined system** and
a **structural edge** — not in LLM price prediction.

**The structural edge documented for Kalshi** (APEX `MVP_RECOMMENDATION.md`, citing GWU 2026,
300,000+ contracts): strong favourite-longshot bias. Contracts priced at 5–20 cents win less
than their implied probability; contracts at 80–95 cents win more. Makers on contracts ≥50
cents averaged +2.6% ROI. This is explainable by cognitive bias (casual participants anchor
on low-probability events) and not yet fully arbitraged.

**The LLM's role in this system is research, not execution.** The Council's agent can surface
relevant context, draft a brief, or flag a Kalshi contract category for human review. It
cannot generate or approve a trade. See §4 (approval model) and §5 (phasing).

### 1.3 The Backtest Trap

From APEX `FAILURE_PATTERNS.md`:

> "99% of algorithms have bias which makes backtests extremely unreliable, and it's possible
> to come up with a backtest showing 10,000% returns in 10 years that won't work in reality."
> — QuantConnect community

**Backtest red flags that invalidate a strategy** (coded as hard stops):

| Signal | Threshold | Verdict |
|--------|-----------|---------|
| Sharpe ratio in backtest | > 3.0 | Almost certainly overfit |
| Win rate | > 80% | Overfit — do not deploy |
| Max drawdown (multi-year) | < 5% | Implausible — data leak |
| Parameters tuned past 2 decimal places | — | Curve-fitted |
| No true holdout window | — | Not testable |
| Transaction costs not modelled | — | Not a real result |

A strategy that trips any of these flags is invalidated and blocked from Phase 3 deployment.
Backtests are for sanity-checking mechanism, not for measuring performance. **Only
paper-forward-testing on live data counts.**

---

## 2. THE FUNDED-WALLET MODEL

**Blast-radius cap: max loss = wallet balance, full stop.**

### 2.1 Isolation by Design

Money is deposited into the trading platform's wallet. It is never linked to a bank account
and has no withdrawal path accessible to the agent or the API keys.

- **Trade-only / withdrawal-disabled API keys.** The platform API key given to Cerberus has
  trade-only permissions. It cannot move funds out of the wallet under any circumstances.
  Withdrawal routes require a separate key that lives only in the Bitwarden vault and is
  never loaded into the application.
- **Bank credentials are never stored in or near Cerberus.** Not in `.env`, not in the vault
  module, not in a memory block. Not anywhere in the system. This is not a policy — it is a
  structural gap that must never be closed.
- **Wallet funding is a manual human action.** The owner funds the wallet through the
  platform's web interface. No automated funding exists.

### 2.2 Key Management

Trading API keys follow the same vault model as all Cerberus credentials: stored in Bitwarden
(Vaultwarden), accessed via `vault_routes.py`. The trading key is fetched at trade time and
not held in memory between sessions. See `routes/vault_routes.py` for the session-key model.

---

## 3. HARD-CODED SAFEGUARDS

These limits are **code-enforced at the execution layer**. They are not prompts, not agent
guidelines, not configurable via the UI. The agent cannot override them. The owner cannot
override them at runtime — changing them requires a code change, a review, and a redeploy.

Rules are lifted directly from APEX `MVP_RECOMMENDATION.md` §Component 4 and
`SUCCESS_PATTERNS.md` §5, §7, with full attribution below.

### 3.1 The Owner MANDATE

Before any trading session begins, the owner commits a MANDATE: a static file or database
record specifying the operating envelope. Trading code reads the MANDATE at startup; any
field absent from the MANDATE causes an immediate fail-closed halt.

| Field | Example value | Enforced by |
|-------|---------------|-------------|
| `symbol_universe` | `["KALSHI:*"]` | Pre-trade gate rejects anything outside |
| `max_position_pct` | `0.02` (2% of capital) | Order sizing layer |
| `max_exposure_pct` | `0.15` (15% of capital) | Pre-trade gate |
| `daily_loss_cap_pct` | `0.03` (3% of capital) | Session monitor |
| `leverage_cap` | `1.0` (no leverage) | Pre-trade gate |
| `max_trades_per_day` | `20` | Session counter |

Source: `MVP_RECOMMENDATION.md` Component 4 specifies 2% max position per contract and 3%
daily loss circuit breaker as the minimum production baseline.

### 3.2 Position and Exposure Rules

- **Max position per contract: 2% of wallet capital** (APEX `MVP_RECOMMENDATION.md`).
- **Max total exposure: 15% of wallet capital.** Beyond this, no new positions open.
- **No pyramiding.** A position in a contract cannot be increased while it is open.
- **No leverage.** Leverage cap is 1.0. The agent cannot request a leveraged order.
- **No position at session end.** Unless explicitly permitted by the MANDATE, all positions
  are closed before the trading day ends.

### 3.3 Daily Loss Circuit Breaker

From APEX `MVP_RECOMMENDATION.md` and `SUCCESS_PATTERNS.md` §5:

> "Pre-programmed circuit breakers remove discretion during the high-stress conditions when
> bad decisions happen."

When the session's realised + unrealised loss hits **3% of wallet capital**, trading halts
automatically for the rest of the calendar day:

1. All open orders are cancelled.
2. No new orders are submitted.
3. A halt notification is sent (notification channel per T1's architecture).
4. The halt is logged to the audit ledger (§3.6).
5. Resumption requires a manual human action on the next trading day.

The circuit breaker fires even if the agent is mid-reasoning. The pre-trade gate is
synchronous and blocks submission.

### 3.4 Capital-Preservation Floor and Profit Sweep

- **Capital floor.** A configured minimum balance (e.g. 60% of initial deposit) below which
  the system refuses to open new positions regardless of other limits. Trading stops until
  the owner manually acknowledges and resets.
- **Profit sweep ("money to save").** Profits above a configured threshold are swept to a
  designated reserve balance that is excluded from the trading risk envelope. The agent
  cannot treat swept funds as available capital.

### 3.5 Stop-Loss, Take-Profit, and Cooldowns

- Every position has a **take-profit target** set at order creation. Missing a take-profit
  target is not grounds to hold; the position is reviewed at session end.
- A **max-hold duration** is configured per contract type (e.g. 48 hours). Positions held
  beyond the max-hold duration are closed regardless of P&L.
- After the circuit breaker fires, a **24-hour cooldown** applies before trading can resume.
  After three circuit breaker trips in 30 days (`MVP_RECOMMENDATION.md` invalidation
  criteria), the strategy is flagged for investigation and halted until manually cleared.

### 3.6 The Audit Ledger

Every proposal, decision, approval, rejection, order submission, fill, and expiry result is
written to an append-only audit ledger before any action is taken. This is analogous to
OpenAlice's "trade-as-git" model: every order is **staged → committed with a message →
pushed to execute**, with full reviewable history and message hashes.

The ledger is the source of truth for:
- Reconstructing any trade after the fact
- Detecting state reconciliation gaps between ledger and broker logs
- Edge monitoring (rolling ROI, CLV-equivalent, win rate)

From APEX `SUCCESS_PATTERNS.md` §7: "Comprehensive reconciliation between strategy state and
broker logs at every session start." The system reconciles the audit ledger against the
platform's order history at session open. A reconciliation failure halts the session.

### 3.7 Overfitting Guards

Any strategy under evaluation is blocked from Phase 3 deployment if it exhibits:

| Red flag | Source |
|----------|--------|
| Backtest Sharpe > 3.0 | `FAILURE_PATTERNS.md` §1 |
| Win rate > 80% in backtest | `FAILURE_PATTERNS.md` §1 |
| Max drawdown < 5% across multi-year backtest | `FAILURE_PATTERNS.md` §1 |
| Parameters tuned past 2 decimal places | `FAILURE_PATTERNS.md` §1 |
| < 300 out-of-sample live trades as evidence base | `FAILURE_PATTERNS.md` §10 |
| Negative CLV-equivalent (buying worse than closing price) | `MVP_RECOMMENDATION.md` |

From `FAILURE_PATTERNS.md` §1: "Each filter that improves your backtest by 2% probably
reduces live performance by 5%." Parameter tuning during Phase 2 is strictly limited to
the in-sample window defined before any testing begins.

### 3.8 The Filesystem Kill Switch

A designated file path acts as the manual kill switch:

```
data/trader/KILL
```

If this file exists at session start, the trading session does not begin. If the file is
created while a session is running, the session monitor detects it within one polling
interval, cancels all orders, closes all positions, and terminates. The kill switch must
function even when the main agent process is hung — the session monitor runs as a separate
process.

From APEX `SUCCESS_PATTERNS.md` §7: "Kill switch that closes all positions and cancels all
orders in a single command — must work when the main process is hung." This is the one
safeguard practitioners most commonly skip and most commonly need.

### 3.9 Data Staleness Check

If no valid response from the trading platform's API is received within 30 seconds, the
system pauses all new order submissions. It does not rely solely on connection status —
`FAILURE_PATTERNS.md` §5 documents "silent data staleness" as a live-environment failure mode
that shows a healthy connection while market data stops updating.

---

## 4. THE APPROVAL MODEL

### 4.1 Every Real-Money Order is Approval-Gated

The model mirrors Cerberus's existing gateway pattern in `src/tool_security.py`. Just as
`GATEWAY_APPROVAL_GATED_TOOLS` intercepts `mcp__email__send_email` and
`manage_calendar_write` before execution and requires human approval, every trading order
proposal passes through an equivalent gate:

```
agent proposes trade → approval-gate intercept → human approves/rejects → execute or discard
```

In Phase 3 (first real money), **every single order** is gated. No exceptions. The sentinel
model from `tool_security.py` maps directly: a conceptual `place_trade_order` tool is in the
Tier B set, not Tier A. The agent can research and propose; it cannot execute.

The gate UI shows: **symbol / direction / size / price / reasoning summary** — the minimum
information for an informed decision. The human can reject and provide a reason; the reason
is logged to the audit ledger.

### 4.2 Trade-as-Git (Staged → Committed → Pushed)

Borrowing from OpenAlice's model: a proposed trade is not a chat message, it is a versioned
artifact. Each proposal:

1. **Staged** — written to the audit ledger with a unique hash and a reasoning summary.
2. **Committed** — human approval writes an approval entry referencing the proposal hash.
3. **Pushed** — only after the commit, the order is submitted to the platform.

If the agent crashes between staged and committed, no order is submitted. If the platform
rejects the order after submission, the rejection is committed to the ledger with the
platform's error code. The ledger is never rolled back.

### 4.3 Untrusted Input Cannot Trigger or Auto-Approve a Trade

**This is an absolute invariant, not a policy.**

Notes, documents, fetched pages, news headlines, gateway messages (Discord/Telegram), and
tool output are **untrusted content**. Cerberus wraps all untrusted content in the
untrusted-content guard before any LLM sees it (`CLAUDE.md` security model; `src/prompt_security.py`).

This guard applies with full force to all trader-adjacent paths:

- A news headline fed to the agent cannot generate a trade proposal.
- A Discord/Telegram message cannot trigger, approve, or influence a pending approval.
- A fetched Kalshi market page is untrusted data; the agent reasons about it, the human decides.
- No approval action can come from an automated source. Every approval is a human clicking
  a button with full context shown.

TradeTrap (§1.1) documents exactly how small perturbations in news/analysis inputs cascade
into runaway exposure. The untrusted-content boundary is the structural prevention.

### 4.4 Phase-by-Phase Automation Boundaries

| Phase | Agent can propose? | Agent can approve? | Human must approve? |
|-------|-------------------|-------------------|---------------------|
| 1 (data only) | No | No | N/A |
| 2 (paper) | Yes (paper only) | For paper only | N/A (no real money) |
| 3 (real, gated) | Yes | No | Yes, every order |
| 4 (bounded auto) | Yes | Within MANDATE limits only | Above limits: yes |

Phase 4 is only reachable after Phase 3 has demonstrated positive CLV-equivalent over 300+
live trades, owner decision, and explicit MANDATE update. Even in Phase 4, the MANDATE limits
are code-enforced and the kill switch remains active.

---

## 5. THE PHASING PLAN

No real money moves until Phase 3. Phase 3 does not begin until Phase 2 has produced
statistically meaningful forward-test results. Every phase has explicit entry criteria and
an explicit gate to the next phase.

### Phase 1: Data Layer Only — Zero Trading

**What it is:** Build the data pipeline. Connect to the trading platform's API. Pull
active contracts, prices, volumes, and historical data. Store and display. Generate Council
research briefs about market conditions and specific contract categories.

**What is allowed:**
- Read-only API connection (no order permissions)
- Data display in the TRADER tab (T1's architecture)
- Council agent briefs: "Here are the Kalshi contracts meeting the ≥50-cent threshold today"
- Evaluating brief quality against real outcomes (did the contracts the brief identified
  actually resolve as predicted?)

**What is blocked:** Everything to do with orders. No order API calls. No paper order
simulation at the API level. The trading key is not loaded. The order submission code does
not exist yet.

**Duration:** Weeks to months. Do not leave Phase 1 until brief quality can be assessed
against outcomes and the data pipeline is demonstrably reliable.

**Gate to Phase 2:**
- Data pipeline has run reliably for ≥ 4 weeks with no staleness incidents
- ≥ 3 weeks of Council briefs available with outcome data to evaluate quality
- Brief quality assessment completed (did the agent's favoured contracts outperform?)
- Owner reviews and signs off

---

### Phase 2: Paper Trading — Forward-Test on Live Data

**What it is:** Briefs become simulated trades. The TRADER tab shows paper P&L. All the
mechanics of a real session run against a synthetic portfolio, on live market data, in
real time.

**Critical distinction:** This is **forward-testing on live data**, not backtesting. The
paper simulation uses prices as they appear in real time, not historical prices. Backtests
are not run in Phase 2 — from `FAILURE_PATTERNS.md` §5, paper trading already hides
production failures; backtests hide even more. The goal of Phase 2 is to accumulate
**out-of-sample live evidence**.

**What is allowed:**
- Full simulation: paper orders, paper fills, simulated fees, simulated P&L
- Edge monitoring: rolling ROI, win rate, CLV-equivalent, daily drawdown
- Strategy parameter adjustment within the in-sample window defined before Phase 2 began
  (no meta-optimisation of the walk-forward window itself — see `SUCCESS_PATTERNS.md` §2)
- The audit ledger records all paper trades identically to real trades

**What is blocked:** Real API order submission. No trading key is loaded. Any path to a real
order must remain non-existent in the codebase.

**Duration:** Long enough to accumulate ≥ 300 paper trades with positive CLV-equivalent.
From APEX `FAILURE_PATTERNS.md` §10: 300–500 trades is the minimum to assess edge; 1,000+
for statistical significance. Do not rush this. From `SUCCESS_PATTERNS.md` §10: treat the
first 12–24 months as evidence collection.

**Monitor for red flags that block Phase 3:**
- Paper Sharpe > 3.0 (see §3.7 — backtest red flags apply to paper too if window is short)
- Daily circuit breaker would have tripped > 3 times in any 30-day window
- CLV-equivalent is negative (buying at worse prices than contracts close at)
- `FAILURE_PATTERNS.md` §5's ten production failure modes — simulate them in paper env

**Gate to Phase 3:**
- ≥ 300 paper trades logged with positive ROI and positive CLV-equivalent
- Zero circuit-breaker-equivalent trips in final 30 days
- All `FAILURE_PATTERNS.md` §1 red flags confirmed absent
- Reconciliation between paper ledger and simulated broker state working correctly
- MANDATE file drafted and reviewed by owner
- Kill switch tested (drop the file → session terminates within one polling interval)
- Owner reviews and signs off

---

### Phase 3: Real Money — Human-Gated Every Order

**What it is:** First real funded wallet. Real API key with trade-only permissions (no
withdrawal). Every proposed order goes through the approval gate (§4.1). No automated
execution. Human in the loop on every trade.

**Recommended starting capital:** $1,000–$5,000 (APEX `MVP_RECOMMENDATION.md`).
Do not size for income. Size for evidence accumulation. If losing the entire wallet would
affect financial decisions, the wallet is too large.

**What is allowed:**
- Real order submission — after human approval only
- Same MANDATE limits as paper phase (no changes between Phase 2 and Phase 3 start)
- Same audit ledger, same kill switch, same circuit breakers — now with real consequence

**What is blocked:**
- Any automated order submission (all orders require human approval)
- Position sizing above MANDATE limits — hard-blocked at the pre-trade gate
- Any funding path that connects to a bank account
- Changing MANDATE parameters without a code change and owner sign-off

**Monitor:**
- Live CLV-equivalent (primary KPI from APEX `SUCCESS_PATTERNS.md` §6)
- Daily circuit breaker trips
- Reconciliation between audit ledger and platform's order history at every session start
- Rolling 30-day Sharpe, ROI, and win rate

**Invalidation (from APEX `MVP_RECOMMENDATION.md`):**
If, after 300+ live trades:
- ROI is below 0% after all fees
- CLV-equivalent is negative
- Circuit breaker tripped > 3 times in 30 days

**→ Stop. Investigate. Do not continue. Do not optimise parameters to fix a live
environment problem.** (From `FAILURE_PATTERNS.md` §6: "Never optimise further during
decay. Adding conditional filters to fix a decaying strategy accelerates the problem.")

**Gate to Phase 4 (conditional):**
- ≥ 300 live trades with positive ROI and positive CLV-equivalent
- Zero circuit-breaker trips in final 30 days
- Rolling 6-month Sharpe stable (no decay trend)
- Owner decides Phase 4 is the right next step (it may not be)
- New MANDATE reviewed and approved
- Phase 4 requires a separate owner decision — it does not follow automatically

---

### Phase 4: Bounded Automation — Within Hard Limits Only (Conditional)

**What it is:** The MANDATE defines a trading envelope within which the agent may submit
orders without per-order human approval. Every limit in §3 remains code-enforced. The kill
switch remains active. The audit ledger records every decision.

**This phase is optional.** Phase 3 may be the permanent operating mode. Bounded automation
is only appropriate if the evidence from Phase 3 is strong, the strategy is understood, and
the owner is confident in the code-enforced limits.

**What changes from Phase 3:**
- Orders within MANDATE limits can be submitted without per-order approval
- Orders above any MANDATE limit still require per-order approval

**What does not change:**
- All hard-coded safeguards in §3 remain active
- Kill switch remains active
- Audit ledger remains append-only and complete
- Daily circuit breaker remains active
- Untrusted-content invariant (§4.3) remains absolute

**The agent is still not trusted. The system is trusted.** The agent operates within a cage
of code-enforced limits. If any limit is wrong, the limit is changed through review — the
agent's judgment is never the backstop.

---

## 6. FAILURE MODES AND KILL CONDITIONS

### 6.1 Automatic Halts

Trading halts automatically on any of the following. All halts write to the audit ledger
and send a notification.

| Condition | Trigger | Resolution |
|-----------|---------|------------|
| Daily loss cap reached | Realised + unrealised loss ≥ 3% of wallet | Manual resume next trading day |
| Kill switch file present | `data/trader/KILL` exists | Manual: delete file + owner confirms |
| Data staleness | No valid API response in 30 seconds | Automatic retry; if persistent, halt |
| Reconciliation failure | Ledger ≠ platform order history at session start | Manual investigation required |
| MANDATE absent or malformed | MANDATE file missing or fails validation | Hard fail-closed; no session starts |
| Sandbox / service unavailable | Platform API unreachable | Fail-closed; never fall back to unguarded mode |
| Circuit breaker trips ≥ 3 in 30 days | Counter threshold | Strategy investigation required |

**Fail-closed is the invariant.** Any ambiguous state — API unavailable, reconciliation gap,
MANDATE validation error — results in no trading, not degraded trading. From `CLAUDE.md`:
"The sandbox fails closed — if it can't run, the tool errors instead of falling back to
host subprocess." The same principle applies here.

### 6.2 Manual Kill Switch

Dropping `data/trader/KILL` halts the session within one monitoring poll interval.
The kill switch:
- Cancels all open orders
- Closes all open positions at market
- Writes a KILL entry to the audit ledger
- Terminates the trading session
- Requires manual acknowledgment before the next session can start

From APEX `SUCCESS_PATTERNS.md` §7: "The kill switch requirement is the one that most
practitioners skip until they need it." It must be tested before Phase 3 goes live.

### 6.3 Strategy Invalidation

A strategy is invalidated and removed from Phase 3 operation if:

| Condition | Source |
|-----------|--------|
| ROI < 0% after 300+ live trades | `MVP_RECOMMENDATION.md` |
| CLV-equivalent is negative | `MVP_RECOMMENDATION.md`; `SUCCESS_PATTERNS.md` §6 |
| Circuit breaker tripped > 3× in 30 days | `MVP_RECOMMENDATION.md` |
| Rolling 6-month Sharpe falling with no recovery for 2+ months | `SUCCESS_PATTERNS.md` §8 |
| Average winning trade shrinking, faster profit givebacks | `SUCCESS_PATTERNS.md` §8 |
| Reconciliation gap detected and not explained within 24 hours | Operational |

On invalidation: **stop the strategy. Investigate the cause. Do not add conditional filters
or re-optimise parameters.** From `FAILURE_PATTERNS.md` §6, the failure mode is "optimising
further during decay instead of retiring."

### 6.4 The Explicit Invalidation Condition (Kalshi)

For the MVP target market, from APEX `MVP_RECOMMENDATION.md`:

> After 300+ live trades, stop and investigate if CLV-equivalent is negative — you are
> consistently buying at worse prices than contracts close at.

CLV-equivalent on Kalshi is: did the YES contract close at a higher price than the entry
price? If the answer is consistently no, the documented favourite-longshot bias edge is not
being captured, and the strategy has no foundation.

---

## Summary: The Non-Negotiables

These are the constraints that cannot be traded away, negotiated down, or deferred:

1. **No bank credentials anywhere near Cerberus.** Max loss is wallet balance, always.
2. **Trade-only API keys.** Withdrawal requires a separate key that lives only in Bitwarden.
3. **Backtests do not count.** Only forward-tested live evidence from Phase 2 onward.
4. **Llama 3.3 must not be used for trade reasoning.** Use a stronger model.
5. **Untrusted content cannot trigger or approve a trade.** Gateway messages, news, notes — none of it.
6. **Kill switch must work before Phase 3 starts.** Tested, not assumed.
7. **Every order in Phase 3 requires human approval.** No exceptions.
8. **Fail-closed on any ambiguous state.** Never degrade to unguarded execution.
9. **300+ forward-tested live trades before calling anything proven.**
10. **Invalidation conditions are commitments.** When they trigger: stop, investigate, do not optimise.
