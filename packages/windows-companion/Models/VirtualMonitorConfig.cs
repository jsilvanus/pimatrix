using System;
using System.Text.Json.Serialization;

namespace PiMatrixCompanion.Models
{
    public class VirtualMonitorConfig
    {
        public int Id { get; set; } = 1; // 1 to 4
        public string Name { get; set; } = "Virtual Monitor 1";
        public bool IsEnabled { get; set; } = true;

        public int Width { get; set; } = 1920;
        public int Height { get; set; } = 1080;
        public int RefreshRate { get; set; } = 60;
        public string AspectRatio { get; set; } = "16:9";

        public ProtocolType Protocol { get; set; } = ProtocolType.SRT;
        public string StreamHost { get; set; } = "127.0.0.1";
        public int StreamPort { get; set; } = 8890; // Default SRT port for MediaMTX
        public string StreamPath { get; set; } = "monitor1";
        public int BitrateKbps { get; set; } = 6000;
        public int Framerate { get; set; } = 60;

        public EncoderType Encoder { get; set; } = EncoderType.AutoHardware;
        public bool LowLatencyMode { get; set; } = true;
        public int SrtLatencyMs { get; set; } = 30;

        [JsonIgnore]
        public string WindowsDeviceName { get; set; } = string.Empty;

        [JsonIgnore]
        public IntPtr MonitorHandle { get; set; } = IntPtr.Zero;

        [JsonIgnore]
        public StreamState CurrentState { get; set; } = StreamState.Stopped;

        [JsonIgnore]
        public double CurrentFps { get; set; }

        [JsonIgnore]
        public double CurrentBitrateKbps { get; set; }

        [JsonIgnore]
        public long DroppedFrames { get; set; }

        public string GetStreamUrl()
        {
            return Protocol switch
            {
                ProtocolType.SRT => $"srt://{StreamHost}:{StreamPort}?streamid=publish:{StreamPath}&latency={SrtLatencyMs}",
                ProtocolType.WHIP => $"http://{StreamHost}:{StreamPort}/{StreamPath}/whip",
                ProtocolType.RTMP => $"rtmp://{StreamHost}:{StreamPort}/{StreamPath}",
                ProtocolType.RTSP => $"rtsp://{StreamHost}:{StreamPort}/{StreamPath}",
                _ => $"srt://{StreamHost}:{StreamPort}?streamid=publish:{StreamPath}"
            };
        }
    }
}
