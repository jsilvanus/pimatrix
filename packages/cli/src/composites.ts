/**
 * Helpers for the `composites` commands. Pure, so they are unit-tested without a server.
 * The API validates everything; these only turn command-line text into typed values.
 */

export const COMPOSITE_FIELDS = [
  "enabled", "width", "height", "side", "slideAspect", "slideScale", "offsetX", "offsetY", "keyColor", "keyMode",
  "atem.mediaSlot", "atem.mediaPlayer", "atem.dskIndex", "atem.autoOnAir", "slideSource", "pipelineId", "sourceId"
] as const;

const BOOLEAN_FIELDS = new Set(["enabled", "atem.autoOnAir"]);
const NUMBER_FIELDS = new Set(["width", "height", "slideScale", "offsetX", "offsetY", "atem.mediaSlot", "atem.mediaPlayer", "atem.dskIndex"]);

export type CompositePatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Builds the PUT body for `composites set <id> <field> <value>`. A dotted field such as
 * `atem.dskIndex` becomes a nested object. Values are read as booleans, numbers or text
 * according to the field; anything else is passed through for the API to reject.
 */
export function compositePatchFromField(field: string, value: string): CompositePatchResult {
  if (!(COMPOSITE_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, message: `Unknown composite field: ${field}. Fields: ${COMPOSITE_FIELDS.join(", ")}` };
  }
  let parsed: unknown = value;
  if (BOOLEAN_FIELDS.has(field)) {
    if (value !== "true" && value !== "false") return { ok: false, message: `${field} must be true or false` };
    parsed = value === "true";
  } else if (NUMBER_FIELDS.has(field)) {
    const number = Number(value);
    if (value.trim() === "" || !Number.isFinite(number)) return { ok: false, message: `${field} must be a number` };
    parsed = number;
  }
  const [head, tail] = field.split(".");
  if (tail) return { ok: true, patch: { [head as string]: { [tail]: parsed } } };
  return { ok: true, patch: { [field]: parsed } };
}

export interface CompositeRow {
  id: string;
  kind: string;
  enabled: boolean;
  state: string;
  side: string;
  slideAspect: string;
  slideScale: number;
  keyColor: string;
  keyMode: string;
  width: number;
  height: number;
  hasSlide: boolean;
  lastError: string | null;
}

/** One line per composite, for `composites list`. */
export function compositeTableRows(items: CompositeRow[]): string[][] {
  return items.map((item) => [
    item.id,
    item.kind,
    item.enabled ? "on" : "off",
    item.state,
    `${item.width}x${item.height}`,
    `${item.side} ${item.slideAspect} x${item.slideScale}`,
    item.kind === "hdmi-key" ? item.keyColor : "-",
    item.hasSlide ? "yes" : "no",
    item.lastError ?? ""
  ]);
}
