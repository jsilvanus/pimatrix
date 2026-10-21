import { EventEmitter } from "node:events";
import type { OutputSnapshot, SourceId, SourceState } from "./model.js";

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
  smartFrame?: string;
  position?: { pan: number; tilt: number; zoom: number };
}

export type PiMatrixEvent =
  | { type: "source"; data: SourceEventPayload }
  | { type: "output"; data: OutputEventPayload }
  | { type: "stream"; data: StreamEventPayload }
  | { type: "camera"; data: CameraEventPayload }
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
