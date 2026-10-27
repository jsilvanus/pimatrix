import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GatewayClient } from "../src/gateway/gateway-client.js";
import { RemoteAtem } from "../src/gateway/remote-atem.js";

interface Seen {
  method: string;
  url: string;
  key: string | undefined;
  body: Buffer;
}

/** A stand-in pigateway: records requests, answers a few of them, streams one SSE event. */
async function fakeGateway(): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const key = req.headers["x-api-key"];
      if (req.url === "/api/v1/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('event: ready\ndata: {"status":"connected"}\n\n');
        res.write('event: camera\ndata: {"id":"cam1","action":"power"}\n\n');
        return;
      }
      seen.push({ method: req.method ?? "", url: req.url ?? "", key: typeof key === "string" ? key : undefined, body: Buffer.concat(chunks) });
      if (req.url === "/api/v1/atem") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"connected":true}');
      } else if (req.url === "/api/v1/cameras") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"items":[{"id":"cam1"}]}');
      } else if (req.url === "/api/v1/matrix/route") {
        res.writeHead(422, { "content-type": "application/json" });
        res.end('{"error":{"code":"INVALID_INPUT"}}');
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })
  };
}

test("without a gateway the moved endpoints answer 503", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated" }));
  try {
    for (const url of ["/api/v1/atem", "/api/v1/cameras", "/api/v1/cameras/cam1/power", "/api/v1/matrix"]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 503, url);
      assert.equal(res.json().error.code, "GATEWAY_NOT_CONFIGURED");
    }
  } finally {
    await app.close();
  }
});

test("ATEM, camera and matrix calls are passed on to pigateway with its key", async () => {
  const gw = await fakeGateway();
  const app = buildApp(
    loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: gw.url, PIMATRIX_GATEWAY_API_KEY: "secret" })
  );
  try {
    const cams = await app.inject({ method: "GET", url: "/api/v1/cameras" });
    assert.equal(cams.statusCode, 200);
    assert.equal(cams.json().items[0].id, "cam1");
    const post = await app.inject({ method: "POST", url: "/api/v1/cameras/cam1/move", payload: { direction: "left" } });
    assert.equal(post.statusCode, 200);
    const sent = gw.seen.find((s) => s.method === "POST");
    assert.equal(sent?.url, "/api/v1/cameras/cam1/move");
    assert.deepEqual(JSON.parse(sent?.body.toString() ?? "{}"), { direction: "left" });
    assert.equal(sent?.key, "secret");
    const bad = await app.inject({ method: "POST", url: "/api/v1/matrix/route", payload: { input: 9, output: 1 } });
    assert.equal(bad.statusCode, 422, "the gateway's status is kept");
    assert.equal(bad.json().error.code, "INVALID_INPUT");
  } finally {
    await app.close();
    await gw.close();
  }
});

test("a gateway that cannot be reached answers 502", async () => {
  const app = buildApp(
    loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: "http://127.0.0.1:1" })
  );
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/cameras" });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, "GATEWAY_UNAVAILABLE");
  } finally {
    await app.close();
  }
});

test("RemoteAtem sends 1-based stills, keyer setup and on-air, and caches connected", async () => {
  const gw = await fakeGateway();
  try {
    const atem = new RemoteAtem(new GatewayClient(gw.url, "k"));
    assert.equal(atem.getState().connected, false);
    await atem.refresh();
    assert.equal(atem.getState().connected, true);
    await atem.uploadStill(2, Buffer.from([1, 2, 3, 4]), "slide one");
    await atem.setupDownstreamKey({ dsk: 1, mediaPlayer: 0, stillIndex: 2, fillInput: 8010, cutInput: 8011 });
    await atem.setDownstreamKeyOnAir(1, true);
    const still = gw.seen.find((s) => s.url.startsWith("/api/v1/atem/media/stills/"));
    assert.equal(still?.url, "/api/v1/atem/media/stills/3?name=slide%20one");
    assert.deepEqual([...(still?.body ?? [])], [1, 2, 3, 4]);
    const setup = gw.seen.find((s) => s.url === "/api/v1/atem/dsk/2/setup");
    assert.deepEqual(JSON.parse(setup?.body.toString() ?? "{}"), { mediaPlayer: 1, slot: 3, fillInput: 8010, cutInput: 8011 });
    const onAir = gw.seen.find((s) => s.url === "/api/v1/atem/dsk/2/on-air");
    assert.deepEqual(JSON.parse(onAir?.body.toString() ?? "{}"), { onAir: true });
  } finally {
    await gw.close();
  }
});

test("gateway camera events show up on pimatrix's own event stream", async () => {
  const gw = await fakeGateway();
  const app = buildApp(
    loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated", PIMATRIX_GATEWAY_URL: gw.url })
  );
  try {
    await app.ready();
    const broker = (app as unknown as { eventBroker: { subscribe: (l: (e: { type: string; data: unknown }) => void) => () => void } }).eventBroker;
    const got = await new Promise<{ type: string; data: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no relayed event")), 3000);
      const off = broker.subscribe((e) => {
        if (e.type === "camera") {
          clearTimeout(timer);
          off();
          resolve(e);
        }
      });
    });
    assert.deepEqual(got.data, { id: "cam1", action: "power" });
  } finally {
    await app.close();
    await gw.close();
  }
});
