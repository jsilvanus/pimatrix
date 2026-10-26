/**
 * Renders one key-page frame with ffmpeg. The slide goes in on stdin as a PNG and the
 * frame comes back on stdout: a PNG (for the HDMI key player) or raw RGBA (for the ATEM
 * media upload, which takes RGBA at the switcher's video format). No temporary files.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { keyPageFilterGraph, type KeyPageGeometry } from "./key-page.js";
import { liveFilterGraph, type LiveKeyLayout } from "./key-publisher.js";

export type KeyPageFormat = "png" | "rgba";

/** The part of a child process this renderer uses (node's ChildProcess satisfies it). */
export interface FfmpegProcess {
  stdin: { end(data: Buffer): void };
  stdout: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  on(event: string, listener: (...args: never[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFfmpeg = (command: string, args: readonly string[]) => FfmpegProcess;

export interface RenderKeyPageOptions {
  geometry: KeyPageGeometry;
  /** The slide as PNG bytes. */
  slidePng: Buffer;
  format: KeyPageFormat;
  ffmpeg?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to node:child_process spawn. */
  spawn?: SpawnFfmpeg;
}

/** The ffmpeg argument list for one frame. Pure, so the command line is testable. */
export function keyPageArgs(geometry: KeyPageGeometry, format: KeyPageFormat): string[] {
  const common = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "png_pipe", "-i", "pipe:0",
    "-filter_complex", keyPageFilterGraph(geometry),
    "-map", "[out]", "-frames:v", "1"
  ];
  if (format === "png") return [...common, "-f", "image2pipe", "-c:v", "png", "pipe:1"];
  return [...common, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Buffer): boolean {
  return bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

const defaultSpawn: SpawnFfmpeg = (command, args) =>
  nodeSpawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] }) as unknown as FfmpegProcess;

/** Runs ffmpeg once and returns what it wrote to stdout. `stdin` is written and closed. */
async function runCapture(command: string, args: string[], stdin: Buffer, timeoutMs: number, spawnProcess: SpawnFfmpeg): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawnProcess(command, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: Error) => finish(() => reject(new Error(`ffmpeg could not start: ${error.message}`))));
    child.on("close", (code: number | null) => {
      finish(() => {
        if (code === 0) {
          resolve(Buffer.concat(out));
        } else {
          const tail = Buffer.concat(err).toString("utf8").trim().split("\n").slice(-3).join(" | ");
          reject(new Error(`ffmpeg exited with code ${code}${tail ? `: ${tail}` : ""}`));
        }
      });
    });
    child.stdin.end(stdin);
  });
}

export async function renderKeyPage(options: RenderKeyPageOptions): Promise<Buffer> {
  if (!isPng(options.slidePng)) throw new Error("The slide must be a PNG image");
  return await runCapture(
    options.ffmpeg ?? "ffmpeg",
    keyPageArgs(options.geometry, options.format),
    options.slidePng,
    options.timeoutMs ?? 30_000,
    options.spawn ?? defaultSpawn
  );
}

export interface RenderLiveFrameOptions {
  sourceUrl: string;
  layout: LiveKeyLayout;
  ffmpeg?: string;
  timeoutMs?: number;
  spawn?: SpawnFfmpeg;
}

/** One PNG of what a live composite shows: a frame of the source in the slide box, from the source itself. */
export async function renderLiveFrame(options: RenderLiveFrameOptions): Promise<Buffer> {
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...(options.sourceUrl.startsWith("rtsp:") ? ["-rtsp_transport", "tcp"] : []),
    "-i", options.sourceUrl,
    "-filter_complex", liveFilterGraph(options.layout),
    "-map", "[out]", "-frames:v", "1",
    "-f", "image2pipe", "-c:v", "png", "pipe:1"
  ];
  return await runCapture(options.ffmpeg ?? "ffmpeg", args, Buffer.alloc(0), options.timeoutMs ?? 10_000, options.spawn ?? defaultSpawn);
}
