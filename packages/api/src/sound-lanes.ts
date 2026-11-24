/**
 * Which Pi HDMI output reaches a given Atlona output. The Pi's `hdmi0` and `hdmi1` are wired to fixed Atlona
 * inputs (hdmi0 -> input 3, hdmi1 -> input 4, see docs/atlona-pa-audio.md), and only the sound on Atlona
 * output 1 (the left projector) is taken into the PA. pimatrix knows that wiring; the route itself (which input
 * is on which output) is read from pigateway, which asks AMX. Putting the two together tells piprogram where
 * spoken sound can be heard, without piprogram hard-coding an HDMI output.
 */

export type PiOutputId = "hdmi0" | "hdmi1";
export const PI_OUTPUT_IDS: readonly PiOutputId[] = ["hdmi0", "hdmi1"];

export type AtlonaInputs = Record<PiOutputId, number>;

export const DEFAULT_ATLONA_INPUTS: AtlonaInputs = { hdmi0: 3, hdmi1: 4 };

/** Parses `hdmi0=3,hdmi1=4`. Inputs are whole numbers 1-8 and must differ. */
export function parseAtlonaInputs(text: string | undefined): AtlonaInputs {
  const inputs: AtlonaInputs = { ...DEFAULT_ATLONA_INPUTS };
  if (text && text.trim()) {
    for (const part of text.split(",")) {
      const [name, raw] = part.split("=").map((s) => s.trim());
      if (name !== "hdmi0" && name !== "hdmi1") throw new Error(`PIMATRIX_ATLONA_INPUTS: unknown Pi output "${name ?? ""}" (use hdmi0, hdmi1)`);
      const value = Number(raw);
      if (raw === undefined || raw === "" || !Number.isInteger(value) || value < 1 || value > 8) {
        throw new Error(`PIMATRIX_ATLONA_INPUTS: ${name} must be a whole number from 1 to 8`);
      }
      inputs[name] = value;
    }
  }
  if (inputs.hdmi0 === inputs.hdmi1) throw new Error("PIMATRIX_ATLONA_INPUTS: hdmi0 and hdmi1 must use different inputs");
  return inputs;
}

export interface SoundOutputReport {
  /** The Atlona output asked about (1 = the left projector, the PA lane, unless asked otherwise). */
  atlonaOutput: number;
  /** The Atlona input routed to it, or null when none is known. */
  input: number | null;
  /** The Pi HDMI output feeding that input, or null (unrouted, or fed by something that is not a Pi output). */
  hdmi: PiOutputId | null;
  /** The wiring used. */
  inputs: AtlonaInputs;
  /** The Atlona output whose sound reaches the PA. */
  paAtlonaOutput: number;
  /** Every Atlona output and the Pi HDMI feeding it, for any other use. */
  outputs: Record<string, PiOutputId | null>;
}

/** Pure: routes (Atlona output -> input) and the wiring in, the report out. */
export function soundOutputReport(
  routes: Record<string, number | null | undefined>,
  inputs: AtlonaInputs,
  paAtlonaOutput: number,
  atlonaOutput = paAtlonaOutput
): SoundOutputReport {
  const hdmiForInput = (input: number | null | undefined): PiOutputId | null =>
    input === inputs.hdmi0 ? "hdmi0" : input === inputs.hdmi1 ? "hdmi1" : null;
  const outputs: Record<string, PiOutputId | null> = {};
  for (const [out, input] of Object.entries(routes)) outputs[out] = hdmiForInput(input);
  const input = routes[String(atlonaOutput)];
  return {
    atlonaOutput,
    input: typeof input === "number" ? input : null,
    hdmi: hdmiForInput(input),
    inputs,
    paAtlonaOutput,
    outputs
  };
}
