FoundryNet MINT Protocol
Economic settlement layer for autonomous systems.
Autonomous agents, robots, 3D printers, CNC machines, and any entity doing verifiable work earn MINT tokens instantly. No staking. No capital required. Just work and get paid.

What Is FoundryNet?
FoundryNet is infrastructure for autonomous coordination. Instead of centralized payment processors or complex governance, work gets:

Verified on-chain (Solana)
Rewarded by formula (activity-responsive)
Settled instantly (SPL token transfer)

The formula self-corrects. More work = lower rewards (cooling). Less work = higher rewards (heating). No governance needed.

Quick Start
Installation
bashnpm install tweetnacl bs58 uuid
Download foundry-client.js from the repository.
Basic Usage
javascriptimport { FoundryClient } from './foundry-client.js';

// Initialize (saves credentials locally)
const client = new FoundryClient();
await client.init({ type: 'agent', model: 'langchain' });

// Start work
const jobHash = client.generateJobHash('my_task');
await client.submitJob(jobHash, 1.0, { task: 'data_processing' });

// Simulate work (replace with real work)
await new Promise(r => setTimeout(r, 5000));

// Complete and earn MINT
const result = await client.completeJob(jobHash, 'YOUR_SOLANA_WALLET');

console.log(`Earned: ${result.reward} MINT`);
console.log(`View: ${result.solscan}`);
That's it. You're earning.

Supported Entity Types

AI Agents (LangChain, N8N, Make.com automations)
3D Printers (OctoPrint, Klipper, Marlin)
CNC Machines (GRBL, LinuxCNC)
Robots & RaaS (Any autonomous entity)
Manufacturing Equipment (Laser cutters, pick-and-place)
Custom DIY (Anything that can HTTP + sign messages)


How It Works
1. Register Machine
First time only. Generates Ed25519 keypair, saves to .foundry_credentials.json.
javascriptawait client.init({ type: 'printer', model: 'Ender 3' });
2. Submit Job
When work starts, register it:
javascriptconst jobHash = client.generateJobHash('part_file.gcode');
await client.submitJob(jobHash, 1.0, { file: 'part_file.gcode' });
Complexity parameter (0.5-2.0):

1.0 = baseline (default)
1.5 = more complex task
0.8 = simpler task

3. Complete Job
When work finishes, sign proof and earn:
javascriptconst result = await client.completeJob(jobHash, 'YOUR_SOLANA_WALLET');
Returns:

reward: MINT earned
tx_signature: On-chain proof
solscan: Link to transaction
activity_ratio: Current network activity (0.5-2.0x)


The Formula
reward = (duration_seconds × 0.005) × complexity × activity_ratio^(-0.4)
Example:

600 seconds work (10 min)
Complexity 1.0
Activity ratio 1.0 (equilibrium)
Reward: (600 × 0.005) × 1.0 × 1.0 = 3.0 MINT

Base rate: 0.005 MINT per second of work
What is activity_ratio?

Measures concurrent work across network
0.5 (quiet) = 1.74x reward multiplier (attract work)
1.0 (equilibrium) = 1.0x multiplier (baseline)
2.0 (busy) = 0.76x multiplier (cool off)

System self-corrects without governance.

Limits & Rules
RuleValueMinimum job duration60 secondsMaximum job duration7 daysComplexity range0.5 - 2.0Reward per job (min)0.5 MINTReward per job (max)10 MINTDaily limit per machine400 MINT / 24hActivity ratio range0.5 - 2.0

Integration Examples
LangChain Agent
javascriptimport { FoundryClient } from './foundry-client.js';

const client = new FoundryClient();
await client.init({ type: 'agent', model: 'langchain' });

// Before running agent
const jobHash = client.generateJobHash('query_processing');
await client.submitJob(jobHash, 1.0, { agent: 'langchain' });

// Run your agent logic here
const response = await runLangChainAgent(query);

// After completion
await client.completeJob(jobHash, 'YOUR_WALLET');
N8N Workflow
javascript// In N8N webhook or trigger
const client = new FoundryClient();
await client.init({ type: 'workflow', model: 'n8n' });

const jobHash = client.generateJobHash(execution.executionId);
await client.submitJob(jobHash, 1.2, { workflow: execution.workflowId });

// After workflow completes
await client.completeJob(jobHash, 'YOUR_WALLET');
3D Printer (OctoPrint)
javascript// Hook into OctoPrint event system
import { FoundryClient } from './foundry-client.js';

const client = new FoundryClient();
await client.init({ type: 'printer', model: 'Ender 3' });

// On print start
function onPrintStart(filename) {
  const jobHash = client.generateJobHash(filename);
  client.submitJob(jobHash, 1.2, { file: filename });
}

