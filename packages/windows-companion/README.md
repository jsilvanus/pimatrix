# PiMatrix Windows Companion App

A high-performance, native Windows desktop application for **PiMatrix**. It creates and manages **1 to 4 virtual monitors** with configurable aspect ratios and resolutions, renders a compact **Always-on-Top live preview window**, and streams display feeds over the network with ultra-low latency directly to **PiMatrix (MediaMTX)**.

---

## Table of Contents

- [Key Features](#key-features)
- [Standalone Executable Distribution](#standalone-executable-distribution)
- [Virtual Display Management](#virtual-display-management)
- [Small Live Preview Window (Deck)](#small-live-preview-window-deck)
- [Streaming Protocols & Low Latency](#streaming-protocols--low-latency)
- [Project Architecture](#project-architecture)
- [Build & Run](#build--run)
  - [Prerequisites](#prerequisites)
  - [Building from Source](#building-from-source)
  - [Publishing the Standalone Executable](#publishing-the-standalone-executable)
  - [Running Unit Tests](#running-unit-tests)
- [Virtual Display Driver Setup](#virtual-display-driver-setup)
- [Configuration & Settings Persistence](#configuration--settings-persistence)
- [Troubleshooting](#troubleshooting)

---

## Key Features

* **1–4 Virtual Monitors (IddCx Driver Integration)**:
  * Dynamically create and control 1 to 4 true Windows virtual monitors.
  * Recognized by Windows Display Settings, PowerPoint presenter view, and all desktop applications.
  * Standard aspect ratios: **16:9** (1080p, 720p, 1440p, 4K), **16:10** (1920x1200, 1280x800), **4:3** (1024x768).
  * Custom LED wall resolutions: **1920x540** (32:9 banner), **1024x256**, **1280x480**, **384x192**, **512x512**, **9:16 portrait**.
  * Configurable refresh rates (60Hz, 50Hz for PAL AV broadcast setups, 30Hz).
* **Compact "Always-on-Top" Live Preview Window**:
  * Floating, borderless/minimal-chrome preview deck that pins above other foreground apps.
  * Adaptive multi-view grid (1x1, 1x2, or 2x2 layout) with cycle layout button.
  * Real-time HUD: Tally border (Live streaming, Armed, Offline), FPS counter, bitrate indicator, and monitor title.
  * GPU-accelerated Direct3D downscaling with throttled refresh rate (15–30 fps) for near-zero CPU footprint.
* **Ultra-Low Latency Ingestion Engine**:
  * **SRT (Secure Reliable Transport)**: Primary recommended protocol for MediaMTX (`srt://<host>:8890?streamid=publish:<path>&latency=30`). Sub-60ms glass-to-glass latency with UDP ARQ packet recovery.
  * **WebRTC (WHIP)**: Real-time sub-frame ingestion (`http://<host>:8889/<path>/whip`).
  * **RTMP**: Standard streaming fallback (`rtmp://<host>:1935/<path>`).
  * Hardware-accelerated encoding: NVIDIA NVENC (`h264_nvenc`), Intel QuickSync (`h264_qsv`), AMD AMF (`h264_amf`), or CPU (`libx264`).
* **PiMatrix Ecosystem Integration**:
  * Auto-discovers PiMatrix host status (`/api/v1/status` and `/sources`).
  * Connection health monitoring and quick-launch into the PiMatrix WebRTC Multiview.
  * Automatic stream path alignment with PiMatrix source naming.

---

## Standalone Executable Distribution

The companion app can be published as a **completely self-contained, single-file executable (`PiMatrixCompanion.exe`)**:

- **No .NET Runtime Required:** Bundles the .NET 9 runtime, WPF libraries, and DirectX interop directly into the executable.
- **Portable:** Can be distributed via USB drive, network share, or downloaded directly onto any 64-bit Windows 10/11 system.
- **Double-Click Execution:** Simply run `PiMatrixCompanion.exe` with no installer required.

To build the standalone executable:
```powershell
cd packages/windows-companion
.\publish.ps1
```
The output executable is created at `publish/PiMatrixCompanion.exe`.

---

## Virtual Display Management

The app interfaces with Microsoft's **Indirect Display Driver Class eXtension (IddCx)**:

- Monitor configurations are saved in `vdd_settings.xml`.
- Displays can be toggled enabled/disabled on-the-fly.
- When monitors are reconfigured, clicking **"Apply to Driver"** and **"Restart Adapter"** reloads the driver in under 1 second without restarting Windows.

---

## Small Live Preview Window (Deck)

Clicking **"🗗 Pop Out Preview Deck"** launches a dedicated, compact preview window:

1. **Always-on-Top (Topmost):** Stays visible while working in PowerPoint, OBS, vMix, or a browser.
2. **Opacity Slider:** Allows dimming or making the preview semi-transparent.
3. **Adaptive Grid:** Automatically switches between 1-column, 2-column, and 2x2 layouts.
4. **Tally Status Borders:**
   - 🟢 **Green Border:** Actively streaming over the network.
   - 🟠 **Orange Border:** Monitor is armed and active in Windows.
   - ⚪ **Gray Border:** Monitor is disabled.
5. **Telemetry Overlays:** Displays real-time capture FPS, output bitrate in kbps, and configured aspect ratio.

---

## Streaming Protocols & Low Latency

| Protocol | Typical Latency | Transport | MediaMTX Target | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **SRT** *(Caller)* | **30 – 80 ms** | UDP | `srt://<host>:8890?streamid=publish:<name>&latency=30` | **Primary Recommended** (Robust over LAN/Wi-Fi, packet recovery) |
| **WebRTC (WHIP)** | **30 – 60 ms** | HTTP/DTLS | `http://<host>:8889/<name>/whip` | **Real-time interactive** sync |
| **RTMP** | **500 – 2,500 ms** | TCP | `rtmp://<host>:1935/<name>` | **Universal fallback** |
| **RTSP** | **150 – 300 ms** | TCP/UDP | `rtsp://<host>:8554/<name>` | **Legacy AV devices** |

---

## Project Architecture

```
packages/windows-companion/
├── App.xaml / App.xaml.cs                 # Application bootstrap & dependency wiring
├── PiMatrixCompanion.csproj               # .NET 9 WPF Project Configuration
├── PiMatrixCompanion.sln                  # Visual Studio / MSBuild Solution
├── publish.ps1                            # Standalone single-file packaging script
├── Common/
│   ├── NativeMethods.cs                   # Win32 GDI/DXGI monitor & capture P/Invoke
│   ├── ObservableObject.cs                # MVVM property change notification base
│   ├── RelayCommand.cs                    # MVVM ICommand implementation
│   └── Converters.cs                      # XAML UI value converters & status colors
├── Models/
│   ├── AppSettings.cs                     # Persistent configuration model
│   ├── DisplayResolution.cs               # Resolution presets & aspect ratio logic
│   ├── ProtocolType.cs                    # SRT, WHIP, RTMP, RTSP & Encoder enums
│   ├── VirtualMonitorConfig.cs            # Individual monitor settings & stream URLs
│   └── PiMatrixStatus.cs                  # PiMatrix API connection & route status
├── Services/
│   ├── SettingsManager.cs                 # JSON configuration storage in %APPDATA%
│   ├── VirtualDisplayService.cs           # IddCx driver manager & vdd_settings.xml
│   ├── ScreenCaptureService.cs            # Zero-copy frame grab & WriteableBitmap
│   ├── StreamingEngine.cs                 # Multi-protocol low-latency FFmpeg runner
│   └── PiMatrixClient.cs                  # HTTP client for PiMatrix health & sources
├── ViewModels/
│   ├── MainViewModel.cs                   # Main companion console coordinator
│   ├── MonitorViewModel.cs                # Individual monitor card/inspector logic
│   └── PreviewViewModel.cs                # Always-on-top preview deck coordinator
├── Views/
│   ├── MainWindow.xaml / .cs              # Main AV console dashboard
│   └── PreviewWindow.xaml / .cs           # Compact floating preview deck
├── Assets/
│   └── Driver/
│       ├── install-driver.ps1             # Automated driver installer script
│       ├── vdd_settings.xml.template      # Driver configuration template
│       └── README_DRIVER.md               # Driver installation instructions
└── Tests/
    ├── PiMatrixCompanion.Tests.csproj     # xUnit test project
    └── ModelAndServiceTests.cs            # Unit tests for aspect ratios, URLs, XML
```

---

## Build & Run

### Prerequisites

* Windows 10 (version 1903+) or Windows 11 (64-bit)
* [.NET 9.0 SDK](https://dotnet.microsoft.com/download/dotnet/9.0) (only required to build from source)
* *(Optional for streaming)* FFmpeg with hardware encoder support in PATH or local folder

### Building from Source

```powershell
cd packages/windows-companion
dotnet build
```

### Publishing the Standalone Executable

To produce a single, portable executable:

```powershell
cd packages/windows-companion
.\publish.ps1
```

Or run via the .NET CLI:

```powershell
dotnet publish PiMatrixCompanion.csproj `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o publish
```

The resulting `publish/PiMatrixCompanion.exe` contains all runtimes and dependencies.

### Running Unit Tests

```powershell
cd packages/windows-companion
dotnet test PiMatrixCompanion.sln
```

### Launching the Application in Development

```powershell
cd packages/windows-companion
dotnet run --project PiMatrixCompanion.csproj
```

---

## Virtual Display Driver Setup

To install and register the Indirect Display Driver:

1. Open PowerShell as **Administrator**.
2. Run:
   ```powershell
   & ".\Assets\Driver\install-driver.ps1"
   ```
3. Once installed, launch the Companion App, configure your desired resolutions, and click **"Apply to Driver"**.

---

## Configuration & Settings Persistence

Configuration is saved in JSON format under the current operator's roaming profile:

`%APPDATA%\PiMatrixCompanion\settings.json`

This preserves:
- PiMatrix target IP, API port, and default streaming ports
- Enabled status for monitors 1 through 4
- Configured resolutions, aspect ratios, and refresh rates
- Selected protocols (SRT, WHIP, RTMP) and custom bitrates
- Preview window preferences (Always-on-Top, opacity)

---

## Troubleshooting

- **Driver not detected:** Run `install-driver.ps1` as Administrator. Check Windows Device Manager under *Display adapters* to verify the driver is enabled.
- **Stream fails to start:** Ensure FFmpeg is installed or accessible in PATH, and verify that the target PiMatrix MediaMTX server is reachable at the configured IP and port (`8890` for SRT or `1935` for RTMP).
- **Preview window hidden:** Click **"🗗 Pop Out Preview Deck"** in the top-right header of the main console to restore the preview window.
