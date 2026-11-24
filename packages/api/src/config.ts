import { parseAtlonaInputs, type AtlonaInputs } from "./sound-lanes.js";
import { isEncoderSetting, type EncoderSetting } from "./encoder.js";
export type RuntimeMode = "simulation" | "production";
export type HamaVideoCodec = "copy" | EncoderSetting;
export type DisplayMode = "simulated" | "hardware" | "disabled";

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
  /** How long Hama capture keeps running after nothing needs it (on demand). */
  hamaIdleGraceMs: number;
  /** JSON file for Hama settings changed at runtime (API/CLI); empty string = not persisted. */
  hamaSettingsFile: string;
  streamRestartMinMs: number;
  streamRestartMaxMs: number;
  displayMode: DisplayMode;
  amxTcpEnabled: boolean;
  amxTcpHost: string;
  amxTcpPort: number;
  cam1Name: string;
  cam2Name: string;
  cam3Name: string;
  apiKey?: string;
  /** pigateway, which owns the ATEM, cameras and the Atlona matrix (PIMATRIX_GATEWAY_URL, PIMATRIX_GATEWAY_API_KEY). */
  gatewayUrl?: string;
  gatewayApiKey?: string;
  /** Atlona input each Pi HDMI output is wired to (PIMATRIX_ATLONA_INPUTS, default hdmi0=3,hdmi1=4). */
  atlonaInputs: AtlonaInputs;
  /** The Atlona output whose sound reaches the PA (PIMATRIX_PA_ATLONA_OUTPUT, default 1). */
  paAtlonaOutput: number;
  amxAllowedHosts?: string[];
  mediaMtxPassword?: string;
  authAllowedHosts?: string[];
  /** Browser origins allowed to call /api/v1 cross-origin (PIMATRIX_CORS_ORIGINS). Empty = no CORS. */
  corsOrigins?: string[];
  domain?: string;
  tlsPort?: number;
  letsencryptEmail?: string;
  hdmiPlayer: string;
  hdmi0Device?: string;
  hdmi1Device?: string;
  /** Let the player of this output play the stream's sound (PIMATRIX_HDMI0_AUDIO, PIMATRIX_HDMI1_AUDIO). */
  hdmi0Audio?: boolean;
  hdmi1Audio?: boolean;
  /** ALSA device for the player's sound on this output (PIMATRIX_HDMI0_AUDIO_DEVICE, PIMATRIX_HDMI1_AUDIO_DEVICE). */
  hdmi0AudioDevice?: string;
  hdmi1AudioDevice?: string;
  hdmiSdlVideoDriver?: string;
  /** ffplay hardware decoder (-vcodec), default h264_v4l2m2m; undefined = software decoding. */
  hdmiDecoder?: string;
  mediaMtxRtspUrl?: string;
  /** piprogram API base URL; composites with slideSource "piprogram" follow its stage frames. */
  piprogramUrl?: string;
  piprogramApiKey?: string;
  /** "publish-off": piprogram publishes the PiPGM feeds, pimatrix does not (PIMATRIX_PIPGM_FEED). */
  pipgmFeed: "publish" | "publish-off";
  /** Poll interval of the piprogram snapshot feeds, ms (PIMATRIX_PIPGM_POLL_MS, default 1000). */
  pipgmPollMs: number;
  /** MediaMTX path-list cache, ms; 0 = off (PIMATRIX_MEDIAMTX_CACHE_MS, default 1000). */
  mediaMtxCacheMs: number;
  /** How a still reaches the compose1/PiPGM publisher: decoded once to raw yuv420p, or as PNG each second (PIMATRIX_STILL_INPUT). */
  stillInput: "raw" | "png";
  /** DRM connector for the HDMI key output of the slide composite (PIMATRIX_COMPOSITE_HDMI_DEVICE). */
  compositeHdmiDevice?: string;
  /** Encoder for the compose1 RTSP publisher. */
  compositeVideoCodec: EncoderSetting;
  /** Retry with libx264 when the hardware encoder fails to start (PIMATRIX_ENCODER_FALLBACK, default on). */
  encoderFallback: boolean;
  /** Directory for the composite slide, key page files and settings (PIMATRIX_COMPOSITE_DATA_DIR). */
  compositeDataDir: string;
  /** File for the saved quick options (PIMATRIX_QUICK_OPTIONS_FILE). */
  quickOptionsFile: string;
  /** ffmpeg used to render key pages (PIMATRIX_COMPOSITE_FFMPEG). */
  compositeFfmpeg: string;
  /** ATEM input number of media player 1's fill (PIMATRIX_ATEM_MEDIA_FILL_INPUT); key is the next number. */
  atemMediaFillInput: number;
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

