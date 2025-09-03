import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { supabase } from '@/integrations/supabase/client';
import { SolanaNetworkManager } from './SolanaNetworkConfig';

export class SolanaService {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(SolanaNetworkManager.getRpcEndpoint(), 'confirmed');
  }

  /**
   * Check if Solana integration is enabled in configuration
   */
  async isSolanaEnabled(): Promise<boolean> {
    try {
      const configKey = SolanaNetworkManager.isDevnet() ? 'public_devnet_enabled' : 'public_mainnet_enabled';
      const { data } = await supabase
        .from('solana_config')
        .select('config_value')
        .eq('config_key', configKey)
        .single();
      
      return data?.config_value === 'true';
    } catch (error) {
      console.error('Error checking Solana status:', error);
      return false;
    }
  }

  /**
   * Update connection when network changes
   */
  updateConnection(): void {
    this.connection = new Connection(SolanaNetworkManager.getRpcEndpoint(), 'confirmed');
  }

  async getConnection(): Promise<Connection> {
    return this.connection;
  }

  async generateWallet(): Promise<{ publicKey: string }> {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString()
      // Note: We don't store secret keys for security reasons
    };
  }

  async getBalance(publicKey: string): Promise<number> {
    try {
      const pubKey = new PublicKey(publicKey);
      const balance = await this.connection.getBalance(pubKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }

  async saveUserWallet(userId: string, publicKey: string): Promise<boolean> {
    try {
      console.log('=== WALLET SAVE DEBUG ===');
      console.log('User ID:', userId);
      console.log('Public Key:', publicKey);
      console.log('User ID type:', typeof userId);
      
      // First check if user already has a wallet
      const existingWallet = await this.getUserWallet(userId);
      if (existingWallet) {
        console.log('User already has a wallet:', existingWallet);
        return true;
      }
      
      console.log('No existing wallet found, creating new one...');
      
      const { data, error } = await supabase
        .from('solana_wallets')
        .insert({
          user_id: userId,
          public_key: publicKey,
          is_primary: true
        })
        .select()
        .single();

      if (error) {
        console.error('Database error saving wallet:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        return false;
      }

      console.log('Wallet saved successfully:', data);
      return true;
    } catch (error) {
      console.error('Error saving wallet:', error);
      console.error('Error details:', error);
      return false;
    }
  }

  async getUserWallet(userId: string): Promise<string | null> {
    try {
      console.log('=== GET USER WALLET DEBUG ===');
      console.log('Getting wallet for user:', userId);
      console.log('User ID type:', typeof userId);
      
      const { data, error } = await supabase
        .from('solana_wallets')
        .select('public_key')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .maybeSingle();

      if (error) {
        console.error('Error getting user wallet:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        return null;
      }

      console.log('Retrieved wallet data:', data);
      
      if (!data) {
        console.log('No wallet found, checking all wallets for user...');
        const { data: allWallets } = await supabase
          .from('solana_wallets')
          .select('*')
          .eq('user_id', userId);
        console.log('All user wallets:', allWallets);
      }
      
      return data?.public_key || null;
    } catch (error) {
      console.error('Error getting user wallet:', error);
      return null;
    }
  }

  async validatePublicKey(publicKey: string): Promise<boolean> {
    try {
      new PublicKey(publicKey);
      return true;
    } catch {
      return false;
    }
  }
}
