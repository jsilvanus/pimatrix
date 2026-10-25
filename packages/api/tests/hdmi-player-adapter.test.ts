import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { createDisplayAdapter } from "../src/display-adapter.js";
import {
  HdmiPlayerAdapter,
  type HdmiOutputConfig,
  type PlayerProcess,
  type SpawnPlayer
} from "../src/hdmi-player-adapter.js";
import type { OutputId } from "../src/model.js";

/** A fake player process: no real process; exit is driven by the test or by kill(). */
class FakeChild implements PlayerProcess {
  readonly signals: string[] = [];
  private exitListeners: Array<(code: number | null) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];
  private exitedNow = false;

  constructor(
    readonly name: string,
    private readonly log: string[],
    private readonly exitsOnTerm: boolean,
    private readonly exitsOnKill = true
  ) {}

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(String(signal));
    this.log.push(`kill ${this.name} ${signal}`);
    if (signal === "SIGTERM" && this.exitsOnTerm) setImmediate(() => this.exit(null));
    if (signal === "SIGKILL" && this.exitsOnKill) setImmediate(() => this.exit(null));
    return true;
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  onError(listener: (error: Error) => void): void {
    this.errorListeners.push(listener);
  }

  /** Simulates the process ending with the given exit code. */
  exit(code: number | null): void {
    if (this.exitedNow) return;
    this.exitedNow = true;
    for (const listener of this.exitListeners) listener(code);
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  child: FakeChild;
}

function fakeSpawner(options: { exitsOnTerm?: boolean; exitsOnKill?: boolean } = {}) {
  const calls: SpawnCall[] = [];
  const log: string[] = [];
  const spawn: SpawnPlayer = (command, args, spawnOptions) => {
    const child = new FakeChild(`p${calls.length + 1}`, log, options.exitsOnTerm ?? true, options.exitsOnKill ?? true);
    calls.push({ command, args, env: spawnOptions.env, child });
    log.push(`spawn ${child.name}`);
    return child;
  };
  return { spawn, calls, log };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function outputs(devices: Partial<Record<OutputId, string | undefined>>): ReadonlyMap<OutputId, HdmiOutputConfig> {
  return new Map<OutputId, HdmiOutputConfig>(
    (Object.entries(devices) as Array<[OutputId, string | undefined]>).map(([id, device]) => [id, { device }])
  );
}

const sourceUrl = (sourceId: string) => `rtsp://127.0.0.1:8554/${sourceId}`;

test("a route spawns ffplay with full screen, no audio, the source URL and the output device", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "/dev/dri/card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    const state = await adapter.applyRoute("hdmi0", "rtmp1");

    assert.equal(state.state, "starting");
    assert.equal(state.observedSource, "rtmp1");
    assert.equal(fake.calls.length, 1);
    const [call] = fake.calls;
    assert.equal(call.command, "ffplay");
    assert.deepEqual(call.args, [
      "-hide_banner", "-loglevel", "warning", "-fs", "-noborder", "-fflags", "nobuffer",
      "-an", "-rtsp_transport", "tcp", "-window_title", "pimatrix-hdmi0",
      "rtsp://127.0.0.1:8554/rtmp1"
    ]);
    assert.equal(call.env.PIMATRIX_OUTPUT_DEVICE, "/dev/dri/card0");
  } finally {
    await adapter.close();
  }
});

test("a configured player command and audio flag are used", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi1: "1" }),
    sourceUrl: () => "http://127.0.0.1:8888/hama/index.m3u8",
    player: "/usr/local/bin/show-on-output",
    audio: true,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    await adapter.applyRoute("hdmi1", "hama");
    const [call] = fake.calls;
    assert.equal(call.command, "/usr/local/bin/show-on-output");
    assert.equal(call.args.includes("-an"), false);
    assert.equal(call.args.includes("-rtsp_transport"), false);
  } finally {
    await adapter.close();
  }
});

