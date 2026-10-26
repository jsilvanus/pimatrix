import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { AtemAdapter } from "../src/atem/atem-adapter.js";
import { CameraService } from "../src/camera/camera-service.js";
import { loadConfig } from "../src/config.js";
import { QuickOptionStore, parseSnapshot } from "../src/quick-options/quick-options-store.js";

function build(dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-quick-"))) {
  const app = buildApp(loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_MODE: "simulated",
    PIMATRIX_COMPOSITE_DATA_DIR: path.join(dir, "composite"),
    PIMATRIX_QUICK_OPTIONS_FILE: path.join(dir, "quick-options.json")
  }));
  return { app, dir };
}

async function json(app: ReturnType<typeof build>["app"], method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, ...(payload !== undefined ? { payload } : {}) });
  return { status: res.statusCode, body: res.payload ? JSON.parse(res.payload) : null };
}

test("save, list, apply, rename and delete a quick option", async () => {
  const { app } = build();
  await app.ready();

  await json(app, "PUT", "/api/v1/outputs/hdmi0/source", { sourceId: "cam1" });
  await json(app, "PUT", "/api/v1/outputs/hdmi1/source", { sourceId: "multiview" });
  await json(app, "POST", "/api/v1/sources/cam1/effects/crop/preset", { preset: "force-vertical-9-16" });
  await json(app, "POST", "/api/v1/sources/cam2/effects/mute", { muted: true });
  await json(app, "POST", "/api/v1/sources/cam2/effects/ftb", { fadeToBlack: true });
  await json(app, "PUT", "/api/v1/composites/compose1", { slideSource: "piprogram", pipelineId: "PiPGM2" });

  const saved = await json(app, "POST", "/api/v1/quick-options", { name: "  Sunday  " });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.name, "Sunday");
  assert.match(saved.body.id, /^qo-/);
  assert.equal(saved.body.snapshot.outputs.hdmi0, "cam1");
  assert.equal(saved.body.snapshot.outputs.hdmi1, "multiview");
  assert.equal(saved.body.snapshot.effects.cam1.crop.aspectRatio, "9:16");
  assert.equal(saved.body.snapshot.effects.cam2.muted, true);
  assert.equal(saved.body.snapshot.effects.cam2.fadeToBlack, true);
  assert.deepEqual(saved.body.snapshot.composites, { compose1: { slideSource: "piprogram", pipelineId: "PiPGM2", sourceId: "hama" } });

  const list = await json(app, "GET", "/api/v1/quick-options");
  assert.deepEqual(list.body.items.map((i: { name: string }) => i.name), ["Sunday"]);

  // Change everything, then apply.
  await json(app, "PUT", "/api/v1/outputs/hdmi0/source", { sourceId: null });
  await json(app, "PUT", "/api/v1/outputs/hdmi1/source", { sourceId: "cam3" });
  await json(app, "POST", "/api/v1/sources/cam1/effects/crop/preset", { preset: "reset" });
  await json(app, "POST", "/api/v1/sources/cam2/effects/mute", { muted: false });
  await json(app, "POST", "/api/v1/sources/cam2/effects/ftb", { fadeToBlack: false });
  await json(app, "PUT", "/api/v1/composites/compose1", { slideSource: "upload", pipelineId: "PiPGM1" });

  const applied = await json(app, "POST", `/api/v1/quick-options/${saved.body.id}/apply`);
  assert.equal(applied.status, 200);
  const out = (id: string) => applied.body.outputs.find((o: { id: string }) => o.id === id);
  assert.equal(out("hdmi0").desiredSource, "cam1");
  assert.equal(out("hdmi1").desiredSource, "multiview");
  const fx = (id: string) => applied.body.effects.find((e: { sourceId: string }) => e.sourceId === id);
  assert.equal(fx("cam1").crop.aspectRatio, "9:16");
  assert.equal(fx("cam1").crop.enabled, true);
  assert.equal(fx("cam2").muted, true);
  assert.equal(fx("cam2").fadeToBlack, true);
  const compose1 = applied.body.composites.find((c: { id: string }) => c.id === "compose1");
  assert.equal(compose1.slideSource, "piprogram");
  assert.equal(compose1.pipelineId, "PiPGM2");

  const renamed = await json(app, "PUT", `/api/v1/quick-options/${saved.body.id}`, { name: "Messu" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Messu");

  assert.equal((await json(app, "DELETE", `/api/v1/quick-options/${saved.body.id}`)).status, 204);
  assert.equal((await json(app, "GET", "/api/v1/quick-options")).body.items.length, 0);
  assert.equal((await json(app, "POST", `/api/v1/quick-options/${saved.body.id}/apply`)).status, 404);
  assert.equal((await json(app, "PUT", `/api/v1/quick-options/${saved.body.id}`, { name: "x" })).status, 404);
  assert.equal((await json(app, "DELETE", `/api/v1/quick-options/${saved.body.id}`)).status, 404);
});

test("names are validated: empty or over 40 is 422, a duplicate is 409", async () => {
  const { app } = build();
  await app.ready();
  assert.equal((await json(app, "POST", "/api/v1/quick-options", {})).status, 422);
  assert.equal((await json(app, "POST", "/api/v1/quick-options", { name: "   " })).status, 422);
  assert.equal((await json(app, "POST", "/api/v1/quick-options", { name: "x".repeat(41) })).status, 422);
  assert.equal((await json(app, "POST", "/api/v1/quick-options", { name: "x".repeat(40) })).status, 201);

  const a = await json(app, "POST", "/api/v1/quick-options", { name: "A" });
  assert.equal(a.status, 201);
  const dup = await json(app, "POST", "/api/v1/quick-options", { name: "a" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "DUPLICATE_NAME");
  const b = await json(app, "POST", "/api/v1/quick-options", { name: "B" });
  assert.equal((await json(app, "PUT", `/api/v1/quick-options/${b.body.id}`, { name: "A" })).status, 409);
  // Renaming to its own name (other case) is fine.
  assert.equal((await json(app, "PUT", `/api/v1/quick-options/${a.body.id}`, { name: "a" })).status, 200);
  assert.equal((await json(app, "PUT", `/api/v1/quick-options/${b.body.id}`, { name: "" })).status, 422);
});

test("quick options survive a restart", async () => {
  const first = build();
  await first.app.ready();
  await json(first.app, "PUT", "/api/v1/outputs/hdmi1/source", { sourceId: "rtmp1" });
  const saved = await json(first.app, "POST", "/api/v1/quick-options", { name: "Kept" });
  await first.app.close();

  const second = build(first.dir);
  await second.app.ready();
  const list = await json(second.app, "GET", "/api/v1/quick-options");
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].id, saved.body.id);
  assert.equal(list.body.items[0].snapshot.outputs.hdmi1, "rtmp1");
});

