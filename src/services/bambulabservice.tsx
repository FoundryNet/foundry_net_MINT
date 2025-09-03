import mqtt from 'mqtt';
import { supabase } from '@/integrations/supabase/client';

export interface BambuLabsConfig {
  host: string;
  accessKey: string;
  ssl: boolean;
}

export interface BambuTelemetryData {
  temperature: {
    bed: { actual: number; target: number };
    hotend: { actual: number; target: number };
  };
  progress: {
    completion: number;
    printTime: number;
    printTimeLeft: number;
  };
  status: string;
  feedRate: number;
  flowRate: number;
  timestamp: string;
}

export class BambuLabsService {
  private client: mqtt.MqttClient | null = null;
  private machineId: string;
  private config: BambuLabsConfig;
  private dataCallback?: (data: BambuTelemetryData) => void;
  private statusCallback?: (status: string) => void;
  private isConnected = false;
  private lastJobState = '';
  private customMintReward: number;

  constructor(machineId: string, host: string, accessKey: string, customMintReward?: number) {
    this.machineId = machineId;
    this.config = {
      host,
      accessKey,
      ssl: true
    };
    this.customMintReward = customMintReward || 1.0;
  }

  async connect(): Promise<boolean> {
    try {
      const mqttUrl = `mqtts://${this.config.host}:8883`;
      
      this.client = mqtt.connect(mqttUrl, {
        username: 'bblp',
        password: this.config.accessKey,
        protocol: 'mqtts',
        rejectUnauthorized: false,
        connectTimeout: 10000,
        reconnectPeriod: 5000
      });

      return new Promise((resolve) => {
        if (!this.client) {
          resolve(false);
          return;
        }

        this.client.on('connect', () => {
          console.log('Connected to Bambu Labs printer via MQTT');
          this.isConnected = true;
          this.subscribeToTopics();
          resolve(true);
        });

        this.client.on('error', (error) => {
          console.error('MQTT connection error:', error);
          this.isConnected = false;
          resolve(false);
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

        this.client.on('close', () => {
          console.log('MQTT connection closed');
          this.isConnected = false;
          this.statusCallback?.('disconnected');
        });
      });
    } catch (error) {
      console.error('Failed to connect to Bambu Labs printer:', error);
      return false;
    }
  }

  private subscribeToTopics(): void {
    if (!this.client) return;

    // Subscribe to printer status and telemetry
    this.client.subscribe('device/+/report', (err) => {
      if (err) {
        console.error('Failed to subscribe to printer reports:', err);
      }
    });
  }

  private async handleMessage(topic: string, message: Buffer): Promise<void> {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.print && data.print.gcode_state) {
        const currentJobState = data.print.gcode_state;
        
        // Detect job completion
        if (this.lastJobState === 'RUNNING' && currentJobState === 'FINISH') {
          console.log('🎉 BAMBU PRINT JOB COMPLETED! Triggering MINT reward...');
          this.statusCallback?.('job_completed');
          
          // Award MINT tokens for job completion
          await this.awardJobCompletionMint();
        }
        
        this.lastJobState = currentJobState;
      }

      // Parse telemetry data
      const telemetryData = this.parseTelemetryData(data);
      if (telemetryData) {
        this.dataCallback?.(telemetryData);
      }

    } catch (error) {
      console.error('Error parsing MQTT message:', error);
    }
  }

  private parseTelemetryData(data: any): BambuTelemetryData | null {
    try {
      // Extract temperature data
      const bedTemp = data.print?.bed_temper || 0;
      const bedTarget = data.print?.bed_target_temper || 0;
      const hotendTemp = data.print?.nozzle_temper || 0;
      const hotendTarget = data.print?.nozzle_target_temper || 0;

      // Extract progress data
      const progress = data.print?.mc_percent || 0;
      const printTime = data.print?.mc_remaining_time || 0;
      const printTimeLeft = data.print?.mc_remaining_time || 0;

      // Extract status
      const status = data.print?.gcode_state || 'IDLE';

      return {
        temperature: {
          bed: { actual: bedTemp, target: bedTarget },
          hotend: { actual: hotendTemp, target: hotendTarget }
        },
        progress: {
          completion: progress,
          printTime: printTime,
          printTimeLeft: printTimeLeft
        },
        status: status,
        feedRate: data.print?.spd_lvl || 100,
        flowRate: data.print?.spd_mag || 100,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error parsing telemetry data:', error);
      return null;
    }
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.isConnected = false;
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  onData(callback: (data: BambuTelemetryData) => void): void {
    this.dataCallback = callback;
  }

  onStatus(callback: (status: string) => void): void {
    this.statusCallback = callback;
  }

  private async awardJobCompletionMint(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('No authenticated user, skipping MINT reward');
        return;
      }

      console.log(`🎁 Awarding ${this.customMintReward} MINT tokens for Bambu job completion...`);
      
      // Award MINT directly to the wallet linked to this machine
      const { data: result, error } = await supabase.rpc('award_mint_to_wallet', {
        p_user_id: user.id,
        p_machine_id: this.machineId,
        p_mint_amount: this.customMintReward,
        p_activity_type: 'bambu_print_job_completed'
      });
      
      if (result && typeof result === 'object' && 'success' in result && result.success) {
        console.log(`🎉 Successfully awarded ${this.customMintReward} MINT to wallet ${(result as any).wallet_address} for Bambu print completion!`);
      } else {
        console.error('Failed to award MINT for Bambu job completion:', error || (result as any)?.error);
      }

    } catch (error) {
      console.error('Error awarding MINT for Bambu job completion:', error);
    }
  }
}
