# TRADER Agent — Architecture Design
*Phase 0 · Part A — Structure and Integration*

**Date**: 2026-06-22
**Branch**: docs/trader-threatmodel-architecture
**Status**: DESIGN — no code written; awaiting owner review before Phase 1
**Companion doc**: `docs/TRADER_AGENT_RISK_AND_PHASING.md` (risk controls, safeguards, phasing schedule)

---

## 1. Design Philosophy

TRADER is **not** an autonomous trading bot. It is a structured decision-support system that keeps a human in the loop at every capital-commitment step. Three principles drive every architectural decision:

**1. The agent reads; a service executes.** The TRADER agent in Cerberus can research, debate, and produce a trade recommendation. It cannot place an order. Order placement is the sole responsibility of a separate, narrow trading service that the agent cannot reach, controlled only by explicit human approval.

**2. Fail closed everywhere.** Every component — the sandbox, the egress allowlist, the tool policy, the vault — defaults to blocked, not open. A misconfiguration or crash must prevent trading, not enable it.

**3. No LLM in the critical path.** LLMs are used in the Analyst layer to synthesise structured research. They are not used to generate order parameters. Trade parameters (market, direction, price, size) are derived from deterministic rule logic and ratified by the human, not extracted from model output.

These constraints are adapted from the structural findings in:
- **OpenAlice** (`github.com/TraderAlice/OpenAlice`) — "trade-as-git" commit model; staging and human commit before any order is pushed
- **Vibe-Trading** (`github.com/HKUDS/Vibe-Trading`) — bounded-autonomy; read-only default, per-broker paper/live guards
- **TradingAgents** (`github.com/TauricResearch/TradingAgents`) — multi-agent debate structure only; explicitly NOT used for capital decisions (hallucination cascades, no reproducibility)

---

## 2. Three-Layer Model

```
┌─────────────────────────────────────────────────────────────────┐
│                      CERBERUS HOST                              │
│                                                                 │
│  ┌─────────────────┐   MCP stdio   ┌──────────────────────┐    │
│  │   DATA LAYER    │◄─────────────►│   TRADER AGENT       │    │
│  │  (OpenBB MCP)   │               │  (Analyst layer)     │    │
│  └─────────────────┘               │  Council rooms        │    │
│                                    │  multi-agent debate   │    │
│                                    └──────────┬───────────┘    │
│                                               │ human approval  │
│                                               ▼                 │
│                                    ┌──────────────────────┐    │
│                                    │  EXECUTION LAYER     │    │
│                                    │  (trading service)   │    │
│                                    │  NOT an agent        │    │
│                                    └──────────┬───────────┘    │
└───────────────────────────────────────────────┼─────────────────┘
                                                │ EGRESS_ALLOWLIST
                                                ▼
                                     exchange API / Kalshi
```

### Layer 1 — Data (OpenBB MCP)

