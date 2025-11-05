FoundryNet
Universal DePIN Protocol for Work Settlement
A decentralized infrastructure layer for autonomous systems to prove work, get verified on-chain, and earn MINT tokens instantly on Solana.
Status: Production v2 - 41 machines registered, 4 active, 380+ jobs completed, ~30 MINT/batch
Stack: Deno edge functions + Solana Anchor program + Node.js client SDK
Executive Summary
FoundryNet is a horizontal DePIN protocol, not a vertical market. Any machine capable of HTTP calls and cryptographic signatures can register, execute work, and earn tokens. The protocol doesn't gatekeep by device type—Prusa 3D printers, Makerbots, CNC machines, autonomous vehicles, AI agents, IoT sensors, all plug in the same way.
Work settlement is instant. Machines submit a job hash, prove work completion with an Ed25519 signature, and receive MINT directly via SPL token transfer on Solana. No governance needed. No staking. No application process.
Architecture
System Components
Edge Functions (Deno): Supabase Edge Functions running TypeScript. Handles machine registration, job submission, job completion, reward calculation, on-chain settlement.
Solana Anchor Program: On-chain state machine for recording jobs, tracking challenges, auto-replenishing treasury via minting logic.
Database (Supabase PostgreSQL): Stores machine metadata, job history, job payloads, transaction signatures for audit trail.
Client SDK (Node.js/ES6): npm package. Handles machine initialization, job hashing, cryptographic signing, retry logic, metrics polling.
Treasury Wallet (Hot Wallet): Solana keypair with SPL token authority. Auto-replenishes from on-chain minting logic when reserves drop.
Data Flow
Machine Init: client.init() → Ed25519 keypair → .foundry_credentials.json
Job Register: generateJobHash() → POST /submit-job → Supabase INSERT
Work Execution: [Real hardware does real work]
Job Complete: completeJob() → Ed25519 signature → POST /complete-job
Verification: Backend verifies signature, duration, rate limits
Calculation: Calculate reward (base + activity ratio + decay)
Treasury Fee: Split: 2% → treasury, 98% → machine
Settlement: Two SPL transfers in single tx → Confirm → DB update
Reward Mechanics
Base Reward Calculation
Formula:
reward = (duration_seconds × 0.005 MINT/sec) × complexity × activity_ratio^(-0.4) × decay_multiplier
Base Rate
0.005 MINT per second of work. Non-linear tapering after 30 minutes: sqrt() function dampens rewards for very long jobs, preventing runaway emissions.
Complexity Multiplier
Range: 0.5 - 2.0. Machines report complexity of work:
0.5 = simple task (e.g., printing a basic part)
1.0 = baseline (default)
1.5 = high complexity (e.g., multi-material print)
2.0 = maximum complexity
Tier Multipliers
Different machine types have different base multipliers:


Activity Ratio
Real-time elasticity. Measures network utilization over a rolling 1-hour window:
activity_ratio = (total_runtime_in_window) / (active_nodes × baseline_runtime)
Then applies dampening via exponential decay (0.3/hour pull rate) to smooth out spikes.
0.5 (quiet) → reward multiplier = 1.74x (attracts work)
1.0 (equilibrium) → reward multiplier = 1.0x (baseline)
2.0 (busy) → reward multiplier = 0.76x (cools off demand)
Decay Multiplier
Time-based depreciation. Exponential model with 5-day half-life. After N days since launch:
decay_mult = max(0.5, 0.5 ^ (days_since_launch / 5))
Day 0: 1.0x | Day 5: 0.5x (half-life) | Day 10: 0.25x | Day ∞: min 0.5x
Min/Max Reward Bounds
Regardless of formula output, rewards are clamped: 0.5 MINT (min) to 10 MINT (max) per job.
Treasury Fee Structure
Every completed job is split 2/98:
98% → Machine owner's wallet
2% → Treasury (HPgJJNMHWyu3imLSSQkTV8LsvubM4Aa64n4z4Vm2dvu8)
Both transfers execute atomically in a single Solana transaction. If either fails, the entire job settlement fails and is marked as failed in the database.
Treasury accumulation funds operational costs (RPC, Supabase, API infrastructure).
Dynamic Supply Mechanics
Supply is uncapped and follows demand. The protocol auto-mints new MINT tokens when treasury reserves fall below minimum thresholds. This is pure Gilderian economics—value extracted from real work, not printed arbitrarily.
Treasury Replenishment
Three-tier minting logic:
Critical (< 10M MINT)
Mint enough MINT to sustain 90 days at current burn rate. This is emergency replenishment.
Opportunistic (10M - 20M MINT)
Mint 30 days' worth of burn rate. Network is active, reserves are moderate.
Healthy (> 20M MINT)
No minting needed. Treasury is adequately capitalized.
All minting checks execute daily via cron. The on-chain Anchor program tracks total_minted, average_daily_burn, and total_paid_out for audit trail.
Real-Time Network Monitoring
Live dashboard shows:
Treasury balance (MINT and SOL)
Active machines in latest batch
Total machines registered
MINT distributed (last hour)
Average reward per job
Activity ratio (current)
Reward multiplier (current)
Burn rate (MINT/hour)
Runway (estimated days at current burn)
Fetched via GET /metrics endpoint. Updates every 60 seconds. Backed by Supabase queries + on-chain treasury balance checks.
Current Status (Production v2)


