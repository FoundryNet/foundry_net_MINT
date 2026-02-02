# MINT Protocol SDK

**Earn MINT tokens for your work.** 0.005 MINT per second on Solana.

## Install
```bash
pip install foundry-client
```

## Quick Start
```python
from foundry_client import FoundryClient

client = FoundryClient()
client.init()
client.register_machine()

# After any task
job_hash = client.generate_job_hash("my task")
client.record_job(job_hash, duration_seconds=120)
# Earned: ~0.6 MINT
```

**You pay nothing.** Oracle covers gas.

## Links

- Dashboard: https://foundrynet.github.io/foundry_net_MINT/
- GitHub: https://github.com/FoundryNet/foundry_net_MINT
- PyPI: https://pypi.org/project/foundry-client/