test("a route change stops the running player before starting the next one", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    const second = await adapter.applyRoute("hdmi0", "hama");

    assert.equal(second.observedSource, "hama");
    assert.deepEqual(fake.log, ["spawn p1", "kill p1 SIGTERM", "spawn p2"]);
    assert.deepEqual(fake.calls[0].child.signals, ["SIGTERM"]);
  } finally {
    await adapter.close();
  }
});

test("a player still running after the grace period is killed with SIGKILL", async () => {
  const fake = fakeSpawner({ exitsOnTerm: false });
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000,
    stopGraceMs: 10
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    await adapter.applyRoute("hdmi0", null);
    assert.deepEqual(fake.calls[0].child.signals, ["SIGTERM", "SIGKILL"]);
    assert.deepEqual(fake.log, ["spawn p1", "kill p1 SIGTERM", "kill p1 SIGKILL"]);
  } finally {
    await adapter.close();
  }
});

test("a player that runs past the startup window becomes active", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 10
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    assert.equal(adapter.getOutputState("hdmi0").state, "starting");
    await sleep(30);
    assert.equal(adapter.getOutputState("hdmi0").state, "active");
    assert.equal(adapter.getOutputState("hdmi0").observedSource, "rtmp1");
  } finally {
    await adapter.close();
  }
});

test("a non-zero exit inside the startup window fails the output", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    fake.calls[0].child.exit(1);
    const state = adapter.getOutputState("hdmi0");
    assert.equal(state.state, "failed");
    assert.equal(state.observedSource, null);
  } finally {
    await adapter.close();
  }
});

test("a route to a source with no URL or an output with no device fails without spawning", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0", hdmi1: undefined }),
    sourceUrl: (sourceId) => (sourceId === "rtmp1" ? undefined : sourceUrl(sourceId)),
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    assert.equal((await adapter.applyRoute("hdmi0", "rtmp1")).state, "failed");
    assert.equal((await adapter.applyRoute("hdmi1", "hama")).state, "failed");
    assert.equal(fake.calls.length, 0);
  } finally {
    await adapter.close();
  }
});

test("a null route stops the player and leaves the output unavailable", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    const state = await adapter.applyRoute("hdmi0", null);
    assert.equal(state.state, "unavailable");
    assert.equal(state.observedSource, null);
    assert.deepEqual(fake.calls[0].child.signals, ["SIGTERM"]);
  } finally {
    await adapter.close();
  }
});

test("close stops every player", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card0", hdmi1: "card1" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  await adapter.applyRoute("hdmi0", "rtmp1");
  await adapter.applyRoute("hdmi1", "hama");

  await adapter.close();

  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[0].child.signals, ["SIGTERM"]);
  assert.deepEqual(fake.calls[1].child.signals, ["SIGTERM"]);
  assert.equal(adapter.getOutputState("hdmi0").state, "unavailable");
  assert.equal(adapter.getOutputState("hdmi1").observedSource, null);
});

test("status is not-configured without any output device and ready with one", () => {
  const none = new HdmiPlayerAdapter({ outputs: outputs({ hdmi0: undefined, hdmi1: undefined }), sourceUrl });
  assert.equal(none.getStatus(), "not-configured");

  const one = new HdmiPlayerAdapter({ outputs: outputs({ hdmi0: undefined, hdmi1: "card1" }), sourceUrl });
  assert.equal(one.getStatus(), "ready");
});

test("an unknown output throws for state and routes", async () => {
  const adapter = new HdmiPlayerAdapter({ outputs: outputs({ hdmi0: "card0" }), sourceUrl });
  assert.throws(() => adapter.getOutputState("multiview"), /Unknown output ID: multiview/);
  await assert.rejects(adapter.applyRoute("multiview", "rtmp1"), /Unknown output ID: multiview/);
});

test("createDisplayAdapter hardware mode uses the configured devices and MediaMTX RTSP base", async () => {
  const unconfigured = createDisplayAdapter("hardware", {});
  assert.equal(unconfigured.getStatus(), "not-configured");

  const configured = createDisplayAdapter("hardware", {
    hdmi0Device: "card0",
    mediaMtxRtspUrl: "rtsp://127.0.0.1:8554/"
  });
  assert.equal(configured.getStatus(), "ready");
  assert.equal(configured.getOutputState("hdmi1").state, "unavailable");
  await configured.close();
});

