import { spawn as nodeSpawn } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";
import { EncoderPolicy, HARDWARE_ENCODER, type Encoder, type EncoderSetting } from "../encoder.js";

/**
 * Publishes the compose1 key page to MediaMTX as a low-rate RTSP stream, so the
 * route can send it to a Pi HDMI output like any other source. It replaces the
 * direct HDMI key player: the route owns the output.
 *
 * ffmpeg loops the still at 1 fps. A new slide restarts the process with the new
 * PNG (one reconnect, not a black-screen wait on the HDMI side beyond that). The
 * encoder is chosen by EncoderPolicy: `auto` (default) tries `h264_v4l2m2m` (Pi 4
 * hardware) and starts again with `libx264` (software) when that fails in the start window.
 * Unverified on hardware.
 */

export type CompositeVideoCodec = EncoderSetting;
/** Argument list, or a function that builds it for the encoder picked at start time (so a fallback can rebuild it). */
export type PublishArgs = string[] | ((encoder: Encoder) => string[]);

export interface PublishProcess {
  stdin?: { write(chunk: Buffer): boolean; once(event: "drain", listener: () => void): unknown; end(): void } | null | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type SpawnPublisher = (command: string, args: readonly string[]) => PublishProcess;

export type StillInput = "raw" | "png";

/** Converts a PNG to raw yuv420p frame bytes of the given (even) size, or null when that fails. */
export type StillConverter = (png: Buffer, width: number, height: number) => Promise<Buffer | null>;

export interface KeyPagePublisherOptions {
  /** How showFrame feeds ffmpeg: "raw" (decode the PNG once per change, default) or "png" (the PNG every second). */
  stillInput?: StillInput | undefined;
  /** PNG to raw yuv420p conversion; default is a one-shot ffmpeg. Tests inject a fake. */
  convertStill?: StillConverter | undefined;
  /** RTSP publish URL, e.g. rtsp://127.0.0.1:8554/compose1. Undefined = publishing cannot start. */
  rtspUrl?: string | undefined;
  /** ffmpeg executable, default "ffmpeg". */
  ffmpeg?: string | undefined;
  /** Encoder setting, default "auto" (hardware first, libx264 fallback). */
  encoder?: CompositeVideoCodec | undefined;
  /** Shared encoder choice and fallback memory; a private one is made when omitted. */
  encoderPolicy?: EncoderPolicy | undefined;
  /** How long a publisher must run before a show counts as started, default 1500 ms. */
  startupWindowMs?: number;
  /** First restart delay of a supervised process, doubled each time, default 1000 ms. */
  restartBaseMs?: number;
  /** Restarts in a row before a supervised process is given up, default 5. */
  maxRestarts?: number;
  logger?: Pick<FastifyBaseLogger, "warn"> | undefined;
  spawn?: SpawnPublisher;
}

export function publishArgs(pngPath: string, rtspUrl: string, encoder: Encoder): string[] {
  const encoderArgs =
    encoder === HARDWARE_ENCODER
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "1M"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage"];
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "warning",
    "-loop", "1",
    "-framerate", "1",
    "-i", pngPath,
    "-an",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    ...encoderArgs,
    "-r", "1",
    "-g", "2",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    rtspUrl
  ];
}

/** Even dimensions, as the scale=trunc(iw/2)*2 of the PNG path gives. */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.floor(width / 2) * 2, height: Math.floor(height / 2) * 2 };
}

/** One-shot ffmpeg arguments that turn a PNG on stdin into raw yuv420p frame bytes on stdout. */
export function stillConvertArgs(): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "error",
    "-f", "image2pipe",
    "-c:v", "png",
    "-i", "-",
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
    "-frames:v", "1",
    "-f", "rawvideo",
    "-pix_fmt", "yuv420p",
    "-"
  ];
}

