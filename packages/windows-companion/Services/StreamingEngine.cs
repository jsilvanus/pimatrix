using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using PiMatrixCompanion.Models;

namespace PiMatrixCompanion.Services
{
    public interface IStreamingEngine
    {
        Task<bool> StartStreamAsync(VirtualMonitorConfig monitor);
        Task StopStreamAsync(int monitorId);
        bool IsStreaming(int monitorId);
        string? FindFFmpegPath();
    }

    public class StreamingEngine : IStreamingEngine, IDisposable
    {
        private readonly ConcurrentDictionary<int, Process> _streamProcesses = new();
        private string? _cachedFFmpegPath;

        public bool IsStreaming(int monitorId) => _streamProcesses.ContainsKey(monitorId);

        public string? FindFFmpegPath()
        {
            if (!string.IsNullOrEmpty(_cachedFFmpegPath) && File.Exists(_cachedFFmpegPath))
            {
                return _cachedFFmpegPath;
            }

            // Search common paths:
            // 1. Next to the executable
            // 2. PATH
            // 3. Program Files (OBS Studio, ffmpeg)
            string localPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe");
            if (File.Exists(localPath))
            {
                _cachedFFmpegPath = localPath;
                return localPath;
            }

            // Check PATH environment variable
            string? pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (pathEnv != null)
            {
                foreach (string dir in pathEnv.Split(Path.PathSeparator))
                {
                    try
                    {
                        string candidate = Path.Combine(dir.Trim(), "ffmpeg.exe");
                        if (File.Exists(candidate))
                        {
                            _cachedFFmpegPath = candidate;
                            return candidate;
                        }
                    }
                    catch { }
                }
            }

            // Check standard OBS Studio location which bundles ffmpeg
            string obsFfmpeg = @"C:\Program Files\obs-studio\bin\64bit\ffmpeg.exe";
            if (File.Exists(obsFfmpeg))
            {
                _cachedFFmpegPath = obsFfmpeg;
                return obsFfmpeg;
            }

            return null;
        }

        public async Task<bool> StartStreamAsync(VirtualMonitorConfig monitor)
        {
            if (_streamProcesses.ContainsKey(monitor.Id))
            {
                await StopStreamAsync(monitor.Id);
            }

            string? ffmpeg = FindFFmpegPath() ?? "ffmpeg.exe";

            // Determine video encoder
            string encoderFlag = monitor.Encoder switch
            {
                EncoderType.NvencH264 => "-c:v h264_nvenc -preset p1 -tune ull -zerolatency 1",
                EncoderType.QsvH264 => "-c:v h264_qsv -preset veryfast -low_power 1",
                EncoderType.AmfH264 => "-c:v h264_amf -quality speed -latency low",
                EncoderType.CpuX264 => "-c:v libx264 -preset ultrafast -tune zerolatency",
                _ => "-c:v h264_nvenc -preset p1 -tune ull -zerolatency 1" // fallback to auto nvenc with fallback
            };

            int fps = monitor.Framerate > 0 ? monitor.Framerate : 60;
            int bitrate = monitor.BitrateKbps > 0 ? monitor.BitrateKbps : 6000;
            int bufsize = bitrate / 2;

            // Screen input selection: capture specific desktop coordinate or display
            int displayIndex = monitor.Id - 1;
            string inputArgs = $"-f gdigrab -framerate {fps} -offset_x 0 -offset_y 0 -video_size {monitor.Width}x{monitor.Height} -draw_mouse 1 -i desktop";

            // Format output target depending on protocol
            string outputArgs;
            switch (monitor.Protocol)
            {
                case ProtocolType.SRT:
                    // SRT with low latency live caller mode to MediaMTX
                    outputArgs = $"-f mpegts -muxdelay 0 -pes_payload_size 0 \"srt://{monitor.StreamHost}:{monitor.StreamPort}?streamid=publish:{monitor.StreamPath}&latency={monitor.SrtLatencyMs * 1000}&transtype=live\"";
                    break;

                case ProtocolType.RTMP:
                    // RTMP streaming
                    outputArgs = $"-f flv -flvflags no_duration_filesize \"rtmp://{monitor.StreamHost}:{monitor.StreamPort}/{monitor.StreamPath}\"";
                    break;

                case ProtocolType.RTSP:
                    outputArgs = $"-f rtsp -rtsp_transport tcp \"rtsp://{monitor.StreamHost}:{monitor.StreamPort}/{monitor.StreamPath}\"";
                    break;

                case ProtocolType.WHIP:
                    outputArgs = $"-f webm -cluster_size_limit 2M -cluster_time_limit 5100 -content_type video/webm \"http://{monitor.StreamHost}:{monitor.StreamPort}/{monitor.StreamPath}/whip\"";
                    break;

                default:
                    outputArgs = $"-f mpegts \"srt://{monitor.StreamHost}:{monitor.StreamPort}?streamid=publish:{monitor.StreamPath}\"";
                    break;
            }

            string fullArgs = $"-hide_banner -loglevel info {inputArgs} {encoderFlag} -pix_fmt yuv420p -b:v {bitrate}k -maxrate {bitrate}k -bufsize {bufsize}k -g {fps} {outputArgs}";

            Debug.WriteLine($"[StreamingEngine] Launching stream: {ffmpeg} {fullArgs}");

            var psi = new ProcessStartInfo
            {
                FileName = ffmpeg,
                Arguments = fullArgs,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            try
            {
                var process = Process.Start(psi);
                if (process == null || process.HasExited)
                {
                    monitor.CurrentState = StreamState.Error;
                    return false;
                }

                _streamProcesses[monitor.Id] = process;
                monitor.CurrentState = StreamState.Streaming;

                // Monitor stderr to parse real-time bitrate & fps
                _ = Task.Run(async () =>
                {
                    var regex = new Regex(@"fps=\s*(\d+(?:\.\d+)?).*bitrate=\s*(\d+(?:\.\d+)?)\s*kbits/s", RegexOptions.Compiled);
                    using var reader = process.StandardError;
                    while (!reader.EndOfStream)
                    {
                        string? line = await reader.ReadLineAsync();
                        if (line != null)
                        {
                            var match = regex.Match(line);
                            if (match.Success)
                            {
                                if (double.TryParse(match.Groups[1].Value, out double curFps))
                                    monitor.CurrentFps = curFps;
                                if (double.TryParse(match.Groups[2].Value, out double curBitrate))
                                    monitor.CurrentBitrateKbps = curBitrate;
                            }
                        }
                    }

                    if (_streamProcesses.TryRemove(monitor.Id, out _))
                    {
                        monitor.CurrentState = StreamState.Stopped;
                        monitor.CurrentFps = 0;
                        monitor.CurrentBitrateKbps = 0;
                    }
                });

                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[StreamingEngine] Failed to start stream: {ex.Message}");
                monitor.CurrentState = StreamState.Error;
                return false;
            }
        }

        public async Task StopStreamAsync(int monitorId)
        {
            if (_streamProcesses.TryRemove(monitorId, out var process))
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(true);
                        await process.WaitForExitAsync();
                    }
                }
                catch { }
                finally
                {
                    process.Dispose();
                }
            }
        }

        public void Dispose()
        {
            foreach (var kvp in _streamProcesses)
            {
                try
                {
                    if (!kvp.Value.HasExited)
                    {
                        kvp.Value.Kill(true);
                    }
                    kvp.Value.Dispose();
                }
                catch { }
            }
            _streamProcesses.Clear();
        }
    }
}
