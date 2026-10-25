import { spawn as nodeSpawn } from "node:child_process";
import type { OutputId, SourceId } from "./model.js";
import type { DisplayAdapter, DisplayAdapterState, DisplayOutputState } from "./display-adapter.js";

/**
 * HDMI display adapter: one player process per HDMI output.
 *
 * Each output gets at most one player (ffplay by default). A route change stops the
 * current player for that output and then starts a new one for the requested source.
 * Routes for the same output run strictly in order, so a stop always finishes before
 * the next start (the old process may still hold the display device).
 *
 * Per-output state machine (DisplayOutputState.state):
 *
 *   unavailable --route(source), spawned--> starting
 *   starting    --still running after startupWindowMs--> active
 *   starting    --exits non-zero (or fails to spawn) inside the window--> failed
 *   starting|active --route(null)--> unavailable (player stopped on purpose)
 *   active      --exits on its own after the window--> unavailable (source ended, player closed)
 *   any         --route(source) with no device or no source URL--> unavailable / failed
 *
 * Exits caused by our own stop are ignored. observedSource is the source of the current
 * player and is cleared whenever no player is running for the output.
 *
 * Hardware is not verified: the spawn arguments are the ffplay options we expect to need,
 * not tested against a real HDMI output. ffplay has no option to pick an output, so the
 * device is handed to the player in the PIMATRIX_OUTPUT_DEVICE environment variable (a DRM
 * connector name such as card1-HDMI-A-1 on a headless Pi). With no desktop, ffplay needs
 * SDL_VIDEODRIVER=kmsdrm; the adapter sets it from sdlVideoDriver. Picking the connector
 * is not something ffplay exposes, so a wrapper script set as PIMATRIX_HDMI_PLAYER should
 * read PIMATRIX_OUTPUT_DEVICE and select that connector. Unverified on hardware.
 */

