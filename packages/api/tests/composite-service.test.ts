import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CompositeAtem } from "../src/composite/composite-service.js";
import {
  CompositeNotFoundError,
  CompositeService,
  InvalidCompositeError,
  InvalidSlideError,
  type CompositePlayer
} from "../src/composite/composite-service.js";
import type { CompositeStatus } from "../src/composite/composite-model.js";
import type { RenderKeyPageOptions } from "../src/composite/key-render.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("slide-bytes")]);

interface Recorder {
  renders: RenderKeyPageOptions[];
  shows: string[];
  stops: number;
  atemCalls: unknown[][];
  lives: Array<{ url: string; layout: unknown }>;
}

function fakePlayer(recorder: Recorder): CompositePlayer {
  return {
    async show(file: string) { recorder.shows.push(file); },
    async stop() { recorder.stops += 1; },
    async showLive(url, layout) { recorder.lives.push({ url, layout }); }
  };
}

/** A fake ATEM client that records every media-pool and keyer call. */
/** Records what the composite sends to the ATEM, in the shape the gateway turns into ATEM calls. */
function makeAtem(connected: boolean, calls: unknown[][]): CompositeAtem {
  return {
    getState: () => ({ connected }),
    async uploadStill(index, data, name) {
      calls.push(["uploadStill", index, data.length, name]);
    },
    async setupDownstreamKey(setup) {
      calls.push(["setMediaPlayerSource", { sourceType: 1, stillIndex: setup.stillIndex }, setup.mediaPlayer]);
      calls.push(["fill", setup.fillInput, setup.dsk]);
      calls.push(["cut", setup.cutInput, setup.dsk]);
    },
    async setDownstreamKeyOnAir(dsk, onAir) {
      calls.push(["onAir", onAir, dsk]);
    }
  };
}

function setup(options: { connected?: boolean; stateFile?: boolean; dataDir?: string } = {}) {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-composite-"));
  const recorder: Recorder = { renders: [], shows: [], stops: 0, atemCalls: [], lives: [] };
  const events: CompositeStatus[] = [];
  const atem = makeAtem(options.connected ?? false, recorder.atemCalls);
  return {
    dataDir,
    recorder,
    events,
    make: async () => new CompositeService({
      dataDir,
      stateFile: options.stateFile === false ? undefined : path.join(dataDir, "composites.json"),
      player: fakePlayer(recorder),
      liveSourceUrl: (id) => `rtsp://127.0.0.1:8554/${id}`,
      atem,
      renderLive: async (live) => Buffer.from(`live:${live.sourceUrl}`),
      renderFrame: async (renderOptions) => {
        recorder.renders.push(renderOptions);
        const size = renderOptions.format === "rgba" ? renderOptions.geometry.width * renderOptions.geometry.height * 4 : 8;
        return Buffer.alloc(size, 1);
      },
      onChange: (status) => events.push(status)
    })
  };
}

test("HDMI key: waits for a slide, shows the page once a slide arrives, and re-renders on a picture change", async () => {
  const env = setup();
  const service = await (await env.make());
  await service.update("compose1", { enabled: true });
  await service.idle();
  assert.equal(service.get("compose1").state, "waiting");
  assert.equal(service.get("compose1").hasSlide, false);

  await service.setSlide(PNG);
  await service.idle();
  assert.equal(service.get("compose1").state, "running");
  assert.equal(env.recorder.shows.length, 1);
  assert.equal(path.basename(env.recorder.shows[0] ?? ""), "compose1-key.png");
  assert.ok(fs.existsSync(env.recorder.shows[0] ?? ""), "the key page file is written before the player starts");

  await service.update("compose1", { side: "right" });
  await service.idle();
  assert.equal(env.recorder.shows.length, 2, "a side change re-renders the page");
  assert.equal(env.recorder.renders.at(-1)?.geometry.slide.x, 1244);
});

