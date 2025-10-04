// foundry-client.js - Production client
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

class FoundryClient {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts';
    this.machineUuid = null;
    this.keyPair = null;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.debug = config.debug || false;
  }

  log(level, message, data = {}) {
    if (!this.debug && level === 'debug') return;
    const timestamp = new Date().toISOString();
    console[level](`[FoundryNet ${timestamp}] ${message}`, data);
  }

  async withRetry(fn, context = '') {
    let lastError;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.log('warn', `${context} failed (attempt ${attempt}/${this.retryAttempts})`, { error: error.message });
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt;
          this.log('debug', `Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    this.log('error', `${context} failed after ${this.retryAttempts} attempts`, { error: lastError.message });
    throw lastError;
  }

  generateMachineId() {
    this.machineUuid = uuidv4();
    this.keyPair = nacl.sign.keyPair();
    const identity = {
      machineUuid: this.machineUuid,
      publicKey: bs58.encode(this.keyPair.publicKey),
      secretKey: bs58.encode(this.keyPair.secretKey)
    };
    this.log('info', 'Generated new machine identity', { 
      machineUuid: identity.machineUuid,
      publicKey: identity.publicKey 
    });
    return identity;
  }

  loadMachineId(machineUuid, secretKeyBase58) {
    try {
      this.machineUuid = machineUuid;
      const secretKeyBytes = bs58.decode(secretKeyBase58);
      const fullKeyPair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
      this.keyPair = {
        publicKey: fullKeyPair.publicKey,
        secretKey: fullKeyPair.secretKey
      };
      this.log('info', 'Loaded machine identity', { machineUuid });
      return true;
    } catch (error) {
      this.log('error', 'Failed to load machine identity', { error: error.message });
      throw new Error(`Invalid machine credentials: ${error.message}`);
    }
  }

  saveCredentials(identity) {
    const credPath = path.join(process.cwd(), '.foundry_credentials.json');
    fs.writeFileSync(credPath, JSON.stringify({
      machineUuid: identity.machineUuid,
      secretKey: identity.secretKey
    }, null, 2));
    this.log('debug', 'Credentials saved');
  }

  loadCredentials() {
    try {
      const credPath = path.join(process.cwd(), '.foundry_credentials.json');
      if (fs.existsSync(credPath)) {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        this.loadMachineId(creds.machineUuid, creds.secretKey);
        return true;
      }
    } catch {}
    return false;
  }

  async init(metadata = {}) {
    if (this.loadCredentials()) {
      this.log('info', 'Using existing machine credentials');
      return { existing: true, machineUuid: this.machineUuid };
    }
    const identity = this.generateMachineId();
    this.saveCredentials(identity);
    await this.registerMachine(metadata);
    return { existing: false, identity };
  }

  async registerMachine(metadata = {}) {
    if (!this.machineUuid || !this.keyPair) {
      throw new Error('Generate or load machine ID first');
    }
    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl}/register-machine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_uuid: this.machineUuid,
          machine_pubkey_base58: bs58.encode(this.keyPair.publicKey),
          metadata
        })
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Registration failed: ${error}`);
      }
      const result = await response.json();
      this.log('info', 'Machine registered successfully');
      return result;
    }, 'Machine registration');
  }

  async submitJob(jobHash, payload = {}) {
    if (!this.machineUuid) throw new Error('Machine not initialized');
    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl}/submit-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_uuid: this.machineUuid,
          job_hash: jobHash,
          payload
        })
      });
      if (response.status === 409) {
        this.log('warn', 'Job already exists', { jobHash });
        return { success: true, duplicate: true, job_hash: jobHash };
      }
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Job submission failed: ${error}`);
      }
      const result = await response.json();
      this.log('debug', 'Job submitted', { jobHash });
      return result;
    }, 'Job submission');
  }

  async completeJob(jobHash, recipientWallet) {
    if (!this.machineUuid || !this.keyPair) throw new Error('Machine not initialized');
    const timestamp = new Date().toISOString();
    const message = `${jobHash}|${recipientWallet}|${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.keyPair.secretKey);
    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl}/complete-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_uuid: this.machineUuid,
          job_hash: jobHash,
          recipient_wallet: recipientWallet,
          completion_proof: {
            timestamp,
            signature_base58: bs58.encode(signature)
          }
        })
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Job completion failed: ${error}`);
      }
      const result = await response.json();
      this.log('info', 'Job completed - MINT earned!', { 
        jobHash, 
        reward: result.reward,
        txSignature: result.tx_signature 
      });
      return result;
    }, 'Job completion');
  }

  generateJobHash(filename, additionalData = '') {
    const data = `${this.machineUuid}|${filename}|${Date.now()}|${additionalData}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `job_${Math.abs(hash).toString(36)}_${Date.now()}`;
  }
}

