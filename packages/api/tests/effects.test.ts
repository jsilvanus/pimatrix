import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  EffectsStore,
  applyCropPreset,
  buildFfmpegFilter,
  defaultCropSettings,
  moveCropRectangle,
  resizeCropRectangle
} from "../src/effects/effects-model.js";

test("effects model defaults, presets, moves, and filter generation", () => {
  const crop = defaultCropSettings();
  assert.equal(crop.enabled, false);
  assert.equal(crop.width, 1920);
  assert.equal(crop.height, 1080);
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);

  // Default filter without crop or rotation is "null"
  assert.equal(buildFfmpegFilter(crop, 0), "null");

  // Force 9:16 vertical
  const v916 = applyCropPreset(crop, "force-vertical-9-16");
  assert.equal(v916.enabled, true);
  assert.equal(v916.aspectRatio, "9:16");
  assert.equal(v916.lockedAspectRatio, true);
  assert.equal(v916.width, 608);
  assert.equal(v916.height, 1080);
  assert.equal(v916.x, 656);
  assert.equal(v916.y, 0);
  assert.equal(buildFfmpegFilter(v916, 0), "crop=608:1080:656:0");

  // Force 10:16 vertical for Epson church projectors
  const v1016 = applyCropPreset(crop, "force-vertical-10-16");
  assert.equal(v1016.enabled, true);
  assert.equal(v1016.aspectRatio, "10:16");
  assert.equal(v1016.height, 1080);
  assert.equal(v1016.width, 676);
  assert.equal(v1016.x, 622);
  assert.equal(buildFfmpegFilter(v1016, 0), "crop=676:1080:622:0");

  // Rotation with crop
  assert.equal(buildFfmpegFilter(v1016, 90), "crop=676:1080:622:0,transpose=1");
  assert.equal(buildFfmpegFilter(v1016, 180), "crop=676:1080:622:0,hflip,vflip");
  assert.equal(buildFfmpegFilter(v1016, 270), "crop=676:1080:622:0,transpose=2");

  // Move crop rectangle
  const movedRight = moveCropRectangle(v916, "right", 40);
  assert.equal(movedRight.x, 696);
  const movedLeft = moveCropRectangle(movedRight, "left", 60);
  assert.equal(movedLeft.x, 636);
  const reCentered = moveCropRectangle(movedLeft, "center");
  assert.equal(reCentered.x, 656);

  // Resize crop rectangle (zoom in / out)
  const zoomedIn = resizeCropRectangle(v916, "in", 0.2);
  assert.equal(zoomedIn.enabled, true);
  assert.ok(zoomedIn.width < v916.width);
  assert.ok(zoomedIn.height < v916.height);

  // Reset preset
  const reset = applyCropPreset(v916, "reset");
  assert.equal(reset.enabled, false);
  assert.equal(reset.width, 1920);
  assert.equal(reset.height, 1080);
});

test("EffectsStore manages all 8 sources independently", () => {
  const store = new EffectsStore(["hama", "cam1", "cam2", "cam3", "rtmp1", "rtmp2", "PiPGM1", "PiPGM2"]);
  assert.equal(store.list().length, 8);

  const cam1 = store.get("cam1");
  assert.ok(cam1);
  assert.equal(cam1.crop.enabled, false);

  store.applyPreset("cam1", "force-vertical-9-16");
  assert.equal(store.get("cam1")?.crop.enabled, true);
  assert.equal(store.get("cam1")?.crop.aspectRatio, "9:16");
  assert.equal(store.get("cam2")?.crop.enabled, false); // cam2 untouched
});

