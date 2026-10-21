import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("health, readiness and status respond in simulation mode", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation" }));
  try {
    assert.equal((await app.inject("/health")).json().status, "ok");
    const ready = await app.inject("/ready");
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().ready, true);
    const status = (await app.inject("/api/v1/status")).json();
    assert.equal(status.mode, "simulation");
    assert.equal(status.integrations.amx, "not-configured");
  } finally {
    await app.close();
  }
});

test("source and output inventory does not claim live hardware", async () => {
  const app = buildApp(loadConfig({}));
  try {
    const sources = (await app.inject("/api/v1/sources")).json().items;
    assert.deepEqual(sources.map((source: { id: string }) => source.id), [
      "hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "PiPGM1", "PiPGM2"
    ]);
    assert.ok(sources.every((source: { state: string; preview: { available: boolean } }) =>
      source.state === "unavailable" && !source.preview.available
    ));
    const outputs = (await app.inject("/api/v1/outputs")).json().items;
    assert.deepEqual(outputs.map((output: { id: string }) => output.id), ["hdmi0", "hdmi1"]);
    assert.ok(outputs.every((output: { observedSource: string | null }) => output.observedSource === null));
  } finally {
    await app.close();
  }
});

test("unknown source returns a structured 404", async () => {
  const app = buildApp(loadConfig({}));
  try {
    const response = await app.inject("/api/v1/sources/not-a-source");
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "SOURCE_NOT_FOUND");
  } finally {
    await app.close();
  }
});

test("invalid configuration is rejected", () => {
  assert.throws(() => loadConfig({ PIMATRIX_PORT: "70000" }), /PIMATRIX_PORT/);
  assert.throws(() => loadConfig({ PIMATRIX_MODE: "other" }), /PIMATRIX_MODE/);
});