**What it is**: A local MCP server wrapping [OpenBB](https://github.com/OpenBB-finance/OpenBB) (`github.com/OpenBB-finance/OpenBB`, AGPL-3.0). OpenBB exposes financial data — equity prices, macro indicators, options chains, CFTC positioning, and prediction market data — over MCP stdio. It runs on the compose network with no external telemetry.

**What it provides to TRADER**:
- Active Kalshi contract list: contract ID, YES/NO prices, volume, category, expiry
- Midpoint price for each contract (basis for the favourite-longshot bias classifier)
- Historical fill data for CLV (closing line value) equivalent tracking
- Macro context if needed (FRED via OpenBB)

**MCP integration point**: The existing MCP server pattern in `mcp_servers/` (currently `memory_server.py`, `rag_server.py`) is the template. An `openbb_server.py` is added to the same directory, registered in the MCP manager via `manage_mcp`, and exposed as `mcp__openbb__*` tools to agents that have it in their allowlist.

**TRADER agent access**: The TRADER agent's tool allowlist (§5) includes `mcp__openbb__*` read tools. It does not include write tools, order tools, or any tool that produces side effects on the exchange.

### Layer 2 — Analyst (Council Rooms / TRADER Agent)

**What it is**: The existing Cerberus Council room infrastructure running a structured multi-agent debate over the Data layer's output. The "TRADER agent" visible in the Command Center is the entry point for this layer; internally it spawns a Council session.

**What it does**:
1. Pulls active Kalshi contracts from Data layer via `mcp__openbb__*`
2. Filters to contracts where midpoint ≥ 50¢ (the GWU 2026 documented edge zone for market makers)
3. Assigns sub-roles in the Council debate — Bull analyst, Bear analyst, Risk reviewer, Synthesis agent
4. Each sub-agent receives the contract data as structured context, wrapped in the `untrusted_context_message` guard from `src/prompt_security.py` before any LLM sees it
5. Synthesis agent produces a structured recommendation object: `{contract_id, direction, confidence, rationale, proposed_price, proposed_size_pct_capital}`
6. The recommendation is surfaced in the Cerberus UI as a pending action; no order is placed

**What it explicitly does not do**:
- Generate trade parameters from free-form model output
- Call any execution tool, order tool, or trading API
- Retain market data in agent memory across sessions (stateless per turn)

**Design reference**: The TradingAgents debate structure (analyst / sentiment / technical / risk / trader roles) informed the sub-role assignment above. None of TradingAgents' code or APIs are used; the observation is that structured debate reduces single-agent overconfidence, which is independently documented in TrustTrade's selective-consensus approach.

### Layer 3 — Execution (Trading Service)

**What it is**: A separate Python service — **not a Cerberus agent** — that receives approved trade recommendations and places orders. It runs as its own compose service (e.g. `cerberus-trader`), not inside the Cerberus app process.

**Why it is not an agent**: Agents are general-purpose, multi-tool, LLM-driven. The execution path must be narrow, deterministic, and auditable. A service with a single `approve_and_execute(rec)` entry point and 50 lines of order logic is auditable. An agent with `bash`, `python`, and a prompt is not.

**What it receives**: A signed recommendation object that the human explicitly approved in the Cerberus UI. The approval step is a UI gate in the Cerberus frontend — the service listens on an internal endpoint for approved objects only.

**What it calls**: Kalshi REST API (Phase 1 only). No other exchange. No equities, no crypto, no futures. See the companion doc for phasing.

**Capital controls enforced at this layer** (not in the agent):
- Max position per contract: 2% of capital (derived from APEX risk controls)
- Daily loss circuit breaker: halt if account drops 3% in one day
- Data staleness check: if the price data in the recommendation is older than 30 s, reject
- Kill switch endpoint: cancels all open orders and disconnects, callable from Cerberus UI

These controls are in the trading service, not in the agent prompt. Prompt-level risk controls are not controls — they are suggestions.

---

## 3. MVP Market — Kalshi Prediction Markets

The first and only market for Phase 1 is [Kalshi](https://kalshi.com) prediction markets.

**Why Kalshi**: The GWU 2026 study (300,000+ contracts) documents a structural favourite-longshot bias: contracts priced ≥50¢ win *more* than their implied probability; contracts priced ≤20¢ win *less*. Market makers providing resting liquidity on the high-probability side capture an average +2.6% ROI. The edge mechanism is cognitive (same bias as lottery overvaluation of low-probability outcomes) and structural (casual participants, not professionals, dominate these markets). The platform is CFTC-regulated, explicitly permits API market making, and requires only $1,000–$5,000 capital to test.

**Invalidation condition** (enforced by the performance tracking component): if, after 300+ live trades, ROI is below 0% after all fees OR closing-line-value equivalent is consistently negative, the system halts and the edge hypothesis is rejected. This condition is hard-coded in the trading service, not in the agent prompt.

**No other markets in Phase 1**: options VRP, crypto funding rates, horse racing, and equities momentum are explicitly out of scope until the Kalshi evidence base is established. See the companion doc for the expansion decision tree.

---

## 4. OpenBB Integration

**Repository**: `github.com/OpenBB-finance/OpenBB`
**Licence**: AGPL-3.0
**Deployment**: runs locally inside the compose network; no API keys leave the host; no telemetry

**MCP server skeleton** (follows `mcp_servers/memory_server.py` pattern):

```
mcp_servers/
  openbb_server.py        ← new; wraps OpenBB Python SDK over stdio MCP
  memory_server.py        ← existing reference
  rag_server.py           ← existing reference
```

`openbb_server.py` exposes read-only tools to the TRADER agent:

| Tool name | What it returns |
|---|---|
| `mcp__openbb__kalshi_markets` | Active contracts: ID, YES/NO prices, volume, category, expiry |
| `mcp__openbb__kalshi_contract` | Single contract detail + recent trade history |
| `mcp__openbb__macro_context` | Selected FRED indicators (optional enrichment) |

All tools are read-only. No `mcp__openbb__*` tool places orders or modifies exchange state.

**Registration**: via the existing MCP manager (`src/tool_utils.get_mcp_manager()`). The `manage_mcp` tool in the Cerberus UI adds the server; the server appears in the agent's tool set as `mcp__openbb__*` once the TRADER agent's allowlist (§5) is configured.

---

## 5. Cerberus Integration Points

### 5.1 Tool Allowlist (src/tool_policy.py)

The TRADER agent carries a narrow tool allowlist enforced by `build_effective_tool_policy(agent_allowlist=...)` in `src/tool_policy.py:175`. The allowlist is the complete set of tools the agent may call; everything else is blocked by inversion.

**TRADER agent allowlist** (read-only and research tools only):

```
mcp__openbb__kalshi_markets
mcp__openbb__kalshi_contract
mcp__openbb__macro_context
web_search          ← for news context on event contracts
web_fetch           ← for public data enrichment
manage_memory       ← read actions only (agent cannot write trade state)
```

**Explicitly excluded from the TRADER agent**:
- `bash`, `python` — no code execution
- `vault_get`, `vault_search`, `vault_unlock` — agent never sees API keys
- `manage_webhooks`, `manage_tokens`, `api_call`, `app_api` — no side-effecting integrations
- All `mcp__openbb__*` order tools — if OpenBB exposes them, they are not in the allowlist
- All email, calendar, session management tools

### 5.2 Owner and Admin Gating (src/tool_security.py)

`blocked_tools_for_owner()` in `src/tool_security.py:293` enforces `NON_ADMIN_BLOCKED_TOOLS` for non-admin sessions. The TRADER agent's allowlist is applied on top of, not instead of, this gate. The effective tool set is: `TRADER_ALLOWLIST ∩ (ALL_TOOLS − NON_ADMIN_BLOCKED_TOOLS_for_owner)`. Both gates must pass.

The `vault_get` and `vault_search` tools are in `NON_ADMIN_BLOCKED_TOOLS` (`src/tool_security.py:43–46`). Even if someone modifies the TRADER allowlist to include them, the owner gate blocks them for non-admin callers. The trading service accesses vault credentials directly via `routes/vault_routes.py`, not via agent tools.

### 5.3 Sandbox Isolation (src/agent_tools/sandbox_backend.py)

The TRADER agent's allowlist does not include `bash` or `python`, so the sandbox (`src/agent_tools/sandbox_backend.py`) is not invoked for TRADER agent turns. The data-retrieval tools (`mcp__openbb__*`, `web_search`, `web_fetch`) run in the main process, not in a sandbox.

The trading service, by contrast, runs in its own compose service with its own network policy. It is not a sandbox — it needs real network egress to the exchange. Egress is controlled at the Docker network layer (§5.4), not via OpenSandbox.

### 5.4 Egress Isolation (SANDBOX_EGRESS_ALLOWLIST)

**TRADER agent** (runs inside Cerberus app process): no egress beyond `mcp__openbb__*` calls (which reach OpenBB on the internal compose network) and `web_search`/`web_fetch` (which go through the existing Cerberus web proxy). The agent has no direct connection to any exchange API.

**Trading service** (separate compose service): `SANDBOX_EGRESS_ALLOWLIST` is set to the minimum required for exchange connectivity. For Phase 1 (Kalshi only):

```
SANDBOX_EGRESS_ALLOWLIST=trading.kalshi.com,api.elections.kalshi.com
```

No other domain is listed. The trading service cannot reach arbitrary external hosts, the Cerberus internal API (except the approval endpoint on the compose network), or any broker beyond Kalshi.

The `_build_network_policy()` function in `src/agent_tools/sandbox_backend.py:159` is the implementation reference for this allowlist model. The trading service applies the same deny-by-default pattern at its own Docker network level.

### 5.5 Vault — API Key Storage (routes/vault_routes.py)

Exchange API keys are stored in Vaultwarden (self-hosted Bitwarden). The vault integration is in `routes/vault_routes.py`. The session key (`BW_SESSION`) is written to `data/vault.json` with mode `0o600`.

**TRADER agent**: never receives or sees API keys. The `vault_get`, `vault_search`, and `vault_unlock` tools are not in the agent's allowlist.

**Trading service**: retrieves the Kalshi API key at startup from Vaultwarden via the `bw` CLI, stores it in process memory only (never on disk, never logged). The key must be provisioned as a **TRADE-ONLY key** — API-level trading permissions only, withdrawal disabled, no read access to unrelated vaults.

**Key provisioning requirement**: before Phase 1 live trading begins, the Kalshi API key must be created with the minimum necessary permissions and the withdrawal flag explicitly disabled on the Kalshi account settings page. This is a manual provisioning step, not something the system enforces programmatically.

---

## 6. Data Flow — One Trade Cycle

```
1. Schedule / user trigger
   └─ TRADER agent wakes (Council room session starts)

2. Data pull (Data Layer)
   └─ agent calls mcp__openbb__kalshi_markets
   └─ returns: [{id, yes_price, no_price, volume, expiry, category}, ...]

3. Bias filter (Analyst Layer — deterministic step)
   └─ filter to contracts where (yes_price + no_price)/2 >= 0.50
   └─ rank by volume descending

4. Council debate (Analyst Layer — LLM step)
   └─ each contract above threshold → multi-agent Council session
   └─ Bull, Bear, Risk sub-agents debate: is the contract's YES price
      above our estimate of true probability?
   └─ market data wrapped in untrusted_context_message() before LLM sees it
   └─ Synthesis agent produces structured recommendation object:
      {contract_id, direction:"YES"|"NO", confidence, rationale, proposed_price,
       proposed_size_pct_capital, data_timestamp}

5. Human approval gate
   └─ recommendation surfaced in Cerberus UI
   └─ human reviews: contract details, rationale, proposed size
   └─ human approves OR rejects (no timeout, no auto-approval)
   └─ approved recommendation signed and forwarded to trading service

6. Pre-flight checks (Execution Layer — trading service)
   └─ data_timestamp <= 30 s old? → reject if stale
   └─ proposed_size_pct_capital <= 2%? → reject if oversized
   └─ daily drawdown < 3%? → halt if circuit breaker tripped
   └─ position already open in this contract? → reject if at limit

7. Order placement (Execution Layer)
   └─ resting limit order on YES side at proposed_price
   └─ order logged: timestamp, contract_id, price, size, order_id

8. Position tracking
   └─ fill logged when matched
   └─ outcome logged at contract expiry
   └─ CLV equivalent calculated: did we buy at better price than contract closed at?

9. Weekly review
   └─ rolling ROI, win rate, CLV summary surfaced in Cerberus UI
   └─ decay indicators checked (§4.4 of companion doc)
```

---

## 7. Reference Repositories

| Repository | URL | How it informs TRADER |
|---|---|---|
| OpenBB | `github.com/OpenBB-finance/OpenBB` | Data layer; MCP server wraps its Python SDK |
| APEX (private) | `/tmp/apex-ref/` | MVP strategy selection, risk control values, invalidation criteria |
| TradingAgents | `github.com/TauricResearch/TradingAgents` | Multi-agent debate structure reference only; **do not use with real capital** |
| OpenAlice | `github.com/TraderAlice/OpenAlice` | Trade-as-git audit model; human-gated execution |
| Vibe-Trading | `github.com/HKUDS/Vibe-Trading` | Bounded-autonomy pattern; read-only default |
| Kalshi API docs | `kalshi.com/docs/api` | REST + WebSocket; rate limits; order types |
| GWU 2026 paper | On file | 300k+ contract study; +2.6% ROI for makers on ≥50¢ contracts |

---

## 8. What This Document Does Not Cover

The following topics are covered in `docs/TRADER_AGENT_RISK_AND_PHASING.md`:

- Risk controls (position limits, circuit breakers, kill switch implementation)
- Development phasing (paper trading → small live → scale decision)
- Invalidation criteria and the 300-trade evidence threshold
- Capital allocation by phase
- Edge decay detection and retirement conditions
- Second strategy expansion (options VRP, crypto funding rate)
- Legal and regulatory considerations (CFTC registration status, record-keeping)

The following topics are explicitly out of scope for TRADER Phase 0–1 and will not appear in any design doc until Kalshi achieves 300+ live trades with positive ROI:

- ML price prediction models
- LLM direct order generation
- Equities, options, crypto, or sports markets
- Multi-strategy portfolio management
- Automated parameter optimisation
- Sentiment / social media feeds
