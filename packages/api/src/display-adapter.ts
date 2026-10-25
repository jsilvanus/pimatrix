import type { OutputId, SourceId } from "./model.js";
import { HdmiPlayerAdapter } from "./hdmi-player-adapter.js";

export type DisplayAdapterState = "not-configured" | "simulated" | "ready" | "unavailable" | "failed";

export interface DisplayOutputState {
  id: OutputId;
  observedSource: SourceId | null;
  state: "unavailable" | "starting" | "active" | "failed";
  mode?: string;
}

export interface DisplayAdapter {
  getOutputState(outputId: OutputId): DisplayOutputState;
  applyRoute(outputId: OutputId, sourceId: SourceId | null): Promise<DisplayOutputState>;
  getStatus(): DisplayAdapterState;
  close(): Promise<void>;
}

export class SimulatedDisplayAdapter implements DisplayAdapter {
  private readonly outputs = new Map<OutputId, DisplayOutputState>([
    ["hdmi0", { id: "hdmi0", observedSource: null, state: "unavailable", mode: "1920x1080@60" }],
    ["hdmi1", { id: "hdmi1", observedSource: null, state: "unavailable", mode: "1920x1080@60" }],
    ["multiview", { id: "multiview", observedSource: null, state: "active", mode: "multiview-8way" }]
  ]);

  getOutputState(outputId: OutputId): DisplayOutputState {
    const current = this.outputs.get(outputId);
    if (!current) throw new Error(`Unknown output ID: ${outputId}`);
    return { ...current };
  }

  async applyRoute(outputId: OutputId, sourceId: SourceId | null): Promise<DisplayOutputState> {
    const current = this.outputs.get(outputId);
    if (!current) throw new Error(`Unknown output ID: ${outputId}`);
    const updated: DisplayOutputState = {
      ...current,
      observedSource: sourceId,
      state: sourceId ? "active" : "unavailable"
    };
    this.outputs.set(outputId, updated);
    return { ...updated };
  }

  getStatus(): DisplayAdapterState {
    return "simulated";
  }

  async close(): Promise<void> {
    // No-op for simulated display
  }
}

export class DisabledDisplayAdapter implements DisplayAdapter {
  getOutputState(outputId: OutputId): DisplayOutputState {
    return { id: outputId, observedSource: null, state: outputId === "multiview" ? "active" : "unavailable" };
  }

  async applyRoute(outputId: OutputId): Promise<DisplayOutputState> {
    return { id: outputId, observedSource: null, state: outputId === "multiview" ? "active" : "unavailable" };
  }

  getStatus(): DisplayAdapterState {
    return "not-configured";
  }

  async close(): Promise<void> {
    // No-op
  }
}

export interface HardwareDisplayConfig {
  hdmiPlayer?: string;
  hdmi0Device?: string;
  hdmi1Device?: string;
  hdmiSdlVideoDriver?: string;
  mediaMtxRtspUrl?: string;
}

export function createDisplayAdapter(
  mode: "simulated" | "hardware" | "disabled",
  hardware: HardwareDisplayConfig = {}
): DisplayAdapter {
  if (mode === "simulated") return new SimulatedDisplayAdapter();
  if (mode === "hardware") {
    // Both HDMI outputs are known; an output without a device is "not configured".
    const rtspBase = hardware.mediaMtxRtspUrl?.replace(/\/$/, "");
    return new HdmiPlayerAdapter({
      outputs: new Map<OutputId, { device?: string | undefined }>([
        ["hdmi0", { device: hardware.hdmi0Device }],
        ["hdmi1", { device: hardware.hdmi1Device }]
      ]),
      sourceUrl: (sourceId) => (rtspBase ? `${rtspBase}/${sourceId}` : undefined),
      ...(hardware.hdmiPlayer ? { player: hardware.hdmiPlayer } : {}),
      ...(hardware.hdmiSdlVideoDriver ? { sdlVideoDriver: hardware.hdmiSdlVideoDriver } : {})
    });
  }
  return new DisabledDisplayAdapter();
}
