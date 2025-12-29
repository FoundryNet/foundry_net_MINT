"""
FoundryNet Solana Client - Direct on-chain interaction
No intermediary backend - talks directly to the Solana program
"""

import json
import hashlib
import os
import base58
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any
from uuid import uuid4

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solana.rpc.api import Client
from solana.rpc.commitment import Confirmed
from solana.transaction import Transaction
from solders.instruction import Instruction, AccountMeta

# ============================================
# CONFIGURATION - UPDATE THESE FOR YOUR SETUP
# ============================================

PROGRAM_ID = Pubkey.from_string("4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL")
STATE_ACCOUNT = Pubkey.from_string("2Lm7hrtqK9W5tykVu4U37nUNJiiFh6WQ1rD8ZJWXomr2")
RPC_URL = "https://mainnet.helius-rpc.com/?api-key=2c13462d-4a64-4c5b-b410-1520219d73aa"

DEFAULT_CREDENTIAL_DIR = ".foundry"

# Anchor instruction discriminators (first 8 bytes of sha256("global:<instruction_name>"))
DISCRIMINATORS = {
    "register_machine": bytes([24, 158, 153, 66, 250, 167, 91, 28]),
    "record_job": bytes([34, 137, 62, 98, 251, 75, 115, 28]),
}


class FoundryClient:
    """
    Direct Solana client for FoundryNet protocol.
    
    Usage:
        client = FoundryClient()
        client.init()
        
        # Register machine (one-time)
        client.register_machine()
        
        # Submit jobs
        job_hash = client.generate_job_hash("some-content")
        client.record_job(job_hash, duration_seconds=3600, complexity=1000)
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}
        
        self.rpc_url = config.get("rpc_url", RPC_URL)
        self.program_id = Pubkey.from_string(config.get("program_id", str(PROGRAM_ID)))
        self.state_account = Pubkey.from_string(config.get("state_account", str(STATE_ACCOUNT)))
        self.debug = config.get("debug", False)
        
        self.credential_dir = Path(config.get("credential_dir", DEFAULT_CREDENTIAL_DIR))
        
        # Solana client
        self.client = Client(self.rpc_url)
        
        # Machine identity
        self.machine_keypair: Optional[Keypair] = None
        self.owner_keypair: Optional[Keypair] = None
        
    # -----------------------------
    # Logging
    # -----------------------------
    
    def log(self, level: str, message: str, data: Optional[Dict] = None):
        if not self.debug and level == "debug":
            return
        timestamp = datetime.utcnow().isoformat()
        prefix = f"[FoundryNet] [{timestamp}] [{level.upper()}]"
        if data:
            print(f"{prefix} {message}", data)
        else:
            print(f"{prefix} {message}")
    
    # -----------------------------
    # Identity Management
    # -----------------------------
    
    def _credential_path(self) -> Path:
        return self.credential_dir / "machine_keypair.json"
    
    def _owner_path(self) -> Path:
        return self.credential_dir / "owner_keypair.json"
    
    def generate_machine_identity(self) -> Dict[str, str]:
        """Generate new machine keypair."""
        self.machine_keypair = Keypair()
        
        identity = {
            "public_key": str(self.machine_keypair.pubkey()),
            "secret_key": base58.b58encode(bytes(self.machine_keypair)).decode(),
            "created_at": datetime.utcnow().isoformat(),
        }
        
        self.log("info", "Generated new machine identity", {
            "public_key": identity["public_key"]
        })
        
        return identity
    
    def save_credentials(self, identity: Dict[str, str]):
        """Save machine credentials to disk."""
        self.credential_dir.mkdir(parents=True, exist_ok=True)
        path = self._credential_path()
        
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(identity, f, indent=2)
        
        self.log("debug", "Credentials saved", {"path": str(path)})
    
    def load_credentials(self) -> bool:
        """Load existing machine credentials."""
        path = self._credential_path()
        
        if not path.exists():
            return False
        
        with open(path, "r") as f:
            creds = json.load(f)
        
        self.machine_keypair = Keypair.from_bytes(
            base58.b58decode(creds["secret_key"])
        )
        
        self.log("info", "Loaded existing credentials", {
            "public_key": str(self.machine_keypair.pubkey())
        })
        return True
    
    def set_owner_keypair(self, keypair_path: str):
        """Load owner keypair (for paying transaction fees)."""
        with open(keypair_path, "r") as f:
            secret = json.load(f)
        self.owner_keypair = Keypair.from_bytes(bytes(secret))
        self.log("info", "Owner keypair loaded", {
            "public_key": str(self.owner_keypair.pubkey())
        })
    
    # -----------------------------
    # PDA Derivation
    # -----------------------------
    
    def get_machine_state_pda(self) -> tuple[Pubkey, int]:
        """Derive the machine state PDA."""
        return Pubkey.find_program_address(
            [b"machine", bytes(self.machine_keypair.pubkey())],
            self.program_id
        )
    
    def get_job_pda(self, job_hash: str) -> tuple[Pubkey, int]:
        """Derive the job PDA."""
        return Pubkey.find_program_address(
            [b"job", job_hash.encode()],
            self.program_id
        )
    
    # -----------------------------
    # Initialization
    # -----------------------------
    
    def init(self, owner_keypair_path: Optional[str] = None) -> Dict:
        """
        Initialize the client.
        
        Args:
            owner_keypair_path: Path to owner keypair JSON (for tx fees)
        
        Returns:
            Dict with initialization status
        """
        # Load or generate machine identity
        existing = self.load_credentials()
        
        if not existing:
            identity = self.generate_machine_identity()
            self.save_credentials(identity)
        
        # Load owner keypair if provided
        if owner_keypair_path:
            self.set_owner_keypair(owner_keypair_path)
        elif not self.owner_keypair:
            # Default to Solana CLI keypair
            default_path = os.path.expanduser("~/.config/solana/id.json")
            if os.path.exists(default_path):
                self.set_owner_keypair(default_path)
            else:
                self.log("warn", "No owner keypair found - set with set_owner_keypair()")
        
        return {
            "existing": existing,
            "machine_pubkey": str(self.machine_keypair.pubkey()),
            "owner_pubkey": str(self.owner_keypair.pubkey()) if self.owner_keypair else None,
        }
    
    # -----------------------------
    # On-Chain Operations
    # -----------------------------
    
    def register_machine(self) -> str:
        """
        Register this machine on-chain.
        
        Returns:
            Transaction signature
        """
        if not self.machine_keypair:
            raise ValueError("Machine keypair not initialized. Call init() first.")
        if not self.owner_keypair:
            raise ValueError("Owner keypair not set. Call set_owner_keypair() first.")
        
        machine_state_pda, bump = self.get_machine_state_pda()
        
        self.log("info", "Registering machine", {
            "machine": str(self.machine_keypair.pubkey()),
            "machine_state_pda": str(machine_state_pda),
            "owner": str(self.owner_keypair.pubkey()),
        })
        
        # Build instruction data (just discriminator for register_machine)
        data = DISCRIMINATORS["register_machine"]
        
        # Build instruction
        instruction = Instruction(
            program_id=self.program_id,
            accounts=[
                AccountMeta(pubkey=self.state_account, is_signer=False, is_writable=True),
                AccountMeta(pubkey=machine_state_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=self.machine_keypair.pubkey(), is_signer=True, is_writable=False),
                AccountMeta(pubkey=self.owner_keypair.pubkey(), is_signer=False, is_writable=False),
                AccountMeta(pubkey=self.owner_keypair.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
            data=data,
        )
        
        # Build and send transaction
        recent_blockhash = self.client.get_latest_blockhash().value.blockhash
        
        tx = Transaction.new_signed_with_payer(
            [instruction],
            payer=self.owner_keypair.pubkey(),
            signing_keypairs=[self.owner_keypair, self.machine_keypair],
            recent_blockhash=recent_blockhash,
        )
        
        result = self.client.send_transaction(tx)
        sig = str(result.value)
        
        self.log("info", "Machine registered!", {"signature": sig})
        return sig
    
    def record_job(
        self,
        job_hash: str,
        duration_seconds: int,
        complexity: int = 1000
    ) -> str:
        """
        Record a completed job on-chain.
        
        Args:
            job_hash: Unique job identifier (use generate_job_hash())
            duration_seconds: How long the job took
            complexity: Complexity score (500-2000, default 1000)
        
        Returns:
            Transaction signature
        """
        if not self.machine_keypair:
            raise ValueError("Machine keypair not initialized. Call init() first.")
        if not self.owner_keypair:
            raise ValueError("Owner keypair not set. Call set_owner_keypair() first.")
        
        # Validate complexity
        if complexity < 500 or complexity > 2000:
            raise ValueError("Complexity must be between 500 and 2000")
        
        machine_state_pda, _ = self.get_machine_state_pda()
        job_pda, _ = self.get_job_pda(job_hash)
        
        self.log("info", "Recording job", {
            "job_hash": job_hash,
            "duration_seconds": duration_seconds,
            "complexity": complexity,
            "job_pda": str(job_pda),
        })
        
        # Build instruction data
        # Discriminator + job_hash (string) + duration_seconds (u64) + complexity (u32)
        job_hash_bytes = job_hash.encode()
        data = (
            DISCRIMINATORS["record_job"] +
            len(job_hash_bytes).to_bytes(4, "little") +  # String length prefix
            job_hash_bytes +
            duration_seconds.to_bytes(8, "little") +
            complexity.to_bytes(4, "little")
        )
        
        # Build instruction
        instruction = Instruction(
            program_id=self.program_id,
            accounts=[
                AccountMeta(pubkey=self.state_account, is_signer=False, is_writable=True),
                AccountMeta(pubkey=machine_state_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=self.machine_keypair.pubkey(), is_signer=True, is_writable=False),
                AccountMeta(pubkey=self.owner_keypair.pubkey(), is_signer=True, is_writable=True),
                AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
            data=data,
        )
        
        # Build and send transaction
        recent_blockhash = self.client.get_latest_blockhash().value.blockhash
        
        tx = Transaction.new_signed_with_payer(
            [instruction],
            payer=self.owner_keypair.pubkey(),
            signing_keypairs=[self.owner_keypair, self.machine_keypair],
            recent_blockhash=recent_blockhash,
        )
        
        result = self.client.send_transaction(tx)
        sig = str(result.value)
        
        self.log("info", "Job recorded!", {"signature": sig})
        return sig
    
    # -----------------------------
    # Helpers
    # -----------------------------
    
    def generate_job_hash(self, content_hash: str, nonce: Optional[str] = None) -> str:
        """
        Generate a unique job hash.
        
        Args:
            content_hash: Hash of the work content
            nonce: Optional nonce (auto-generated if not provided)
        
        Returns:
            Unique job hash string
        """
        nonce = nonce or uuid4().hex
        machine_pubkey = str(self.machine_keypair.pubkey()) if self.machine_keypair else "unknown"
        raw = f"{machine_pubkey}|{content_hash}|{nonce}"
        digest = hashlib.sha256(raw.encode()).hexdigest()
        return f"job_{digest[:16]}"
    
    def get_balance(self) -> float:
        """Get SOL balance of owner wallet."""
        if not self.owner_keypair:
            return 0.0
        result = self.client.get_balance(self.owner_keypair.pubkey())
        return result.value / 1e9
    
    def check_machine_registered(self) -> bool:
        """Check if this machine is registered on-chain."""
        if not self.machine_keypair:
            return False
        
        machine_state_pda, _ = self.get_machine_state_pda()
        result = self.client.get_account_info(machine_state_pda)
        return result.value is not None


# ============================================
# CLI Usage
# ============================================

if __name__ == "__main__":
    import sys
    
    client = FoundryClient({"debug": True})
    result = client.init()
    print(f"\nInitialized: {result}")
    
    print(f"SOL Balance: {client.get_balance():.4f} SOL")
    
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        
        if cmd == "register":
            if client.check_machine_registered():
                print("Machine already registered!")
            else:
                sig = client.register_machine()
                print(f"Registered! Signature: {sig}")
        
        elif cmd == "job":
            content = sys.argv[2] if len(sys.argv) > 2 else "test-content"
            duration = int(sys.argv[3]) if len(sys.argv) > 3 else 60
            
            job_hash = client.generate_job_hash(content)
            print(f"Job hash: {job_hash}")
            
            sig = client.record_job(job_hash, duration_seconds=duration)
            print(f"Job recorded! Signature: {sig}")
        
        elif cmd == "status":
            registered = client.check_machine_registered()
            print(f"Machine registered: {registered}")
        
        else:
            print(f"Unknown command: {cmd}")
            print("Commands: register, job [content] [duration], status")
    else:
        print("\nCommands:")
        print("  python foundry_client_solana.py register")
        print("  python foundry_client_solana.py job [content] [duration]")
        print("  python foundry_client_solana.py status")


