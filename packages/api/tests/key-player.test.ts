import assert from "node:assert/strict";
import test from "node:test";
import { KeyPagePlayer, type KeyPlayerProcess } from "../src/composite/key-player.js";

interface FakeChild extends KeyPlayerProcess {
  exit(code: number | null): void;
  signals: string[];
}

function fakeSpawn(log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }>) {
  return (_command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }): KeyPlayerProcess => {
    let exitListener: ((code: number | null) => void) | null = null;
    const child: FakeChild = {
      signals: [],
      kill(signal) {
        child.signals.push(signal ?? "SIGTERM");
        exitListener?.(0);
        return true;
      },
      onExit(listener) { exitListener = listener; },
      onError() {},
      exit(code) { exitListener?.(code); }
    };
    log.push({ args, env: options.env, child });
    return child;
  };
}

test("show starts the player on the file with the output device in the environment", async () => {
  const log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = [];
  const player = new KeyPagePlayer({ device: "card1-HDMI-A-2", sdlVideoDriver: "kmsdrm", startupWindowMs: 5, spawn: fakeSpawn(log) });
  await player.show("/data/compose1-key.png");
  assert.equal(log.length, 1);
  assert.equal(log[0]?.env.PIMATRIX_OUTPUT_DEVICE, "card1-HDMI-A-2");
  assert.equal(log[0]?.env.SDL_VIDEODRIVER, "kmsdrm");
  assert.equal(log[0]?.args.at(-1), "/data/compose1-key.png");
  assert.ok(log[0]?.args.includes("-an"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(player.getStatus().state, "running");
});

test("a new slide stops the old player before the new one starts", async () => {
  const log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = [];
  const player = new KeyPagePlayer({ device: "card1-HDMI-A-2", startupWindowMs: 5, spawn: fakeSpawn(log) });
  await player.show("/data/first.png");
  await player.show("/data/second.png");
  assert.equal(log.length, 2);
  assert.deepEqual(log[0]?.child.signals, ["SIGTERM"]);
  assert.equal(log[1]?.args.at(-1), "/data/second.png");
});

test("without a device the player refuses to start and says why", async () => {
  const log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = [];
  const player = new KeyPagePlayer({ spawn: fakeSpawn(log) });
  await assert.rejects(player.show("/data/x.png"), /PIMATRIX_COMPOSITE_HDMI_DEVICE is not set/);
  assert.equal(log.length, 0);
  assert.equal(player.getStatus().state, "failed");
});

test("a player that exits with an error inside the start window is failed, with the code", async () => {
  const log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = [];
  const player = new KeyPagePlayer({ device: "card1-HDMI-A-2", startupWindowMs: 200, spawn: fakeSpawn(log) });
  await player.show("/data/x.png");
  log[0]?.child.exit(1);
  assert.equal(player.getStatus().state, "failed");
  assert.match(player.getStatus().lastError ?? "", /code 1/);
});

test("stop ends the player and reports stopped", async () => {
  const log: Array<{ args: readonly string[]; env: NodeJS.ProcessEnv; child: FakeChild }> = [];
  const player = new KeyPagePlayer({ device: "card1-HDMI-A-2", startupWindowMs: 5, spawn: fakeSpawn(log) });
  await player.show("/data/x.png");
  await player.stop();
  assert.deepEqual(log[0]?.child.signals, ["SIGTERM"]);
  assert.equal(player.getStatus().state, "stopped");
});
