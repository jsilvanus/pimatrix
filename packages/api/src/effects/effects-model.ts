import type { SourceId } from "../model.js";

export type AspectRatioPreset = "16:9" | "9:16" | "16:10" | "10:16" | "4:3" | "1:1" | "free";

export type CropPresetAction =
  | "force-vertical-9-16"
  | "force-vertical-10-16"
  | "force-landscape-16-9"
  | "force-landscape-16-10"
  | "center"
  | "reset";

export type MoveDirection = "left" | "right" | "up" | "down" | "center";

export type RotationDegrees = 0 | 90 | 180 | 270;

export interface CropSettings {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  aspectRatio: AspectRatioPreset;
  lockedAspectRatio: boolean;
}

export interface EffectsPipeline {
  sourceId: SourceId;
  crop: CropSettings;
  rotation: RotationDegrees;
  ffmpegFilter: string;
}

function makeEven(value: number): number {
  return Math.round(value / 2) * 2;
}

export function buildFfmpegFilter(crop: CropSettings, rotation: RotationDegrees): string {
  const parts: string[] = [];

  if (crop.enabled) {
    const w = makeEven(crop.width);
    const h = makeEven(crop.height);
    const x = makeEven(crop.x);
    const y = makeEven(crop.y);
    parts.push(`crop=${w}:${h}:${x}:${y}`);
  }

  if (rotation === 90) {
    parts.push("transpose=1");
  } else if (rotation === 180) {
    parts.push("hflip,vflip");
  } else if (rotation === 270) {
    parts.push("transpose=2");
  }

  return parts.length > 0 ? parts.join(",") : "null";
}

export function defaultCropSettings(sourceWidth = 1920, sourceHeight = 1080): CropSettings {
  return {
    enabled: false,
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
    sourceWidth,
    sourceHeight,
    aspectRatio: "16:9",
    lockedAspectRatio: false
  };
}

export function clampCropSettings(
  input: Partial<CropSettings>,
  current: CropSettings
): CropSettings {
  const sourceWidth = input.sourceWidth ?? current.sourceWidth ?? 1920;
  const sourceHeight = input.sourceHeight ?? current.sourceHeight ?? 1080;

  let width = input.width !== undefined ? makeEven(input.width) : current.width;
  let height = input.height !== undefined ? makeEven(input.height) : current.height;

  width = Math.max(16, Math.min(width, sourceWidth));
  height = Math.max(16, Math.min(height, sourceHeight));

  const aspectRatio = input.aspectRatio ?? current.aspectRatio;
  const lockedAspectRatio = input.lockedAspectRatio !== undefined ? input.lockedAspectRatio : current.lockedAspectRatio;

  let x = input.x !== undefined ? makeEven(input.x) : current.x;
  let y = input.y !== undefined ? makeEven(input.y) : current.y;

  x = Math.max(0, Math.min(x, sourceWidth - width));
  y = Math.max(0, Math.min(y, sourceHeight - height));

  const enabled = input.enabled !== undefined ? input.enabled : current.enabled;

  return {
    enabled,
    x,
    y,
    width,
    height,
    sourceWidth,
    sourceHeight,
    aspectRatio,
    lockedAspectRatio
  };
}

export function applyCropPreset(current: CropSettings, preset: CropPresetAction): CropSettings {
  const sw = current.sourceWidth;
  const sh = current.sourceHeight;

  switch (preset) {
    case "force-vertical-9-16": {
      // 9:16 vertical crop fitted to full height
      const height = sh;
      const width = makeEven((height * 9) / 16);
      const x = makeEven((sw - width) / 2);
      const y = 0;
      return {
        ...current,
        enabled: true,
        x,
        y,
        width,
        height,
        aspectRatio: "9:16",
        lockedAspectRatio: true
      };
    }
    case "force-vertical-10-16": {
      // 10:16 vertical crop matching Epson church projectors (1200x1920 native rotated)
      const height = sh;
      const width = makeEven((height * 10) / 16);
      const x = makeEven((sw - width) / 2);
      const y = 0;
      return {
        ...current,
        enabled: true,
        x,
        y,
        width,
        height,
        aspectRatio: "10:16",
        lockedAspectRatio: true
      };
    }
    case "force-landscape-16-9": {
      return {
        ...current,
        enabled: true,
        x: 0,
        y: 0,
        width: sw,
        height: sh,
        aspectRatio: "16:9",
        lockedAspectRatio: true
      };
    }
    case "force-landscape-16-10": {
      const height = sh;
      const width = makeEven((height * 16) / 10);
      const x = makeEven((sw - width) / 2);
      const y = 0;
      return {
        ...current,
        enabled: true,
        x,
        y,
        width,
        height,
        aspectRatio: "16:10",
        lockedAspectRatio: true
      };
    }
    case "center": {
      const x = makeEven((sw - current.width) / 2);
      const y = makeEven((sh - current.height) / 2);
      return {
        ...current,
        x: Math.max(0, Math.min(x, sw - current.width)),
        y: Math.max(0, Math.min(y, sh - current.height))
      };
    }
    case "reset": {
      return {
        enabled: false,
        x: 0,
        y: 0,
        width: sw,
        height: sh,
        sourceWidth: sw,
        sourceHeight: sh,
        aspectRatio: "16:9",
        lockedAspectRatio: false
      };
    }
  }
}

