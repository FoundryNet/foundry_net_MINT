// foundry-client.js - Production client with retry logic and error handling
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';

class FoundryClient {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || 'https://your-supabase-url.supabase.co/functions/v1';
    this.machineUuid = null;
    this.keyPair = null;
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000; // ms
    this.debug = config.debug || false;
  }

  // Logging helper
  log(level, message, data = {}) {
    if (!this.debug && level === 'debug') return;
    const timestamp = new Date().toISOString();
    console[level](`[FoundryNet ${timestamp}] ${message}`, data);
  }

  // Retry wrapper for network requests
  async withRetry(fn, context = '') {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.log('warn', `${context} failed (attempt ${attempt}/${this.retryAttempts})`, { error: error.message });
        
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt; // Exponential backoff
          this.log('debug', `Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    this.log('error', `${context} failed after ${this.retryAttempts} attempts`, { error: lastError.message });
    throw lastError;
  }

  // Generate new machine identity
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

  // Load existing machine identity
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

  // Save credentials to file (Node.js) or localStorage (browser)
  saveCredentials(identity) {
    if (typeof window !== 'undefined' && window.localStorage) {
      // Browser environment
      localStorage.setItem('foundry_machine_uuid', identity.machineUuid);
      localStorage.setItem('foundry_secret_key', identity.secretKey);
      this.log('debug', 'Credentials saved to localStorage');
    } else if (typeof require !== 'undefined') {
      // Node.js environment
      const fs = require('fs');
      const path = require('path');
      const credPath = path.join(process.cwd(), '.foundry_credentials.json');
      
      fs.writeFileSync(credPath, JSON.stringify({
        machineUuid: identity.machineUuid,
        secretKey: identity.secretKey
      }, null, 2));
      
      this.log('debug', 'Credentials saved to .foundry_credentials.json');
    }
  }

  // Load credentials from storage
  loadCredentials() {
    if (typeof window !== 'undefined' && window.localStorage) {
      const machineUuid = localStorage.getItem('foundry_machine_uuid');
      const secretKey = localStorage.getItem('foundry_secret_key');
      
      if (machineUuid && secretKey) {
        this.loadMachineId(machineUuid, secretKey);
        return true;
      }
    } else if (typeof require !== 'undefined') {
      const fs = require('fs');
      const path = require('path');
      const credPath = path.join(process.cwd(), '.foundry_credentials.json');
      
      if (fs.existsSync(credPath)) {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        this.loadMachineId(creds.machineUuid, creds.secretKey);
        return true;
      }
    }
    
    return false;
  }

  // Initialize machine (load or generate credentials)
  async init(metadata = {}) {
    // Try loading existing credentials
    if (this.loadCredentials()) {
      this.log('info', 'Using existing machine credentials');
      return { existing: true, machineUuid: this.machineUuid };
    }
    
    // Generate new credentials
    const identity = this.generateMachineId();
    this.saveCredentials(identity);
    
    // Register with FoundryNet
    await this.registerMachine(metadata);
    
    return { existing: false, identity };
  }

  // Register machine with FoundryNet
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

  // Submit job start
  async submitJob(jobHash, payload = {}) {
    if (!this.machineUuid) {
      throw new Error('Machine not initialized');
    }

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

  // Complete a job and earn MINT
  async completeJob(jobHash, recipientWallet) {
    if (!this.machineUuid || !this.keyPair) {
      throw new Error('Machine not initialized');
    }

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

      if (response.status === 503) {
        const error = await response.json();
        if (error.error.includes('maintenance')) {
          this.log('warn', 'System in maintenance mode, will retry', { jobHash });
          throw new Error('MAINTENANCE'); // Trigger retry
        }
      }

      if (response.status === 429) {
        const error = await response.json();
        this.log('warn', 'Rate limit reached', error);
        return { success: false, error: 'rate_limited', details: error };
      }

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

  // Check system health
  async checkHealth() {
    try {
      const response = await fetch(`${this.apiUrl}/health`);
      const health = await response.json();
      
      if (health.status !== 'healthy') {
        this.log('warn', 'System health check warning', health);
      }
      
      return health;
    } catch (error) {
      this.log('error', 'Health check failed', { error: error.message });
      return { status: 'error', error: error.message };
    }
  }

  // Generate a deterministic job hash
  generateJobHash(filename, additionalData = '') {
    const data = `${this.machineUuid}|${filename}|${Date.now()}|${additionalData}`;
    // Simple hash for browser/Node compatibility
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `job_${Math.abs(hash).toString(36)}_${Date.now()}`;
  }

  // Convenience method: submit and complete job in one call
  async processJob(jobHash, recipientWallet, payload = {}) {
    await this.submitJob(jobHash, payload);
    return await this.completeJob(jobHash, recipientWallet);
  }
}

// ============================================================================
// INTEGRATION EXAMPLES FOR DIFFERENT FIRMWARE/MACHINES
// ============================================================================

// Example 1: OctoPrint Plugin
async function octoPrintIntegration() {
  const client = new FoundryClient({
    apiUrl: 'https://your-supabase-url.supabase.co/functions/v1',
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
    apiUrl: 'https://your-supabase-url.supabase.co/functions/v1'
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
    apiUrl: 'https://your-supabase-url.supabase.co/functions/v1'
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
    apiUrl: 'https://your-supabase-url.supabase.co/functions/v1'
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
    apiUrl: 'https://your-supabase-url.supabase.co/functions/v1',
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