test("a change that does not alter the picture does not restart the player", async () => {
  const env = setup();
  const service = await (await env.make());
  await service.update("compose2", { enabled: false });
  await service.setSlide(PNG);
  await service.update("compose1", { enabled: true });
  await service.idle();
  const before = env.recorder.shows.length;
  await service.update("compose1", { keyMode: "chroma" });
  await service.idle();
  assert.equal(env.recorder.shows.length, before);
});

test("stop takes the HDMI output down and marks the composite stopped", async () => {
  const env = setup();
  const service = await (await env.make());
  await service.setSlide(PNG);
  await service.update("compose1", { enabled: true });
  await service.idle();
  await service.update("compose1", { enabled: false });
  await service.idle();
  assert.equal(env.recorder.stops, 1);
  assert.equal(service.get("compose1").state, "stopped");
  assert.equal(service.get("compose1").enabled, false);
});

test("ATEM media: uploads the slide to the chosen slot, keys it on the DSK, and goes on air only with autoOnAir", async () => {
  const env = setup({ connected: true });
  const service = await (await env.make());
  await service.update("compose2", { enabled: true, atem: { mediaSlot: 3, mediaPlayer: 2, dskIndex: 2 } });
  await service.setSlide(PNG);
  await service.idle();

  assert.equal(service.get("compose2").state, "running");
  const calls = env.recorder.atemCalls;
  assert.deepEqual(calls.find((call) => call[0] === "uploadStill"), ["uploadStill", 2, 1920 * 1080 * 4, "pimatrix-compose2"]);
  assert.deepEqual(calls.find((call) => call[0] === "setMediaPlayerSource"), ["setMediaPlayerSource", { sourceType: 1, stillIndex: 2 }, 1]);
  assert.deepEqual(calls.find((call) => call[0] === "fill"), ["fill", 8020, 1]);
  assert.deepEqual(calls.find((call) => call[0] === "cut"), ["cut", 8021, 1]);
  assert.equal(calls.some((call) => call[0] === "onAir"), false, "not on air by default");

  await service.update("compose2", { atem: { autoOnAir: true } });
  await service.idle();
  assert.equal(env.recorder.atemCalls.filter((call) => call[0] === "uploadStill").length, 1, "autoOnAir alone does not upload again");

  await service.update("compose2", { enabled: false });
  await service.idle();
  assert.deepEqual(env.recorder.atemCalls.at(-1), ["onAir", false, 1]);
});

test("ATEM media without a connected switcher fails with a readable reason", async () => {
  const env = setup({ connected: false });
  const service = await (await env.make());
  await service.update("compose2", { enabled: true });
  await service.setSlide(PNG);
  await service.idle();
  assert.equal(service.get("compose2").state, "failed");
  assert.equal(service.get("compose2").lastError, "ATEM is not connected");
});

test("an invalid slide is refused and nothing is stored", async () => {
  const env = setup();
  const service = await (await env.make());
  await assert.rejects(service.setSlide(Buffer.from("not a png")), InvalidSlideError);
  await assert.rejects(service.setSlide(Buffer.alloc(11 * 1024 * 1024)), InvalidSlideError);
  assert.equal(service.get("compose1").hasSlide, false);
});

test("an unknown composite id is a CompositeNotFoundError", async () => {
  const env = setup();
  const service = await (await env.make());
  assert.throws(() => service.get("compose9"), CompositeNotFoundError);
  await assert.rejects(service.update("compose9", { enabled: true }), CompositeNotFoundError);
});

test("settings and the slide survive a restart", async () => {
  const env = setup();
  const first = await (await env.make());
  await first.setSlide(PNG);
  await first.update("compose1", { enabled: true, side: "right", keyColor: "#0000FF" });
  await first.idle();

  const second = await (await env.make());
  await second.restore();
  const restored = second.get("compose1");
  assert.equal(restored.side, "right");
  assert.equal(restored.keyColor, "#0000ff");
  assert.equal(restored.enabled, true);
  assert.equal(restored.hasSlide, true);
  assert.equal(restored.state, "running");
  assert.equal(env.recorder.shows.length, 2, "the enabled output is shown again after restart");
});

