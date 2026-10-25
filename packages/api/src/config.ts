export type RuntimeMode = "simulation" | "production";
export type HamaVideoCodec = "copy" | "libx264" | "h264_v4l2m2m";
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
  streamRestartMinMs: number;
  streamRestartMaxMs: number;
  displayMode: DisplayMode;
  amxTcpEnabled: boolean;
  amxTcpHost: string;
  amxTcpPort: number;
  amxSimulated: boolean;
  amxMasterHost?: string;
  amxMasterPort: number;
  cameraMode: "simulated" | "hardware";
  cam1Name: string;
  cam1Host?: string;
  cam1ViscaPort: number;
  cam1CgiPort: number;
  /** HTTP Basic login for the camera CGI (PIMATRIX_CAM1_USER/PASSWORD). Never logged. */
  cam1CgiUser?: string;
  cam1CgiPassword?: string;
  cam2Name: string;
  cam2Host?: string;
  cam2ViscaPort: number;
  cam2CgiPort: number;
  cam2CgiUser?: string;
  cam2CgiPassword?: string;
  cam3Name: string;
  canvaApiBaseUrl?: string;
  canvaAccessToken?: string;
  apiKey?: string;
  amxAllowedHosts?: string[];
  canvaAppToken?: string;
  mediaMtxPassword?: string;
  authAllowedHosts?: string[];
  /** Browser origins allowed to call /api/v1 cross-origin (PIMATRIX_CORS_ORIGINS). Empty = no CORS. */
  corsOrigins?: string[];
  domain?: string;
  tlsPort?: number;
  letsencryptEmail?: string;
  atemHost?: string;
  atemPort: number;
  hdmiPlayer: string;
  hdmi0Device?: string;
  hdmi1Device?: string;
  hdmiSdlVideoDriver?: string;
  mediaMtxRtspUrl?: string;
  /** DRM connector for the HDMI key output of the slide composite (PIMATRIX_COMPOSITE_HDMI_DEVICE). */
  compositeHdmiDevice?: string;
  /** Encoder for the compose1 RTSP publisher. */
  compositeVideoCodec: "libx264" | "h264_v4l2m2m";
  /** Directory for the composite slide, key page files and settings (PIMATRIX_COMPOSITE_DATA_DIR). */
  compositeDataDir: string;
  /** ffmpeg used to render key pages (PIMATRIX_COMPOSITE_FFMPEG). */
  compositeFfmpeg: string;
  /** ATEM input number of media player 1's fill (PIMATRIX_ATEM_MEDIA_FILL_INPUT); key is the next number. */
  atemMediaFillInput: number;
  /** RTMP ingest base for the camera targets (e.g. rtmp://<pi-lan-ip>:1935); cam1/cam2 are appended. */
  mediaMtxRtmpUrl?: string;
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

