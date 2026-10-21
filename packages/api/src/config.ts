export type RuntimeMode = "simulation" | "production";

export interface AppConfig {
  host: string;
  port: number;
  mode: RuntimeMode;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = env.PIMATRIX_HOST?.trim() || "127.0.0.1";
  const port = Number(env.PIMATRIX_PORT ?? "3000");
  const mode = env.PIMATRIX_MODE ?? "simulation";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PIMATRIX_PORT must be an integer between 1 and 65535");
  }
  if (mode !== "simulation" && mode !== "production") {
    throw new Error('PIMATRIX_MODE must be "simulation" or "production"');
  }
  if (!host || /\s/.test(host)) {
    throw new Error("PIMATRIX_HOST must be a non-empty hostname or IP address");
  }
  return { host, port, mode };
}
