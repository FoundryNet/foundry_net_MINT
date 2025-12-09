FoundryNet: Universal DePIN Protocol for Work Settlement
A decentralized infrastructure layer for autonomous systems (machines, agents, robots) to prove work, get verified on-chain, and earn MINT tokens instantly on Solana.
Status: Production v3 – Genesis treasury + dynamic minting, ML immune system, probation/ban enforcement
Stack: Solana Anchor program + Python ML API + Real-time dashboard

Overview
FoundryNet is a horizontal DePIN protocol, not a vertical market. Any system capable of HTTP calls and Ed25519 signatures can register, execute work, and earn tokens.

No device gatekeeping — AI agents, 3D printers, CNC machines, autonomous vehicles, robots, IoT sensors, manufacturing systems all plug in the same way
Work settlement is instant — machines submit a job hash, get verified on-chain, and receive MINT via SPL token transfer
No governance needed — no staking, no application process, no committee decisions
Time-anchored tokenomics — MINT is literally time made fungible (0.005 MINT/second)


Architecture
System Components
ComponentPurposeSolana Anchor ProgramCore on-chain logic: job registration, trust scoring, settlement, genesis treasury, dynamic mintingML API (Railway)Receives Helius webhooks, scores jobs with ML model, calls updateTrust on-chainGenesis Treasury (PDA)Stores initial MINT supply. Pays workers until 30% threshold reachedMint Authority (PDA)Activated after treasury threshold. Mints new tokens on-demand for settlementsDashboardReal-time network visualization, machine stats, ML immune system status
Data Flow
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Machine   │────▶│   Solana    │────▶│   Helius    │
│  (OctoPrint)│     │   Program   │     │   Webhook   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐     ┌──────▼──────┐
                    │  Dashboard  │◀────│   ML API    │
                    │             │     │  (Railway)  │
                    └─────────────┘     └─────────────┘

Machine Registration → register_machine() → On-chain state with trust=100
Job Recording → record_job(hash, duration, complexity) → Base reward calculated
ML Scoring → Helius webhook → ML API → update_trust(hash, confidence, delta)
Settlement → settle_job() → Treasury transfer OR dynamic mint → MINT to owner


Economic Model
Time Anchor
BASE_RATE = 0.005 MINT/second = 18 MINT/hour
Work duration is the fundamental unit. MINT is time made fungible.
Reward Formula
reward = duration × 0.005 × complexity × trust × warmup
MultiplierDescriptionDurationSeconds of verified workComplexityNormalized against 7-day network average (0.5x – 2.0x)TrustMachine trust score (0-100, linear multiplier)Warmup0.5x → 1.0x over first 30 jobs
Example Calculations
JobDurationComplexityTrustWarmupRewardNew machine, simple job1 hour1.0x1000.5x9 MINTEstablished machine1 hour1.0x1001.0x18 MINTComplex job1 hour2.0x1001.0x36 MINTFlagged machine1 hour1.0x501.0x9 MINT

Genesis → Dynamic Minting
Phase 1: Genesis Treasury
┌─────────────────────────────────────────────────────────┐
│                    GENESIS PHASE                        │
│  ┌─────────────┐    transfer    ┌─────────────────┐    │
│  │  Treasury   │ ─────────────▶ │  Machine Owner  │    │
│  │  (pre-mint) │                │     (ATA)       │    │
│  └─────────────┘                └─────────────────┘    │
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

Pre-minted supply in treasury PDA
Jobs paid via SPL token transfers
Threshold: 30% of genesis triggers transition

Phase 2: Dynamic Minting
┌─────────────────────────────────────────────────────────┐
│                  DYNAMIC MINTING PHASE                  │
│  ┌─────────────┐    mint_to     ┌─────────────────┐    │
│  │    Mint     │ ─────────────▶ │  Machine Owner  │    │
│  │   (PDA)     │                │     (ATA)       │    │
│  └─────────────┘                └─────────────────┘    │
│                                                         │
│  Supply grows exactly with network activity             │
│  total_supply = genesis + Σ(all_settled_rewards)        │
└─────────────────────────────────────────────────────────┘

Minting enabled automatically when threshold reached
New tokens minted on-demand per settlement
Supply = verified work (identity, not approximation)


