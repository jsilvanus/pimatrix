import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { EncoderPolicy } from "../src/encoder.js";
import { KeyPagePublisher, evenSize, liveArgs, stillConvertArgs, liveFilterGraph, pipePublishArgs, publishArgs, type PublishProcess } from "../src/composite/key-publisher.js";

class FakeProcess extends EventEmitter implements PublishProcess {
  killed: NodeJS.Signals | null = null;
  writes: Buffer[] = [];
  stdin = {
    write: (chunk: Buffer) => {
      this.writes.push(chunk);
      return true;
    },
    once: () => undefined,
    end: () => undefined
  };
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? "SIGTERM";
    this.emit("exit", null);
    return true;
  }
  onExit(listener: (code: number | null) => void): void {
    this.on("exit", listener);
  }
  onError(listener: (error: Error) => void): void {
    this.on("error", listener);
  }
  crash(code: number): void {
    this.emit("exit", code);
  }
}

function harness(startupWindowMs = 10, extra: Partial<ConstructorParameters<typeof KeyPagePublisher>[0]> = {}) {
  const spawned: Array<{ args: readonly string[]; proc: FakeProcess }> = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    encoder: "libx264",
    startupWindowMs,
    ...extra,
    spawn: (_command, args) => {
      const proc = new FakeProcess();
      spawned.push({ args, proc });
      return proc;
    }
  });
  return { publisher, spawned };
}

test("publishArgs loops the still at 1 fps and publishes over RTSP/TCP to the given URL", () => {
  const args = publishArgs("/data/compose1-key.png", "rtsp://127.0.0.1:8554/compose1", "h264_v4l2m2m");
  assert.ok(args.includes("-loop") && args[args.indexOf("-loop") + 1] === "1");
  assert.equal(args[args.indexOf("-framerate") + 1], "1");
  assert.equal(args[args.indexOf("-i") + 1], "/data/compose1-key.png");
  assert.equal(args[args.indexOf("-c:v") + 1], "h264_v4l2m2m");
  assert.equal(args[args.length - 1], "rtsp://127.0.0.1:8554/compose1");
  assert.equal(args[args.indexOf("-f") + 1], "rtsp");
  assert.equal(args.includes("libx264"), false);
});

test("the software encoder is used unless the hardware one is chosen", () => {
  const args = publishArgs("/x.png", "rtsp://h/compose1", "libx264");
  assert.equal(args[args.indexOf("-c:v") + 1], "libx264");
  assert.equal(args[args.indexOf("-tune") + 1], "stillimage");
});

test("show starts a publisher; a new slide restarts it and the old process is stopped", async () => {
  const { publisher, spawned } = harness();
  await publisher.show("/data/a.png");
  assert.equal(spawned.length, 1);
  await publisher.show("/data/b.png");
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0]!.proc.killed, "SIGTERM");
  assert.equal(spawned[1]!.args[spawned[1]!.args.indexOf("-i") + 1], "/data/b.png");
});

test("stop kills the publisher and a later stop is harmless", async () => {
  const { publisher, spawned } = harness();
  await publisher.show("/data/a.png");
  await publisher.stop();
  assert.equal(spawned[0]!.proc.killed, "SIGTERM");
  await publisher.stop();
});

test("ffmpeg exiting inside the start window rejects the show", async () => {
  const { publisher, spawned } = harness(200);
  const shown = publisher.show("/data/a.png");
  await new Promise((resolve) => setImmediate(resolve));
  spawned[0]!.proc.crash(1);
  await assert.rejects(shown, /ffmpeg exited with code 1/);
});

test("without an RTSP URL the publisher refuses to start", async () => {
  const publisher = new KeyPagePublisher({ rtspUrl: undefined, spawn: () => new FakeProcess() });
  await assert.rejects(publisher.show("/data/a.png"), /PIMATRIX_MEDIAMTX_RTSP_URL/);
});

const layout = { width: 1920, height: 1080, background: "#00ff00", slide: { x: 0, y: 0, width: 676, height: 1080 } };

