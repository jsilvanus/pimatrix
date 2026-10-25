/**
 * Slide composite settings: a slide-only overlay frame (no video input, no audio).
 *
 * Two composites exist. `compose1` is the HDMI key output (a full-frame page with the
 * slide at one edge and the rest in a key colour, sent to a Pi HDMI output for the ATEM
 * chroma or luma keyer). `compose2` is the ATEM media-pool output (the same slide as a
 * PNG-with-alpha still, uploaded to a media slot and driven on a DSK). The output kind is
 * fixed per id so that a composite's job never changes under the operator.
 */

export const COMPOSITE_IDS = ["compose1", "compose2"] as const;
export type CompositeId = (typeof COMPOSITE_IDS)[number];

export type CompositeOutputKind = "hdmi-key" | "atem-media";
export type CompositeSide = "left" | "right";
export type SlideAspect = "10:16" | "9:16";
export type KeyMode = "chroma" | "luma";
/** Where the slide comes from: a PUT of a PNG (default) or a piprogram pipeline's frame. */
export type SlideSource = "upload" | "piprogram";
export type PiprogramPipelineId = "PiPGM1" | "PiPGM2" | "PiPGM3";
export const PIPROGRAM_PIPELINE_IDS = ["PiPGM1", "PiPGM2", "PiPGM3"] as const;

export interface CompositeAtemSettings {
  /** ATEM media pool still slot the slide is uploaded to (1-based, 1..64). */
  mediaSlot: number;
  /** ATEM media player that feeds the DSK (1-based). */
  mediaPlayer: number;
  /** ATEM downstream keyer (1-based, 1..4). */
  dskIndex: number;
  /** Put the DSK on air after an upload. Default off: the operator decides. */
  autoOnAir: boolean;
}

export interface CompositeSettings {
  id: CompositeId;
  kind: CompositeOutputKind;
  enabled: boolean;
  width: number;
  height: number;
  side: CompositeSide;
  slideAspect: SlideAspect;
  /** Slide height as a fraction of the frame height. */
  slideScale: number;
  /** Background colour of the HDMI key page, "#rrggbb". Ignored by luma and atem-media. */
  keyColor: string;
  keyMode: KeyMode;
  atem: CompositeAtemSettings;
  /** Slide source. "piprogram" follows the frame of `pipelineId` as its slide changes. */
  slideSource: SlideSource;
  /** The piprogram pipeline this composite follows (used when slideSource is "piprogram"). */
  pipelineId: PiprogramPipelineId;
}

/** Fields a client may change. Missing fields keep their current value. */
export interface CompositePatch {
  enabled?: boolean;
  width?: number;
  height?: number;
  side?: CompositeSide;
  slideAspect?: SlideAspect;
  slideScale?: number;
  keyColor?: string;
  keyMode?: KeyMode;
  atem?: Partial<CompositeAtemSettings>;
  slideSource?: SlideSource;
  pipelineId?: PiprogramPipelineId;
}

export type CompositeValidation =
  | { ok: true; patch: CompositePatch }
  | { ok: false; message: string };

export const MIN_SLIDE_SCALE = 0.6;
export const MAX_SLIDE_SCALE = 1;
export const MIN_FRAME_SIDE = 16;
export const MAX_FRAME_SIDE = 3840;
export const DEFAULT_KEY_COLOR = "#00ff00";

const PATCH_KEYS = new Set([
  "enabled", "width", "height", "side", "slideAspect", "slideScale", "keyColor", "keyMode", "atem",
  "slideSource", "pipelineId"
]);
const ATEM_KEYS = new Set(["mediaSlot", "mediaPlayer", "dskIndex", "autoOnAir"]);

export function outputKindFor(id: CompositeId): CompositeOutputKind {
  return id === "compose2" ? "atem-media" : "hdmi-key";
}

export function defaultCompositeSettings(id: CompositeId): CompositeSettings {
  return {
    id,
    kind: outputKindFor(id),
    enabled: false,
    width: 1920,
    height: 1080,
    side: "left",
    slideAspect: "10:16",
    slideScale: 1,
    keyColor: DEFAULT_KEY_COLOR,
    keyMode: "chroma",
    atem: { mediaSlot: 1, mediaPlayer: 1, dskIndex: 1, autoOnAir: false },
    slideSource: "upload",
    pipelineId: "PiPGM1"
  };
}

/** Normalises "#RRGGBB" to lower case; returns null when the value is not a hex colour. */
export function normaliseHexColour(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) return null;
  return value.toLowerCase();
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Validates an untrusted request body. Unknown fields are rejected so a misspelt
 * setting fails loudly instead of being ignored. The result is a typed patch.
 */