// On print complete
async function onPrintComplete(filename) {
  const jobHash = client.generateJobHash(filename);
  await client.completeJob(jobHash, 'YOUR_WALLET');
}
CNC / GRBL
javascriptconst client = new FoundryClient();
await client.init({ type: 'cnc', model: 'Shapeoko 3' });

// On program start
const jobHash = client.generateJobHash('program.gcode');
await client.submitJob(jobHash, 1.8, { program: 'program.gcode' });

// Listen for M2/M30 (program end)
setTimeout(async () => {
  await client.completeJob(jobHash, 'YOUR_WALLET');
}, estimatedTime * 1000);

API Reference
FoundryClient(config)
javascriptconst client = new FoundryClient({
  apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts',
  retryAttempts: 3,
  retryDelay: 2000,
  debug: false
});
client.init(metadata)
Initialize machine. First time generates keypair, saves to .foundry_credentials.json.
javascriptawait client.init({
  type: 'agent',        // printer|cnc|robot|agent|custom
  model: 'langchain',   // Your model/firmware
  firmware: 'klipper'   // Optional
});
Returns:
javascript{
  existing: false,
  identity: {
    machineUuid: "uuid-here",
    publicKey: "base58-pubkey",
    secretKey: "base58-secret"
  }
}
client.submitJob(jobHash, complexity, payload)
Register job start.
javascriptawait client.submitJob(jobHash, 1.2, {
  job_type: 'print',
  filename: 'part.gcode',
  estimated_time: 3600
});
Returns:
javascript{ success: true, job_hash: "job_..." }
client.completeJob(jobHash, recipientWallet)
Complete job and earn MINT.
javascriptconst result = await client.completeJob(
  jobHash,
  'YOUR_SOLANA_WALLET_ADDRESS'
);
Returns:
javascript{
  success: true,
  reward: 3.0,
  activity_ratio: 1.05,
  dynamic_factor: 0.95,
  tx_signature: "5x7y...",
  solscan: "https://solscan.io/tx/..."
}
client.generateJobHash(filename, additionalData)
Create deterministic job identifier.
javascriptconst jobHash = client.generateJobHash('part.gcode', 'run_001');

Security
Proof of Productivity (PoP)
Every job completion requires:

Unique job hash (prevents replay)
Ed25519 signature (proves machine ownership)
Recent timestamp (within 5 minutes)
Minimum duration (60 seconds)
Rate limiting (400 MINT/24h per machine)

Your Machine Keys

Generated locally on init()
Stored in .foundry_credentials.json
Back them up securely
Never share

Anti-Fraud

Job hash uniqueness enforced
Signature verification prevents impersonation
Duration checks prevent instant gaming
Rate limits prevent spam


Troubleshooting
"Job completion failed"

Verify machine registered: client.init()
Confirm job was submitted before completing
Check Solana wallet address is valid
Ensure minimum 60 seconds elapsed

"Rate limit exceeded"

You've earned 400 MINT in last 24 hours
Wait for rolling window to reset
Check dashboard for current status

"Signature verification failed"

Delete .foundry_credentials.json
Run client.init() again to regenerate keys
Verify system time is accurate

"Treasury depleted"

System maintenance in progress
Jobs queued and will process when treasury refills
Check status updates


Getting a Wallet
New to crypto? Get MINT in 3 steps:

Install Phantom Wallet (browser extension)
Create new Solana wallet
Copy your wallet address
Use it in completeJob()

MINT appears instantly after job completion.

Network Details
PropertyValueBlockchainSolana MainnetTokenMINT (SPL)Token Address5Pd4YBgFdih88vAFGAEEsk2JpixrZDJpRynTWvqPy5daProgram ID28kKj6NttSczL1gC3wAP5wzXJRcasfvpaL5hdjuWHALNDEX PairMINT/USDC on RaydiumExplorerSolscan

Dashboard
Monitor your earnings and network activity:
FoundryNet Live Monitor
Shows:

Treasury balance
Active machines
Total MINT distributed
Activity ratio (real-time)
Recent jobs with earnings
Network health metrics


Vision
FoundryNet is building payment infrastructure for autonomous industry.
Today: Machines prove work, get paid instantly.
Tomorrow: AI agents coordinate supply chains. Manufacturing becomes programmable.
The protocol handles identity, verification, settlement.
Everything else—quality systems, marketplaces, reputation—gets built on top by the community.
This is infrastructure for when autonomous systems are the economy.

Open Source
All code is open-source on GitHub:

Client: foundrynet/foundry-client
Protocol: foundrynet/foundry_net_MINT

Fork it. Build on it. Improve it.
