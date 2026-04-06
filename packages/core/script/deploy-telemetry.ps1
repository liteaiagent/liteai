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
$LocalTelemetryPath = Join-Path $PSScriptRoot "..\local-telemetry"

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

# 2. Iterate through files and folders in local-telemetry and SCP them
Write-Host "[2/3] Copying files to $RemoteHost..." -ForegroundColor Yellow

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
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to copy files." -ForegroundColor Red
    exit $LASTEXITCODE
}

# 3. Connect to the remote machine to tear down and start the stack
Write-Host "`n[3/3] Restarting Docker Containers remotely..." -ForegroundColor Yellow
ssh $RemoteHost "cd $RemotePath && docker compose down && docker compose up -d"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to restart Docker containers." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "`n[SUCCESS] Telemetry Stack has been deployed and restarted successfully!" -ForegroundColor Green
