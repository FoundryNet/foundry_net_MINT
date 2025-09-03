import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect } from 'react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Wallet, ExternalLink, Copy, RefreshCw } from 'lucide-react';

export function SimpleWalletConnect() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { toast } = useToast();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (connected && publicKey) {
      fetchBalance();
    } else {
      setBalance(null);
    }
  }, [connected, publicKey, connection]);

  const fetchBalance = async () => {
    if (!publicKey) return;
    
    try {
      setLoading(true);
      const lamports = await connection.getBalance(publicKey);
      setBalance(lamports / LAMPORTS_PER_SOL);
    } catch (error) {
      console.error('Error fetching balance:', error);
      toast({
        title: "Balance Error",
        description: "Could not fetch wallet balance",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = async () => {
    if (!publicKey) return;
    
    try {
      await navigator.clipboard.writeText(publicKey.toString());
      toast({
        title: "Copied!",
        description: "Wallet address copied to clipboard"
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Could not copy address to clipboard",
        variant: "destructive"
      });
    }
  };

  const openInExplorer = () => {
    if (!publicKey) return;
    const url = `https://solscan.io/account/${publicKey.toString()}?cluster=devnet`;
    window.open(url, '_blank');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Solana Wallet
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-center">
          <WalletMultiButton className="!bg-primary !text-primary-foreground hover:!bg-primary/90" />
        </div>
        
        {connected && publicKey && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Badge variant="default" className="bg-green-100 text-green-800">
                Connected
              </Badge>
              <Badge variant="secondary">Devnet</Badge>
            </div>

            <div className="p-4 bg-muted rounded-lg space-y-3">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Wallet Address</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono flex-1 break-all">
                    {publicKey.toString()}
                  </code>
                  <Button variant="ghost" size="sm" onClick={copyAddress}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={openInExplorer}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-sm text-muted-foreground mb-1">Balance</div>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">
                    {loading ? "..." : balance?.toFixed(4) || "0.0000"} SOL
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={fetchBalance}
                    disabled={loading}
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!connected && (
          <div className="text-center p-6 text-muted-foreground">
            <p>Connect your Phantom, Solflare, or other Solana wallet to get started</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
