param(
    [Parameter(Mandatory=$false)]
    [string]$RemoteHost,
    
    [string]$RemotePath = "~/containers/grafana"
)

if (-not $RemoteHost) {
    $RemoteHost = Read-Host "Please enter the remote host (e.g., user@ubuntu-server or 192.168.1.100)"
}

if (-not $RemoteHost) {
    Write-Host "A remote host is required to deploy. Exiting..." -ForegroundColor Red
    exit 1
}

# Resolve the absolute path of the local-telemetry directory relative to this script
$LocalTelemetryPath = Join-Path $PSScriptRoot "grafana"

if (-not (Test-Path $LocalTelemetryPath)) {
    Write-Host "Source directory not found: $LocalTelemetryPath" -ForegroundColor Red
    exit 1
}

Write-Host "==================================" -ForegroundColor Cyan
Write-Host " Telemetry Deployment Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "Source : $LocalTelemetryPath" 
Write-Host "Target : $RemoteHost`:$RemotePath"
Write-Host "----------------------------------`n"

# 1. Ensure the target directory exists on the remote machine
Write-Host "[1/3] Ensuring remote directory exists..." -ForegroundColor Yellow
ssh $RemoteHost "mkdir -p $RemotePath"
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to connect or create directory via SSH." -ForegroundColor Red
    exit $LASTEXITCODE
}

$CopyFailed = $false
$Items = Get-ChildItem -Path $LocalTelemetryPath
foreach ($Item in $Items) {
    $ItemPath = $Item.FullName
    if ($Item.PSIsContainer) {
        Write-Host "  -> Copying directory: $($Item.Name)" -ForegroundColor DarkGray
        scp -r -q "$ItemPath" "$RemoteHost`:$RemotePath/"
    } else {
        Write-Host "  -> Copying file: $($Item.Name)" -ForegroundColor DarkGray
        scp -q "$ItemPath" "$RemoteHost`:$RemotePath/"
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] Failed to copy: $($Item.Name)" -ForegroundColor Red
        $CopyFailed = $true
    }
}

if ($CopyFailed) {
    Write-Host "Failed to copy files." -ForegroundColor Red
    exit 1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to copy files." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. Connect to the remote machine to create data dirs, fix permissions & restart Docker Containers
Write-Host "`n[3/3] Creating data dirs, fixing permissions & Restarting Docker Containers remotely..." -ForegroundColor Yellow
ssh $RemoteHost "cd $RemotePath && mkdir -p loki_data tempo_data grafana_data prometheus_data && (chmod -R a+rX . 2>/dev/null || true) && (chown -R 10001:10001 loki_data && chmod -R u=rwx,g=rx,o=--- loki_data && chown -R 1000:1000 tempo_data && chmod -R u=rwx,g=rx,o=--- tempo_data && chown -R 1000:1000 grafana_data && chmod -R u=rwx,g=rx,o=--- grafana_data && chown -R 1000:1000 prometheus_data && chmod -R u=rwx,g=rx,o=--- prometheus_data 2>/dev/null || true) && docker compose down && docker compose up -d"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to restart Docker containers." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n[SUCCESS] Telemetry Stack has been deployed and restarted successfully!" -ForegroundColor Green
