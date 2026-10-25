import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { keyPageArgs, renderKeyPage, isPng } from "../src/composite/key-render.js";
import { keyPageGeometry, type KeyPageInput } from "../src/composite/key-page.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** A 100x160 (10:16) blue PNG, made by ffmpeg itself so the test needs no fixture file. */
function bluePng(): Buffer {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x0000ff:s=100x160",
    "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"
  ], { maxBuffer: 10 * 1024 * 1024 });
  return result.stdout;
}

function pixel(rgba: Buffer, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [...rgba.subarray(offset, offset + 4)];
}

/** Scaling and YUV-free RGBA still move colours by a unit or two; allow a small tolerance. */
function assertNear(actual: number[], expected: number[], message: string): void {
  const close = actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= 3);
  assert.ok(close, `${message}: expected about ${expected}, got ${actual}`);
}

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

test("the ffmpeg command takes the slide on stdin and maps the filtered output", () => {
  const args = keyPageArgs(keyPageGeometry(base), "rgba");
  assert.ok(args.includes("pipe:0"));
  assert.ok(args.includes("-filter_complex"));
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-map") + 2), ["-map", "[out]"]);
  assert.equal(args.at(-1), "pipe:1");
});

test("a slide that is not a PNG is refused before ffmpeg starts", async () => {
  await assert.rejects(
    renderKeyPage({ geometry: keyPageGeometry(base), slidePng: Buffer.from("not a png"), format: "rgba", spawn: () => { throw new Error("must not spawn"); } }),
    /must be a PNG/
  );
});

test("a missing ffmpeg is reported as a readable error", async () => {
  await assert.rejects(
    renderKeyPage({ geometry: keyPageGeometry(base), slidePng: bluePng(), format: "rgba", ffmpeg: "/nonexistent/ffmpeg-for-test" }),
    /could not start|ENOENT/
  );
});

test("chroma key page: key colour outside the slide, the slide on the left", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const geometry = keyPageGeometry(base);
  const rgba = await renderKeyPage({ geometry, slidePng: bluePng(), format: "rgba" });
  assert.equal(rgba.length, 1920 * 1080 * 4);
  assertNear(pixel(rgba, 1920, 1000, 540), [0, 255, 0, 255], "background right of the slide");
  assertNear(pixel(rgba, 1920, 1915, 1075), [0, 255, 0, 255], "bottom right corner");
  assertNear(pixel(rgba, 1920, 300, 540), [0, 0, 255, 255], "slide centre");
});

test("the slide moves to the right edge when side is right", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const rgba = await renderKeyPage({ geometry: keyPageGeometry({ ...base, side: "right" }), slidePng: bluePng(), format: "rgba" });
  assertNear(pixel(rgba, 1920, 5, 540), [0, 255, 0, 255], "background left of the slide");
  assertNear(pixel(rgba, 1920, 1600, 540), [0, 0, 255, 255], "slide on the right");
});

test("ATEM media frame: transparent outside the slide, opaque on it", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const rgba = await renderKeyPage({ geometry: keyPageGeometry({ ...base, kind: "atem-media" }), slidePng: bluePng(), format: "rgba" });
  assert.equal(pixel(rgba, 1920, 1000, 540)[3], 0, "background is transparent");
  assert.equal(pixel(rgba, 1920, 300, 540)[3], 255, "slide is opaque");
  assertNear(pixel(rgba, 1920, 300, 540), [0, 0, 255, 255], "slide colour");
});

test("PNG output is a PNG of the frame size", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
  const png = await renderKeyPage({ geometry: keyPageGeometry(base), slidePng: bluePng(), format: "png" });
  assert.ok(isPng(png));
  assert.equal(png.readUInt32BE(16), 1920);
  assert.equal(png.readUInt32BE(20), 1080);
});
