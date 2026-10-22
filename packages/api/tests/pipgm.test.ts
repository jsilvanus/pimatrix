import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { buildPiPgmStreamSpec } from "../src/stream-supervisor.js";

/**
 * Helper to build a minimal valid .pptx (ZIP archive) in memory containing a slide XML with text and <p:timing> animations.
 */
function buildMinimalPptxBuffer(slideXml: string): Buffer {
  const filename = Buffer.from("ppt/slides/slide1.xml", "utf8");
  const compressed = deflateRawSync(Buffer.from(slideXml, "utf8"));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // Local file header signature
  header.writeUInt16LE(20, 4); // Version needed
  header.writeUInt16LE(0, 6); // Flags
  header.writeUInt16LE(8, 8); // Compression method: Deflate (8)
  header.writeUInt32LE(compressed.length, 18); // Compressed size
  header.writeUInt32LE(Buffer.byteLength(slideXml), 22); // Uncompressed size
  header.writeUInt16LE(filename.length, 26); // File name length
  header.writeUInt16LE(0, 28); // Extra field length
  return Buffer.concat([header, filename, compressed]);
}

test("PiPGM initializes 3 pipelines (PiPGM1 portrait, PiPGM2 landscape, PiPGM3 hidden by default, all muted)", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation" }));
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/pipgm/pipelines" });
    assert.equal(res.statusCode, 200);
    const pipelines = res.json().items;
    assert.equal(pipelines.length, 3);

    const p1 = pipelines.find((p: { id: string }) => p.id === "PiPGM1");
    const p2 = pipelines.find((p: { id: string }) => p.id === "PiPGM2");
    const p3 = pipelines.find((p: { id: string }) => p.id === "PiPGM3");

    assert.equal(p1.orientation, "portrait");
    assert.deepEqual(p1.resolution, { width: 1080, height: 1920 });
    assert.equal(p1.hidden, false);
    assert.equal(p1.audioEnabled, false); // Muted by default

    assert.equal(p2.orientation, "landscape");
    assert.deepEqual(p2.resolution, { width: 1920, height: 1080 });
    assert.equal(p2.hidden, false);
    assert.equal(p2.audioEnabled, false);

    assert.equal(p3.orientation, "landscape");
    assert.equal(p3.hidden, true); // PiPGM3 hidden by default
    assert.equal(p3.audioEnabled, false);

    // Filtering out hidden pipelines
    const visibleOnly = await app.inject({
      method: "GET",
      url: "/api/v1/pipgm/pipelines?includeHidden=false"
    });
    assert.equal(visibleOnly.json().items.length, 2);
  } finally {
    await app.close();
  }
});

test("PiPGM3 replaces non-used view (cam3 by default, or explicit slot) in 8-way multiview", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation" }));
  try {
    // Initially PiPGM3 is hidden and idle -> multiview has standard 8 sources (cam3 at index 2)
    const initialMv = (await app.inject({ method: "GET", url: "/api/v1/outputs/multiview" })).json();
    assert.equal(initialMv.tiles[2].sourceId, "cam3");
    assert.equal(initialMv.tiles.some((t: { sourceId: string }) => t.sourceId === "PiPGM3"), false);

    // Unhide PiPGM3 -> automatically replaces cam3 (first non-live replaceable slot) in multiview
    const unhideRes = await app.inject({
      method: "PUT",
      url: "/api/v1/pipgm/pipelines/PiPGM3/config",
      payload: { hidden: false, orientation: "portrait" }
    });
    assert.equal(unhideRes.statusCode, 200);
    assert.equal(unhideRes.json().hidden, false);
    assert.equal(unhideRes.json().orientation, "portrait");

    const autoReplacedMv = (await app.inject({ method: "GET", url: "/api/v1/outputs/multiview" })).json();
    assert.equal(autoReplacedMv.tiles.length, 8);
    assert.equal(autoReplacedMv.tiles[2].sourceId, "PiPGM3");
    assert.equal(autoReplacedMv.tiles[2].replacedSourceId, "cam3");

    // Operator can also explicitly assign PiPGM3 to replace rtmp2 instead
    const explicitSlotRes = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/multiview/slot",
      payload: { replaceSourceId: "rtmp2", sourceId: "PiPGM3" }
    });
    assert.equal(explicitSlotRes.statusCode, 200);
    const explicitMv = explicitSlotRes.json();
    assert.equal(explicitMv.tiles[2].sourceId, "cam3");
    assert.equal(explicitMv.tiles[5].sourceId, "PiPGM3");
    assert.equal(explicitMv.tiles[5].replacedSourceId, "rtmp2");
  } finally {
    await app.close();
  }
});

