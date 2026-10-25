import assert from "node:assert/strict";
import test from "node:test";
import { HamaOnDemand, type HamaCaptureControl } from "../src/hama-on-demand.js";

/** A capture stand-in that records calls; state moves to "running" on start and "idle" on halt. */
function fakeCapture() {
  const calls: string[] = [];
  let state = "idle";
  const capture: HamaCaptureControl = {
    start() {
      calls.push("start");
      state = "running";
    },
    async halt() {
      calls.push("halt");
      state = "idle";
    },
    snapshot: () => ({ state })
  };
  return { capture, calls };
}

function setup(graceMs: number) {
  const reasons = { routed: false, relayed: false };
  const { capture, calls } = fakeCapture();
  const demand = new HamaOnDemand(capture, graceMs, () => ({ ...reasons }));
  return { demand, reasons, calls };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("nothing wanted: the capture stays idle and is never started", async () => {
  const { demand, calls } = setup(5);
  demand.sync();
  await wait(20);
  assert.deepEqual(calls, []);
  assert.equal(demand.demand().wanted, false);
});

test("a routed output starts the capture at once", () => {
  const { demand, reasons, calls } = setup(5);
  reasons.routed = true;
  demand.sync();
  assert.deepEqual(calls, ["start"]);
  assert.equal(demand.demand().routed, true);
});

test("the capture stops only after the idle grace period once nothing needs it", async () => {
  const { demand, reasons, calls } = setup(30);
  reasons.routed = true;
  demand.sync();
  reasons.routed = false;
  demand.sync();
  await wait(5);
  assert.deepEqual(calls, ["start"], "still within the grace period");
  await wait(40);
  assert.deepEqual(calls, ["start", "halt"]);
});

test("a new reason inside the grace period cancels the pending stop", async () => {
  const { demand, reasons, calls } = setup(30);
  reasons.relayed = true;
  demand.sync();
  reasons.relayed = false;
  demand.sync();
  reasons.relayed = true;
  demand.sync();
  await wait(50);
  assert.deepEqual(calls, ["start", "start"]);
});

test("a manual start holds the capture until stopManual", async () => {
  const { demand, calls } = setup(5);
  demand.startManual();
  await wait(20);
  assert.deepEqual(calls, ["start"]);
  assert.equal(demand.demand().manual, true);
  demand.stopManual();
  await wait(20);
  assert.deepEqual(calls, ["start", "halt"]);
});

test("stopNow halts at once even while routed, and clears the manual hold", async () => {
  const { demand, reasons, calls } = setup(1000);
  reasons.routed = true;
  demand.startManual();
  await demand.stopNow();
  assert.deepEqual(calls, ["start", "halt"]);
  assert.equal(demand.demand().manual, false);
});
