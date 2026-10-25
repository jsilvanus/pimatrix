import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCompositePatch,
  defaultCompositeSettings,
  normaliseHexColour,
  parseCompositePatch
} from "../src/composite/composite-model.js";

test("defaults: compose1 is the HDMI key output, compose2 the ATEM media output", () => {
  const compose1 = defaultCompositeSettings("compose1");
  const compose2 = defaultCompositeSettings("compose2");
  assert.equal(compose1.kind, "hdmi-key");
  assert.equal(compose2.kind, "atem-media");
  assert.equal(compose1.enabled, false);
  assert.deepEqual([compose1.width, compose1.height], [1920, 1080]);
  assert.equal(compose1.side, "left");
  assert.equal(compose1.slideAspect, "10:16");
  assert.equal(compose1.slideScale, 1);
  assert.equal(compose1.keyColor, "#00ff00");
  assert.equal(compose1.keyMode, "chroma");
  assert.deepEqual(compose2.atem, { mediaSlot: 1, mediaPlayer: 1, dskIndex: 1, autoOnAir: false });
});

test("a valid patch is accepted and its colour is normalised to lower case", () => {
  const result = parseCompositePatch({
    enabled: true,
    side: "right",
    slideAspect: "9:16",
    slideScale: 0.8,
    keyColor: "#00FF88",
    keyMode: "luma",
    width: 1280,
    height: 720,
    atem: { mediaSlot: 3, dskIndex: 2, autoOnAir: true }
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.patch.keyColor, "#00ff88");
  assert.deepEqual(result.patch.atem, { mediaSlot: 3, dskIndex: 2, autoOnAir: true });
});

test("invalid patches are rejected with a message naming the field", () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ sideways: true }, /Unknown field: sideways/],
    [{ side: "top" }, /side/],
    [{ slideAspect: "4:3" }, /slideAspect/],
    [{ slideScale: 0.5 }, /slideScale/],
    [{ slideScale: 1.1 }, /slideScale/],
    [{ slideScale: "1" }, /slideScale/],
    [{ width: 1921 }, /width/],
    [{ height: 0 }, /height/],
    [{ width: 100000 }, /width/],
    [{ keyColor: "green" }, /keyColor/],
    [{ keyColor: "#0f0" }, /keyColor/],
    [{ keyMode: "alpha" }, /keyMode/],
    [{ enabled: "yes" }, /enabled/],
    [{ atem: { dskIndex: 5 } }, /dskIndex/],
    [{ atem: { mediaSlot: 0 } }, /mediaSlot/],
    [{ atem: { mediaPlayer: 2.5 } }, /mediaPlayer/],
    [{ atem: { autoOnAir: 1 } }, /autoOnAir/],
    [{ atem: { fill: 8010 } }, /Unknown atem field: fill/],
    [{ atem: "1" }, /atem must be an object/]
  ];
  for (const [body, pattern] of cases) {
    const result = parseCompositePatch(body);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(body)}`);
    if (!result.ok) assert.match(result.message, pattern);
  }
});

test("applyCompositePatch merges only the given fields and keeps the output kind", () => {
  const current = defaultCompositeSettings("compose2");
  const next = applyCompositePatch(current, { side: "right", atem: { dskIndex: 3 } });
  assert.equal(next.side, "right");
  assert.equal(next.kind, "atem-media");
  assert.deepEqual(next.atem, { ...current.atem, dskIndex: 3 });
  assert.equal(current.side, "left", "the current settings are not changed");
});

test("normaliseHexColour accepts only six-digit hex colours", () => {
  assert.equal(normaliseHexColour("#ABCDEF"), "#abcdef");
  assert.equal(normaliseHexColour("#abc"), null);
  assert.equal(normaliseHexColour(12), null);
});
