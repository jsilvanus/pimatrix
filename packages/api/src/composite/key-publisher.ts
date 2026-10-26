import { spawn as nodeSpawn } from "node:child_process";
import type { FastifyBaseLogger } from "fastify";

/**
 * Publishes the compose1 key page to MediaMTX as a low-rate RTSP stream, so the
 * route can send it to a Pi HDMI output like any other source. It replaces the
 * direct HDMI key player: the route owns the output.
 *
 * ffmpeg loops the still at 1 fps. A new slide restarts the process with the new
 * PNG (one reconnect, not a black-screen wait on the HDMI side beyond that). The
 * encoder is `h264_v4l2m2m` on a Pi 4 (hardware) or `libx264` (software).
 * Unverified on hardware.
 */

export type CompositeVideoCodec = "libx264" | "h264_v4l2m2m";

export interface PublishProcess {
  kill(signal?: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type SpawnPublisher = (command: string, args: readonly string[]) => PublishProcess;

export interface KeyPagePublisherOptions {
  /** RTSP publish URL, e.g. rtsp://127.0.0.1:8554/compose1. Undefined = publishing cannot start. */
  rtspUrl?: string | undefined;
  /** ffmpeg executable, default "ffmpeg". */
  ffmpeg?: string | undefined;
  /** Encoder, default libx264. */
  encoder?: CompositeVideoCodec | undefined;
  /** How long a publisher must run before a show counts as started, default 1500 ms. */
  startupWindowMs?: number;
  /** First restart delay of a supervised process, doubled each time, default 1000 ms. */
  restartBaseMs?: number;
  /** Restarts in a row before a supervised process is given up, default 5. */
  maxRestarts?: number;
  logger?: Pick<FastifyBaseLogger, "warn"> | undefined;
  spawn?: SpawnPublisher;
}

export function publishArgs(pngPath: string, rtspUrl: string, encoder: CompositeVideoCodec): string[] {
  const encoderArgs =
    encoder === "h264_v4l2m2m"
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

/** What a live composite shows: the slide box and the colour around it, from keyPageGeometry. */
export interface LiveKeyLayout {
  width: number;
  height: number;
  background: string;
  slide: { x: number; y: number; width: number; height: number };
}

/** The filter graph of a live composite: the source filled into the slide box on the key-colour page. */
export function liveFilterGraph(layout: LiveKeyLayout): string {
  const { slide } = layout;
  const colour = `0x${layout.background.slice(1)}`;
  return [
    `color=c=${colour}:s=${layout.width}x${layout.height}:r=25,format=yuv420p[bg]`,
    `[0:v]scale=${slide.width}:${slide.height}:force_original_aspect_ratio=increase,crop=${slide.width}:${slide.height},format=yuv420p[v]`,
    `[bg][v]overlay=x=${slide.x}:y=${slide.y}:shortest=0,fps=25,format=yuv420p[out]`
  ].join(";");
}

/**
 * Arguments for a live composite: the source is filled into the slide box (centre cut, never
 * stretched) on the key-colour page and published at 25 fps. The video moves on its own, so
 * there is no still and no black gap when the source changes.
 */
export function liveArgs(sourceUrl: string, layout: LiveKeyLayout, rtspUrl: string, encoder: CompositeVideoCodec): string[] {
  const { slide } = layout;
  const encoderArgs =
    encoder === "h264_v4l2m2m"
      ? ["-c:v", "h264_v4l2m2m", "-b:v", "4M"]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"];
  const graph = liveFilterGraph(layout);
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
  private readonly rtspUrl: string | undefined;
  private readonly ffmpeg: string;
  private readonly encoder: CompositeVideoCodec;
  private readonly startupWindowMs: number;
  private readonly restartBaseMs: number;
  private readonly maxRestarts: number;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger: Pick<FastifyBaseLogger, "warn"> | undefined;
  private readonly spawn: SpawnPublisher;

  constructor(options: KeyPagePublisherOptions = {}) {
    this.rtspUrl = options.rtspUrl;
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.encoder = options.encoder ?? "libx264";
    this.startupWindowMs = options.startupWindowMs ?? 1500;
    this.restartBaseMs = options.restartBaseMs ?? 1000;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.logger = options.logger;
    this.spawn = options.spawn ?? ((command, args) => nodeSpawn(command, [...args], { stdio: "ignore" }) as unknown as PublishProcess);
  }

  /** Start (or restart with a new slide) publishing the PNG. Rejects if ffmpeg exits in the start window. */
  async show(pngPath: string): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    await this.run(publishArgs(pngPath, this.rtspUrl, this.encoder), true);
  }

  /** Start (or restart) publishing a live source in the slide box. Restarts itself if the source drops. */
  async showLive(sourceUrl: string, layout: LiveKeyLayout): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    await this.run(liveArgs(sourceUrl, layout, this.rtspUrl, this.encoder), true);
  }

  /**
   * Run any ffmpeg publish command. With `supervise`, a process that dies after the start
   * window is started again with a doubling delay (1 s, 2 s, 4 s, ...) up to maxRestarts times
   * in a row; a run that lasts 10 s or more starts the count again.
   */
  async run(args: string[], supervise: boolean): Promise<void> {
    await this.stop();
    await this.start(args, supervise, 0);
  }

  private async start(args: string[], supervise: boolean, restarts: number): Promise<void> {
    const proc = this.spawn(this.ffmpeg, args);
    this.process = proc;
    const startedAt = Date.now();
    let startWindowOver = false;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        startWindowOver = true;
        resolve();
      }, this.startupWindowMs);
      const fail = (reason: string) => {
        // A process that was stopped or replaced on purpose is not a failure.
        if (this.process !== proc) return;
        this.process = null;
        this.logger?.warn({ reason }, "compose1 publisher stopped");
        if (!startWindowOver) {
          clearTimeout(timer);
          reject(new Error(`compose1 publisher failed: ${reason}`));
          return;
        }
        if (!supervise) return;
        const ranLong = Date.now() - startedAt >= 10_000;
        const next = ranLong ? 1 : restarts + 1;
        if (next > this.maxRestarts) {
          this.logger?.warn({ reason }, "publisher gave up after repeated restarts");
          return;
        }
        const delay = this.restartBaseMs * 2 ** (next - 1);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.start(args, supervise, next).catch(() => undefined);
        }, delay);
      };
      proc.onError((error) => fail(error.message));
      proc.onExit((code) => fail(`ffmpeg exited with code ${code ?? "null"}`));
    });
  }

  /** Stop publishing. Safe to call when nothing is running. */
  async stop(): Promise<void> {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const proc = this.process;
    this.process = null;
    proc?.kill("SIGTERM");
  }
}
