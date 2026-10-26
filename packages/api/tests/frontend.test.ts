import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("source and camera labels come from the API configuration", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_MODE: "simulated",
      PIMATRIX_CAM1_NAME: "Alttari PTZ",
      PIMATRIX_CAM2_NAME: "Saarnastuoli PTZ",
      PIMATRIX_CAM3_NAME: "Urut / Parvi"
    })
  );

  try {
    const camsRes = await app.inject({ method: "GET", url: "/api/v1/cameras" });
    assert.equal(camsRes.statusCode, 200);
    const cams = camsRes.json().items as Array<{ id: string; label: string }>;
    assert.equal(cams.find((c) => c.id === "cam1")?.label, "Alttari PTZ");
    assert.equal(cams.find((c) => c.id === "cam2")?.label, "Saarnastuoli PTZ");

    const srcsRes = await app.inject({ method: "GET", url: "/api/v1/sources" });
    assert.equal(srcsRes.statusCode, 200);
    const srcs = srcsRes.json().items as Array<{ id: string; label: string }>;
    assert.equal(srcs.find((s) => s.id === "cam1")?.label, "Alttari PTZ");
    assert.equal(srcs.find((s) => s.id === "cam2")?.label, "Saarnastuoli PTZ");
    assert.equal(srcs.find((s) => s.id === "cam3")?.label, "Urut / Parvi");
  } finally {
    await app.close();
  }
});

test("the operator pages are no longer served by the API", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation", PIMATRIX_DISPLAY_MODE: "simulated" }));
  try {
    for (const url of ["/", "/outputs", "/inputs", "/cameras", "/renderer", "/assets/index.js"]) {
      const res = await app.inject({ method: "GET", url });
      assert.equal(res.statusCode, 404, url);
    }
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
  } finally {
    await app.close();
  }
});

test("Network Stream Out (RTSP) start/stop & preview/full quality, camera preset thumbnails, and Atlona Matrix", async () => {
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

    // 2. Update Network Stream Out (RTSP) source, preview quality, resolution, and bitrate
    const rtspUpdate = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/rtsp/source",
      payload: {
        sourceId: "multiview",
        layout: "portrait",
        quality: "preview",
        resolution: "640x360",
        bitrateKbps: 800
      }
    });
    assert.equal(rtspUpdate.statusCode, 200);
    assert.equal(rtspUpdate.json().sourceId, "multiview");
    assert.equal(rtspUpdate.json().layout, "portrait");
    assert.equal(rtspUpdate.json().quality, "preview");
    assert.equal(rtspUpdate.json().resolution, "640x360");
    assert.equal(rtspUpdate.json().bitrateKbps, 800);

    // 3. Start/Stop RTSP stream
    const rtspStart = await app.inject({
      method: "POST",
      url: "/api/v1/outputs/rtsp/stream",
      payload: { toggle: true }
    });
    assert.equal(rtspStart.statusCode, 200);
    assert.equal(rtspStart.json().streaming, true);

    // 4. Save camera preset thumbnail for preset 3
    const thumbRes = await app.inject({
      method: "POST",
      url: "/api/v1/cameras/cam1/presets/3/thumbnail",
      payload: { thumbnail: "data:image/svg+xml;utf8,<svg></svg>" }
    });
    assert.equal(thumbRes.statusCode, 200);
    assert.equal(thumbRes.json().success, true);
    const preset3 = thumbRes
      .json()
      .camera.presets.find((p: { id: number; thumbnail?: string }) => p.id === 3);
    assert.equal(preset3?.thumbnail, "data:image/svg+xml;utf8,<svg></svg>");

    // 5. Atlona Matrix lock and crosspoint route in simulation mode
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
