using System.Collections.Generic;

namespace PiMatrixCompanion.Models
{
    public class PiMatrixStatus
    {
        public bool IsConnected { get; set; }
        public string Version { get; set; } = "Unknown";
        public string Mode { get; set; } = "unknown";
        public string Host { get; set; } = "127.0.0.1";
        public int Port { get; set; } = 3000;
        public int MediaMtxPort { get; set; } = 8890;
        public List<string> ActiveSources { get; set; } = new();
        public string CurrentOutputSource { get; set; } = string.Empty;
        public string MultiviewUrl { get; set; } = string.Empty;
    }

    public class AppSettings
    {
        public string PiMatrixHost { get; set; } = "127.0.0.1";
        public int PiMatrixApiPort { get; set; } = 3000;
        public int PiMatrixSrtPort { get; set; } = 8890;
        public int PiMatrixRtmpPort { get; set; } = 1935;

        public bool PreviewAlwaysOnTop { get; set; } = true;
        public double PreviewOpacity { get; set; } = 0.95;
        public int PreviewFpsLimit { get; set; } = 25;
        public bool ShowHudOverlay { get; set; } = true;

        public int VirtualMonitorCount { get; set; } = 2; // 1 to 4
        public List<VirtualMonitorConfig> Monitors { get; set; } = new();

        public static AppSettings CreateDefault()
        {
            var settings = new AppSettings
            {
                VirtualMonitorCount = 2,
                Monitors = new List<VirtualMonitorConfig>()
            };

            for (int i = 1; i <= 4; i++)
            {
                settings.Monitors.Add(new VirtualMonitorConfig
                {
                    Id = i,
                    Name = $"Virtual Monitor {i}",
                    IsEnabled = i <= 2, // Enable first 2 by default
                    Width = 1920,
                    Height = 1080,
                    RefreshRate = 60,
                    AspectRatio = "16:9",
                    Protocol = ProtocolType.SRT,
                    StreamHost = "127.0.0.1",
                    StreamPort = 8890,
                    StreamPath = $"companion{i}",
                    BitrateKbps = 6000,
                    Framerate = 60
                });
            }

            return settings;
        }
    }
}
