import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { KeyPagePublisher, type PublishProcess } from "../src/composite/key-publisher.js";
import { EncoderPolicy } from "../src/encoder.js";
import { buildHamaCaptureSpec, StreamSupervisor } from "../src/stream-supervisor.js";
import { loadConfig } from "../src/config.js";

class FakeProcess extends EventEmitter implements PublishProcess {
  stdin = { write: () => true, once: () => undefined, end: () => undefined };
  kill(): boolean {
    this.emit("exit", null);
    return true;
  }
  onExit(l: (code: number | null) => void): void {
    this.on("exit", l);
  }
  onError(l: (e: Error) => void): void {
    this.on("error", l);
  }
}

const codecOf = (args: readonly string[]) => args[args.indexOf("-c:v") + 1];
const warnings: object[] = [];
const logger = { warn: (obj: object) => void warnings.push(obj) };

function setup(opts: { setting?: "auto" | "libx264" | "h264_v4l2m2m"; fallback?: boolean; platform?: NodeJS.Platform; hwWorks?: boolean; hwExits?: boolean }) {
  warnings.length = 0;
  let probes = 0;
  const policy = new EncoderPolicy({
    fallback: opts.fallback ?? true,
    platform: opts.platform ?? "linux",
    probe: async () => {
      probes += 1;
      return opts.hwWorks ?? true;
    },
    logger
  });
  const spawned: string[][] = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    encoder: opts.setting ?? "auto",
    encoderPolicy: policy,
    startupWindowMs: 30,
    spawn: (_c, args) => {
      const proc = new FakeProcess();
      spawned.push([...args]);
      if ((opts.hwExits ?? false) && codecOf(args) === "h264_v4l2m2m") setImmediate(() => proc.emit("exit", 1));
      return proc;
    }
  });
  return { policy, publisher, spawned, probes: () => probes };
}

test("auto: hardware that dies in the start window is retried with libx264 and remembered", async () => {
  const { publisher, spawned, policy } = setup({ hwExits: true });
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["h264_v4l2m2m", "libx264"]);
  assert.equal(policy.usingFallback, true);
  assert.equal(warnings.length, 1);
  await publisher.showLive("rtsp://h/cam1", { width: 1920, height: 1080, background: "#00ff00", slide: { x: 0, y: 0, width: 1920, height: 1080 } });
  assert.equal(codecOf(spawned[2]!), "libx264");
  assert.equal(spawned.length, 3);
  assert.equal(warnings.length, 1);
  await publisher.stop();
});

test("auto: working hardware is used", async () => {
  const { publisher, spawned } = setup({});
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["h264_v4l2m2m"]);
  await publisher.stop();
});

test("auto on a machine without the encoder goes straight to libx264 without a warning", async () => {
  const { publisher, spawned } = setup({ hwWorks: false });
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["libx264"]);
  assert.equal(warnings.length, 0);
  await publisher.stop();
});

test("non-Linux uses libx264 and never probes", async () => {
  const { publisher, spawned, probes } = setup({ platform: "win32" });
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["libx264"]);
  assert.equal(probes(), 0);
  await publisher.stop();
});

test("explicit libx264 is untouched", async () => {
  const { publisher, spawned, probes } = setup({ setting: "libx264" });
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["libx264"]);
  assert.equal(probes(), 0);
  await publisher.stop();
});

test("explicit h264_v4l2m2m also falls back", async () => {
  const { publisher, spawned } = setup({ setting: "h264_v4l2m2m", hwExits: true });
  await publisher.show("/x.png");
  assert.deepEqual(spawned.map(codecOf), ["h264_v4l2m2m", "libx264"]);
  await publisher.stop();
});

test("PIMATRIX_ENCODER_FALLBACK=off: explicit hardware is used unprobed and a failure is reported", async () => {
  const { publisher, spawned, policy } = setup({ setting: "h264_v4l2m2m", fallback: false, hwExits: true, hwWorks: false });
  await assert.rejects(publisher.show("/x.png"), /compose1 publisher failed/);
  assert.deepEqual(spawned.map(codecOf), ["h264_v4l2m2m"]);
  assert.equal(policy.usingFallback, false);
});

