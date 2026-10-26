import { createServer, type Server, type Socket } from "node:net";
import type { FastifyBaseLogger } from "fastify";
import type { DisplayAdapter } from "../display-adapter.js";
import type { PiMatrixEventBroker } from "../events.js";
import {
  outputDefinitions,
  sourceDefinitions,
  type OutputId,
  type OutputStore,
  type SourceId
} from "../model.js";

/** What the AMX commands CAM, QUICK, PROGRAM and STATUS:ALL act on (wired in app.ts). */
export interface AmxControl {
  cameras(): Array<{ id: string; connection: string; power: "on" | "standby" | "unknown" }>;
  cameraPower(id: string, on: boolean): Promise<void>;
  cameraPreset(id: string, presetId: number, save: boolean): Promise<void>;
  cameraMove(id: string, direction: string): Promise<void>;
  cameraZoom(id: string, action: string): Promise<void>;
  quickOptions(): Array<{ number: number; name: string }>;
  runQuickOption(number: number): Promise<void>;
  /** "unavailable" when piprogram is not configured. */
  program(): "on" | "off" | "unavailable";
  setProgram(on: boolean): Promise<void>;
  /** Atlona output 1..4 -> input, as pimatrix last knew it. */
  atlonaRoutes(): Record<number, number | null>;
}

export interface AmxListenerOptions {
  control?: AmxControl | undefined;
  host: string;
  port: number;
  outputStore: OutputStore;
  displayAdapter: DisplayAdapter;
  eventBroker?: PiMatrixEventBroker | undefined;
  listSources: () => Promise<Array<{ id: SourceId; state: string; preview: { available: boolean } }>>;
  mode: string;
  logger?: FastifyBaseLogger | undefined;
  allowedIps?: string[] | undefined;
}

const KNOWN_COMMANDS = new Set(["DEV", "PING", "STATUS", "SOURCE", "OUTPUT", "CAM", "QUICK", "PROGRAM", "HELP"]);
const MOVE_DIRECTIONS = new Set(["up", "down", "left", "right", "upleft", "upright", "downleft", "downright", "stop", "home"]);
const ZOOM_ACTIONS = new Set(["in", "out", "stop"]);

/** Keeps a name inside one key=value field of a reply. */
function wireText(value: string): string {
  return value.replace(/[;:,=\r\n]/g, " ").trim();
}

export class AmxTcpListener {
  private server: Server | null = null;
  private readonly clients = new Set<Socket>();
  private readonly options: AmxListenerOptions;
  private boundPort: number | null = null;

  constructor(options: AmxListenerOptions) {
    this.options = options;
  }

  get port(): number | null {
    return this.boundPort;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.handleClient(socket));
      this.server = server;

      server.on("error", (err) => {
        this.options.logger?.error({ err }, "AMX TCP listener server error");
        reject(err);
      });

