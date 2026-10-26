import type { FastifyBaseLogger } from "fastify";
import type { CompositeVideoCodec } from "../composite/key-publisher.js";
import { KeyPagePublisher } from "../composite/key-publisher.js";
import { buildFfmpegFilter, type CropSettings, type RotationDegrees } from "./effects-model.js";

/**
 * One place where a source's effects (crop, rotation, fade to black) reach the picture,
 * for every source that is read from MediaMTX: the HDMI players, a live composite, and
 * anything else that asks `pathFor(sourceId)` instead of using the source id directly.
 *
 * - Fade to black: the consumer is pointed at a slate path (`fx-black`, or `fx-key` in the
 *   key colour for compose1). The slate is a cheap 10 fps colour stream, so the switch is
 *   immediate and nothing is decoded for it.
 * - Crop and rotation: an ffmpeg process reads `<source>` and publishes `<source>-fx`
 *   with the filter applied; consumers read that path while the effect is on. Sources in
 *   `selfApplied` (Hama) apply their filter at capture and are never relayed.
 * - Mute is not a picture effect and the players carry no audio unless configured, so it
 *   needs nothing here.
 *
 * A change of effects only changes the path: the caller re-applies the routes that use the
 * source (`sync` returns true when the path changed). Unverified on hardware.
 */

export interface LayerEffects {
  crop: CropSettings;
  rotation: RotationDegrees;
  fadeToBlack: boolean;
}

export interface LayerPublisher {
  run(args: string[], supervise: boolean): Promise<void>;
  stop(): Promise<void>;
}

export interface EffectsLayerOptions {
  /** MediaMTX RTSP base, e.g. rtsp://127.0.0.1:8554. Undefined = the layer is a pass-through. */
  rtspBase?: string | undefined;
  ffmpeg?: string | undefined;
  encoder?: CompositeVideoCodec | undefined;
  getEffects: (sourceId: string) => LayerEffects | undefined;
  /** "#rrggbb" to fade this source to instead of black, or null. */
  fadeColour?: (sourceId: string) => string | null;
  /** Sources whose effects are applied where they are captured. */
  selfApplied?: ReadonlySet<string>;
  logger?: Pick<FastifyBaseLogger, "warn"> | undefined;
  /** Tests replace the process runner. */
  createPublisher?: (rtspUrl: string) => LayerPublisher;
}

export const BLACK_SLATE_PATH = "fx-black";
export const KEY_SLATE_PATH = "fx-key";

export function relayArgs(sourceUrl: string, filter: string, outUrl: string, encoder: CompositeVideoCodec): string[] {
  const encoderArgs =
    encoder === "h264_v4l2m2m"
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "4M"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"];
  return [
    "-hide_banner", "-nostdin", "-loglevel", "warning",
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-i", sourceUrl,
    "-an",
    "-vf", `${filter},format=yuv420p`,
    ...encoderArgs,
    "-r", "25", "-g", "50",
    "-f", "rtsp", "-rtsp_transport", "tcp",
    outUrl
  ];
}

export function slateArgs(colour: string, outUrl: string, encoder: CompositeVideoCodec): string[] {
  const encoderArgs =
    encoder === "h264_v4l2m2m"
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "500k"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"];
  return [
    "-hide_banner", "-nostdin", "-loglevel", "warning",
    "-f", "lavfi", "-i", `color=c=0x${colour.replace("#", "")}:s=1280x720:r=10`,
    "-an",
    "-vf", "format=yuv420p",
    ...encoderArgs,
    "-g", "20",
    "-f", "rtsp", "-rtsp_transport", "tcp",
    outUrl
  ];
}

