import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/options.js";

test("parses effects commands and options", () => {
  const listOpts = parseArgs(["effects", "list"], {});
  assert.deepEqual(listOpts.command, ["effects", "list"]);

  const showOpts = parseArgs(["effects", "show", "cam1"], {});
  assert.deepEqual(showOpts.command, ["effects", "show", "cam1"]);

  const presetOpts = parseArgs(["effects", "preset", "cam1", "force-vertical-9-16"], {});
  assert.deepEqual(presetOpts.command, ["effects", "preset", "cam1", "force-vertical-9-16"]);

  const epsonOpts = parseArgs(["effects", "preset", "cam2", "force-vertical-10-16"], {});
  assert.deepEqual(epsonOpts.command, ["effects", "preset", "cam2", "force-vertical-10-16"]);

  const cropOpts = parseArgs([
    "effects", "crop", "cam1",
    "--x", "200",
    "--y", "50",
    "--w", "608",
    "--h", "1080",
    "--aspect", "9:16",
    "--enabled", "true"
  ], {});
  assert.deepEqual(cropOpts.command, ["effects", "crop", "cam1"]);
  assert.equal(cropOpts.x, 200);
  assert.equal(cropOpts.y, 50);
  assert.equal(cropOpts.width, 608);
  assert.equal(cropOpts.height, 1080);
  assert.equal(cropOpts.aspectRatio, "9:16");
  assert.equal(cropOpts.enabled, true);

  const moveOpts = parseArgs(["effects", "move", "cam1", "right", "--delta", "40"], {});
  assert.deepEqual(moveOpts.command, ["effects", "move", "cam1", "right"]);
  assert.equal(moveOpts.delta, 40);

  const resizeOpts = parseArgs(["effects", "resize", "cam1", "in", "--factor", "0.15"], {});
  assert.deepEqual(resizeOpts.command, ["effects", "resize", "cam1", "in"]);
  assert.equal(resizeOpts.factor, 0.15);

  const rotateOpts = parseArgs(["effects", "rotate", "cam1", "90"], {});
  assert.deepEqual(rotateOpts.command, ["effects", "rotate", "cam1", "90"]);
});