function optionalRtmpUrl(value: string | undefined, name: string): string | undefined {
  if (!value?.trim()) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} must be a valid RTMP URL`);
  }
  if (parsed.protocol !== "rtmp:" || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error(`${name} must be an RTMP URL without embedded credentials, a query or a fragment`);
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

  const rawDisplayMode = env.PIMATRIX_DISPLAY_MODE?.trim() || (env.PIMATRIX_DISPLAY_SIMULATED === "true" ? "simulated" : "disabled");
  if (!["simulated", "hardware", "disabled"].includes(rawDisplayMode)) {
    throw new Error('PIMATRIX_DISPLAY_MODE must be "simulated", "hardware", or "disabled"');
  }
  const displayMode = rawDisplayMode as DisplayMode;

  const amxTcpEnabled = env.PIMATRIX_AMX_TCP_ENABLED === "true" || env.PIMATRIX_AMX_TCP_PORT !== undefined;
  const amxTcpHost = env.PIMATRIX_AMX_TCP_HOST?.trim() || "127.0.0.1";
  const amxTcpPort = validPort(env.PIMATRIX_AMX_TCP_PORT, 6600, "PIMATRIX_AMX_TCP_PORT", true);
  const amxSimulated = env.PIMATRIX_AMX_SIMULATED === "true";
  const amxMasterHost = env.PIMATRIX_AMX_MASTER_HOST?.trim() || undefined;
  const amxMasterPort = validPort(env.PIMATRIX_AMX_MASTER_PORT, 6501, "PIMATRIX_AMX_MASTER_PORT");

  const rawCameraMode = env.PIMATRIX_CAMERA_MODE?.trim() || "simulated";
  if (!["simulated", "hardware"].includes(rawCameraMode)) {
    throw new Error('PIMATRIX_CAMERA_MODE must be "simulated" or "hardware"');
  }
  const cameraMode = rawCameraMode as "simulated" | "hardware";
  const cam1Name = env.PIMATRIX_CAM1_NAME?.trim() || "Camera 1";
  const cam1Host = env.PIMATRIX_CAM1_HOST?.trim() || undefined;
  const cam1ViscaPort = validPort(env.PIMATRIX_CAM1_VISCA_PORT, 52381, "PIMATRIX_CAM1_VISCA_PORT");
  const cam1CgiPort = validPort(env.PIMATRIX_CAM1_CGI_PORT, 80, "PIMATRIX_CAM1_CGI_PORT");
  const cam1Login = cameraLogin(env, "PIMATRIX_CAM1");
  const cam2Name = env.PIMATRIX_CAM2_NAME?.trim() || "Camera 2";
  const cam2Host = env.PIMATRIX_CAM2_HOST?.trim() || undefined;
  const cam2ViscaPort = validPort(env.PIMATRIX_CAM2_VISCA_PORT, 52381, "PIMATRIX_CAM2_VISCA_PORT");
  const cam2CgiPort = validPort(env.PIMATRIX_CAM2_CGI_PORT, 80, "PIMATRIX_CAM2_CGI_PORT");
  const cam2Login = cameraLogin(env, "PIMATRIX_CAM2");
  const cam3Name = env.PIMATRIX_CAM3_NAME?.trim() || "Camera 3";

  const canvaAccessToken = env.CANVA_ACCESS_TOKEN?.trim() || undefined;
  const apiKey = env.PIMATRIX_API_KEY?.trim() || undefined;
  const amxAllowedHosts = env.PIMATRIX_AMX_ALLOWED_HOSTS
    ? env.PIMATRIX_AMX_ALLOWED_HOSTS.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const canvaAppToken = env.PIMATRIX_CANVA_APP_TOKEN?.trim() || undefined;
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
  const atemHost = env.PIMATRIX_ATEM_HOST?.trim() || undefined;
  const atemPort = validPort(env.PIMATRIX_ATEM_PORT, 9910, "PIMATRIX_ATEM_PORT");
  const hdmiPlayer = env.PIMATRIX_HDMI_PLAYER?.trim() || "ffplay";
  const hdmi0Device = env.PIMATRIX_HDMI0_DEVICE?.trim() || undefined;
  const hdmi1Device = env.PIMATRIX_HDMI1_DEVICE?.trim() || undefined;
  // SDL video driver for the players; kmsdrm is the headless Pi default. Set empty to inherit.
  const hdmiSdlVideoDriver =
    env.PIMATRIX_HDMI_SDL_VIDEODRIVER === undefined ? "kmsdrm" : env.PIMATRIX_HDMI_SDL_VIDEODRIVER.trim() || undefined;
  for (const [name, value] of [["PIMATRIX_HDMI0_DEVICE", hdmi0Device], ["PIMATRIX_HDMI1_DEVICE", hdmi1Device]] as const) {
    if (value !== undefined && !/^[A-Za-z0-9._:/-]+$/.test(value)) {
      throw new Error(`${name} must be a DRM connector, device path or display name (letters, digits, . _ : / -), e.g. card1-HDMI-A-1`);
    }
  }
  const mediaMtxRtspUrl = optionalRtspUrl(env.PIMATRIX_MEDIAMTX_RTSP_URL, "PIMATRIX_MEDIAMTX_RTSP_URL");
  const compositeHdmiDevice = env.PIMATRIX_COMPOSITE_HDMI_DEVICE?.trim() || undefined;
  if (compositeHdmiDevice !== undefined && !/^[A-Za-z0-9._:/-]+$/.test(compositeHdmiDevice)) {
    throw new Error("PIMATRIX_COMPOSITE_HDMI_DEVICE must be a DRM connector, device path or display name (letters, digits, . _ : / -), e.g. card1-HDMI-A-2");
  }
  const compositeVideoCodec = env.PIMATRIX_COMPOSITE_VIDEO_CODEC?.trim() || "libx264";
  if (compositeVideoCodec !== "libx264" && compositeVideoCodec !== "h264_v4l2m2m") {
    throw new Error('PIMATRIX_COMPOSITE_VIDEO_CODEC must be "libx264" or "h264_v4l2m2m"');
  }
  const compositeDataDir = env.PIMATRIX_COMPOSITE_DATA_DIR?.trim() || "./data/composite";
  const compositeFfmpeg = env.PIMATRIX_COMPOSITE_FFMPEG?.trim() || "ffmpeg";
  if (/\s/.test(compositeFfmpeg)) {
    throw new Error("PIMATRIX_COMPOSITE_FFMPEG must be a single executable name or path without spaces");
  }
  const atemMediaFillInput = validPort(env.PIMATRIX_ATEM_MEDIA_FILL_INPUT, 8010, "PIMATRIX_ATEM_MEDIA_FILL_INPUT");
  const mediaMtxRtmpUrl = optionalRtmpUrl(env.PIMATRIX_MEDIAMTX_RTMP_URL, "PIMATRIX_MEDIAMTX_RTMP_URL");
  if (/\s/.test(hdmiPlayer)) {
    throw new Error("PIMATRIX_HDMI_PLAYER must be a single executable name or path without spaces");
  }
  const canvaApiBaseUrl =
    optionalHttpUrl(env.CANVA_API_BASE_URL, "CANVA_API_BASE_URL") ??
    (canvaAccessToken ? "https://api.canva.com/rest" : undefined);

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
  if (hamaVideoCodec !== undefined && hamaVideoCodec !== "copy" && hamaVideoCodec !== "libx264" && hamaVideoCodec !== "h264_v4l2m2m") {
    throw new Error('PIMATRIX_HAMA_VIDEO_CODEC must be "copy", "libx264" or "h264_v4l2m2m"');
  }
  if (streamRestartMaxMs < streamRestartMinMs) {
    throw new Error("PIMATRIX_STREAM_RESTART_MAX_MS must be greater than or equal to PIMATRIX_STREAM_RESTART_MIN_MS");
  }

  return {
    host, port, mode, hamaEnabled, hamaDevice,
    streamRestartMinMs, streamRestartMaxMs,
    displayMode,
    amxTcpEnabled, amxTcpHost, amxTcpPort,
    amxSimulated,
    ...(amxMasterHost ? { amxMasterHost } : {}),
    amxMasterPort,
    cameraMode,
    cam1Name,
    cam1ViscaPort,
    cam1CgiPort,
    ...(cam1Login ? { cam1CgiUser: cam1Login.user, cam1CgiPassword: cam1Login.password } : {}),
    cam2Name,
    cam2ViscaPort,
    cam2CgiPort,
    ...(cam2Login ? { cam2CgiUser: cam2Login.user, cam2CgiPassword: cam2Login.password } : {}),
    cam3Name,
    ...(cam1Host ? { cam1Host } : {}),
    ...(cam2Host ? { cam2Host } : {}),
    ...(canvaApiBaseUrl ? { canvaApiBaseUrl } : {}),
    ...(canvaAccessToken ? { canvaAccessToken } : {}),
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
    ...(apiKey ? { apiKey } : {}),
    ...(amxAllowedHosts && amxAllowedHosts.length > 0 ? { amxAllowedHosts } : {}),
    ...(canvaAppToken ? { canvaAppToken } : {}),
    ...(mediaMtxPassword ? { mediaMtxPassword } : {}),
    ...(authAllowedHosts && authAllowedHosts.length > 0 ? { authAllowedHosts } : {}),
    ...(corsOrigins && corsOrigins.length > 0 ? { corsOrigins } : {}),
    ...(domain ? { domain } : {}),
    ...(tlsPort !== undefined ? { tlsPort } : {}),
    ...(letsencryptEmail ? { letsencryptEmail } : {}),
    ...(atemHost ? { atemHost } : {}),
    atemPort,
    hdmiPlayer,
    ...(hdmi0Device ? { hdmi0Device } : {}),
    ...(hdmi1Device ? { hdmi1Device } : {}),
    ...(hdmiSdlVideoDriver ? { hdmiSdlVideoDriver } : {}),
    ...(mediaMtxRtspUrl ? { mediaMtxRtspUrl } : {}),
    ...(compositeHdmiDevice ? { compositeHdmiDevice } : {}),
    compositeDataDir,
    compositeVideoCodec,
    compositeFfmpeg,
    atemMediaFillInput,
    ...(mediaMtxRtmpUrl ? { mediaMtxRtmpUrl } : {})
  };
}

/** Camera CGI login from PREFIX_USER and PREFIX_PASSWORD. Both or neither: one alone is a config error. */
function cameraLogin(env: NodeJS.ProcessEnv, prefix: string): { user: string; password: string } | undefined {
  const user = env[`${prefix}_USER`]?.trim() || undefined;
  const password = env[`${prefix}_PASSWORD`]?.trim() || undefined;
  if (!user && !password) return undefined;
  if (!user || !password) {
    throw new Error(`${prefix}_USER and ${prefix}_PASSWORD must be set together`);
  }
  return { user, password };
}
