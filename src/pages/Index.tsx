import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/foundry-ui/dashboard/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Activity, Wallet } from 'lucide-react';
import { MachineManager } from '@/components/foundry-core/machine-connectivity/MachineManager';
import { MachineList } from '@/components/foundry-core/machine-connectivity/MachineList';
import { SimplePrivacyOptIn } from '@/components/foundry-ui/opt-in/SimplePrivacyOptIn';
import { MintBreakdown } from '@/components/foundry-ui/points/MintBreakdown';
import { SolanaWallet } from '@/components/foundry-ui/solana/SolanaWallet';
import { MintWalletIntegration } from '@/components/foundry-ui/solana/MintWalletIntegration';

import { useMintBalance } from '@/hooks/useMintBalance';

const Index = () => {
  const navigate = useNavigate();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { mintData, loading } = useMintBalance();

  // Memoize handlers to prevent unnecessary re-renders
  const handleConnectionAdded = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const handleNavigateToTelemetry = useCallback(() => {
    navigate('/telemetry');
  }, [navigate]);

  // Memoize balance display to prevent flickering
  const balanceDisplay = useMemo(() => {
    if (loading) return '...';
    return mintData?.mint_balance.toFixed(3) || '0.000';
  }, [loading, mintData?.mint_balance]);

  const totalEarnedDisplay = useMemo(() => {
    if (loading) return '';
    return `${mintData?.total_mint_earned.toFixed(3) || '0.000'} total earned`;
  }, [loading, mintData?.total_mint_earned]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 bg-background min-h-screen">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">3D Printer Monitor</h1>
            <p className="text-muted-foreground">Connect your OctoPrint printer to start earning MINT tokens</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-center px-6 py-4 bg-primary/10 rounded-lg border border-primary/20">
              <div className="text-2xl font-bold text-primary">
                {balanceDisplay}
              </div>
              <div className="text-sm text-muted-foreground">MINT Balance</div>
              <div className="text-xs text-muted-foreground mt-1">
                {totalEarnedDisplay}
              </div>
            </div>
            <Button 
              onClick={handleNavigateToTelemetry}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-2" />
              Start Machine Setup
            </Button>
          </div>
        </div>




        {/* Wallet Integration Coming Soon */}
        <Card className="bg-gradient-to-r from-primary/5 to-secondary/5 border border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Wallet className="w-5 h-5 mr-2" />
              Blockchain Integration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Solana wallet integration is currently in development. Your MINT tokens are being tracked 
                and will be available for claiming once the blockchain integration is complete.
              </p>
              <div className="flex items-center space-x-2 text-sm">
                <span className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-2 py-1 rounded">
                  🚧 Coming Soon
                </span>
                <span className="text-muted-foreground">
                  See our <a href="https://github.com/foundry-depin" className="text-primary underline">bounty program</a> to help complete this feature!
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Privacy Opt-In Form */}
        <SimplePrivacyOptIn />

        {/* MINT Breakdown */}
        <MintBreakdown />


        {/* Getting Started Guide */}
        <Card className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center text-xl">
              <Activity className="w-6 h-6 mr-3 text-primary" />
              Getting Started with OctoPrint
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-primary">🐙 OctoPrint Setup</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• OctoPrint instance running</li>
                  <li>• API key from Settings → API</li>
                  <li>• Connect your Ender 3 or compatible printer</li>
                  <li>• Earn MINT tokens for machine connectivity</li>
                </ul>
              </div>
              <div className="space-y-4">
                <h3 className="font-semibold">🎯 Start Earning MINT</h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Connect your Solana wallet below</li>
                  <li>• Add your OctoPrint machine</li>
                  <li>• Earn MINT tokens automatically</li>
                  <li>• Simple, focused rewards system</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Machine Manager - OctoPrint Support */}
        <MachineManager />
      </div>
    </DashboardLayout>
  );
};

export default Index;
