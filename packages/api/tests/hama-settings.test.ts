import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { HamaSettingsStore, parseHamaPatch } from "../src/hama-settings.js";
import { buildHamaCaptureSpec } from "../src/stream-supervisor.js";

function tempFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hama-")), "hama-settings.json");
}

test("parseHamaPatch validates and accepts null to clear", () => {
  assert.deepEqual(parseHamaPatch({ width: 1280, height: 720, inputFormat: "mjpeg", frameRate: 25, videoCodec: "copy" }),
    { width: 1280, height: 720, inputFormat: "mjpeg", frameRate: 25, videoCodec: "copy" });
  assert.deepEqual(parseHamaPatch({ inputFormat: null, frameRate: null }), { inputFormat: null, frameRate: null });
  assert.throws(() => parseHamaPatch({ width: 5 }), /width/);
  assert.throws(() => parseHamaPatch({ inputFormat: "-i /etc/passwd" }), /inputFormat/);
  assert.throws(() => parseHamaPatch({ videoCodec: "x" }), /videoCodec/);
  assert.throws(() => parseHamaPatch({ device: "/dev/video9" }), /Unknown setting/);
});

test("overrides persist, apply to the capture command and clear again", () => {
  const file = tempFile();
  const config = loadConfig({ PIMATRIX_HAMA_RTSP_URL: "rtsp://mediamtx:8554/hama" });
  const store = new HamaSettingsStore(file);
  store.update({ width: 1280, height: 720, inputFormat: "mjpeg" });
  const args = buildHamaCaptureSpec(store.effective(config), 1).ffmpeg?.args ?? [];
  assert.ok(args.includes("1280x720"));
  assert.ok(args.includes("mjpeg"));
  // A new store (restart) reads the file.
  assert.deepEqual(new HamaSettingsStore(file).get(), { width: 1280, height: 720, inputFormat: "mjpeg" });
  store.update({ inputFormat: null });
  assert.equal(store.effective(config).hamaInputFormat, undefined);
  store.reset();
  assert.equal(store.effective(config).hamaWidth, 1920);
});

test("settings API: put, get, validation and reset", async () => {
  const file = tempFile();
  const app = buildApp(loadConfig({ PIMATRIX_HAMA_SETTINGS_FILE: file }));
  try {
    const put = await app.inject({ method: "PUT", url: "/api/v1/sources/hama/capture/settings", payload: { width: 1280, height: 720 } });
    assert.equal(put.statusCode, 200);
    assert.equal(put.json().effective.width, 1280);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/sources/hama/capture/settings" })).json().overrides.height, 720);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/sources/hama/capture" })).json().width, 1280);

    // Clearing one key falls back to the env default (1920), which is still a valid pair.
    const cleared = await app.inject({ method: "PUT", url: "/api/v1/sources/hama/capture/settings", payload: { width: null } });
    assert.equal(cleared.json().effective.width, 1920);
    assert.equal((await app.inject({ method: "PUT", url: "/api/v1/sources/hama/capture/settings", payload: { width: 1280 } })).json().effective.width, 1280);
    assert.equal((await app.inject({ method: "PUT", url: "/api/v1/sources/hama/capture/settings", payload: { codec: 1 } })).statusCode, 422);

    const reset = await app.inject({ method: "DELETE", url: "/api/v1/sources/hama/capture/settings" });
    assert.equal(reset.json().effective.width, 1920);
    assert.equal(fs.readFileSync(file, "utf8").trim(), "{}");
  } finally {
    await app.close();
  }
});