test("loadConfig reads the HDMI player settings with defaults", () => {
  const defaults = loadConfig({});
  assert.equal(defaults.hdmiPlayer, "ffplay");
  assert.equal(defaults.hdmi0Device, undefined);
  assert.equal(defaults.hdmi1Device, undefined);

  const set = loadConfig({
    PIMATRIX_HDMI_PLAYER: "/usr/local/bin/show",
    PIMATRIX_HDMI0_DEVICE: "/dev/dri/card0",
    PIMATRIX_HDMI1_DEVICE: "card1",
    PIMATRIX_MEDIAMTX_RTSP_URL: "rtsp://127.0.0.1:8554"
  });
  assert.equal(set.hdmiPlayer, "/usr/local/bin/show");
  assert.equal(set.hdmi0Device, "/dev/dri/card0");
  assert.equal(set.hdmi1Device, "card1");
  assert.equal(set.mediaMtxRtspUrl, "rtsp://127.0.0.1:8554");

  assert.throws(() => loadConfig({ PIMATRIX_HDMI_PLAYER: "ffplay -fs" }), /PIMATRIX_HDMI_PLAYER/);
});

test("the SDL video driver is set for players and the connector is per output", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card1-HDMI-A-1", hdmi1: "card1-HDMI-A-2" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000,
    sdlVideoDriver: "kmsdrm"
  });
  try {
    await adapter.applyRoute("hdmi0", "rtmp1");
    await adapter.applyRoute("hdmi1", "cam1");
    assert.equal(fake.calls[0]?.env.PIMATRIX_OUTPUT_DEVICE, "card1-HDMI-A-1");
    assert.equal(fake.calls[1]?.env.PIMATRIX_OUTPUT_DEVICE, "card1-HDMI-A-2");
    assert.equal(fake.calls[0]?.env.SDL_VIDEODRIVER, "kmsdrm");
    assert.equal(fake.calls[1]?.env.SDL_VIDEODRIVER, "kmsdrm");
  } finally {
    await adapter.close();
  }
});

test("without an SDL driver the environment is inherited unchanged", async () => {
  const fake = fakeSpawner();
  const adapter = new HdmiPlayerAdapter({
    outputs: outputs({ hdmi0: "card1-HDMI-A-1" }),
    sourceUrl,
    spawn: fake.spawn,
    startupWindowMs: 1000
  });
  try {
    const previous = process.env.SDL_VIDEODRIVER;
    delete process.env.SDL_VIDEODRIVER;
    await adapter.applyRoute("hdmi0", "rtmp1");
    assert.equal(fake.calls[0]?.env.SDL_VIDEODRIVER, undefined);
    if (previous !== undefined) process.env.SDL_VIDEODRIVER = previous;
  } finally {
    await adapter.close();
  }
});

test("HDMI SDL driver defaults to kmsdrm, can be cleared, and connector names are validated", () => {
  assert.equal(loadConfig({}).hdmiSdlVideoDriver, "kmsdrm");
  assert.equal(loadConfig({ PIMATRIX_HDMI_SDL_VIDEODRIVER: "" }).hdmiSdlVideoDriver, undefined);
  assert.equal(loadConfig({ PIMATRIX_HDMI_SDL_VIDEODRIVER: "x11" }).hdmiSdlVideoDriver, "x11");
  assert.equal(loadConfig({ PIMATRIX_HDMI0_DEVICE: "card1-HDMI-A-1" }).hdmi0Device, "card1-HDMI-A-1");
  assert.throws(() => loadConfig({ PIMATRIX_HDMI1_DEVICE: "card1 HDMI" }), /PIMATRIX_HDMI1_DEVICE/);
  assert.throws(() => loadConfig({ PIMATRIX_HDMI0_DEVICE: "card1;rm" }), /PIMATRIX_HDMI0_DEVICE/);
});
