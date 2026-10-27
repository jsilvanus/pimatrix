import type { AtemDskSetup, CompositeAtem } from "../composite/composite-service.js";
import type { GatewayClient } from "./gateway-client.js";

/**
 * The ATEM as composites see it, reached through pigateway. `connected` is a cached answer from
 * GET /api/v1/atem, refreshed every few seconds and after each call, because composites read it synchronously.
 */
export class RemoteAtem implements CompositeAtem {
  private connected = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly gateway: GatewayClient) {}

  start(intervalMs = 3000): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refresh(): Promise<void> {
    try {
      this.connected = Boolean((await this.gateway.json<{ connected?: boolean }>("GET", "/api/v1/atem", undefined, 3000)).connected);
    } catch {
      this.connected = false;
    }
  }

  getState(): { connected: boolean } {
    return { connected: this.connected };
  }

  async uploadStill(stillIndex: number, rgba: Buffer, name: string): Promise<void> {
    const res = await this.gateway.request("PUT", `/api/v1/atem/media/stills/${stillIndex + 1}?name=${encodeURIComponent(name)}`, {
      body: new Uint8Array(rgba),
      headers: { "content-type": "application/octet-stream" },
      timeoutMs: 60000
    });
    if (!res.ok) throw new Error(`ATEM still upload failed (${res.status})`);
  }

  async setupDownstreamKey(setup: AtemDskSetup): Promise<void> {
    await this.gateway.json("PUT", `/api/v1/atem/dsk/${setup.dsk + 1}/setup`, {
      mediaPlayer: setup.mediaPlayer + 1,
      slot: setup.stillIndex + 1,
      fillInput: setup.fillInput,
      cutInput: setup.cutInput
    });
  }

  async setDownstreamKeyOnAir(dsk: number, onAir: boolean): Promise<void> {
    await this.gateway.json("PUT", `/api/v1/atem/dsk/${dsk + 1}/on-air`, { onAir });
  }
}