test("liveArgs fills the source into the slide box on the key page and publishes at 25 fps", () => {
  const args = liveArgs("rtsp://127.0.0.1:8554/hama", layout, "rtsp://127.0.0.1:8554/compose1", "libx264");
  assert.equal(args[args.indexOf("-i") + 1], "rtsp://127.0.0.1:8554/hama");
  assert.equal(args[args.indexOf("-rtsp_transport") + 1], "tcp");
  const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(graph, /color=c=0x00ff00:s=1920x1080:r=25/);
  assert.match(graph, /scale=676:1080:force_original_aspect_ratio=increase,crop=676:1080/);
  assert.match(graph, /overlay=x=0:y=0/);
  assert.equal(args[args.indexOf("-r") + 1], "25");
  assert.equal(args[args.indexOf("-tune") + 1], "zerolatency");
  assert.equal(args[args.length - 1], "rtsp://127.0.0.1:8554/compose1");
});

test("showLive replaces the running process", async () => {
  const { publisher, spawned } = harness();
  await publisher.show("/data/a.png");
  await publisher.showLive("rtsp://127.0.0.1:8554/cam1", layout);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0]?.proc.killed, "SIGTERM");
  assert.ok(spawned[1]?.args.includes("-filter_complex"));
});

test("a live process that dies after the start window is restarted with a doubling delay, then given up", async () => {
  const spawned: FakeProcess[] = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    encoder: "libx264",
    startupWindowMs: 5,
    restartBaseMs: 5,
    maxRestarts: 2,
    spawn: () => {
      const proc = new FakeProcess();
      spawned.push(proc);
      return proc;
    }
  });
  await publisher.showLive("rtsp://127.0.0.1:8554/cam1", layout);
  assert.equal(spawned.length, 1);
  spawned[0]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(spawned.length, 2);
  spawned[1]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(spawned.length, 3);
  spawned[2]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(spawned.length, 3, "gave up after maxRestarts");
});

test("stop cancels a pending restart", async () => {
  const spawned: FakeProcess[] = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    encoder: "libx264",
    startupWindowMs: 5,
    restartBaseMs: 30,
    spawn: () => {
      const proc = new FakeProcess();
      spawned.push(proc);
      return proc;
    }
  });
  await publisher.showLive("rtsp://127.0.0.1:8554/cam1", layout);
  spawned[0]?.crash(1);
  await publisher.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(spawned.length, 1);
});

test("pipePublishArgs uses image2pipe and showFrame swaps frames without restarting ffmpeg", async () => {
  const args = pipePublishArgs("rtsp://127.0.0.1:8554/PiPGM1", "libx264", 1);
  assert.ok(args.join(" ").includes("-f image2pipe -framerate 1 -c:v png -i -"));
  const { publisher, spawned } = harness(10, { stillInput: "png" });
  await publisher.showFrame(Buffer.from("frame1"), 1920, 1080);
  await publisher.showFrame(Buffer.from("frame2"), 1920, 1080);
  assert.equal(spawned.length, 1, "same dimensions reuse the running pipe process");
  assert.deepEqual(spawned[0]!.proc.writes.map((b) => b.toString()), ["frame1", "frame2"]);
  await publisher.showFrame(Buffer.from("frame3"), 1080, 1920);
  assert.equal(spawned.length, 2, "changed dimensions restart ffmpeg");
  await publisher.stop();
});

test("liveFilterGraph and liveArgs fuse sourceFilter directly onto [0:v]", () => {
  const graph = liveFilterGraph(layout, "crop=608:1080:480:0,transpose=1");
  assert.ok(graph.includes("[0:v]crop=608:1080:480:0,transpose=1,scale=676:1080"));
  const args = liveArgs("rtsp://127.0.0.1:8554/cam1", layout, "rtsp://127.0.0.1:8554/compose1", "libx264", "crop=608:1080:480:0");
  assert.ok(args[args.indexOf("-filter_complex") + 1]?.includes("[0:v]crop=608:1080:480:0,scale=676:1080"));
});

test("supervised restart that exits inside startupWindowMs still retries up to maxRestarts", async () => {
  const spawned: FakeProcess[] = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    startupWindowMs: 40,
    restartBaseMs: 5,
    maxRestarts: 2,
    spawn: () => {
      const proc = new FakeProcess();
      spawned.push(proc);
      return proc;
    }
  });
  await publisher.showLive("rtsp://127.0.0.1:8554/cam1", layout);
  assert.equal(spawned.length, 1);

  // Initial crash after startupWindowMs schedules restart #1.
  spawned[0]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(spawned.length, 2);

  // Restart #1 crashes immediately (inside startupWindowMs) -> must still schedule restart #2.
  spawned[1]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(spawned.length, 3);

  // Restart #2 crashes immediately -> maxRestarts (2) exhausted, no 4th spawn.
  spawned[2]?.crash(1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(spawned.length, 3);
});

