import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("Operator frontend routes render Warm Broadcast Control Stitch UI and keep Renderer (PiPGM) tab as a stub", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_MODE: "simulated"
    })
  );

  try {
    const rootRes = await app.inject({ method: "GET", url: "/" });
    assert.equal(rootRes.statusCode, 200);
    assert.ok(rootRes.headers["content-type"]?.includes("text/html"));
    assert.match(rootRes.payload, /PiMatrix \| Broadcast Routing & Camera Control/);
    // Outputs screen elements
    assert.match(rootRes.payload, /HDMI 1/);
    assert.match(rootRes.payload, /HDMI 2/);
    assert.match(rootRes.payload, /Network Stream Out \(RTSP\)/);
    // Native dialog with closedby="any" for Auxiliary modal
    assert.match(rootRes.payload, /<dialog[^>]*id="aux-modal-overlay"[^>]*closedby="any"/);

    // Inputs (Matrix Routing) route
    const inputsRes = await app.inject({ method: "GET", url: "/inputs" });
    assert.equal(inputsRes.statusCode, 200);
    assert.match(inputsRes.payload, /Matrix Routing/);
    assert.match(inputsRes.payload, /EI VIELÄ HANKITTU/);
    assert.match(inputsRes.payload, /Videomikseri/);

    // Cameras route
    const camerasRes = await app.inject({ method: "GET", url: "/cameras" });
    assert.equal(camerasRes.statusCode, 200);
    assert.match(camerasRes.payload, /PTZ Movement &amp; Optics|PTZ Movement & Optics/);
    assert.match(camerasRes.payload, /Parameter Matrix/);
    assert.match(camerasRes.payload, /Dual View/);
    assert.match(camerasRes.payload, /Single Focus/);

    // Renderer / PiPGM route: verify it is a stub only and does not include the detailed Stitch content engines
    const pipgmRes = await app.inject({ method: "GET", url: "/pipgm" });
    assert.equal(pipgmRes.statusCode, 200);
    assert.match(pipgmRes.payload, /STUB PLACEHOLDER/);
    assert.match(pipgmRes.payload, /PiPGM renderer tab stub/);
    assert.doesNotMatch(pipgmRes.payload, /Hymn Deck/);
    assert.doesNotMatch(pipgmRes.payload, /Canva Sync/);
  } finally {
    await app.close();
  }
});

test("Input-specific Fade to Black (FTB) and Mute work independently per input source and sync with PiPGM", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_MODE: "simulated"
    })
  );

  try {
    // 1. Toggle FTB on hama input specifically
    const hamaFtbOn = await app.inject({
      method: "POST",
      url: "/api/v1/sources/hama/effects/ftb",
      payload: { fadeToBlack: true }
    });
    assert.equal(hamaFtbOn.statusCode, 200);
    const hamaFx = hamaFtbOn.json();
    assert.equal(hamaFx.sourceId, "hama");
    assert.equal(hamaFx.fadeToBlack, true);
    assert.match(hamaFx.ffmpegFilter, /drawbox=x=0:y=0:w=iw:h=ih:color=black@1\.0:t=fill/);

    // Verify rtmp1 and cam1 are still not faded to black
    const rtmp1Fx = (await app.inject({ method: "GET", url: "/api/v1/sources/rtmp1/effects" })).json();
    assert.equal(rtmp1Fx.fadeToBlack, false);
    assert.equal(rtmp1Fx.ffmpegFilter, "null");

    // 2. Toggle Mute on rtmp1 input specifically
    const rtmp1Mute = await app.inject({
      method: "POST",
      url: "/api/v1/sources/rtmp1/effects/mute",
      payload: { toggle: true }
    });
    assert.equal(rtmp1Mute.statusCode, 200);
    assert.equal(rtmp1Mute.json().muted, true);

    // Verify hama is still unmuted
    const hamaFxCheck = (await app.inject({ method: "GET", url: "/api/v1/sources/hama/effects" })).json();
    assert.equal(hamaFxCheck.muted, false);

    // 3. Input-specific FTB on PiPGM1 syncs with PiPGM pipeline state
    const pipgmFtb = await app.inject({
      method: "POST",
      url: "/api/v1/sources/PiPGM1/effects/ftb",
      payload: { fadeToBlack: true }
    });
    assert.equal(pipgmFtb.statusCode, 200);
    assert.equal(pipgmFtb.json().fadeToBlack, true);

    const pipgm1State = (await app.inject({ method: "GET", url: "/api/v1/pipgm/pipelines/PiPGM1" })).json();
    assert.equal(pipgm1State.fadeToBlack, true);
  } finally {
    await app.close();
  }
});

test("Network Stream Out (RTSP), Multiview output routing, and Atlona Matrix lock & routing", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_MODE: "simulated"
    })
  );

  try {
    // 1. Route multiview to hdmi0
    const mvRoute = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: "multiview" }
    });
    assert.equal(mvRoute.statusCode, 202);
    assert.equal(mvRoute.json().desiredSource, "multiview");

    // 2. Update Network Stream Out (RTSP) source and layout
    const rtspUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/rtsp/source",
      payload: { sourceId: "multiview", layout: "portrait" }
    });
    assert.equal(rtspUpdate.statusCode, 200);
    assert.equal(rtspUpdate.json().sourceId, "multiview");
    assert.equal(rtspUpdate.json().layout, "portrait");

    // 3. Atlona Matrix lock and crosspoint route in simulation mode
    const lockRes = await app.inject({
      method: "PUT",
      url: "/api/v1/matrix/lock",
      payload: { locked: true }
    });
    assert.equal(lockRes.statusCode, 200);
    assert.equal(lockRes.json().locked, true);

    const routeRes = await app.inject({
      method: "POST",
      url: "/api/v1/matrix/route",
      payload: { input: 4, output: 1 }
    });
    assert.equal(routeRes.statusCode, 200);
    assert.equal(routeRes.json().success, true);

    const matrixSnap = (await app.inject({ method: "GET", url: "/api/v1/matrix" })).json();
    assert.equal(matrixSnap.routes["1"], 4);
  } finally {
    await app.close();
  }
});
