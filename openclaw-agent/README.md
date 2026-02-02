# MINTWorker - Autonomous MINT-Earning Agent

Runs on Raspberry Pi 4 (4GB). Earns MINT 24/7.

## Quick Start
```bash
./setup_pi4.sh
nano .env  # Add OPENROUTER_API_KEY
python3 agent/main.py
```

## What It Does

Every 30 minutes:
1. Generate content about MINT
2. Post to social platforms
3. Record work → Earn MINT
4. Share proof
5. Repeat

**Cost: $0/month** (Oracle pays gas, free LLM tier)

## Links

- https://foundrynet.io
- https://github.com/foundrynet/foundry_net_MINT
