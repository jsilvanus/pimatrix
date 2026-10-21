export interface CliOptions {
  server: string;
  json: boolean;
  command: string[];
  panSpeed?: number;
  tiltSpeed?: number;
  speed?: number;
  name?: string;
}

export function parseArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let server = env.PIMATRIX_URL ?? "http://127.0.0.1:3000";
  let json = false;
  let panSpeed: number | undefined;
  let tiltSpeed: number | undefined;
  let speed: number | undefined;
  let name: string | undefined;
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
    ...(name !== undefined ? { name } : {})
  };
}
