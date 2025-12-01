# foundry_client.py
https://pypi.org/project/foundry-client/1.0.0/

import nacl.signing
import nacl.encoding
import base58
import requests
import json
import hashlib
import time
import os
from uuid import uuid4
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

class FoundryClient:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}
        self.api_url = config.get('api_url', 'https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts')
        self.retry_attempts = config.get('retry_attempts', 3)
        self.retry_delay = config.get('retry_delay', 2.0)
        self.debug = config.get('debug', False)
        self.credentials_file = config.get('credentials_file', '.foundry_credentials.json')
        
        self.machine_uuid: Optional[str] = None
        self.signing_key: Optional[nacl.signing.SigningKey] = None
        self.verify_key: Optional[nacl.signing.VerifyKey] = None
    
    def log(self, level: str, message: str, data: Optional[Dict] = None):
        if not self.debug and level == 'debug':
            return
        timestamp = datetime.utcnow().isoformat()
        print(f"[FoundryNet {timestamp}] [{level.upper()}] {message}", data or {})
    
    def _retry(self, fn, context: str = ''):
        """Retry wrapper with exponential backoff"""
        last_error = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                return fn()
            except Exception as error:
                last_error = error
                self.log('warn', f"{context} failed (attempt {attempt}/{self.retry_attempts})", 
                        {'error': str(error)})
                if attempt < self.retry_attempts:
                    delay = self.retry_delay * attempt
                    self.log('debug', f"Retrying in {delay}s...")
                    time.sleep(delay)
        
        self.log('error', f"{context} failed after {self.retry_attempts} attempts", 
                {'error': str(last_error)})
        raise last_error
    
    def generate_machine_id(self) -> Dict[str, str]:
        """Generate new machine identity with Ed25519 keypair"""
        self.machine_uuid = str(uuid4())
        self.signing_key = nacl.signing.SigningKey.generate()
        self.verify_key = self.signing_key.verify_key
        
        identity = {
            'machine_uuid': self.machine_uuid,
            'public_key': base58.b58encode(bytes(self.verify_key)).decode('utf-8'),
            'secret_key': base58.b58encode(bytes(self.signing_key)).decode('utf-8'),
        }
        
        self.log('info', 'Generated new machine identity', {
            'machine_uuid': identity['machine_uuid'],
            'public_key': identity['public_key'],
        })
        return identity
    
    def load_machine_id(self, machine_uuid: str, secret_key_base58: str):
        """Load existing machine identity from credentials"""
        try:
            self.machine_uuid = machine_uuid
            secret_key_bytes = base58.b58decode(secret_key_base58)
            self.signing_key = nacl.signing.SigningKey(secret_key_bytes)
            self.verify_key = self.signing_key.verify_key
            self.log('info', 'Loaded machine identity', {'machine_uuid': machine_uuid})
        except Exception as error:
            self.log('error', 'Failed to load machine identity', {'error': str(error)})
            raise ValueError(f"Invalid machine credentials: {error}")
    
    def save_credentials(self, identity: Dict[str, str]):
        """Save credentials to local file"""
        cred_path = Path.cwd() / self.credentials_file
        credentials = {
            'machine_uuid': identity['machine_uuid'],
            'secret_key': identity['secret_key'],
            'public_key': identity['public_key'],
            'created_at': datetime.utcnow().isoformat(),
        }
        with open(cred_path, 'w') as f:
            json.dump(credentials, f, indent=2)
        self.log('debug', 'Credentials saved', {'file': str(cred_path)})
    
    def load_credentials(self) -> bool:
        """Load credentials from local file if exists"""
        try:
            cred_path = Path.cwd() / self.credentials_file
            if cred_path.exists():
                with open(cred_path, 'r') as f:
                    creds = json.load(f)
                self.load_machine_id(creds['machine_uuid'], creds['secret_key'])
                self.log('info', 'Loaded existing credentials', 
                        {'machine_uuid': self.machine_uuid})
                return True
        except Exception as e:
            self.log('debug', 'No existing credentials found or corrupted')
        return False
    
    def init(self, metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """Initialize machine - loads existing or creates new identity"""
        metadata = metadata or {}
        
        # Try to load existing credentials first
        if self.load_credentials():
            self.log('info', 'Using existing machine credentials', 
                    {'machine_uuid': self.machine_uuid})
            return {'existing': True, 'machine_uuid': self.machine_uuid}
        
        # Generate new identity if not found
        identity = self.generate_machine_id()
        self.save_credentials(identity)
        
        # Register with backend
        self.register_machine(metadata)
        
        return {
            'existing': False,
            'identity': identity,
            'machine_uuid': self.machine_uuid
        }
    
    def register_machine(self, metadata: Optional[Dict] = None) -> Dict:
        """Register machine with FoundryNet backend"""
        metadata = metadata or {}
        
        if not self.machine_uuid or not self.verify_key:
            raise ValueError('Generate or load machine ID first')
        
        def _register():
            response = requests.post(
                f"{self.api_url}/register-machine",
                json={
                    'machine_uuid': self.machine_uuid,
                    'machine_pubkey_base58': base58.b58encode(bytes(self.verify_key)).decode('utf-8'),
                    'metadata': metadata,
                },
                headers={'Content-Type': 'application/json'}
            )
            
            if not response.ok:
                raise Exception(f"Registration failed: {response.text}")
            
            result = response.json()
            self.log('info', 'Machine registered successfully', 
                    {'machine_uuid': self.machine_uuid})
            return result
        
        return self._retry(_register, 'Machine registration')
    
    def submit_job(self, job_hash: str, complexity: float = 1.0, 
                   payload: Optional[Dict] = None) -> Dict:
        """Submit a job to the network"""
        payload = payload or {}
        
        if not self.machine_uuid:
            raise ValueError('Machine not initialized')
        
        # Normalize complexity to 2 decimal places
        normalized = round(complexity * 100) / 100
        
        # Validate range
        MIN_COMPLEXITY = 0.5
        MAX_COMPLEXITY = 2.0
        TOLERANCE = 0.01
        
        if normalized < MIN_COMPLEXITY - TOLERANCE or normalized > MAX_COMPLEXITY + TOLERANCE:
            raise ValueError(f"Complexity must be {MIN_COMPLEXITY}-{MAX_COMPLEXITY}, got {normalized}")
        
        def _submit():
            response = requests.post(
                f"{self.api_url}/submit-job",
                json={
                    'machine_uuid': self.machine_uuid,
                    'job_hash': job_hash,
                    'complexity': normalized,
                    'payload': payload,
                },
                headers={'Content-Type': 'application/json'}
            )
            
            if response.status_code == 409:
                self.log('warn', 'Job already exists', {'job_hash': job_hash})
                return {'success': True, 'duplicate': True, 'job_hash': job_hash}
            
            if not response.ok:
                text = response.text
                try:
                    error = response.json().get('error', text)
                except:
                    error = text
                raise Exception(f"Job submission failed: {error}")
            
            result = response.json()
            self.log('debug', 'Job submitted', {'job_hash': job_hash, 'complexity': normalized})
            return result
        
        return self._retry(_submit, 'Job submission')
    
    def complete_job(self, job_hash: str, recipient_wallet: str) -> Dict:
        """Complete a job and trigger settlement"""
        if not self.machine_uuid or not self.signing_key:
            raise ValueError('Machine not initialized')
        
        timestamp = datetime.utcnow().isoformat()
        message = f"{job_hash}|{recipient_wallet}|{timestamp}"
        message_bytes = message.encode('utf-8')
        
        # Sign the message with Ed25519
        signed = self.signing_key.sign(message_bytes)
        signature = signed.signature
        
        def _complete():
            response = requests.post(
                f"{self.api_url}/complete-job",
                json={
                    'machine_uuid': self.machine_uuid,
                    'job_hash': job_hash,
                    'recipient_wallet': recipient_wallet,
                    'completion_proof': {
                        'timestamp': timestamp,
                        'signature_base58': base58.b58encode(signature).decode('utf-8'),
                    },
                },
                headers={'Content-Type': 'application/json'}
            )
            
            if not response.ok:
                raise Exception(f"Job completion failed: {response.text}")
            
            result = response.json()
            self.log('info', 'Job completed - MINT earned!', {
                'job_hash': job_hash,
                'agent_reward': result.get('agent_reward'),
                'treasury_fee': result.get('treasury_fee'),
                'founder_fee': result.get('founder_fee'),
                'tx_signature': result.get('tx_signature'),
                'activity_ratio': result.get('activity_ratio'),
                'complexity_claimed': result.get('complexity_claimed'),
            })
            return result
        
        return self._retry(_complete, 'Job completion')
    
    def get_job_details(self, job_hash: str) -> Dict:
        """Fetch job details including flags"""
        def _fetch():
            response = requests.get(
                f"{self.api_url}/jobs/{job_hash}",
                headers={'Content-Type': 'application/json'}
            )
            
            if not response.ok:
                raise Exception(f"Failed to fetch job: {response.text}")
            
            result = response.json()
            self.log('debug', 'Job details fetched', {
                'job_hash': job_hash,
                'flags': len(result.get('community_flags', []))
            })
            return result
        
        return self._retry(_fetch, 'Fetch job details')
    
    def flag_job(self, job_hash: str, reason: str, details: Optional[str] = None, 
                 member_name: str = 'anonymous') -> Dict:
        """Flag a job as suspicious"""
        full_reason = f"{reason}: {details}" if details else reason
        
        def _flag():
            response = requests.post(
                f"{self.api_url}/flag-job",
                json={
                    'job_hash': job_hash,
                    'flag_reason': full_reason,
                    'community_member': member_name
                },
                headers={'Content-Type': 'application/json'}
            )
            
            if not response.ok:
                raise Exception(f"Failed to flag job: {response.text}")
            
            result = response.json()
            self.log('info', 'Job flagged', {
                'job_hash': job_hash,
                'reason': reason,
                'total_flags': result.get('total_flags')
            })
            return result
        
        return self._retry(_flag, 'Flag job')
    
    def generate_job_hash(self, filename: str, additional_data: str = '') -> str:
        """Generate deterministic job hash"""
        data = f"{self.machine_uuid}|{filename}|{int(time.time() * 1000)}|{additional_data}"
        hash_obj = hashlib.sha256(data.encode('utf-8'))
        hash_hex = hash_obj.hexdigest()
        return f"job_{hash_hex[:16]}_{int(time.time() * 1000)}"
    
    def get_metrics(self) -> Dict:
        """Fetch real-time network metrics"""
        def _fetch():
            response = requests.get(
                f"{self.api_url}/metrics",
                headers={'Content-Type': 'application/json'}
            )
            
            if not response.ok:
                raise Exception("Failed to fetch metrics")
            
            return response.json()
        
        return self._retry(_fetch, 'Fetch metrics')
    
    def get_machine_uuid(self) -> str:
        """Get current machine UUID"""
        return self.machine_uuid or ''
    
    def get_public_key(self) -> str:
        """Get current machine public key (base58)"""
        if self.verify_key:
            return base58.b58encode(bytes(self.verify_key)).decode('utf-8')
        return ''

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
