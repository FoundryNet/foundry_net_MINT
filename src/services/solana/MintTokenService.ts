import { supabase } from '@/integrations/supabase/client';
import { mintTokenService } from './solana/MintTokenService';

/**
 * Simplified MINT token service for core loop testing
 * 1 MINT per job completion - no multipliers or bonuses
 */
export class MintService {
  
  /**
   * Award MINT tokens directly to user for activities
   */
  async awardMintTokens(
    userId: string, 
    mintAmount: number, 
    activityType: string,
    machineId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Use the mintTokenService for actual token minting
      const result = await mintTokenService.awardMintForActivity(
        userId, 
        mintAmount, 
        activityType, 
        machineId
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Update local database balance
      await supabase.rpc('award_mint_tokens', {
        p_user_id: userId,
        p_mint_amount: mintAmount,
        p_activity_type: activityType
      });

      return { success: true };
    } catch (error) {
      console.error('Error awarding MINT tokens:', error);
      return { success: false, error: 'Failed to award MINT tokens' };
    }
  }

  /**
   * Get user's current MINT balance
   */
  async getUserMintBalance(userId: string): Promise<{
    mint_balance: number;
    total_mint_earned: number;
    tokens_eligible: number;
  }> {
    const { data, error } = await supabase
      .from('user_points_summary')
      .select('mint_balance, total_mint_earned, tokens_eligible')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching MINT balance:', error);
      throw error;
    }

    return {
      mint_balance: data?.mint_balance || 0,
      total_mint_earned: data?.total_mint_earned || 0,
      tokens_eligible: data?.tokens_eligible || 0
    };
  }

  /**
   * Calculate MINT reward - simplified for core loop testing
   */
  calculateMintReward(activityType: string): number {
    switch (activityType) {
      case 'job_completion_success':
        // Simple flat rate: 3 MINT per completed job
        return 3.0;
      
      default:
        // No rewards for other activities
        return 0;
    }
  }
}

export const mintService = new MintService();
