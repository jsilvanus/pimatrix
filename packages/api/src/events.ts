import { EventEmitter } from "node:events";
import type { EffectsPipeline } from "./effects/effects-model.js";
import type { OutputSnapshot, SourceId, SourceState } from "./model.js";
import type { CompositeStatus } from "./composite/composite-model.js";

export interface SourceEventPayload {
  id: SourceId;
  label: string;
  kind: string;
  state: SourceState;
  preview: {
    available: boolean;
    url: string | null;
  };
}

export interface OutputEventPayload {
  output: OutputSnapshot;
}

export interface StreamEventPayload {
  stream: string;
  state: string;
  jobId: string | null;
  attempt: number;
}

export interface CameraEventPayload {
  id: string;
  action: string;
  streaming?: boolean;
  presetId?: number;
  thumbnail?: string;
  smartFrame?: string;
  privacyBlur?: boolean;
  focusMode?: string;
  position?: { pan: number; tilt: number; zoom: number };
}

export interface EffectsEventPayload {
  sourceId: SourceId;
  effects: EffectsPipeline;
}

export interface MatrixEventPayload {
  locked: boolean;
  routes: Record<number, number | null>;
  lastChange?: { input: number; output: number };
}

export interface RtspOutEventPayload {
  sourceId: string;
  layout?: string;
  url: string;
  streaming?: boolean;
  quality?: "preview" | "full";
  resolution?: string;
  bitrateKbps?: number;
}

export interface CompositeEventPayload {
  composite: CompositeStatus;
}

export type PiMatrixEvent =
  | { type: "source"; data: SourceEventPayload }
  | { type: "output"; data: OutputEventPayload }
  | { type: "stream"; data: StreamEventPayload }
  | { type: "camera"; data: CameraEventPayload }
  | { type: "effects"; data: EffectsEventPayload }
  | { type: "matrix"; data: MatrixEventPayload }
  | { type: "rtsp"; data: RtspOutEventPayload }
  | { type: "composite"; data: CompositeEventPayload }
  | { type: "atem"; data: unknown }
  | { type: "program"; data: { on: boolean } }
  | { type: "ready"; data: { status: string; time: string } };

export class PiMatrixEventBroker {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: PiMatrixEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: PiMatrixEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  listenerCount(): number {
    return this.emitter.listenerCount("event");
  }
}
