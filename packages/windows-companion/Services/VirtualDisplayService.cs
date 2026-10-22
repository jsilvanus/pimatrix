using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Xml.Linq;
using PiMatrixCompanion.Common;
using PiMatrixCompanion.Models;

namespace PiMatrixCompanion.Services
{
    public interface IVirtualDisplayService
    {
        bool IsDriverInstalled { get; }
        Task<bool> CheckDriverStatusAsync();
        Task<bool> ApplyDisplayConfigurationAsync(List<VirtualMonitorConfig> monitors);
        Task<bool> RestartDriverAdapterAsync();
        List<NativeMethods.MonitorInfo> DetectActiveDisplays();
        string GetVddSettingsXmlPath();
    }

    public class VirtualDisplayService : IVirtualDisplayService
    {
        private const string DriverDeviceFriendlyName = "*Virtual Display*";
        private const string AltDriverDeviceFriendlyName = "*Indirect Display*";

        public bool IsDriverInstalled { get; private set; }

        public string GetVddSettingsXmlPath()
        {
            // Default VDD configuration locations:
            // 1. Next to the executable
            // 2. In %ProgramFiles%\Virtual Display Driver\vdd_settings.xml
            // 3. In %APPDATA%\Virtual Display Driver\vdd_settings.xml
            string localPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "vdd_settings.xml");
            if (File.Exists(localPath)) return localPath;

            string programFilesPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Virtual Display Driver",
                "vdd_settings.xml"
            );
            if (File.Exists(programFilesPath)) return programFilesPath;

            return localPath; // fallback to app base directory
        }

        public async Task<bool> CheckDriverStatusAsync()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"Get-PnpDevice -FriendlyName '{DriverDeviceFriendlyName}', '{AltDriverDeviceFriendlyName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                if (process == null) return false;

                string output = await process.StandardOutput.ReadToEndAsync();
                await process.WaitForExitAsync();

                IsDriverInstalled = output.Contains("OK") || output.Contains("Error") || output.Contains("Degraded");
                return IsDriverInstalled;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[VirtualDisplayService] CheckDriverStatusAsync error: {ex.Message}");
                IsDriverInstalled = false;
                return false;
            }
        }

        public async Task<bool> ApplyDisplayConfigurationAsync(List<VirtualMonitorConfig> monitors)
        {
            try
            {
                int enabledCount = monitors.Count(m => m.IsEnabled);
                if (enabledCount < 1) enabledCount = 1;
                if (enabledCount > 4) enabledCount = 4;

                // Build vdd_settings.xml
                var xml = new XDocument(
                    new XDeclaration("1.0", "utf-8", "yes"),
                    new XElement("vdd_settings",
                        new XElement("monitors",
                            new XElement("count", enabledCount)
                        ),
                        new XElement("global",
                            new XElement("g_refresh_rate", 60),
                            new XElement("g_refresh_rate", 50),
                            new XElement("g_refresh_rate", 30)
                        ),
                        new XElement("resolutions",
                            monitors.Where(m => m.IsEnabled).Select(m =>
                                new XElement("resolution",
                                    new XAttribute("width", m.Width),
                                    new XAttribute("height", m.Height),
                                    new XAttribute("refresh_rate", m.RefreshRate)
                                )
                            )
                        )
                    )
                );

                string xmlPath = GetVddSettingsXmlPath();
                string? dir = Path.GetDirectoryName(xmlPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                await File.WriteAllTextAsync(xmlPath, xml.ToString(), Encoding.UTF8);

                // If driver is installed, trigger adapter restart to reload settings
                if (IsDriverInstalled)
                {
                    return await RestartDriverAdapterAsync();
                }

                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[VirtualDisplayService] ApplyDisplayConfigurationAsync error: {ex.Message}");
                return false;
            }
        }

        public async Task<bool> RestartDriverAdapterAsync()
        {
            try
            {
                // Run PowerShell to disable and re-enable the indirect display device
                string script = @"
$device = Get-PnpDevice -FriendlyName '*Virtual Display*', '*Indirect Display*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($device) {
    Disable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    Enable-PnpDevice -InstanceId $device.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
    exit 0
} else {
    exit 1
}
";
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"{script}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                if (process == null) return false;

                await process.WaitForExitAsync();
                return process.ExitCode == 0;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[VirtualDisplayService] RestartDriverAdapterAsync error: {ex.Message}");
                return false;
            }
        }

        public List<NativeMethods.MonitorInfo> DetectActiveDisplays()
        {
            return NativeMethods.GetAllMonitors();
        }
    }
}
