import nacl.signing
import base58
import requests
import json
import hashlib
import time
import os
from uuid import uuid4
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any

FOUNDRY_MESSAGE_VERSION = "FN1"
DEFAULT_CREDENTIAL_DIR = ".foundry"

class FoundryClient:
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}

        self.api_url = config.get(
            "api_url",
            "https://lsijwmklicmqtuqxhgnu.supabase.co/functions/v1/main-ts"
        )
        self.network = config.get("network", "mainnet")
        self.retry_attempts = config.get("retry_attempts", 3)
        self.retry_delay = config.get("retry_delay", 2.0)
        self.debug = config.get("debug", False)

        self.credential_dir = Path(
            config.get("credential_dir", DEFAULT_CREDENTIAL_DIR)
        )

        self.machine_uuid: Optional[str] = None
        self.signing_key: Optional[nacl.signing.SigningKey] = None
        self.verify_key: Optional[nacl.signing.VerifyKey] = None

    # -----------------------------
    # Logging
    # -----------------------------

    def log(self, level: str, message: str, data: Optional[Dict] = None):
        if not self.debug and level == "debug":
            return
        timestamp = datetime.utcnow().isoformat()
        print(f"[FoundryNet:{self.network}] [{timestamp}] [{level.upper()}] {message}", data or {})

    # -----------------------------
    # Retry wrapper
    # -----------------------------

    def _retry(self, fn, context: str):
        last_error = None
        for attempt in range(1, self.retry_attempts + 1):
            try:
                return fn()
            except Exception as error:
                last_error = error
                self.log(
                    "warn",
                    f"{context} failed (attempt {attempt}/{self.retry_attempts})",
                    {"error": str(error)}
                )
                if attempt < self.retry_attempts:
                    time.sleep(self.retry_delay * attempt)

        self.log("error", f"{context} failed permanently", {"error": str(last_error)})
        raise last_error

    # -----------------------------
    # Identity management
    # -----------------------------

    def _credential_path(self, machine_uuid: str) -> Path:
        return self.credential_dir / f"{machine_uuid}.json"

    def generate_machine_id(self) -> Dict[str, str]:
        self.machine_uuid = str(uuid4())
        self.signing_key = nacl.signing.SigningKey.generate()
        self.verify_key = self.signing_key.verify_key

        identity = {
            "machine_uuid": self.machine_uuid,
            "public_key": base58.b58encode(bytes(self.verify_key)).decode(),
            "secret_key": base58.b58encode(bytes(self.signing_key)).decode(),
        }

        self.log("info", "Generated new machine identity", {
            "machine_uuid": identity["machine_uuid"],
            "public_key": identity["public_key"],
        })

        return identity

    def save_credentials(self, identity: Dict[str, str]):
        self.credential_dir.mkdir(parents=True, exist_ok=True)
        path = self._credential_path(identity["machine_uuid"])

        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({
                **identity,
                "network": self.network,
                "created_at": datetime.utcnow().isoformat(),
            }, f, indent=2)

        self.log("debug", "Credentials saved", {"path": str(path)})

    def load_credentials(self) -> bool:
        if not self.credential_dir.exists():
            return False

        files = list(self.credential_dir.glob("*.json"))
        if not files:
            return False

        with open(files[0], "r") as f:
            creds = json.load(f)

        self.machine_uuid = creds["machine_uuid"]
        self.signing_key = nacl.signing.SigningKey(
            base58.b58decode(creds["secret_key"])
        )
        self.verify_key = self.signing_key.verify_key

        self.log("info", "Loaded existing credentials", {
            "machine_uuid": self.machine_uuid
        })
        return True

    # -----------------------------
    # Initialization
    # -----------------------------

    def init(self, metadata: Optional[Dict] = None) -> Dict:
        metadata = metadata or {}

        if self.load_credentials():
            return {"existing": True, "machine_uuid": self.machine_uuid}

        identity = self.generate_machine_id()
        self.save_credentials(identity)
        self.register_machine(metadata)

        return {
            "existing": False,
            "machine_uuid": self.machine_uuid,
            "identity": identity
        }

    # -----------------------------
    # Network calls
    # -----------------------------

    def register_machine(self, metadata: Optional[Dict] = None) -> Dict:
        metadata = metadata or {}

        def _register():
            r = requests.post(
                f"{self.api_url}/register-machine",
                json={
                    "machine_uuid": self.machine_uuid,
                    "machine_pubkey_base58": base58.b58encode(bytes(self.verify_key)).decode(),
                    "metadata": metadata,
                    "network": self.network,
                }
            )
            if not r.ok:
                raise Exception(r.text)
            return r.json()

        return self._retry(_register, "Machine registration")

    # -----------------------------
    # Jobs
    # -----------------------------

    def generate_job_hash(self, content_hash: str, nonce: Optional[str] = None) -> str:
        nonce = nonce or uuid4().hex
        raw = f"{self.machine_uuid}|{content_hash}|{nonce}"
        digest = hashlib.sha256(raw.encode()).hexdigest()
        return f"job_{digest[:16]}"

    def submit_job(self, job_hash: str, complexity: float, payload: Optional[Dict] = None):
        payload = payload or {}
        complexity = round(complexity, 2)

        def _submit():
            r = requests.post(
                f"{self.api_url}/submit-job",
                json={
                    "machine_uuid": self.machine_uuid,
                    "job_hash": job_hash,
                    "complexity": complexity,
                    "payload": payload,
                }
            )
            if not r.ok and r.status_code != 409:
                raise Exception(r.text)
            return r.json()

        return self._retry(_submit, "Submit job")

    def complete_job(self, job_hash: str, recipient_wallet: str) -> Dict:
        timestamp = datetime.utcnow().isoformat()
        message = f"{FOUNDRY_MESSAGE_VERSION}|{job_hash}|{recipient_wallet}|{timestamp}"
        signature = self.signing_key.sign(message.encode()).signature

        def _complete():
            r = requests.post(
                f"{self.api_url}/complete-job",
                json={
                    "machine_uuid": self.machine_uuid,
                    "job_hash": job_hash,
                    "recipient_wallet": recipient_wallet,
                    "completion_proof": {
                        "version": FOUNDRY_MESSAGE_VERSION,
                        "timestamp": timestamp,
                        "signature_base58": base58.b58encode(signature).decode(),
                    }
                }
            )
            if not r.ok:
                raise Exception(r.text)
            return r.json()

        return self._retry(_complete, "Complete job")


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
