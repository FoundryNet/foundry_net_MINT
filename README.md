FoundryNet
Earn MINT tokens for verified manufacturing work.
FoundryNet rewards 3D printers, CNC machines, robots, and production equipment with cryptocurrency for completing jobs. No staking, no capital required—just connect your machine and start earning.

Quick Start
Installation
bashnpm install tweetnacl bs58 uuid
Download foundry-client.js from the GitHub repository.
Basic Usage
javascriptimport { FoundryClient } from './foundry-client.js';

// Initialize client
const client = new FoundryClient({ 
  apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts',
  debug: true 
});

// Register machine (first time only - saves credentials locally)
await client.init({ 
  type: '3d-printer', 
  model: 'Ender 3' 
});

// Start a job
const jobHash = client.generateJobHash('benchy.gcode');
await client.submitJob(jobHash, { 
  job_type: 'print',
  filename: 'benchy.gcode' 
});

// Complete job and earn MINT
const result = await client.completeJob(
  jobHash, 
  'YOUR_SOLANA_WALLET_ADDRESS'
);

console.log(`Earned ${result.reward} MINT!`);
console.log(`View transaction: ${result.solscan}`);
That's it. Your machine is now earning.

How It Works
1. Register Your Machine
Connect any machine that can make HTTP requests and sign messages (ed25519).
Supported:

3D Printers (OctoPrint, Klipper, Marlin)
CNC Mills/Routers (GRBL, LinuxCNC)
Laser Cutters
Pick-and-Place Robots
Custom DIY machines

2. Submit Jobs
When your machine starts productive work:
javascriptconst jobHash = client.generateJobHash('my_part.gcode');
await client.submitJob(jobHash, {
  job_type: 'print',
  filename: 'benchy.gcode'
});
3. Earn MINT
When work completes successfully:
javascriptawait client.completeJob(jobHash, yourSolanaWallet);
// Instant payout: 3 MINT per job
Current Rewards:

3 MINT per completed job
Maximum 400 MINT per machine per 24 hours
Jobs must run minimum 60 seconds


Integration Examples
OctoPrint Plugin
pythonfrom foundrynet import FoundryClient

# In plugin initialization
client = FoundryClient(api_url='https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts')
client.init(metadata={'type': 'printer', 'model': 'Prusa MK3'})

# On print start
def on_print_started(filename):
    job_hash = client.generate_job_hash(filename)
    client.submit_job(job_hash, {'filename': filename})
    
# On print complete
def on_print_done(job_hash):
    client.complete_job(job_hash, user_wallet)
Klipper/Moonraker
python# Listen to Moonraker webhooks
def on_print_started(data):
    job_hash = client.generate_job_hash(data['filename'])
    client.submit_job(job_hash, {'filename': data['filename']})

def on_print_complete(data):
    client.complete_job(current_job_hash, user_wallet)
GRBL/CNC
javascript// On program start
const jobHash = client.generateJobHash(programName);
await client.submitJob(jobHash, { 
  job_type: 'cnc', 
  program: programName 
});

// On program complete (M2/M30)
await client.completeJob(jobHash, wallet);
Custom/DIY
javascript// Your machine, your rules
const client = new FoundryClient({
  apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts'
});

await client.init({ 
  type: 'custom', 
  model: 'Pick and Place Robot' 
});

// When task starts
const jobHash = client.generateJobHash(taskId);
await client.submitJob(jobHash, {
  job_type: 'robot',
  task_id: taskId
});

// When task completes
await client.completeJob(jobHash, wallet);

API Reference
FoundryClient(config)
javascriptconst client = new FoundryClient({
  apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts',
  retryAttempts: 3,      // Network retry count
  retryDelay: 2000,      // ms between retries
  debug: false           // Enable verbose logging
});
client.init(metadata)
Initialize machine. Loads existing credentials or generates new ones.
javascriptawait client.init({
  type: 'printer',       // printer|cnc|robot|laser|custom
  model: 'Ender 3 V2',
  firmware: 'Klipper'
});
// Saves credentials to .foundry_credentials.json
Returns:
javascript{
  existing: true,           // Whether credentials already existed
  machineUuid: "abc-123",   // Your machine ID
  identity: {...}           // New credentials (if first time)
}
client.submitJob(jobHash, payload)
Register job start.
javascriptawait client.submitJob('job_unique_hash', {
  job_type: 'print',
  filename: 'part.gcode',
  estimated_time: 3600
});
Returns:
javascript{
  success: true,
  job_hash: "job_unique_hash"
}
client.completeJob(jobHash, recipientWallet)
Complete job and earn MINT.
javascriptconst result = await client.completeJob(
  'job_unique_hash',
  'YOUR_SOLANA_WALLET_ADDRESS'
);
Returns:
javascript{
  success: true,
  reward: 3,
  tx_signature: "5x7y...",
  solscan: "https://solscan.io/tx/..."
}
client.generateJobHash(filename, additionalData)
Generate deterministic job hash.
javascriptconst jobHash = client.generateJobHash('benchy.gcode');
// Returns: "job_abc123_1234567890"

Rules & Limits

3 MINT per completed job
400 MINT maximum per machine per 24 hours
Jobs must run minimum 60 seconds
Each job hash must be unique (no replays)
Signature timestamp must be within 5 minutes

What Counts as a Job?
Any discrete unit of productive work:

One 3D print from start to finish
One CNC machining operation
One robot task cycle
One laser cut/engrave job

What Doesn't Count?

Machine idle time
Calibration/homing
Test runs
Failed or cancelled jobs


Security
Proof of Productivity (PoP)
Every job completion requires:

Unique job hash (prevents replay attacks)
Ed25519 signature from registered machine keypair
Recent timestamp (within 5 minutes)
Minimum duration (60 seconds)
Rate limiting (400 MINT/24hrs per machine)

Your Machine Keys

Generated locally on first init()
Stored in .foundry_credentials.json
Never leave your machine
Back them up securely

Anti-Fraud

Job hash uniqueness enforced
Signature verification prevents impersonation
Rate limits prevent spam
Duration checks prevent instant gaming


Troubleshooting
"Job completion failed"

Check your machine credentials are loaded (client.init())
Verify job was submitted before completing
Ensure wallet address is valid Solana address

"Rate limit exceeded"

You've earned 400 MINT in the last 24 hours
Wait for the rolling window to reset
Check dashboard for current limits

"Signature verification failed"

Machine credentials may be corrupted
Delete .foundry_credentials.json and re-run init()
Ensure system time is accurate (for timestamps)

"Job duration too short"

Jobs must run minimum 60 seconds
Ensure you're measuring actual work time
Don't complete jobs immediately after starting

"Treasury depleted"

System maintenance in progress
Jobs are queued and will process when treasury refills
Check status updates


Getting a Wallet?
New to crypto? 
Here's how to receive MINT:

Install Phantom Wallet (browser extension)
Create new wallet
Copy your Solana address
Use that address in completeJob()

MINT tokens appear instantly in your wallet after job completion.

Vision
FoundryNet is building payment infrastructure for autonomous industry.
We're starting simple: machines prove work happened, get paid instantly. The protocol handles identity, verification, and settlement. Everything else such as quality systems, marketplaces, reputation—gets built on top.
This is infrastructure for when AI agents coordinate supply chains and manufacturing capacity becomes programmable.

Tokenomics
Token: MINT (Solana SPL token)
Contract: 84hLMyG9cnC3Pd9LrWn4NtKMEhQHh4AvxbkcDMQtgem


Initial treasury funded by protocol creator
Rewards distributed for completed jobs
LP available on Raydium (MINT/SOL)
