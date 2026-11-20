import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { computeFpsBudget, createSystemMetricsSampler, extractFleetWorkers } from "../src/telemetry.js";

test("computeFpsBudget sums encode and decode FPS across active streams", () => {
  const budget = computeFpsBudget({
    hama: { active: true, fps: 25, inputFormat: "mjpeg", videoCodec: "h264_v4l2m2m" },
    activePipgmIds: ["PiPGM1", "PiPGM2"],
    composites: [
      { id: "compose1", enabled: true, state: "running", slideSource: "piprogram", sourceId: null }
    ],
    effectsRelays: ["cam1"],
    effectsSlates: ["fx-black"],
    outputs: [
      { id: "hdmi0", desiredSource: "PiPGM1", observedSource: "PiPGM1", state: "active" },
      { id: "hdmi1", desiredSource: "hama", observedSource: "hama", state: "active" }
    ]
  });

  // Encode: hama(25) + PiPGM1(1) + PiPGM2(1) + compose1 still(1) + cam1-fx(5) + fx-black(10) = 43
  assert.equal(budget.encodeFps, 43);
  // Decode: hama mjpeg(25) + cam1-fx(5) + hdmi0 PiPGM1(1) + hdmi1 hama(25) = 56
  assert.equal(budget.decodeFps, 56);
  assert.equal(budget.budgetFps, 30);
  assert.equal(budget.encodePercent, 143);
  assert.equal(budget.decodePercent, 187);
  assert.ok(budget.contributors.some((c) => c.id === "hdmi0" && c.decodeFps === 1));
  assert.ok(budget.contributors.some((c) => c.id === "hdmi1" && c.decodeFps === 25));
  assert.ok(budget.contributors.some((c) => c.id === "cam1-fx" && c.encodeFps === 5 && c.decodeFps === 5));
});

test("computeFpsBudget handles live compose1 and hama copy mode", () => {
  const budget = computeFpsBudget({
    hama: { active: true, fps: 30, inputFormat: "h264", videoCodec: "copy", hasFilter: false },
    activePipgmIds: [],
    composites: [
      { id: "compose1", enabled: true, state: "running", slideSource: "source", sourceId: "cam2" }
    ],
    effectsRelays: [],
    effectsSlates: [],
    outputs: [
      { id: "hdmi0", desiredSource: "compose1", observedSource: "compose1", state: "active" }
    ]
  });

  // Encode: hama copy(0) + live compose1 on cam2(5) = 5
  assert.equal(budget.encodeFps, 5);
  // Decode: live compose1 on cam2(5) + hdmi0 live compose1 on cam2(5) = 10
  assert.equal(budget.decodeFps, 10);
});

test("computeFpsBudget reports 5 fps for cam1 and cam2 outputs and 25 fps for other live sources", () => {
  const budget = computeFpsBudget({
    hama: { active: false },
    activePipgmIds: [],
    composites: [],
    effectsRelays: ["cam2", "cam3"],
    effectsSlates: [],
    outputs: [
      { id: "hdmi0", desiredSource: "cam1", observedSource: "cam1", state: "active" },
      { id: "hdmi1", desiredSource: "cam2", observedSource: "cam2", state: "active" }
    ]
  });

  // cam2-fx(5) + cam3-fx(25)
  assert.equal(budget.encodeFps, 30);
  // cam2-fx(5) + cam3-fx(25) + hdmi0 cam1(5) + hdmi1 cam2(5)
  assert.equal(budget.decodeFps, 40);
  assert.ok(budget.contributors.some((c) => c.id === "hdmi0" && c.decodeFps === 5));
  assert.ok(budget.contributors.some((c) => c.id === "hdmi1" && c.decodeFps === 5));
  assert.ok(budget.contributors.some((c) => c.id === "cam2-fx" && c.encodeFps === 5 && c.decodeFps === 5));
  assert.ok(budget.contributors.some((c) => c.id === "cam3-fx" && c.encodeFps === 25 && c.decodeFps === 25));
});

test("createSystemMetricsSampler returns valid CPU and memory metrics", () => {
  const sample = createSystemMetricsSampler();
  const metrics = sample();
  assert.ok(metrics.cpuUsagePercent >= 0 && metrics.cpuUsagePercent <= 100);
  assert.ok(metrics.cpuCores >= 1);
  assert.ok(metrics.memory.totalBytes > 0);
  assert.ok(metrics.memory.usedPercent >= 0 && metrics.memory.usedPercent <= 100);
  assert.ok(metrics.memory.processRssBytes > 0);
});

test("extractFleetWorkers normalizes worker entries from capabilities or /v1/workers", () => {
  const workers = extractFleetWorkers(null, {
    workers: [
      { id: "pi", status: "online", slots: { stream: 2 }, activeJobs: 1 },
      { id: "operator-pc", status: "offline", slots: { batch: 4 } },
      { id: "assisting-pc", online: true, activeJobs: 0 }
    ]
  });
  assert.equal(workers.length, 3);
  assert.equal(workers[0]?.id, "pi");
  assert.equal(workers[0]?.status, "online");
  assert.equal(workers[1]?.id, "operator-pc");
  assert.equal(workers[1]?.status, "offline");
  assert.equal(workers[2]?.id, "assisting-pc");
  assert.equal(workers[2]?.status, "online");
});

test("GET /api/v1/telemetry and /api/v1/status expose fps, system, and fffleet", async () => {
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/capabilities")) {
      return new Response(JSON.stringify({ slots: { stream: 2 }, capabilities: ["encoder:libx264"] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/v1/workers")) {
      return new Response(JSON.stringify({
        workers: [
          { id: "pi", status: "online", activeJobs: 1 },
          { id: "operator-pc", status: "online", activeJobs: 0 }
        ]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("not found", { status: 404 });
  };

  const app = buildApp(
    loadConfig({ PIMATRIX_MODE: "simulation", FFFLEET_URL: "http://fffleet.local:4000" }),
    mockFetch
  );
  try {
    const res = await app.inject("/api/v1/telemetry");
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.service, "pimatrix");
    assert.equal(body.fps.budgetFps, 30);
    assert.equal(body.fps.encodeFps, 0);
    assert.equal(body.fps.decodeFps, 0);
    assert.ok(body.system.memory.totalBytes > 0);
    assert.equal(body.fffleet.status, "connected");
    assert.equal(body.fffleet.workers.length, 2);
    assert.equal(body.fffleet.workers[0].id, "pi");

    const statusRes = await app.inject("/api/v1/status");
    assert.equal(statusRes.statusCode, 200);
    const statusBody = statusRes.json();
    assert.equal(statusBody.integrations.fffleet, "connected");
    assert.equal(statusBody.fps.budgetFps, 30);
    assert.ok(statusBody.system.memory.totalBytes > 0);
  } finally {
    await app.close();
  }
});
