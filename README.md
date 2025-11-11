# FoundryNet: Universal DePIN Protocol for Work Settlement

A decentralized infrastructure layer for autonomous systems (machines, agents, robots) to prove work, get verified on-chain, and earn MINT tokens instantly on Solana.

**Status:** Production v2 - 41 machines registered, 4 active, 380+ jobs completed, ~30 MINT/batch

**Stack:** Deno edge functions + Solana Anchor program + Python/Node.js client SDKs

---

## Overview

FoundryNet is a horizontal DePIN protocol, not a vertical market. Any system capable of HTTP calls and cryptographic signatures can register, execute work, and earn tokens.

The protocol doesn't gatekeep by device type—AI agents, 3D printers, CNC machines, autonomous vehicles, robots, IoT sensors, manufacturing systems—all plug in the same way.

**Work settlement is instant.** Machines submit a job hash, prove work completion with an Ed25519 signature, and receive MINT directly via SPL token transfer on Solana.

- No governance needed
- No staking
- No application process

---

## Architecture

### System Components

| Component | Purpose |
|-----------|---------|
| **Edge Functions (Deno)** | Supabase Edge Functions running TypeScript. Handles registration, job submission, completion, reward calculation, on-chain settlement. |
| **Solana Anchor Program** | On-chain state machine for recording jobs, tracking challenges, auto-replenishing treasury via minting logic. |
| **Database (Supabase PostgreSQL)** | Stores machine metadata, job history, payloads, transaction signatures for audit trail. |
| **Client SDK (Python/Node.js)** | Language-agnostic package. Handles initialization, job hashing, cryptographic signing, retry logic, metrics polling. |
| **Treasury Wallet (Hot Wallet)** | Solana keypair with SPL token authority. Auto-replenishes from on-chain minting logic. |

### Data Flow
```
System Init
  ↓
client.init() → Ed25519 keypair → .foundry_credentials.json

Job Register
  ↓
generateJobHash() → POST /submit-job → Supabase INSERT

Work Execution
  ↓
[Real work happens - agent processing, machine fabrication, computation]

Job Complete
  ↓
completeJob() → Ed25519 signature → POST /complete-job

Verification
  ↓
Backend verifies signature, duration, rate limits

Calculation
  ↓
Calculate reward (base + activity ratio + decay)

Treasury Fee
  ↓
Split: 2% → treasury, 98% → system owner

Settlement
  ↓
Two SPL transfers in single tx → Confirm → DB update
```

---

## Reward Mechanics

### Base Reward Formula
```
reward = (duration_seconds × 0.005 MINT/sec) 
       × complexity 
       × activity_ratio^(-0.4) 
       × decay_multiplier
```

### Base Rate

- **0.005 MINT per second** of work
- Non-linear tapering after 30 minutes: sqrt() function dampens rewards for very long jobs, preventing runaway emissions

### Complexity Multiplier

Range: **0.5 - 2.0**

- **0.5** = Simple task (e.g., basic agent inference, simple print)
- **1.0** = Baseline (default)
- **1.5** = High complexity (e.g., multi-step agent coordination, multi-material work)
- **2.0** = Maximum complexity (e.g., complex reasoning, precision manufacturing)

### Activity Ratio

Real-time elasticity. Measures network utilization over a rolling 1-hour window:
```
activity_ratio = (total_runtime_in_window) / (active_nodes × baseline_runtime)
```

Applies dampening via exponential decay (0.3/hour pull rate) to smooth spikes:

- **0.5** (quiet) → reward multiplier = **1.74x** (attracts work)
- **1.0** (equilibrium) → reward multiplier = **1.0x** (baseline)
- **2.0** (busy) → reward multiplier = **0.76x** (cools off demand)

### Decay Multiplier

Time-based depreciation. Exponential model with 5-day half-life:
```
decay_mult = max(0.5, 0.5 ^ (days_since_launch / 5))
```

- Day 0: **1.0x**
- Day 5: **0.5x** (half-life)
- Day 10: **0.25x**
- Day ∞: **min 0.5x**

### Min/Max Reward Bounds

Regardless of formula output, rewards are clamped:

- **Minimum:** 0.5 MINT per job
- **Maximum:** 10 MINT per job

---

## Treasury Fee Structure

Every completed job is split **2/98**:

- **98%** → System owner's wallet
- **2%** → Treasury (HPgJJNMHWyu3imLSSQkTV8LsvubM4Aa64n4z4Vm2dvu8)

Both transfers execute atomically in a single Solana transaction. If either fails, the entire job settlement fails and is marked as failed in the database.

Treasury accumulation funds operational costs (RPC, Supabase, API infrastructure).

---

