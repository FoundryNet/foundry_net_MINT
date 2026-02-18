# FoundryNet: Universal DePIN Protocol for Work Settlement

A decentralized infrastructure layer for autonomous systems to prove work, get verified on-chain, and earn MINT tokens instantly on Solana.

**Status:** Production v1 – Genesis treasury + dynamic minting, ML immune system, probation/ban enforcement

**Stack:** Solana Anchor program + Python ML API + Real-time dashboard

---

## Links

| Resource | URL |
|----------|-----|
| Dashboard | https://foundrynet.github.io/foundry_net_MINT/ |
| GitHub | https://github.com/foundrynet |
| Program (Solscan) | [4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL](https://solscan.io/account/4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL) |
| MINT Token | [5Pd4YBgFdih88vAFGAEEsk2JpixrZDJpRynTWvqPy5da](https://solscan.io/token/5Pd4YBgFdih88vAFGAEEsk2JpixrZDJpRynTWvqPy5da) |
  https://github.com/FoundryNet/foundry_net_MINT/blob/main/For%20Autonomous%20AI%20Agents.md

---

## Overview

FoundryNet is a **horizontal DePIN protocol**, not a vertical market. Any system capable of HTTP calls and Ed25519 signatures can register, execute work, and earn tokens.

- **No device gatekeeping** — Any autonomous system plugs in the same way
- **Instant work settlement** — Submit a job hash, get verified on-chain, receive MINT via SPL token transfer
- **No governance needed** — No staking, no application process, no committee decisions
- **Time-anchored tokenomics** — MINT is literally time made fungible (0.005 MINT/second)

---

## Architecture

### System Components

| Component | Purpose |
|-----------|---------|
| Solana Anchor Program | Core on-chain logic: job registration, trust scoring, settlement, genesis treasury, dynamic minting |
| ML API (Railway) | Receives Helius webhooks, scores jobs with ML model, calls update_trust on-chain |
| Genesis Treasury (PDA) | Stores initial MINT supply. Pays workers until 30% threshold reached |
| Mint Authority (PDA) | Activated after treasury threshold. Mints new tokens on-demand for settlements |
| Dashboard | Real-time network visualization, machine stats, ML immune system status |

### Data Flow
```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Machine   │──────▶│   Solana    │──────▶│   Helius    │
│             │       │   Program   │       │   Webhook   │
└─────────────┘       └─────────────┘       └──────┬──────┘
                                                   │
                                            ┌──────▼──────┐
                                            │   ML API    │
                                            │  (Railway)  │
                                            └──────┬──────┘
                                                   │
                                            ┌──────▼──────┐
                                            │  Dashboard  │
                                            └─────────────┘
```

### Flow Steps

1. **Machine Registration** → `register_machine()` → On-chain state with trust=100
2. **Job Recording** → `record_job(hash, duration, complexity)` → Base reward calculated
3. **ML Scoring** → Helius webhook → ML API → `update_trust(hash, confidence, delta)`
4. **Settlement** → `settle_job()` → Treasury transfer OR dynamic mint → MINT to owner

---

## Economic Model

### Time Anchor
```
BASE_RATE = 0.005 MINT/second = 18 MINT/hour
```

Work duration is the fundamental unit. MINT is time made fungible.

### Reward Formula
```
reward = duration × 0.005 × complexity × trust × warmup
```

| Multiplier | Description |
|------------|-------------|
| Duration | Seconds of verified work |
| Complexity | Normalized against 7-day network average (0.5x – 2.0x) |
| Trust | Machine trust score (0–100, linear multiplier) |
| Warmup | 0.5x → 1.0x over first 30 jobs |

### Example Calculations

| Scenario | Duration | Complexity | Trust | Warmup | Reward |
|----------|----------|------------|-------|--------|--------|
| New machine, simple job | 1 hour | 1.0x | 100 | 0.5x | 9 MINT |
| Established machine | 1 hour | 1.0x | 100 | 1.0x | 18 MINT |
| Complex job | 1 hour | 2.0x | 100 | 1.0x | 36 MINT |
| Flagged machine | 1 hour | 1.0x | 50 | 1.0x | 9 MINT |

### Fee Distribution

Every settlement splits rewards:

| Recipient | Share |
|-----------|-------|
| Worker (machine owner) | 96% |
| Personal fee wallet | 2% |
| Protocol fee wallet | 2% |

---

## Genesis → Dynamic Minting

### Phase 1: Genesis Treasury
```
┌─────────────────────────────────────────────────────────┐
│                    GENESIS PHASE                        │
│                                                         │
│  ┌─────────────┐  transfer   ┌─────────────┐           │
│  │  Treasury   │ ──────────▶ │   Machine   │           │
│  │  (pre-mint) │             │ Owner (ATA) │           │
│  └─────────────┘             └─────────────┘           │
│         │                                               │
│         ▼                                               │
│  genesis_released_micro increments                      │
│         │                                               │
│         ▼                                               │
│  if released >= 30% threshold OR treasury empty         │
│         │                                               │
│         ▼                                               │
│  minting_enabled = true                                 │
└─────────────────────────────────────────────────────────┘
```

- Pre-minted supply in treasury PDA
- Jobs paid via SPL token transfers
- Threshold: 30% of genesis triggers dynamic minting

### Phase 2: Dynamic Minting
```
┌─────────────────────────────────────────────────────────┐
│                 DYNAMIC MINTING PHASE                   │
│                                                         │
│  ┌─────────────┐  mint_to    ┌─────────────┐           │
│  │    Mint     │ ──────────▶ │   Machine   │           │
│  │    (PDA)    │             │ Owner (ATA) │           │
│  └─────────────┘             └─────────────┘           │
│                                                         │
│  Supply grows exactly with network activity             │
│  total_supply = genesis + Σ(all_settled_rewards)        │
└─────────────────────────────────────────────────────────┘
```

- Minting enabled automatically when threshold reached
- New tokens minted on-demand per settlement
- Supply = verified work (identity, not approximation)

---

## Trust & Probation System

### ML Immune System

Gradient Boosting classifier detects gaming patterns:

| Classification | Trust Delta | Description |
|----------------|-------------|-------------|
| clean | +1 | Normal job |
| flag_soft | -2 | Suspicious pattern |
| flag_strong | -5 | Gaming detected |

### Probation Flow
```
Trust 100 ──[flags]──▶ Trust erodes ──[trust=0]──▶ PROBATION
                                                      │
                                          ┌───────────┴───────────┐
                                          ▼                       ▼
                                      RECOVERED              PERMANENT BAN
                                   (clean job submitted)    (second offense)
```

| State | Payout | Can Submit | Recovery |
|-------|--------|------------|----------|
| Healthy (trust > 0) | Full reward | ✅ | — |
| Probation (trust=0, first time) | Zero | ✅ | Submit clean job |
| Banned (trust=0, second time) | Zero | ❌ | None |

Economic pressure before enforcement — bad actors earn nothing before being blocked.

---

## Live Addresses (Mainnet)

| Component | Address |
|-----------|---------|
| Program | `4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL` |
| State Account | `2Lm7hrtqK9W5tykVu4U37nUNJiiFh6WQ1rD8ZJWXomr2` |
| MINT Token | `5Pd4YBgFdih88vAFGAEEsk2JpixrZDJpRynTWvqPy5da` |
| Oracle | `7SgQbwxFMTJcTNkQ8uQB1YLnodJtgWkfej3p4aTv3bHD` |
| Genesis Treasury ATA | `JYkvEAiSmPTXMp1KDmgk9LLZVgNRU7oxXEw3L7veu2z` |
| Personal Fee ATA | `CWWXT7dkMrYCraZqffgG1Fk87ZWhqNGEznLfg9B5eRmU` |
| Protocol Fee ATA | `Hd1usKUanHb5zjryZrr3iGujFJHq4Tcg3Frpsrejq2L5` |

---

## API Reference

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "model": "v4",
  "economic_model": "v2_time_anchor",
  "base_rate": 0.005,
  "machines": 1,
  "jobs": 10,
  "total_mint_minted": 1.5,
  "network": "mainnet"
}
```

### Network Statistics
```
GET /stats
```

Response:
```json
{
  "network_avg_complexity": 1.0,
  "network_avg_duration": 300,
  "machines": 1,
  "total_jobs": 10,
  "total_duration_hours": 0.5,
  "total_mint_minted": 1.5,
  "base_rate": 0.005
}
```

### Economy Overview
```
GET /economy
```

Response:
```json
{
  "constants": {
    "base_rate": 0.005,
    "base_rate_per_hour": 18,
    "warmup_jobs": 30,
    "decay_halflife_days": 5,
    "complexity_bounds": [0.5, 2.0]
  },
  "network": {
    "total_jobs": 10,
    "total_duration_hours": 0.5,
    "total_mint_minted": 1.5,
    "total_machines": 1,
    "avg_complexity_7d": 1.0
  },
  "machines": [...]
}
```

### Recent Jobs
```
GET /recent-scores
```

Response:
```json
{
  "count": 10,
  "jobs": [
    {
      "timestamp": "2025-12-12T19:17:37",
      "job_hash": "job_abc123",
      "machine_id": "J8jT...",
      "confidence": 0.001,
      "action": "clean",
      "economics": {
        "final_reward": 0.15,
        "trust_score": 100
      },
      "solscan": {
        "record": "https://solscan.io/tx/...",
        "settle": "https://solscan.io/tx/..."
      }
    }
  ]
}
```

### Machine Info
```
GET /machine/<machine_id>
```

Response:
```json
{
  "machine_id": "J8jT...",
  "job_count": 10,
  "trust_score": 100,
  "warmup": 0.67,
  "total_earned": 1.5,
  "solscan_url": "https://solscan.io/account/J8jT...",
  "recent_transactions": [...]
}
```

### Calculate Reward (Simulation)
```
POST /calculate-reward
```

Request:
```json
{
  "duration_seconds": 3600,
  "complexity_claimed": 1.0,
  "trust_score": 100,
  "job_count": 15
}
```

Response:
```json
{
  "base_reward": 13.5,
  "final_reward": 13.5,
  "warmup_multiplier": 0.75,
  "trust_multiplier": 1.0
}
```

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| BASE_RATE | 0.005 | MINT per second |
| TRUST_START | 100 | Initial trust score |
| WARMUP_JOBS | 30 | Jobs until full warmup |
| MIN_COMPLEXITY | 0.5 | Minimum complexity multiplier |
| MAX_COMPLEXITY | 2.0 | Maximum complexity multiplier |
| GENESIS_THRESHOLD | 30% | Treasury usage before dynamic minting |
| FEE_BPS | 200 | 2% fee (basis points) |

---

## Economic Philosophy

### Hayek (Knowledge Problem)

No central planner decides supply or trust. Both emerge from distributed verification. The 7-day rolling complexity average aggregates network knowledge without central coordination.

### Gilder (Time Standard)

MINT is literally time made fungible. The 0.005/second rate creates direct conversion from machine-hours to tokens. Stable measuring stick, not manipulated unit.

### Sound Money Principles

Supply tied to production. Genesis phase allows price discovery with bounded supply. Dynamic minting expands supply proportional to verified work—not inflation, but monetary expansion matching economic output.

---

## Verified Capabilities

- Core economic flow (register → record → score → settle)
- Warmup multiplier (0.5x → 1.0x over 30 jobs)
- Complexity normalization (0.5x – 2.0x range)
- Trust-weighted rewards (linear 0–100%)
- Probation system (zero payout, recovery path)
- Permanent ban enforcement
- Oracle security (unauthorized rejected)
- Precision handling (1 second to 24 hour jobs)
- Genesis → dynamic minting transition
- Atomic fee distribution (96/2/2 split)

---

## Getting Started

1. **Register a machine** — Generate Ed25519 keypair, call `register_machine` on-chain
2. **Submit jobs** — Call `record_job` with job hash, duration, and complexity
3. **Receive payment** — ML scores job, trust updates, settlement transfers MINT to your wallet

All transactions visible on [Solscan](https://solscan.io/account/4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL).

---

*FoundryNet v1 | Wages for Machines | Time Anchor: 0.005 MINT/sec*
