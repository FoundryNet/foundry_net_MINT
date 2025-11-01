import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface FoundryConfig {
  apiUrl?: string;
  retryAttempts?: number;
  retryDelay?: number;
  debug?: boolean;
}

export interface MachineIdentity {
  machineUuid: string;
  publicKey: string;
  secretKey: string;
}

export interface JobResult {
  success: boolean;
  tx_signature?: string;
  reward?: number;
  activity_ratio?: number;
  dynamic_factor?: number;
  solscan?: string;
  error?: string;
  duplicate?: boolean;
  job_hash?: string;
}

export interface MachineMetadata {
  type?: string;
  class?: string;
  model?: string;
  [key: string]: any;
}

export class FoundryClient {
  private apiUrl: string;
  private machineUuid: string | null = null;
  private keyPair: nacl.SignKeyPair | null = null;
  private retryAttempts: number;
  private retryDelay: number;
  private debug: boolean;

  constructor(config: FoundryConfig = {}) {
    this.apiUrl = config.apiUrl || 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts';
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.debug = config.debug || false;
  }

  private log(level: string, message: string, data: any = {}): void {
    if (!this.debug && level === 'debug') return;
    const timestamp = new Date().toISOString();
    console[level as any](`[FoundryNet ${timestamp}] ${message}`, data);
  }

  private async withRetry<T>(fn: () => Promise<T>, context: string = ''): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        this.log('warn', `${context} failed (attempt ${attempt}/${this.retryAttempts})`, { 
          error: error.message 
        });
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt;
          this.log('debug', `Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    this.log('error', `${context} failed after ${this.retryAttempts} attempts`, { 
      error: lastError?.message 
    });
    throw lastError;
  }

  generateMachineId(): MachineIdentity {
    this.machineUuid = uuidv4();
    this.keyPair = nacl.sign.keyPair();
    const identity: MachineIdentity = {
      machineUuid: this.machineUuid,
      publicKey: bs58.encode(this.keyPair.publicKey),
      secretKey: bs58.encode(this.keyPair.secretKey),
    };
    this.log('info', 'Generated new machine identity', {
      machineUuid: identity.machineUuid,
      publicKey: identity.publicKey,
    });
    return identity;
  }

  loadMachineId(machineUuid: string, secretKeyBase58: string): void {
    try {
      this.machineUuid = machineUuid;
      const secretKeyBytes = bs58.decode(secretKeyBase58);
      const fullKeyPair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
      this.keyPair = {
        publicKey: fullKeyPair.publicKey,
        secretKey: fullKeyPair.secretKey,
      };
      this.log('info', 'Loaded machine identity', { machineUuid });
    } catch (error: any) {
      this.log('error', 'Failed to load machine identity', { error: error.message });
      throw new Error(`Invalid machine credentials: ${error.message}`);
    }
  }

  saveCredentials(identity: MachineIdentity): void {
    const credPath = path.join(process.cwd(), '.foundry_credentials.json');
    fs.writeFileSync(credPath, JSON.stringify({
      machineUuid: identity.machineUuid,
      secretKey: identity.secretKey,
    }, null, 2));
    this.log('debug', 'Credentials saved to .foundry_credentials.json');
  }

  loadCredentials(): boolean {
    try {
      const credPath = path.join(process.cwd(), '.foundry_credentials.json');
      if (fs.existsSync(credPath)) {
        const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        this.loadMachineId(creds.machineUuid, creds.secretKey);
        return true;
      }
    } catch (e) {
      this.log('debug', 'No existing credentials found');
    }
    return false;
  }

  async init(metadata: MachineMetadata = {}): Promise<{ existing: boolean; identity?: MachineIdentity; machineUuid?: string }> {
    if (this.loadCredentials()) {
      this.log('info', 'Using existing machine credentials', { machineUuid: this.machineUuid });
      return { existing: true, machineUuid: this.machineUuid || '' };
    }

    const identity = this.generateMachineId();
    this.saveCredentials(identity);
    await this.registerMachine(metadata);
    return { existing: false, identity };
  }

  async registerMachine(metadata: MachineMetadata = {}): Promise<{ success: boolean; machine_uuid?: string; error?: string }> {
    if (!this.machineUuid || !this.keyPair) {
      throw new Error('Generate or load machine ID first');
    }

    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl}/register-machine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_uuid: this.machineUuid,
          machine_pubkey_base58: bs58.encode(this.keyPair!.publicKey),
          metadata,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Registration failed: ${error}`);
      }

      const result = await response.json();
      this.log('info', 'Machine registered successfully', { machineUuid: this.machineUuid });
      return result;
    }, 'Machine registration');
  }

  async submitJob(
    jobHash: string,
    complexity: number = 1.0,
    payload: any = {}
  ): Promise<{ success: boolean; job_hash?: string; error?: string }> {
    if (!this.machineUuid) {
      throw new Error('Machine not initialized');
    }

    if (complexity < 0.5 || complexity > 2.0) {
      throw new Error('Complexity must be 0.5-2.0');
    }

    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl}/submit-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_uuid: this.machineUuid,
          job_hash: jobHash,
          complexity,
          payload,
        }),
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
      this.log('debug', 'Job submitted', { jobHash, complexity });
      return result;
    }, 'Job submission');
  }

  async completeJob(
    jobHash: string,
    recipientWallet: string
  ): Promise<JobResult> {
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
            signature_base58: bs58.encode(signature),
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Job completion failed: ${error}`);
      }

      const result = await response.json();
      this.log('info', 'Job completed - MINT earned!', {
        jobHash,
        reward: result.reward,
        txSignature: result.tx_signature,
        activityRatio: result.activity_ratio,
      });
      return result;
    }, 'Job completion');
  }

  generateJobHash(filename: string, additionalData: string = ''): string {
    const data = `${this.machineUuid}|${filename}|${Date.now()}|${additionalData}`;
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return `job_${hash.slice(0, 16)}_${Date.now()}`;
  }

  async getMetrics(): Promise<any> {
    return await this.withRetry(async () => {
      const response = await fetch(`${this.apiUrl.replace('/main-ts', '')}/metrics`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch metrics`);
      }

      return await response.json();
    }, 'Fetch metrics');
  }
}