## Dynamic Supply Mechanics

Supply is **uncapped and follows demand**. The protocol auto-mints new MINT tokens when treasury reserves fall below minimum thresholds.

Pure Gilderian economics—value extracted from real work, not printed arbitrarily.

### Treasury Replenishment

Three-tier minting logic:

| Tier | Threshold | Action |
|------|-----------|--------|
| **Critical** | < 10M MINT | Mint enough MINT to sustain 90 days at current burn rate (emergency replenishment) |
| **Opportunistic** | 10M - 20M MINT | Mint 30 days' worth of burn rate (network is active, reserves moderate) |
| **Healthy** | > 20M MINT | No minting needed (treasury is adequately capitalized) |

All minting checks execute daily via cron. The on-chain Anchor program tracks `total_minted`, `average_daily_burn`, and `total_paid_out` for audit trail.

---

## Real-Time Network Monitoring

Live dashboard shows:

- Treasury balance (MINT and SOL)
- Active systems in latest batch
- Total systems registered
- MINT distributed (last hour)
- Average reward per job
- Activity ratio (current)
- Reward multiplier (current)
- Burn rate (MINT/hour)
- Runway (estimated days at current burn)

Fetched via `GET /metrics` endpoint. Updates every 60 seconds. Backed by Supabase queries + on-chain treasury balance checks.

---

## API Endpoints

### POST /register-machine

Register system (agent, machine, robot) for the first time.

**Request:**
```json
{
  "machine_uuid": "uuid-string",
  "machine_pubkey_base58": "base58-encoded-public-key",
  "metadata": {
    "type": "agent|machine|robot",
    "model": "gpt-4|Ender3|UR10",
    "version": "1.0.0"
  }
}
```

**Response:**
```json
{
  "success": true,
  "machine_uuid": "uuid-string"
}
```

### POST /submit-job

Register job start. Complexity parameter: 0.5-2.0

**Request:**
```json
{
  "machine_uuid": "uuid-string",
  "job_hash": "job-hash",
  "complexity": 1.2,
  "payload": {
    "task": "data processing|fabrication|computation"
  }
}
```

**Response:**
```json
{
  "success": true,
  "job_hash": "job-hash",
  "started_at": "2025-11-11T12:00:00Z"
}
```

### POST /complete-job

Complete job and settle payment. Requires Ed25519 signature of `(job_hash|recipient_wallet|timestamp)`.

**Request:**
```json
{
  "machine_uuid": "uuid-string",
  "job_hash": "job-hash",
  "recipient_wallet": "wallet-address",
  "completion_proof": {
    "timestamp": "2025-11-11T12:05:00Z",
    "signature_base58": "base58-encoded-signature"
  }
}
```

**Response:**
```json
{
  "success": true,
  "reward_total": 0.15,
  "reward_net": 0.147,
  "reward_fee": 0.003,
  "tx_signature": "solana-tx-hash",
  "activity_ratio": 1.0,
  "activity_multiplier": 1.0,
  "decay_multiplier": 0.99
}
```

Performs all verification, reward calculation, treasury fee deduction, and on-chain settlement atomically.

### GET /metrics

Fetch real-time network metrics.

**Response:**
```json
{
  "network": {...},
  "activity": {...},
  "decay": {...},
  "treasury": {...},
  "recent_jobs": [...]
}
```

---

## Client SDK

### Installation

**Python (Primary):**
```bash
pip install foundry-client
```

**Node.js:**
```bash
npm install foundry-client
```

### Python Usage
```python
from foundry_client import FoundryClient

# Initialize client
client = FoundryClient({
    'debug': True
})

# Initialize system (generates keypair on first run)
client.init({
    'type': 'agent',  # or 'machine', 'robot'
    'model': 'gpt-4'
})

# Submit job
job_hash = client.generate_job_hash('task_001')
client.submit_job(job_hash, 1.0, {'task': 'analysis'})

# ... do work ...

# Complete job and earn MINT
result = client.complete_job(job_hash, 'WALLET_ADDRESS')
print(f"Earned {result['reward_net']} MINT")

# Fetch metrics
metrics = client.get_metrics()
print(metrics['treasury']['balance_mint'])
```

### Node.js Usage
```javascript
import { FoundryClient } from 'foundry-client';

const client = new FoundryClient({
  apiUrl: 'https://...',
  retryAttempts: 3,
  retryDelay: 2000,
  debug: true
});

await client.init({
  type: 'agent',
  model: 'gpt-4'
});

const jobHash = client.generateJobHash('task_001');
await client.submitJob(jobHash, 1.0, { task: 'analysis' });

// ... do work ...

const result = await client.completeJob(jobHash, 'WALLET_ADDRESS');
console.log(`Earned ${result.reward_net} MINT`);
```

