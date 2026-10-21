import type { OutputId, SourceId } from "./model.js";

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

export function createDisplayAdapter(mode: "simulated" | "hardware" | "disabled"): DisplayAdapter {
  if (mode === "simulated") return new SimulatedDisplayAdapter();
  return new DisabledDisplayAdapter();
}
