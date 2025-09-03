import { useState, useEffect } from 'react';
import { SolanaService } from '@/services/solana/SolanaService';
import { SolanaAirdropService } from '@/services/solana/SolanaAirdropService';
import { SolanaPointsService } from '@/services/solana/SolanaPointsService';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface SolanaData {
  isEnabled: boolean;
  walletAddress: string | null;
  balance: number;
  isLoading: boolean;
  airdropEligible: boolean;
  pointsEligibility: {
    totalPoints: number;
    eligibleForAirdrop: boolean;
    maxSolAvailable: number;
    pointsNeeded: number;
  };
}

export function useSolana() {
  const { user } = useAuth();
  const [solanaData, setSolanaData] = useState<SolanaData>({
    isEnabled: false,
    walletAddress: null,
    balance: 0,
    isLoading: true,
    airdropEligible: false,
    pointsEligibility: {
      totalPoints: 0,
      eligibleForAirdrop: false,
      maxSolAvailable: 0,
      pointsNeeded: 0
    }
  });

  const solanaService = new SolanaService();
  const airdropService = new SolanaAirdropService();
  const pointsService = new SolanaPointsService();

  useEffect(() => {
    if (user) {
      fetchSolanaData();
      
      // Set up real-time updates
      const channel = supabase
        .channel('solana-updates')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'solana_wallets',
          filter: `user_id=eq.${user.id}`
        }, () => {
          fetchSolanaData();
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'user_points_summary',
          filter: `user_id=eq.${user.id}`
        }, () => {
          fetchSolanaData();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const fetchSolanaData = async () => {
    if (!user) return;

    try {
      console.log('=== FETCH SOLANA DATA DEBUG ===');
      console.log('User ID:', user.id);
      setSolanaData(prev => ({ ...prev, isLoading: true }));

      const [
        isEnabled,
        walletAddress,
        pointsEligibility,
        airdropEligibility
      ] = await Promise.all([
        solanaService.isSolanaEnabled(),
        solanaService.getUserWallet(user.id),
        pointsService.getUserPointsEligibility(user.id),
        airdropService.checkAirdropEligibility(user.id)
      ]);

      console.log('Fetch results:', {
        isEnabled,
        walletAddress,
        pointsEligibility,
        airdropEligibility
      });

      let balance = 0;
      if (walletAddress) {
        balance = await solanaService.getBalance(walletAddress);
        console.log('Wallet balance:', balance);
      } else {
        console.log('No wallet address found');
      }

      setSolanaData({
        isEnabled,
        walletAddress,
        balance,
        isLoading: false,
        airdropEligible: airdropEligibility.eligible,
        pointsEligibility
      });
    } catch (error) {
      console.error('Error fetching Solana data:', error);
      setSolanaData(prev => ({ ...prev, isLoading: false }));
    }
  };

  const generateWallet = async (): Promise<{ success: boolean; error?: string }> => {
    if (!user) return { success: false, error: 'User not authenticated' };

    try {
      console.log('=== GENERATE WALLET DEBUG ===');
      console.log('User object:', user);
      console.log('User ID:', user.id);
      
      const { publicKey } = await solanaService.generateWallet();
      console.log('Generated public key:', publicKey);
      
      const saved = await solanaService.saveUserWallet(user.id, publicKey);
      console.log('Save result:', saved);
      
      if (saved) {
        await fetchSolanaData();
        return { success: true };
      } else {
        return { success: false, error: 'Failed to save wallet to database' };
      }
    } catch (error) {
      console.error('Error generating wallet:', error);
      return { success: false, error: `Failed to generate wallet: ${error.message}` };
    }
  };

  const requestAirdrop = async (): Promise<{ success: boolean; transactionHash?: string; error?: string }> => {
    if (!user) return { success: false, error: 'User not authenticated' };

    const result = await airdropService.requestAirdrop(user.id);
    if (result.success) {
      await fetchSolanaData(); // Refresh data after successful airdrop
    }
    return result;
  };

  const convertPointsToSol = async (pointsToUse: number): Promise<{ success: boolean; transactionHash?: string; solAmount?: number; error?: string }> => {
    if (!user) return { success: false, error: 'User not authenticated' };

    const result = await pointsService.convertPointsToSol(user.id, pointsToUse);
    if (result.success) {
      await fetchSolanaData(); // Refresh data after successful conversion
    }
    return result;
  };

  return {
    ...solanaData,
    generateWallet,
    requestAirdrop,
    convertPointsToSol,
    refetch: fetchSolanaData
  };
}