test("applying never calls the ATEM or a camera", async () => {
  const { app } = build();
  await app.ready();
  const saved = await json(app, "POST", "/api/v1/quick-options", { name: "Safe" });

  // Count every call that could send something to the ATEM or a camera.
  const calls: string[] = [];
  const restore: Array<() => void> = [];
  for (const [label, proto] of [["atem", AtemAdapter.prototype], ["camera", CameraService.prototype]] as const) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      const original = (proto as unknown as Record<string, unknown>)[name];
      if (name === "constructor" || typeof original !== "function" || /^(get|list|snapshot|on|off|emit)/.test(name)) continue;
      (proto as unknown as Record<string, unknown>)[name] = function (...args: unknown[]) {
        calls.push(`${label}.${name}`);
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      restore.push(() => { (proto as unknown as Record<string, unknown>)[name] = original; });
    }
  }
  try {
    const applied = await json(app, "POST", `/api/v1/quick-options/${saved.body.id}/apply`);
    assert.equal(applied.status, 200);
  } finally {
    for (const undo of restore) undo();
  }
  assert.deepEqual(calls, []);
  // The ATEM media composite is not part of a snapshot.
  assert.deepEqual(Object.keys(saved.body.snapshot.composites), ["compose1"]);
});

test("a saved file with a broken entry loads the good ones only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-quick-file-"));
  const file = path.join(dir, "q.json");
  const store = new QuickOptionStore(file);
  const good = store.create("Good", {
    outputs: { hdmi0: "cam1", hdmi1: null },
    effects: {},
    composites: {}
  });
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  raw.items.push({ id: "qo-bad", name: "Bad", createdAt: "x", snapshot: { outputs: { hdmi0: "nope", hdmi1: null }, effects: {}, composites: {} } });
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.deepEqual(new QuickOptionStore(file).list().map((i) => i.id), [good.id]);
  assert.equal(parseSnapshot("junk"), null);
  fs.writeFileSync(file, "{not json");
  assert.deepEqual(new QuickOptionStore(file).list(), []);
});
