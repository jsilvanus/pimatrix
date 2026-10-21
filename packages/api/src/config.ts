export type RuntimeMode = "simulation" | "production";
export type HamaVideoCodec = "copy" | "libx264";

export interface AppConfig {
  host: string;
  port: number;
  mode: RuntimeMode;
  mediaMtxApiUrl?: string;
  previewBaseUrl?: string;
  fffleetUrl?: string;
  fffleetToken?: string;
  fffleetClientId?: string;
  fffleetClientSecret?: string;
  hamaEnabled: boolean;
  hamaDevice: string;
  hamaInputFormat?: string;
  hamaWidth?: number;
  hamaHeight?: number;
  hamaFrameRate?: number;
  hamaVideoCodec?: HamaVideoCodec;
  hamaRtspUrl?: string;
  streamRestartMinMs: number;
  streamRestartMaxMs: number;
}

function optionalHttpUrl(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be an HTTP or HTTPS URL without embedded credentials`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function optionalRtspUrl(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid RTSP URL`);
  }
  if (parsed.protocol !== "rtsp:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${name} must be an RTSP URL without embedded credentials or a fragment`);
  }
  return parsed.toString();
}

function positiveInteger(value: string | undefined, fallback: number, name: string, max = 10000): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.PIMATRIX_HOST?.trim() || "127.0.0.1";
  const port = Number(env.PIMATRIX_PORT ?? "3000");
  const mode = env.PIMATRIX_MODE ?? "simulation";
  const mediaMtxApiUrl = optionalHttpUrl(env.PIMATRIX_MEDIAMTX_API_URL, "PIMATRIX_MEDIAMTX_API_URL");
  const previewBaseUrl = optionalHttpUrl(env.PIMATRIX_PREVIEW_BASE_URL, "PIMATRIX_PREVIEW_BASE_URL");
  const fffleetUrl = optionalHttpUrl(env.FFFLEET_URL, "FFFLEET_URL");
  const fffleetToken = env.FFFLEET_TOKEN?.trim() || undefined;
  const fffleetClientId = env.FFFLEET_CLIENT_ID?.trim() || undefined;
  const fffleetClientSecret = env.FFFLEET_CLIENT_SECRET || undefined;
  const hamaEnabled = env.PIMATRIX_HAMA_ENABLED === "true";
  const hamaDevice = env.PIMATRIX_HAMA_DEVICE?.trim() || "/dev/video0";
  // Hama documents advertised ceilings, not Linux V4L2 modes; do not force a mode by default.
  const hamaInputFormat = env.PIMATRIX_HAMA_INPUT_FORMAT?.trim() || undefined;
  const hamaWidth = env.PIMATRIX_HAMA_WIDTH === undefined ? undefined : positiveInteger(env.PIMATRIX_HAMA_WIDTH, 1, "PIMATRIX_HAMA_WIDTH");
  const hamaHeight = env.PIMATRIX_HAMA_HEIGHT === undefined ? undefined : positiveInteger(env.PIMATRIX_HAMA_HEIGHT, 1, "PIMATRIX_HAMA_HEIGHT");
  const hamaFrameRate = env.PIMATRIX_HAMA_FRAME_RATE === undefined ? undefined : positiveInteger(env.PIMATRIX_HAMA_FRAME_RATE, 1, "PIMATRIX_HAMA_FRAME_RATE");
  const hamaVideoCodec = env.PIMATRIX_HAMA_VIDEO_CODEC || undefined;
  const hamaRtspUrl = optionalRtspUrl(env.PIMATRIX_HAMA_RTSP_URL, "PIMATRIX_HAMA_RTSP_URL");
  const streamRestartMinMs = positiveInteger(env.PIMATRIX_STREAM_RESTART_MIN_MS, 1000, "PIMATRIX_STREAM_RESTART_MIN_MS", 300000);
  const streamRestartMaxMs = positiveInteger(env.PIMATRIX_STREAM_RESTART_MAX_MS, 30000, "PIMATRIX_STREAM_RESTART_MAX_MS", 300000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PIMATRIX_PORT must be an integer between 1 and 65535");
  }
  if (mode !== "simulation" && mode !== "production") {
    throw new Error('PIMATRIX_MODE must be "simulation" or "production"');
  }
  if (!host || /\s/.test(host)) {
    throw new Error("PIMATRIX_HOST must be a non-empty hostname or IP address");
  }
  if (Boolean(fffleetClientId) !== Boolean(fffleetClientSecret)) {
    throw new Error("FFFLEET_CLIENT_ID and FFFLEET_CLIENT_SECRET must be set together");
  }
  if ((fffleetToken || fffleetClientId) && !fffleetUrl) {
    throw new Error("FFFLEET_URL is required when fffleet credentials are configured");
  }
  if (hamaEnabled && !hamaRtspUrl) {
    throw new Error("PIMATRIX_HAMA_RTSP_URL is required when PIMATRIX_HAMA_ENABLED=true");
  }
  if (Boolean(hamaWidth) !== Boolean(hamaHeight)) {
    throw new Error("PIMATRIX_HAMA_WIDTH and PIMATRIX_HAMA_HEIGHT must be set together");
  }
  if (hamaVideoCodec !== undefined && hamaVideoCodec !== "copy" && hamaVideoCodec !== "libx264") {
    throw new Error('PIMATRIX_HAMA_VIDEO_CODEC must be "copy" or "libx264"');
  }
  if (streamRestartMaxMs < streamRestartMinMs) {
    throw new Error("PIMATRIX_STREAM_RESTART_MAX_MS must be greater than or equal to PIMATRIX_STREAM_RESTART_MIN_MS");
  }

  return {
    host, port, mode, hamaEnabled, hamaDevice, hamaInputFormat,
    hamaWidth, hamaHeight, hamaFrameRate,
    hamaVideoCodec, streamRestartMinMs, streamRestartMaxMs,
    ...(mediaMtxApiUrl ? { mediaMtxApiUrl } : {}),
    ...(previewBaseUrl ? { previewBaseUrl } : {}),
    ...(fffleetUrl ? { fffleetUrl } : {}),
    ...(fffleetToken ? { fffleetToken } : {}),
    ...(fffleetClientId ? { fffleetClientId } : {}),
    ...(fffleetClientSecret ? { fffleetClientSecret } : {}),
    ...(hamaRtspUrl ? { hamaRtspUrl } : {})
  };
}
