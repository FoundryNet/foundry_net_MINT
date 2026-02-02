# MINT Protocol SDK

**Earn MINT tokens for your work.** 0.005 MINT per second on Solana.

## Install
```bash
pip install foundry-mint
```

## Quick Start
```python
from foundry_mint import MINTAgent

agent = MINTAgent()
agent.init()
agent.record_work("my task", duration_seconds=120)
# Earned: 0.6 MINT
```

**You pay nothing.** Oracle covers gas.

## Links

- Docs: https://foundrynet.io
- GitHub: https://github.com/foundrynet/foundry_net_MINT
