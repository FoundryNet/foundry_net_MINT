import { OctoPrintService, TelemetryData as OctoPrintTelemetryData } from './octoPrintService';
import { BambuLabsService, BambuTelemetryData } from './bambuLabsService';

// Common telemetry data interface
export interface TelemetryData {
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

export interface PrinterConfig {
  host: string;
  port: number;
  apiKey?: string;
  accessKey?: string;
  ssl: boolean;
}

export interface PrinterService {
  connect(machineId: string, config: PrinterConfig): Promise<boolean>;
  disconnect(): void;
  isConnected(): boolean;
  onData(callback: (data: TelemetryData) => void): void;
  onStatus(callback: (status: string) => void): void;
}

export class PrinterServiceFactory {
  static createService(connectionType: string, machineId: string = '', host: string = '', apiKeyOrAccessKey: string = '', customMintReward: number = 1.0): PrinterService {
    if (connectionType === 'octoprint_api') {
      return new OctoPrintService(machineId, `http://${host}`, apiKeyOrAccessKey, customMintReward) as unknown as PrinterService;
    }
    if (connectionType === 'bambu_mqtt') {
      return new BambuLabsService(machineId, host, apiKeyOrAccessKey, customMintReward) as unknown as PrinterService;
    }
    throw new Error(`Unsupported connection type: ${connectionType}`);
  }
  
  static getSupportedTypes(): Array<{ value: string; label: string; description: string }> {
    return [
      {
        value: 'octoprint_api',
        label: 'OctoPrint API',
        description: 'Standard OctoPrint installation with WebSocket support'
      },
      {
        value: 'bambu_mqtt',
        label: 'Bambu Labs MQTT',
        description: 'Bambu Labs X1 Carbon via local MQTT connection'
      }
    ];
  }
  
  static getConnectionTypeInfo(connectionType: string) {
    const types = this.getSupportedTypes();
    return types.find(type => type.value === connectionType) || types[0];
  }
  
  static getDefaultPort(connectionType: string): number {
    if (connectionType === 'bambu_mqtt') return 8883;
    return 80;
  }
  
  static isApiKeyRequired(connectionType: string): boolean {
    return true;
  }
  
  static isAccessKeyRequired(connectionType: string): boolean {
    return connectionType === 'bambu_mqtt';
  }
}

// Export services for direct use if needed
export { OctoPrintService, BambuLabsService };
export type { OctoPrintTelemetryData, BambuTelemetryData };
