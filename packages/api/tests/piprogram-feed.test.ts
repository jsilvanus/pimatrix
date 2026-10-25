import assert from "node:assert/strict";
import test from "node:test";
import { parseCompositePatch, defaultCompositeSettings, type CompositeSettings } from "../src/composite/composite-model.js";
import {
  PiprogramClient,
  PiprogramFeed,
  type PiprogramPipelineSnapshot
} from "../src/composite/piprogram-feed.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

function snapshot(overrides: Partial<PiprogramPipelineSnapshot> = {}): PiprogramPipelineSnapshot {
  return {
    activeItemId: "item-1",
    currentStep: 0,
    fadeToBlack: false,
    slideFeed: { framePath: "/x", width: 1080, height: 1920, aspect: "9:16", hasSlide: true },
    ...overrides
  };
}

function piprogramComposite(overrides: Partial<CompositeSettings> = {}): CompositeSettings {
  return { ...defaultCompositeSettings("compose1"), enabled: true, slideSource: "piprogram", ...overrides };
}

/** A fake piprogram: the snapshot is set by the test, frames are counted. */
function fakeFeed(initial: PiprogramPipelineSnapshot, composites: CompositeSettings[]) {
  let current = initial;
  let snapshotError: Error | null = null;
  const frames: Array<[string, number, number]> = [];
  const slides: Array<[string, number]> = [];
  const cleared: string[] = [];
  const errors: Array<[string, string | null]> = [];
  const client = {
    snapshot: async () => {
      if (snapshotError) throw snapshotError;
      return current;
    },
    frame: async (pipelineId: string, width: number, height: number) => {
      frames.push([pipelineId, width, height]);
      return PNG;
    }
  } as unknown as PiprogramClient;
  const feed = new PiprogramFeed(client, {
    composites: () => composites,
    setSlide: async (id, png) => void slides.push([id, png.length]),
    clearSlide: async (id) => void cleared.push(id),
    reportError: (id, message) => void errors.push([id, message])
  });
  return {
    feed,
    frames,
    slides,
    cleared,
    errors,
    set(next: PiprogramPipelineSnapshot) {
      current = next;
    },
    failSnapshot(message: string | null) {
      snapshotError = message ? new Error(message) : null;
    }
  };
}

test("the frame is fetched once per slide change, not on every tick", async () => {
  const fixture = fakeFeed(snapshot(), [piprogramComposite()]);
  await fixture.feed.tick();
  await fixture.feed.tick();
  await fixture.feed.tick();
  assert.deepEqual(fixture.frames, [["PiPGM1", 1080, 1920]]);
  assert.equal(fixture.slides.length, 1);

  fixture.set(snapshot({ currentStep: 1 }));
  await fixture.feed.tick();
  assert.equal(fixture.frames.length, 2);
});

test("fade to black and an empty pipeline blank the output once, then the frame returns", async () => {
  const fixture = fakeFeed(snapshot({ fadeToBlack: true }), [piprogramComposite()]);
  await fixture.feed.tick();
  await fixture.feed.tick();
  assert.deepEqual(fixture.cleared, ["compose1"]);
  assert.equal(fixture.frames.length, 0);

  fixture.set(snapshot());
  await fixture.feed.tick();
  assert.equal(fixture.frames.length, 1);
  assert.equal(fixture.slides.length, 1);
});

test("a composite on uploads or switched off is left alone", async () => {
  const fixture = fakeFeed(snapshot(), [
    piprogramComposite({ slideSource: "upload" }),
    piprogramComposite({ id: "compose2", enabled: false })
  ]);
  await fixture.feed.tick();
  assert.equal(fixture.frames.length, 0);
  assert.equal(fixture.cleared.length, 0);
});

test("a snapshot failure is reported and retried on the next tick", async () => {
  const fixture = fakeFeed(snapshot(), [piprogramComposite()]);
  fixture.failSnapshot("piprogram answered 503");
  await fixture.feed.tick();
  assert.deepEqual(fixture.errors, [["compose1", "piprogram answered 503"]]);

  fixture.failSnapshot(null);
  await fixture.feed.tick();
  assert.equal(fixture.frames.length, 1);
  assert.deepEqual(fixture.errors.at(-1), ["compose1", null]);
});

test("the client sends the API key and asks for a transparent frame at the feed size", async () => {
  const calls: Array<{ url: string; key: string | null }> = [];
  const fetchFake = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), key: headers.get("x-api-key") });
    return new Response(PNG, { status: 200 });
  }) as typeof fetch;
  const client = new PiprogramClient({ baseUrl: "http://pi.local:3100/", apiKey: "k3y", fetch: fetchFake });
  await client.frame("PiPGM2", 1920, 1080);
  assert.equal(calls[0]!.url, "http://pi.local:3100/api/v1/pipgm/pipelines/PiPGM2/frame.png?width=1920&height=1080&alpha=1");
  assert.equal(calls[0]!.key, "k3y");
});

test("composite patches accept slideSource and pipelineId and refuse other values", () => {
  const ok = parseCompositePatch({ slideSource: "piprogram", pipelineId: "PiPGM2" });
  assert.deepEqual(ok, { ok: true, patch: { slideSource: "piprogram", pipelineId: "PiPGM2" } });
  assert.equal(parseCompositePatch({ slideSource: "web" }).ok, false);
  assert.equal(parseCompositePatch({ pipelineId: "PiPGM9" }).ok, false);
  assert.equal(defaultCompositeSettings("compose1").pipelineId, "PiPGM1");
});
