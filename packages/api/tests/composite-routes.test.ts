import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { AtemAdapter } from "../src/atem/atem-adapter.js";
import { registerCompositeRoutes } from "../src/composite/composite-routes.js";
import { CompositeService } from "../src/composite/composite-service.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("slide")]);

async function build() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pimatrix-composite-routes-"));
  const service = new CompositeService({
    dataDir,
    stateFile: path.join(dataDir, "composites.json"),
    player: { async show() {}, async stop() {} },
    atem: new AtemAdapter(),
    renderFrame: async (options) => Buffer.from(options.format === "png" ? "\x89PNG-preview" : "rgba")
  });
  const app = Fastify();
  registerCompositeRoutes(app, service);
  return { app, service };
}

test("GET lists both composites with their output kind and state", async () => {
  const { app } = await build();
  const res = await app.inject({ method: "GET", url: "/api/v1/composites" });
  assert.equal(res.statusCode, 200);
  const items = res.json().items as Array<{ id: string; kind: string; state: string; hasSlide: boolean }>;
  assert.deepEqual(items.map((item) => [item.id, item.kind]), [["compose1", "hdmi-key"], ["compose2", "atem-media"]]);
  assert.ok(items.every((item) => item.state === "stopped" && item.hasSlide === false));
});

test("an unknown composite is 404 with the known ids listed", async () => {
  const { app } = await build();
  const res = await app.inject({ method: "GET", url: "/api/v1/composites/compose9" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "COMPOSITE_NOT_FOUND");
  assert.match(res.json().error.message, /compose1, compose2/);
});

test("PUT validates the body: unknown fields and bad values are 422, nothing changes", async () => {
  const { app, service } = await build();
  for (const payload of [{ side: "up" }, { sideways: true }, { width: 1921 }]) {
    const res = await app.inject({ method: "PUT", url: "/api/v1/composites/compose1", payload });
    assert.equal(res.statusCode, 422, JSON.stringify(payload));
    assert.equal(res.json().error.code, "INVALID_COMPOSITE");
  }
  assert.equal(service.get("compose1").side, "left");
});

test("PUT applies a valid patch and POST start/stop toggle the output", async () => {
  const { app } = await build();
  const put = await app.inject({ method: "PUT", url: "/api/v1/composites/compose1", payload: { side: "right", keyColor: "#00FF00" } });
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().side, "right");
  assert.equal(put.json().keyColor, "#00ff00");

  const start = await app.inject({ method: "POST", url: "/api/v1/composites/compose1/start" });
  assert.equal(start.json().enabled, true);
  const stop = await app.inject({ method: "POST", url: "/api/v1/composites/compose1/stop" });
  assert.equal(stop.json().enabled, false);
});

test("the slide is accepted as a raw PNG body; other content types are refused", async () => {
  const { app } = await build();
  const wrongType = await app.inject({
    method: "PUT", url: "/api/v1/composites/slide", headers: { "content-type": "application/json" }, payload: { a: 1 }
  });
  assert.equal(wrongType.statusCode, 415);

  const notPng = await app.inject({
    method: "PUT", url: "/api/v1/composites/slide", headers: { "content-type": "image/png" }, payload: Buffer.from("GIF89a")
  });
  assert.equal(notPng.statusCode, 422);
  assert.equal(notPng.json().error.code, "INVALID_SLIDE");

  const ok = await app.inject({
    method: "PUT", url: "/api/v1/composites/slide", headers: { "content-type": "image/png" }, payload: PNG
  });
  assert.equal(ok.statusCode, 202);
  assert.equal(ok.json().items.length, 2);
  assert.ok(ok.json().items.every((item: { hasSlide: boolean }) => item.hasSlide === true));
});

test("the preview is a PNG once a slide exists, 404 before", async () => {
  const { app } = await build();
  const before = await app.inject({ method: "GET", url: "/api/v1/composites/compose1/preview.png" });
  assert.equal(before.statusCode, 404);
  assert.equal(before.json().error.code, "NO_SLIDE");

  await app.inject({ method: "PUT", url: "/api/v1/composites/slide", headers: { "content-type": "image/png" }, payload: PNG });
  const after = await app.inject({ method: "GET", url: "/api/v1/composites/compose1/preview.png" });
  assert.equal(after.statusCode, 200);
  assert.match(String(after.headers["content-type"]), /image\/png/);
});
