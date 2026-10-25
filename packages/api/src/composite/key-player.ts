import { spawn as nodeSpawn } from "node:child_process";

/**
 * Shows the HDMI key page as a still on one Pi HDMI output. ffplay has no option to pick
 * an output, so the connector is passed in PIMATRIX_OUTPUT_DEVICE (the same convention the
 * HDMI route player uses). A slide change replaces the still by stopping the old player and
 * starting a new one, so the output goes black for about a second; the ATEM keyer sees it.
 * Unverified on hardware.
 */

export type KeyPlayerState = "stopped" | "running" | "failed";

export interface KeyPlayerProcess {
  kill(signal?: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type SpawnKeyPlayer = (
  command: string,
  args: readonly string[],
  options: { stdio: "ignore"; env: NodeJS.ProcessEnv }
) => KeyPlayerProcess;

export interface KeyPagePlayerOptions {
  /** Player executable, default "ffplay". */
  player?: string;
  /** DRM connector or device name for PIMATRIX_OUTPUT_DEVICE. Undefined = no output configured. */
  device?: string | undefined;
  /** SDL_VIDEODRIVER for the player (e.g. kmsdrm on a headless Pi). */
  sdlVideoDriver?: string | undefined;
  /** Window title, so the process is easy to find with ps. */
  title?: string;
  /** How long a player must run before it counts as running, default 2000 ms. */
  startupWindowMs?: number;
  /** How long to wait after SIGTERM before SIGKILL, default 3000 ms. */
  stopGraceMs?: number;
  spawn?: SpawnKeyPlayer;
}

export interface KeyPlayerStatus {
  state: KeyPlayerState;
  lastError: string | null;
}

const defaultSpawn: SpawnKeyPlayer = (command, args, options) => {
  const child = nodeSpawn(command, [...args], options);
  return {
    kill: (signal) => child.kill(signal),
    onExit: (listener) => {
      child.on("exit", (code) => listener(code));
    },
    onError: (listener) => {
      child.on("error", listener);
    }
  };
};

interface Running {
  generation: number;
  proc: KeyPlayerProcess;
  exited: Promise<void>;
  hasExited: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
}

export class KeyPagePlayer {
  private readonly options: Required<Pick<KeyPagePlayerOptions, "player" | "title" | "startupWindowMs" | "stopGraceMs">> & KeyPagePlayerOptions;
  private readonly spawnPlayer: SpawnKeyPlayer;
  private current: Running | null = null;
  private generation = 0;
  private status: KeyPlayerStatus = { state: "stopped", lastError: null };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: KeyPagePlayerOptions = {}) {
    this.options = {
      ...options,
      player: options.player ?? "ffplay",
      title: options.title ?? "pimatrix-composite",
      startupWindowMs: options.startupWindowMs ?? 2000,
      stopGraceMs: options.stopGraceMs ?? 3000
    };
    this.spawnPlayer = options.spawn ?? defaultSpawn;
  }

  getStatus(): KeyPlayerStatus {
    return { ...this.status };
  }

  /** Show one PNG file full screen. Replaces whatever is showing. Calls are run in order. */
  show(file: string): Promise<void> {
    return this.enqueue(() => this.switchTo(file));
  }

  /** Stop the player. The output goes back to idle. */
  stop(): Promise<void> {
    return this.enqueue(() => this.stopCurrent());
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async switchTo(file: string): Promise<void> {
    await this.stopCurrent();
    if (!this.options.device) {
      this.status = { state: "failed", lastError: "PIMATRIX_COMPOSITE_HDMI_DEVICE is not set" };
      throw new Error(this.status.lastError ?? "no output");
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PIMATRIX_OUTPUT_DEVICE: this.options.device };
    if (this.options.sdlVideoDriver) env.SDL_VIDEODRIVER = this.options.sdlVideoDriver;
    const args = ["-hide_banner", "-loglevel", "warning", "-fs", "-noborder", "-an", "-window_title", this.options.title, file];

    const generation = ++this.generation;
    let proc: KeyPlayerProcess;
    try {
      proc = this.spawnPlayer(this.options.player, args, { stdio: "ignore", env });
    } catch (error) {
      this.status = { state: "failed", lastError: `player could not start: ${messageOf(error)}` };
      throw new Error(this.status.lastError ?? "player failed");
    }

    let markExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const running: Running = { generation, proc, exited, hasExited: false, startTimer: null };
    this.current = running;

    const onEnd = (code: number | null, error?: Error) => {
      running.hasExited = true;
      markExited();
      if (running.startTimer) clearTimeout(running.startTimer);
      if (this.current !== running) return;
      this.current = null;
      if (this.status.state === "running" && code === 0) {
        this.status = { state: "stopped", lastError: null };
      } else {
        const reason = error ? messageOf(error) : `player exited with code ${code}`;
        this.status = { state: "failed", lastError: reason };
      }
    };
    proc.onExit((code) => onEnd(code));
    proc.onError((error) => onEnd(null, error));

    this.status = { state: "stopped", lastError: null };
    running.startTimer = setTimeout(() => {
      running.startTimer = null;
      if (!running.hasExited && this.current === running) this.status = { state: "running", lastError: null };
    }, this.options.startupWindowMs);
  }

  private async stopCurrent(): Promise<void> {
    const running = this.current;
    if (!running) {
      this.status = { state: "stopped", lastError: null };
      return;
    }
    this.current = null;
    if (running.startTimer) clearTimeout(running.startTimer);
    if (!running.hasExited) {
      running.proc.kill("SIGTERM");
      const graceful = await Promise.race([running.exited.then(() => true), sleep(this.options.stopGraceMs).then(() => false)]);
      if (!graceful && !running.hasExited) {
        running.proc.kill("SIGKILL");
        await Promise.race([running.exited, sleep(1000)]);
      }
    }
    this.status = { state: "stopped", lastError: null };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
