# Virtual Display Driver Setup Guide

The **PiMatrix Companion App** uses Windows Indirect Display Driver (IddCx) technology to create up to 4 virtual monitors with arbitrary resolutions and aspect ratios.

## Quick Installation

1. Open PowerShell as **Administrator**.
2. Run:
   ```powershell
   & ".\install-driver.ps1"
   ```
3. Once completed, the driver will be registered and active in Windows Device Manager under **Display adapters** (`Virtual Display Driver` or `Indirect Display Device`).

## Dynamic Configuration

The Companion App automatically updates `vdd_settings.xml` and reloads the driver adapter whenever you:
- Enable or disable virtual monitors (1 to 4).
- Change resolutions or aspect ratios (e.g., 1080p, 720p, 1920x540 LED banner).
- Click **"Apply to Driver"** or **"Restart Adapter"** in the Companion App status bar.

## Troubleshooting

- **Displays do not appear:** Ensure PowerShell was run with Administrator privileges during driver installation.
- **Custom resolution missing in Windows Display Settings:** Click "Apply to Driver" in the Companion App and then "Restart Adapter". Windows Display Settings will refresh with the newly configured resolutions.
