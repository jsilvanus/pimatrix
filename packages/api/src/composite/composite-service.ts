import fs from "node:fs";
import path from "node:path";
import type { AtemAdapter } from "../atem/atem-adapter.js";
import {
  applyCompositePatch,
  COMPOSITE_IDS,
  defaultCompositeSettings,
  parseCompositePatch,
  renderSignature,
  type CompositeId,
  type CompositePatch,
  type CompositeRunState,
  type CompositeSettings,
  type CompositeStatus
} from "./composite-model.js";
import { keyPageGeometry } from "./key-page.js";
import { isPng, renderKeyPage, type RenderKeyPageOptions } from "./key-render.js";
import type { KeyPagePlayer } from "./key-player.js";

/** The part of the HDMI key player the service uses (tests pass a fake). */
export type CompositePlayer = Pick<KeyPagePlayer, "show" | "stop">;

/** Largest slide accepted, in bytes. A 1080p slide PNG is far below this. */
export const MAX_SLIDE_BYTES = 10 * 1024 * 1024;
/** ATEM media player fill inputs start here; each player uses 10 numbers. Override per model. */
export const DEFAULT_ATEM_FILL_INPUT_BASE = 8010;

export class CompositeNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown composite: ${id}`);
    this.name = "CompositeNotFoundError";
  }
}

export class InvalidSlideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSlideError";
  }
}

export interface CompositeServiceOptions {
  /** Directory for the slide, the key page files and the state file. */
  dataDir: string;
  /** Settings file. Undefined = settings live in memory only. */
  stateFile?: string | undefined;
  /** ffmpeg executable for the key frames. */
  ffmpeg?: string;
  /** HDMI key output. */
  player: CompositePlayer;
  /** ATEM adapter; the ATEM output stays idle when it is not connected. */
  atem: AtemAdapter;
  /** ATEM input number of media player 1's fill. */
  atemFillInputBase?: number;
  /** Renders one frame. Tests replace it so no ffmpeg runs. */
  renderFrame?: (options: RenderKeyPageOptions) => Promise<Buffer>;
  /** Called on every state change, for the event stream. */
  onChange?: (status: CompositeStatus) => void;
}

interface Runtime {
  state: CompositeRunState;
  lastError: string | null;
  updatedAt: string;
}

export class CompositeService {
  private readonly settings = new Map<CompositeId, CompositeSettings>();
  private readonly runtime = new Map<CompositeId, Runtime>();
  private readonly queues = new Map<CompositeId, Promise<unknown>>();
  private slide: Buffer | null = null;
  private readonly renderFrame: (options: RenderKeyPageOptions) => Promise<Buffer>;
  private readonly fillInputBase: number;

  constructor(private readonly options: CompositeServiceOptions) {
    this.renderFrame = options.renderFrame ?? renderKeyPage;
    this.fillInputBase = options.atemFillInputBase ?? DEFAULT_ATEM_FILL_INPUT_BASE;
    for (const id of COMPOSITE_IDS) {
      this.settings.set(id, defaultCompositeSettings(id));
      this.runtime.set(id, { state: "stopped", lastError: null, updatedAt: new Date().toISOString() });
    }
  }

  list(): CompositeStatus[] {
    return COMPOSITE_IDS.map((id) => this.get(id));
  }

  get(id: string): CompositeStatus {
    const settings = this.requireSettings(id);
    const runtime = this.runtime.get(settings.id) ?? { state: "stopped", lastError: null, updatedAt: "" };
    return { ...settings, atem: { ...settings.atem }, state: runtime.state, lastError: runtime.lastError, hasSlide: this.slide !== null, updatedAt: runtime.updatedAt };
  }

  /**
   * Validate and apply a patch. Changing the picture (size, side, scale, colour, or the
   * ATEM slot) re-renders an enabled composite. Returns the status at once; the work runs
   * in the background (await idle() to wait for it).
   */
  async update(id: string, patch: CompositePatch): Promise<CompositeStatus> {
    const current = this.requireSettings(id);
    const next = applyCompositePatch(current, patch);
    const becameEnabled = !current.enabled && next.enabled;
    const changedPicture = renderSignature(current) !== renderSignature(next);
    this.settings.set(current.id, next);
    this.persist();

    if (!next.enabled) {
      if (current.enabled) this.schedule(current.id, () => this.takeDown(current.id, next));
    } else if (becameEnabled || (changedPicture && current.enabled)) {
      // autoOnAir alone does not re-render: it takes effect at the next upload.
      this.schedule(current.id, () => this.apply(current.id));
    }
    return this.get(id);
  }

  /** Store a new slide and refresh every enabled composite. The slide must be PNG. */
  async setSlide(png: Buffer): Promise<CompositeStatus[]> {
    if (png.length > MAX_SLIDE_BYTES) throw new InvalidSlideError(`The slide is larger than ${MAX_SLIDE_BYTES} bytes`);
    if (!isPng(png)) throw new InvalidSlideError("The slide must be a PNG image");
    this.slide = png;
    this.writeAtomic(path.join(this.options.dataDir, "slide.png"), png);
    for (const id of COMPOSITE_IDS) {
      if (this.requireSettings(id).enabled) this.schedule(id, () => this.apply(id));
    }
    return this.list();
  }

  /** A PNG of what the composite would show now (its key page). Null without a slide. */
  async previewPng(id: string): Promise<Buffer | null> {
    const settings = this.requireSettings(id);
    if (!this.slide) return null;
    return await this.renderFrame({
      geometry: keyPageGeometry(settings),
      slidePng: this.slide,
      format: "png",
      ...(this.options.ffmpeg ? { ffmpeg: this.options.ffmpeg } : {})
    });
  }

  /** Restore the saved settings and the slide after a restart, and apply enabled composites. */
  async restore(): Promise<void> {
    this.loadSettings();
    const slidePath = path.join(this.options.dataDir, "slide.png");
    if (fs.existsSync(slidePath)) {
      const bytes = fs.readFileSync(slidePath);
      if (isPng(bytes)) this.slide = bytes;
    }
    for (const id of COMPOSITE_IDS) {
      if (this.requireSettings(id).enabled) this.schedule(id, () => this.apply(id));
    }
    await this.idle();
  }

  /** Resolves when every queued apply has finished. */
  async idle(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.all([...this.queues.values()]);
    }
  }

  async close(): Promise<void> {
    await this.idle();
    await this.options.player.stop();
  }

  private schedule(id: CompositeId, task: () => Promise<void>): void {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const run = previous.then(task).catch((error: unknown) => {
      this.setRuntime(id, "failed", messageOf(error));
    });
    const tracked = run.finally(() => {
      if (this.queues.get(id) === tracked) this.queues.delete(id);
    });
    this.queues.set(id, tracked);
  }

  /** Render and show (hdmi-key) or upload and key (atem-media) the current settings. */
  private async apply(id: CompositeId): Promise<void> {
    const settings = this.requireSettings(id);
    if (!settings.enabled) return;
    if (!this.slide) {
      this.setRuntime(id, "waiting", null);
      return;
    }
    this.setRuntime(id, "busy", null);
    const geometry = keyPageGeometry(settings);
    const ffmpeg = this.options.ffmpeg ? { ffmpeg: this.options.ffmpeg } : {};

    if (settings.kind === "hdmi-key") {
      const png = await this.renderFrame({ geometry, slidePng: this.slide, format: "png", ...ffmpeg });
      const file = path.join(this.options.dataDir, `${id}-key.png`);
      this.writeAtomic(file, png);
      await this.options.player.show(file);
      this.setRuntime(id, "running", null);
      return;
    }

    const atem = this.options.atem;
    if (!atem.getState().connected) throw new Error("ATEM is not connected");
    const rgba = await this.renderFrame({ geometry, slidePng: this.slide, format: "rgba", ...ffmpeg });
    const stillIndex = settings.atem.mediaSlot - 1;
    const mediaPlayer = settings.atem.mediaPlayer - 1;
    await atem.uploadStill(stillIndex, rgba, `pimatrix-${id}`);
    await atem.setupDownstreamKey({
      dsk: settings.atem.dskIndex - 1,
      mediaPlayer,
      stillIndex,
      fillInput: this.fillInputBase + mediaPlayer * 10,
      cutInput: this.fillInputBase + mediaPlayer * 10 + 1
    });
    if (settings.atem.autoOnAir) await atem.setDownstreamKeyOnAir(settings.atem.dskIndex - 1, true);
    this.setRuntime(id, "running", null);
  }

  /** Turn an output off: stop the HDMI player, or take the DSK off air. */
  private async takeDown(id: CompositeId, settings: CompositeSettings): Promise<void> {
    if (settings.kind === "hdmi-key") {
      await this.options.player.stop();
    } else if (this.options.atem.getState().connected) {
      await this.options.atem.setDownstreamKeyOnAir(settings.atem.dskIndex - 1, false);
    }
    this.setRuntime(id, "stopped", null);
  }

  private setRuntime(id: CompositeId, state: CompositeRunState, lastError: string | null): void {
    this.runtime.set(id, { state, lastError, updatedAt: new Date().toISOString() });
    this.options.onChange?.(this.get(id));
  }

  private requireSettings(id: string): CompositeSettings {
    const settings = this.settings.get(id as CompositeId);
    if (!settings) throw new CompositeNotFoundError(id);
    return settings;
  }

  private persist(): void {
    if (!this.options.stateFile) return;
    const composites: Record<string, Omit<CompositeSettings, "kind" | "id">> = {};
    for (const [id, settings] of this.settings) {
      const { kind: _kind, id: _id, ...rest } = settings;
      composites[id] = rest;
    }
    this.writeAtomic(this.options.stateFile, JSON.stringify({ version: 1, composites }, null, 2));
  }

  /** Loads saved settings. A saved entry that does not validate is ignored (defaults stay). */
  private loadSettings(): void {
    if (!this.options.stateFile || !fs.existsSync(this.options.stateFile)) return;
    let saved: unknown;
    try {
      saved = JSON.parse(fs.readFileSync(this.options.stateFile, "utf8"));
    } catch {
      return;
    }
    const composites = (saved as { composites?: Record<string, unknown> } | null)?.composites;
    if (!composites || typeof composites !== "object") return;
    for (const id of COMPOSITE_IDS) {
      const entry = composites[id];
      if (!entry || typeof entry !== "object") continue;
      const validated = parseCompositePatch(entry);
      if (!validated.ok) continue;
      const base = defaultCompositeSettings(id);
      this.settings.set(id, applyCompositePatch(base, validated.patch));
    }
  }

  private writeAtomic(file: string, data: Buffer | string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, data);
    fs.renameSync(temp, file);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
