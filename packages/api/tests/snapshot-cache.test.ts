import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { PiprogramClient, PiprogramFeed, type PiprogramPipelineSnapshot } from "../src/composite/piprogram-feed.js";
import { PipgmSourceFeed } from "../src/piprogram/pipgm-sources.js";
import { loadConfig } from "../src/config.js";
import { createMediaMtxInspector } from "../src/media-mtx.js";

function snap(id: string): PiprogramPipelineSnapshot {
  return {
    id,
    orientation: "landscape",
    stageUrl: "/x",
    activeItemId: "i",
    currentStep: 0,
    fadeToBlack: false,
    slideFeed: { framePath: "x", width: 1920, height: 1080, aspect: "16:9", hasSlide: true }
  };
}

function fakePiprogram() {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const id = String(url).split("/pipelines/")[1]!.split("/")[0]!;
    return new Response(JSON.stringify(snap(id)), { status: 200 });
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

test("snapshot: concurrent callers share one fetch and a TTL reuses it", async () => {
  const { urls, fetchImpl } = fakePiprogram();
  let now = 0;
  const client = new PiprogramClient({ baseUrl: "http://p", fetch: fetchImpl, snapshotCacheMs: 800, now: () => now });
  const [a, b] = await Promise.all([client.snapshot("PiPGM1"), client.snapshot("PiPGM1")]);
  assert.equal(a, b);
  assert.equal(urls.length, 1);
  now = 500;
  await client.snapshot("PiPGM1");
  assert.equal(urls.length, 1);
  await client.snapshot("PiPGM2");
  assert.equal(urls.length, 2, "another pipeline is its own entry");
  now = 900;
  await client.snapshot("PiPGM1");
  assert.equal(urls.length, 3);
});

test("snapshot: without a TTL only overlapping calls are shared; failures are not cached", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return calls === 1 ? new Response("no", { status: 500 }) : new Response(JSON.stringify(snap("PiPGM1")), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new PiprogramClient({ baseUrl: "http://p", fetch: fetchImpl });
  await assert.rejects(client.snapshot("PiPGM1"));
  await client.snapshot("PiPGM1");
  await client.snapshot("PiPGM1");
  assert.equal(calls, 3);
});

test("the composite feed and the PiPGM feed together fetch each pipeline once per interval", async () => {
  const { urls, fetchImpl } = fakePiprogram();
  let now = 0;
  const client = new PiprogramClient({ baseUrl: "http://p", fetch: fetchImpl, snapshotCacheMs: 800, now: () => now });
  const compositeFeed = new PiprogramFeed(
    client,
    {
      composites: () =>
        [{ id: "compose1", enabled: true, slideSource: "piprogram", pipelineId: "PiPGM1" }] as never,
      setSlide: async () => undefined,
      clearSlide: async () => undefined,
      reportError: () => undefined
    },
    1000
  );
  const noop = { show: async () => undefined, stop: async () => undefined };
  const pipgmFeed = new PipgmSourceFeed({
    client,
    dataDir: `${process.env.TMPDIR ?? "/tmp"}/pimatrix-snapshot-cache-test`,
    publishers: { PiPGM1: noop, PiPGM2: noop, PiPGM3: noop },
    publish: false
  });
  await compositeFeed.tick();
  now = 400;
  await pipgmFeed.tick();
  const snapshots = () => urls.filter((u) => !u.includes("frame.png"));
  const pipeline1 = () => snapshots().filter((u) => u.endsWith("/PiPGM1")).length;
  assert.equal(pipeline1(), 1, "two consumers, one fetch of PiPGM1");
  assert.equal(snapshots().length, 3, "PiPGM2 and PiPGM3 fetched once for the multiview");
  now = 1000;
  await compositeFeed.tick();
  await pipgmFeed.tick();
  assert.equal(pipeline1(), 2, "one fetch per interval");
});

test("media-mtx inspector: cached within the TTL, shared in flight, 0 = off", async () => {
  mock.timers.enable({ apis: ["Date"] });
  try {
    let calls = 0;
    let release: (() => void) | undefined;
    const fetchImpl = (async () => {
      calls += 1;
      await new Promise<void>((resolve) => (release = resolve));
      return new Response(JSON.stringify({ items: [{ name: "cam1", ready: true }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const inspect = createMediaMtxInspector("http://m:9997", fetchImpl, 1000);
    const first = Promise.all([inspect(), inspect()]);
    await new Promise((r) => setImmediate(r));
    release?.();
    const [a, b] = await first;
    assert.equal(calls, 1, "in-flight calls share one fetch");
    assert.equal(a, b);
    assert.ok(a.readyPaths.has("cam1"));
    mock.timers.tick(999);
    assert.equal(await inspect(), a);
    assert.equal(calls, 1);
    mock.timers.tick(2);
    const again = inspect();
    await new Promise((r) => setImmediate(r));
    release?.();
    await again;
    assert.equal(calls, 2);

    let offCalls = 0;
    const off = createMediaMtxInspector("http://m:9997", (async () => {
      offCalls += 1;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as unknown as typeof fetch, 0);
    await off();
    await off();
    assert.equal(offCalls, 2);
  } finally {
    mock.timers.reset();
  }
});

test("media-mtx inspector without an API URL is not configured and never fetches", async () => {
  const inspect = createMediaMtxInspector(undefined, (async () => {
    throw new Error("no fetch");
  }) as unknown as typeof fetch);
  assert.equal((await inspect()).configured, false);
});

test("loadConfig reads the poll, cache and still-input settings", () => {
  const d = loadConfig({});
  assert.deepEqual([d.pipgmPollMs, d.mediaMtxCacheMs, d.stillInput], [1000, 1000, "raw"]);
  const c = loadConfig({ PIMATRIX_PIPGM_POLL_MS: "2000", PIMATRIX_MEDIAMTX_CACHE_MS: "0", PIMATRIX_STILL_INPUT: "png" });
  assert.deepEqual([c.pipgmPollMs, c.mediaMtxCacheMs, c.stillInput], [2000, 0, "png"]);
  assert.throws(() => loadConfig({ PIMATRIX_STILL_INPUT: "jpeg" }), /PIMATRIX_STILL_INPUT/);
  assert.throws(() => loadConfig({ PIMATRIX_PIPGM_POLL_MS: "0" }), /PIMATRIX_PIPGM_POLL_MS/);
});
