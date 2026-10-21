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
  { id: "hdmi1", label: "Pi 2" }
] as const;

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
    { ...output, desiredSource: null, observedSource: null, state: "unavailable" }
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
