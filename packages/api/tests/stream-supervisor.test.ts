import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Fleet, JobHandle, JobSnapshot, JobSpecInput, JobState } from "fffleet";
import { loadConfig } from "../src/config.js";
import { buildHamaCaptureSpec, StreamSupervisor } from "../src/stream-supervisor.js";

class FakeJob extends EventEmitter {
  readonly done: Promise<JobSnapshot>;
  readonly id: string;
  state: JobState = "running";
  stderrTail: string | null = null;
  private resolveDone!: (snapshot: JobSnapshot) => void;

  constructor(id: string) {
    super();
    this.id = id;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  finish(state: JobState, message?: string): void {
    this.state = state;
    this.emit("state", state, { state });
    this.resolveDone({
      id: this.id,
      kind: "stream",
      type: "ffmpeg",
      class: "stream",
      owner: "pimatrix",
      priority: 100,
      labels: {},
      state,
      workerId: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      progress: null,
      exitCode: state === "succeeded" ? 0 : 1,
      error: message ? { code: "FFMPEG_EXIT", message } : null,
      outputs: [],
      stderrTail: this.stderrTail,
      seq: 1
    });
  }

  async cancel(): Promise<unknown> {
    if (this.state === "running") this.finish("cancelled", "cancelled by supervisor");
    return { state: "cancelled" };
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Condition did not become true before timeout");
}

test("Hama capture job is a local-device FFmpeg stream published to MediaMTX", () => {
  const config = loadConfig({
    PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama",
    PIMATRIX_HAMA_DEVICE: "/dev/video2",
    PIMATRIX_HAMA_WIDTH: "1280",
    PIMATRIX_HAMA_HEIGHT: "720",
    PIMATRIX_HAMA_FRAME_RATE: "25"
  });
  const spec = buildHamaCaptureSpec(config, 3);
  assert.equal(spec.id, "pimatrix-hama-capture-3");
  assert.equal(spec.kind, "stream");
  assert.equal(spec.class, "stream");
  assert.deepEqual(spec.outputs, [{ name: "preview", uri: "rtsp://mediamtx:8554/hama" }]);
  assert.ok(spec.ffmpeg?.args.includes("/dev/video2"));
  assert.ok(spec.ffmpeg?.args.includes("1280x720"));
  assert.ok(spec.ffmpeg?.args.includes("{{output:preview}}"));
  assert.equal(spec.labels?.source, "hama");
});

test("stream supervisor restarts a failed job with a new id and closes its fleet", async () => {
  const jobs: FakeJob[] = [];
  const submittedSpecs: JobSpecInput[] = [];
  let closed = false;
  const fleet = {
    submit: async (spec: JobSpecInput) => {
      submittedSpecs.push(spec);
      const job = new FakeJob(String(spec.id));
      jobs.push(job);
      return job as unknown as JobHandle;
    },
    close: async () => { closed = true; }
  } as unknown as Pick<Fleet, "submit" | "close">;
  const supervisor = new StreamSupervisor(
    fleet,
    (attempt) => ({ id: `pimatrix-test-${attempt}`, kind: "stream", ffmpeg: { args: ["-version"] } }),
    true,
    5,
    20
  );

  supervisor.start();
  await waitFor(() => jobs.length === 1);
  assert.equal(supervisor.snapshot().state, "running");
  jobs[0]!.finish("failed", "test failure");
  await waitFor(() => jobs.length === 2);

  assert.equal(submittedSpecs[0]?.id, "pimatrix-test-1");
  assert.equal(submittedSpecs[1]?.id, "pimatrix-test-2");
  assert.equal(supervisor.snapshot().attempt, 2);
  assert.equal(supervisor.snapshot().state, "running");

  await supervisor.stop();
  assert.equal(closed, true);
  assert.equal(supervisor.snapshot().state, "stopping");
});


test("Hama capture defaults to 1920x1080 on the Pi hardware encoder, with no forced input format", () => {
  const config = loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama" });
  const args = buildHamaCaptureSpec(config, 1).ffmpeg?.args ?? [];
  assert.equal(args.includes("-input_format"), false);
  assert.equal(args.includes("-framerate"), false);
  assert.equal(args[args.indexOf("-video_size") + 1], "1920x1080");
  assert.equal(args[args.indexOf("-c:v") + 1], "h264_v4l2m2m");
});

test("Hama capture uses the Pi hardware encoder when PIMATRIX_HAMA_VIDEO_CODEC is h264_v4l2m2m", () => {
  const config = loadConfig({
    PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama",
    PIMATRIX_HAMA_VIDEO_CODEC: "h264_v4l2m2m"
  });
  const args = buildHamaCaptureSpec(config, 1).ffmpeg?.args ?? [];
  const at = args.indexOf("-c:v");
  assert.equal(args[at + 1], "h264_v4l2m2m");
  assert.ok(args.includes("-b:v"));
  assert.equal(args.includes("libx264"), false);
});

test("Hama capture with a filter re-encodes with the configured encoder", () => {
  const hw = loadConfig({
    PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama",
    PIMATRIX_HAMA_VIDEO_CODEC: "h264_v4l2m2m"
  });
  const hwArgs = buildHamaCaptureSpec(hw, 1, "crop=640:360:0:0").ffmpeg?.args ?? [];
  assert.equal(hwArgs[hwArgs.indexOf("-c:v") + 1], "h264_v4l2m2m");

  const sw = loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama", PIMATRIX_HAMA_VIDEO_CODEC: "copy" });
  const swArgs = buildHamaCaptureSpec(sw, 1, "crop=640:360:0:0").ffmpeg?.args ?? [];
  assert.equal(swArgs[swArgs.indexOf("-c:v") + 1], "libx264");
});

test("PIMATRIX_HAMA_VIDEO_CODEC rejects unknown encoders", () => {
  assert.throws(
    () => loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama", PIMATRIX_HAMA_VIDEO_CODEC: "h265" }),
    /PIMATRIX_HAMA_VIDEO_CODEC/
  );
});
