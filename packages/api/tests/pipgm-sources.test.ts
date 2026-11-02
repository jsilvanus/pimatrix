import assert from "node:assert/strict";
import test from "node:test";
import { PipgmSourceFeed, type PipgmSourcePublisher } from "../src/piprogram/pipgm-sources.js";
import type { PiprogramClient, PiprogramPipelineSnapshot } from "../src/composite/piprogram-feed.js";

function snapshot(id: string): PiprogramPipelineSnapshot {
  return {
    id,
    orientation: "landscape",
    stageUrl: `/pipgm/${id}/stage`,
    activeItemId: "item-1",
    currentStep: 0,
    fadeToBlack: false,
    slideFeed: { framePath: "x", width: 1920, height: 1080, aspect: "16:9", hasSlide: true }
  };
}

function setup(publish: boolean | undefined) {
  const frames: string[] = [];
  const calls: string[] = [];
  const client = {
    snapshot: async (id: string) => snapshot(id),
    frame: async (id: string) => {
      frames.push(id);
      return Buffer.from("png");
    }
  } as unknown as PiprogramClient;
  const publisher = (id: string): PipgmSourcePublisher => ({
    show: async () => void calls.push(`show ${id}`),
    stop: async () => void calls.push(`stop ${id}`)
  });
  const feed = new PipgmSourceFeed({
    client,
    dataDir: `${process.env.TMPDIR ?? "/tmp"}/pimatrix-pipgm-test`,
    publishers: { PiPGM1: publisher("PiPGM1"), PiPGM2: publisher("PiPGM2"), PiPGM3: publisher("PiPGM3") },
    ...(publish === undefined ? {} : { publish })
  });
  return { feed, frames, calls };
}

test("by default pimatrix fetches frames and publishes them", async () => {
  const { feed, frames, calls } = setup(undefined);
  await feed.tick();
  assert.equal(frames.length, 3);
  assert.equal(calls.filter((call) => call.startsWith("show")).length, 3);
});

test("with publishing off the snapshots are kept but nothing is fetched or published", async () => {
  const { feed, frames, calls } = setup(false);
  await feed.tick();
  assert.equal(frames.length, 0);
  assert.deepEqual(calls, []);
  assert.equal(feed.snapshot("PiPGM1")?.activeItemId, "item-1", "the source list still sees the pipeline");
  await feed.setPaused(true);
  assert.deepEqual(calls, [], "pausing does not touch streams that piprogram publishes");
});
