import test from "node:test";
import assert from "node:assert/strict";
import { PiPgmApiService } from "../src/services/pipgm-api";
import type {
  CreatePiPgmCanvaRequest,
  PiPgmCanvaControlRequest
} from "../src/types";

test("PiPgmApiService handles dual address profiles (LAN vs Internet WAN) and switching", () => {
  const service = new PiPgmApiService();

  service.setLanUrl("http://192.168.1.100:3000///");
  assert.equal(service.getLanUrl(), "http://192.168.1.100:3000");

  service.setWanUrl("http://church.dyndns.org:8443///");
  assert.equal(service.getWanUrl(), "http://church.dyndns.org:8443");

  service.setProfile("lan");
  assert.equal(service.getProfile(), "lan");
  assert.equal(service.getActiveUrl(), "http://192.168.1.100:3000");

  service.setProfile("wan");
  assert.equal(service.getProfile(), "wan");
  assert.equal(service.getActiveUrl(), "http://church.dyndns.org:8443");
});

test("PiPgmApiService attaches Canva secret token to HTTP requests", async () => {
  const service = new PiPgmApiService();
  service.setLanUrl("http://127.0.0.1:3000");
  service.setProfile("lan");
  service.setSecretToken("test-team-secret-token");

  const capturedHeaders: Record<string, string>[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders.push((init?.headers as Record<string, string>) || {});
    return {
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, item: { id: "canva-1", title: "Test", kind: "canva", steps: [] }, pipeline: null })
    } as Response;
  }) as typeof fetch;

  try {
    await service.pushDesign({
      designId: "DAF_TEST_123",
      title: "Test Slide"
    });

    assert.equal(capturedHeaders.length, 1);
    assert.equal(capturedHeaders[0]["Authorization"], "Bearer test-team-secret-token");
    assert.equal(capturedHeaders[0]["X-Canva-Secret"], "test-team-secret-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PiPgmApiService pushDesign formats request for Store and Program pipelines", async () => {
  const service = new PiPgmApiService();
  service.setLanUrl("http://127.0.0.1:3000");
  service.setProfile("lan");
  service.setSecretToken("");

  const capturedRequests: { url: string; method: string; body: string }[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({
      url: String(url),
      method: init?.method || "GET",
      body: String(init?.body || "")
    });
    return {
      ok: true,
      status: 201,
      json: async () => ({
        accepted: true,
        item: {
          id: "canva-test-1",
          title: "Sunday Worship",
          kind: "canva",
          createdAt: new Date().toISOString(),
          steps: [],
          canva: {
            designId: "DAF_TEST_123",
            title: "Sunday Worship",
            mode: "embed",
            embedUrl: "https://www.canva.com/design/DAF_TEST_123/view?embed",
            pageCount: 3
          }
        },
        pipeline: init?.body && JSON.parse(String(init.body)).targetPipelineId ? {
          id: "PiPGM1",
          label: "Pi Programme 1",
          orientation: "landscape",
          activeItemId: "canva-test-1",
          currentStep: 0,
          playbackState: "stopped",
          fadeToBlack: false,
          audioEnabled: true
        } : null
      })
    } as Response;
  }) as typeof fetch;

  try {
    // 1. Push to store only
    const storeReq: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      title: "Sunday Worship",
      embedUrl: "https://www.canva.com/design/DAF_TEST_123/view?embed",
      pageCount: 3,
      mode: "embed"
    };
    const storeRes = await service.pushDesign(storeReq);
    assert.equal(storeRes.accepted, true);
    assert.equal(storeRes.pipeline, null);
    assert.equal(capturedRequests[0].url, "http://127.0.0.1:3000/api/v1/pipgm/canva/push");
    const sentStoreBody = JSON.parse(capturedRequests[0].body);
    assert.equal(sentStoreBody.designId, "DAF_TEST_123");
    assert.equal(sentStoreBody.targetPipelineId, undefined);

    // 2. Push directly to Program 1 (Sanctuary 16:9 Landscape)
    const pgm1Req: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      targetPipelineId: "PiPGM1",
      orientation: "landscape",
      cueImmediately: true,
      mode: "embed"
    };
    const pgm1Res = await service.pushDesign(pgm1Req);
    assert.equal(pgm1Res.accepted, true);
    assert.equal(pgm1Res.pipeline?.id, "PiPGM1");
    const sentPgm1Body = JSON.parse(capturedRequests[1].body);
    assert.equal(sentPgm1Body.targetPipelineId, "PiPGM1");
    assert.equal(sentPgm1Body.orientation, "landscape");
    assert.equal(sentPgm1Body.cueImmediately, true);

    // 3. Push to Program 2 (Mobile 9:16 Portrait)
    const pgm2Req: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      targetPipelineId: "PiPGM2",
      orientation: "portrait",
      cueImmediately: true,
      mode: "exported_slides"
    };
    await service.pushDesign(pgm2Req);
    const sentPgm2Body = JSON.parse(capturedRequests[2].body);
    assert.equal(sentPgm2Body.targetPipelineId, "PiPGM2");
    assert.equal(sentPgm2Body.orientation, "portrait");
    assert.equal(sentPgm2Body.mode, "exported_slides");

    // 4. Push to Program 3 (Auxiliary)
    const pgm3Req: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      targetPipelineId: "PiPGM3",
      cueImmediately: true
    };
    await service.pushDesign(pgm3Req);
    const sentPgm3Body = JSON.parse(capturedRequests[3].body);
    assert.equal(sentPgm3Body.targetPipelineId, "PiPGM3");

    // 5. Push to Program 1 with 10:16 Epson church projector preset
    const pgm1EpsonReq: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      targetPipelineId: "PiPGM1",
      aspectRatio: "10:16",
      customResolution: { width: 1200, height: 1920 },
      orientation: "portrait",
      cueImmediately: true
    };
    await service.pushDesign(pgm1EpsonReq);
    const sentEpsonBody = JSON.parse(capturedRequests[4].body);
    assert.equal(sentEpsonBody.targetPipelineId, "PiPGM1");
    assert.equal(sentEpsonBody.aspectRatio, "10:16");
    assert.deepEqual(sentEpsonBody.customResolution, { width: 1200, height: 1920 });
    assert.equal(sentEpsonBody.orientation, "portrait");

    // 6. Push with custom resolution
    const customReq: CreatePiPgmCanvaRequest = {
      designId: "DAF_TEST_123",
      targetPipelineId: "PiPGM1",
      aspectRatio: "custom",
      customResolution: { width: 1440, height: 2560 },
      orientation: "portrait"
    };
    await service.pushDesign(customReq);
    const sentCustomBody = JSON.parse(capturedRequests[5].body);
    assert.equal(sentCustomBody.aspectRatio, "custom");
    assert.deepEqual(sentCustomBody.customResolution, { width: 1440, height: 2560 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PiPgmApiService controlPresentation sends FTB, Mute, GotoPage, and navigation", async () => {
  const service = new PiPgmApiService();
  service.setLanUrl("http://127.0.0.1:3000");
  service.setProfile("lan");
  service.setSecretToken("");

  const capturedControls: any[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedControls.push(JSON.parse(String(init?.body || "{}")));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        action: capturedControls[capturedControls.length - 1].action,
        pipelines: [
          {
            id: "PiPGM1",
            label: "Pi Programme 1",
            orientation: "landscape",
            activeItemId: "canva-test-1",
            currentStep: capturedControls[capturedControls.length - 1].pageNumber ? capturedControls[capturedControls.length - 1].pageNumber - 1 : 0,
            playbackState: "stopped",
            fadeToBlack: !!capturedControls[capturedControls.length - 1].ftbToggle,
            audioEnabled: true
          }
        ]
      })
    } as Response;
  }) as typeof fetch;

  try {
    // 1. FTB Toggle
    const ftbReq: PiPgmCanvaControlRequest = {
      designId: "DAF_TEST_123",
      action: "ftb",
      ftbToggle: true
    };
    const ftbRes = await service.controlPresentation(ftbReq);
    assert.equal(ftbRes.success, true);
    assert.equal(ftbRes.action, "ftb");
    assert.equal(capturedControls[0].action, "ftb");
    assert.equal(capturedControls[0].ftbToggle, true);

    // 2. Audio Mute Toggle
    const muteReq: PiPgmCanvaControlRequest = {
      targetPipelineId: "PiPGM2",
      action: "mute",
      muteToggle: true
    };
    await service.controlPresentation(muteReq);
    assert.equal(capturedControls[1].action, "mute");
    assert.equal(capturedControls[1].targetPipelineId, "PiPGM2");

    // 3. Next and Prev
    await service.controlPresentation({ action: "next", targetPipelineId: "PiPGM1" });
    assert.equal(capturedControls[2].action, "next");

    await service.controlPresentation({ action: "prev", targetPipelineId: "PiPGM1" });
    assert.equal(capturedControls[3].action, "prev");

    // 4. GotoPage (1-based page jump)
    await service.controlPresentation({ action: "gotoPage", pageNumber: 4, targetPipelineId: "all", sync: true });
    assert.equal(capturedControls[4].action, "gotoPage");
    assert.equal(capturedControls[4].pageNumber, 4);
    assert.equal(capturedControls[4].sync, true);

    // 5. Mode switch
    await service.controlPresentation({ action: "mode", mode: "exported_mp4" });
    assert.equal(capturedControls[5].action, "mode");
    assert.equal(capturedControls[5].mode, "exported_mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
