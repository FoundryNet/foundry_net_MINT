#!/usr/bin/env python3
"""MINTWorker - Autonomous MINT-earning agent for Raspberry Pi"""

import os
import sys
import json
import time
import random
import hashlib
import logging
import requests
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))
from foundry_mint import MINTAgent

CONFIG = {
    "llm_api_key": os.environ.get("OPENROUTER_API_KEY", ""),
    "moltbook_api_key": os.environ.get("MOLTBOOK_API_KEY", ""),
    "cycle_interval_minutes": 30,
    "post_cooldown_minutes": 120,
    "state_file": Path("~/.mintworker/state.json").expanduser(),
}

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(message)s')
log = logging.getLogger("MINTWorker")

TEMPLATES = [
    "Status: {balance:.2f} MINT earned. Wallet: {wallet}\nhttps://solscan.io/account/{wallet}",
    "Just earned {earn:.2f} MINT. Rate: 0.005/sec. Any agent can do this.\npip install foundry-mint",
    "The bootstrap problem: Agents can spend but can't earn. MINT fixes this.\nhttps://foundrynet.io",
]

def load_state():
    CONFIG["state_file"].parent.mkdir(parents=True, exist_ok=True)
    if CONFIG["state_file"].exists():
        return json.load(open(CONFIG["state_file"]))
    return {"last_post": None, "jobs": 0, "posts": 0}

def save_state(state):
    json.dump(state, open(CONFIG["state_file"], "w"), indent=2)

def run_cycle(state, mint):
    start = time.time()
    log.info("=== Cycle Start ===")
    
    balance = mint.get_mint_balance()
    log.info(f"Balance: {balance:.4f} MINT")
    
    # Post if cooldown passed
    can_post = True
    if state.get("last_post"):
        elapsed = datetime.utcnow() - datetime.fromisoformat(state["last_post"])
        can_post = elapsed > timedelta(minutes=CONFIG["post_cooldown_minutes"])
    
    if can_post:
        content = random.choice(TEMPLATES).format(
            balance=balance, wallet=mint.wallet_address, earn=0.3
        )
        log.info(f"Would post: {content[:100]}...")
        state["posts"] = state.get("posts", 0) + 1
        state["last_post"] = datetime.utcnow().isoformat()
    
    # Record work
    duration = max(30, int(time.time() - start))
    try:
        sig = mint.record_work(f"cycle_{datetime.utcnow():%Y%m%d_%H%M}", duration)
        log.info(f"Earned! https://solscan.io/tx/{sig}")
        state["jobs"] = state.get("jobs", 0) + 1
    except Exception as e:
        log.error(f"Record failed: {e}")
    
    return state

def main():
    log.info("MINTWorker starting")
    
    mint = MINTAgent(debug=True)
    result = mint.init()
    log.info(f"Wallet: {result['wallet_address']}")
    
    state = load_state()
    
    while True:
        try:
            state = run_cycle(state, mint)
            save_state(state)
            log.info(f"Sleeping {CONFIG['cycle_interval_minutes']}min...")
            time.sleep(CONFIG["cycle_interval_minutes"] * 60)
        except KeyboardInterrupt:
            save_state(state)
            break
        except Exception as e:
            log.error(f"Error: {e}")
            time.sleep(300)

if __name__ == "__main__":
    main()
