flowchart TD
    A[Real 3D Printer<br/>OctoPrint or Bambu Labs] --> B[SimpleTelemetryCollector.tsx<br/>Direct service instantiation]
    
    B --> C{Connection Type}
    C -->|octoprint_api| D[OctoPrintService]
    C -->|bambu_mqtt| E[BambuLabsService] 
    
    D --> F[Real Telemetry Data Collection<br/>Bed/Hotend temps, Progress, Status]
    E --> F
    
    F --> G[Job Completion Detection<br/>status === 'job_completed']
    
    G --> H[enhancedPointsService.ts<br/>Job lifecycle event recording]
    
    H --> I[mintService.ts<br/>3 MINT per job completion]
    
    I --> J[supabase/functions/solana-mint/index.ts<br/>Solana Mainnet Transaction]
    
    J --> K[User Receives 3 MINT Tokens<br/>Direct to connected wallet]
    
    style A fill:#e1f5fe
    style B fill:#f3e5f5
    style F fill:#e8f5e8
    style G fill:#fff3e0
    style H fill:#fce4ec
    style I fill:#e0f2f1
    style J fill:#f1f8e9
    style K fill:#e8eaf6
