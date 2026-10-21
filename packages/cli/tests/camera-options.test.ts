import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/options.js";

test("parses camera commands and options", () => {
  const listOpts = parseArgs(["cameras", "list"], {});
  assert.deepEqual(listOpts.command, ["cameras", "list"]);

  const showOpts = parseArgs(["cameras", "show", "cam1"], {});
  assert.deepEqual(showOpts.command, ["cameras", "show", "cam1"]);

  const moveOpts = parseArgs(["cameras", "move", "cam1", "up", "--speed", "12"], {});
  assert.deepEqual(moveOpts.command, ["cameras", "move", "cam1", "up"]);
  assert.equal(moveOpts.speed, 12);

  const zoomOpts = parseArgs(["cameras", "zoom", "cam1", "in", "--speed", "5"], {});
  assert.deepEqual(zoomOpts.command, ["cameras", "zoom", "cam1", "in"]);
  assert.equal(zoomOpts.speed, 5);

  const recallOpts = parseArgs(["cameras", "preset", "recall", "cam1", "4"], {});
  assert.deepEqual(recallOpts.command, ["cameras", "preset", "recall", "cam1", "4"]);

  const saveOpts = parseArgs(["cameras", "preset", "save", "cam1", "5", "--name", "Altar"], {});
  assert.deepEqual(saveOpts.command, ["cameras", "preset", "save", "cam1", "5"]);
  assert.equal(saveOpts.name, "Altar");

  const sfOpts = parseArgs(["cameras", "smartframe", "cam1", "enable"], {});
  assert.deepEqual(sfOpts.command, ["cameras", "smartframe", "cam1", "enable"]);

  const streamOpts = parseArgs(["cameras", "stream", "start", "cam1"], {});
  assert.deepEqual(streamOpts.command, ["cameras", "stream", "start", "cam1"]);
});
