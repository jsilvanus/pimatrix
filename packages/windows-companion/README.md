# PiMatrix Windows Companion App

A high-performance Windows desktop companion application for **PiMatrix**. It manages **1 to 4 virtual monitors** with configurable aspect ratios and resolutions, renders a compact **Always-on-Top live preview window**, and streams display feeds over the network with ultra-low latency directly to **PiMatrix (MediaMTX)**.

---

## Key Features

* **1–4 Virtual Monitors (IddCx Driver Integration)**:
  * Dynamically create and control 1 to 4 true Windows virtual monitors.
  * Standard aspect ratios: **16:9** (1080p, 720p, 1440p, 4K), **16:10** (1920x1200, 1280x800), **4:3** (1024x768).
  * Custom LED wall resolutions: **1920x540** (32:9 banner), **1024x256**, **1280x480**, **384x192**, **512x512**, **9:16 portrait**.
  * Configurable refresh rates (60Hz, 50Hz for PAL AV environments, 30Hz).
* **Compact "Always-on-Top" Live Preview Window**:
  * Floating, borderless/minimal-chrome preview deck that pins above other windows.
  * Adaptive multi-view grid (1x1, 1x2, or 2x2 layout).
  * Real-time HUD: Tally border (Live streaming, Armed, Offline), FPS counter, bitrate indicator, and monitor title.
  * GPU-accelerated Direct3D downscaling with throttled refresh rate (15–30 fps) for near-zero CPU footprint.
* **Low-Latency Ingestion Engine**:
  * **SRT (Secure Reliable Transport)**: Primary recommended protocol for MediaMTX (`srt://<host>:8890?streamid=publish:<path>&latency=30`). Sub-60ms glass-to-glass latency with UDP ARQ packet recovery.
  * **WebRTC (WHIP)**: Real-time sub-frame ingestion (`http://<host>:8889/<path>/whip`).
  * **RTMP**: Standard streaming fallback (`rtmp://<host>:1935/<path>`).
  * Hardware-accelerated encoding: NVIDIA NVENC (`h264_nvenc`), Intel QuickSync (`h264_qsv`), AMD AMF (`h264_amf`), or CPU (`libx264`).
* **PiMatrix Ecosystem Integration**:
  * Auto-discovers PiMatrix host status (`/api/v1/status` and `/sources`).
  * Connection health monitoring and quick-launch into the PiMatrix WebRTC Multiview.
  * Automatic stream path alignment with PiMatrix source naming.

---

## Project Structure

```
packages/windows-companion/
├── App.xaml / App.xaml.cs                 # Application bootstrap & dependency wiring
├── PiMatrixCompanion.csproj               # .NET 9 WPF Project Configuration
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

* Windows 10 (version 1903+) or Windows 11
* .NET 9.0 SDK
* *(Optional for streaming)* FFmpeg with hardware encoder support in PATH or local folder

### Build Application

```powershell
cd packages/windows-companion
dotnet build
```

### Build Standalone Executable (No .NET Runtime Required on Target)

To produce a single, portable `PiMatrixCompanion.exe` that runs on any 64-bit Windows 10/11 machine without needing .NET installed:

```powershell
cd packages/windows-companion
.\publish.ps1
```

Or via direct `dotnet publish`:

```powershell
dotnet publish PiMatrixCompanion.csproj `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o publish
```

This outputs a self-contained **`publish/PiMatrixCompanion.exe`** ready for distribution.

### Run Tests

```powershell
cd packages/windows-companion/Tests
dotnet test
```

### Launch Application

```powershell
cd packages/windows-companion
dotnet run
```

---

## Virtual Display Driver Setup

To enable true Windows virtual monitors:

1. Open PowerShell as **Administrator**.
2. Run:
   ```powershell
   & ".\Assets\Driver\install-driver.ps1"
   ```
3. In the PiMatrix Companion App, configure your desired monitor count (1 to 4) and resolutions, then click **"Apply to Driver"** and **"Restart Adapter"**.