      server.listen(this.options.port, this.options.host, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          this.boundPort = address.port;
        } else {
          this.boundPort = this.options.port;
        }
        this.options.logger?.info(
          { host: this.options.host, port: this.boundPort },
          "AMX TCP listener started"
        );
        resolve(this.boundPort);
      });
    });
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
      this.boundPort = null;
    }
  }

  private handleClient(socket: Socket): void {
    const rawIp = socket.remoteAddress;
    const remoteIp = rawIp ? rawIp.replace(/^::ffff:/, "") : undefined;
    if (this.options.allowedIps && this.options.allowedIps.length > 0) {
      const allowed = this.options.allowedIps.map((ip) => ip.trim());
      const isAllowed = remoteIp && (
        allowed.includes(remoteIp) ||
        (allowed.includes("localhost") && (remoteIp === "127.0.0.1" || remoteIp === "::1"))
      );
      if (!isAllowed) {
        this.options.logger?.warn(
          { remoteAddress: rawIp, remoteIp },
          "Rejected AMX connection from non-whitelisted address"
        );
        socket.destroy();
        return;
      }
    }
    this.clients.add(socket);
    let buffer = "";

    socket.setEncoding("utf8");

    socket.on("data", async (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 2048) {
        buffer = "";
        this.send(socket, "ERR:LINE_TOO_LONG");
        return;
      }

      while (buffer.includes(";")) {
        const index = buffer.indexOf(";");
        const rawCmd = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);

        if (rawCmd.length === 0) continue;

        try {
          const response = await this.dispatch(rawCmd);
          if (response) {
            this.send(socket, response);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
          this.send(socket, `ERR:DISPATCH_FAILED:${message}`);
        }
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
    });

    socket.on("error", (err) => {
      this.options.logger?.warn({ err }, "AMX TCP client socket error");
      this.clients.delete(socket);
    });
  }

  private send(socket: Socket, payload: string): void {
    if (!socket.destroyed) {
      socket.write(`${payload};\r\n`);
    }
  }

  private async dispatch(raw: string): Promise<string> {
    const parts = raw.split(":").map((p) => p.trim());
    if (parts.length === 0 || !parts[0]) {
      return "ERR:EMPTY_COMMAND";
    }

    let msgId: string | null = null;
    let cmd = (parts[0] ?? "").toUpperCase();
    let args = parts.slice(1);

    if (!KNOWN_COMMANDS.has(cmd) && parts.length > 1 && KNOWN_COMMANDS.has(parts[1]?.toUpperCase() ?? "")) {
      msgId = parts[0] ?? null;
      cmd = (parts[1] ?? "").toUpperCase();
      args = parts.slice(2);
    }

    const wrap = (res: string) => (msgId ? `${msgId}:${res}` : res);

    if (cmd === "DEV" && args[0]?.toUpperCase() === "VERSION") {
      return wrap("DEV:VERSION:1");
    }

    if (cmd === "PING") {
      return wrap("PONG");
    }

    if (cmd === "STATUS" && args[0]?.toUpperCase() === "ALL") {
      return wrap(`STATUS:ALL:${await this.statusAll()}`);
    }

    if (cmd === "STATUS") {
      return wrap(`STATUS:OK:mode=${this.options.mode},sources=8,outputs=2`);
    }

    if (cmd === "SOURCE") {
      const sub = args[0]?.toUpperCase();
      if (sub === "LIST") {
        const sources = await this.options.listSources();
        const formatted = sources.map((s) => `${s.id}=${s.state}`).join(",");
        return wrap(`SOURCE:LIST:${formatted}`);
      }
      if (sub === "GET") {
        const sourceId = args[1];
        if (!sourceId || !sourceDefinitions.some((s) => s.id === sourceId)) {
          return wrap(`ERR:SOURCE_NOT_FOUND:${sourceId ?? "missing"}`);
        }
        const sources = await this.options.listSources();
        const found = sources.find((s) => s.id === sourceId);
        if (!found) return wrap(`ERR:SOURCE_NOT_FOUND:${sourceId}`);
        return wrap(`SOURCE:${found.id}:${found.state}:${found.preview.available ? "1" : "0"}`);
      }
      return wrap("ERR:UNKNOWN_SOURCE_ACTION");
    }

    if (cmd === "OUTPUT") {
      const sub = args[0]?.toUpperCase();
      if (sub === "LIST") {
        const outputs = this.options.outputStore.list();
        const formatted = outputs
          .map((o) => `${o.id}=${o.desiredSource ?? "none"}:${o.observedSource ?? "none"}:${o.state}`)
          .join(",");
        return wrap(`OUTPUT:LIST:${formatted}`);
      }
      if (sub === "SET") {
        const outputId = args[1];
        const requestedSource = args[2];

        if (!outputId || !outputDefinitions.some((o) => o.id === outputId)) {
          return wrap(`ERR:OUTPUT_NOT_FOUND:${outputId ?? "missing"}`);
        }

        const sourceId: SourceId | null =
          !requestedSource || requestedSource.toLowerCase() === "none" || requestedSource.toLowerCase() === "null"
            ? null
            : (requestedSource as SourceId);

        if (sourceId !== null && !sourceDefinitions.some((s) => s.id === sourceId)) {
          return wrap(`ERR:INVALID_SOURCE:${requestedSource}`);
        }

        const updated = this.options.outputStore.setDesiredSource(outputId, sourceId);
        if (!updated) return wrap(`ERR:OUTPUT_NOT_FOUND:${outputId}`);

        const observed = await this.options.displayAdapter.applyRoute(outputId as OutputId, sourceId);
        this.options.outputStore.setObservedState(outputId, observed.observedSource, observed.state);

        const currentOutput = this.options.outputStore.get(outputId as OutputId);
        if (currentOutput && this.options.eventBroker) {
          this.options.eventBroker.emit({
            type: "output",
            data: { output: currentOutput }
          });
        }

        return wrap(`OUTPUT:OK:${outputId}:${sourceId ?? "none"}`);
      }
      return wrap("ERR:UNKNOWN_OUTPUT_ACTION");
    }


    if (cmd === "CAM" || cmd === "QUICK" || cmd === "PROGRAM") {
      const control = this.options.control;
      if (!control) return wrap(`ERR:${cmd}_UNAVAILABLE`);
      if (cmd === "CAM") return wrap(await this.dispatchCamera(control, args));
      if (cmd === "QUICK") return wrap(await this.dispatchQuick(control, args));
      return wrap(await this.dispatchProgram(control, args));
    }

    if (cmd === "HELP") {
      return wrap(
        "HELP:COMMANDS=DEV:VERSION,PING,STATUS,STATUS:ALL,SOURCE:LIST,SOURCE:GET,OUTPUT:LIST,OUTPUT:SET," +
          "CAM:LIST,CAM:<id|ALL>:POWER:ON|OFF,CAM:<id>:PRESET|SAVE:<n>,CAM:<id>:MOVE:<dir>,CAM:<id>:ZOOM:IN|OUT|STOP," +
          "QUICK:LIST,QUICK:RUN:<n>,PROGRAM:ON|OFF|STATUS"
      );
    }

    return wrap(`ERR:UNKNOWN_COMMAND:${cmd}`);
  }

  private async statusAll(): Promise<string> {
    const fields: string[] = [`mode=${this.options.mode}`];
    for (const o of this.options.outputStore.list()) {
      fields.push(`${o.id}=${o.observedSource ?? "none"}`, `${o.id}state=${o.state}`);
    }
    const control = this.options.control;
    if (control) {
      for (const cam of control.cameras()) {
        fields.push(`${cam.id}pwr=${cam.power}`, `${cam.id}link=${cam.connection}`);
      }
      const routes = control.atlonaRoutes();
      fields.push(`atlona=${[1, 2, 3, 4].map((out) => routes[out] ?? 0).join("/")}`);
      fields.push(`program=${control.program()}`);
    }
    return fields.join(",");
  }

  private async dispatchCamera(control: AmxControl, args: string[]): Promise<string> {
    const first = args[0] ?? "";
    if (first.toUpperCase() === "LIST") {
      return `CAM:LIST:${control.cameras().map((c) => `${c.id}=${c.power}/${c.connection}`).join(",")}`;
    }
    const known = control.cameras().map((c) => c.id);
    const lower = first.toLowerCase();
    const wanted = lower === "all" ? "all" : /^\d+$/.test(lower) ? `cam${lower}` : lower;
    if (wanted !== "all" && !known.includes(wanted)) return `ERR:CAMERA_NOT_FOUND:${first || "missing"}`;
    const targets = wanted === "all" ? known : [wanted];
    const action = args[1]?.toUpperCase();
    const value = args[2]?.toLowerCase() ?? "";

    if (action === "POWER") {
      if (value !== "on" && value !== "off") return "ERR:INVALID_POWER";
      for (const id of targets) await control.cameraPower(id, value === "on");
      return `CAM:OK:${wanted}:POWER:${value.toUpperCase()}`;
    }
    if (wanted === "all") return "ERR:CAMERA_REQUIRED";
    const id = targets[0] as string;
    if (action === "PRESET" || action === "SAVE") {
      const preset = Number(value);
      if (!/^\d+$/.test(value) || preset > 254) return "ERR:INVALID_PRESET";
      await control.cameraPreset(id, preset, action === "SAVE");
      return `CAM:OK:${id}:${action}:${preset}`;
    }
    if (action === "MOVE") {
      if (!MOVE_DIRECTIONS.has(value)) return "ERR:INVALID_DIRECTION";
      await control.cameraMove(id, value);
      return `CAM:OK:${id}:MOVE:${value.toUpperCase()}`;
    }
    if (action === "ZOOM") {
      if (!ZOOM_ACTIONS.has(value)) return "ERR:INVALID_ZOOM";
      await control.cameraZoom(id, value);
      return `CAM:OK:${id}:ZOOM:${value.toUpperCase()}`;
    }
    return "ERR:UNKNOWN_CAMERA_ACTION";
  }

  private async dispatchQuick(control: AmxControl, args: string[]): Promise<string> {
    const sub = args[0]?.toUpperCase();
    if (sub === "LIST") {
      return `QUICK:LIST:${control.quickOptions().map((q) => `${q.number}=${wireText(q.name)}`).join(",")}`;
    }
    if (sub === "RUN") {
      const raw = args[1] ?? "";
      const number = Number(raw);
      if (!/^\d+$/.test(raw) || !control.quickOptions().some((q) => q.number === number)) {
        return `ERR:QUICK_NOT_FOUND:${raw || "missing"}`;
      }
      await control.runQuickOption(number);
      return `QUICK:OK:${number}`;
    }
    return "ERR:UNKNOWN_QUICK_ACTION";
  }

  private async dispatchProgram(control: AmxControl, args: string[]): Promise<string> {
    const state = control.program();
    if (state === "unavailable") return "ERR:PROGRAM_UNAVAILABLE";
    const sub = args[0]?.toUpperCase();
    if (sub === "STATUS") return `PROGRAM:STATUS:${state.toUpperCase()}`;
    if (sub !== "ON" && sub !== "OFF") return "ERR:UNKNOWN_PROGRAM_ACTION";
    await control.setProgram(sub === "ON");
    return `PROGRAM:OK:${sub}`;
  }
}