export function moveCropRectangle(
  current: CropSettings,
  direction: MoveDirection,
  delta = 32
): CropSettings {
  const sw = current.sourceWidth;
  const sh = current.sourceHeight;
  const step = makeEven(delta);

  let newX = current.x;
  let newY = current.y;

  switch (direction) {
    case "left":
      newX = Math.max(0, current.x - step);
      break;
    case "right":
      newX = Math.min(sw - current.width, current.x + step);
      break;
    case "up":
      newY = Math.max(0, current.y - step);
      break;
    case "down":
      newY = Math.min(sh - current.height, current.y + step);
      break;
    case "center":
      newX = makeEven((sw - current.width) / 2);
      newY = makeEven((sh - current.height) / 2);
      break;
  }

  return {
    ...current,
    x: newX,
    y: newY
  };
}

export function resizeCropRectangle(
  current: CropSettings,
  action: "in" | "out",
  factor = 0.1
): CropSettings {
  const sw = current.sourceWidth;
  const sh = current.sourceHeight;
  const multiplier = action === "in" ? 1 - factor : 1 + factor;

  const currentCenterX = current.x + current.width / 2;
  const currentCenterY = current.y + current.height / 2;

  let newWidth = makeEven(current.width * multiplier);
  let newHeight = makeEven(current.height * multiplier);

  if (current.lockedAspectRatio) {
    const ratio = current.width / current.height;
    if (newWidth > sw || newHeight > sh) {
      if (ratio > sw / sh) {
        newWidth = sw;
        newHeight = makeEven(newWidth / ratio);
      } else {
        newHeight = sh;
        newWidth = makeEven(newHeight * ratio);
      }
    }
  }

  newWidth = Math.max(32, Math.min(newWidth, sw));
  newHeight = Math.max(32, Math.min(newHeight, sh));

  let newX = makeEven(currentCenterX - newWidth / 2);
  let newY = makeEven(currentCenterY - newHeight / 2);

  newX = Math.max(0, Math.min(newX, sw - newWidth));
  newY = Math.max(0, Math.min(newY, sh - newHeight));

  return {
    ...current,
    enabled: true,
    width: newWidth,
    height: newHeight,
    x: newX,
    y: newY
  };
}

export class EffectsStore {
  private readonly pipelines = new Map<SourceId, EffectsPipeline>();

  constructor(sourceIds: readonly SourceId[]) {
    for (const id of sourceIds) {
      const crop = defaultCropSettings();
      this.pipelines.set(id, {
        sourceId: id,
        crop,
        rotation: 0,
        ffmpegFilter: buildFfmpegFilter(crop, 0)
      });
    }
  }

  get(sourceId: SourceId): EffectsPipeline | undefined {
    const p = this.pipelines.get(sourceId);
    return p ? { ...p, crop: { ...p.crop } } : undefined;
  }

  list(): EffectsPipeline[] {
    return [...this.pipelines.values()].map((p) => ({ ...p, crop: { ...p.crop } }));
  }

  updateCrop(sourceId: SourceId, updates: Partial<CropSettings>): EffectsPipeline | undefined {
    const current = this.pipelines.get(sourceId);
    if (!current) return undefined;

    const clamped = clampCropSettings(updates, current.crop);
    const updated: EffectsPipeline = {
      ...current,
      crop: clamped,
      ffmpegFilter: buildFfmpegFilter(clamped, current.rotation)
    };
    this.pipelines.set(sourceId, updated);
    return { ...updated, crop: { ...updated.crop } };
  }

  applyPreset(sourceId: SourceId, preset: CropPresetAction): EffectsPipeline | undefined {
    const current = this.pipelines.get(sourceId);
    if (!current) return undefined;

    const crop = applyCropPreset(current.crop, preset);
    const updated: EffectsPipeline = {
      ...current,
      crop,
      ffmpegFilter: buildFfmpegFilter(crop, current.rotation)
    };
    this.pipelines.set(sourceId, updated);
    return { ...updated, crop: { ...updated.crop } };
  }

  moveCrop(sourceId: SourceId, direction: MoveDirection, delta?: number): EffectsPipeline | undefined {
    const current = this.pipelines.get(sourceId);
    if (!current) return undefined;

    const crop = moveCropRectangle(current.crop, direction, delta);
    const updated: EffectsPipeline = {
      ...current,
      crop,
      ffmpegFilter: buildFfmpegFilter(crop, current.rotation)
    };
    this.pipelines.set(sourceId, updated);
    return { ...updated, crop: { ...updated.crop } };
  }

  resizeCrop(sourceId: SourceId, action: "in" | "out", factor?: number): EffectsPipeline | undefined {
    const current = this.pipelines.get(sourceId);
    if (!current) return undefined;

    const crop = resizeCropRectangle(current.crop, action, factor);
    const updated: EffectsPipeline = {
      ...current,
      crop,
      ffmpegFilter: buildFfmpegFilter(crop, current.rotation)
    };
    this.pipelines.set(sourceId, updated);
    return { ...updated, crop: { ...updated.crop } };
  }

  setRotation(sourceId: SourceId, rotation: RotationDegrees): EffectsPipeline | undefined {
    const current = this.pipelines.get(sourceId);
    if (!current) return undefined;

    const updated: EffectsPipeline = {
      ...current,
      rotation,
      ffmpegFilter: buildFfmpegFilter(current.crop, rotation)
    };
    this.pipelines.set(sourceId, updated);
    return { ...updated, crop: { ...updated.crop } };
  }
}
