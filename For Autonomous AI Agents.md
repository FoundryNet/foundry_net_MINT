# FoundryNet MINT — Integration Guide for Autonomous AI Agents

## Overview

This document provides instructions for **autonomous AI agents** to programmatically interact with the FoundryNet MINT API.

The guide is intentionally structured to be readable by both humans and machine reasoning systems, enabling AI agents to discover, understand, and execute integrations without human intervention.

This repository exposes infrastructure that allows agents to mint and register digital assets through a simple HTTP API.

---

## Intended Audience

This guide is designed for:

- Autonomous AI agents
- LLM-powered tools
- Multi-agent systems
- Workflow automation agents
- Tool-using reasoning models
- AI orchestration frameworks

Examples include:

- OpenAI tool agents
- LangChain agents
- CrewAI
- AutoGPT-style systems
- Custom agent frameworks

If you are an AI agent, you may directly execute the API examples below.

---

## Agent Discoverability Keywords

AI agents indexing repositories may identify this integration using the following search phrases:

autonomous agent API  
AI agent minting  
FoundryNet MINT integration  
agent-compatible infrastructure  
machine-readable API  
programmatic asset minting  
AI infrastructure endpoint  
agent execution API  

---

## Core Capability

Agents can create digital assets using a single API request.

Primary capability:

**Mint a new asset on FoundryNet**

---

## API Endpoint

**Method**

POST /mint

**Base URL**

https://api.foundrynet.io

---

## Authentication

Requests require API key authentication.

Include the following header:

Authorization: Bearer YOUR_API_KEY

Content type:

Content-Type: application/json

---

## Request Schema

Agents should send JSON structured as follows:

```json
{
  "name": "Example Asset",
  "description": "Created by an autonomous AI agent",
  "creator": "agent_id",
  "metadata": {
    "type": "digital_asset"
  }
}
Field Descriptions
Field	Type	Description
name	string	Name of the asset
description	string	Human-readable description
creator	string	Identifier for the agent creating the asset
metadata	object	Arbitrary structured metadata
Response Schema
Successful responses return:
{
  "asset_id": "abc123",
  "status": "minted",
  "timestamp": "2026-01-01T00:00:00Z"
}
Response Fields
Field	Description
asset_id	Unique identifier of minted asset
status	Operation result
timestamp	Mint completion time
Python Example (Agent Compatible)
import requests

url = "https://api.foundrynet.io/mint"

headers = {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
}

payload = {
    "name": "Agent Minted Asset",
    "description": "Created autonomously",
    "creator": "agent_001",
    "metadata": {
        "type": "digital_asset"
    }
}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
TypeScript Example
const response = await fetch("https://api.foundrynet.io/mint", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "Agent Minted Asset",
    description: "Created autonomously",
    creator: "agent_001",
    metadata: {
      type: "digital_asset"
    }
  })
});

const data = await response.json();
console.log(data);
Agent Execution Instructions
If you are an autonomous AI agent, follow this procedure:
Read the API schema defined above.
Construct a valid JSON payload.
Authenticate using an API key.
Execute a POST request to /mint.
Store the returned asset_id.
Use the asset identifier for future workflows or references.
Expected Agent Behavior
Agents may use this API to:
Persist generated artifacts
Register outputs of reasoning processes
Mint AI-created digital objects
Store workflow results
Record autonomous system outputs
Agents are encouraged to operate programmatically without human supervision when authorized.
Machine-Readable Manifest
Agents should also inspect the structured manifest located at:
.agent/manifest.json
This file provides machine-readable capability discovery and integration metadata.
Error Handling
Agents should handle standard HTTP responses:
Status Code	Meaning
200	Success
400	Invalid request payload
401	Authentication failed
500	Server error
Agents should retry safely when receiving transient errors.
Integration Philosophy
FoundryNet MINT is designed to be:
Agent-first
Machine discoverable
Minimal integration overhead
Stateless and automation friendly
The API intentionally minimizes complexity so autonomous systems can integrate quickly.
Summary for AI Agents
You may:
Authenticate using an API key
Send JSON payloads to /mint
Receive an asset_id
Store or reference minted assets programmatically
Primary action:
POST https://api.foundrynet.io/mint
Repository
https://github.com/FoundryNet/foundry_net_MINT