test("Hymns, PowerPoint (.pptx with animations), Canva push/export, YouTube, Video, and Image items work end-to-end", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation" }));
  try {
    // 1. Hymn item from raw stanza text, cued onto PiPGM1 (Portrait)
    const hymnRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/items/hymn",
      payload: {
        hymnNumber: "Virsi 1",
        title: "Hoosianna",
        rawText: "1.\nHoosianna, Daavidin Poika,\nkiitetty olkoon hän!\n\n2.\nSiunattu olkoon hän,\njoka tulee Herran nimeen!",
        targetPipelineId: "PiPGM1",
        cueImmediately: true
      }
    });
    assert.equal(hymnRes.statusCode, 201);
    const hymnItem = hymnRes.json();
    assert.equal(hymnItem.kind, "hymn");
    assert.equal(hymnItem.steps.length, 2);
    assert.equal(hymnItem.steps[0].label, "Stanza 1 (1/2)");

    // Step forward to Stanza 2 on PiPGM1
    const nextHymn = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/pipelines/PiPGM1/control",
      payload: { action: "next" }
    });
    assert.equal(nextHymn.statusCode, 200);
    assert.equal(nextHymn.json().currentStep, 1);
    assert.equal(nextHymn.json().currentStepDetail.label, "Stanza 2 (2/2)");

    // 2. Direct PowerPoint (.pptx) binary upload with XML text and animation timing
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld>
          <p:spTree>
            <p:sp><p:txBody><a:p><a:r><a:t>Sermon Outline</a:t></a:r></a:p></p:txBody></p:sp>
            <p:sp><p:txBody>
              <a:p><a:r><a:t>Point One: Grace</a:t></a:r></a:p>
              <a:p><a:r><a:t>Point Two: Peace</a:t></a:r></a:p>
            </p:txBody></p:sp>
          </p:spTree>
        </p:cSld>
        <p:timing>
          <p:tnLst>
            <p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:animEffect filter="fade"/></p:childTnLst></p:cTn></p:par>
            <p:par><p:cTn nodeType="clickEffect"><p:childTnLst><p:animEffect filter="wipe"/></p:childTnLst></p:cTn></p:par>
          </p:tnLst>
        </p:timing>
      </p:sld>
    `;
    const pptxBuffer = buildMinimalPptxBuffer(slideXml);
    const pptxRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/items/pptx",
      payload: {
        filename: "sunday-sermon.pptx",
        dataBase64: pptxBuffer.toString("base64"),
        targetPipelineId: "PiPGM2",
        cueImmediately: true
      }
    });
    assert.equal(pptxRes.statusCode, 201);
    const pptxItem = pptxRes.json();
    assert.equal(pptxItem.kind, "pptx");
    // 1 initial slide step + 2 animation builds = 3 steps total
    assert.equal(pptxItem.steps.length, 3);
    assert.equal(pptxItem.steps[0].effect, "initial");
    assert.equal(pptxItem.steps[1].effect, "fade");
    assert.equal(pptxItem.steps[2].effect, "wipe");

    // 3. Team Canva App plugin push ("Send to PiPGM" button with autoExport)
    const canvaOptionsRes = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/pipgm/canva/push"
    });
    assert.equal(canvaOptionsRes.statusCode, 204);
    assert.equal(canvaOptionsRes.headers["access-control-allow-origin"], "*");

    const canvaPushRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/push",
      payload: {
        designId: "DAF_CHURCH_2026",
        title: "Parish Announcements",
        pageCount: 3,
        autoExport: true,
        exportFormat: "mp4",
        targetPipelineId: "PiPGM2",
        cueImmediately: true,
        orientation: "landscape"
      }
    });
    assert.equal(canvaPushRes.statusCode, 201);
    const canvaPushJson = canvaPushRes.json();
    assert.equal(canvaPushJson.accepted, true);
    assert.equal(canvaPushJson.item.canva.designId, "DAF_CHURCH_2026");
    assert.equal(canvaPushJson.item.canva.pushedFromCanvaApp, true);
    assert.equal(canvaPushJson.item.canva.mode, "exported_mp4");
    assert.equal(canvaPushJson.item.canva.exportJob.status, "completed");
    assert.equal(canvaPushJson.item.steps.length, 3);
    assert.equal(canvaPushJson.pipeline.activeItemId, canvaPushJson.item.id);

    // 3b. Canva Plugin & Embed Presentation Control (FTB, Mute, Next, GotoPage, Mode)
    const canvaCtrlOptions = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/pipgm/canva/control"
    });
    assert.equal(canvaCtrlOptions.statusCode, 204);
    assert.equal(canvaCtrlOptions.headers["access-control-allow-origin"], "*");

    // Toggle FTB via Canva control targeting designId
    const canvaFtbRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      payload: {
        designId: "DAF_CHURCH_2026",
        action: "ftb",
        fadeToBlack: true
      }
    });
    assert.equal(canvaFtbRes.statusCode, 200);
    const canvaFtbJson = canvaFtbRes.json();
    assert.equal(canvaFtbJson.success, true);
    assert.equal(canvaFtbJson.action, "ftb");
    assert.equal(canvaFtbJson.pipelines.find((p: any) => p.id === "PiPGM2")?.fadeToBlack, true);

    // Toggle Audio Mute via Canva control targeting designId
    const canvaMuteRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      payload: {
        designId: "DAF_CHURCH_2026",
        action: "mute",
        audioEnabled: false
      }
    });
    assert.equal(canvaMuteRes.statusCode, 200);
    assert.equal(canvaMuteRes.json().pipelines.find((p: any) => p.id === "PiPGM2")?.audioEnabled, false);

    // Advance next slide via Canva control
    const canvaNextRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      payload: {
        designId: "DAF_CHURCH_2026",
        action: "next"
      }
    });
    assert.equal(canvaNextRes.statusCode, 200);
    assert.equal(canvaNextRes.json().pipelines.find((p: any) => p.id === "PiPGM2")?.currentStep, 1);

    // Jump to specific pageNumber (1-based page 3 -> 0-based step 2)
    const canvaPageRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      payload: {
        targetPipelineId: "PiPGM2",
        action: "gotoPage",
        pageNumber: 3
      }
    });
    assert.equal(canvaPageRes.statusCode, 200);
    assert.equal(canvaPageRes.json().pipelines.find((p: any) => p.id === "PiPGM2")?.currentStep, 2);

    // Verify stage HTML includes the Canva embed postMessage listener
    const stageRes = await app.inject({ method: "GET", url: "/pipgm/PiPGM2/stage" });
    assert.equal(stageRes.statusCode, 200);
    assert.ok(stageRes.payload.includes('addEventListener("message"'));
    assert.ok(stageRes.payload.includes("/api/v1/pipgm/canva/control"));


    // 4. YouTube Video Embedding
    const ytRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/items/youtube",
      payload: {
        title: "Prelude Bach",
        urlOrId: "https://youtu.be/dQw4w9WgXcQ",
        startSeconds: 15
      }
    });
    assert.equal(ytRes.statusCode, 201);
    assert.equal(ytRes.json().youtube.videoId, "dQw4w9WgXcQ");
    assert.equal(ytRes.json().youtube.embedUrl, "https://www.youtube.com/embed/dQw4w9WgXcQ");

    // 5. Uploaded Video & Image + Asset Download
    const imgData = Buffer.from("fake-png-bytes").toString("base64");
    const imgRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/items/media",
      payload: {
        kind: "image",
        title: "Altar Cross Graphic",
        filename: "cross.png",
        mimeType: "image/png",
        dataBase64: imgData,
        fit: "cover"
      }
    });
    assert.equal(imgRes.statusCode, 201);
    const assetUrl = imgRes.json().image.assetUrl;
    const assetGet = await app.inject({ method: "GET", url: assetUrl });
    assert.equal(assetGet.statusCode, 200);
    assert.equal(assetGet.body, "fake-png-bytes");
  } finally {
    await app.close();
  }
});

test("Fade to Black (with mobile sign), Audio Mute/Unmute, Linked Pipeline Sync, and Stage HTML", async () => {
  const app = buildApp(loadConfig({ PIMATRIX_MODE: "simulation" }));
  try {
    // Create a 3-stanza hymn and load onto both PiPGM1 (Portrait) and PiPGM2 (Landscape)
    const hymn = (
      await app.inject({
        method: "POST",
        url: "/api/v1/pipgm/items/hymn",
        payload: {
          hymnNumber: "324",
          title: "Kiitos nyt Herran",
          rawText: "Stanza One\n\nStanza Two\n\nStanza Three",
          targetPipelineId: "PiPGM1",
          cueImmediately: true
        }
      })
    ).json();

    await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/pipelines/PiPGM2/playlist",
      payload: { itemId: hymn.id, cueImmediately: true }
    });

    // Link PiPGM1 and PiPGM2 together
    await app.inject({
      method: "PUT",
      url: "/api/v1/pipgm/pipelines/PiPGM1/config",
      payload: { linked: true }
    });
    await app.inject({
      method: "PUT",
      url: "/api/v1/pipgm/pipelines/PiPGM2/config",
      payload: { linked: true }
    });

    // Advance PiPGM1 -> PiPGM2 also advances in lockstep!
    await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/pipelines/PiPGM1/control",
      payload: { action: "next" }
    });
    const p1AfterNext = (await app.inject("/api/v1/pipgm/pipelines/PiPGM1")).json();
    const p2AfterNext = (await app.inject("/api/v1/pipgm/pipelines/PiPGM2")).json();
    assert.equal(p1AfterNext.currentStep, 1);
    assert.equal(p2AfterNext.currentStep, 1);

    // Toggle Fade to Black on PiPGM1 -> triggers special mobile alert sign & syncs to PiPGM2
    const ftbRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/pipelines/PiPGM1/ftb",
      payload: { fadeToBlack: true, durationMs: 400 }
    });
    assert.equal(ftbRes.statusCode, 200);
    const ftbState = ftbRes.json();
    assert.equal(ftbState.fadeToBlack, true);
    assert.equal(ftbState.state, "blackout");
    assert.equal(ftbState.mobileAlert.fadeToBlackActive, true);
    assert.equal(ftbState.mobileAlert.signCode, "FADED_TO_BLACK");
    assert.equal(ftbState.mobileAlert.ghostPreviewAvailable, true);
    assert.ok(ftbState.mobileAlert.cuedSummary.includes("324 Kiitos nyt Herran"));

    const p2AfterFtb = (await app.inject("/api/v1/pipgm/pipelines/PiPGM2")).json();
    assert.equal(p2AfterFtb.fadeToBlack, true);

    // Enable sound on PiPGM1 -> signCode updates to FTB_AND_SOUND_ON
    const audioRes = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/pipelines/PiPGM1/audio",
      payload: { audioEnabled: true, volume: 85 }
    });
    assert.equal(audioRes.statusCode, 200);
    assert.equal(audioRes.json().audioEnabled, true);
    assert.equal(audioRes.json().volume, 85);
    assert.equal(audioRes.json().mobileAlert.signCode, "FTB_AND_SOUND_ON");

    // Stage HTML renders portrait stage with FTB curtain active
    const stageRes = await app.inject({ method: "GET", url: "/pipgm/PiPGM1/stage" });
    assert.equal(stageRes.statusCode, 200);
    assert.ok(stageRes.headers["content-type"]?.includes("text/html"));
    assert.ok(stageRes.body.includes('data-orientation="portrait"'));
    assert.ok(stageRes.body.includes('data-ftb="true"'));

    // fffleet stream spec respects portrait/landscape resolution and mute/unmute audio filter
    const mutedSpec = buildPiPgmStreamSpec({
      pipelineId: "PiPGM1",
      rtspUrl: "rtsp://mediamtx:8554/PiPGM1",
      orientation: "portrait",
      audioEnabled: false,
      attempt: 1
    });
    assert.ok(mutedSpec.ffmpeg?.args.includes("color=c=black:s=1080x1920:r=30"));
    assert.ok(mutedSpec.ffmpeg?.args.includes("volume=0.00"));

    const unmutedSpec = buildPiPgmStreamSpec({
      pipelineId: "PiPGM2",
      rtspUrl: "rtsp://mediamtx:8554/PiPGM2",
      orientation: "landscape",
      audioEnabled: true,
      volume: 80,
      attempt: 2
    });
    assert.ok(unmutedSpec.ffmpeg?.args.includes("color=c=black:s=1920x1080:r=30"));
    assert.ok(unmutedSpec.ffmpeg?.args.includes("volume=0.80"));
  } finally {
    await app.close();
  }
});