Real hardware running. Prusa and MakerBot printers tested and active.
API Endpoints
POST /register-machine
Register machine for the first time.
Request: { machine_uuid, machine_pubkey_base58, metadata }
Response: { success: true, machine_uuid }
POST /submit-job
Register job start. Complexity parameter: 0.5-2.0
Request: { machine_uuid, job_hash, complexity, payload }
Response: { success: true, job_hash, started_at }
POST /complete-job
Complete job and settle payment. Requires Ed25519 signature of (job_hash|recipient_wallet|timestamp).
Request: { machine_uuid, job_hash, recipient_wallet, completion_proof }
Response: { success: true, reward_total, reward_net, reward_fee, tx_signature, activity_ratio, activity_multiplier, decay_multiplier }
Performs all verification, reward calculation, treasury fee deduction, and on-chain settlement atomically.
GET /metrics
Fetch real-time network metrics.
Response: { network: {...}, activity: {...}, decay: {...}, treasury: {...}, recent_jobs: [...] }
Client SDK (Node.js)
Published on npm as foundry-client@1.0.0
npm install foundry-client
Initialization
import { FoundryClient } from 'foundry-client';
const client = new FoundryClient({
  apiUrl: 'https://...', // Supabase edge function URL
  retryAttempts: 3,
  retryDelay: 2000,
  debug: true
});
await client.init({ type: 'printer', model: 'Ender 3' });
Submit and Complete a Job
const jobHash = client.generateJobHash('my_part.gcode');
await client.submitJob(jobHash, 1.2, { file: 'my_part.gcode' });
// ... do work ...
const result = await client.completeJob(jobHash, 'WALLET_ADDRESS');
console.log(`Earned ${result.reward_net} MINT`);
Fetch Metrics
const metrics = await client.getMetrics();
console.log(metrics.treasury.balance_mint, metrics.activity.activity_ratio);
Method Reference
init(metadata): Initialize machine. Generates keypair on first run, saves to .foundry_credentials.json.
submitJob(jobHash, complexity, payload): Register work start.
completeJob(jobHash, recipientWallet): Complete work and earn MINT.
generateJobHash(filename, additionalData): Create deterministic job ID.
getMetrics(): Fetch real-time network state.
getMachineUuid(), getPublicKey(): Return machine identity.
Integration Examples
3D Printer (OctoPrint)
// Hook into OctoPrint event system
function onPrintStart(filename) {
  const jobHash = client.generateJobHash(filename);
  client.submitJob(jobHash, 1.0, { file: filename });
} // On print complete, call completeJob()
CNC Machine (GRBL)
const jobHash = client.generateJobHash('program.gcode');
await client.submitJob(jobHash, 1.8, { program: 'program.gcode' });
// Listen for M2/M30 (program end)
setTimeout(() => client.completeJob(jobHash, 'WALLET'), estimatedTime * 1000);
AI Agent (LangChain / N8N)
const jobHash = client.generateJobHash(taskId);
await client.submitJob(jobHash, 1.0, { task: taskDescription });
const response = await runLangChainAgent(query);
await client.completeJob(jobHash, 'AGENT_WALLET');
Security & Verification
Proof of Productivity
Every job completion requires:
Unique job hash (prevents replay attacks)
Ed25519 signature (proves machine ownership of work)
Recent timestamp (within 5 minutes of submission)
Minimum duration (60 seconds elapsed)
Rate limiting (400 MINT/24h per machine)
Machine Credentials
Generated locally on init()
Stored in .foundry_credentials.json
Private key never leaves machine
Backup before loss of device
Anti-Fraud Measures
Job hash uniqueness enforced at database level
Signature verification on all completions
Duration verification prevents instant gaming
Per-machine daily cap prevents rate abuse
System Limits

## Client SDK

### Python
```bash
pip install foundry-client
```
```python
from foundry_client import FoundryClient

client = FoundryClient({'debug': True})
client.init({'type': 'agent', 'model': 'gpt-4'})

# Submit and complete job
job_hash = client.generate_job_hash('task_001')
client.submit_job(job_hash, 1.0, {'task': 'analysis'})

# ... do work ...

result = client.complete_job(job_hash, 'WALLET_ADDRESS')
print(f"Earned {result['reward_net']} MINT")
```

### Node.js
```bash
npm install foundry-client
```

[existing Node.js docs]


Network Details


Vision
FoundryNet is infrastructure for the autonomous economy. The protocol is horizontal, not vertical. It doesn't pick winners or favor one machine type over another. Any device capable of HTTP calls and Ed25519 signing can register and earn.
Today: Machines prove work, get verified on-chain, settled instantly.
Tomorrow: AI agents coordinate supply chains. CNC machines bid on manufacturing contracts. Autonomous vehicles stake reputation and earn routes. Manufacturing becomes programmable. Work becomes liquid.
The protocol handles identity, verification, and settlement. Everything else—quality systems, marketplaces, reputation networks, governance—gets built on top by the community.
Pure Gilderian mechanics. Value from real work + identity + time. No capital required. No staking. No gatekeeping.
Open Source
All code is open-source on GitHub:
Client SDK: foundrynet/foundry-client
Protocol: foundrynet/foundry_net_MINT
Backend: foundrynet/foundrynet-edge-functions
MIT License. Fork it. Build on it. Improve it. The more systems plug in, the more valuable the protocol becomes.
