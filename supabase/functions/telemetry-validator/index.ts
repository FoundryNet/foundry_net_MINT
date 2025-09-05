import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface TelemetryData {
  machine_id: string;
  temperatures: {
    bed?: number;
    extruder?: number;
    chamber?: number;
  };
  progress: number;
  print_time: number;
  estimated_time?: number;
  file_name?: string;
  material_usage?: number;
  z_position?: number;
  feed_rate?: number;
  timestamp: string;
}

interface ValidationResult {
  valid: boolean;
  anomaly_score: number;
  flags: string[];
  points_multiplier: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { telemetry, machine_id } = await req.json() as {
      telemetry: TelemetryData;
      machine_id: string;
    };

    console.log('Validating telemetry for machine:', machine_id);

    // Get recent telemetry history for pattern analysis
    const { data: recentData } = await supabase
      .from('telemetry_data')
      .select('*')
      .eq('machine_id', machine_id)
      .order('timestamp', { ascending: false })
      .limit(50);

    const validation = await validateTelemetry(telemetry, recentData || [], supabase);
    
    // Store validation result
    await supabase
      .from('telemetry_validations')
      .insert({
        machine_id,
        telemetry_id: telemetry.timestamp,
        validation_result: validation,
        raw_telemetry: telemetry,
        created_at: new Date().toISOString()
      });

    return new Response(
      JSON.stringify({ validation }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

async function validateTelemetry(
  current: TelemetryData, 
  history: any[], 
  supabase: any
): Promise<ValidationResult> {
  let anomaly_score = 0;
  const flags: string[] = [];
  let points_multiplier = 1.0;

  // 1. TEMPERATURE PHYSICS VALIDATION
  if (current.temperatures.bed && current.temperatures.bed > 200) {
    anomaly_score += 30;
    flags.push('impossible_bed_temp');
  }
  
  if (current.temperatures.extruder && current.temperatures.extruder > 350) {
    anomaly_score += 30;
    flags.push('impossible_extruder_temp');
  }

  // 2. TEMPORAL CONSISTENCY CHECKS
  if (history.length > 5) {
    const lastTemp = history[0]?.data?.temperatures?.extruder;
    const currentTemp = current.temperatures.extruder;
    
    if (lastTemp && currentTemp) {
      const tempDelta = Math.abs(currentTemp - lastTemp);
      const timeDelta = (new Date(current.timestamp).getTime() - 
                       new Date(history[0].timestamp).getTime()) / 1000;
      
      // Temperature can't change more than 10°C per second
      if (tempDelta / timeDelta > 10) {
        anomaly_score += 25;
        flags.push('impossible_temp_change');
      }
    }
  }

  // 3. PROGRESS VALIDATION
  if (current.progress > 100 || current.progress < 0) {
    anomaly_score += 20;
    flags.push('invalid_progress');
  }

  // Check for unrealistic progress jumps
  if (history.length > 0) {
    const lastProgress = history[0]?.data?.progress || 0;
    const progressJump = current.progress - lastProgress;
    
    if (progressJump > 50) { // More than 50% in one update
      anomaly_score += 15;
      flags.push('suspicious_progress_jump');
    }
  }

  // 4. PRINT TIME VALIDATION
  const expectedMinTime = current.progress * 0.01 * (current.estimated_time || 3600);
  if (current.print_time < expectedMinTime * 0.5) {
    anomaly_score += 20;
    flags.push('unrealistic_print_speed');
  }

  // 5. FREQUENCY ANALYSIS (Rate limiting detection)
  const recentCount = history.filter(h => 
    new Date(h.timestamp).getTime() > Date.now() - 60000
  ).length;
  
  if (recentCount > 20) { // More than 20 updates per minute
    anomaly_score += 25;
    flags.push('excessive_frequency');
    points_multiplier *= 0.5; // Halve points for spam
  }

  // 6. MACHINE FINGERPRINTING
  const machineFingerprint = await generateMachineFingerprint(current, history);
  if (machineFingerprint.suspicious) {
    anomaly_score += machineFingerprint.score;
    flags.push(...machineFingerprint.flags);
  }

  // 7. STATISTICAL OUTLIER DETECTION
  const stats = calculateStatisticalOutliers(current, history);
  anomaly_score += stats.outlier_score;
  flags.push(...stats.flags);

  // Apply penalties
  if (anomaly_score > 80) {
    points_multiplier = 0; // No points for highly suspicious data
  } else if (anomaly_score > 50) {
    points_multiplier *= 0.3; // Severely reduced points
  } else if (anomaly_score > 30) {
    points_multiplier *= 0.7; // Moderately reduced points
  }

  return {
    valid: anomaly_score < 50,
    anomaly_score,
    flags,
    points_multiplier
  };
}

function generateMachineFingerprint(current: TelemetryData, history: any[]) {
  let score = 0;
  const flags: string[] = [];
  
  // Check for identical consecutive readings (suggests simulation)
  if (history.length > 3) {
    const identical = history.slice(0, 3).every(h => 
      h.data?.temperatures?.extruder === current.temperatures.extruder &&
      h.data?.temperatures?.bed === current.temperatures.bed
    );
    
    if (identical) {
      score += 30;
      flags.push('identical_consecutive_readings');
    }
  }

  // Check for suspiciously round numbers (suggests manual input)
  const temps = [current.temperatures.bed, current.temperatures.extruder].filter(Boolean);
  const roundNumbers = temps.filter(t => t! % 10 === 0).length;
  
  if (roundNumbers === temps.length && temps.length > 0) {
    score += 15;
    flags.push('suspiciously_round_numbers');
  }

  return {
    suspicious: score > 20,
    score,
    flags
  };
}

function calculateStatisticalOutliers(current: TelemetryData, history: any[]) {
  let outlier_score = 0;
  const flags: string[] = [];

  if (history.length < 10) return { outlier_score, flags };

  // Temperature variance analysis
  const temps = history.map(h => h.data?.temperatures?.extruder).filter(Boolean);
  if (temps.length > 5) {
    const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
    const variance = temps.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / temps.length;
    const stdDev = Math.sqrt(variance);
    
    const currentTemp = current.temperatures.extruder;
    if (currentTemp && Math.abs(currentTemp - mean) > 3 * stdDev) {
      outlier_score += 20;
      flags.push('temperature_statistical_outlier');
    }
  }

  return { outlier_score, flags };
}
