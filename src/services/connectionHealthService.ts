import { supabase } from '@/integrations/supabase/client';

export interface ConnectionHealth {
  machineId: string;
  isHealthy: boolean;
  lastSeen: Date;
  failureCount: number;
  lastError?: string;
  responseTime?: number;
}

export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailure?: Date;
  nextAttempt?: Date;
}

class ConnectionHealthService {
  private healthMap = new Map<string, ConnectionHealth>();
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private readonly FAILURE_THRESHOLD = 5;
  private readonly RECOVERY_TIMEOUT = 30000; // 30 seconds
  private readonly HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
  
  startMonitoring(machineId: string) {
    // Initialize health tracking
    this.healthMap.set(machineId, {
      machineId,
      isHealthy: true,
      lastSeen: new Date(),
      failureCount: 0
    });

    // Initialize circuit breaker
    this.circuitBreakers.set(machineId, {
      state: 'CLOSED',
      failureCount: 0
    });

    // Start periodic health checks
    this.scheduleHealthCheck(machineId);
  }

  recordSuccess(machineId: string, responseTime?: number) {
    const health = this.healthMap.get(machineId);
    if (health) {
      health.isHealthy = true;
      health.lastSeen = new Date();
      health.failureCount = 0;
      health.responseTime = responseTime;
      delete health.lastError;
    }

    // Reset circuit breaker on success
    const breaker = this.circuitBreakers.get(machineId);
    if (breaker && breaker.state !== 'CLOSED') {
      breaker.state = 'CLOSED';
      breaker.failureCount = 0;
      delete breaker.lastFailure;
      delete breaker.nextAttempt;
    }
  }

  recordFailure(machineId: string, error: string) {
    const health = this.healthMap.get(machineId);
    if (health) {
      health.isHealthy = false;
      health.failureCount++;
      health.lastError = error;
      health.lastSeen = new Date();
    }

    // Update circuit breaker
    const breaker = this.circuitBreakers.get(machineId);
    if (breaker) {
      breaker.failureCount++;
      breaker.lastFailure = new Date();

      if (breaker.failureCount >= this.FAILURE_THRESHOLD) {
        breaker.state = 'OPEN';
        breaker.nextAttempt = new Date(Date.now() + this.RECOVERY_TIMEOUT);
      }
    }

    // Log critical failures
    this.logCriticalFailure(machineId, error);
  }

  canAttemptConnection(machineId: string): boolean {
    const breaker = this.circuitBreakers.get(machineId);
    if (!breaker) return true;

    switch (breaker.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        if (breaker.nextAttempt && new Date() >= breaker.nextAttempt) {
          breaker.state = 'HALF_OPEN';
          return true;
        }
        return false;
      case 'HALF_OPEN':
        return true;
      default:
        return false;
    }
  }

  getHealthStatus(machineId: string): ConnectionHealth | null {
    return this.healthMap.get(machineId) || null;
  }

  getCircuitBreakerStatus(machineId: string): CircuitBreakerState | null {
    return this.circuitBreakers.get(machineId) || null;
  }

  private scheduleHealthCheck(machineId: string) {
    const interval = setInterval(async () => {
      const health = this.healthMap.get(machineId);
      if (!health) {
        clearInterval(interval);
        return;
      }

      // Check if machine hasn't been seen recently
      const timeSinceLastSeen = Date.now() - health.lastSeen.getTime();
      if (timeSinceLastSeen > this.HEALTH_CHECK_INTERVAL * 2) {
        this.recordFailure(machineId, 'Health check timeout');
      }

      // Update machine status in database
      await this.updateMachineHealthStatus(machineId, health);
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private async updateMachineHealthStatus(machineId: string, health: ConnectionHealth) {
    try {
      await supabase
        .from('machines')
        .update({
          status: health.isHealthy ? 'connected' : 'error',
          last_seen: health.lastSeen.toISOString()
        })
        .eq('id', machineId);
    } catch (error) {
      console.error('Failed to update machine health status:', error);
    }
  }

  private async logCriticalFailure(machineId: string, error: string) {
    try {
      // Log to telemetry data for analysis
      await supabase.from('telemetry_data').insert({
        machine_id: machineId,
        data: {
          error_type: 'connection_failure',
          error_message: error,
          severity: 'critical'
        } as any,
        processed_metrics: {
          health_status: 'critical_failure',
          error_count: this.healthMap.get(machineId)?.failureCount || 0
        } as any
      });
    } catch (dbError) {
      console.error('Failed to log critical failure:', dbError);
    }
  }

  stopMonitoring(machineId: string) {
    this.healthMap.delete(machineId);
    this.circuitBreakers.delete(machineId);
  }

  // Get overall system health
  getSystemHealth(): { healthy: number; unhealthy: number; total: number } {
    const machines = Array.from(this.healthMap.values());
    const healthy = machines.filter(m => m.isHealthy).length;
    const unhealthy = machines.length - healthy;

    return {
      healthy,
      unhealthy,
      total: machines.length
    };
  }
}

export const connectionHealthService = new ConnectionHealthService();
