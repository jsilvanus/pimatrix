/**
 * On-demand control of the Hama capture. The capture only runs while something
 * needs it: a manual start, an output routed to Hama, or the RTSP relay sending
 * Hama. When the last reason goes, the capture stops after an idle grace period,
 * so the Pi's USB camera and encoder stay idle when nothing is going out.
 */

export interface HamaCaptureControl {
  start(): void;
  halt(): Promise<void>;
  snapshot(): { state: string };
}

export interface HamaDemandSnapshot {
  manual: boolean;
  routed: boolean;
  relayed: boolean;
  wanted: boolean;
}

export interface HamaDemandReasons {
  routed: boolean;
  relayed: boolean;
}

export class HamaOnDemand {
  private manual = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly capture: HamaCaptureControl,
    private readonly graceMs: number,
    private readonly reasons: () => HamaDemandReasons
  ) {}

  demand(): HamaDemandSnapshot {
    const { routed, relayed } = this.reasons();
    return { manual: this.manual, routed, relayed, wanted: this.manual || routed || relayed };
  }

  /** Call after anything that may change a reason (output route, RTSP relay source or state). */
  sync(): void {
    if (this.demand().wanted) {
      this.clearIdleTimer();
      this.capture.start();
      return;
    }
    const state = this.capture.snapshot().state;
    if (this.idleTimer || state === "idle" || state === "disabled") return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.demand().wanted) void this.capture.halt().catch(() => undefined);
    }, this.graceMs);
    this.idleTimer.unref?.();
  }

  /** Explicit start: holds the capture until stopManual() or until nothing else needs it. */
  startManual(): void {
    this.manual = true;
    this.sync();
  }

  /** Drops the manual hold; the capture stops after the grace period if nothing else needs it. */
  stopManual(): void {
    this.manual = false;
    this.sync();
  }

  /** Stops the capture now, whatever holds it. A later sync() may start it again. */
  async stopNow(): Promise<void> {
    this.manual = false;
    this.clearIdleTimer();
    await this.capture.halt();
  }

  dispose(): void {
    this.clearIdleTimer();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
