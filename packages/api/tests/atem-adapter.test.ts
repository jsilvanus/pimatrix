import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { AtemAdapter, type AtemClient } from "../src/atem/atem-adapter.js";
import { loadConfig } from "../src/config.js";

/** A fake atem-connection client: no sockets, state and events driven by the test. */
class FakeAtem extends EventEmitter implements AtemClient {
  state: unknown = undefined;
  calls: Array<[string, ...unknown[]]> = [];
  connectArgs: [string, number | undefined] | null = null;

  async connect(address: string, port?: number): Promise<void> {
    this.connectArgs = [address, port];
  }
  async disconnect(): Promise<void> {
    this.calls.push(["disconnect"]);
  }
  async changeProgramInput(input: number, me?: number): Promise<void> {
    this.calls.push(["changeProgramInput", input, me]);
  }
  async changePreviewInput(input: number, me?: number): Promise<void> {
    this.calls.push(["changePreviewInput", input, me]);
  }
  async cut(me?: number): Promise<void> {
    this.calls.push(["cut", me]);
  }
}

function makeAdapter(meIndex?: number) {
  const fakes: FakeAtem[] = [];
  const adapter = new AtemAdapter({
    ...(meIndex !== undefined ? { meIndex } : {}),
    createClient: () => {
      const fake = new FakeAtem();
      fakes.push(fake);
      return fake;
    },
  });
  return { adapter, fakes };
}

test("stub adapter without a host reports disconnected and opens nothing", async () => {
  const { adapter, fakes } = makeAdapter();
  await adapter.connect(undefined);
  await adapter.connect("   ");

  assert.equal(fakes.length, 0);
  assert.deepEqual(adapter.getState(), {
    connected: false,
    programInput: null,
    previewInput: null,
    transition: { inTransition: false, remainingFrames: 0 },
  });
});

test("stub adapter switching commands are no-ops", async () => {
  const { adapter, fakes } = makeAdapter();
  await adapter.setProgram(1);
  await adapter.setPreview(2);
  await adapter.cut();

  assert.equal(fakes.length, 0);
  assert.equal(adapter.getState().connected, false);
});

test("switching input numbers must be positive integers", async () => {
  const { adapter } = makeAdapter();
  await assert.rejects(adapter.setProgram(0), RangeError);
  await assert.rejects(adapter.setPreview(1.5), RangeError);
});

test("connected state is read from the M/E row, as plain data", async () => {
  const { adapter, fakes } = makeAdapter(1);
  await adapter.connect("192.0.2.10", 9991);
  const [fake] = fakes;
  assert.ok(fake);
  assert.deepEqual(fake.connectArgs, ["192.0.2.10", 9991]);

  fake.state = {
    video: {
      mixEffects: [
        { programInput: 9, previewInput: 9 },
        { programInput: 3, previewInput: 4, transitionPosition: { inTransition: true, remainingFrames: 12 } },
      ],
    },
  };
  fake.emit("connected");

  const state = adapter.getState();
  assert.deepEqual(state, {
    connected: true,
    programInput: 3,
    previewInput: 4,
    transition: { inTransition: true, remainingFrames: 12 },
  });
  assert.deepEqual(Object.keys(state).sort(), ["connected", "previewInput", "programInput", "transition"]);
});

test("state change listeners receive the new state and can unsubscribe", async () => {
  const { adapter, fakes } = makeAdapter();
  await adapter.connect("192.0.2.10");
  const [fake] = fakes;
  assert.ok(fake);
  const seen: Array<boolean> = [];
  const unsubscribe = adapter.onStateChange((state) => seen.push(state.connected));

  fake.emit("connected");
  fake.state = { video: { mixEffects: [{ programInput: 2, previewInput: 5 }] } };
  fake.emit("stateChanged");
  unsubscribe();
  fake.emit("disconnected");

  assert.deepEqual(seen, [true, true]);
  assert.equal(adapter.getState().connected, false);
});

test("commands are forwarded to the M/E index and refused while not connected", async () => {
  const { adapter, fakes } = makeAdapter(1);
  await adapter.connect("192.0.2.10");
  const [fake] = fakes;
  assert.ok(fake);

  await assert.rejects(adapter.setProgram(2), /not connected/);

  fake.emit("connected");
  await adapter.setProgram(2);
  await adapter.setPreview(3);
  await adapter.cut();
  assert.deepEqual(fake.calls, [
    ["changeProgramInput", 2, 1],
    ["changePreviewInput", 3, 1],
    ["cut", 1],
  ]);
});

test("loadConfig reads the ATEM host and defaults the port to 9990", () => {
  const unset = loadConfig({});
  assert.equal(unset.atemHost, undefined);
  assert.equal(unset.atemPort, 9990);

  const set = loadConfig({ PIMATRIX_ATEM_HOST: " 192.0.2.20 ", PIMATRIX_ATEM_PORT: "9991" });
  assert.equal(set.atemHost, "192.0.2.20");
  assert.equal(set.atemPort, 9991);

  assert.throws(() => loadConfig({ PIMATRIX_ATEM_PORT: "70000" }), /PIMATRIX_ATEM_PORT/);
});
