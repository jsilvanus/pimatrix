import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { getMultiview, multiviewSourceOrder } from "../src/model.js";

test("getMultiview orders the 8 logical sources and provides 4x2 landscape and 2x4 portrait grids", () => {
  const dummySources = multiviewSourceOrder.map((id) => ({
    id,
    label: `Label ${id}`,
    kind: "camera",
    state: "live" as const,
    preview: { available: true, url: `http://localhost:8889/${id}` }
  }));

  const snapshot = getMultiview(dummySources, "auto");
  assert.equal(snapshot.id, "multiview");
  assert.equal(snapshot.layout, "auto");
  assert.deepEqual(snapshot.landscape, { columns: 4, rows: 2 });
  assert.deepEqual(snapshot.portrait, { columns: 2, rows: 4 });
  assert.equal(snapshot.tiles.length, 8);
  assert.deepEqual(
    snapshot.tiles.map((t) => t.sourceId),
    ["cam1", "cam2", "cam3", "hama", "rtmp1", "rtmp2", "PiPGM1", "PiPGM2"]
  );
});

test("Multiview API endpoints return grid snapshot, accept layout changes, and serve HTML", async () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_PREVIEW_BASE_URL: "http://pi.local:8889"
  });
  const app = buildApp(config);

  try {
    // Check outputs list includes multiview
    const outputsRes = await app.inject({ method: "GET", url: "/api/v1/outputs" });
    assert.equal(outputsRes.statusCode, 200);
    const outputs = outputsRes.json().items;
    assert.ok(outputs.some((o: { id: string; state: string }) => o.id === "multiview" && o.state === "active"));

    // Check GET /api/v1/outputs/multiview
    const mvRes = await app.inject({ method: "GET", url: "/api/v1/outputs/multiview" });
    assert.equal(mvRes.statusCode, 200);
    const mv = mvRes.json();
    assert.equal(mv.id, "multiview");
    assert.equal(mv.layout, "auto");
    assert.equal(mv.tiles.length, 8);
    assert.equal(mv.tiles[0].sourceId, "cam1");
    assert.equal(mv.tiles[1].sourceId, "cam2");
    assert.equal(mv.tiles[2].sourceId, "cam3");
    assert.equal(mv.tiles[3].sourceId, "hama");
    assert.equal(mv.tiles[4].sourceId, "rtmp1");
    assert.equal(mv.tiles[5].sourceId, "rtmp2");
    assert.equal(mv.tiles[6].sourceId, "PiPGM1");
    assert.equal(mv.tiles[7].sourceId, "PiPGM2");

    // Check PUT /api/v1/outputs/multiview/layout
    const putRes = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/multiview/layout",
      payload: { layout: "portrait" }
    });
    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.json().layout, "portrait");

    // Invalid layout
    const badLayoutRes = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/multiview/layout",
      payload: { layout: "diagonal" }
    });
    assert.equal(badLayoutRes.statusCode, 422);

    // Check HTML view at GET /multiview
    const htmlRes = await app.inject({ method: "GET", url: "/multiview" });
    assert.equal(htmlRes.statusCode, 200);
    assert.ok(htmlRes.headers["content-type"]?.includes("text/html"));
    const html = htmlRes.body;
    assert.ok(html.includes("PiMatrix Multiview (8-Way)"));
    assert.ok(html.includes("repeat(4, 1fr)")); // Landscape 4x2
    assert.ok(html.includes("repeat(2, 1fr)")); // Portrait 2x4
    assert.ok(html.includes("tile-cam1"));
    assert.ok(html.includes("tile-hama"));
    assert.ok(html.includes("EventSource")); // SSE integration
  } finally {
    await app.close();
  }
});
