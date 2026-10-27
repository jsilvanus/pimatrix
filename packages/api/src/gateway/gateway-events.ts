import type { FastifyBaseLogger } from "fastify";
import type { PiMatrixEventBroker, PiMatrixEvent } from "../events.js";
import type { GatewayClient } from "./gateway-client.js";

const RELAYED = new Set(["camera", "atem", "matrix"]);

/** Re-emits pigateway's camera, atem and matrix events on pimatrix's own event stream. Reconnects with backoff. */
export class GatewayEventRelay {
  private controller: AbortController | null = null;
  private stopped = true;

  constructor(
    private readonly gateway: GatewayClient,
    private readonly broker: PiMatrixEventBroker,
    private readonly logger?: FastifyBaseLogger | undefined
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
  }

  private async loop(): Promise<void> {
    let delay = 1000;
    while (!this.stopped) {
      this.controller = new AbortController();
      try {
        const res = await this.gateway.openEvents(this.controller.signal);
        if (!res.ok || !res.body) throw new Error(`events answered ${res.status}`);
        delay = 1000;
        await this.read(res.body);
      } catch (err) {
        if (this.stopped) return;
        this.logger?.warn({ err }, "pigateway event stream lost; retrying");
      }
      if (this.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, delay).unref());
      delay = Math.min(delay * 2, 30000);
    }
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        this.handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
  }

  private handle(block: string): void {
    let type = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!RELAYED.has(type) || !data) return;
    try {
      this.broker.emit({ type, data: JSON.parse(data) } as PiMatrixEvent);
    } catch {
      // ignore a malformed event
    }
  }
}
