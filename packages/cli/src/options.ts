export interface CliOptions {
  server: string;
  json: boolean;
  command: string[];
  panSpeed?: number;
  tiltSpeed?: number;
  speed?: number;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  aspectRatio?: string;
  delta?: number;
  factor?: number;
  rotation?: number;
  enabled?: boolean;
}

export function parseArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let server = env.PIMATRIX_URL ?? "http://127.0.0.1:3000";
  let json = false;
  let panSpeed: number | undefined;
  let tiltSpeed: number | undefined;
  let speed: number | undefined;
  let name: string | undefined;
  let x: number | undefined;
  let y: number | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let sourceWidth: number | undefined;
  let sourceHeight: number | undefined;
  let aspectRatio: string | undefined;
  let delta: number | undefined;
  let factor: number | undefined;
  let rotation: number | undefined;
  let enabled: boolean | undefined;
  const command: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") command.push("help");
    else if (arg === "--server") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--server requires a URL");
      server = value;
      index += 1;
    } else if (arg === "--pan-speed") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--pan-speed requires a number");
      panSpeed = Number(value);
      index += 1;
    } else if (arg === "--tilt-speed") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--tilt-speed requires a number");
      tiltSpeed = Number(value);
      index += 1;
    } else if (arg === "--speed") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--speed requires a number");
      speed = Number(value);
      index += 1;
    } else if (arg === "--name") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--name requires a string");
      name = value;
      index += 1;
    } else if (arg === "--x") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--x requires a number");
      x = Number(value);
      index += 1;
    } else if (arg === "--y") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--y requires a number");
      y = Number(value);
      index += 1;
    } else if (arg === "--width" || arg === "--w") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--width requires a number");
      width = Number(value);
      index += 1;
    } else if (arg === "--height" || arg === "--h") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--height requires a number");
      height = Number(value);
      index += 1;
    } else if (arg === "--source-width" || arg === "--sw") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source-width requires a number");
      sourceWidth = Number(value);
      index += 1;
    } else if (arg === "--source-height" || arg === "--sh") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source-height requires a number");
      sourceHeight = Number(value);
      index += 1;
    } else if (arg === "--aspect") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--aspect requires a ratio (e.g. 9:16)");
      aspectRatio = value;
      index += 1;
    } else if (arg === "--delta") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--delta requires a number");
      delta = Number(value);
      index += 1;
    } else if (arg === "--factor") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--factor requires a number");
      factor = Number(value);
      index += 1;
    } else if (arg === "--rotation") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--rotation requires a number");
      rotation = Number(value);
      index += 1;
    } else if (arg === "--enabled") {
      const value = args[index + 1];
      if (value !== "true" && value !== "false") throw new Error("--enabled requires 'true' or 'false'");
      enabled = value === "true";
      index += 1;
    } else if (arg?.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else if (arg) command.push(arg);
  }

  let parsed: URL;
  try {
    parsed = new URL(server);
  } catch {
    throw new Error("Server URL must be a valid absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Server URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) throw new Error("Do not put credentials in the server URL");

  return {
    server: parsed.toString().replace(/\/$/, ""),
    json,
    command,
    ...(panSpeed !== undefined ? { panSpeed } : {}),
    ...(tiltSpeed !== undefined ? { tiltSpeed } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(sourceWidth !== undefined ? { sourceWidth } : {}),
    ...(sourceHeight !== undefined ? { sourceHeight } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(delta !== undefined ? { delta } : {}),
    ...(factor !== undefined ? { factor } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(enabled !== undefined ? { enabled } : {})
  };
}
