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

export class KeyPagePublisher {
  private process: PublishProcess | null = null;
  private readonly rtspUrl: string | undefined;
  private readonly ffmpeg: string;
  private readonly encoder: CompositeVideoCodec;
  private readonly startupWindowMs: number;
  private readonly logger: Pick<FastifyBaseLogger, "warn"> | undefined;
  private readonly spawn: SpawnPublisher;

  constructor(options: KeyPagePublisherOptions = {}) {
    this.rtspUrl = options.rtspUrl;
    this.ffmpeg = options.ffmpeg ?? "ffmpeg";
    this.encoder = options.encoder ?? "libx264";
    this.startupWindowMs = options.startupWindowMs ?? 1500;
    this.logger = options.logger;
    this.spawn = options.spawn ?? ((command, args) => nodeSpawn(command, [...args], { stdio: "ignore" }) as unknown as PublishProcess);
  }

  /** Start (or restart with a new slide) publishing the PNG. Rejects if ffmpeg exits in the start window. */
  async show(pngPath: string): Promise<void> {
    if (!this.rtspUrl) {
      throw new Error("PIMATRIX_MEDIAMTX_RTSP_URL is not set, so compose1 cannot be published");
    }
    await this.stop();
    const proc = this.spawn(this.ffmpeg, publishArgs(pngPath, this.rtspUrl, this.encoder));
    this.process = proc;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.startupWindowMs);
      const fail = (reason: string) => {
        // A process that was stopped or replaced on purpose is not a failure.
        if (this.process !== proc) return;
        clearTimeout(timer);
        this.process = null;
        this.logger?.warn({ reason }, "compose1 publisher stopped");
        reject(new Error(`compose1 publisher failed: ${reason}`));
      };
      proc.onError((error) => fail(error.message));
      proc.onExit((code) => fail(`ffmpeg exited with code ${code ?? "null"}`));
    });
  }

  /** Stop publishing. Safe to call when nothing is running. */
  async stop(): Promise<void> {
    const proc = this.process;
    this.process = null;
    proc?.kill("SIGTERM");
  }
}
