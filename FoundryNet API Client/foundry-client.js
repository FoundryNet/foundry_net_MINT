// foundry-client.js - FoundryNet API Client
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';

class FoundryClient {
  constructor(apiUrl = 'https://your-supabase-url.supabase.co/functions/v1') {
    this.apiUrl = apiUrl;
    this.machineUuid = null;
    this.keyPair = null;
  }

  // Generate new machine identity
  generateMachineId() {
    this.machineUuid = uuidv4();
    this.keyPair = nacl.sign.keyPair();
    return {
      machineUuid: this.machineUuid,
      publicKey: bs58.encode(this.keyPair.publicKey),
      secretKey: bs58.encode(this.keyPair.secretKey) // Save this securely!
    };
  }

  // Load existing machine identity
  loadMachineId(machineUuid, secretKeyBase58) {
    this.machineUuid = machineUuid;
    this.keyPair = {
      publicKey: null, // We'll derive this
      secretKey: bs58.decode(secretKeyBase58)
    };
    // Derive public key from secret key
    const fullKeyPair = nacl.sign.keyPair.fromSecretKey(this.keyPair.secretKey);
    this.keyPair.publicKey = fullKeyPair.publicKey;
  }

  // Register machine with FoundryNet
  async registerMachine(metadata = {}) {
    if (!this.machineUuid || !this.keyPair) {
      throw new Error('Generate or load machine ID first');
    }

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
      throw new Error(`Registration failed: ${await response.text()}`);
    }

    return await response.json();
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
      throw new Error(`Job completion failed: ${await response.text()}`);
    }

    return await response.json();
  }
}

// Simple usage example
async function example() {
  const client = new FoundryClient();
  
  // First time setup
  const identity = client.generateMachineId();
  console.log('Save these credentials:', identity);
  
  // Register machine
  await client.registerMachine({ type: '3d-printer', model: 'Ender 3' });
  
  // Complete a job
  const jobHash = 'job_' + Date.now(); // Your job identifier
  const walletAddress = 'YOUR_SOLANA_WALLET_ADDRESS';
  
  const result = await client.completeJob(jobHash, walletAddress);
  console.log('MINT earned:', result);
}

export { FoundryClient };

// For Node.js usage:
// module.exports = { FoundryClient };
