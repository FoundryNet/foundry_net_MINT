import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { telemetryService } from '@/services/telemetryService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Cpu, Thermometer, Clock, Play, Pause, Square, Trash2 } from 'lucide-react';

interface Machine {
  id: string;
  name: string;
  machine_type: string;
  connection_type: string;
  status: string;
  connection_config: any;
  last_seen: string | null;
  created_at: string;
}

interface MachineListProps {
  refreshTrigger?: number;
}

export function MachineList({ refreshTrigger }: MachineListProps) {
  const { user } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMachines = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    
    try {
      const { data, error } = await supabase
        .from('machines')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMachines(data || []);
    } catch (error) {
      console.error('Error fetching machines:', error);
      setMachines([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStartMonitoring = async (machine: Machine) => {
    try {
      await telemetryService.startMonitoring(machine.id, machine.connection_config);
      // Refresh the list to show updated status
      fetchMachines();
    } catch (error) {
      console.error('Error starting monitoring:', error);
    }
  };

  const handleStopMonitoring = (machine: Machine) => {
    telemetryService.stopMonitoring(machine.id);
    fetchMachines();
  };

  const handleDelete = async (machineId: string) => {
    try {
      telemetryService.stopMonitoring(machineId);
      
      const { error } = await supabase
        .from('machines')
        .delete()
        .eq('id', machineId);

      if (error) throw error;
      fetchMachines();
    } catch (error) {
      console.error('Error deleting machine:', error);
    }
  };

  useEffect(() => {
    if (user) {
      // Debounce multiple rapid calls
      const timeoutId = setTimeout(() => {
        fetchMachines();
      }, 100);
      
      return () => clearTimeout(timeoutId);
    } else {
      setMachines([]);
      setLoading(false);
    }
  }, [user?.id]); // Only depend on user.id, not the whole user object

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'disconnected': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      case 'maintenance': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected': return <Badge className="bg-green-100 text-green-800">Connected</Badge>;
      case 'disconnected': return <Badge variant="secondary">Disconnected</Badge>;
      case 'error': return <Badge variant="destructive">Error</Badge>;
      case 'maintenance': return <Badge className="bg-yellow-100 text-yellow-800">Maintenance</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-4 bg-muted rounded w-3/4"></div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="h-3 bg-muted rounded w-1/2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (machines.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <Cpu className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No Machines Connected</h3>
          <p className="text-muted-foreground mb-4">
            Connect your first OctoPrint instance to start monitoring
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {machines.map((machine) => (
        <Card key={machine.id} className="border border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-bold">{machine.name}</CardTitle>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(machine.status)}`}></div>
                {getStatusBadge(machine.status)}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {machine.connection_type.toUpperCase()} • {machine.machine_type}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Connection</div>
                <div className="text-sm font-medium">
                  {machine.connection_config?.host || 'Not configured'}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Last Seen</div>
                <div className="text-sm font-medium">
                  {machine.last_seen 
                    ? new Date(machine.last_seen).toLocaleString()
                    : 'Never'
                  }
                </div>
              </div>
            </div>
            
            {machine.status === 'connected' && (
              <div className="border-t border-border pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Thermometer className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Awaiting telemetry...</span>
                  </div>
                  <div className="flex space-x-1">
                    <Button size="sm" variant="outline">
                      <Play className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline">
                      <Pause className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline">
                      <Square className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
            <div className="border-t border-border pt-3">
              <div className="text-xs text-muted-foreground">
                Added: {new Date(machine.created_at).toLocaleDateString()}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
