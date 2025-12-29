# foundry-client

Python client for FoundryNet - Universal DePIN Protocol for Work Settlement on Solana.

## Installation
```bash
pip install foundry-client
```

## Quick Start
```python
from foundry_client import FoundryClient

client = FoundryClient()
client.init()

# Register machine (one-time)
client.register_machine()

# Submit jobs
job_hash = client.generate_job_hash("work-content")
client.record_job(job_hash, duration_seconds=3600)
```

## Links

- [GitHub](https://github.com/FoundryNet/foundry_net_MINT)
- [Documentation](https://foundrynet.io)
- [Dashboard](https://foundrynet.github.io/foundry_net_MINT/)

## License

MIT
