export const sourceDefinitions = [
  { id: "hama", label: "Hama capture", kind: "capture" },
  { id: "rtmp1", label: "RTMP 1", kind: "rtmp" },
  { id: "rtmp2", label: "RTMP 2", kind: "rtmp" },
  { id: "cam1", label: "Camera 1", kind: "camera" },
  { id: "cam2", label: "Camera 2", kind: "camera" },
  { id: "cam3", label: "Camera 3", kind: "camera" },
  { id: "PiPGM1", label: "Pi Programme 1", kind: "renderer" },
  { id: "PiPGM2", label: "Pi Programme 2", kind: "renderer" }
] as const;

export const outputDefinitions = [
  { id: "hdmi0", label: "Pi 1" },
  { id: "hdmi1", label: "Pi 2" },
  { id: "multiview", label: "Multiview" }
] as const;

export const multiviewSourceOrder: SourceId[] = [
  "cam1",
  "cam2",
  "cam3",
  "hama",
  "rtmp1",
  "rtmp2",
  "PiPGM1",
  "PiPGM2"
];

export type MultiviewLayoutMode = "auto" | "landscape" | "portrait";

export interface MultiviewTile {
  index: number;
  sourceId: SourceId;
  label: string;
  kind: string;
  state: SourceState;
  preview: {
    available: boolean;
    url: string | null;
  };
}

export interface MultiviewSnapshot {
  id: "multiview";
  label: string;
  layout: MultiviewLayoutMode;
  landscape: { columns: number; rows: number };
  portrait: { columns: number; rows: number };
  tiles: MultiviewTile[];
}

export function getMultiview(
  sources: Array<{ id: SourceId; label: string; kind: string; state: SourceState; preview: { available: boolean; url: string | null } }>,
  layout: MultiviewLayoutMode = "auto"
): MultiviewSnapshot {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const tiles: MultiviewTile[] = multiviewSourceOrder.map((id, index) => {
    const s = sourceMap.get(id);
    return {
      index,
      sourceId: id,
      label: s?.label ?? id,
      kind: s?.kind ?? "unknown",
      state: s?.state ?? "unavailable",
      preview: s?.preview ?? { available: false, url: null }
    };
  });

  return {
    id: "multiview",
    label: "Multiview",
    layout,
    landscape: { columns: 4, rows: 2 },
    portrait: { columns: 2, rows: 4 },
    tiles
  };
}

export type SourceId = typeof sourceDefinitions[number]["id"];
export type OutputId = typeof outputDefinitions[number]["id"];
export type SourceState = "unavailable" | "starting" | "live" | "degraded" | "failed";

export interface OutputSnapshot {
  id: OutputId;
  label: string;
  desiredSource: SourceId | null;
  observedSource: SourceId | null;
  state: "unavailable" | "starting" | "active" | "failed";
}

export function getSources(readyMediaPaths: ReadonlySet<string> = new Set(), previewBaseUrl?: string) {
  return sourceDefinitions.map((source) => {
    const live = readyMediaPaths.has(source.id);
    return {
      ...source,
      state: (live ? "live" : "unavailable") as SourceState,
      preview: {
        available: live && Boolean(previewBaseUrl),
        url: live && previewBaseUrl ? `${previewBaseUrl}/${encodeURIComponent(source.id)}` : null
      }
    };
  });
}

export function createOutputStore() {
  const outputs = new Map<OutputId, OutputSnapshot>(outputDefinitions.map((output) => [
    output.id,
    {
      ...output,
      desiredSource: null,
      observedSource: null,
      state: output.id === "multiview" ? "active" : "unavailable"
    }
  ]));

  return {
    list(): OutputSnapshot[] {
      return [...outputs.values()].map((output) => ({ ...output }));
    },
    get(outputId: OutputId): OutputSnapshot | undefined {
      const output = outputs.get(outputId);
      return output ? { ...output } : undefined;
    },
    setDesiredSource(outputId: string, sourceId: SourceId | null): OutputSnapshot | undefined {
      if (!outputs.has(outputId as OutputId)) return undefined;
      const current = outputs.get(outputId as OutputId)!;
      const updated: OutputSnapshot = { ...current, desiredSource: sourceId };
      outputs.set(updated.id, updated);
      return { ...updated };
    },
    setObservedState(
      outputId: string,
      observedSource: SourceId | null,
      state: OutputSnapshot["state"]
    ): OutputSnapshot | undefined {
      if (!outputs.has(outputId as OutputId)) return undefined;
      const current = outputs.get(outputId as OutputId)!;
      const updated: OutputSnapshot = { ...current, observedSource, state };
      outputs.set(updated.id, updated);
      return { ...updated };
    }
  };
}

export type OutputStore = ReturnType<typeof createOutputStore>;