test("raw still input: pipePublishArgs reads rawvideo yuv420p and keeps the encoder choice", () => {
  const args = pipePublishArgs("rtsp://h/compose1", "h264_v4l2m2m", 1, { width: 1920, height: 1080 });
  assert.ok(args.join(" ").includes("-f rawvideo -pix_fmt yuv420p -s 1920x1080 -framerate 1 -i - -an"));
  assert.equal(args.includes("image2pipe"), false);
  assert.equal(args[args.indexOf("-c:v") + 1], "h264_v4l2m2m");
  assert.equal(evenSize(1081, 607).width, 1080);
  assert.ok(stillConvertArgs().join(" ").includes("scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"));
});

test("raw still input is the default: the PNG is converted once per change, not once per second", async () => {
  const conversions: Array<[number, number]> = [];
  const { publisher, spawned } = harness(10, {
    convertStill: async (png, w, h) => {
      conversions.push([w, h]);
      return Buffer.from(`raw:${png.toString()}`);
    }
  });
  await publisher.showFrame(Buffer.from("a"), 1921, 1081);
  assert.deepEqual(conversions, [[1920, 1080]]);
  assert.ok(spawned[0]!.args.join(" ").includes("-f rawvideo -pix_fmt yuv420p -s 1920x1080"));
  await publisher.showFrame(Buffer.from("b"), 1921, 1081);
  assert.equal(spawned.length, 1, "same size and mode reuse the process");
  assert.deepEqual(spawned[0]!.proc.writes.map((b) => b.toString()), ["raw:a", "raw:b"]);
  await publisher.stop();
});

test("a failed conversion falls back to the PNG input for that picture, with a warning", async () => {
  const warnings: string[] = [];
  const { publisher, spawned } = harness(10, {
    convertStill: async () => null,
    logger: { warn: ((_o: unknown, m?: string) => void warnings.push(String(m))) as never }
  });
  await publisher.showFrame(Buffer.from("png-bytes"), 1920, 1080);
  assert.ok(spawned[0]!.args.join(" ").includes("-f image2pipe"));
  assert.deepEqual(spawned[0]!.proc.writes.map((b) => b.toString()), ["png-bytes"]);
  assert.equal(warnings.length, 1);
  await publisher.stop();
});

test("switching between raw and png input restarts ffmpeg; the encoder fallback still applies", async () => {
  let ok = true;
  const { publisher, spawned } = harness(10, { convertStill: async () => (ok ? Buffer.from("raw") : null) });
  await publisher.showFrame(Buffer.from("a"), 1920, 1080);
  ok = false;
  await publisher.showFrame(Buffer.from("b"), 1920, 1080);
  assert.equal(spawned.length, 2);
  assert.ok(spawned[1]!.args.join(" ").includes("-f image2pipe"));
  await publisher.stop();
});

test("raw input with the hardware encoder falls back to libx264 and keeps raw input", async () => {
  const spawned: Array<{ args: readonly string[]; proc: FakeProcess }> = [];
  const publisher = new KeyPagePublisher({
    rtspUrl: "rtsp://127.0.0.1:8554/compose1",
    encoder: "h264_v4l2m2m",
    encoderPolicy: new EncoderPolicy({ platform: "linux", probe: async () => true }),
    startupWindowMs: 50,
    convertStill: async () => Buffer.from("raw"),
    spawn: (_c, args) => {
      const proc = new FakeProcess();
      spawned.push({ args, proc });
      if (spawned.length === 1) setTimeout(() => proc.crash(1), 5);
      return proc;
    }
  });
  await publisher.showFrame(Buffer.from("a"), 1920, 1080);
  assert.equal(spawned.length, 2);
  assert.ok(spawned[0]!.args.includes("h264_v4l2m2m"));
  assert.ok(spawned[1]!.args.includes("libx264"));
  assert.ok(spawned[1]!.args.join(" ").includes("-f rawvideo"));
  await publisher.stop();
});