Trust & Probation System
ML Immune System
Gradient Boosting classifier detecting gaming patterns:
ClassificationTrust DeltaDescriptionclean+1Normal jobflag_soft-2Suspicious patternflag_strong-5Gaming detected
Probation Flow
Trust 100 ──[flags]──▶ Trust erodes ──[trust=0]──▶ PROBATION
                                                      │
                            ┌─────────────────────────┤
                            │                         │
                      [clean job]              [another flag]
                            │                         │
                            ▼                         ▼
                        RECOVERED               PERMANENT BAN
StatePayoutCan SubmitRecoveryHealthy (trust > 0)Full reward✅—Probation (trust = 0, first time)Zero✅Submit clean jobBanned (trust = 0, second time)Zero❌None
Economic pressure before enforcement — bad actors earn nothing before being blocked.

Live Addresses (Devnet)
ComponentAddressProgramAyFBC6DBStSbrau3wfFZzsX5rX14nx8Gkp8TqF687F5XMINT TokenDUZxXbwwqM8mcZVWfrukfDBQdgEPh2L28t7qA4dyiZmROracle6bxBSyRb4XzC53A5DkR96QLNdnGLvqxBeReewQYv24W9Mint Authority (PDA)CqLdueWPj65g6ay4Fipnabv4AuoNdbnvc3yEKH2zGXCwGenesis Authority (PDA)6PbWf6MLg4tgVse3Zb1Xv7W3VUVYjds9XBSgTmxDZpWW

API Reference
POST /register-machine
Register a new system.
json// Request
{
  "machine_pubkey_base58": "base58-key",
  "owner_pubkey_base58": "base58-wallet"
}

// Response
{
  "success": true,
  "machine_pubkey": "base58-key",
  "trust_score": 100
}
POST /record-job
Record completed work.
json// Request
{
  "machine_pubkey_base58": "base58-key",
  "job_hash": "unique-job-id",
  "duration_seconds": 3600,
  "complexity_claimed": 1000
}

// Response
{
  "success": true,
  "job_hash": "unique-job-id",
  "base_reward_micro": 9000000
}
POST /update-trust (Oracle only)
ML scores job and updates trust.
json// Request
{
  "job_hash": "unique-job-id",
  "ml_confidence": 100,
  "trust_delta": 1
}

// Response
{
  "success": true,
  "old_trust": 100,
  "new_trust": 100,
  "on_probation": false
}
POST /settle-job
Settle job and distribute tokens.
json// Request
{
  "job_hash": "unique-job-id"
}

// Response
{
  "success": true,
  "final_reward_micro": 9000000,
  "from_genesis": true,
  "minted": false,
  "minting_enabled": false
}
```

---

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `BASE_RATE_MICRO` | 5000 | 0.005 MINT/second |
| `TRUST_START` | 100 | Initial trust score |
| `WARMUP_JOBS` | 30 | Jobs until full warmup |
| `MIN_COMPLEXITY` | 500 | 0.5x multiplier floor |
| `MAX_COMPLEXITY` | 2000 | 2.0x multiplier ceiling |
| `COMPLEXITY_SCALE` | 1000 | Scaling factor |
| `GENESIS_THRESHOLD` | 30% | Treasury usage before dynamic minting |
| `PARAM_DELAY` | 48 hours | Timelock for governance changes |

---

## Governance

### Timelock System

Parameter changes require 48-hour timelock:

1. **Propose** — Admin calls `propose_genesis_update(new_value)`
2. **Wait** — 48-hour delay for community review
3. **Finalize** — Anyone can call `finalize_genesis_update()` after timelock

Safety valve, hopefully never used.

---

## Economic Philosophy

### Hayek (Knowledge Problem)
No central planner decides supply or trust. Both emerge from distributed verification.

### Gilder (Time Standard)
MINT is literally time made fungible. The 0.005/second rate creates direct conversion from machine-hours to tokens.

### Oil Economy Parallel
Supply tied to production capacity. Price discovery happens in market, not by committee.

---

## Verified Test Results
```
✓ Core economic flow (register → record → score → settle)
✓ Warmup multiplier (0.5x → 1.0x over 30 jobs)
✓ Complexity normalization (0.5x – 2.0x range)
✓ Trust-weighted rewards (linear 0-100%)
✓ Probation system (zero payout, recovery path)
✓ Permanent ban enforcement (double zero)
✓ Oracle security (unauthorized rejected)
✓ Precision (1 second to 24 hour jobs)
✓ Genesis threshold config (30%, 48hr timelock)
✓ Genesis → dynamic minting transition

License
MIT

Links

Dashboard: foundrynet.app
GitHub: github.com/foundrynet
Solana Explorer: Program on Devnet
Retry