### Method Reference

| Method | Purpose |
|--------|---------|
| `init(metadata)` | Initialize system. Generates keypair on first run, saves to `.foundry_credentials.json` |
| `submit_job(job_hash, complexity, payload)` | Register work start |
| `complete_job(job_hash, recipient_wallet)` | Complete work and earn MINT |
| `generate_job_hash(task_id, additional_data)` | Create deterministic job ID |
| `get_metrics()` | Fetch real-time network state |
| `get_machine_uuid()` | Return system UUID |
| `get_public_key()` | Return system public key |

---

## Integration Examples

### AI Agent (LangChain / N8N)
```python
from foundry_client import FoundryClient

client = FoundryClient()
client.init({'type': 'agent', 'model': 'gpt-4'})

job_hash = client.generate_job_hash('query_analysis')
client.submit_job(job_hash, 1.2, {'task': 'analyze market data'})

# Agent processes query
response = run_langchain_agent(query)

client.complete_job(job_hash, 'AGENT_WALLET')
print("Agent earned MINT for work")
```

### Autonomous Robot (ROS2)
```python
import rospy
from foundry_client import FoundryClient

client = FoundryClient()
client.init({'type': 'robot', 'model': 'UR10'})

def on_task_start(task_name):
    job_hash = client.generate_job_hash(task_name)
    client.submit_job(job_hash, 1.5, {'task': task_name})

def on_task_complete(task_name):
    client.complete_job(job_hash, 'ROBOT_WALLET')

rospy.on_shutdown(on_task_complete)
```

### Manufacturing System (CNC / 3D Printer)
```python
from foundry_client import FoundryClient

client = FoundryClient()
client.init({'type': 'machine', 'model': 'Prusa i3'})

job_hash = client.generate_job_hash('print_001')
client.submit_job(job_hash, 1.0, {'file': 'part.gcode'})

# Machine executes
import time
time.sleep(estimated_duration)

client.complete_job(job_hash, 'MACHINE_WALLET')
print("Machine earned MINT for fabrication")
```

---

## Security & Verification

### Proof of Productivity

Every job completion requires:

- Unique job hash (prevents replay attacks)
- Ed25519 signature (proves system ownership)
- Recent timestamp (within 5 minutes of submission)
- Minimum duration (60 seconds elapsed)
- Rate limiting (400 MINT/24h per system)

### System Credentials

- Generated locally on `init()`
- Stored in `.foundry_credentials.json`
- Private key never leaves system
- **Backup before loss of device**

### Anti-Fraud Measures

- Job hash uniqueness enforced at database level
- Signature verification on all completions
- Duration verification prevents instant gaming
- Per-system daily cap (400 MINT/24h) prevents rate abuse

---

## System Limits

| Limit | Value |
|-------|-------|
| Max MINT per job | 10 MINT |
| Min MINT per job | 0.5 MINT |
| Max MINT per system per day | 400 MINT |
| Min job duration | 60 seconds |
| Activity ratio window | 1 hour rolling |
| Decay half-life | 5 days |
| Rate limit backoff | 2 seconds |
| Retry attempts (SDK) | 3 |

---

## Vision

FoundryNet is infrastructure for the autonomous economy. The protocol is horizontal, not vertical. It doesn't pick winners or favor one system type over another.

Any system capable of HTTP calls and Ed25519 signing can register and earn.

### Today

Agents and machines prove work, get verified on-chain, settled instantly.

### Tomorrow

- AI agents coordinate supply chains and economic workflows
- Manufacturing systems (CNC, 3D printers, robotics) bid on contracts
- Autonomous vehicles stake reputation and earn routes
- Robots coordinate tasks across teams
- Manufacturing becomes programmable
- Work becomes liquid

The protocol handles identity, verification, and settlement. Everything else—quality systems, marketplaces, reputation networks, governance—gets built on top by the community.

Pure Gilderian mechanics. Value from real work + identity + time. No capital required. No staking. No gatekeeping.

---

## Open Source

All code is open-source on GitHub:

- **Client SDK:** [foundrynet/foundry-client](https://github.com/foundrynet/foundry-client)


**License:** MIT. Fork it. Build on it. Improve it.

The more systems plug in, the more valuable the protocol becomes.

---

## Current Status (Production v2)

- 41 systems registered
- 4 currently active
- 380+ jobs completed
- ~30 MINT per batch
- Real hardware and agents running (LangChain agents, Prusa, MakerBot tested)

---

## Questions?

- GitHub Issues: Report bugs
- Twitter: @Foundry25
- Email: foundrynet@proton.me
