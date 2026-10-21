export type RuntimeMode = "simulation" | "production";

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
  return {
    host,
    port,
    mode,
    ...(mediaMtxApiUrl ? { mediaMtxApiUrl } : {}),
    ...(previewBaseUrl ? { previewBaseUrl } : {}),
    ...(fffleetUrl ? { fffleetUrl } : {}),
    ...(fffleetToken ? { fffleetToken } : {}),
    ...(fffleetClientId ? { fffleetClientId } : {}),
    ...(fffleetClientSecret ? { fffleetClientSecret } : {})
  };
}
