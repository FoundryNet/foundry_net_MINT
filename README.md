# FoundryNet MINT - Open Source DePIN Manufacturing Network

A decentralized manufacturing network that connects 3D printers and manufacturing machines to blockchain technology for transparent, decentralized production tracking and tokenized manufacturing rewards.

## 🚀 Features

- **Multi-Printer Support**: Connect OctoPrint and Bambu Labs printers
- **Real-time Telemetry**: Live monitoring of print jobs and machine health
- **Blockchain Integration**: Solana-based MINT token rewards system
- **Decentralized Rewards**: Earn tokens for manufacturing activities
- **Privacy Controls**: User-controlled data sharing and privacy settings
- **Machine Management**: Comprehensive dashboard for multiple printers

## 🛠 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + Radix UI components
- **Backend**: Supabase (Database, Auth, Edge Functions)
- **Blockchain**: Solana Web3.js integration
- **State Management**: TanStack Query for server state
- **Printer APIs**: OctoPrint REST API, Bambu Labs MQTT

## 📋 Prerequisites

- Node.js 18+ and npm/yarn
- Supabase account (free tier available)
- Solana wallet (Phantom, Solflare, etc.)
- Compatible 3D printer:
  - OctoPrint-enabled printers (Ender 3, Prusa, etc.)
  - Bambu Labs X1 Carbon or A1 series

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-username/foundrynet-mint.git
cd foundrynet-mint
npm install
```

### 

### 2. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:8080` to access the application.

## 🔧 Hardware Setup

### OctoPrint Configuration

1. Install OctoPrint on Raspberry Pi or dedicated computer
2. Enable API access in OctoPrint settings
3. Generate API key: Settings → API → Create API Key
4. Add machine in FoundryNet dashboard with:
   - Host: Your OctoPrint IP address
   - Port: 80 (default) or custom port
   - API Key: Generated API key

### Bambu Labs Setup

1. Enable MQTT in Bambu Studio printer settings
2. Note down your printer's local IP address
3. Generate access code in printer settings
4. Add machine in FoundryNet dashboard with:
   - Host: Printer IP address
   - Port: 8883 (default MQTT TLS port)
   - Access Key: Generated access code

## 🚀 Deployment

### Deploy to Vercel (Recommended)

1. Fork this repository
2. Connect your GitHub account to Vercel
3. Import the project and set environment variables
4. Deploy with automatic builds on push

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-username/foundrynet-mint)

### Manual Deployment

```bash
npm run build
# Upload dist/ folder to your hosting service
```
                       

## 📚 Documentation

- [Hardware Setup Guide](docs/HARDWARE_SETUP.md)
- [API Documentation](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- 

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test thoroughly
4. Commit your changes: `git commit -m 'Add amazing feature'`
5. Push to the branch: `git push origin feature/amazing-feature`
6. Open a Pull Request

## 🔒 Security

- All printer connections use secure APIs (HTTPS/TLS)
- User data is protected with Row Level Security (RLS)
- API keys are encrypted and stored securely
- No sensitive data is logged or exposed

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- [GitHub Issues](https://github.com/FoundryNet/foundrynet-MINT/issues)
-
