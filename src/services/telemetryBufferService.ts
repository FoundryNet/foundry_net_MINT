import { supabase } from '@/integrations/supabase/client';
import { TelemetryData } from './octoPrintService';

interface BufferedTelemetry {
  machineId: string;
  data: TelemetryData;
  timestamp: Date;
  attempts: number;
  validation?: any;
}

interface DataIntegrityCheck {
  isValid: boolean;
  issues: string[];
  quality: number;
}

class TelemetryBufferService {
  private buffer = new Map<string, BufferedTelemetry[]>();
  private readonly MAX_BUFFER_SIZE = 1000;
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL = 30000; // 30 seconds
  private flushTimer?: NodeJS.Timeout;

  constructor() {
    this.startPeriodicFlush();
  }

  // Buffer telemetry data when connection is unavailable
  bufferTelemetry(machineId: string, data: TelemetryData, validation?: any) {
    if (!this.buffer.has(machineId)) {
      this.buffer.set(machineId, []);
    }

    const machineBuffer = this.buffer.get(machineId)!;
    
    // Check buffer size and remove oldest entries if needed
    if (machineBuffer.length >= this.MAX_BUFFER_SIZE) {
      machineBuffer.shift(); // Remove oldest
      console.warn(`Buffer overflow for machine ${machineId}, removing oldest entry`);
    }

    // Add new entry
    machineBuffer.push({
      machineId,
      data,
      timestamp: new Date(),
      attempts: 0,
      validation
    });

    console.log(`Buffered telemetry for machine ${machineId}, buffer size: ${machineBuffer.length}`);
  }

  // Flush buffered data to database
  async flushBuffer(machineId?: string): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    const machinesToFlush = machineId ? [machineId] : Array.from(this.buffer.keys());

    for (const mid of machinesToFlush) {
      const machineBuffer = this.buffer.get(mid);
      if (!machineBuffer || machineBuffer.length === 0) continue;

      // Process in batches
      const batches = this.createBatches(machineBuffer, this.BATCH_SIZE);
      
      for (const batch of batches) {
        const result = await this.processBatch(mid, batch);
        success += result.success;
        failed += result.failed;

        // Remove successfully processed items
        const processedItems = batch.slice(0, result.success);
        this.removeFromBuffer(mid, processedItems);
      }
    }

    console.log(`Flush complete: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  private async processBatch(machineId: string, batch: BufferedTelemetry[]): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const item of batch) {
      try {
        // Validate data integrity before sending
        const integrityCheck = this.checkDataIntegrity(item.data);
        if (!integrityCheck.isValid) {
          console.warn(`Data integrity issues for machine ${machineId}:`, integrityCheck.issues);
          failed++;
          continue;
        }

        // Attempt to save to database
        const { error } = await supabase.from('telemetry_data').insert({
          machine_id: machineId,
          data: item.data as any,
          timestamp: item.data.timestamp,
          sync_status: 'buffered',
          offline_duration: Math.floor((new Date().getTime() - new Date(item.timestamp).getTime()) / 1000),
          processed_metrics: {
            dataQuality: integrityCheck.quality,
            buffered: true,
            attempts: item.attempts + 1,
            validation_score: item.validation?.anomaly_score || 0,
            validation_flags: item.validation?.flags || []
          } as any
        });

        if (error) {
          item.attempts++;
          if (item.attempts >= this.MAX_RETRY_ATTEMPTS) {
            console.error(`Max retry attempts reached for machine ${machineId}:`, error);
            failed++;
          } else {
            // Will retry in next batch
            console.warn(`Retry attempt ${item.attempts} for machine ${machineId}:`, error);
          }
        } else {
          success++;
          
          // Award buffered data points (reduced rate)
          await this.awardBufferedPoints(machineId, item.data, item.validation);
        }
      } catch (error) {
        console.error(`Error processing buffered telemetry for machine ${machineId}:`, error);
        failed++;
      }
    }

    return { success, failed };
  }

  private checkDataIntegrity(data: TelemetryData): DataIntegrityCheck {
    const issues: string[] = [];
    let quality = 100;

    // Check for null/undefined values
    if (!data.timestamp) {
      issues.push('Missing timestamp');
      quality -= 30;
    }

    // Check temperature data
    if (data.temperature.bed.actual < 0 || data.temperature.bed.actual > 200) {
      issues.push('Invalid bed temperature');
      quality -= 20;
    }

    if (data.temperature.hotend.actual < 0 || data.temperature.hotend.actual > 500) {
      issues.push('Invalid hotend temperature');
      quality -= 20;
    }

    // Check progress data
    if (data.progress.completion < 0 || data.progress.completion > 100) {
      issues.push('Invalid progress percentage');
      quality -= 15;
    }

    // Check for suspicious patterns
    if (data.feedRate <= 0 || data.feedRate > 500) {
      issues.push('Suspicious feed rate');
      quality -= 10;
    }

    if (data.flowRate <= 0 || data.flowRate > 500) {
      issues.push('Suspicious flow rate');
      quality -= 10;
    }

    return {
      isValid: issues.length === 0 || quality > 50,
      issues,
      quality: Math.max(0, quality)
    };
  }

  private async awardBufferedPoints(machineId: string, data: TelemetryData, validation?: any) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('No authenticated user, skipping buffered points award');
        return;
      }

      // Calculate MINT reward for buffered data
      const baseReward = 0.003; // Reduced MINT for buffered data
      const validationMultiplier = validation?.points_multiplier || 0.8;
      const mintReward = baseReward * validationMultiplier * 0.5; // 50% for buffered data

      if (mintReward > 0) {
        // Award MINT tokens for buffered telemetry
        await supabase.rpc('award_mint_tokens', {
          p_user_id: user.id,
          p_mint_amount: mintReward,
          p_activity_type: 'buffered_telemetry'
        });
      }
    } catch (error) {
      console.error('Failed to award buffered points:', error);
    }
  }

  private generateValidationHash(data: TelemetryData): string {
    const hashInput = `buffered-${data.timestamp}-${data.temperature.hotend.actual}`;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  private removeFromBuffer(machineId: string, itemsToRemove: BufferedTelemetry[]) {
    const machineBuffer = this.buffer.get(machineId);
    if (!machineBuffer) return;

    itemsToRemove.forEach(item => {
      const index = machineBuffer.indexOf(item);
      if (index > -1) {
        machineBuffer.splice(index, 1);
      }
    });
  }

  private startPeriodicFlush() {
    this.flushTimer = setInterval(async () => {
      try {
        await this.flushBuffer();
      } catch (error) {
        console.error('Error during periodic flush:', error);
      }
    }, this.FLUSH_INTERVAL);
  }

  // Get buffer statistics
  getBufferStats(): { [machineId: string]: { size: number; oldestEntry?: Date } } {
    const stats: { [machineId: string]: { size: number; oldestEntry?: Date } } = {};
    
    this.buffer.forEach((buffer, machineId) => {
      stats[machineId] = {
        size: buffer.length,
        oldestEntry: buffer.length > 0 ? buffer[0].timestamp : undefined
      };
    });

    return stats;
  }

  // Clear buffer for a specific machine
  clearBuffer(machineId: string) {
    this.buffer.delete(machineId);
  }

  // Get total buffered items across all machines
  getTotalBuffered(): number {
    let total = 0;
    this.buffer.forEach(buffer => {
      total += buffer.length;
    });
    return total;
  }

  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }
}

export const telemetryBufferService = new TelemetryBufferService();