export { FoundryClient };

// ============================================================================
// INTEGRATION EXAMPLES FOR DIFFERENT FIRMWARE/MACHINES
// ============================================================================

// Example 1: OctoPrint Plugin
async function octoPrintIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts',
    debug: true
  });

  await client.init({
    type: '3d-printer',
    model: 'Ender 3 V2',
    firmware: 'OctoPrint 1.8.0'
  });

  // Hook into OctoPrint events
  // octoprint.plugins.foundrynet.on_print_started
  const jobHash = client.generateJobHash('benchy.gcode');
  await client.submitJob(jobHash, {
    job_type: 'print',
    filename: 'benchy.gcode',
    estimated_time: 3600
  });

  // octoprint.plugins.foundrynet.on_print_done
  const result = await client.completeJob(jobHash, 'YOUR_WALLET');
  console.log('Earned MINT:', result.reward);
}

// Example 2: Klipper Moonraker Integration
async function klipperIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts'
  });

  await client.init({
    type: '3d-printer',
    model: 'Voron 2.4',
    firmware: 'Klipper + Moonraker'
  });

  // Listen to Moonraker webhooks
  // on print_started webhook
  const jobHash = client.generateJobHash(printFilename);
  await client.submitJob(jobHash, {
    job_type: 'print',
    filename: printFilename,
    layer_count: metadata.layer_count
  });

  // on print_complete webhook (success only)
  await client.completeJob(jobHash, userWallet);
}

// Example 3: GRBL/CNC Integration
async function grblIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts'
  });

  await client.init({
    type: 'cnc-mill',
    model: 'Shapeoko 3',
    firmware: 'GRBL 1.1'
  });

  // When G-code starts (after homing)
  const jobHash = client.generateJobHash('part_001.nc');
  await client.submitJob(jobHash, {
    job_type: 'cnc',
    program: 'part_001.nc',
    operation: 'roughing'
  });

  // When M2/M30 program end received
  await client.completeJob(jobHash, userWallet);
}

// Example 4: Custom DIY Machine
async function customMachineIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts'
  });

  await client.init({
    type: 'custom',
    model: 'Pick-and-Place Robot',
    firmware: 'Arduino + Custom'
  });

  // Your custom job logic
  function onTaskStart(taskId) {
    const jobHash = client.generateJobHash(taskId);
    client.submitJob(jobHash, {
      job_type: 'robot',
      task_id: taskId,
      operation: 'component_placement'
    });
    return jobHash;
  }

  function onTaskComplete(jobHash) {
    client.completeJob(jobHash, userWallet);
  }
}

// Example 5: Simple Script (Any Machine)
async function simpleScriptExample() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts',
    debug: true
  });

  // First run: generates and saves credentials
  await client.init({ type: 'test-machine' });

  // Start job
  const jobHash = `job_${Date.now()}`;
  await client.submitJob(jobHash, { job_type: 'test' });
  
  console.log('Job started, doing work...');
  
  // Simulate work
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Complete job
  const result = await client.completeJob(
    jobHash, 
    'YOUR_SOLANA_WALLET_ADDRESS'
  );
  
  console.log('✅ Job completed!');
  console.log(`Earned ${result.reward} MINT`);
  console.log(`TX: ${result.solscan}`);
}

// For Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FoundryClient };
}

// For ES6 modules
export { FoundryClient };

// Example 6: AI Agent Integration
async function aiAgentIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts'
  });

  await client.init({
    type: 'ai-agent',
    model: 'Autonomous Manufacturing Agent',
    firmware: 'Agent Runtime v1.0'
  });

  // Agent receives manufacturing request
  async function handleManufacturingRequest(spec) {
    // Agent finds available machine capacity
    const machineId = await findAvailableMachine(spec);
    
    // Generate job hash from specification
    const jobHash = client.generateJobHash(spec.partName);
    
    // Submit job to manufacturing network
    await client.submitJob(jobHash, {
      job_type: 'agent-coordinated',
      specification: spec,
      priority: spec.urgency,
      estimated_cost: spec.budget
    });
    
    // Agent monitors job progress...
    // When physical machine completes work:
    const result = await client.completeJob(jobHash, agentWallet);
    
    // Agent receives MINT payment for coordinating manufacturing
    return {
      completed: true,
      cost: result.reward,
      txHash: result.tx_signature
    };
  }

  // Agent can batch multiple manufacturing jobs
  async function batchManufacturing(orders) {
    const jobs = await Promise.all(
      orders.map(order => handleManufacturingRequest(order))
    );
    
    const totalCost = jobs.reduce((sum, job) => sum + job.cost, 0);
    console.log(`Batch completed: ${jobs.length} parts manufactured for ${totalCost} MINT`);
    
    return jobs;
  }
}