function nonNegativeInteger(value: string | undefined, fallback: number, name: string, max: number): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 0 || result > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}`);
  }
  return result;
}

function positiveInteger(value: string | undefined, fallback: number, name: string, max = 10000): number {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < 1 || result > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return result;
}

function validPort(value: string | undefined, fallback: number, name: string, allowZero = false): number {
  const result = Number(value ?? fallback);
  const min = allowZero ? 0 : 1;
  if (!Number.isInteger(result) || result < min || result > 65535) {
    throw new Error(`${name} must be an integer between ${min} and 65535`);
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.PIMATRIX_HOST?.trim() || "127.0.0.1";
  const port = Number(env.PIMATRIX_PORT ?? "3101");
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
  // 1920x1080 by default: the capture is usually cropped for the projectors. 720p is an option.
  const hamaWidth = positiveInteger(env.PIMATRIX_HAMA_WIDTH, 1920, "PIMATRIX_HAMA_WIDTH");
  const hamaHeight = positiveInteger(env.PIMATRIX_HAMA_HEIGHT, 1080, "PIMATRIX_HAMA_HEIGHT");
  const hamaIdleGraceSeconds = nonNegativeInteger(env.PIMATRIX_HAMA_IDLE_GRACE_SECONDS, 30, "PIMATRIX_HAMA_IDLE_GRACE_SECONDS", 3600);
  const hamaFrameRate = env.PIMATRIX_HAMA_FRAME_RATE === undefined ? undefined : positiveInteger(env.PIMATRIX_HAMA_FRAME_RATE, 1, "PIMATRIX_HAMA_FRAME_RATE");
  // The Pi 4 hardware encoder (falls back to libx264 if it cannot start): about 60% of a core against about 120% for libx264 at 1080p.
  const hamaVideoCodec = (env.PIMATRIX_HAMA_VIDEO_CODEC?.trim() || "h264_v4l2m2m") as HamaVideoCodec;
  const hamaRtspUrl = optionalRtspUrl(env.PIMATRIX_HAMA_RTSP_URL, "PIMATRIX_HAMA_RTSP_URL");
  const streamRestartMinMs = positiveInteger(env.PIMATRIX_STREAM_RESTART_MIN_MS, 1000, "PIMATRIX_STREAM_RESTART_MIN_MS", 300000);
  const streamRestartMaxMs = positiveInteger(env.PIMATRIX_STREAM_RESTART_MAX_MS, 30000, "PIMATRIX_STREAM_RESTART_MAX_MS", 300000);

  const rawDisplayMode = env.PIMATRIX_DISPLAY_MODE?.trim() || (env.PIMATRIX_DISPLAY_SIMULATED === "true" ? "simulated" : "disabled");
  if (!["simulated", "hardware", "disabled"].includes(rawDisplayMode)) {
    throw new Error('PIMATRIX_DISPLAY_MODE must be "simulated", "hardware", or "disabled"');
  }
  const displayMode = rawDisplayMode as DisplayMode;

  const amxTcpEnabled = env.PIMATRIX_AMX_TCP_ENABLED === "true" || env.PIMATRIX_AMX_TCP_PORT !== undefined;
  const amxTcpHost = env.PIMATRIX_AMX_TCP_HOST?.trim() || "127.0.0.1";
  const amxTcpPort = validPort(env.PIMATRIX_AMX_TCP_PORT, 6601, "PIMATRIX_AMX_TCP_PORT", true);

  const cam1Name = env.PIMATRIX_CAM1_NAME?.trim() || "Camera 1";
  const cam2Name = env.PIMATRIX_CAM2_NAME?.trim() || "Camera 2";
  const cam3Name = env.PIMATRIX_CAM3_NAME?.trim() || "Camera 3";

  const apiKey = env.PIMATRIX_API_KEY?.trim() || undefined;
  const amxAllowedHosts = env.PIMATRIX_AMX_ALLOWED_HOSTS
    ? env.PIMATRIX_AMX_ALLOWED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const mediaMtxPassword = env.PIMATRIX_MEDIAMTX_PASSWORD?.trim() || undefined;
  const rawAuthAllowed = env.PIMATRIX_AUTH_ALLOWED_HOSTS || env.PIMATRIX_AUTH_WHITELIST_HOSTS || env.PIMATRIX_AUTH_WHITELIST_IPS;
  const authAllowedHosts = rawAuthAllowed
    ? rawAuthAllowed.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const corsOrigins = env.PIMATRIX_CORS_ORIGINS
    ? env.PIMATRIX_CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const domain = env.PIMATRIX_DOMAIN?.trim() || undefined;
  const tlsPort = env.PIMATRIX_TLS_PORT ? validPort(env.PIMATRIX_TLS_PORT, 8443, "PIMATRIX_TLS_PORT") : undefined;
  const letsencryptEmail = env.LETSENCRYPT_EMAIL?.trim() || undefined;
  const hdmiPlayer = env.PIMATRIX_HDMI_PLAYER?.trim() || "ffplay";
  const hdmi0Device = env.PIMATRIX_HDMI0_DEVICE?.trim() || undefined;
  const hdmi1Device = env.PIMATRIX_HDMI1_DEVICE?.trim() || undefined;
  // SDL video driver for the players; kmsdrm is the headless Pi default. Set empty to inherit.
  const hdmiSdlVideoDriver =
    env.PIMATRIX_HDMI_SDL_VIDEODRIVER === undefined ? "kmsdrm" : env.PIMATRIX_HDMI_SDL_VIDEODRIVER.trim() || undefined;
  // Hardware decoder for the players (Pi: h264_v4l2m2m). Set empty for software decoding.
  const hdmiDecoder = env.PIMATRIX_HDMI_DECODER === undefined ? "h264_v4l2m2m" : env.PIMATRIX_HDMI_DECODER.trim() || undefined;
  if (hdmiDecoder !== undefined && !/^[a-z0-9_]+$/.test(hdmiDecoder)) {
    throw new Error("PIMATRIX_HDMI_DECODER must be an ffmpeg decoder name such as h264_v4l2m2m (letters, digits, _)");
  }
  for (const [name, value] of [["PIMATRIX_HDMI0_DEVICE", hdmi0Device], ["PIMATRIX_HDMI1_DEVICE", hdmi1Device]] as const) {
    if (value !== undefined && !/^[A-Za-z0-9._:/-]+$/.test(value)) {
      throw new Error(`${name} must be a DRM connector, device path or display name (letters, digits, . _ : / -), e.g. card1-HDMI-A-1`);
    }
  }
  const mediaMtxRtspUrl = optionalRtspUrl(env.PIMATRIX_MEDIAMTX_RTSP_URL, "PIMATRIX_MEDIAMTX_RTSP_URL");
  const piprogramUrl = optionalHttpUrl(env.PIMATRIX_PIPROGRAM_URL, "PIMATRIX_PIPROGRAM_URL");
  const piprogramApiKey = env.PIMATRIX_PIPROGRAM_API_KEY?.trim() || undefined;
  // "publish" (default): pimatrix polls piprogram and publishes PiPGM1-3 to MediaMTX itself.
  // "publish-off": piprogram publishes them (PIPGM_PUBLISH_RTSP_BASE); pimatrix only keeps the snapshots.
  const pipgmFeed = env.PIMATRIX_PIPGM_FEED?.trim() || "publish";
  if (pipgmFeed !== "publish" && pipgmFeed !== "publish-off") {
    throw new Error('PIMATRIX_PIPGM_FEED must be "publish" or "publish-off"');
  }
  const pipgmPollMs = positiveInteger(env.PIMATRIX_PIPGM_POLL_MS, 1000, "PIMATRIX_PIPGM_POLL_MS", 60000);
  const mediaMtxCacheMs = nonNegativeInteger(env.PIMATRIX_MEDIAMTX_CACHE_MS, 1000, "PIMATRIX_MEDIAMTX_CACHE_MS", 60000);
  const stillInput = env.PIMATRIX_STILL_INPUT?.trim().toLowerCase() || "raw";
  if (stillInput !== "raw" && stillInput !== "png") {
    throw new Error('PIMATRIX_STILL_INPUT must be "raw" or "png"');
  }
  const flag = (name: string): boolean | undefined => {
    const value = env[name]?.trim().toLowerCase();
    if (value === undefined || value === "") return undefined;
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    throw new Error(`${name} must be 1 or 0`);
  };
  const hdmi0Audio = flag("PIMATRIX_HDMI0_AUDIO");
  const hdmi1Audio = flag("PIMATRIX_HDMI1_AUDIO");
  const hdmi0AudioDevice = env.PIMATRIX_HDMI0_AUDIO_DEVICE?.trim() || undefined;
  const hdmi1AudioDevice = env.PIMATRIX_HDMI1_AUDIO_DEVICE?.trim() || undefined;
  for (const [name, value] of [["PIMATRIX_HDMI0_AUDIO_DEVICE", hdmi0AudioDevice], ["PIMATRIX_HDMI1_AUDIO_DEVICE", hdmi1AudioDevice]] as const) {
    if (value !== undefined && !/^[A-Za-z0-9._:,=/-]+$/.test(value)) {
      throw new Error(`${name} must be an ALSA device name (letters, digits, . _ : , = / -), e.g. hdmi:CARD=vc4hdmi0`);
    }
  }
  const compositeHdmiDevice = env.PIMATRIX_COMPOSITE_HDMI_DEVICE?.trim() || undefined;
  if (compositeHdmiDevice !== undefined && !/^[A-Za-z0-9._:/-]+$/.test(compositeHdmiDevice)) {
    throw new Error("PIMATRIX_COMPOSITE_HDMI_DEVICE must be a DRM connector, device path or display name (letters, digits, . _ : / -), e.g. card1-HDMI-A-2");
  }
  // auto = h264_v4l2m2m where it works, libx264 (CPU) otherwise; see src/encoder.ts.
  const compositeVideoCodecRaw = env.PIMATRIX_COMPOSITE_VIDEO_CODEC?.trim() || "auto";
  if (!isEncoderSetting(compositeVideoCodecRaw)) {
    throw new Error('PIMATRIX_COMPOSITE_VIDEO_CODEC must be "auto", "libx264" or "h264_v4l2m2m"');
  }
  const compositeVideoCodec: EncoderSetting = compositeVideoCodecRaw;
  const encoderFallbackRaw = env.PIMATRIX_ENCODER_FALLBACK?.trim().toLowerCase() || "on";
  if (encoderFallbackRaw !== "on" && encoderFallbackRaw !== "off") {
    throw new Error('PIMATRIX_ENCODER_FALLBACK must be "on" or "off"');
  }
  const encoderFallback = encoderFallbackRaw === "on";
  const compositeDataDir = env.PIMATRIX_COMPOSITE_DATA_DIR?.trim() || "./data/composite";
  const quickOptionsFile = env.PIMATRIX_QUICK_OPTIONS_FILE?.trim() || "./data/quick-options.json";
  const compositeFfmpeg = env.PIMATRIX_COMPOSITE_FFMPEG?.trim() || "ffmpeg";
  if (/\s/.test(compositeFfmpeg)) {
    throw new Error("PIMATRIX_COMPOSITE_FFMPEG must be a single executable name or path without spaces");
  }
  const atemMediaFillInput = validPort(env.PIMATRIX_ATEM_MEDIA_FILL_INPUT, 8010, "PIMATRIX_ATEM_MEDIA_FILL_INPUT");
  const gatewayUrl = optionalHttpUrl(env.PIMATRIX_GATEWAY_URL, "PIMATRIX_GATEWAY_URL");
  const gatewayApiKey = env.PIMATRIX_GATEWAY_API_KEY?.trim() || undefined;
  const atlonaInputs = parseAtlonaInputs(env.PIMATRIX_ATLONA_INPUTS);
  const paAtlonaOutput = Number(env.PIMATRIX_PA_ATLONA_OUTPUT?.trim() || 1);
  if (!Number.isInteger(paAtlonaOutput) || paAtlonaOutput < 1 || paAtlonaOutput > 8) {
    throw new Error("PIMATRIX_PA_ATLONA_OUTPUT must be a whole number from 1 to 8");
  }
  if (/\s/.test(hdmiPlayer)) {
    throw new Error("PIMATRIX_HDMI_PLAYER must be a single executable name or path without spaces");
  }

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
  if (hamaVideoCodec !== undefined && hamaVideoCodec !== "copy" && hamaVideoCodec !== "auto" && hamaVideoCodec !== "libx264" && hamaVideoCodec !== "h264_v4l2m2m") {
    throw new Error('PIMATRIX_HAMA_VIDEO_CODEC must be "copy", "auto", "libx264" or "h264_v4l2m2m"');
  }
  if (streamRestartMaxMs < streamRestartMinMs) {
    throw new Error("PIMATRIX_STREAM_RESTART_MAX_MS must be greater than or equal to PIMATRIX_STREAM_RESTART_MIN_MS");
  }

  return {
    host, port, mode, hamaEnabled, hamaDevice,
    streamRestartMinMs, streamRestartMaxMs,
    displayMode,
    amxTcpEnabled, amxTcpHost, amxTcpPort,
    cam1Name,
    cam2Name,
    cam3Name,
    ...(hamaInputFormat ? { hamaInputFormat } : {}),
    ...(hamaWidth !== undefined ? { hamaWidth } : {}),
    ...(hamaHeight !== undefined ? { hamaHeight } : {}),
    ...(hamaFrameRate !== undefined ? { hamaFrameRate } : {}),
    ...(hamaVideoCodec ? { hamaVideoCodec } : {}),
    ...(mediaMtxApiUrl ? { mediaMtxApiUrl } : {}),
    ...(previewBaseUrl ? { previewBaseUrl } : {}),
    ...(fffleetUrl ? { fffleetUrl } : {}),
    ...(fffleetToken ? { fffleetToken } : {}),
    ...(fffleetClientId ? { fffleetClientId } : {}),
    ...(fffleetClientSecret ? { fffleetClientSecret } : {}),
    ...(hamaRtspUrl ? { hamaRtspUrl } : {}),
    hamaIdleGraceMs: hamaIdleGraceSeconds * 1000,
    hamaSettingsFile: env.PIMATRIX_HAMA_SETTINGS_FILE?.trim() ?? "./data/hama-settings.json",
    ...(apiKey ? { apiKey } : {}),
    ...(amxAllowedHosts && amxAllowedHosts.length > 0 ? { amxAllowedHosts } : {}),
    ...(mediaMtxPassword ? { mediaMtxPassword } : {}),
    ...(authAllowedHosts && authAllowedHosts.length > 0 ? { authAllowedHosts } : {}),
    ...(corsOrigins && corsOrigins.length > 0 ? { corsOrigins } : {}),
    ...(domain ? { domain } : {}),
    ...(tlsPort !== undefined ? { tlsPort } : {}),
    ...(letsencryptEmail ? { letsencryptEmail } : {}),
    hdmiPlayer,
    ...(hdmi0Device ? { hdmi0Device } : {}),
    ...(hdmi1Device ? { hdmi1Device } : {}),
    ...(hdmi0Audio !== undefined ? { hdmi0Audio } : {}),
    ...(hdmi1Audio !== undefined ? { hdmi1Audio } : {}),
    ...(hdmi0AudioDevice ? { hdmi0AudioDevice } : {}),
    ...(hdmi1AudioDevice ? { hdmi1AudioDevice } : {}),
    pipgmFeed,
    pipgmPollMs,
    mediaMtxCacheMs,
    stillInput,
    ...(hdmiSdlVideoDriver ? { hdmiSdlVideoDriver } : {}),
    ...(hdmiDecoder ? { hdmiDecoder } : {}),
    ...(mediaMtxRtspUrl ? { mediaMtxRtspUrl } : {}),
    ...(piprogramUrl ? { piprogramUrl } : {}),
    ...(piprogramApiKey ? { piprogramApiKey } : {}),
    ...(compositeHdmiDevice ? { compositeHdmiDevice } : {}),
    compositeDataDir,
    quickOptionsFile,
    compositeVideoCodec,
    encoderFallback,
    compositeFfmpeg,
    atemMediaFillInput,
    atlonaInputs,
    paAtlonaOutput,
    ...(gatewayUrl ? { gatewayUrl: gatewayUrl.replace(/\/$/, "") } : {}),
    ...(gatewayApiKey ? { gatewayApiKey } : {})
  };
}
