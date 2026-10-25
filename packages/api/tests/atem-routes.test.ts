import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { AtemAdapter, type AtemClient } from "../src/atem/atem-adapter.js";
import { registerAtemRoutes } from "../src/atem/atem-routes.js";

function fakeClient(): AtemClient & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const listeners = new Map<string, (...args: never[]) => void>();
  const state = { video: { mixEffects: [{ programInput: 1, previewInput: 2, transitionPosition: { inTransition: false, remainingFrames: 0 } }] } };
  return {
    calls,
    state,
    async connect() {
      listeners.get("connected")?.();
    },
    async disconnect() {},
    async changeProgramInput(...args: unknown[]) { calls.push(["program", ...args]); },
    async changePreviewInput(...args: unknown[]) { calls.push(["preview", ...args]); },
    async cut(...args: unknown[]) { calls.push(["cut", ...args]); },
    on(event: string, listener: (...args: never[]) => void) {
      listeners.set(event, listener);
      return this;
    },
  } as unknown as AtemClient & { calls: unknown[][] };
}

async function build(client: AtemClient | null) {
  const atem = new AtemAdapter({ createClient: () => client ?? fakeClient() });
  const app = Fastify();
  registerAtemRoutes(app, atem);
  if (client) await atem.connect("192.0.2.10");
  return { app, atem };
}

test("GET /api/v1/atem reports disconnected when no ATEM is configured", async () => {
  const { app } = await build(null);
  const res = await app.inject({ method: "GET", url: "/api/v1/atem" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().connected, false);
  await app.close();
});

test("PUT program and preview switch the ATEM and return state", async () => {
  const client = fakeClient();
  const { app } = await build(client);
  const program = await app.inject({ method: "PUT", url: "/api/v1/atem/program", payload: { input: 3 } });
  assert.equal(program.statusCode, 200);
  assert.deepEqual(client.calls[0], ["program", 3, 0]);
  const preview = await app.inject({ method: "PUT", url: "/api/v1/atem/preview", payload: { input: 4 } });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(client.calls[1], ["preview", 4, 0]);
  await app.close();
});

test("cut sends a cut on the M/E row", async () => {
  const client = fakeClient();
  const { app } = await build(client);
  const res = await app.inject({ method: "POST", url: "/api/v1/atem/cut" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(client.calls[0], ["cut", 0]);
  await app.close();
});

test("invalid input is rejected with 422 and nothing is sent", async () => {
  const client = fakeClient();
  const { app } = await build(client);
  for (const input of [0, -1, 1.5, "x", 99]) {
    const res = await app.inject({ method: "PUT", url: "/api/v1/atem/program", payload: { input } });
    assert.equal(res.statusCode, 422, `input ${String(input)}`);
  }
  assert.equal(client.calls.length, 0);
  await app.close();
});

test("writes answer 503 when the ATEM is not connected", async () => {
  const { app } = await build(null);
  const res = await app.inject({ method: "PUT", url: "/api/v1/atem/program", payload: { input: 1 } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, "ATEM_NOT_CONNECTED");
  const cut = await app.inject({ method: "POST", url: "/api/v1/atem/cut" });
  assert.equal(cut.statusCode, 503);
  await app.close();
});
