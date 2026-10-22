#!/usr/bin/env node

import {
  CamerasService,
  configureApiClient,
  EffectsService,
  OutputsService,
  PiPgmService,
  SourcesService,
  SystemService
} from "@pimatrix/api-client";
import type {
  CameraId,
  CameraMoveRequest,
  CameraSmartFrameRequest,
  CameraZoomRequest,
  CropPresetAction,
  EffectsPipeline,
  MoveDirection,
  MultiviewLayoutMode,
  OutputId,
  PiPgmControlRequest,
  PiPgmOrientation,
  PiPgmPipelineId,
  ResizeCropRequest,
  SourceId,
  UpdateCropRequest
} from "@pimatrix/api-client";
import { parseArgs, type CliOptions } from "./options.js";

const outputIds = ["hdmi0", "hdmi1", "multiview"] as const;
const sourceIds = ["hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "PiPGM1", "PiPGM2", "PiPGM3"] as const;
const cameraIds = ["cam1", "cam2", "cam3"] as const;
const pipgmIds = ["PiPGM1", "PiPGM2", "PiPGM3"] as const;

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
  configureApiClient({ baseUrl: options.server });
  const [group, action, arg1, arg2, arg3] = options.command;

  if (group === "help" || options.command.length === 0) {
    console.log(
      "Usage: pimatrix [--server <url>] [--json] <command>\n\n" +
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
      "  cameras list\n" +
      "  cameras show <cameraId>\n" +
      "  cameras move <cameraId> <direction> [--speed <1-24>] [--pan-speed <1-24>] [--tilt-speed <1-23>]\n" +
      "  cameras zoom <cameraId> <in|out|stop> [--speed <0-7>]\n" +
      "  cameras preset recall <cameraId> <presetId>\n" +
      "  cameras preset save <cameraId> <presetId> [--name <label>]\n" +
      "  cameras smartframe <cameraId> <enable|disable|trigger>\n" +
      "  cameras stream start <cameraId>\n" +
      "  cameras stream stop <cameraId>\n" +
      "  pipgm list\n" +
      "  pipgm show <PiPGM1|PiPGM2|PiPGM3>\n" +
      "  pipgm orientation <pipelineId> <landscape|portrait>\n" +
      "  pipgm next <pipelineId>\n" +
      "  pipgm prev <pipelineId>\n" +
      "  pipgm ftb <pipelineId> <on|off|toggle>\n" +
      "  pipgm audio <pipelineId> <on|off|toggle>\n" +
      "  pipgm link <pipelineId> <on|off>\n" +
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

  // PiPGM commands
  if (group === "pipgm" && action === "list" && options.command.length === 2) {
    const data = await PiPgmService.listPiPgmPipelines(true);
    if (options.json) console.log(JSON.stringify(data.items, null, 2));
    else {
      printTable(
        ["ID", "ORIENTATION", "HIDDEN", "STATE", "FTB", "AUDIO", "LINKED", "STEP", "MOBILE SIGN"],
        data.items.map((p) => [
          p.id,
          `${p.orientation} (${p.resolution.width}x${p.resolution.height})`,
          p.hidden ? "yes" : "no",
          p.state,
          p.fadeToBlack ? "BLACKOUT" : "live",
          p.audioEnabled ? `ON (${p.volume}%)` : "MUTED",
          p.linked ? "linked" : "-",
          p.totalSteps > 0 ? `${p.currentStep + 1}/${p.totalSteps}` : "-",
          p.mobileAlert.signCode
        ])
      );
    }
    return;
  }

  if (group === "pipgm" && action === "show" && options.command.length === 3) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    const p = await PiPgmService.getPiPgmPipeline(arg1 as PiPgmPipelineId);
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else {
      console.log(`Pipeline:    ${p.id} (${p.label})`);
      console.log(`Hidden:      ${p.hidden ? "yes" : "no"}`);
      console.log(`Orientation: ${p.orientation} (${p.resolution.width}x${p.resolution.height})`);
      console.log(`State:       ${p.state}`);
      console.log(`FTB:         ${p.fadeToBlack ? "ACTIVE (FADED TO BLACK)" : "off"}`);
      console.log(`Audio:       ${p.audioEnabled ? `ENABLED (${p.volume}%)` : "MUTED (default)"}`);
      console.log(`Linked:      ${p.linked ? "yes" : "no"}`);
      console.log(`Mobile Sign: ${p.mobileAlert.signCode}${p.mobileAlert.bannerText ? ` — ${p.mobileAlert.bannerText}` : ""}`);
      console.log(`Step:        ${p.totalSteps > 0 ? `${p.currentStep + 1}/${p.totalSteps}` : "none"}`);
      console.log(`Stage URL:   ${p.stageUrl}`);
    }
    return;
  }

  if (group === "pipgm" && action === "orientation" && options.command.length === 4) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    if (arg2 !== "landscape" && arg2 !== "portrait") throw new Error("Orientation must be 'landscape' or 'portrait'");
    const p = await PiPgmService.updatePiPgmPipelineConfig(arg1 as PiPgmPipelineId, {
      orientation: arg2 as unknown as PiPgmOrientation
    });
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else console.log(`${p.id} orientation set to ${p.orientation} (${p.resolution.width}x${p.resolution.height})`);
    return;
  }

  if (group === "pipgm" && (action === "next" || action === "prev") && options.command.length === 3) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    const p = await PiPgmService.controlPiPgmPipeline(arg1 as PiPgmPipelineId, {
      action: action as unknown as PiPgmControlRequest.action
    });
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else console.log(`${p.id} ${action} -> step ${p.currentStep + 1}/${p.totalSteps}`);
    return;
  }

  if (group === "pipgm" && action === "ftb" && options.command.length === 4) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    if (!["on", "off", "toggle"].includes(arg2 ?? "")) throw new Error("FTB mode must be 'on', 'off', or 'toggle'");
    const p = await PiPgmService.setPiPgmFadeToBlack(arg1 as PiPgmPipelineId, {
      toggle: arg2 === "toggle",
      ...(arg2 !== "toggle" ? { fadeToBlack: arg2 === "on" } : {})
    });
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else console.log(`${p.id} Fade to Black: ${p.fadeToBlack ? "ON (FADED TO BLACK)" : "OFF"}`);
    return;
  }

  if (group === "pipgm" && action === "audio" && options.command.length === 4) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    if (!["on", "off", "toggle"].includes(arg2 ?? "")) throw new Error("Audio mode must be 'on', 'off', or 'toggle'");
    const p = await PiPgmService.setPiPgmAudio(arg1 as PiPgmPipelineId, {
      toggle: arg2 === "toggle",
      ...(arg2 !== "toggle" ? { audioEnabled: arg2 === "on" } : {})
    });
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else console.log(`${p.id} Audio: ${p.audioEnabled ? `ENABLED (${p.volume}%)` : "MUTED"}`);
    return;
  }

  if (group === "pipgm" && action === "link" && options.command.length === 4) {
    if (!pipgmIds.includes(arg1 as PiPgmPipelineId)) throw new Error(`Unknown PiPGM pipeline: ${arg1}`);
    if (!["on", "off"].includes(arg2 ?? "")) throw new Error("Link mode must be 'on' or 'off'");
    const p = await PiPgmService.updatePiPgmPipelineConfig(arg1 as PiPgmPipelineId, {
      linked: arg2 === "on"
    });
    if (options.json) console.log(JSON.stringify(p, null, 2));
    else console.log(`${p.id} Link Sync: ${p.linked ? "ON" : "OFF"}`);
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

try {
  await run(parseArgs(process.argv.slice(2)));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`pimatrix: ${message}`);
  process.exitCode = 1;
}
