#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import {
  AtemService,
  CamerasService,
  CompositesService,
  configureApiClient,
  EffectsService,
  OutputsService,
  SourcesService,
  SystemService
} from "@pimatrix/api-client";
import type {
  CompositeId,
  CameraId,
  CameraMoveRequest,
  CameraSmartFrameRequest,
  CameraZoomRequest,
  CropPresetAction,
  EffectsPipeline,
  MoveDirection,
  MultiviewLayoutMode,
  OutputId,
  ResizeCropRequest,
  SourceId,
  UpdateCropRequest
} from "@pimatrix/api-client";
import { parseArgs, type CliOptions } from "./options.js";
import { compositePatchFromField, compositeTableRows, type CompositeRow } from "./composites.js";

const outputIds = ["hdmi0", "hdmi1", "multiview"] as const;
const sourceIds = ["hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "compose1", "PiPGM1", "PiPGM2", "PiPGM3"] as const;
const cameraIds = ["cam1", "cam2", "cam3"] as const;

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  console.log(line(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function run(options: CliOptions): Promise<void> {
  configureApiClient({ baseUrl: options.server, ...(options.apiKey ? { token: options.apiKey } : {}) });
  const [group, action, arg1, arg2, arg3] = options.command;

  if (group === "help" || options.command.length === 0) {
    console.log(
      "Usage: pimatrix [--server <url>] [--api-key <key>] [--json] <command>\n\n" +
      "Commands:\n" +
      "  status\n" +
      "  sources list\n" +
      "  sources show <sourceId>\n" +
      "  outputs list\n" +
      "  outputs set <outputId> <sourceId|none>\n" +
      "  multiview show\n" +
      "  multiview layout <auto|landscape|portrait>\n" +
      "  multiview slot <replaceSourceId> <sourceId|none>\n" +
      "  matrix route <input> <output>\n" +
      "  atem show\n" +
      "  atem program <input>\n" +
      "  atem preview <input>\n" +
      "  atem cut\n" +
      "  composites list\n" +
      "  composites show <compose1|compose2>\n" +
      "  composites set <compose1|compose2> <field> <value>\n" +
      "  composites start <compose1|compose2>\n" +
      "  composites stop <compose1|compose2>\n" +
      "  composites slide <file.png>\n" +
      "  composites preview <compose1|compose2> <out.png>\n" +
      "  cameras list\n" +
      "  cameras show <cameraId>\n" +
      "  cameras move <cameraId> <direction> [--speed <1-24>] [--pan-speed <1-24>] [--tilt-speed <1-23>]\n" +
      "  cameras zoom <cameraId> <in|out|stop> [--speed <0-7>]\n" +
      "  cameras preset recall <cameraId> <presetId>\n" +
      "  cameras preset save <cameraId> <presetId> [--name <label>]\n" +
      "  cameras smartframe <cameraId> <enable|disable|trigger>\n" +
      "  cameras privacy-blur <cameraId> <on|off>\n" +
      "  cameras stream start <cameraId>\n" +
      "  cameras stream stop <cameraId>\n" +
      "  hama status\n" +
      "  hama start\n" +
      "  hama stop [--force]\n" +
      "  effects list\n" +
      "  effects show <sourceId>\n" +
      "  effects preset <sourceId> <force-vertical-9-16|force-vertical-10-16|force-landscape-16-9|force-landscape-16-10|center|reset>\n" +
      "  effects crop <sourceId> [--x <x>] [--y <y>] [--width <w>] [--height <h>] [--aspect <ratio>] [--enabled <true|false>]\n" +
      "  effects move <sourceId> <left|right|up|down|center> [--delta <pixels>]\n" +
      "  effects resize <sourceId> <in|out> [--factor <0-1>]\n" +
      "  effects rotate <sourceId> <0|90|180|270>"
    );
    return;
  }

  if (group === "status" && options.command.length === 1) {
    const data = await SystemService.getStatus();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`PiMatrix: ${data.status}`);
      console.log(`Mode:     ${data.mode}`);
      console.log(`API:      ${data.apiVersion}`);
      console.log(`Sources:  ${data.counts.sources}`);
      console.log(`Outputs:  ${data.counts.outputs}`);
      console.log("Integrations:");
      for (const [name, state] of Object.entries(data.integrations)) console.log(`  ${name}: ${state}`);
    }
    return;
  }

  if (group === "sources" && action === "list" && options.command.length === 2) {
    const data = await SourcesService.listSources();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else printTable(["ID", "LABEL", "KIND", "STATE", "PREVIEW"], data.items.map((source) => [
      source.id, source.label, source.kind, source.state,
      source.preview.available ? "available" : "unavailable"
    ]));
    return;
  }

  if (group === "sources" && action === "show" && options.command.length === 3) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const source = await SourcesService.getSource(arg1 as SourceId);
    if (options.json) console.log(JSON.stringify(source, null, 2));
    else {
      console.log(`Source:   ${source.id}`);
      console.log(`Label:    ${source.label}`);
      console.log(`Kind:     ${source.kind}`);
      console.log(`State:    ${source.state}`);
      console.log(`Preview:  ${source.preview.available ? `available (${source.preview.url})` : "unavailable"}`);
    }
    return;
  }

  if (group === "outputs" && action === "list" && options.command.length === 2) {
    const data = await OutputsService.listOutputs();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else printTable(["ID", "LABEL", "DESIRED SOURCE", "OBSERVED SOURCE", "STATE"], data.items.map((output) => [
      output.id, output.label, output.desiredSource ?? "-", output.observedSource ?? "-", output.state
    ]));
    return;
  }

  if (group === "outputs" && action === "set" && options.command.length === 4) {
    if (!outputIds.includes(arg1 as OutputId)) throw new Error(`Unknown output ID: ${arg1}`);
    if (arg2 !== "none" && !sourceIds.includes(arg2 as SourceId)) throw new Error(`Unknown source ID: ${arg2}`);
    const data = await OutputsService.setOutputSource(arg1 as OutputId, {
      sourceId: arg2 === "none" ? null : arg2 as SourceId
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Desired source for ${data.id}: ${data.desiredSource ?? "none"}`);
      console.log(`Output state: ${data.state}`);
      if (data.state === "unavailable") console.log("Note: route intent is saved; HDMI hardware output is not implemented yet.");
    }
    return;
  }

  if (group === "multiview" && action === "show" && options.command.length === 2) {
    const data = await OutputsService.getMultiview();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Multiview: ${data.label} (Layout: ${data.layout})`);
      console.log(`Grid: Landscape ${data.landscape.columns}x${data.landscape.rows}, Portrait ${data.portrait.columns}x${data.portrait.rows}`);
      printTable(
        ["#", "SOURCE", "REPLACES", "LABEL", "KIND", "STATE", "PREVIEW"],
        data.tiles.map((t) => [
          String(t.index + 1),
          t.sourceId,
          t.replacedSourceId ?? "-",
          t.label,
          t.kind,
          t.state,
          t.preview.available ? `available (${t.preview.url})` : "unavailable"
        ])
      );
    }
    return;
  }

  if (group === "multiview" && action === "layout" && options.command.length === 3) {
    const layout = arg1 as "auto" | "landscape" | "portrait";
    if (!["auto", "landscape", "portrait"].includes(layout)) {
      throw new Error("Layout must be 'auto', 'landscape', or 'portrait'");
    }
    const data = await OutputsService.setMultiviewLayout({
      layout: layout as unknown as MultiviewLayoutMode
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Multiview layout updated to: ${data.layout}`);
    return;
  }

  if (group === "multiview" && action === "slot" && options.command.length === 4) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown slot source ID: ${arg1}`);
    if (arg2 !== "none" && !sourceIds.includes(arg2 as SourceId)) throw new Error(`Unknown replacement source ID: ${arg2}`);
    const data = await OutputsService.setMultiviewSlot({
      replaceSourceId: arg1 as SourceId,
      sourceId: arg2 === "none" ? null : (arg2 as SourceId)
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Multiview slot ${arg1} set to: ${arg2}`);
    return;
  }

  if (group === "atem" && action === "show" && options.command.length === 2) {
    const data = await AtemService.getAtemState();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Connected: ${data.connected ? "yes" : "no"}`);
      console.log(`Program:   ${data.programInput ?? "-"}`);
      console.log(`Preview:   ${data.previewInput ?? "-"}`);
    }
    return;
  }

  if (group === "atem" && (action === "program" || action === "preview") && options.command.length === 3) {
    const input = Number(arg1);
    if (!Number.isInteger(input) || input < 1) throw new Error("ATEM input must be a positive integer");
    const data = action === "program"
      ? await AtemService.setAtemProgram({ input })
      : await AtemService.setAtemPreview({ input });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`ATEM ${action} set to input ${input}`);
    return;
  }

  if (group === "atem" && action === "cut" && options.command.length === 2) {
    const data = await AtemService.cutAtem();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log("ATEM cut sent");
    return;
  }

  if (group === "composites" && action === "list" && options.command.length === 2) {
    const data = await CompositesService.listComposites();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else printTable(["ID", "KIND", "ON", "STATE", "FRAME", "SLIDE", "KEY", "SLIDE SENT", "ERROR"], compositeTableRows(data.items as CompositeRow[]));
    return;
  }

  if (group === "composites" && action === "show" && options.command.length === 3) {
    const data = await CompositesService.getComposite(arg1 as CompositeId);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else printTable(["ID", "KIND", "ON", "STATE", "FRAME", "SLIDE", "KEY", "SLIDE SENT", "ERROR"], compositeTableRows([data as CompositeRow]));
    return;
  }

  if (group === "composites" && action === "set" && options.command.length === 5) {
    const result = compositePatchFromField(arg2 ?? "", arg3 ?? "");
    if (!result.ok) throw new Error(result.message);
    const data = await CompositesService.updateComposite(arg1 as CompositeId, result.patch);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`${data.id}: ${arg2} set to ${arg3} (state ${data.state})`);
    return;
  }

  if (group === "composites" && (action === "start" || action === "stop") && options.command.length === 3) {
    const id = arg1 as CompositeId;
    const data = action === "start"
      ? await CompositesService.startComposite(id)
      : await CompositesService.stopComposite(id);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`${data.id}: ${action === "start" ? "enabled" : "disabled"} (state ${data.state})`);
    return;
  }

  if (group === "composites" && action === "slide" && options.command.length === 3) {
    const bytes = await readFile(arg1 ?? "");
    const data = await CompositesService.setCompositeSlide(new Blob([bytes], { type: "image/png" }));
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Slide sent (${bytes.length} bytes) to ${data.items.map((item) => item.id).join(", ")}`);
    return;
  }

  if (group === "composites" && action === "preview" && options.command.length === 4) {
    const response = await fetch(`${options.server}/api/v1/composites/${arg1}/preview.png`, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
    });
    if (!response.ok) throw new Error(`Preview failed: HTTP ${response.status}`);
    await writeFile(arg2 ?? "", Buffer.from(await response.arrayBuffer()));
    console.log(`Preview written to ${arg2}`);
    return;
  }

  if (group === "matrix" && action === "route" && options.command.length === 4) {
    const input = Number(arg1);
    const output = Number(arg2);
    if (!Number.isInteger(input) || input < 1 || input > 4) throw new Error("Matrix input must be 1-4");
    if (!Number.isInteger(output) || output < 1 || output > 4) throw new Error("Matrix output must be 1-4");
    const data = await SystemService.requestMatrixRoute({ input, output });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Matrix route requested: in ${data.input} -> out ${data.output}`);
      console.log(`Status: ${data.confirmed ? "confirmed" : "sent"}`);
      if (data.message) console.log(`AMX reply: ${data.message}`);
    }
    return;
  }

  // Camera commands
  if (group === "cameras" && action === "list" && options.command.length === 2) {
    const data = await CamerasService.listCameras();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else {
      printTable(
        ["ID", "LABEL", "MODEL", "CONNECTION", "STREAMING", "SMARTFRAME", "PAN", "TILT", "ZOOM", "PRESETS"],
        data.items.map((cam) => [
          cam.id,
          cam.label,
          cam.model,
          cam.connection,
          cam.streaming ? "streaming" : "idle",
          cam.smartFrame,
          String(cam.position.pan),
          String(cam.position.tilt),
          String(cam.position.zoom),
          String(cam.presets.length)
        ])
      );
    }
    return;
  }

  if (group === "cameras" && action === "show" && options.command.length === 3) {
    if (!cameraIds.includes(arg1 as CameraId)) throw new Error(`Unknown camera ID: ${arg1}`);
    const cam = await CamerasService.getCamera(arg1 as CameraId);
    if (options.json) console.log(JSON.stringify(cam, null, 2));
    else {
      console.log(`Camera:      ${cam.id} (${cam.label})`);
      console.log(`Model:       ${cam.model}`);
      console.log(`Connection:  ${cam.connection}`);
      console.log(`Streaming:   ${cam.streaming ? `yes (${cam.streamUrl ?? "no url"})` : "no"}`);
      console.log(`SmartFrame:  ${cam.smartFrame}`);
      console.log(`Position:    Pan=${cam.position.pan}, Tilt=${cam.position.tilt}, Zoom=${cam.position.zoom}`);
      console.log(`Presets (${cam.presets.length}):`);
      for (const p of cam.presets) {
        console.log(`  [${p.id}] ${p.name ?? "(unnamed)"}`);
      }
    }
    return;
  }

  if (group === "cameras" && action === "move" && options.command.length === 4) {
    if (!cameraIds.includes(arg1 as CameraId)) throw new Error(`Unknown camera ID: ${arg1}`);
    const direction = arg2 as unknown as CameraMoveRequest.direction;
    const panSpeed = options.panSpeed ?? options.speed;
    const tiltSpeed = options.tiltSpeed ?? options.speed;
    const data = await CamerasService.moveCamera(arg1 as CameraId, {
      direction,
      ...(panSpeed !== undefined ? { panSpeed } : {}),
      ...(tiltSpeed !== undefined ? { tiltSpeed } : {})
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: ${data.action} (${data.success ? "success" : "failed"})`);
    return;
  }

  if (group === "cameras" && action === "zoom" && options.command.length === 4) {
    if (!cameraIds.includes(arg1 as CameraId)) throw new Error(`Unknown camera ID: ${arg1}`);
    const zoomAction = arg2 as unknown as CameraZoomRequest.action;
    const data = await CamerasService.zoomCamera(arg1 as CameraId, {
      action: zoomAction,
      ...(options.speed !== undefined ? { speed: options.speed } : {})
    });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: ${data.action} (${data.success ? "success" : "failed"})`);
    return;
  }

  if (group === "cameras" && action === "preset" && arg1 === "recall" && options.command.length === 5) {
    const cameraId = arg2 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg2}`);
    const presetId = Number(arg3);
    if (!Number.isInteger(presetId) || presetId < 0 || presetId > 254) throw new Error("Preset ID must be 0-254");
    const data = await CamerasService.recallCameraPreset(cameraId, presetId);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: recalled preset ${presetId}`);
    return;
  }

  if (group === "cameras" && action === "preset" && arg1 === "save" && options.command.length === 5) {
    const cameraId = arg2 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg2}`);
    const presetId = Number(arg3);
    if (!Number.isInteger(presetId) || presetId < 0 || presetId > 254) throw new Error("Preset ID must be 0-254");
    const data = await CamerasService.saveCameraPreset(cameraId, presetId, options.name ? { name: options.name } : undefined);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: saved preset ${presetId}${options.name ? ` as "${options.name}"` : ""}`);
    return;
  }

  if (group === "cameras" && action === "smartframe" && options.command.length === 4) {
    const cameraId = arg1 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg1}`);
    const mode = arg2 as unknown as CameraSmartFrameRequest.mode;
    if (!["enable", "disable", "trigger"].includes(arg2 ?? "")) throw new Error("SmartFrame mode must be 'enable', 'disable', or 'trigger'");
    const data = await CamerasService.setCameraSmartFrame(cameraId, { mode });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: SmartFrame ${arg2}`);
    return;
  }

  if (group === "cameras" && action === "privacy-blur" && options.command.length === 4) {
    const cameraId = arg1 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg1}`);
    if (!["on", "off"].includes(arg2 ?? "")) throw new Error("Privacy blur must be 'on' or 'off'");
    const data = await CamerasService.setCameraPrivacyBlur(cameraId, { enabled: arg2 === "on" });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: privacy blur ${arg2}`);
    return;
  }

  if (group === "cameras" && action === "stream" && arg1 === "start" && options.command.length === 4) {
    const cameraId = arg2 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg2}`);
    const data = await CamerasService.startCameraStream(cameraId);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: streaming started (${data.streamUrl ?? "no url"})`);
    return;
  }

  if (group === "cameras" && action === "stream" && arg1 === "stop" && options.command.length === 4) {
    const cameraId = arg2 as CameraId;
    if (!cameraIds.includes(cameraId)) throw new Error(`Unknown camera ID: ${arg2}`);
    const data = await CamerasService.stopCameraStream(cameraId);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Camera ${data.cameraId}: streaming stopped`);
    return;
  }

  // Hama capture (on demand): start/stop by hand, or see what holds it
  if (group === "hama" && action === "status" && options.command.length === 2) {
    const data = await SourcesService.getHamaCapture();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      const demand = data.demand;
      const holds = [demand.manual && "manual", demand.routed && "routed", demand.relayed && "relayed"].filter(Boolean);
      console.log(`Hama capture: ${data.state} (${data.width ?? "?"}x${data.height ?? "?"}, ${data.videoCodec ?? "default codec"})`);
      console.log(`Held by:      ${holds.length > 0 ? holds.join(", ") : "nothing"}; idle stop after ${data.idleGraceSeconds} s`);
      if (data.lastError) console.log(`Last error:   ${data.lastError}`);
    }
    return;
  }

  if (group === "hama" && action === "start" && options.command.length === 2) {
    const data = await SourcesService.startHamaCapture();
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Hama capture: ${data.state}`);
    return;
  }

  if (group === "hama" && action === "stop" && options.command.length === 2) {
    const data = await SourcesService.stopHamaCapture(options.force ? "1" : undefined);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Hama capture: ${data.state}`);
    return;
  }

  // Effects
  if (group === "effects" && action === "list" && options.command.length === 2) {
    const data = await EffectsService.listAllEffects();
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else printTable(["SOURCE", "CROP", "ASPECT", "BOUNDS", "ROTATION", "FFMPEG"], data.items.map((e) => [
      e.sourceId,
      e.crop.enabled ? "enabled" : "disabled",
      e.crop.aspectRatio,
      `${e.crop.width}x${e.crop.height}+${e.crop.x}+${e.crop.y}`,
      `${e.rotation}°`,
      e.ffmpegFilter
    ]));
    return;
  }

  if (group === "effects" && action === "show" && options.command.length === 3) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const data = await EffectsService.getSourceEffects(arg1 as SourceId);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else {
      console.log(`Source:     ${data.sourceId}`);
      console.log(`Crop:       ${data.crop.enabled ? "enabled" : "disabled"}`);
      console.log(`Aspect:     ${data.crop.aspectRatio} (locked: ${data.crop.lockedAspectRatio})`);
      console.log(`Dimensions: ${data.crop.width}x${data.crop.height}`);
      console.log(`Position:   x=${data.crop.x}, y=${data.crop.y}`);
      console.log(`Rotation:   ${data.rotation}°`);
      console.log(`FFmpeg:     ${data.ffmpegFilter}`);
    }
    return;
  }

  if (group === "effects" && action === "preset" && options.command.length === 4) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const preset = arg2 as CropPresetAction;
    const data = await EffectsService.applySourceCropPreset(arg1 as SourceId, { preset });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Source ${data.sourceId}: preset ${preset} applied (${data.crop.width}x${data.crop.height}+${data.crop.x}+${data.crop.y})`);
    return;
  }

  if (group === "effects" && action === "crop" && options.command.length === 3) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const req: UpdateCropRequest = {};
    if (options.x !== undefined) req.x = options.x;
    if (options.y !== undefined) req.y = options.y;
    if (options.width !== undefined) req.width = options.width;
    if (options.height !== undefined) req.height = options.height;
    if (options.sourceWidth !== undefined) req.sourceWidth = options.sourceWidth;
    if (options.sourceHeight !== undefined) req.sourceHeight = options.sourceHeight;
    if (options.aspectRatio !== undefined) {
      req.aspectRatio = options.aspectRatio as NonNullable<UpdateCropRequest["aspectRatio"]>;
    }
    if (options.enabled !== undefined) req.enabled = options.enabled;

    const data = await EffectsService.updateSourceCrop(arg1 as SourceId, req);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Source ${data.sourceId}: crop updated (${data.crop.width}x${data.crop.height}+${data.crop.x}+${data.crop.y}, enabled: ${data.crop.enabled})`);
    return;
  }

  if (group === "effects" && action === "move" && options.command.length === 4) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const direction = arg2 as MoveDirection;
    const req: { direction: MoveDirection; delta?: number } = { direction };
    if (options.delta !== undefined) req.delta = options.delta;

    const data = await EffectsService.moveSourceCrop(arg1 as SourceId, req);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Source ${data.sourceId}: crop moved ${direction} -> (x: ${data.crop.x}, y: ${data.crop.y})`);
    return;
  }

  if (group === "effects" && action === "resize" && options.command.length === 4) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const act = arg2 as "in" | "out";
    const req: { action: ResizeCropRequest.action; factor?: number } = {
      action: act as ResizeCropRequest.action
    };
    if (options.factor !== undefined) req.factor = options.factor;

    const data = await EffectsService.resizeSourceCrop(arg1 as SourceId, req);
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Source ${data.sourceId}: crop resized ${act} -> (${data.crop.width}x${data.crop.height})`);
    return;
  }

  if (group === "effects" && action === "rotate" && options.command.length === 4) {
    if (!sourceIds.includes(arg1 as SourceId)) throw new Error(`Unknown source ID: ${arg1}`);
    const rotation = Number(arg2) as 0 | 90 | 180 | 270;
    const data = await EffectsService.setSourceRotation(arg1 as SourceId, { rotation });
    if (options.json) console.log(JSON.stringify(data, null, 2));
    else console.log(`Source ${data.sourceId}: rotation set to ${data.rotation}°`);
    return;
  }

  throw new Error(`Unknown command: ${options.command.join(" ")}`);
}

run(parseArgs(process.argv.slice(2))).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pimatrix: ${message}`);
  process.exitCode = 1;
});
