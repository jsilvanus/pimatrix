# PiMatrix interactive setup launcher for Windows PowerShell
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Node.js is required to run the PiMatrix setup script."
    exit 1
}

$scriptPath = Join-Path $PSScriptRoot "scripts\setup.mjs"
node $scriptPath @args