test("a saved entry that no longer validates falls back to the defaults", async () => {
  const env = setup();
  fs.mkdirSync(env.dataDir, { recursive: true });
  fs.writeFileSync(path.join(env.dataDir, "composites.json"), JSON.stringify({ composites: { compose1: { side: "sideways" } } }));
  const service = await (await env.make());
  await service.restore();
  assert.equal(service.get("compose1").side, "left");
});

test("a preview is available only once a slide exists", async () => {
  const env = setup();
  const service = await (await env.make());
  assert.equal(await service.previewPng("compose1"), null);
  await service.setSlide(PNG);
  const png = await service.previewPng("compose1");
  assert.ok(png && png.length > 0);
  assert.equal(env.recorder.renders.at(-1)?.format, "png");
});

test("HDMI key with a live source: publishes the source in the slide box without any slide", async () => {
  const { make, recorder } = setup();
  const service = await make();
  await service.update("compose1", { slideSource: "source", sourceId: "cam1", slideScale: 0.8 });
  const started = await service.update("compose1", { enabled: true });
  assert.equal(started.hasSlide, true);
  await service.idle();
  assert.equal(recorder.lives.length, 1);
  assert.equal(recorder.lives[0]?.url, "rtsp://127.0.0.1:8554/cam1");
  assert.equal(recorder.shows.length, 0);
  assert.equal(service.get("compose1").state, "running");
  assert.equal((await service.previewPng("compose1"))?.toString(), "live:rtsp://127.0.0.1:8554/cam1");
  // switching source restarts the live render
  await service.update("compose1", { sourceId: "rtmp1" });
  await service.idle();
  assert.equal(recorder.lives.length, 2);
  assert.equal(recorder.lives[1]?.url, "rtsp://127.0.0.1:8554/rtmp1");
});

test("an ATEM media composite refuses a live source", async () => {
  const { make } = setup();
  const service = await make();
  await assert.rejects(service.update("compose2", { slideSource: "source" }), InvalidCompositeError);
});

test("refreshLive re-publishes only enabled composites that show that source", async () => {
  const { make, recorder } = setup();
  const service = await make();
  await service.update("compose1", { slideSource: "source", sourceId: "cam1", enabled: true });
  await service.idle();
  assert.equal(recorder.lives.length, 1);
  service.refreshLive("cam2");
  await service.idle();
  assert.equal(recorder.lives.length, 1);
  service.refreshLive("cam1");
  await service.idle();
  assert.equal(recorder.lives.length, 2);
});

test("precomposited piprogram frame skips renderKeyPage for hdmi-key in apply and previewPng", async () => {
  const { make, recorder } = setup();
  const service = await make();
  await service.update("compose1", { enabled: true, slideSource: "piprogram" });
  await service.setFeedSlide("compose1", PNG, { precomposited: true });
  await service.idle();

  assert.equal(recorder.renders.length, 0, "renderKeyPage was skipped for precomposited frame");
  assert.equal(recorder.shows.length, 1);
  assert.deepEqual(fs.readFileSync(recorder.shows[0]!), PNG);

  const preview = await service.previewPng("compose1");
  assert.deepEqual(preview, PNG);
  assert.equal(recorder.renders.length, 0, "renderKeyPage was skipped in previewPng");
});

