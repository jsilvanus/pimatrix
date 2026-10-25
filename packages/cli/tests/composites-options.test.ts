import assert from "node:assert/strict";
import test from "node:test";
import { compositePatchFromField, compositeTableRows } from "../src/composites.js";
import { parseArgs } from "../src/options.js";

test("composites commands parse as positional words", () => {
  assert.deepEqual(parseArgs(["composites", "list"], {}).command, ["composites", "list"]);
  assert.deepEqual(parseArgs(["composites", "set", "compose1", "side", "right"], {}).command, ["composites", "set", "compose1", "side", "right"]);
  assert.deepEqual(parseArgs(["composites", "preview", "compose2", "out.png"], {}).command, ["composites", "preview", "compose2", "out.png"]);
});

test("set maps a plain field to a flat patch and a dotted one to a nested object", () => {
  assert.deepEqual(compositePatchFromField("side", "right"), { ok: true, patch: { side: "right" } });
  assert.deepEqual(compositePatchFromField("width", "1280"), { ok: true, patch: { width: 1280 } });
  assert.deepEqual(compositePatchFromField("slideScale", "0.8"), { ok: true, patch: { slideScale: 0.8 } });
  assert.deepEqual(compositePatchFromField("enabled", "false"), { ok: true, patch: { enabled: false } });
  assert.deepEqual(compositePatchFromField("atem.dskIndex", "2"), { ok: true, patch: { atem: { dskIndex: 2 } } });
  assert.deepEqual(compositePatchFromField("atem.autoOnAir", "true"), { ok: true, patch: { atem: { autoOnAir: true } } });
  assert.deepEqual(compositePatchFromField("keyColor", "#00ff00"), { ok: true, patch: { keyColor: "#00ff00" } });
});

test("set refuses unknown fields and badly typed values before any request", () => {
  assert.equal(compositePatchFromField("sideways", "left").ok, false);
  assert.equal(compositePatchFromField("enabled", "yes").ok, false);
  assert.equal(compositePatchFromField("atem.dskIndex", "two").ok, false);
  assert.equal(compositePatchFromField("width", "").ok, false);
});

test("the list table has one row per composite and shows the colour only for the HDMI key output", () => {
  const rows = compositeTableRows([
    { id: "compose1", kind: "hdmi-key", enabled: true, state: "running", side: "left", slideAspect: "10:16", slideScale: 1, keyColor: "#00ff00", keyMode: "chroma", width: 1920, height: 1080, hasSlide: true, lastError: null },
    { id: "compose2", kind: "atem-media", enabled: false, state: "stopped", side: "right", slideAspect: "9:16", slideScale: 0.8, keyColor: "#00ff00", keyMode: "chroma", width: 1920, height: 1080, hasSlide: false, lastError: "ATEM is not connected" }
  ]);
  assert.equal(rows[0]?.[0], "compose1");
  assert.equal(rows[0]?.[6], "#00ff00");
  assert.equal(rows[1]?.[6], "-");
  assert.equal(rows[1]?.[8], "ATEM is not connected");
});
