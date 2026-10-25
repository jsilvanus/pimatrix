/**
 * Feeds a slide composite from a piprogram pipeline. The feed reads the pipeline snapshot
 * on every tick (cheap JSON) and fetches the stage frame (a PNG, rendered by piprogram's
 * headless browser) only when the slide changes: the active item or step, or the pipeline
 * size. A pipeline that fades to black, or has no steps, blanks the composite's output.
 * piprogram's reads are open; the API key is sent when configured.
 */

import type { CompositeId, CompositeSettings, PiprogramPipelineId } from "./composite-model.js";

export interface PiprogramSlideFeed {
  framePath: string;
  width: number;
  height: number;
  /** "9:16" for portrait pipelines, "16:9" for landscape. */
  aspect: string;
  hasSlide: boolean;
}

export interface PiprogramPipelineSnapshot {
  id: string;
  orientation: "landscape" | "portrait";
  /** The piprogram stage page, relative to piprogram's base URL. */
  stageUrl: string;
  activeItemId: string | null;
  currentStep: number;
  fadeToBlack: boolean;
  slideFeed: PiprogramSlideFeed;
}

export interface PiprogramClientOptions {
  baseUrl: string;
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class PiprogramClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: PiprogramClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async snapshot(pipelineId: PiprogramPipelineId): Promise<PiprogramPipelineSnapshot> {
    const response = await this.get(`/api/v1/pipgm/pipelines/${encodeURIComponent(pipelineId)}`);
    return (await response.json()) as PiprogramPipelineSnapshot;
  }

  /**
   * A PNG of the pipeline's stage at the given size. Transparent by default, for a composite's
   * key; opaque (no alpha) for a source picture.
   */
  async frame(
    pipelineId: PiprogramPipelineId,
    width: number,
    height: number,
    options: { transparent?: boolean } = {}
  ): Promise<Buffer> {
    const query = new URLSearchParams({ width: String(width), height: String(height) });
    if (options.transparent !== false) query.set("alpha", "1");
    const response = await this.get(`/api/v1/pipgm/pipelines/${encodeURIComponent(pipelineId)}/frame.png?${query}`);
    return Buffer.from(await response.arrayBuffer());
  }

  private async get(pathAndQuery: string): Promise<Response> {
    const headers: Record<string, string> = this.apiKey ? { "x-api-key": this.apiKey } : {};
    const response = await this.fetchImpl(`${this.baseUrl}${pathAndQuery}`, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`piprogram answered ${response.status}`);
    return response;
  }
}

/** What the feed needs from the composite service. */
export interface PiprogramFeedTargets {
  composites(): CompositeSettings[];
  setSlide(id: CompositeId, png: Buffer): Promise<void>;
  clearSlide(id: CompositeId): Promise<void>;
  reportError(id: CompositeId, message: string | null): void;
}

const BLANK = "blank";

export class PiprogramFeed {
  /** The last thing each composite was sent: a frame key, or BLANK. */
  private readonly sent = new Map<CompositeId, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly client: PiprogramClient,
    private readonly targets: PiprogramFeedTargets,
    private readonly intervalMs = 1000
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the composites that follow piprogram. Overlapping passes are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const settings of this.targets.composites()) {
        if (!settings.enabled || settings.slideSource !== "piprogram") {
          this.sent.delete(settings.id);
          continue;
        }
        await this.follow(settings);
      }
    } finally {
      this.running = false;
    }
  }

  private async follow(settings: CompositeSettings): Promise<void> {
    const id = settings.id;
    let snapshot: PiprogramPipelineSnapshot;
    try {
      snapshot = await this.client.snapshot(settings.pipelineId);
    } catch (error) {
      this.targets.reportError(id, messageOf(error));
      return;
    }

    if (snapshot.fadeToBlack || !snapshot.slideFeed.hasSlide) {
      if (this.sent.get(id) !== BLANK) {
        await this.targets.clearSlide(id);
        this.sent.set(id, BLANK);
      }
      this.targets.reportError(id, null);
      return;
    }

    const { width, height } = snapshot.slideFeed;
    const key = [settings.pipelineId, snapshot.activeItemId ?? "", snapshot.currentStep, width, height].join("|");
    if (this.sent.get(id) === key) return;
    try {
      const png = await this.client.frame(settings.pipelineId, width, height);
      await this.targets.setSlide(id, png);
      this.sent.set(id, key);
      this.targets.reportError(id, null);
    } catch (error) {
      // Not recorded as sent: the next tick tries again.
      this.targets.reportError(id, messageOf(error));
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