test("if libx264 fails right after a fallback too, the hardware encoder is not blamed", async () => {
  const policy = new EncoderPolicy({ platform: "linux", probe: async () => true, logger });
  const spawned: string[][] = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://h/compose1",
    encoderPolicy: policy,
    startupWindowMs: 30,
    spawn: (_c, args) => {
      const proc = new FakeProcess();
      spawned.push([...args]);
      setImmediate(() => proc.emit("exit", 1));
      return proc;
    }
  });
  await assert.rejects(publisher.show("/x.png"));
  assert.deepEqual(spawned.map(codecOf), ["h264_v4l2m2m", "libx264"]);
  assert.equal(policy.usingFallback, false);
});

test("Hama spec uses the policy's encoder and labels it", () => {
  const config = loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://m:8554/hama", PIMATRIX_HAMA_VIDEO_CODEC: "auto" });
  const hw = buildHamaCaptureSpec(config, 1, undefined, "h264_v4l2m2m");
  assert.equal(codecOf(hw.ffmpeg!.args), "h264_v4l2m2m");
  assert.equal(hw.labels?.encoder, "h264_v4l2m2m");
  const sw = buildHamaCaptureSpec(config, 2, undefined, "libx264");
  assert.equal(codecOf(sw.ffmpeg!.args), "libx264");
  const copy = buildHamaCaptureSpec(loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://m:8554/hama", PIMATRIX_HAMA_VIDEO_CODEC: "copy" }), 3, undefined, "h264_v4l2m2m");
  assert.equal(copy.labels?.encoder, undefined);
});

test("StreamSupervisor relaunches a hardware Hama job that dies in its start window with libx264", async () => {
  const policy = new EncoderPolicy({ platform: "linux", probe: async () => true, logger });
  const config = loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://m:8554/hama", PIMATRIX_HAMA_ENABLED: "true" });
  const submitted: string[] = [];
  const fleet = {
    submit: async (spec: { ffmpeg?: { args: string[] } }) => {
      submitted.push(codecOf(spec.ffmpeg!.args)!);
      const hw = submitted.length === 1;
      const listeners: Record<string, (v: never) => void> = {};
      return {
        id: `job${submitted.length}`, state: "running", stderrTail: "no v4l2m2m device",
        on: (e: string, l: (v: never) => void) => { listeners[e] = l; },
        cancel: async () => undefined,
        done: hw
          ? Promise.resolve({ state: "failed", error: { message: "encoder failed" }, stderrTail: "boom" })
          : new Promise(() => undefined)
      };
    },
    close: async () => undefined
  };
  const supervisor = new StreamSupervisor(
    fleet as never,
    (attempt, encoder) => buildHamaCaptureSpec(config, attempt, undefined, encoder),
    true, 10, 100,
    { policy, setting: () => "auto" }
  );
  supervisor.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(submitted, ["h264_v4l2m2m", "libx264"]);
  assert.equal(policy.usingFallback, true);
  await supervisor.halt();
});

test("PIMATRIX_COMPOSITE_VIDEO_CODEC defaults to auto; PIMATRIX_ENCODER_FALLBACK parses", () => {
  assert.equal(loadConfig({}).compositeVideoCodec, "auto");
  assert.equal(loadConfig({}).encoderFallback, true);
  assert.equal(loadConfig({ PIMATRIX_COMPOSITE_VIDEO_CODEC: "libx264", PIMATRIX_ENCODER_FALLBACK: "off" }).encoderFallback, false);
  assert.throws(() => loadConfig({ PIMATRIX_COMPOSITE_VIDEO_CODEC: "x265" }), /PIMATRIX_COMPOSITE_VIDEO_CODEC/);
  assert.throws(() => loadConfig({ PIMATRIX_ENCODER_FALLBACK: "maybe" }), /PIMATRIX_ENCODER_FALLBACK/);
});
