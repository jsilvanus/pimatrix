import fs from "node:fs";
import path from "node:path";
import type { AppConfig, HamaVideoCodec } from "./config.js";

/** Hama capture fields that can be changed while pimatrix runs. A missing key means "use the env value". */
export interface HamaSettings {
  inputFormat?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  videoCodec?: HamaVideoCodec;
}

export type HamaSettingsPatch = { [K in keyof HamaSettings]?: HamaSettings[K] | null };

const CODECS: readonly string[] = ["copy", "libx264", "h264_v4l2m2m"];
const INPUT_FORMAT = /^[A-Za-z0-9_]{1,32}$/;

function dimension(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 16 || value > 7680) {
    throw new Error(`${name} must be an integer from 16 to 7680`);
  }
  return value;
}

/** Validates a patch; returns the cleaned patch or throws an Error with a readable message. */
export function parseHamaPatch(body: unknown): HamaSettingsPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("Body must be a JSON object");
  const input = body as Record<string, unknown>;
  const allowed = ["inputFormat", "width", "height", "frameRate", "videoCodec"];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new Error(`Unknown setting: ${key}`);
  }
  const patch: HamaSettingsPatch = {};
  if ("inputFormat" in input) {
    const v = input.inputFormat;
    if (v === null || v === "") patch.inputFormat = null;
    else if (typeof v === "string" && INPUT_FORMAT.test(v)) patch.inputFormat = v;
    else throw new Error("inputFormat must be a V4L2 format name such as mjpeg or yuyv422");
  }
  if ("width" in input) patch.width = input.width === null ? null : dimension(input.width, "width");
  if ("height" in input) patch.height = input.height === null ? null : dimension(input.height, "height");
  if ("frameRate" in input) {
    const v = input.frameRate;
    if (v === null) patch.frameRate = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 120) patch.frameRate = v;
    else throw new Error("frameRate must be an integer from 1 to 120");
  }
  if ("videoCodec" in input) {
    const v = input.videoCodec;
    if (v === null) patch.videoCodec = null;
    else if (typeof v === "string" && CODECS.includes(v)) patch.videoCodec = v as HamaVideoCodec;
    else throw new Error('videoCodec must be "copy", "libx264" or "h264_v4l2m2m"');
  }
  return patch;
}

/** Runtime overrides for the Hama capture, saved to a JSON file so they survive a restart. */
export class HamaSettingsStore {
  private settings: HamaSettings = {};

  constructor(private readonly file: string | undefined) {
    if (!file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      const patch = parseHamaPatch(raw);
      this.settings = this.merge({}, patch);
    } catch {
      this.settings = {};
    }
  }

  get(): HamaSettings {
    return { ...this.settings };
  }

  /** width and height must end up both set or both unset (checked against the effective config by the caller). */
  update(patch: HamaSettingsPatch): HamaSettings {
    this.settings = this.merge(this.settings, patch);
    this.save();
    return this.get();
  }

  reset(): void {
    this.settings = {};
    this.save();
  }

  /** The config with the overrides applied (optionally with a patch applied first, without saving it). */
  effective(config: AppConfig, patch?: HamaSettingsPatch): AppConfig {
    const s = patch ? this.merge(this.settings, patch) : this.settings;
    return {
      ...config,
      ...(s.inputFormat !== undefined ? { hamaInputFormat: s.inputFormat } : {}),
      ...(s.width !== undefined ? { hamaWidth: s.width } : {}),
      ...(s.height !== undefined ? { hamaHeight: s.height } : {}),
      ...(s.frameRate !== undefined ? { hamaFrameRate: s.frameRate } : {}),
      ...(s.videoCodec !== undefined ? { hamaVideoCodec: s.videoCodec } : {})
    };
  }

  private merge(base: HamaSettings, patch: HamaSettingsPatch): HamaSettings {
    const next: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) delete next[key];
      else next[key] = value;
    }
    return next as HamaSettings;
  }

  private save(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.settings, null, 2));
    fs.renameSync(temp, this.file);
  }
}