test("live preview caches frames within TTL, coalesces concurrent polls, and passes liveSourceFilter", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-comp-live-"));
  const liveCalls: Array<{ url: string; sourceFilter: string | undefined }> = [];
  const showLiveCalls: Array<{ url: string; sourceFilter: string | undefined }> = [];
  let renderCount = 0;
  const service = new CompositeService({
    dataDir: dir,
    player: {
      show: async () => undefined,
      stop: async () => undefined,
      showLive: async (url, _layout, sourceFilter) => {
        showLiveCalls.push({ url, sourceFilter });
      }
    },
    liveSourceUrl: (id) => `rtsp://127.0.0.1:8554/${id}`,
    liveSourceFilter: (id) => (id === "cam1" ? "crop=608:1080:480:0" : undefined),
    livePreviewCacheMs: 2000,
    atem: {
      getState: () => ({ connected: false }),
      uploadStill: async () => undefined,
      setupDownstreamKey: async () => undefined,
      setDownstreamKeyOnAir: async () => undefined
    },
    renderLive: async ({ sourceUrl, sourceFilter }) => {
      renderCount += 1;
      liveCalls.push({ url: sourceUrl, sourceFilter });
      await new Promise((resolve) => setTimeout(resolve, 15));
      return PNG;
    }
  });
  await service.update("compose1", { slideSource: "source", sourceId: "cam1", enabled: true });
  await service.idle();
  assert.deepEqual(showLiveCalls, [{ url: "rtsp://127.0.0.1:8554/cam1", sourceFilter: "crop=608:1080:480:0" }]);

  // Concurrent previewPng polls share one ffmpeg render and subsequent poll hits cache.
  const [p1, p2] = await Promise.all([service.previewPng("compose1"), service.previewPng("compose1")]);
  const p3 = await service.previewPng("compose1");
  assert.deepEqual(p1, PNG);
  assert.deepEqual(p2, PNG);
  assert.deepEqual(p3, PNG);
  assert.equal(renderCount, 1);
  assert.deepEqual(liveCalls, [{ url: "rtsp://127.0.0.1:8554/cam1", sourceFilter: "crop=608:1080:480:0" }]);
});

test("precomposited piprogram frame skips renderKeyPage for atem-media in apply and previewPng", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-comp-atem-pre-"));
  const renders: number[] = [];
  const decoded: Buffer[] = [];
  const uploaded: Array<{ slot: number; bytes: number }> = [];
  const fakeRgba = Buffer.alloc(1920 * 1080 * 4, 7);
  const service = new CompositeService({
    dataDir: dir,
    player: { show: async () => undefined, stop: async () => undefined },
    atem: {
      getState: () => ({ connected: true }),
      uploadStill: async (slot, rgba) => {
        uploaded.push({ slot, bytes: rgba.length });
      },
      setupDownstreamKey: async () => undefined,
      setDownstreamKeyOnAir: async () => undefined
    },
    renderFrame: async () => {
      renders.push(1);
      return Buffer.alloc(16);
    },
    decodeRgba: async (png) => {
      decoded.push(png);
      return fakeRgba;
    }
  });

  await service.update("compose2", { enabled: true, slideSource: "piprogram" });
  await service.setFeedSlide("compose2", PNG, { precomposited: true });
  await service.idle();

  assert.equal(renders.length, 0, "renderKeyPage was skipped for precomposited atem-media frame");
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], PNG);
  assert.deepEqual(uploaded, [{ slot: 0, bytes: fakeRgba.length }]);

  const preview = await service.previewPng("compose2");
  assert.deepEqual(preview, PNG);
  assert.equal(renders.length, 0, "renderKeyPage was skipped in previewPng for atem-media");
});

test("livePreviewCache prunes expired entries when inserting a new key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-comp-prune-"));
  const service = new CompositeService({
    dataDir: dir,
    player: {
      show: async () => undefined,
      stop: async () => undefined,
      showLive: async () => undefined
    },
    liveSourceUrl: (id) => `rtsp://127.0.0.1:8554/${id}`,
    livePreviewCacheMs: 15,
    atem: {
      getState: () => ({ connected: false }),
      uploadStill: async () => undefined,
      setupDownstreamKey: async () => undefined,
      setDownstreamKeyOnAir: async () => undefined
    },
    renderLive: async () => PNG
  });

  await service.update("compose1", { slideSource: "source", sourceId: "cam1" });
  await service.previewPng("compose1");
  const cache = (service as unknown as { livePreviewCache: Map<string, unknown> }).livePreviewCache;
  assert.equal(cache.size, 1);

  await new Promise((resolve) => setTimeout(resolve, 30));
  await service.update("compose1", { sourceId: "cam2" });
  await service.previewPng("compose1");
  assert.equal(cache.size, 1, "expired cam1 entry was pruned on cam2 insert");
});
