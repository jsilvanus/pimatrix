import assert from "node:assert/strict";
import test from "node:test";
import { BLACK_SLATE_PATH, EffectsLayer, KEY_SLATE_PATH, relayArgs, slateArgs, type LayerEffects, type LayerPublisher } from "../src/effects/effects-layer.js";
import { defaultCropSettings } from "../src/effects/effects-model.js";

interface Run {
  url: string;
  args: string[];
  stopped: boolean;
}

function harness() {
  const effects = new Map<string, LayerEffects>();
  const runs: Run[] = [];
  const layer = new EffectsLayer({
    rtspBase: "rtsp://127.0.0.1:8554/",
    getEffects: (id) => effects.get(id),
    fadeColour: (id) => (id === "compose1" ? "#00ff00" : null),
    selfApplied: new Set(["hama"]),
    createPublisher: (url): LayerPublisher => {
      let current: Run | null = null;
      return {
        async run(args) {
          if (current) current.stopped = true;
          current = { url, args, stopped: false };
          runs.push(current);
        },
        async stop() {
          if (current) current.stopped = true;
        }
      };
    }
  });
  const set = (id: string, patch: Partial<LayerEffects>) =>
    effects.set(id, { crop: defaultCropSettings(), rotation: 0, fadeToBlack: false, ...effects.get(id), ...patch });
  return { layer, runs, set };
}

const cropped = { ...defaultCropSettings(), enabled: true, x: 480, y: 0, width: 608, height: 1080 };

test("no effects: the source path is used as it is", async () => {
  const { layer, set } = harness();
  set("cam1", {});
  assert.equal(await layer.sync("cam1"), false);
  assert.equal(layer.pathFor("cam1"), "cam1");
  assert.equal(layer.pathFor("unknown"), "unknown");
});

test("crop or rotation starts a relay and moves the consumer to <source>-fx; clearing it moves back", async () => {
  const { layer, runs, set } = harness();
  set("rtmp1", { crop: cropped });
  assert.equal(await layer.sync("rtmp1"), true);
  assert.equal(layer.pathFor("rtmp1"), "rtmp1-fx");
  const run = runs[0];
  assert.equal(run?.url, "rtsp://127.0.0.1:8554/rtmp1-fx");
  assert.equal(run?.args[run.args.indexOf("-i") + 1], "rtsp://127.0.0.1:8554/rtmp1");
  assert.match(run?.args[run.args.indexOf("-vf") + 1] ?? "", /^crop=608:1080:480:0,format=yuv420p$/);
  set("rtmp1", { crop: { ...cropped, enabled: false } });
  assert.equal(await layer.sync("rtmp1"), true);
  assert.equal(layer.pathFor("rtmp1"), "rtmp1");
  assert.equal(run?.stopped, true);
});

test("a changed filter restarts the relay without changing the path", async () => {
  const { layer, runs, set } = harness();
  set("cam2", { rotation: 90 });
  await layer.sync("cam2");
  set("cam2", { rotation: 180 });
  assert.equal(await layer.sync("cam2"), false);
  assert.equal(runs.length, 2);
  assert.match(runs[1]?.args[runs[1].args.indexOf("-vf") + 1] ?? "", /hflip,vflip/);
});

test("fade to black points the consumer at the black slate; the key colour slate for compose1", async () => {
  const { layer, runs, set } = harness();
  set("cam1", { fadeToBlack: true });
  assert.equal(await layer.sync("cam1"), true);
  assert.equal(layer.pathFor("cam1"), BLACK_SLATE_PATH);
  assert.equal(runs[0]?.url, `rtsp://127.0.0.1:8554/${BLACK_SLATE_PATH}`);
  assert.match(runs[0]?.args.join(" ") ?? "", /color=c=0x000000/);
  set("compose1", { fadeToBlack: true });
  await layer.sync("compose1");
  assert.equal(layer.pathFor("compose1"), KEY_SLATE_PATH);
  assert.match(runs[1]?.args.join(" ") ?? "", /color=c=0x00ff00/);
  // fading ends: the slate stops once nobody uses it
  set("cam1", { fadeToBlack: false });
  assert.equal(await layer.sync("cam1"), true);
  assert.equal(layer.pathFor("cam1"), "cam1");
  assert.equal(runs[0]?.stopped, true);
  assert.equal(runs[1]?.stopped, false);
});

test("fade wins over crop, and a faded source runs no relay", async () => {
  const { layer, runs, set } = harness();
  set("cam3", { crop: cropped, fadeToBlack: true });
  await layer.sync("cam3");
  assert.equal(layer.pathFor("cam3"), BLACK_SLATE_PATH);
  assert.equal(runs.filter((r) => r.url.endsWith("cam3-fx")).length, 0);
});

test("Hama applies its own filter at capture: crop does not start a relay", async () => {
  const { layer, runs, set } = harness();
  set("hama", { crop: cropped });
  assert.equal(await layer.sync("hama"), false);
  assert.equal(layer.pathFor("hama"), "hama");
  assert.equal(runs.length, 0);
});

test("without a MediaMTX base the layer is a pass-through", async () => {
  const layer = new EffectsLayer({ getEffects: () => ({ crop: cropped, rotation: 0, fadeToBlack: true }) });
  assert.equal(await layer.sync("cam1"), false);
  assert.equal(layer.pathFor("cam1"), "cam1");
});

test("argument builders", () => {
  assert.equal(relayArgs("rtsp://h/a", "crop=1:1:0:0", "rtsp://h/a-fx", "libx264").at(-1), "rtsp://h/a-fx");
  assert.ok(slateArgs("#112233", "rtsp://h/fx-key", "h264_v4l2m2m").includes("h264_v4l2m2m"));
});
