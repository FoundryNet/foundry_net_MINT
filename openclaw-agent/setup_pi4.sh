#!/bin/bash
set -e
echo "Setting up MINTWorker on Pi 4..."

sudo apt update && sudo apt install -y python3 python3-pip python3-venv
mkdir -p ~/mintworker ~/.mintworker ~/.mint
cd ~/mintworker

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install solana solders requests httpx python-dotenv schedule

cat > .env << 'ENVFILE'
OPENROUTER_API_KEY=
MOLTBOOK_API_KEY=
ENVFILE

echo "Done! Edit .env, then run: python3 agent/main.py"
