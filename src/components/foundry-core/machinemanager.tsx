import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
// import { useAuth } from '@/hooks/useAuth'; // Disabled for testing
import { useToast } from '@/hooks/use-toast';
import { Plus, Settings, Trash2, Wifi, WifiOff, AlertCircle, Loader2 } from 'lucide-react';
import { PrinterServiceFactory } from '@/services/printerServiceFactory';

interface Machine {
  id: string;
  name: string;
  machine_type: string;
  connection_type: string;
  status: string;
  last_seen: string | null;
  connection_config: any;
  created_at: string;
  user_id: string;
}

interface NewMachineForm {
  name: string;
  machine_type: string;
  connection_type: string;
  host: string;
  port: number;
  apiKey: string;
  ssl: boolean;
}

export function MachineManager() {
  // const { user, loading: authLoading } = useAuth(); // Disabled for testing
  const user = { id: '00000000-0000-0000-0000-000000000000' }; // Test user
  const authLoading = false;
  const { toast } = useToast();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newMachine, setNewMachine] = useState<NewMachineForm>({
    name: '',
    machine_type: '3d_printer',
    connection_type: 'octoprint_api',
    host: '',
    port: 80,
    apiKey: '',
    ssl: false
  });

  useEffect(() => {
    // Debounce to prevent multiple rapid calls on mount
    const timeoutId = setTimeout(() => {
      fetchMachines();
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, []); // Empty dependency array to run only once

  const fetchMachines = async () => {
    try {
      setLoading(true);
      
      // Add timeout to prevent CloudFlare timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), 10000)
      );
        
      const queryPromise = supabase
        .from('machines')
        .select('*')
        .eq('user_id', '00000000-0000-0000-0000-000000000000') // Test user ID
        .order('created_at', { ascending: false });
        
      const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as any;

      if (error) {
        console.error('Supabase error:', error);
        toast({
          title: "Database Error",
          description: "Failed to load machines. Please refresh the page.",
          variant: "destructive"
        });
        return;
      }

      console.log('Fetched machines:', data);
      setMachines((data || []) as Machine[]);
    } catch (error) {
      console.error('Error in fetchMachines:', error);
      if (error instanceof Error && error.message === 'Database query timeout') {
        toast({
          title: "Connection Timeout",
          description: "Database query took too long. Please try again.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to load machines. Please try again.",
          variant: "destructive"
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const addMachine = async () => {
    // Auth check disabled for testing
    
    if (!newMachine.name.trim() || !newMachine.host.trim() || !newMachine.apiKey.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    try {
      setSubmitting(true);
      console.log('Adding machine:', newMachine);

      const machineData = {
        name: newMachine.name.trim(),
        machine_type: '3d_printer' as const,
        connection_type: newMachine.connection_type as any,
        connection_config: JSON.stringify({
          host: newMachine.host.trim(),
          port: newMachine.port,
          apiKey: newMachine.apiKey.trim(),
          ssl: newMachine.ssl
        }),
        status: 'disconnected' as const,
        user_id: '00000000-0000-0000-0000-000000000000' // Test user ID
      };

      // Optimized database insert with timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Insert timeout')), 10000)
      );
        
      const insertPromise = supabase
        .from('machines')
        .insert(machineData)
        .select()
        .single();
        
      const { data, error } = await Promise.race([insertPromise, timeoutPromise]) as any;

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }

      console.log('Machine added:', data);
      toast({
        title: "Success",
        description: "Machine added successfully"
      });

      setShowAddDialog(false);
      resetForm();
      await fetchMachines();
    } catch (error) {
      console.error('Error adding machine:', error);
      toast({
        title: "Error",
        description: "Failed to add machine. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async () => {
    console.log('🔥🔥🔥 === STARTING CONNECTION TEST === 🔥🔥🔥');

    if (!newMachine.host.trim() || !newMachine.apiKey.trim()) {
      toast({
        variant: "destructive", 
        title: "Missing Information",
        description: "Please provide host and API key",
      });
      return;
    }

    setSubmitting(true);
    
    try {
      const protocol = newMachine.ssl ? 'https' : 'http';
      const apiUrl = `${protocol}://${newMachine.host.trim()}:${newMachine.port}/api/version`;
      
      console.log('🌐 Testing API URL:', apiUrl);
      console.log('🔑 Connection Type:', newMachine.connection_type);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      if (newMachine.apiKey.trim()) {
        headers['X-Api-Key'] = newMachine.apiKey.trim();
        console.log('🔑 API Key length:', newMachine.apiKey.length);
      }
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers
      });
      
      console.log('📊 Response status:', response.status);
      console.log('📊 Response ok:', response.ok);
      
      if (response.ok) {
        try {
          const data = await response.json();
          console.log('✅ SUCCESS! Response:', data);
          const versionInfo = data.server || data.text || 'instance';
          
          toast({
            title: "✅ Connection Successful!",
            description: `Connected to OctoPrint ${versionInfo}`,
          });
        } catch (jsonError) {
          console.log('✅ SUCCESS! (Could not parse JSON but got 200)');
          toast({
            title: "✅ Connection Successful!",
            description: "OctoPrint is responding correctly",
          });
        }
      } else if (response.status === 403) {
        toast({
          variant: "destructive",
          title: "❌ Forbidden (403)",
          description: "API key is wrong or lacks permission. Check OctoPrint Settings > API",
        });
      } else if (response.status === 401) {
        toast({
          variant: "destructive",
          title: "❌ Unauthorized (401)", 
          description: "API key authentication failed",
        });
      } else {
        toast({
          variant: "destructive",
          title: `❌ HTTP Error ${response.status}`,
          description: `OctoPrint returned: ${response.statusText}`,
        });
      }
      
    } catch (error) {
      console.log('💥 Fetch error:', error);
      
      // More specific error handling
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        toast({
          variant: "destructive",
          title: "💥 Network Error",
          description: `Cannot connect to ${newMachine.host}:${newMachine.port}. Check if OctoPrint is accessible.`,
        });
      } else if (error.message.includes('CORS')) {
        toast({
          variant: "destructive",
          title: "💥 CORS Error",
          description: "CORS not enabled in OctoPrint. Enable it in Settings > API > CORS",
        });
      } else {
        toast({
          variant: "destructive",
          title: "💥 Connection Failed",
          description: error.message || 'Unknown connection error',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deleteMachine = async (machineId: string) => {
    try {
      console.log('Deleting machine:', machineId);
      
      const { error } = await supabase
        .from('machines')
        .delete()
        .eq('id', machineId);

      if (error) {
        console.error('Delete error:', error);
        throw error;
      }

      toast({
        title: "Success",
        description: "Machine deleted successfully"
      });
      
      await fetchMachines();
    } catch (error) {
      console.error('Error deleting machine:', error);
      toast({
        title: "Error",
        description: "Failed to delete machine. Please try again.",
        variant: "destructive"
      });
    }
  };

  const resetForm = () => {
    setNewMachine({
      name: '',
      machine_type: '3d_printer',
      connection_type: 'octoprint_api',
      host: '',
      port: 80,
      apiKey: '',
      ssl: false
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-green-500" />;
      case 'disconnected':
        return <WifiOff className="h-4 w-4 text-gray-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <WifiOff className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      connected: 'default' as const,
      disconnected: 'secondary' as const,
      error: 'destructive' as const
    };

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status}
      </Badge>
    );
  };

  const formatMachineType = (type: string) => {
    return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Show loading state while fetching machines
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Machine Management</h2>
            <p className="text-muted-foreground">Manage your connected 3D printers and devices</p>
          </div>
        </div>
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading machines...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Machine Management</h2>
          <p className="text-muted-foreground">Manage your connected 3D printers and devices</p>
        </div>
        
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Machine
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Machine</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Machine Name *</Label>
                <Input
                  id="name"
                  value={newMachine.name}
                  onChange={(e) => setNewMachine({ ...newMachine, name: e.target.value })}
                  placeholder="My 3D Printer"
                />
              </div>
              
              <div>
                <Label htmlFor="connection_type">Connection Type</Label>
                <div className="p-3 border rounded-md bg-muted">
                  <span className="text-sm font-medium">OctoPrint API</span>
                  <p className="text-xs text-muted-foreground mt-1">
                    Standard OctoPrint installation with API access
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="host">OctoPrint Host *</Label>
                <Input
                  id="host"
                  value={newMachine.host}
                  onChange={(e) => setNewMachine({ ...newMachine, host: e.target.value })}
                  placeholder="192.168.1.100"
                />
              </div>

              <div>
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  value={newMachine.port}
                  onChange={(e) => setNewMachine({ ...newMachine, port: parseInt(e.target.value) || 80 })}
                  placeholder="80"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Default port for OctoPrint: 80
                </p>
              </div>

              <div>
                <Label htmlFor="apiKey">API Key *</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={newMachine.apiKey}
                  onChange={(e) => setNewMachine({ ...newMachine, apiKey: e.target.value })}
                  placeholder="Your OctoPrint API Key"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Find this in OctoPrint Settings → API
                </p>
              </div>

              {/* SSL option removed - defaults to false for local connections */}

              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={() => {
                    console.log('🔥 BUTTON CLICKED - STARTING DEBUG');
                    testConnection();
                  }} 
                  className="flex-1" 
                  disabled={submitting || !newMachine.host.trim() || !newMachine.apiKey.trim()}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>
                
                <Button 
                  onClick={addMachine} 
                  className="flex-1" 
                  disabled={submitting || !newMachine.name.trim() || !newMachine.host.trim() || !newMachine.apiKey.trim()}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Machine
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {machines.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <Settings className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Machines Connected</h3>
            <p className="text-muted-foreground mb-4">Add your first 3D printer to start earning DePIN tokens</p>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Machine
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {machines.map((machine) => (
            <Card key={machine.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{machine.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {formatMachineType(machine.machine_type)}
                    </p>
                  </div>
                  {getStatusIcon(machine.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  {getStatusBadge(machine.status)}
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Host</span>
                  <span className="text-sm font-mono">
                    {(() => {
                      try {
                        const config = typeof machine.connection_config === 'string' 
                          ? JSON.parse(machine.connection_config) 
                          : machine.connection_config;
                        return config?.host || 'N/A';
                      } catch {
                        return 'N/A';
                      }
                    })()}
                  </span>
                </div>

                {machine.last_seen && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Seen</span>
                    <span className="text-sm">
                      {new Date(machine.last_seen).toLocaleDateString()}
                    </span>
                  </div>
                )}

                <div className="flex space-x-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1">
                    <Settings className="h-4 w-4 mr-2" />
                    Configure
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteMachine(machine.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
