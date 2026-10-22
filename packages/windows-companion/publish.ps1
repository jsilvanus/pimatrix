<#
.SYNOPSIS
    Builds a standalone, self-contained single-file PiMatrixCompanion.exe for Windows x64.
.DESCRIPTION
    Produces a single executable in the 'publish/' directory with all .NET 9 runtimes,
    WPF components, and DirectX dependencies bundled in. No .NET runtime installation required.
#>

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = "publish"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Publishing PiMatrix Companion Standalone Executable ===" -ForegroundColor Cyan

# Ensure dotnet is in PATH
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    $dotnetPath = "$env:LocalAppData\Microsoft\dotnet"
    if (Test-Path "$dotnetPath\dotnet.exe") {
        $env:Path = "$dotnetPath;$env:Path"
    } else {
        Write-Error ".NET SDK not found. Please install .NET 9 SDK."
        exit 1
    }
}

dotnet publish PiMatrixCompanion.csproj `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $OutputDir

$exePath = Join-Path $OutputDir "PiMatrixCompanion.exe"
if (Test-Path $exePath) {
    $sizeMb = [Math]::Round((Get-Item $exePath).Length / 1MB, 1)
    Write-Host "=== Build Succeeded ===" -ForegroundColor Green
    Write-Host "Standalone Executable: $exePath ($sizeMb MB)" -ForegroundColor Green
    Write-Host "Ready to distribute. No .NET runtime required on target PCs." -ForegroundColor Green
} else {
    Write-Error "Failed to generate $exePath"
}
