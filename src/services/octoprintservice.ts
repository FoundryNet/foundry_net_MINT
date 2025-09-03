import { supabase } from '@/integrations/supabase/client';
import { mintService } from './mintService';

export interface TelemetryData {
  printer_state: string;
  temperature_hotend: number;
  temperature_bed: number;
  print_progress: number;
  filename?: string;
  [key: string]: any;
}

export interface OctoPrintConfig {
  url: string;
  apiKey: string;
  host?: string;
  port?: number;
  ssl?: boolean;
}

export class OctoPrintService {
  private machineId: string;
  private connectionInterval: NodeJS.Timeout | null = null;
  public isConnected = false;
  private octoPrintUrl: string;
  private apiKey: string;
  private customMintReward: number;
  public onData?: (data: TelemetryData) => void;
  public onStatus?: (status: any) => void;
  private lastPrintState: string = '';
  private lastProgress: number = 0;

  constructor(machineId?: string, octoPrintUrl?: string, apiKey?: string, customMintReward?: number) {
    this.machineId = machineId || 'default-machine';
    this.octoPrintUrl = (octoPrintUrl || 'http://localhost:5000').replace(/\/$/, '');
    this.apiKey = apiKey || 'default-api-key';
    this.customMintReward = customMintReward || 1.0;
  }

  async connect(): Promise<boolean> {
    try {
      console.log('🔌 Connecting to OctoPrint:', this.octoPrintUrl);
      
      // Test connection
      const isReachable = await this.testConnection();
      if (!isReachable) {
        console.error('❌ Failed to connect to OctoPrint');
        return false;
      }

      this.isConnected = true;
      console.log('✅ Connected to OctoPrint successfully');

      // Start data collection
      this.startDataCollection();
      return true;

    } catch (error) {
      console.error('❌ Error connecting to OctoPrint:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    if (this.connectionInterval) {
      clearInterval(this.connectionInterval);
      this.connectionInterval = null;
    }
    console.log('🔌 Disconnected from OctoPrint');
  }

  private async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.octoPrintUrl}/api/connection`, {
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      return response.ok;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  private startDataCollection(): void {
    // Collect data every 30 seconds
    this.connectionInterval = setInterval(async () => {
      if (this.isConnected) {
        await this.collectTelemetryData();
      }
    }, 30000);

    // Initial collection
    this.collectTelemetryData();
  }

  private async collectTelemetryData(): Promise<void> {
    try {
      const [printerData, jobData] = await Promise.all([
        this.fetchPrinterStatus(),
        this.fetchJobInformation()
      ]);

      if (!printerData) {
        console.warn('⚠️ No printer data received');
        return;
      }

      const telemetryData = this.combineTelemetryData(printerData, jobData);
      
      // Call onData callback if set
      if (this.onData) {
        this.onData(telemetryData);
      }
      
      // Store in database
      await this.storeTelemetryData(telemetryData);
      
      // Award MINT for telemetry
      await this.awardTelemetryMint(telemetryData);

      console.log('📊 Telemetry data collected and stored');

    } catch (error) {
      console.error('❌ Error collecting telemetry data:', error);
    }
  }

  private async fetchPrinterStatus(): Promise<any | null> {
    try {
      const response = await fetch(`${this.octoPrintUrl}/api/printer`, {
        headers: {
          'X-Api-Key': this.apiKey
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch printer status:', error);
      return null;
    }
  }

  private async fetchJobInformation(): Promise<any | null> {
    try {
      const response = await fetch(`${this.octoPrintUrl}/api/job`, {
        headers: {
          'X-Api-Key': this.apiKey
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to fetch job information:', error);
      return null;
    }
  }

  private combineTelemetryData(printerData: any, jobData: any): TelemetryData {
    const hotendTemp = printerData?.temperature?.tool0?.actual || 0;
    const bedTemp = printerData?.temperature?.bed?.actual || 0;
    const state = printerData?.state?.text || 'Unknown';
    
    let progress = 0;
    let filename = 'None';
    
    if (jobData?.progress) {
      progress = Math.round(jobData.progress.completion || 0);
    }
    
    if (jobData?.job?.file?.name) {
      filename = jobData.job.file.name;
    }

    return {
      printer_state: state,
      temperature_hotend: Math.round(hotendTemp),
      temperature_bed: Math.round(bedTemp),
      print_progress: progress,
      filename: filename,
      timestamp: new Date().toISOString(),
      raw_printer_data: printerData,
      raw_job_data: jobData
    };
  }

  private async storeTelemetryData(data: TelemetryData): Promise<void> {
    try {
      const { error } = await supabase
        .from('telemetry_data')
        .insert({
          machine_id: this.machineId,
          data: data,
          timestamp: new Date().toISOString()
        });

      if (error) {
        console.error('❌ Failed to store telemetry data:', error);
      }
    } catch (error) {
      console.error('❌ Error storing telemetry data:', error);
    }
  }

  private async awardTelemetryMint(data: TelemetryData): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('No authenticated user, skipping MINT reward');
        return;
      }

      // REAL JOB COMPLETION DETECTION
      const currentState = data.printer_state;
      const currentProgress = data.print_progress;

      // Detect job completion: was printing and now operational/ready + progress was >0
      if (this.lastPrintState === 'Printing' && 
          (currentState === 'Operational' || currentState === 'Ready') && 
          this.lastProgress > 0) {
        
        console.log(`🎉 PRINT JOB COMPLETED! Awarding ${this.customMintReward} MINT tokens to wallet...`);
        
        // Award MINT directly to the wallet linked to this machine
        const { data: result, error } = await supabase.rpc('award_mint_to_wallet', {
          p_user_id: user.id,
          p_machine_id: this.machineId,
          p_mint_amount: this.customMintReward, // Use custom reward amount
          p_activity_type: 'print_job_completed'
        });
        
        if (result && typeof result === 'object' && 'success' in result && result.success) {
          console.log(`🎁 Awarded ${this.customMintReward} MINT to wallet ${(result as any).wallet_address} for completed print job!`);
        } else {
          console.error('Failed to award MINT:', error || (result as any)?.error);
        }
      }

      // Update tracking variables
      this.lastPrintState = currentState;
      this.lastProgress = currentProgress;

    } catch (error) {
      console.error('Error awarding MINT for telemetry:', error);
    }
  }

  getConnectionStatus(): { connected: boolean; machineId: string; url: string } {
    return {
      connected: this.isConnected,
      machineId: this.machineId,
      url: this.octoPrintUrl
    };
  }

  async sendGcode(command: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.octoPrintUrl}/api/printer/command`, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: command
        })
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to send G-code:', error);
      return false;
    }
  }
}
