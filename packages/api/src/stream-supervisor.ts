import type { Fleet, JobHandle, JobSnapshot, JobSpecInput } from "fffleet";
import type { AppConfig } from "./config.js";

export type ManagedStreamState = "disabled" | "starting" | "running" | "degraded" | "failed" | "stopping";

export interface ManagedStreamSnapshot {
  state: ManagedStreamState;
  jobId: string | null;
  attempt: number;
  lastError: string | null;
  stderrTail: string | null;
}

type StreamJobFactory = (attempt: number) => JobSpecInput;

export function buildHamaCaptureSpec(config: AppConfig, attempt: number): JobSpecInput {
  if (!config.hamaRtspUrl) {
    throw new Error("Hama capture requires PIMATRIX_HAMA_RTSP_URL");
  }

  const args = [
    "-hide_banner",
    "-nostdin",
    "-loglevel", "warning",
    "-thread_queue_size", "512",
    "-f", "v4l2",
  ];

  if (config.hamaInputFormat) args.push("-input_format", config.hamaInputFormat);
  if (config.hamaFrameRate) args.push("-framerate", String(config.hamaFrameRate));
  if (config.hamaWidth && config.hamaHeight) args.push("-video_size", `${config.hamaWidth}x${config.hamaHeight}`);

  args.push("-i", config.hamaDevice,
    "-an"
  ];

  if (config.hamaVideoCodec === "copy") {
    args.push("-c:v", "copy");
  } else if (config.hamaVideoCodec === "libx264") {
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p");
  }

  args.push("-f", "rtsp", "-rtsp_transport", "tcp", "{{output:preview}}");

  return {
    id: `pimatrix-hama-capture-${attempt}`,
    kind: "stream",
    class: "stream",
    priority: 100,
    labels: {
      application: "pimatrix",
      role: "capture",
      source: "hama",
      attempt: String(attempt)
    },
    outputs: [{ name: "preview", uri: config.hamaRtspUrl }],
    ffmpeg: { args }
  };
}

export class StreamSupervisor {
  private stopping = false;
  private attempt = 0;
  private failures = 0;
  private activeJob: JobHandle | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private launchPromise: Promise<void> | null = null;
  private currentState: ManagedStreamState;
  private lastError: string | null = null;
  private lastStderr: string | null = null;

  constructor(
    private readonly fleet: Pick<Fleet, "submit" | "close"> | null,
    private readonly makeSpec: StreamJobFactory,
    private readonly enabled: boolean,
    private readonly restartMinMs: number,
    private readonly restartMaxMs: number
  ) {
    this.currentState = enabled ? "starting" : "disabled";
  }

  snapshot(): ManagedStreamSnapshot {
    return {
      state: this.currentState,
      jobId: this.activeJob?.id ?? null,
      attempt: this.attempt,
      lastError: this.lastError,
      stderrTail: this.lastStderr
    };
  }

  start(): void {
    if (!this.enabled || this.stopping || this.launchPromise || this.activeJob) return;
    this.currentState = "starting";
    this.launchPromise = this.launch();
  }

  private async launch(): Promise<void> {
    if (!this.fleet || this.stopping) return;
    this.attempt += 1;
    try {
      const job = await this.fleet.submit(this.makeSpec(this.attempt));
      if (this.stopping) {
        await job.cancel().catch(() => undefined);
        return;
      }

      this.activeJob = job;
      this.currentState = job.state === "running" ? "running" : "starting";
      job.on("state", (state) => {
        if (this.activeJob !== job || this.stopping) return;
        if (state === "running") this.currentState = "running";
        else if (state === "failed" || state === "cancelled") this.currentState = "degraded";
        else if (state === "queued" || state === "assigned" || state === "staging") this.currentState = "starting";
      });
      job.on("stderr", (tail) => {
        if (this.activeJob === job) this.lastStderr = tail;
      });
      void this.watch(job);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.currentState = "degraded";
      this.scheduleRetry();
    } finally {
      this.launchPromise = null;
    }
  }

  private async watch(job: JobHandle): Promise<void> {
    let result: JobSnapshot;
    try {
      result = await job.done;
    } catch (error) {
      result = {
        id: job.id, kind: "stream", type: "ffmpeg", class: "stream", owner: "pimatrix",
        priority: 100, labels: {}, state: "failed", workerId: null, createdAt: new Date().toISOString(),
        startedAt: null, finishedAt: new Date().toISOString(), progress: null, exitCode: null,
        error: { code: "JOB_MONITOR_FAILED", message: error instanceof Error ? error.message : String(error) },
        outputs: [], stderrTail: job.stderrTail, seq: 0
      };
    }

    if (this.activeJob !== job) return;
    this.activeJob = null;
    this.lastStderr = result.stderrTail ?? job.stderrTail ?? this.lastStderr;

    if (this.stopping) {
      this.currentState = "stopping";
      return;
    }

    this.lastError = result.state === "succeeded"
      ? "Stream job ended unexpectedly"
      : result.error?.message ?? result.stderrTail ?? `Stream job ended in state ${result.state}`;
    this.currentState = "degraded";
    this.failures += 1;
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.stopping || !this.enabled || this.retryTimer) return;
    const exponent = Math.min(Math.max(this.failures - 1, 0), 8);
    const delay = Math.min(this.restartMaxMs, this.restartMinMs * (2 ** exponent));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopping) return;
      this.launchPromise = this.launch();
    }, delay);
    this.retryTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.currentState = "stopping";

    await this.launchPromise?.catch(() => undefined);
    const job = this.activeJob;
    this.activeJob = null;
    if (job) await job.cancel().catch(() => undefined);
    await this.fleet?.close();
    this.currentState = this.enabled ? "stopping" : "disabled";
  }
}
