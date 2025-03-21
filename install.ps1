$Target = if ($Target) { $Target } else { "latest" }

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

Write-Host "LiteAI Installer"

$installDir = [System.IO.Path]::Combine($env:USERPROFILE, ".local", "bin")
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
}

$arch = $env:PROCESSOR_ARCHITECTURE.ToLower()
if ($arch -eq "amd64" -or $arch -eq "x86_64") {
    $arch = "x64"
} elseif ($arch -eq "arm64") {
    $arch = "arm64"
} else {
    Write-Error "Unsupported architecture: $arch"
}

$needsBaseline = $false
if ($arch -eq "x64") {
    # Check for AVX2 support
    $avx2 = (Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)
    if (-not $avx2) {
        $needsBaseline = $true
    }
}

$platform = "windows-$arch"
if ($needsBaseline) {
    $platform = "$platform-baseline"
}

$filename = "liteai-$platform.zip"
if ($Target -eq "latest") {
    $url = "https://github.com/liteaiagent/liteai/releases/latest/download/$filename"
    $checksumsUrl = "https://github.com/liteaiagent/liteai/releases/latest/download/checksums.txt"
} else {
    # e.g., if passing "v1.2.3"
    $url = "https://github.com/liteaiagent/liteai/releases/download/$Target/$filename"
    $checksumsUrl = "https://github.com/liteaiagent/liteai/releases/download/$Target/checksums.txt"
}

Write-Host "Installing LiteAI for $platform (Version: $Target)..."
Write-Host "Downloading from $url"

$zipPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), $filename)
$extractPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "liteai_install_$([guid]::NewGuid())")

Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

Write-Host "Verifying checksum..."
try {
    $checksumsContent = Invoke-RestMethod -Uri $checksumsUrl -UseBasicParsing
    $expectedHash = $null
    
    foreach ($line in ($checksumsContent -split "`n" | Where-Object { $_ -match "\S" })) {
        if ($line -match "^([a-fA-F0-9]+)\s+$([regex]::Escape($filename))$") {
            $expectedHash = $matches[1]
            break
        }
    }

    if (-not $expectedHash) {
        throw "Could not find entry for $filename in checksums.txt"
    }

    $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
    if ($actualHash -ne $expectedHash.ToLower()) {
        throw "Verification failed! Expected $expectedHash, got $actualHash"
    }
    Write-Host "Checksum verified successfully!"
}
catch {
    Write-Error "Checksum verification error: $_"
    if (Test-Path $zipPath) {
        Remove-Item -Path $zipPath -Force
    }
    exit 1
}

Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

$exePath = [System.IO.Path]::Combine($extractPath, "liteai.exe")

Copy-Item -Path $exePath -Destination [System.IO.Path]::Combine($installDir, "liteai.exe") -Force

Remove-Item -Path $zipPath -Force
Remove-Item -Path $extractPath -Recurse -Force

Write-Host "Installed LiteAI to $installDir"

# Add to PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notmatch [regex]::Escape($installDir)) {
    $newPath = "$installDir;$userPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$installDir;$env:Path"
    Write-Host "Added $installDir to your User PATH. You may need to restart your terminal."
} else {
    Write-Host "$installDir is already in your PATH."
}

Write-Host "`nLiteAI installation complete. To start, run: liteai"
