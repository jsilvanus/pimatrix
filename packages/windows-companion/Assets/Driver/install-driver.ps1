<#
.SYNOPSIS
    Automated installation script for the Virtual Display Driver (IddCx / VDD) on Windows 10/11.
.DESCRIPTION
    Installs the virtual display driver package and enables 1-4 virtual displays for the PiMatrix Companion App.
    Must be executed with Administrator privileges.
#>

param(
    [string]$DriverZipUrl = "https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip",
    [string]$DestinationDir = "$env:ProgramFiles\Virtual Display Driver"
)

# Verify Administrator elevation
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "This script requires Administrator privileges. Please re-run PowerShell as Administrator."
    exit 1
}

Write-Host "=== PiMatrix Virtual Display Driver Setup ===" -ForegroundColor Cyan

# Create destination directory
if (-not (Test-Path $DestinationDir)) {
    New-Item -ItemType Directory -Path $DestinationDir -Force | Out-Null
}

$tempZip = "$env:TEMP\VirtualDisplayDriver.zip"
Write-Host "Downloading Virtual Display Driver package..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $DriverZipUrl -OutFile $tempZip

Write-Host "Extracting driver files to $DestinationDir..." -ForegroundColor Yellow
Expand-Archive -Path $tempZip -DestinationPath $DestinationDir -Force
Remove-Item -Path $tempZip -Force

# Install driver certificate if present
$certFile = Get-ChildItem -Path $DestinationDir -Filter "*.cer" -Recurse | Select-Object -First 1
if ($certFile) {
    Write-Host "Installing driver security certificate ($($certFile.Name))..." -ForegroundColor Yellow
    certutil.exe -addstore "TrustedPublisher" $certFile.FullName
    certutil.exe -addstore "Root" $certFile.FullName
}

# Install driver using pnputil
$infFile = Get-ChildItem -Path $DestinationDir -Filter "*.inf" -Recurse | Select-Object -First 1
if ($infFile) {
    Write-Host "Registering Indirect Display Driver ($($infFile.Name)) via pnputil..." -ForegroundColor Yellow
    pnputil.exe /add-driver $infFile.FullName /install
}

# Copy initial vdd_settings.xml if not present
$templateXml = Join-Path $PSScriptRoot "vdd_settings.xml.template"
$targetXml = Join-Path $DestinationDir "vdd_settings.xml"
if ((Test-Path $templateXml) -and (-not (Test-Path $targetXml))) {
    Copy-Item -Path $templateXml -Destination $targetXml
}

Write-Host "=== Driver Setup Complete ===" -ForegroundColor Green
Write-Host "Active Virtual Displays can now be managed via PiMatrix Companion App." -ForegroundColor Green
