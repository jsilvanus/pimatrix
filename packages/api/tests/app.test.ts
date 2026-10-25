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
    assert.equal(status.integrations.mediaMtx, "not-configured");
    assert.equal(status.integrations.fffleet, "not-configured");
  } finally {
    await app.close();
  }
});

test("source and output inventory does not claim live hardware", async () => {
  const app = buildApp(loadConfig({}));
  try {
    const sources = (await app.inject("/api/v1/sources")).json().items;
    assert.deepEqual(sources.map((source: { id: string }) => source.id), [
      "hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "compose1", "PiPGM1", "PiPGM2"
    ]);
    assert.ok(sources.every((source: { state: string; preview: { available: boolean } }) =>
      source.state === "unavailable" && !source.preview.available
    ));
    const outputs = (await app.inject("/api/v1/outputs")).json().items;
    assert.deepEqual(outputs.map((output: { id: string }) => output.id), ["hdmi0", "hdmi1", "multiview"]);
    assert.ok(outputs.every((output: { observedSource: string | null; desiredSource: string | null }) =>
      output.observedSource === null && output.desiredSource === null
    ));
  } finally {
    await app.close();
  }
});

test("MediaMTX ready paths are reflected as live sources with browser preview URLs", async () => {
  const config = loadConfig({
    PIMATRIX_MEDIAMTX_API_URL: "http://mediamtx:9997",
    PIMATRIX_PREVIEW_BASE_URL: "http://pi.local:8889"
  });
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    itemCount: 2,
    pageCount: 1,
    items: [
      { name: "hama", ready: true },
      { name: "cam1", ready: false }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const app = buildApp(config, fakeFetch);
  try {
    const sources = (await app.inject("/api/v1/sources")).json().items;
    assert.equal(sources.find((source: { id: string }) => source.id === "hama").state, "live");
    assert.deepEqual(sources.find((source: { id: string }) => source.id === "hama").preview, {
      available: true,
      url: "http://pi.local:8889/hama"
    });
    assert.equal(sources.find((source: { id: string }) => source.id === "cam1").state, "unavailable");
  } finally {
    await app.close();
  }
});

test("MediaMTX failure is reported without making API health unavailable", async () => {
  const config = loadConfig({ PIMATRIX_MEDIAMTX_API_URL: "http://mediamtx:9997" });
  const app = buildApp(config, async () => new Response("unavailable", { status: 503 }));
  try {
    const status = (await app.inject("/api/v1/status")).json();
    assert.equal(status.status, "running");
    assert.equal(status.integrations.mediaMtx, "unavailable");
    assert.equal((await app.inject("/health")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("fffleet connection state is surfaced without breaking API health", async () => {
  const config = loadConfig({
    FFFLEET_URL: "http://fffleet:5000",
    FFFLEET_TOKEN: "test-token"
  });
  const fakeFetch: typeof fetch = async (input) => {
    assert.equal(String(input), "http://fffleet:5000/v1/capabilities");
    return new Response(JSON.stringify({ slots: {}, capabilities: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const app = buildApp(config, fakeFetch);
  try {
    const status = (await app.inject("/api/v1/status")).json();
    assert.equal(status.integrations.fffleet, "connected");
    assert.equal((await app.inject("/health")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("output route intent is accepted but not reported as observed hardware state", async () => {
  const app = buildApp(loadConfig({}));
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: "hama" }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().desiredSource, "hama");
    assert.equal(response.json().observedSource, null);
    assert.equal(response.json().state, "unavailable");

    const outputs = (await app.inject("/api/v1/outputs")).json().items;
    assert.equal(outputs.find((output: { id: string }) => output.id === "hdmi0").desiredSource, "hama");
  } finally {
    await app.close();
  }
});

test("output route rejects unknown sources and unknown outputs", async () => {
  const app = buildApp(loadConfig({}));
  try {
    const invalidSource = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: "made-up" }
    });
    assert.equal(invalidSource.statusCode, 422);
    assert.equal(invalidSource.json().error.code, "INVALID_SOURCE");

    const unknownOutput = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/not-a-display/source",
      payload: { sourceId: "hama" }
    });
    assert.equal(unknownOutput.statusCode, 404);
    assert.equal(unknownOutput.json().error.code, "OUTPUT_NOT_FOUND");

    const missingSource = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: {}
    });
    assert.equal(missingSource.statusCode, 422);
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
  assert.throws(() => loadConfig({ PIMATRIX_MEDIAMTX_API_URL: "ftp://media" }), /HTTP or HTTPS/);
  assert.throws(() => loadConfig({ FFFLEET_CLIENT_ID: "pimatrix" }), /must be set together/);
  assert.throws(() => loadConfig({ FFFLEET_TOKEN: "secret" }), /FFFLEET_URL is required/);
  assert.throws(() => loadConfig({ PIMATRIX_HAMA_ENABLED: "true" }), /PIMATRIX_HAMA_RTSP_URL is required/);
  assert.throws(() => loadConfig({ PIMATRIX_HAMA_WIDTH: "0" }), /PIMATRIX_HAMA_WIDTH/);
  assert.equal(loadConfig({}).hamaInputFormat, undefined);
  assert.equal(loadConfig({}).hamaWidth, 1280);
  assert.equal(loadConfig({}).hamaHeight, 720);
  assert.equal(loadConfig({}).hamaVideoCodec, "h264_v4l2m2m");
  assert.equal(loadConfig({}).hamaIdleGraceMs, 30000);
  assert.equal(loadConfig({ PIMATRIX_HAMA_IDLE_GRACE_SECONDS: "0" }).hamaIdleGraceMs, 0);
  assert.throws(() => loadConfig({ PIMATRIX_HAMA_IDLE_GRACE_SECONDS: "-1" }), /PIMATRIX_HAMA_IDLE_GRACE_SECONDS/);
  assert.throws(() => loadConfig({ PIMATRIX_HAMA_VIDEO_CODEC: "unknown" }), /PIMATRIX_HAMA_VIDEO_CODEC/);
  assert.throws(() => loadConfig({
    PIMATRIX_STREAM_RESTART_MIN_MS: "5000",
    PIMATRIX_STREAM_RESTART_MAX_MS: "1000"
  }), /PIMATRIX_STREAM_RESTART_MAX_MS/);
});