test("Effects REST API endpoints handle get, crop update, presets, move, and resize", async () => {
  const app = buildApp(loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_MODE: "simulated"
  }));

  await app.ready();

  // 1. GET /api/v1/effects
  const allRes = await app.inject({ method: "GET", url: "/api/v1/effects" });
  assert.equal(allRes.statusCode, 200);
  const allJson = JSON.parse(allRes.payload);
  assert.equal(allJson.items.length, 8);

  // 2. GET /api/v1/sources/cam1/effects
  const cam1Res = await app.inject({ method: "GET", url: "/api/v1/sources/cam1/effects" });
  assert.equal(cam1Res.statusCode, 200);
  const cam1Json = JSON.parse(cam1Res.payload);
  assert.equal(cam1Json.sourceId, "cam1");
  assert.equal(cam1Json.crop.enabled, false);

  // 3. POST /api/v1/sources/cam1/effects/crop/preset with force-vertical-9-16
  const presetRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/preset",
    payload: { preset: "force-vertical-9-16" }
  });
  assert.equal(presetRes.statusCode, 200);
  const presetJson = JSON.parse(presetRes.payload);
  assert.equal(presetJson.crop.enabled, true);
  assert.equal(presetJson.crop.aspectRatio, "9:16");
  assert.equal(presetJson.crop.width, 608);
  assert.equal(presetJson.crop.height, 1080);
  assert.equal(presetJson.ffmpegFilter, "crop=608:1080:656:0");

  // 4. POST /api/v1/sources/cam1/effects/crop/preset with force-vertical-10-16 (Epson)
  const epsonRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/preset",
    payload: { preset: "force-vertical-10-16" }
  });
  assert.equal(epsonRes.statusCode, 200);
  const epsonJson = JSON.parse(epsonRes.payload);
  assert.equal(epsonJson.crop.aspectRatio, "10:16");
  assert.equal(epsonJson.crop.width, 676);
  assert.equal(epsonJson.crop.height, 1080);

  // 5. POST /api/v1/sources/cam1/effects/crop/move
  const moveRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/move",
    payload: { direction: "right", delta: 40 }
  });
  assert.equal(moveRes.statusCode, 200);
  const moveJson = JSON.parse(moveRes.payload);
  assert.equal(moveJson.crop.x, 662);

  // 6. POST /api/v1/sources/cam1/effects/crop/resize
  const resizeRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/resize",
    payload: { action: "in", factor: 0.1 }
  });
  assert.equal(resizeRes.statusCode, 200);
  const resizeJson = JSON.parse(resizeRes.payload);
  assert.ok(resizeJson.crop.width < 676);

  // 7. PUT /api/v1/sources/cam1/effects/crop directly
  const putCropRes = await app.inject({
    method: "PUT",
    url: "/api/v1/sources/cam1/effects/crop",
    payload: { x: 500, y: 10, width: 800, height: 1000 }
  });
  assert.equal(putCropRes.statusCode, 200);
  const putCropJson = JSON.parse(putCropRes.payload);
  assert.equal(putCropJson.crop.x, 500);
  assert.equal(putCropJson.crop.y, 10);
  assert.equal(putCropJson.crop.width, 800);
  assert.equal(putCropJson.crop.height, 1000);

  // 8. POST /api/v1/sources/cam1/effects/rotation
  const rotRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/rotation",
    payload: { rotation: 90 }
  });
  assert.equal(rotRes.statusCode, 200);
  const rotJson = JSON.parse(rotRes.payload);
  assert.equal(rotJson.rotation, 90);
  assert.match(rotJson.ffmpegFilter, /transpose=1/);

  // 9. Output effects mapping: route cam1 to hdmi0
  await app.inject({
    method: "PUT",
    url: "/api/v1/outputs/hdmi0/source",
    payload: { sourceId: "cam1" }
  });

  const outFxRes = await app.inject({ method: "GET", url: "/api/v1/outputs/hdmi0/effects" });
  assert.equal(outFxRes.statusCode, 200);
  const outFxJson = JSON.parse(outFxRes.payload);
  assert.equal(outFxJson.outputId, "hdmi0");
  assert.equal(outFxJson.sourceId, "cam1");
  assert.equal(outFxJson.effects.crop.width, 800);

  // 10. Verify /multiview HTML includes crop modal and presets
  const mvRes = await app.inject({ method: "GET", url: "/multiview" });
  assert.equal(mvRes.statusCode, 200);
  assert.match(mvRes.payload, /Crop & Effects/);
  assert.match(mvRes.payload, /force-vertical-9-16/);
  assert.match(mvRes.payload, /force-vertical-10-16/);

  // 11. Validation errors
  const badPresetRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/preset",
    payload: { preset: "invalid-preset" }
  });
  assert.equal(badPresetRes.statusCode, 422);

  const unknownSourceRes = await app.inject({
    method: "GET",
    url: "/api/v1/sources/unknown_source/effects"
  });
  assert.equal(unknownSourceRes.statusCode, 404);

  // 12. 4K Input to Vertical HD Crop test
  // Configure cam1 with a 4K UHD source canvas (3840x2160)
  const set4kRes = await app.inject({
    method: "PUT",
    url: "/api/v1/sources/cam1/effects/crop",
    payload: {
      sourceWidth: 3840,
      sourceHeight: 2160,
      width: 3840,
      height: 2160,
      x: 0,
      y: 0,
      enabled: false
    }
  });
  assert.equal(set4kRes.statusCode, 200);
  const set4kJson = JSON.parse(set4kRes.payload);
  assert.equal(set4kJson.crop.sourceWidth, 3840);
  assert.equal(set4kJson.crop.sourceHeight, 2160);

  // Applying 9:16 vertical preset on 4K yields 1216x2160 (4x the pixels of 1080p's 608x1080)
  const preset4kRes = await app.inject({
    method: "POST",
    url: "/api/v1/sources/cam1/effects/crop/preset",
    payload: { preset: "force-vertical-9-16" }
  });
  assert.equal(preset4kRes.statusCode, 200);
  const preset4kJson = JSON.parse(preset4kRes.payload);
  assert.equal(preset4kJson.crop.width, 1216);
  assert.equal(preset4kJson.crop.height, 2160);
  assert.equal(preset4kJson.crop.x, 1312);
  assert.equal(preset4kJson.crop.y, 0);
  assert.equal(preset4kJson.ffmpegFilter, "crop=1216:2160:1312:0,transpose=1");

  // Setting a pixel-perfect unscaled 1080x1920 Full HD portrait crop within 4K
  const nativeHdCropRes = await app.inject({
    method: "PUT",
    url: "/api/v1/sources/cam1/effects/crop",
    payload: {
      enabled: true,
      x: 1380,
      y: 120,
      width: 1080,
      height: 1920,
      aspectRatio: "9:16",
      lockedAspectRatio: true
    }
  });
  assert.equal(nativeHdCropRes.statusCode, 200);
  const nativeHdJson = JSON.parse(nativeHdCropRes.payload);
  assert.equal(nativeHdJson.crop.width, 1080);
  assert.equal(nativeHdJson.crop.height, 1920);
  assert.equal(nativeHdJson.crop.sourceWidth, 3840);
  assert.equal(nativeHdJson.crop.sourceHeight, 2160);

  await app.close();
});
