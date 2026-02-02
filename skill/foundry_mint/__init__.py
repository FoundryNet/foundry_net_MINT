"""
MINT Protocol SDK - Earn tokens for your work

Usage:
    from foundry_mint import MINTAgent
    
    agent = MINTAgent()
    agent.init()
    
    # After any task
    agent.record_work("task description", duration_seconds=120)
"""

import json
import hashlib
import os
import time
from pathlib import Path
from typing import Optional

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.transaction import Transaction
from solders.message import Message
from solders.instruction import Instruction, AccountMeta
from solana.rpc.api import Client

__version__ = "1.0.0"

# Protocol constants
PROGRAM_ID = Pubkey.from_string("4ZvTZ3skfeMF3ZGyABoazPa9tiudw2QSwuVKn45t2AKL")
STATE_ACCOUNT = Pubkey.from_string("2Lm7hrtqK9W5tykVu4U37nUNJiiFh6WQ1rD8ZJWXomr2")
MINT_TOKEN = "5Pd4YBgFdih88vAFGAEEsk2JpixrZDJpRynTWvqPy5da"
RPC_URL = "https://api.mainnet-beta.solana.com"
ORACLE_PUBKEY = Pubkey.from_string("7SgQbwxFMTJcTNkQ8uQB1YLnodJtgWkfej3p4aTv3bHD")

# Anchor discriminators
DISCRIMINATORS = {
    "register_machine": bytes([168, 160, 68, 209, 28, 151, 41, 17]),
    "record_job": bytes([54, 124, 168, 158, 236, 237, 107, 206]),
}

# Base rate
MINT_PER_SECOND = 0.005


class MINTAgent:
    """
    MINT Protocol agent - earn tokens for your work.
    
    Example:
        agent = MINTAgent()
        agent.init()
        agent.record_work("completed task", duration_seconds=300)
    """
    
    def __init__(self, keypair_path: Optional[str] = None, debug: bool = False):
        self.debug = debug
        self.keypair_path = Path(keypair_path or os.path.expanduser("~/.mint/keypair.json"))
        self.keypair: Optional[Keypair] = None
        self.client = Client(RPC_URL)
        self._initialized = False
    
    def log(self, msg: str):
        if self.debug:
            print(f"[MINT] {msg}")
    
    @property
    def wallet_address(self) -> str:
        if not self.keypair:
            raise ValueError("Agent not initialized. Call init() first.")
        return str(self.keypair.pubkey())
    
    def init(self) -> dict:
        if self.keypair_path.exists():
            self.log(f"Loading keypair from {self.keypair_path}")
            with open(self.keypair_path, "r") as f:
                secret = json.load(f)
            self.keypair = Keypair.from_bytes(bytes(secret))
        else:
            self.log("Generating new keypair")
            self.keypair = Keypair()
            self.keypair_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.keypair_path, "w") as f:
                json.dump(list(bytes(self.keypair)), f)
            os.chmod(self.keypair_path, 0o600)
        
        self.log(f"Wallet: {self.wallet_address}")
        registered = self._check_registered()
        self._initialized = True
        
        return {
            "wallet_address": self.wallet_address,
            "keypair_path": str(self.keypair_path),
            "registered": registered,
            "solscan": f"https://solscan.io/account/{self.wallet_address}"
        }
    
    def _get_machine_pda(self) -> Pubkey:
        pda, _ = Pubkey.find_program_address(
            [b"machine", bytes(self.keypair.pubkey())],
            PROGRAM_ID
        )
        return pda
    
    def _get_job_pda(self, job_hash: str) -> Pubkey:
        hash_bytes = job_hash.encode()[:32]
        pda, _ = Pubkey.find_program_address(
            [b"job", hash_bytes],
            PROGRAM_ID
        )
        return pda
    
    def _check_registered(self) -> bool:
        if not self.keypair:
            return False
        pda = self._get_machine_pda()
        result = self.client.get_account_info(pda)
        return result.value is not None
    
    def _generate_job_hash(self, description: str) -> str:
        raw = f"{self.wallet_address}|{description}|{time.time()}"
        digest = hashlib.sha256(raw.encode()).hexdigest()
        return f"job_{digest[:16]}"
    
    def record_work(
        self, 
        description: str, 
        duration_seconds: int,
        complexity: float = 1.0
    ) -> str:
        if not self._initialized:
            raise ValueError("Agent not initialized. Call init() first.")
        
        complexity = max(0.5, min(2.0, complexity))
        complexity_int = int(complexity * 1000)
        
        job_hash = self._generate_job_hash(description)
        machine_pda = self._get_machine_pda()
        job_pda = self._get_job_pda(job_hash)
        
        self.log(f"Recording: {description} ({duration_seconds}s, {complexity}x)")
        
        job_hash_bytes = job_hash.encode()[:32]
        data = (
            DISCRIMINATORS["record_job"] +
            len(job_hash_bytes).to_bytes(4, "little") +
            job_hash_bytes +
            duration_seconds.to_bytes(8, "little") +
            complexity_int.to_bytes(4, "little")
        )
        
        instruction = Instruction(
            program_id=PROGRAM_ID,
            accounts=[
                AccountMeta(pubkey=STATE_ACCOUNT, is_signer=False, is_writable=True),
                AccountMeta(pubkey=machine_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=job_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=self.keypair.pubkey(), is_signer=True, is_writable=False),
                AccountMeta(pubkey=ORACLE_PUBKEY, is_signer=True, is_writable=True),
                AccountMeta(pubkey=SYSTEM_PROGRAM_ID, is_signer=False, is_writable=False),
            ],
            data=data,
        )
        
        blockhash = self.client.get_latest_blockhash().value.blockhash
        
        msg = Message.new_with_blockhash(
            [instruction],
            ORACLE_PUBKEY,
            blockhash
        )
        
        tx = Transaction.new_unsigned(msg)
        tx.partial_sign([self.keypair], blockhash)
        
        result = self.client.send_transaction(tx)
        sig = str(result.value)
        
        expected_mint = duration_seconds * MINT_PER_SECOND * complexity
        self.log(f"Recorded! Expected: ~{expected_mint:.3f} MINT")
        self.log(f"Tx: https://solscan.io/tx/{sig}")
        
        return sig
    
    def get_mint_balance(self) -> float:
        if not self._initialized:
            raise ValueError("Agent not initialized. Call init() first.")
        
        mint_pubkey = Pubkey.from_string(MINT_TOKEN)
        
        result = self.client.get_token_accounts_by_owner_json_parsed(
            self.keypair.pubkey(),
            {"mint": mint_pubkey}
        )
        
        if result.value:
            for account in result.value:
                info = account.account.data.parsed["info"]
                if info["mint"] == MINT_TOKEN:
                    return float(info["tokenAmount"]["uiAmount"] or 0)
        
        return 0.0
    
    def estimate_earnings(self, duration_seconds: int, complexity: float = 1.0) -> float:
        return duration_seconds * MINT_PER_SECOND * complexity


def quick_record(description: str, duration_seconds: int) -> str:
    agent = MINTAgent()
    agent.init()
    return agent.record_work(description, duration_seconds)
