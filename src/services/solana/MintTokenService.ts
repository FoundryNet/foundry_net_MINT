import { supabase } from '@/integrations/supabase/client';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createMintToInstruction, getMint } from '@solana/spl-token';

interface TokenConfig {
  mint_address: string;
  symbol: string;
  name: string;
  decimals: number;
  enabled: boolean;
  conversion_rate: number;
  max_daily_mint: number;
  description?: string;
}

export class MintTokenService {
  private connection: Connection;
  private tokenConfig: TokenConfig | null = null;

  constructor() {
    // Connect to devnet by default
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  }

  async getTokenConfig(): Promise<TokenConfig | null> {
    if (this.tokenConfig) return this.tokenConfig;

    try {
      const { data, error } = await supabase
        .from('solana_config')
        .select('config_value')
        .eq('config_key', 'mint_token_config')
        .single();

      if (error || !data) {
        console.warn('No MINT token configuration found');
        return null;
      }

      this.tokenConfig = data.config_value as unknown as TokenConfig;
      return this.tokenConfig;
    } catch (error) {
      console.error('Error loading token config:', error);
      return null;
    }
  }

  async isTokenEnabled(): Promise<boolean> {
    const config = await this.getTokenConfig();
    return config?.enabled || false;
  }

  async getMintAddress(): Promise<string | null> {
    const config = await this.getTokenConfig();
    return config?.mint_address || null;
  }

  async getTokenDetails(): Promise<{ 
    symbol: string; 
    name: string; 
    decimals: number; 
    conversionRate: number; 
  } | null> {
    const config = await this.getTokenConfig();
    if (!config) return null;

    return {
      symbol: config.symbol,
      name: config.name,
      decimals: config.decimals,
      conversionRate: config.conversion_rate
    };
  }

  async validateMintAddress(mintAddress: string): Promise<boolean> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      const mintInfo = await getMint(this.connection, mintPubkey);
      return mintInfo !== null;
    } catch (error) {
      console.error('Error validating mint address:', error);
      return false;
    }
  }

  async getTokenBalance(walletAddress: string, mintAddress?: string): Promise<number> {
    try {
      const mint = mintAddress || await this.getMintAddress();
      if (!mint || !walletAddress) return 0;

      const walletPubkey = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(mint);
      
      const associatedTokenAddress = await getAssociatedTokenAddress(
        mintPubkey,
        walletPubkey
      );

      const balance = await this.connection.getTokenAccountBalance(associatedTokenAddress);
      return balance.value.uiAmount || 0;
    } catch (error) {
      console.warn('Could not fetch token balance:', error);
      return 0;
    }
  }

  // Convert legacy points to MINT tokens
  pointsToMint(points: number): number {
    const config = this.tokenConfig;
    if (!config) return 0;
    return points / config.conversion_rate; // e.g., 1000 points = 1 MINT
  }

  // Convert MINT tokens to points
  mintToPoints(mintAmount: number): number {
    const config = this.tokenConfig;
    if (!config) return 0;
    return mintAmount * config.conversion_rate;
  }

  // Format MINT display from points
  formatPointsAsMint(points: number): string {
    const mint = this.pointsToMint(points);
    return `${mint.toFixed(2)} MINT`;
  }

  // Check if user can receive daily mint allocation
  async checkDailyMintEligibility(userId: string): Promise<{
    eligible: boolean;
    remainingMint: number;
    maxDaily: number;
  }> {
    const config = await this.getTokenConfig();
    if (!config || !config.enabled) {
      return { eligible: false, remainingMint: 0, maxDaily: 0 };
    }

    try {
      // Check today's mints for the user
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { data, error } = await supabase
        .from('solana_transactions')
        .select('amount_sol')
        .eq('user_id', userId)
        .eq('transaction_type', 'mint_reward')
        .gte('created_at', today.toISOString());

      if (error) {
        console.error('Error checking daily mint eligibility:', error);
        return { eligible: false, remainingMint: 0, maxDaily: config.max_daily_mint };
      }

      const todaysMint = data.reduce((sum, tx) => sum + (tx.amount_sol || 0), 0);
      const remainingMint = Math.max(0, config.max_daily_mint - todaysMint);

      return {
        eligible: remainingMint > 0,
        remainingMint,
        maxDaily: config.max_daily_mint
      };
    } catch (error) {
      console.error('Error checking daily mint eligibility:', error);
      return { eligible: false, remainingMint: 0, maxDaily: config.max_daily_mint };
    }
  }

  // Award MINT tokens for job completion (called from enhanced points service)
  async awardMintForActivity(
    userId: string, 
    mintAmount: number, 
    activityType: string,
    machineId?: string
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    try {
      const config = await this.getTokenConfig();
      if (!config || !config.enabled) {
        return { success: false, error: 'MINT token system is disabled' };
      }

      // Check daily limits
      const eligibility = await this.checkDailyMintEligibility(userId);
      if (!eligibility.eligible || mintAmount > eligibility.remainingMint) {
        return { 
          success: false, 
          error: `Daily mint limit reached. Remaining: ${eligibility.remainingMint} MINT` 
        };
      }

      // Get user's Solana wallet
      const { data: wallet } = await supabase
        .from('solana_wallets')
        .select('public_key')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .single();

      if (!wallet) {
        return { success: false, error: 'No Solana wallet found for user' };
      }

      // Call the solana-mint edge function to perform the actual minting
      const { data, error } = await supabase.functions.invoke('solana-mint', {
        body: {
          recipientAddress: wallet.public_key,
          mintAmount,
          mintAddress: config.mint_address,
          activityType,
          machineId
        }
      });

      if (error) {
        console.error('MINT edge function error:', error);
        return { success: false, error: 'Failed to mint tokens' };
      }

      // Record the transaction
      await supabase.from('solana_transactions').insert({
        user_id: userId,
        wallet_id: wallet.public_key,
        amount_sol: mintAmount,
        points_used: this.mintToPoints(mintAmount),
        transaction_hash: data.transactionHash || 'pending',
        transaction_type: 'mint_reward',
        status: 'completed',
        metadata: {
          activity_type: activityType,
          machine_id: machineId,
          mint_address: config.mint_address
        }
      });

      return {
        success: true,
        transactionHash: data.transactionHash
      };
    } catch (error) {
      console.error('Error awarding MINT tokens:', error);
      return { success: false, error: 'Unexpected error during token minting' };
    }
  }
}

export const mintTokenService = new MintTokenService();
