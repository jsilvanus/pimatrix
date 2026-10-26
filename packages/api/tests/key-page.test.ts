import assert from "node:assert/strict";
import test from "node:test";
import { keyPageFilterGraph, keyPageGeometry, makeEven, type KeyPageInput } from "../src/composite/key-page.js";

const base: KeyPageInput = {
  kind: "hdmi-key",
  width: 1920,
  height: 1080,
  side: "left",
  slideAspect: "10:16",
  slideScale: 1,
  keyColor: "#00ff00",
  keyMode: "chroma"
};

test("1920x1080, 10:16 slide at the left edge: 676x1080 at x=0 (the plan's table)", () => {
  const geometry = keyPageGeometry(base);
  assert.deepEqual(geometry.slide, { x: 0, y: 0, width: 676, height: 1080 });
  assert.equal(geometry.background, "#00ff00");
  assert.equal(geometry.transparent, false);
});

test("1920x1080, 10:16 slide at the right edge: the slide ends on the frame edge", () => {
  const geometry = keyPageGeometry({ ...base, side: "right" });
  assert.deepEqual(geometry.slide, { x: 1244, y: 0, width: 676, height: 1080 });
  assert.equal(geometry.slide.x + geometry.slide.width, 1920);
});

test("1920x1080, 9:16 slide: 608 wide, at the right edge x=1312", () => {
  assert.deepEqual(keyPageGeometry({ ...base, slideAspect: "9:16" }).slide, { x: 0, y: 0, width: 608, height: 1080 });
  assert.deepEqual(keyPageGeometry({ ...base, slideAspect: "9:16", side: "right" }).slide, { x: 1312, y: 0, width: 608, height: 1080 });
});

test("1280x720 gives the plan's 450 (10:16) and 406 (9:16) wide slides", () => {
  const size = { width: 1280, height: 720 };
  assert.deepEqual(keyPageGeometry({ ...base, ...size }).slide, { x: 0, y: 0, width: 450, height: 720 });
  assert.deepEqual(keyPageGeometry({ ...base, ...size, slideAspect: "9:16" }).slide, { x: 0, y: 0, width: 406, height: 720 });
});

test("slideScale shrinks the slide and centres it vertically", () => {
  const geometry = keyPageGeometry({ ...base, slideScale: 0.6 });
  assert.deepEqual(geometry.slide, { x: 0, y: 216, width: 406, height: 648 });
  assert.equal(geometry.slide.y + geometry.slide.height / 2, 540);
});

test("every size is even and the slide never leaves the frame", () => {
  for (const scale of [0.6, 0.7, 0.85, 1]) {
    for (const side of ["left", "right"] as const) {
      for (const slideAspect of ["10:16", "9:16"] as const) {
        for (const [width, height] of [[1920, 1080], [1280, 720], [1080, 1920], [16, 16]] as const) {
          const { slide } = keyPageGeometry({ ...base, width, height, side, slideAspect, slideScale: scale });
          assert.equal(slide.width % 2, 0);
          assert.equal(slide.height % 2, 0);
          assert.ok(slide.x >= 0 && slide.y >= 0);
          assert.ok(slide.x + slide.width <= width, `${width}x${height} ${side} ${slideAspect} ${scale}`);
          assert.ok(slide.y + slide.height <= height);
        }
      }
    }
  }
});

test("luma keying uses a black background whatever the key colour; atem media is transparent", () => {
  assert.equal(keyPageGeometry({ ...base, keyMode: "luma" }).background, "#000000");
  const media = keyPageGeometry({ ...base, kind: "atem-media" });
  assert.equal(media.transparent, true);
});

test("makeEven rounds to the nearest even number", () => {
  assert.equal(makeEven(675), 676);
  assert.equal(makeEven(607.5), 608);
  assert.equal(makeEven(405), 406);
  assert.equal(makeEven(648), 648);
});

test("the filter graph places the slide and fills the background", () => {
  const graph = keyPageFilterGraph(keyPageGeometry({ ...base, side: "right" }));
  assert.match(graph, /color=c=0x00ff00:s=1920x1080/);
  assert.match(graph, /\[0:v\]scale=676:1080:flags=lanczos/);
  assert.match(graph, /overlay=x=1244:y=0/);
  assert.match(graph, /\[out\]$/);
  const transparent = keyPageFilterGraph(keyPageGeometry({ ...base, kind: "atem-media" }));
  assert.match(transparent, /color=c=black@0:s=1920x1080/);
});

test("offsetY moves the slide between the top and bottom edges", () => {
  const scaled = { ...base, slideScale: 0.6 };
  assert.equal(keyPageGeometry({ ...scaled, offsetY: -1 }).slide.y, 0);
  assert.equal(keyPageGeometry({ ...scaled, offsetY: 0 }).slide.y, 216);
  const bottom = keyPageGeometry({ ...scaled, offsetY: 1 }).slide;
  assert.equal(bottom.y + bottom.height, 1080);
});

test("offsetX moves the slide between the left and right edges", () => {
  const narrow = { ...base, slideScale: 0.6 };
  const left = keyPageGeometry({ ...narrow, offsetX: -1 }).slide;
  assert.equal(left.x, 0);
  const right = keyPageGeometry({ ...narrow, offsetX: 1 }).slide;
  assert.equal(right.x + right.width, 1920);
  const mid = keyPageGeometry({ ...narrow, offsetX: 0 }).slide;
  assert.equal(mid.x, Math.round((1920 - mid.width) / 2));
});
