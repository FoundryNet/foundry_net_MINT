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
// INTEGRATION EXAMPLES FOR DIFFERENT AGENTS, SOFTWARE, AND MACHINES
// ============================================================================
//
// These examples demonstrate how to connect various types of agents,
// workflows, and physical devices to the FoundryClient for automatic,
// on-chain MINT rewards. The patterns are consistent:
//   1. Initialize FoundryClient
//   2. Submit a job hash when work starts
//   3. Complete the job when verified finished
//
// ============================================================================
// PART 1 — SOFTWARE & AGENT INTEGRATIONS
// ============================================================================


/**
 * 1️⃣ LangChain Agent (Autonomous Task Execution)
 * Integrates Foundry rewards into a LangChain pipeline.
 * Each run of the agent earns MINT based on completion complexity.
 */
async function exampleLangChainAgent(query) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io', debug: true });
  await client.init({ type: 'agent', model: 'gpt-4-langchain' });

  const jobHash = client.generateJobHash('langchain_query', query);
  await client.submitJob(jobHash, { job_type: 'langchain_agent_query', query });

  // Perform the AI reasoning task
  const response = await runLangChainAgent(query);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { proof: response });
  return response;
}


/**
 * 2️⃣ LangGraph Workflow (Composable AI Chain)
 * Tracks complex AI graph flows; each node triggers a separate job if needed.
 */
async function exampleLangGraphWorkflow(workflowInput) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io', debug: false });
  await client.init({ type: 'workflow', model: 'langgraph' });

  const jobHash = client.generateJobHash('langgraph_workflow', workflowInput);
  await client.submitJob(jobHash, { job_type: 'langgraph', input: workflowInput });

  const output = await runLangGraph(workflowInput);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { proof: output });
  return output;
}


/**
 * 3️⃣ N8N Automation Flow
 * Wraps any node in N8N to automatically record job starts/completions.
 */
async function exampleN8NAutomation(taskData) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'automation', model: 'n8n_flow' });

  const jobHash = client.generateJobHash('n8n_task', taskData);
  await client.submitJob(jobHash, { job_type: 'automation', metadata: taskData });

  // Execute N8N task
  const result = await executeN8NWorkflow(taskData);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { proof: result });
  return result;
}


/**
 * 4️⃣ On-Chain Payment Verification Bot
 * Runs continuously, verifying on-chain payments or wallet activity.
 */
async function exampleOnchainVerification(txId) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'verifier', model: 'solana-scanner' });

  const jobHash = client.generateJobHash('onchain_verification', txId);
  await client.submitJob(jobHash, { job_type: 'onchain_verification', txId });

  const verified = await checkTransactionOnChain(txId);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { verified });
  return verified;
}


/**
 * 5️⃣ GPU Training Job Tracker
 * Rewards model training runs or compute-intensive ML jobs.
 */
async function exampleGpuTrainingJob(config) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'training', model: config.model });

  const jobHash = client.generateJobHash('gpu_training', config);
  await client.submitJob(jobHash, { job_type: 'gpu_training', params: config });

  const metrics = await runModelTraining(config);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { metrics });
  return metrics;
}


/**
 * 6️⃣ Batch Data Processor
 * Ideal for indexing, ETL pipelines, and large async job batches.
 */
async function exampleBatchProcessor(batchData) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'batch_processor', model: 'data-indexer' });

  const jobHash = client.generateJobHash('batch_process', batchData);
  await client.submitJob(jobHash, { job_type: 'data_batch', size: batchData.length });

  const processed = await runDataPipeline(batchData);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { processed });
  return processed;
}



// ============================================================================
// PART 2 — FIRMWARE & MACHINE INTEGRATIONS
// ============================================================================


/**
 * 7️⃣ OctoPrint 3D Printer Integration
 * Hooks into print events (start/done) to reward machine work.
 */
async function exampleOctoPrintIntegration(printJob) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'machine', model: 'octoprint' });

  const jobHash = client.generateJobHash('3d_print', printJob.file);
  await client.submitJob(jobHash, { job_type: '3d_print', details: printJob });

  // Simulate or hook into OctoPrint’s event loop
  await waitForPrintCompletion(printJob);

  await client.completeJob(jobHash, printJob.wallet, { status: 'success' });
}


/**
 * 8️⃣ Klipper + Moonraker Integration
 * Integrates directly with Moonraker WebSocket to trigger jobs on print completion.
 */