/** Default converter: decodes the PNG once in a one-shot ffmpeg. Null on any failure, a timeout or a wrong-sized result. */
export function ffmpegStillConverter(ffmpeg: string, timeoutMs = 15000): StillConverter {
  return (png, width, height) =>
    new Promise<Buffer | null>((resolve) => {
      const expected = (width * height * 3) / 2;
      let settled = false;
      const done = (value: Buffer | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      let child: ReturnType<typeof nodeSpawn>;
      const timer = setTimeout(() => {
        child?.kill("SIGKILL");
        done(null);
      }, timeoutMs);
      try {
        child = nodeSpawn(ffmpeg, stillConvertArgs(), { stdio: ["pipe", "pipe", "ignore"] });
      } catch {
        done(null);
        return;
      }
      const chunks: Buffer[] = [];
      child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stdin?.on("error", () => undefined);
      child.on("error", () => done(null));
      child.on("close", (code) => {
        const out = Buffer.concat(chunks);
        done(code === 0 && out.length === expected ? out : null);
      });
      child.stdin?.end(png);
    });
}

export function pipePublishArgs(
  rtspUrl: string,
  encoder: Encoder,
  fps = 1,
  raw?: { width: number; height: number }
): string[] {
  const encoderArgs =
    encoder === HARDWARE_ENCODER
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "1M"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage"];
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "warning",
    ...(raw
      ? ["-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", `${raw.width}x${raw.height}`, "-framerate", String(fps), "-i", "-", "-an"]
      : ["-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-an", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"]),
    ...encoderArgs,
    "-r", String(fps),
    "-g", "2",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    rtspUrl
  ];
}

/** What a live composite shows: the slide box and the colour around it, from keyPageGeometry. */
export interface LiveKeyLayout {
  width: number;
  height: number;
  background: string;
  slide: { x: number; y: number; width: number; height: number };
}

/** The filter graph of a live composite: the source filled into the slide box on the key-colour page. */
export function liveFilterGraph(layout: LiveKeyLayout, sourceFilter?: string): string {
  const { slide } = layout;
  const colour = `0x${layout.background.slice(1)}`;
  const prefix = sourceFilter && sourceFilter !== "null" ? `${sourceFilter},` : "";
  return [
    `color=c=${colour}:s=${layout.width}x${layout.height}:r=25,format=yuv420p[bg]`,
    `[0:v]${prefix}scale=${slide.width}:${slide.height}:force_original_aspect_ratio=increase,crop=${slide.width}:${slide.height},format=yuv420p[v]`,
    `[bg][v]overlay=x=${slide.x}:y=${slide.y}:shortest=0,fps=25,format=yuv420p[out]`
  ].join(";");
}

/**
 * Arguments for a live composite: the source is filled into the slide box (centre cut, never
 * stretched) on the key-colour page and published at 25 fps. The video moves on its own, so
 * there is no still and no black gap when the source changes.
 */
export function liveArgs(
  sourceUrl: string,
  layout: LiveKeyLayout,
  rtspUrl: string,
  encoder: Encoder,
  sourceFilter?: string
): string[] {
  const encoderArgs =
    encoder === HARDWARE_ENCODER
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "4M"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"];
  const graph = liveFilterGraph(layout, sourceFilter);
  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "warning",
    ...(sourceUrl.startsWith("rtsp:") ? ["-rtsp_transport", "tcp"] : []),
    "-fflags", "nobuffer",
    "-i", sourceUrl,
    "-an",
    "-filter_complex", graph,
    "-map", "[out]",
    ...encoderArgs,
    "-r", "25",
    "-g", "50",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    rtspUrl
  ];
}

export class KeyPagePublisher {
  private process: PublishProcess | null = null;
  /** Bumped by stop(), so a start still waiting for the encoder probe can tell it was cancelled. */
  private generation = 0;
  private readonly rtspUrl: string | undefined;
  private readonly ffmpeg: string;
  private readonly encoder: EncoderSetting;
  private readonly policy: EncoderPolicy;
  private readonly startupWindowMs: number;
  private readonly restartBaseMs: number;
  private readonly maxRestarts: number;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private pipeState: {
    frame: Buffer;
    width: number | undefined;
    height: number | undefined;
    /** What the running ffmpeg reads: raw yuv420p frames or PNGs. */
    raw: boolean;
    timer: ReturnType<typeof setInterval> | null;
    draining: boolean;
  } | null = null;
  private readonly logger: Pick<FastifyBaseLogger, "warn"> | undefined;
  private readonly spawn: SpawnPublisher;
  private readonly stillInput: StillInput;
  private readonly convertStill: StillConverter;

  constructor(options: KeyPagePublisherOptions = {}) {
    this.rtspUrl = options.rtspUrl;
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.encoder = options.encoder ?? "auto";
    this.policy = options.encoderPolicy ?? new EncoderPolicy({ ffmpeg: this.ffmpeg, logger: options.logger });
    this.startupWindowMs = options.startupWindowMs ?? 1500;
    this.restartBaseMs = options.restartBaseMs ?? 1000;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.logger = options.logger;
    this.stillInput = options.stillInput ?? "raw";
    this.convertStill = options.convertStill ?? ffmpegStillConverter(this.ffmpeg);
    this.spawn = options.spawn ?? ((command, args) => nodeSpawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"] }) as unknown as PublishProcess);
  }

  /** Start (or restart with a new slide) publishing the PNG. Rejects if ffmpeg exits in the start window. */
  async show(pngPath: string): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    const rtspUrl = this.rtspUrl;
    await this.run((encoder) => publishArgs(pngPath, rtspUrl, encoder), true);
  }

  /**
   * Publish PNG frames over a persistent stdin pipe without restarting ffmpeg or dropping RTSP
   * when only the picture changes. Restarts only when dimensions change or no pipe is running.
   */
  async showFrame(png: Buffer, width?: number, height?: number): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    // Raw mode decodes the PNG once here, so the 1 fps loop only writes bytes; any failure
    // (or unknown size) falls back to the PNG input for this picture.
    let frame = png;
    let raw: { width: number; height: number } | undefined;
    if (this.stillInput === "raw" && width !== undefined && height !== undefined) {
      const size = evenSize(width, height);
      const generation = this.generation;
      let converted: Buffer | null = null;
      try {
        converted = size.width > 0 && size.height > 0 ? await this.convertStill(png, size.width, size.height) : null;
      } catch {
        converted = null;
      }
      // stop() or a newer show while converting: this one was cancelled.
      if (generation !== this.generation) return;
      if (converted) {
        frame = converted;
        raw = size;
      } else {
        this.logger?.warn({ width, height }, "compose1 still conversion failed, publishing this picture as PNG");
      }
    }
    const isRaw = raw !== undefined;
    const sameSize =
      this.pipeState !== null &&
      this.pipeState.width === width &&
      this.pipeState.height === height &&
      this.pipeState.raw === isRaw;
    if (this.process && sameSize && this.pipeState) {
      this.pipeState.frame = frame;
      this.writePipeFrame();
      return;
    }
    await this.stop();
    this.pipeState = { frame, width, height, raw: isRaw, timer: null, draining: false };
    this.pipeState.timer = setInterval(() => this.writePipeFrame(), 1000);
    this.pipeState.timer.unref();
    const rtspUrl = this.rtspUrl;
    await this.start((encoder) => pipePublishArgs(rtspUrl, encoder, 1, raw), true, 0);
  }

  /** Start (or restart) publishing a live source in the slide box. Restarts itself if the source drops. */
  async showLive(sourceUrl: string, layout: LiveKeyLayout, sourceFilter?: string): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    const rtspUrl = this.rtspUrl;
    await this.run((encoder) => liveArgs(sourceUrl, layout, rtspUrl, encoder, sourceFilter), true);
  }

  /**
   * Run any ffmpeg publish command. With `supervise`, a process that dies after the start
   * window is started again with a doubling delay (1 s, 2 s, 4 s, ...) up to maxRestarts times
   * in a row; a run that lasts 10 s or more starts the count again.
   */
  async run(args: PublishArgs, supervise: boolean): Promise<void> {
    await this.stop();
    await this.start(args, supervise, 0);
  }

  /**
   * Starts the process with the encoder the policy picks. If the hardware encoder dies inside the
   * start window the policy remembers it and the same command is started again with libx264.
   */
  private async start(build: PublishArgs, supervise: boolean, restarts: number, afterFallback = false): Promise<void> {
    const generation = this.generation;
    const encoder = await this.policy.pick(this.encoder);
    // stop() or a newer start() while the probe ran: this start was cancelled.
    if (generation !== this.generation) return;
    const outcome = await this.attempt(build, encoder, supervise, restarts, afterFallback);
    if (outcome === "fallback") await this.start(build, supervise, restarts, true);
  }

  private async attempt(
    build: PublishArgs,
    encoder: Encoder,
    supervise: boolean,
    restarts: number,
    afterFallback: boolean
  ): Promise<"started" | "fallback"> {
    const args = typeof build === "function" ? build(encoder) : build;
    const proc = this.spawn(this.ffmpeg, args);
    this.process = proc;
    if (this.pipeState) {
      this.pipeState.draining = false;
      (proc.stdin as unknown as { on?(event: "error", listener: () => void): void } | null)?.on?.("error", () => undefined);
      this.writePipeFrame();
    }
    const startedAt = Date.now();
    let startWindowOver = false;
    return new Promise<"started" | "fallback">((resolve, reject) => {
      const timer = setTimeout(() => {
        startWindowOver = true;
        resolve("started");
      }, this.startupWindowMs);
      const fail = (reason: string) => {
        // A process that was stopped or replaced on purpose is not a failure.
        if (this.process !== proc) return;
        this.process = null;
        this.logger?.warn({ reason }, "compose1 publisher stopped");
        if (!startWindowOver) {
          clearTimeout(timer);
          if (this.policy.noteFailure(encoder, reason)) {
            if (this.pipeState) this.pipeState.draining = false;
            resolve("fallback");
            return;
          }
          if (afterFallback && encoder === "libx264") this.policy.revertFallback();
          if (restarts === 0 || !supervise) {
            if (this.pipeState?.timer) clearInterval(this.pipeState.timer);
            this.pipeState = null;
            reject(new Error(`compose1 publisher failed: ${reason}`));
            return;
          }
          // During a supervised restart, exiting within startupWindowMs should still schedule backoff retries.
          resolve("started");
        }
        if (!supervise) return;
        const ranLong = Date.now() - startedAt >= 10_000;
        const next = ranLong ? 1 : restarts + 1;
        if (next > this.maxRestarts) {
          if (this.pipeState?.timer) clearInterval(this.pipeState.timer);
          this.pipeState = null;
          this.logger?.warn({ reason }, "publisher gave up after repeated restarts");
          return;
        }
        const delay = this.restartBaseMs * 2 ** (next - 1);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.start(build, supervise, next).catch(() => undefined);
        }, delay);
      };
      proc.onError((error) => fail(error.message));
      proc.onExit((code) => fail(`ffmpeg exited with code ${code ?? "null"}`));
    });
  }

  private writePipeFrame(): void {
    const stdin = this.process?.stdin;
    if (!stdin || !this.pipeState || this.pipeState.draining) return;
    try {
      if (!stdin.write(this.pipeState.frame)) {
        this.pipeState.draining = true;
        stdin.once("drain", () => {
          if (this.pipeState) this.pipeState.draining = false;
        });
      }
    } catch {
      // Process exit handler handles restarts if needed.
    }
  }

  /** Stop publishing. Safe to call when nothing is running. */
  async stop(): Promise<void> {
    this.generation += 1;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.pipeState?.timer) clearInterval(this.pipeState.timer);
    this.pipeState = null;
    const proc = this.process;
    this.process = null;
    try {
      proc?.stdin?.end();
    } catch {
      // already closed
    }
    proc?.kill("SIGTERM");
  }
}
