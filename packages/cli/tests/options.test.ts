import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/options.js";

test("uses default server and supports JSON", () => {
  const options = parseArgs(["--json", "sources", "list"], {});
  assert.equal(options.server, "http://127.0.0.1:3000");
  assert.equal(options.json, true);
  assert.deepEqual(options.command, ["sources", "list"]);
});

test("supports server override and rejects credentials or unsupported protocols", () => {
  assert.equal(parseArgs(["--server", "https://pimatrix.local", "status"], {}).server, "https://pimatrix.local");
  assert.throws(() => parseArgs(["--server", "http://user:pass@host", "status"], {}), /credentials/);
  assert.throws(() => parseArgs(["--server", "ftp://host", "status"], {}), /HTTP or HTTPS/);
});
