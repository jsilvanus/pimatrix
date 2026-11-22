/**
 * Feeds a slide composite from a piprogram pipeline. The feed reads the pipeline snapshot
 * on every tick (cheap JSON) and fetches the stage frame (a PNG, rendered by piprogram's
 * headless browser) only when the slide changes: the active item or step, or the pipeline
 * size. A pipeline that fades to black, or has no steps, blanks the composite's output.
 * piprogram's reads are open; the API key is sent when configured.
 */

import { renderSignature, type CompositeId, type CompositeSettings, type PiprogramPipelineId } from "./composite-model.js";

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
  /**
   * How long a snapshot is reused, ms (default 0 = no cache). Concurrent requests for the same
   * pipeline always share one fetch. With a TTL just under the poll interval, every consumer of
   * the client (composite feed, PiPGM feed) together costs one fetch per pipeline per interval.
   */
  snapshotCacheMs?: number;
  /** Clock for the cache, default Date.now. */
  now?: () => number;
}

export class PiprogramClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly snapshotCacheMs: number;
  private readonly now: () => number;
  private readonly snapshotCache = new Map<
    string,
    { at: number; value?: PiprogramPipelineSnapshot; pending?: Promise<PiprogramPipelineSnapshot> }
  >();

  constructor(options: PiprogramClientOptions) {
    this.snapshotCacheMs = options.snapshotCacheMs ?? 0;
    this.now = options.now ?? Date.now;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  /** The pipeline snapshot, cached for snapshotCacheMs; callers arriving during a fetch share it. Failures are not cached. */
  async snapshot(pipelineId: PiprogramPipelineId): Promise<PiprogramPipelineSnapshot> {
    const entry = this.snapshotCache.get(pipelineId);
    if (entry?.pending) return entry.pending;
    if (entry?.value && this.now() - entry.at < this.snapshotCacheMs) return entry.value;
    const pending = this.fetchSnapshot(pipelineId).then(
      (value) => {
        this.snapshotCache.set(pipelineId, { at: this.now(), value });
        return value;
      },
      (error: unknown) => {
        this.snapshotCache.delete(pipelineId);
        throw error;
      }
    );
    this.snapshotCache.set(pipelineId, { at: entry?.at ?? 0, pending });
    return pending;
  }

  private async fetchSnapshot(pipelineId: PiprogramPipelineId): Promise<PiprogramPipelineSnapshot> {
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

  /**
   * Requests a pre-composited frame from piprogram matching the composite's placement and key settings.
   * When piprogram returns `x-piprogram-composited: 1`, pimatrix can skip running `renderKeyPage`.
   */
  async compositedFrame(
    pipelineId: PiprogramPipelineId,
    settings: CompositeSettings
  ): Promise<{ png: Buffer; precomposited: boolean }> {
    const keyMode = settings.kind === "atem-media" ? "rgba" : settings.keyMode;
    const query = new URLSearchParams({
      width: String(settings.width),
      height: String(settings.height),
      side: settings.side,
      keyMode,
      slideAspect: settings.slideAspect,
      slideScale: String(settings.slideScale),
      offsetX: String(settings.offsetX),
      offsetY: String(settings.offsetY)
    });
    if (keyMode === "chroma") query.set("keyColor", settings.keyColor);
    if (keyMode === "rgba") query.set("alpha", "1");
    const response = await this.get(`/api/v1/pipgm/pipelines/${encodeURIComponent(pipelineId)}/frame.png?${query}`);
    return {
      png: Buffer.from(await response.arrayBuffer()),
      precomposited: response.headers.get("x-piprogram-composited") === "1"
    };
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
  setSlide(id: CompositeId, png: Buffer, options?: { precomposited?: boolean }): Promise<void>;
  clearSlide(id: CompositeId): Promise<void>;
  reportError(id: CompositeId, message: string | null): void;
}

const BLANK = "blank";

export class PiprogramFeed {
  /** The last thing each composite was sent: a frame key, or BLANK. */
  private readonly sent = new Map<CompositeId, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private paused = false;

  constructor(
    private readonly client: PiprogramClient,
    private readonly targets: PiprogramFeedTargets,
    private readonly intervalMs = 1000
  ) {}

  get isPaused(): boolean {
    return this.paused;
  }

  /** While paused the composites that follow piprogram show no slide. */
  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.tick();
  }

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
    if (this.paused) {
      if (this.sent.get(id) !== BLANK) {
        await this.targets.clearSlide(id);
        this.sent.set(id, BLANK);
      }
      return;
    }
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
    const useComposited = typeof this.client.compositedFrame === "function";
    const key = useComposited
      ? [settings.pipelineId, snapshot.activeItemId ?? "", snapshot.currentStep, renderSignature(settings)].join("|")
      : [settings.pipelineId, snapshot.activeItemId ?? "", snapshot.currentStep, width, height].join("|");
    if (this.sent.get(id) === key) return;
    try {
      if (useComposited) {
        const { png, precomposited } = await this.client.compositedFrame(settings.pipelineId, settings);
        await this.targets.setSlide(id, png, { precomposited });
      } else {
        const png = await this.client.frame(settings.pipelineId, width, height);
        await this.targets.setSlide(id, png);
      }
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