export function parseCompositePatch(input: unknown): CompositeValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "Body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!PATCH_KEYS.has(key)) return { ok: false, message: `Unknown field: ${key}` };
  }

  const patch: CompositePatch = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return { ok: false, message: "enabled must be a boolean" };
    patch.enabled = body.enabled;
  }

  for (const key of ["width", "height"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (!isInteger(value) || value % 2 !== 0 || value < MIN_FRAME_SIDE || value > MAX_FRAME_SIDE) {
      return { ok: false, message: `${key} must be an even integer between ${MIN_FRAME_SIDE} and ${MAX_FRAME_SIDE}` };
    }
    patch[key] = value;
  }

  if (body.side !== undefined) {
    if (body.side !== "left" && body.side !== "right") return { ok: false, message: "side must be left or right" };
    patch.side = body.side;
  }

  if (body.slideAspect !== undefined) {
    if (body.slideAspect !== "10:16" && body.slideAspect !== "9:16") {
      return { ok: false, message: "slideAspect must be 10:16 or 9:16" };
    }
    patch.slideAspect = body.slideAspect;
  }

  if (body.slideScale !== undefined) {
    const value = body.slideScale;
    if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_SLIDE_SCALE || value > MAX_SLIDE_SCALE) {
      return { ok: false, message: `slideScale must be a number between ${MIN_SLIDE_SCALE} and ${MAX_SLIDE_SCALE}` };
    }
    patch.slideScale = value;
  }

  if (body.keyColor !== undefined) {
    const colour = normaliseHexColour(body.keyColor);
    if (colour === null) return { ok: false, message: "keyColor must be a hex colour such as #00ff00" };
    patch.keyColor = colour;
  }

  if (body.keyMode !== undefined) {
    if (body.keyMode !== "chroma" && body.keyMode !== "luma") return { ok: false, message: "keyMode must be chroma or luma" };
    patch.keyMode = body.keyMode;
  }

  if (body.atem !== undefined) {
    const atem = parseAtemPatch(body.atem);
    if (!atem.ok) return atem;
    patch.atem = atem.patch;
  }

  if (body.slideSource !== undefined) {
    if (body.slideSource !== "upload" && body.slideSource !== "piprogram") {
      return { ok: false, message: "slideSource must be upload or piprogram" };
    }
    patch.slideSource = body.slideSource;
  }

  if (body.pipelineId !== undefined) {
    if (!PIPROGRAM_PIPELINE_IDS.includes(body.pipelineId as PiprogramPipelineId)) {
      return { ok: false, message: `pipelineId must be one of ${PIPROGRAM_PIPELINE_IDS.join(", ")}` };
    }
    patch.pipelineId = body.pipelineId as PiprogramPipelineId;
  }

  return { ok: true, patch };
}

function parseAtemPatch(input: unknown): { ok: true; patch: Partial<CompositeAtemSettings> } | { ok: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "atem must be an object" };
  }
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ATEM_KEYS.has(key)) return { ok: false, message: `Unknown atem field: ${key}` };
  }
  const patch: Partial<CompositeAtemSettings> = {};
  const ranges: Array<[keyof Omit<CompositeAtemSettings, "autoOnAir">, number, number]> = [
    ["mediaSlot", 1, 64],
    ["mediaPlayer", 1, 4],
    ["dskIndex", 1, 4]
  ];
  for (const [key, min, max] of ranges) {
    const value = body[key];
    if (value === undefined) continue;
    if (!isInteger(value) || value < min || value > max) {
      return { ok: false, message: `atem.${key} must be an integer between ${min} and ${max}` };
    }
    patch[key] = value;
  }
  if (body.autoOnAir !== undefined) {
    if (typeof body.autoOnAir !== "boolean") return { ok: false, message: "atem.autoOnAir must be a boolean" };
    patch.autoOnAir = body.autoOnAir;
  }
  return { ok: true, patch };
}

/** Applies a validated patch. Returns a new object; the current settings are not changed. */
export function applyCompositePatch(current: CompositeSettings, patch: CompositePatch): CompositeSettings {
  return {
    ...current,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.width !== undefined ? { width: patch.width } : {}),
    ...(patch.height !== undefined ? { height: patch.height } : {}),
    ...(patch.side !== undefined ? { side: patch.side } : {}),
    ...(patch.slideAspect !== undefined ? { slideAspect: patch.slideAspect } : {}),
    ...(patch.slideScale !== undefined ? { slideScale: patch.slideScale } : {}),
    ...(patch.keyColor !== undefined ? { keyColor: patch.keyColor } : {}),
    ...(patch.keyMode !== undefined ? { keyMode: patch.keyMode } : {}),
    ...(patch.slideSource !== undefined ? { slideSource: patch.slideSource } : {}),
    ...(patch.pipelineId !== undefined ? { pipelineId: patch.pipelineId } : {}),
    atem: { ...current.atem, ...(patch.atem ?? {}) }
  };
}

/** What the service is doing for one composite, reported next to its settings. */
export type CompositeRunState = "stopped" | "waiting" | "busy" | "running" | "failed";

export interface CompositeStatus extends CompositeSettings {
  state: CompositeRunState;
  /** Why the last apply failed, or null. */
  lastError: string | null;
  /** True once a slide has been sent. Without one, an enabled composite waits. */
  hasSlide: boolean;
  /** Why the last piprogram frame fetch failed, or null. */
  feedError: string | null;
  /** ISO time of the last state change. */
  updatedAt: string;
}

/** The fields that change the picture (or the ATEM still) and so need a re-render. */
export function renderSignature(settings: CompositeSettings): string {
  return JSON.stringify([
    settings.kind,
    settings.width,
    settings.height,
    settings.side,
    settings.slideAspect,
    settings.slideScale,
    settings.keyColor,
    settings.keyMode,
    settings.kind === "atem-media" ? settings.atem.mediaSlot : null,
    settings.kind === "atem-media" ? settings.atem.mediaPlayer : null,
    settings.kind === "atem-media" ? settings.atem.dskIndex : null
  ]);
}