// ============================================================================
// INTEGRATION EXAMPLES
// ============================================================================

/**
 * LangChain Agent Example
 * Integrates FoundryClient with LangChain agent execution
 */
export async function exampleLangChainAgent(client: FoundryClient, query: string): Promise<JobResult> {
  const jobHash = client.generateJobHash('langchain_agent', query);
  await client.submitJob(jobHash, 1.0, { job_type: 'langchain_agent', query });

  // Simulate agent execution (in production, call your LangChain pipeline)
  console.log(`[LangChain Agent] Processing: ${query}`);
  await new Promise(resolve => setTimeout(resolve, 1000));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * LangGraph Workflow Example
 * Tracks complex AI graph flows
 */
export async function exampleLangGraphWorkflow(client: FoundryClient, workflowInput: any): Promise<JobResult> {
  const jobHash = client.generateJobHash('langgraph_workflow', JSON.stringify(workflowInput));
  await client.submitJob(jobHash, 1.2, { job_type: 'langgraph', input: workflowInput });

  console.log(`[LangGraph] Executing workflow`);
  await new Promise(resolve => setTimeout(resolve, 1500));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * N8N Automation Example
 * Wraps N8N workflow execution
 */
export async function exampleN8NAutomation(client: FoundryClient, taskData: any): Promise<JobResult> {
  const jobHash = client.generateJobHash('n8n_task', JSON.stringify(taskData));
  await client.submitJob(jobHash, 1.0, { job_type: 'automation', task: taskData });

  console.log(`[N8N] Running automation`);
  await new Promise(resolve => setTimeout(resolve, 800));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * GPU Training Job Example
 * Rewards ML training runs
 */
export async function exampleGpuTrainingJob(client: FoundryClient, config: any): Promise<JobResult> {
  const jobHash = client.generateJobHash('gpu_training', JSON.stringify(config));
  await client.submitJob(jobHash, 1.8, { job_type: 'gpu_training', model: config.model });

  console.log(`[GPU Training] Training model: ${config.model}`);
  await new Promise(resolve => setTimeout(resolve, 2000));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * 3D Printer Integration Example
 * Hooks into print completion
 */
export async function example3DPrinterJob(client: FoundryClient, printJob: any): Promise<JobResult> {
  const jobHash = client.generateJobHash('3d_print', printJob.file);
  await client.submitJob(jobHash, 1.2, { job_type: '3d_print', file: printJob.file });

  console.log(`[3D Printer] Printing: ${printJob.file}`);
  await new Promise(resolve => setTimeout(resolve, 2500));

  const result = await client.completeJob(jobHash, printJob.wallet || 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * CNC Machine Example
 * Rewards toolpath execution
 */
export async function exampleCNCJob(client: FoundryClient, toolpath: any): Promise<JobResult> {
  const jobHash = client.generateJobHash('cnc_job', toolpath.id);
  await client.submitJob(jobHash, 1.8, { job_type: 'cnc', steps: toolpath.steps });

  console.log(`[CNC] Executing toolpath: ${toolpath.id}`);
  await new Promise(resolve => setTimeout(resolve, 1800));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * Robot Task Example
 * Tracks autonomous robot work
 */
export async function exampleRobotTask(client: FoundryClient, robotId: string, task: string): Promise<JobResult> {
  const jobHash = client.generateJobHash('robot_task', robotId);
  await client.submitJob(jobHash, 1.5, { job_type: 'robot', id: robotId, task });

  console.log(`[Robot] Executing task: ${task}`);
  await new Promise(resolve => setTimeout(resolve, 1200));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * Simple On-Chain Verification Example
 * Rewards verification work
 */
export async function exampleOnChainVerification(client: FoundryClient, txId: string): Promise<JobResult> {
  const jobHash = client.generateJobHash('onchain_verify', txId);
  await client.submitJob(jobHash, 1.0, { job_type: 'verification', tx: txId });

  console.log(`[Verification] Verifying transaction: ${txId}`);
  await new Promise(resolve => setTimeout(resolve, 500));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * Batch Data Processing Example
 * Rewards batch processing jobs
 */
export async function exampleBatchProcessor(client: FoundryClient, batchSize: number): Promise<JobResult> {
  const jobHash = client.generateJobHash('batch_process', `batch_${batchSize}`);
  const complexity = Math.min(2.0, 0.5 + (batchSize / 1000));
  await client.submitJob(jobHash, complexity, { job_type: 'batch', size: batchSize });

  console.log(`[Batch] Processing ${batchSize} items`);
  const processingTime = Math.min(5000, 100 + batchSize * 2);
  await new Promise(resolve => setTimeout(resolve, processingTime));

  const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
  return result;
}

/**
 * Multi-Agent Coordination Example
 * Tracks coordinated work across multiple agents
 */
export async function exampleMultiAgentCoordination(
  clients: FoundryClient[],
  taskName: string
): Promise<JobResult[]> {
  const results: JobResult[] = [];

  for (let i = 0; i < clients.length; i++) {
    const client = clients[i];
    const jobHash = client.generateJobHash('multi_agent', `${taskName}_agent_${i}`);
    await client.submitJob(jobHash, 1.0, { job_type: 'coordination', task: taskName, agent: i });

    console.log(`[Agent ${i}] Executing coordinated task`);
    await new Promise(resolve => setTimeout(resolve, 600));

    const result = await client.completeJob(jobHash, 'YOUR_WALLET_ADDRESS');
    results.push(result);
  }

  return results;
}

export default FoundryClient;