async function exampleKlipperIntegration(event) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'machine', model: 'klipper' });

  const jobHash = client.generateJobHash('klipper_job', event.file);
  await client.submitJob(jobHash, { job_type: 'klipper_print', event });

  await waitForKlipperDone(event);

  await client.completeJob(jobHash, event.wallet, { confirmed: true });
}


/**
 * 9️⃣ GRBL / CNC Controller
 * Rewards each toolpath completion or machine cycle.
 */
async function exampleGrblIntegration(toolpath) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'machine', model: 'grbl' });

  const jobHash = client.generateJobHash('cnc_toolpath', toolpath.id);
  await client.submitJob(jobHash, { job_type: 'cnc', steps: toolpath.steps });

  await executeCncJob(toolpath);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { done: true });
}


/**
 * 🔟 Custom DIY Machine
 * For any Arduino, ESP32, or embedded system that can send HTTP.
 */
async function exampleCustomMachine(task) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'machine', model: 'custom-diy' });

  const jobHash = client.generateJobHash('custom_task', task.id);
  await client.submitJob(jobHash, { job_type: 'custom', task });

  await runPhysicalAction(task);

  await client.completeJob(jobHash, task.wallet, { verified: true });
}


/**
 * 11️⃣ Simple Hardware Script
 * Minimal template for Raspberry Pi, IoT, or PLC device.
 */
async function exampleSimpleHardwareScript(signal) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'machine', model: 'simple' });

  const jobHash = client.generateJobHash('signal_job', signal.id);
  await client.submitJob(jobHash, { job_type: 'signal', data: signal });

  await waitForSensorConfirmation(signal);

  await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS', { confirmed: true });
}


/**
 * 12️⃣ AI Manufacturing Agent
 * Coordinates multiple machines; submits and finalizes jobs for each.
 */
async function exampleManufacturingAgent(batch) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'agent', model: 'factory-orchestrator' });

  const jobHash = client.generateJobHash('factory_batch', batch.id);
  await client.submitJob(jobHash, { job_type: 'factory_batch', machines: batch.machines });

  for (const machine of batch.machines) {
    await signalMachineStart(machine);
    await signalMachineComplete(machine);
  }

  await client.completeJob(jobHash, batch.wallet, { machines: batch.machines.length });
}


/**
 * 13️⃣ Fleet Robotics Network
 * Tracks distributed machine fleets via shared FoundryClient identity.
 */
async function exampleFleetRoboticsNetwork(fleet) {
  const client = new FoundryClient({ apiUrl: 'https://api.foundrynet.io' });
  await client.init({ type: 'fleet', model: 'robotics-network' });

  for (const bot of fleet) {
    const jobHash = client.generateJobHash('robot_task', bot.id);
    await client.submitJob(jobHash, { job_type: 'robot', id: bot.id });

    await runRobotTask(bot);

    await client.completeJob(jobHash, bot.wallet, { task: 'done' });
  }
}



// ============================================================================
// HELPER STUBS (mock implementations for illustration)
// ============================================================================

async function runLangChainAgent(q) { return `response for ${q}`; }
async function runLangGraph(i) { return `output for ${i}`; }
async function executeN8NWorkflow(d) { return { success: true, ...d }; }
async function checkTransactionOnChain(tx) { return { tx, verified: true }; }
async function runModelTraining(c) { return { epochs: 3, accuracy: 0.92 }; }
async function runDataPipeline(d) { return d.map(x => ({ processed: x })); }
async function waitForPrintCompletion(p) { return new Promise(r => setTimeout(r, 1000)); }
async function waitForKlipperDone(e) { return new Promise(r => setTimeout(r, 1000)); }
async function executeCncJob(t) { return new Promise(r => setTimeout(r, 500)); }
async function runPhysicalAction(t) { return new Promise(r => setTimeout(r, 500)); }
async function waitForSensorConfirmation(s) { return new Promise(r => setTimeout(r, 500)); }
async function signalMachineStart(m) { return new Promise(r => setTimeout(r, 300)); }
async function signalMachineComplete(m) { return new Promise(r => setTimeout(r, 300)); }
async function runRobotTask(b) { return new Promise(r => setTimeout(r, 400)); }



// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  // Software & Agents
  exampleLangChainAgent,
  exampleLangGraphWorkflow,
  exampleN8NAutomation,
  exampleOnchainVerification,
  exampleGpuTrainingJob,
  exampleBatchProcessor,

  // Firmware & Machines
  exampleOctoPrintIntegration,
  exampleKlipperIntegration,
  exampleGrblIntegration,
  exampleCustomMachine,
  exampleSimpleHardwareScript,
  exampleManufacturingAgent,
  exampleFleetRoboticsNetwork,
};