/** The part of a child process the adapter uses. Node's ChildProcess satisfies it. */
export interface PlayerProcess {
  kill(signal?: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type SpawnPlayer = (
  command: string,
  args: readonly string[],
  options: { stdio: "ignore"; env: NodeJS.ProcessEnv }
) => PlayerProcess;

export interface HdmiOutputConfig {
  /** Device argument for this output (DRM/KMS device or display name). Undefined = not configured. */
  device?: string | undefined;
}

export interface HdmiPlayerAdapterOptions {
  /** Known HDMI outputs. Outputs without a device are known but not configured. */
  outputs: ReadonlyMap<OutputId, HdmiOutputConfig>;
  /** Maps a logical source ID to an RTSP or HLS URL. Undefined = source cannot be played. */
  sourceUrl: (sourceId: SourceId) => string | undefined;
  /** Player executable, default "ffplay". */
  player?: string;
  /** Whether the player plays audio, default false. */
  audio?: boolean;
  /** How long a player must keep running before it counts as active, default 2000 ms. */
  startupWindowMs?: number;
  /** How long to wait after SIGTERM before SIGKILL, default 3000 ms. */
  stopGraceMs?: number;
  /** Injectable process spawner; defaults to node:child_process spawn. */
  spawn?: SpawnPlayer;
  /** SDL video driver set for each player (SDL_VIDEODRIVER), e.g. "kmsdrm". Undefined = inherit. */
  sdlVideoDriver?: string;
}

interface PlayerRecord {
  proc: PlayerProcess;
  sourceId: SourceId;
  exited: Promise<void>;
  hasExited: boolean;
  stopping: boolean;
  startTimer: ReturnType<typeof setTimeout> | null;
}

const defaultSpawn: SpawnPlayer = (command, args, options) => {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HdmiPlayerAdapter implements DisplayAdapter {
  private readonly devices: ReadonlyMap<OutputId, string | undefined>;
  private readonly states = new Map<OutputId, DisplayOutputState>();
  private readonly players = new Map<OutputId, PlayerRecord>();
  private readonly queues = new Map<OutputId, Promise<unknown>>();
  private readonly sourceUrl: (sourceId: SourceId) => string | undefined;
  private readonly player: string;
  private readonly audio: boolean;
  private readonly startupWindowMs: number;
  private readonly stopGraceMs: number;
  private readonly spawnPlayer: SpawnPlayer;
  private readonly sdlVideoDriver: string | undefined;

  constructor(options: HdmiPlayerAdapterOptions) {
    this.devices = new Map([...options.outputs].map(([id, config]) => [id, config.device]));
    this.sourceUrl = options.sourceUrl;
    this.player = options.player ?? "ffplay";
    this.audio = options.audio ?? false;
    this.startupWindowMs = options.startupWindowMs ?? 2000;
    this.stopGraceMs = options.stopGraceMs ?? 3000;
    this.spawnPlayer = options.spawn ?? defaultSpawn;
    this.sdlVideoDriver = options.sdlVideoDriver;
    for (const id of this.devices.keys()) {
      this.states.set(id, { id, observedSource: null, state: "unavailable" });
    }
  }

  getOutputState(outputId: OutputId): DisplayOutputState {
    return { ...this.requireState(outputId) };
  }

  /**
   * Stop the current player for the output, then start one for sourceId (or leave the
   * output idle when sourceId is null). Returns "starting" for a new player; a later
   * snapshot via getOutputState shows "active" once the player has run for the window.
   */
  async applyRoute(outputId: OutputId, sourceId: SourceId | null): Promise<DisplayOutputState> {
    this.requireState(outputId);
    const previous = this.queues.get(outputId) ?? Promise.resolve();
    const run = previous.then(() => this.switchTo(outputId, sourceId));
    this.queues.set(outputId, run.catch(() => undefined));
    return await run;
  }

  /** "ready" when at least one output has a device, otherwise "not-configured". */
  getStatus(): DisplayAdapterState {
    for (const device of this.devices.values()) {
      if (device) return "ready";
    }
    return "not-configured";
  }

  /** Stop every player. Outputs go back to "unavailable". */
  async close(): Promise<void> {
    await Promise.all([...this.players.keys()].map((id) => this.stopPlayer(id)));
    for (const id of this.states.keys()) this.setState(id, "unavailable", null);
  }

  private requireState(outputId: OutputId): DisplayOutputState {
    const state = this.states.get(outputId);
    if (!state) throw new Error(`Unknown output ID: ${outputId}`);
    return state;
  }

  private setState(outputId: OutputId, state: DisplayOutputState["state"], observedSource: SourceId | null): DisplayOutputState {
    const current = this.requireState(outputId);
    const updated: DisplayOutputState = { ...current, state, observedSource };
    this.states.set(outputId, updated);
    return { ...updated };
  }

  private async switchTo(outputId: OutputId, sourceId: SourceId | null): Promise<DisplayOutputState> {
    await this.stopPlayer(outputId);
    if (sourceId === null) return this.setState(outputId, "unavailable", null);

    const device = this.devices.get(outputId);
    const url = this.sourceUrl(sourceId);
    if (!device || !url) return this.setState(outputId, "failed", null);

    const args = this.playerArgs(outputId, url);
    const env: NodeJS.ProcessEnv = { ...process.env, PIMATRIX_OUTPUT_DEVICE: device };
    if (this.sdlVideoDriver) env.SDL_VIDEODRIVER = this.sdlVideoDriver;
    let proc: PlayerProcess;
    try {
      proc = this.spawnPlayer(this.player, args, { stdio: "ignore", env });
    } catch {
      return this.setState(outputId, "failed", null);
    }

    this.trackPlayer(outputId, proc, sourceId);
    return this.setState(outputId, "starting", sourceId);
  }

  /** Arguments for one ffplay run. Full screen, no audio unless configured. */
  private playerArgs(outputId: OutputId, url: string): string[] {
    const args = ["-hide_banner", "-loglevel", "warning", "-fs", "-noborder", "-fflags", "nobuffer"];
    if (!this.audio) args.push("-an");
    if (url.startsWith("rtsp:")) args.push("-rtsp_transport", "tcp");
    args.push("-window_title", `pimatrix-${outputId}`, url);
    return args;
  }

  private trackPlayer(outputId: OutputId, proc: PlayerProcess, sourceId: SourceId): void {
    let markExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const record: PlayerRecord = { proc, sourceId, exited, hasExited: false, stopping: false, startTimer: null };
    this.players.set(outputId, record);

    const onEnd = (code: number | null) => {
      record.hasExited = true;
      markExited();
      if (record.startTimer) clearTimeout(record.startTimer);
      if (record.stopping || this.players.get(outputId) !== record) return;
      this.players.delete(outputId);
      const current = this.states.get(outputId);
      const inWindow = current?.state === "starting";
      if (inWindow && (code === null || code !== 0)) {
        this.setState(outputId, "failed", null);
      } else {
        this.setState(outputId, "unavailable", null);
      }
    };
    proc.onExit((code) => onEnd(code));
    proc.onError(() => onEnd(null));

    record.startTimer = setTimeout(() => {
      record.startTimer = null;
      if (!record.hasExited && this.players.get(outputId) === record) {
        this.setState(outputId, "active", record.sourceId);
      }
    }, this.startupWindowMs);
  }

  /** SIGTERM, then SIGKILL after stopGraceMs if the player has not exited. */
  private async stopPlayer(outputId: OutputId): Promise<void> {
    const record = this.players.get(outputId);
    if (!record) return;
    this.players.delete(outputId);
    record.stopping = true;
    if (record.startTimer) clearTimeout(record.startTimer);

    if (!record.hasExited) {
      record.proc.kill("SIGTERM");
      const graceful = await Promise.race([record.exited.then(() => true), sleep(this.stopGraceMs).then(() => false)]);
      if (!graceful && !record.hasExited) {
        record.proc.kill("SIGKILL");
        await Promise.race([record.exited, sleep(1000)]);
      }
    }
    this.setState(outputId, "unavailable", null);
  }
}