export class EffectsLayer {
  private readonly rtspBase: string | undefined;
  private readonly encoder: CompositeVideoCodec;
  private readonly makePublisher: (rtspUrl: string) => LayerPublisher;
  /** Relay processes by source, with the filter they run (to notice a change). */
  private readonly relays = new Map<string, { publisher: LayerPublisher; filter: string }>();
  /** Slate processes by path, with the colour they show. */
  private readonly slates = new Map<string, { publisher: LayerPublisher; colour: string }>();
  /** The path last handed out per source, to report a change. */
  private readonly lastPath = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: EffectsLayerOptions) {
    this.rtspBase = options.rtspBase?.replace(/\/$/, "");
    this.encoder = options.encoder ?? "libx264";
    this.makePublisher =
      options.createPublisher ??
      ((rtspUrl) => new KeyPagePublisher({ rtspUrl, ffmpeg: options.ffmpeg, encoder: this.encoder, logger: options.logger }));
  }

  /** The MediaMTX path a consumer should read for this source right now. */
  pathFor(sourceId: string): string {
    const effects = this.options.getEffects(sourceId);
    if (!this.rtspBase || !effects) return sourceId;
    if (effects.fadeToBlack) return this.options.fadeColour?.(sourceId) ? KEY_SLATE_PATH : BLACK_SLATE_PATH;
    return this.relays.has(sourceId) ? `${sourceId}-fx` : sourceId;
  }

  /** Bring the processes in line with the source's effects. True when pathFor(sourceId) changed. */
  sync(sourceId: string): Promise<boolean> {
    const run = this.queue.then(() => this.apply(sourceId));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await Promise.all([...this.relays.values(), ...this.slates.values()].map((entry) => entry.publisher.stop()));
    this.relays.clear();
    this.slates.clear();
  }

  private async apply(sourceId: string): Promise<boolean> {
    const before = this.lastPath.get(sourceId) ?? sourceId;
    const effects = this.options.getEffects(sourceId);
    if (this.rtspBase && effects) {
      const filter = effects.fadeToBlack || this.options.selfApplied?.has(sourceId)
        ? "null"
        : buildFfmpegFilter(effects.crop, effects.rotation, false);
      await this.syncRelay(sourceId, filter);
      await this.syncSlate(sourceId, effects.fadeToBlack);
    }
    const after = this.pathFor(sourceId);
    this.lastPath.set(sourceId, after);
    return after !== before;
  }

  private async syncRelay(sourceId: string, filter: string): Promise<void> {
    const running = this.relays.get(sourceId);
    if (filter === "null") {
      if (running) {
        this.relays.delete(sourceId);
        await running.publisher.stop();
      }
      return;
    }
    if (running?.filter === filter) return;
    const publisher = running?.publisher ?? this.makePublisher(`${this.rtspBase}/${sourceId}-fx`);
    this.relays.set(sourceId, { publisher, filter });
    try {
      await publisher.run(relayArgs(`${this.rtspBase}/${sourceId}`, filter, `${this.rtspBase}/${sourceId}-fx`, this.encoder), true);
    } catch (error) {
      // The consumer falls back to the plain path until the next change; the reason is logged.
      this.relays.delete(sourceId);
      this.options.logger?.warn({ sourceId, err: error instanceof Error ? error.message : String(error) }, "effects relay failed");
    }
  }

  /** Slates run while at least one source is faded; the key slate takes the key colour. */
  private async syncSlate(sourceId: string, faded: boolean): Promise<void> {
    this.fadedBy.set(sourceId, faded);
    for (const [path, defaultColour] of [[BLACK_SLATE_PATH, "#000000"], [KEY_SLATE_PATH, "#00ff00"]] as const) {
      const users = [...this.fadedBy.entries()].filter(([id, on]) => on && this.slatePathOf(id) === path).map(([id]) => id);
      const running = this.slates.get(path);
      if (users.length === 0) {
        if (running) {
          this.slates.delete(path);
          await running.publisher.stop();
        }
        continue;
      }
      const colour = path === KEY_SLATE_PATH ? (this.options.fadeColour?.(users[0] as string) ?? defaultColour) : defaultColour;
      if (running?.colour === colour) continue;
      const publisher = running?.publisher ?? this.makePublisher(`${this.rtspBase}/${path}`);
      this.slates.set(path, { publisher, colour });
      try {
        await publisher.run(slateArgs(colour, `${this.rtspBase}/${path}`, this.encoder), true);
      } catch (error) {
        this.slates.delete(path);
        this.options.logger?.warn({ path, err: error instanceof Error ? error.message : String(error) }, "fade slate failed");
      }
    }
  }

  private readonly fadedBy = new Map<string, boolean>();

  private slatePathOf(sourceId: string): string {
    return this.options.fadeColour?.(sourceId) ? KEY_SLATE_PATH : BLACK_SLATE_PATH;
  }
}
