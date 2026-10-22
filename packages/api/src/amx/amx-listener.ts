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
import type { PiPgmService } from "../pipgm/pipgm-service.js";

export interface AmxListenerOptions {
  host: string;
  port: number;
  outputStore: OutputStore;
  displayAdapter: DisplayAdapter;
  pipgmService?: PiPgmService | undefined;
  eventBroker?: PiMatrixEventBroker | undefined;
  listSources: () => Promise<Array<{ id: SourceId; state: string; preview: { available: boolean } }>>;
  mode: string;
  logger?: FastifyBaseLogger | undefined;
}

const KNOWN_COMMANDS = new Set(["DEV", "PING", "STATUS", "SOURCE", "OUTPUT", "PIPGM", "HELP"]);

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

    if (cmd === "PIPGM" && this.options.pipgmService) {
      const sub = args[0]?.toUpperCase();
      const pipelineId = args[1] ?? "PiPGM1";
      if (!this.options.pipgmService.isValidPipelineId(pipelineId)) {
        return wrap(`ERR:PIPGM_NOT_FOUND:${pipelineId}`);
      }
      if (sub === "NEXT") {
        const res = this.options.pipgmService.control(pipelineId, { action: "next" });
        return wrap(`PIPGM:OK:${pipelineId}:NEXT:step=${res?.currentStep ?? 0}`);
      }
      if (sub === "PREV" || sub === "BACK") {
        const res = this.options.pipgmService.control(pipelineId, { action: "prev" });
        return wrap(`PIPGM:OK:${pipelineId}:PREV:step=${res?.currentStep ?? 0}`);
      }
      if (sub === "FTB") {
        const modeArg = args[2]?.toLowerCase() ?? "toggle";
        const res = this.options.pipgmService.setFadeToBlack(pipelineId, {
          toggle: modeArg === "toggle",
          fadeToBlack: modeArg === "on" || modeArg === "1" || modeArg === "true"
        });
        return wrap(`PIPGM:OK:${pipelineId}:FTB:${res?.fadeToBlack ? "1" : "0"}`);
      }
      if (sub === "AUDIO") {
        const modeArg = args[2]?.toLowerCase() ?? "toggle";
        const res = this.options.pipgmService.setAudio(pipelineId, {
          toggle: modeArg === "toggle",
          audioEnabled: modeArg === "on" || modeArg === "1" || modeArg === "true"
        });
        return wrap(`PIPGM:OK:${pipelineId}:AUDIO:${res?.audioEnabled ? "1" : "0"}`);
      }
      return wrap("ERR:UNKNOWN_PIPGM_ACTION");
    }

    if (cmd === "HELP") {
      return wrap("HELP:COMMANDS=DEV:VERSION,PING,STATUS,SOURCE:LIST,SOURCE:GET,OUTPUT:LIST,OUTPUT:SET,PIPGM:NEXT,PIPGM:PREV,PIPGM:FTB,PIPGM:AUDIO");
    }

    return wrap(`ERR:UNKNOWN_COMMAND:${cmd}`);
  }
}
