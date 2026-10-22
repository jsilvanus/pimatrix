namespace PiMatrixCompanion.Models
{
    public enum ProtocolType
    {
        SRT,        // Ultra-low latency (~30-80ms), UDP with ARQ (Recommended for MediaMTX)
        WHIP,       // WebRTC HTTP Ingestion Protocol (~30-60ms)
        RTMP,       // Standard RTMP streaming (~500-2000ms)
        RTSP        // RTSP streaming (~150-300ms)
    }

    public enum EncoderType
    {
        AutoHardware,   // Automatically picks NVENC, QuickSync, or AMF
        NvencH264,      // NVIDIA NVENC H.264
        QsvH264,        // Intel QuickSync H.264
        AmfH264,        // AMD AMF H.264
        CpuX264         // Software H.264 fallback
    }

    public enum StreamState
    {
        Stopped,
        Connecting,
        Streaming,
        Error
    }
}
