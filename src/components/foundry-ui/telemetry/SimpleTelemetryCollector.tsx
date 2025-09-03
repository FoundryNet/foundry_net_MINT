import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { Play, Pause, Activity, Thermometer, Eye, EyeOff } from 'lucide-react';
import { OctoPrintService } from '@/services/octoPrintService';
import { BambuLabsService } from '@/services/bambuLabsService';
import { PrinterServiceFactory } from '@/services/printerServiceFactory';

interface TelemetryPoint {
  timestamp: string;
  bedTemp: number;
  hotendTemp: number;
  progress: number;
  printerState: string;
}

interface MachineInfo {
  uuid: string;
  model: string;
  serial?: string;
  autoDetected: boolean;
}

interface ConnectionData {
  host: string;
  port: number;
  apiKey: string;
  accessKey: string;
  connectionType: string;
}

export function SimpleTelemetryCollector() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [isCollecting, setIsCollecting] = useState(false);
  const [connectionData, setConnectionData] = useState<ConnectionData>({
    host: 'octopi.local',
    port: 80,
    apiKey: '',
    accessKey: '',
    connectionType: 'octoprint_api'
  });
  const [telemetryData, setTelemetryData] = useState<TelemetryPoint[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>('Ready');
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [printerService, setPrinterService] = useState<OctoPrintService | BambuLabsService | null>(null);
  const [mintRewardAmount, setMintRewardAmount] = useState<number>(1.0);

  const supportedTypes = PrinterServiceFactory.getSupportedTypes();

  // Auto-detect machine based on connection type
  const autoDetectMachine = async (): Promise<MachineInfo> => {
    if (connectionData.connectionType === 'bambu_mqtt') {
      return {
        uuid: `bambu-${Date.now()}`,
        model: 'Bambu Labs X1 Carbon',
        serial: 'Unknown',
        autoDetected: true
      };
    }
    
    // OctoPrint auto-detection
    const baseUrl = `http://${connectionData.host}:${connectionData.port}`;
    
    try {
      const response = await fetch(`${baseUrl}/api/printer`, {
        headers: { 'X-Api-Key': connectionData.apiKey }
      });
      
      if (!response.ok) throw new Error('Failed to connect to OctoPrint');
      
      const printerData = await response.json();
      
      return {
        uuid: `octoprint-${Date.now()}`,
        model: 'OctoPrint Machine',
        serial: printerData.serial || 'Unknown',
        autoDetected: true
      };
    } catch (error) {
      console.error('Auto-detection failed:', error);
      return {
        uuid: `octoprint-${Date.now()}`,
        model: 'OctoPrint Machine',
        autoDetected: false
      };
    }
  };

  // Start telemetry collection
  const startCollection = async () => {
    const isOctoPrint = connectionData.connectionType === 'octoprint_api';
    const isBambu = connectionData.connectionType === 'bambu_mqtt';
    
    if (isOctoPrint && (!connectionData.host || !connectionData.apiKey)) {
      toast({
        title: "Missing Configuration",
        description: "Please provide host and API key for OctoPrint",
        variant: "destructive"
      });
      return;
    }
    
    if (isBambu && (!connectionData.host || !connectionData.accessKey)) {
      toast({
        title: "Missing Configuration", 
        description: "Please provide printer IP and access key for Bambu Labs",
        variant: "destructive"
      });
      return;
    }

    try {
      setCurrentStatus('Connecting...');
      
      // Auto-detect machine info
      const detectedMachine = await autoDetectMachine();
      setMachineInfo(detectedMachine);

      let service: OctoPrintService | BambuLabsService;

      if (isOctoPrint) {
        // Create OctoPrint service
        service = new OctoPrintService(
          detectedMachine.uuid, 
          `http://${connectionData.host}:${connectionData.port}`, 
          connectionData.apiKey,
          mintRewardAmount
        );
      } else {
        // Create Bambu Labs service
        service = new BambuLabsService(
          detectedMachine.uuid,
          connectionData.host,
          connectionData.accessKey,
          mintRewardAmount
        );
      }

      const connected = await service.connect();

      if (!connected) {
        throw new Error(`Failed to connect to ${isOctoPrint ? 'OctoPrint' : 'Bambu Labs printer'}`);
      }

      // Set up data callbacks
      if (isOctoPrint) {
        const octoPrintService = service as OctoPrintService;
        octoPrintService.onData = (data) => {
          const telemetryPoint: TelemetryPoint = {
            timestamp: new Date().toISOString(),
            bedTemp: data.temperature_bed || 0,
            hotendTemp: data.temperature_hotend || 0,
            progress: data.print_progress || 0,
            printerState: data.printer_state || 'unknown'
          };
          
          setTelemetryData(prev => [...prev.slice(-50), telemetryPoint]);
        };
      } else {
        const bambuService = service as BambuLabsService;
        bambuService.onData((data) => {
          const telemetryPoint: TelemetryPoint = {
            timestamp: data.timestamp,
            bedTemp: data.temperature.bed.actual,
            hotendTemp: data.temperature.hotend.actual,
            progress: data.progress.completion,
            printerState: data.status
          };
          
          setTelemetryData(prev => [...prev.slice(-50), telemetryPoint]);
        });
      }

      // Set up status callbacks for job completion
      if (isOctoPrint) {
        const octoPrintService = service as OctoPrintService;
        octoPrintService.onStatus = (status) => {
          setCurrentStatus(status);
          if (status === 'job_completed') {
            toast({
              title: "Print Job Completed!",
              description: `MINT tokens have been awarded to your wallet`,
            });
          }
        };
      } else {
        const bambuService = service as BambuLabsService;
        bambuService.onStatus((status) => {
          setCurrentStatus(status);
          if (status === 'job_completed') {
            toast({
              title: "Print Job Completed!",
              description: `MINT tokens have been awarded to your wallet`,
            });
          }
        });
      }

      setPrinterService(service);
      setIsCollecting(true);
      setCurrentStatus('Collecting data...');

      toast({
        title: "Collection Started",
        description: `Successfully connected to ${isOctoPrint ? 'OctoPrint' : 'Bambu Labs printer'}`
      });

    } catch (error) {
      console.error('Failed to start collection:', error);
      setCurrentStatus('Connection failed');
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to printer",
        variant: "destructive"
      });
    }
  };

  // Stop telemetry collection
  const stopCollection = () => {
    setIsCollecting(false);
    setCurrentStatus('Stopped');
    
    if (printerService) {
      printerService.disconnect();
      setPrinterService(null);
    }

    toast({
      title: "Collection Stopped",
      description: "Telemetry collection has been stopped"
    });
  };

  // Update connection defaults when type changes
  const handleConnectionTypeChange = (type: string) => {
    const defaultPort = PrinterServiceFactory.getDefaultPort(type);
    setConnectionData(prev => ({
      ...prev,
      connectionType: type,
      port: defaultPort,
      host: type === 'bambu_mqtt' ? '192.168.1.100' : 'octopi.local'
    }));
  };

  const isBambuConnection = connectionData.connectionType === 'bambu_mqtt';
  const isOctoPrintConnection = connectionData.connectionType === 'octoprint_api';

  return (
    <div className="space-y-6">
      {/* Connection Configuration */}
      <Card className="border-primary">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Activity className="w-6 h-6 mr-2 text-primary" />
            Printer Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Connection Type Selector */}
          <div>
            <Label>Connection Type</Label>
            <Select value={connectionData.connectionType} onValueChange={handleConnectionTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select printer type" />
              </SelectTrigger>
              <SelectContent>
                {supportedTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <div>{type.label}</div>
                      <div className="text-xs text-muted-foreground">{type.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>{isBambuConnection ? 'Printer IP Address' : 'Host/IP Address'}</Label>
              <Input
                value={connectionData.host}
                onChange={(e) => setConnectionData(prev => ({ ...prev, host: e.target.value }))}
                placeholder={isBambuConnection ? '192.168.1.100' : 'octopi.local or 192.168.1.100'}
              />
            </div>
            <div>
              <Label>Port</Label>
              <Input
                type="number"
                value={connectionData.port}
                onChange={(e) => setConnectionData(prev => ({ ...prev, port: parseInt(e.target.value) }))}
                placeholder={isBambuConnection ? '8883' : '80'}
                disabled={isBambuConnection}
              />
            </div>
          </div>

          {/* API Key for OctoPrint */}
          {isOctoPrintConnection && (
            <div>
              <Label className="flex items-center justify-between">
                API Key
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </Label>
              <Input
                type={showApiKey ? "text" : "password"}
                value={connectionData.apiKey}
                onChange={(e) => setConnectionData(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="OctoPrint API Key"
              />
            </div>
          )}

          {/* Access Key for Bambu Labs */}
          {isBambuConnection && (
            <div>
              <Label className="flex items-center justify-between">
                Access Key
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </Label>
              <Input
                type={showApiKey ? "text" : "password"}
                value={connectionData.accessKey}
                onChange={(e) => setConnectionData(prev => ({ ...prev, accessKey: e.target.value }))}
                placeholder="Bambu Labs Access Key"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Get this from your printer's settings → Local MQTT
              </p>
            </div>
          )}
          
          {/* MINT Reward Configuration */}
          <div>
            <Label>MINT Reward per Job Completion</Label>
            <div className="flex items-center space-x-2">
              <Input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={mintRewardAmount}
                onChange={(e) => setMintRewardAmount(parseFloat(e.target.value) || 1.0)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">MINT tokens</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Customize how many MINT tokens to award when a print job completes
            </p>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center space-x-2">
              <Badge variant="outline">Status: {currentStatus}</Badge>
              {machineInfo && (
                <Badge variant="secondary">{machineInfo.model}</Badge>
              )}
            </div>
            <Button
              onClick={isCollecting ? stopCollection : startCollection}
              disabled={
                (isOctoPrintConnection && (!connectionData.host || !connectionData.apiKey)) ||
                (isBambuConnection && (!connectionData.host || !connectionData.accessKey))
              }
            >
              {isCollecting ? (
                <>
                  <Pause className="w-4 h-4 mr-2" />
                  Stop Collection
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Collection
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Telemetry Chart */}
      {telemetryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Thermometer className="w-5 h-5 mr-2" />
              Live Telemetry Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={telemetryData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(value) => new Date(value).toLocaleTimeString()}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => new Date(value).toLocaleString()}
                  />
                  <Line
                    type="monotone"
                    dataKey="bedTemp"
                    stroke="#8884d8"
                    name="Bed Temp (°C)"
                  />
                  <Line
                    type="monotone"
                    dataKey="hotendTemp"
                    stroke="#82ca9d"
                    name="Hotend Temp (°C)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Getting Started Info */}
      {!isCollecting && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <div className="space-y-4">
              {isBambuConnection ? (
                <>
                  <h3 className="font-semibold">How to Connect Your Bambu Labs X1 Carbon:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>1. Ensure your printer is connected to the same network as your computer</li>
                    <li>2. On the printer touchscreen, go to Settings → Network → Local MQTT</li>
                    <li>3. Enable local MQTT and note the access key</li>
                    <li>4. Enter the printer's IP address and access key above</li>
                    <li>5. Click "Start Collection" to begin earning MINT tokens</li>
                  </ul>
                </>
              ) : (
                <>
                  <h3 className="font-semibold">How to Connect Your OctoPrint Machine:</h3>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>1. Make sure OctoPrint is running and accessible</li>
                    <li>2. Get your API key from OctoPrint Settings → API</li>
                    <li>3. Enter your machine's IP address or hostname above</li>
                    <li>4. Click "Start Collection" to begin earning MINT tokens</li>
                  </ul>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
