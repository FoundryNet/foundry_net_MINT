import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { telemetryService } from '@/services/telemetryService';
import { Zap, Play, Pause, AlertTriangle, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Machine {
  id: string;
  name: string;
  status: string;
  connection_config: any;
}

export function LiveTelemetryDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [isMonitoring, setIsMonitoring] = useState(false);

  useEffect(() => {
    if (user) {
      fetchMachines();
    }
  }, [user]);

  const fetchMachines = async () => {
    try {
      const { data, error } = await supabase
        .from('machines')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMachines(data || []);
      
      if (data && data.length > 0) {
        setSelectedMachine(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching machines:', error);
    }
  };

  const startMonitoring = async () => {
    const machine = machines.find(m => m.id === selectedMachine);
    if (!machine) return;

    try {
      const config = JSON.parse(machine.connection_config);
      
      // Start basic connectivity monitoring
      await telemetryService.startMonitoring(machine.id, config);
      
      setConnectionStatus('connected');
      setIsMonitoring(true);
      
      toast({
        title: "Monitoring Started",
        description: `Basic connectivity monitoring for ${machine.name}`
      });

    } catch (error) {
      console.error('Connection error:', error);
      toast({
        title: "Connection Failed",
        description: "Failed to start machine monitoring",
        variant: "destructive"
      });
    }
  };

  const stopMonitoring = async () => {
    const machine = machines.find(m => m.id === selectedMachine);
    if (!machine) return;

    telemetryService.stopMonitoring(machine.id);
    setConnectionStatus('disconnected');
    setIsMonitoring(false);
    
    toast({
      title: "Monitoring Stopped",
      description: "Machine monitoring has been stopped"
    });
  };

  const selectedMachineData = machines.find(m => m.id === selectedMachine);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Machine Connectivity</h2>
          <p className="text-muted-foreground">Simple machine connection monitoring for MINT token emissions</p>
        </div>
        
        <div className="flex items-center space-x-4">
          {selectedMachineData && (
            <div className="flex items-center space-x-2">
              <span className={`text-sm ${isMonitoring ? 'text-green-600' : 'text-gray-600'}`}>
                {isMonitoring ? 'Monitoring...' : 'Stopped'}
              </span>
              {isMonitoring ? (
                <Button size="sm" variant="outline" onClick={stopMonitoring}>
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={startMonitoring}>
                  <Play className="h-4 w-4 mr-2" />
                  Start Monitoring
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {machines.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Machines Found</h3>
            <p className="text-muted-foreground">Add a machine in the Machine Management section to start basic connectivity monitoring.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Wallet className="w-5 h-5 mr-2 text-blue-500" />
                Simplified for MINT Testnet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <Zap className="w-16 h-16 mx-auto mb-4 text-yellow-500" />
                <h2 className="text-2xl font-bold mb-2">Ready for Tokenomics Testing</h2>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Complex telemetry data collection has been removed. Focus is now on basic machine 
                  connectivity and clean MINT token emission logic for your Ender 3 testing.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Machine Selection</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {machines.map((machine) => (
                  <div
                    key={machine.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedMachine === machine.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedMachine(machine.id)}
                  >
                    <h3 className="font-semibold">{machine.name}</h3>
                    <p className="text-sm text-muted-foreground">Status: {machine.status}</p>
                    <p className="text-xs text-muted-foreground mt-1">Ready for MINT testing</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {isMonitoring && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Zap className="w-5 h-5 mr-2 text-green-500" />
                  Basic Monitoring Active
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center p-4">
                  <div className="w-8 h-8 mx-auto mb-2 text-green-500">
                    <div className="animate-pulse">●</div>
                  </div>
                  <p className="text-green-600 font-medium">Machine connectivity check every 30 seconds</p>
                  <p className="text-sm text-muted-foreground">Simple connection monitoring for token emissions</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
