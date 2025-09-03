import { supabase } from '@/integrations/supabase/client';
import { mintService } from './mintService';

export class SimpleTelemetryService {
  private machineId: string;
  private collectionInterval: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(machineId: string) {
    this.machineId = machineId;
  }

  async startCollection(): Promise<void> {
    if (this.isConnected) {
      console.log('Telemetry collection already running');
      return;
    }

    this.isConnected = true;
    console.log('🚀 Starting simplified telemetry collection for machine:', this.machineId);

    // Collect telemetry every 30 seconds
    this.collectionInterval = setInterval(async () => {
      await this.collectTelemetryData();
    }, 30000);

    // Initial collection
    await this.collectTelemetryData();
  }

  async stopCollection(): Promise<void> {
    if (!this.isConnected) return;

    this.isConnected = false;
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    console.log('⏹️ Stopped telemetry collection for machine:', this.machineId);
  }

  private async collectTelemetryData(): Promise<void> {
    try {
      const mockData = this.generateMockTelemetryData();
      
      // Store telemetry data
      const { error: telemetryError } = await supabase
        .from('telemetry_data')
        .insert({
          machine_id: this.machineId,
          data: mockData,
          timestamp: new Date().toISOString()
        });

      if (telemetryError) {
        console.error('Error storing telemetry:', telemetryError);
        return;
      }

      // Award MINT tokens for telemetry submission
      await this.awardTelemetryReward(mockData);

    } catch (error) {
      console.error('Error in telemetry collection:', error);
    }
  }

  private async awardTelemetryReward(data: any): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('No authenticated user, skipping MINT reward');
        return;
      }

      // Calculate MINT reward based on telemetry quality
      let mintReward = 0.01; // Base 0.01 MINT for telemetry

      // Bonus for printing activity
      if (data.printer_state === 'Printing') {
        mintReward += 0.02; // Extra reward for active printing
      }
      
      // Bonus for heated operation
      if (data.temperature_hotend > 180) {
        mintReward += 0.01; // Bonus for hot operation
      }

      if (mintReward > 0) {
        await supabase.rpc('award_mint_tokens', {
          p_user_id: user.id,
          p_mint_amount: mintReward,
          p_activity_type: 'simple_telemetry'
        });
        
        console.log(`🎁 Awarded ${mintReward} MINT for telemetry`);
      }

    } catch (error) {
      console.error('Error awarding telemetry reward:', error);
    }
  }

  private generateMockTelemetryData(): any {
    return {
      temperature_hotend: Math.round(200 + (Math.random() - 0.5) * 10),
      temperature_bed: Math.round(60 + (Math.random() - 0.5) * 5),
      printer_state: Math.random() > 0.7 ? 'Printing' : 'Operational',
      print_progress: Math.round(Math.random() * 100),
      timestamp: new Date().toISOString(),
      machine_id: this.machineId
    };
  }

  getStatus(): { connected: boolean; machineId: string } {
    return {
      connected: this.isConnected,
      machineId: this.machineId
    };
  }
}
