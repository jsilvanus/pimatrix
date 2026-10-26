export interface MatrixRouteState {
  locked: boolean;
  routes: Record<number, number | null>;
}

export interface RtspOutState {
  sourceId: string;
  layout: "landscape" | "portrait";
  url: string;
  streaming: boolean;
  quality: "preview" | "full";
  resolution: string;
  bitrateKbps: number;
}
