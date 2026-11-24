import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { parseAtlonaInputs, soundOutputReport } from "../src/sound-lanes.js";

test("wiring parses with defaults and rejects nonsense", () => {
  assert.deepEqual(parseAtlonaInputs(undefined), { hdmi0: 3, hdmi1: 4 });
  assert.deepEqual(parseAtlonaInputs("hdmi1=2"), { hdmi0: 3, hdmi1: 2 });
  assert.throws(() => parseAtlonaInputs("hdmi2=1"), /unknown Pi output/);
  assert.throws(() => parseAtlonaInputs("hdmi0=9"), /1 to 8/);
  assert.throws(() => parseAtlonaInputs("hdmi0=3,hdmi1=3"), /different inputs/);
});

test("the report names the Pi HDMI that feeds the PA output, or none", () => {
  const inputs = { hdmi0: 3, hdmi1: 4 };
  assert.equal(soundOutputReport({ 1: 3, 2: 1, 3: null, 4: 2, 5: 2 }, inputs, 1).hdmi, "hdmi0");
  assert.equal(soundOutputReport({ 1: 4 }, inputs, 1).hdmi, "hdmi1");
  assert.equal(soundOutputReport({ 1: 1, 2: 3 }, inputs, 1).hdmi, null, "input 1 is not a Pi output");
  assert.equal(soundOutputReport({ 1: null }, inputs, 1).hdmi, null);
  const other = soundOutputReport({ 1: 1, 2: 3, 4: 4 }, inputs, 1, 2);
  assert.equal(other.atlonaOutput, 2);
  assert.equal(other.hdmi, "hdmi0", "any Atlona output can be asked about");
  assert.deepEqual(other.outputs, { 1: null, 2: "hdmi0", 4: "hdmi1" });
  assert.equal(other.paAtlonaOutput, 1);
});

async function fakeGateway(routes: Record<string, number | null>) {
  const server = createServer((req, res) => {
    if (req.url === "/api/v1/matrix") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ locked: false, routes }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("GET /api/v1/sound-output reads the route from pigateway and applies the wiring", async () => {
  const gw = await fakeGateway({ 1: 4, 2: 3, 3: null, 4: 2, 5: 2 });
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: gw.url }));
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/sound-output" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().hdmi, "hdmi1");
    assert.equal(res.json().input, 4);
    assert.equal(res.json().atlonaOutput, 1);
    const right = await app.inject({ method: "GET", url: "/api/v1/sound-output?atlonaOutput=2" });
    assert.equal(right.json().hdmi, "hdmi0");
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/sound-output?atlonaOutput=x" })).statusCode, 422);
  } finally {
    await app.close();
    await gw.close();
  }
});

test("sound-output: no gateway is 503, an unreachable gateway is 502, and env changes the wiring", async () => {
  const none = buildApp(loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated" }));
  const down = buildApp(loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: "http://127.0.0.1:1" }));
  const gw = await fakeGateway({ 1: 1, 2: 2 });
  const rewired = buildApp(
    loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: gw.url, PIMATRIX_ATLONA_INPUTS: "hdmi0=1,hdmi1=2", PIMATRIX_PA_ATLONA_OUTPUT: "2" })
  );
  try {
    assert.equal((await none.inject({ method: "GET", url: "/api/v1/sound-output" })).statusCode, 503);
    assert.equal((await down.inject({ method: "GET", url: "/api/v1/sound-output" })).statusCode, 502);
    const res = await rewired.inject({ method: "GET", url: "/api/v1/sound-output" });
    assert.equal(res.json().hdmi, "hdmi1");
    assert.equal(res.json().paAtlonaOutput, 2);
  } finally {
    await none.close();
    await down.close();
    await rewired.close();
    await gw.close();
  }
});
