import type { PiPgmMobileSignCode, PiPgmOrientation } from "./pipgm/pipgm-model.js";

export const sourceDefinitions = [
  { id: "hama", label: "Hama capture", kind: "capture", defaultHidden: false },
  // NOTE: Future `hama2` virtual/duplicate source will be added here so we can send
  // the uncropped `hama` signal to one destination and `hama2` (as cropped) to another.
  { id: "rtmp1", label: "RTMP 1", kind: "rtmp", defaultHidden: false },
  { id: "rtmp2", label: "RTMP 2", kind: "rtmp", defaultHidden: false },
  { id: "cam1", label: "Camera 1", kind: "camera", defaultHidden: false },
  { id: "cam2", label: "Camera 2", kind: "camera", defaultHidden: false },
  { id: "cam3", label: "Camera 3", kind: "camera", defaultHidden: false },
  // compose1 is the composite key page, published to MediaMTX by the composite service.
  { id: "compose1", label: "Composite 1", kind: "composite", defaultHidden: false },
  { id: "PiPGM1", label: "Pi Programme 1", kind: "renderer", defaultHidden: false },
  { id: "PiPGM2", label: "Pi Programme 2", kind: "renderer", defaultHidden: false },
  { id: "PiPGM3", label: "Pi Programme 3", kind: "renderer", defaultHidden: true }
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

/**
 * Priority order of slots that PiPGM3 can automatically replace when active/unhidden
 * and the candidate slot is not currently live (cam3 is first since it is usually not sent via RTMP).
 */
export const multiviewReplaceablePriority: SourceId[] = [
  "cam3",
  "rtmp2",
  "rtmp1",
  "hama",
  "cam2",
  "cam1"
];

export type MultiviewLayoutMode = "auto" | "landscape" | "portrait";

export interface MultiviewTilePiPgmStatus {
  orientation: PiPgmOrientation;
  fadeToBlack: boolean;
  audioEnabled: boolean;
  signCode: PiPgmMobileSignCode;
  cuedSummary: string | null;
}

export interface MultiviewTile {
  index: number;
  sourceId: SourceId;
  replacedSourceId?: SourceId | null;
  label: string;
  kind: string;
  state: SourceState;
  preview: {
    available: boolean;
    url: string | null;
  };
  pipgm?: MultiviewTilePiPgmStatus;
}

export interface MultiviewSnapshot {
  id: "multiview";
  label: string;
  layout: MultiviewLayoutMode;
  landscape: { columns: number; rows: number };
  portrait: { columns: number; rows: number };
  tiles: MultiviewTile[];
}

export interface MultiviewOptions {
  slotOverrides?: ReadonlyMap<number, SourceId>;
  pipgm3AutoReplace?: boolean;
  pipgmStatusById?: ReadonlyMap<string, MultiviewTilePiPgmStatus>;
}

export function getMultiview(
  sources: Array<{
    id: SourceId;
    label: string;
    kind: string;
    state: SourceState;
    preview: { available: boolean; url: string | null };
  }>,
  layout: MultiviewLayoutMode = "auto",
  options: MultiviewOptions = {}
): MultiviewSnapshot {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const effectiveOrder: Array<{ sourceId: SourceId; replacedSourceId: SourceId | null }> =
    multiviewSourceOrder.map((id, idx) => {
      const override = options.slotOverrides?.get(idx);
      if (override && override !== id) {
        return { sourceId: override, replacedSourceId: id };
      }
      return { sourceId: id, replacedSourceId: null };
    });

  // If PiPGM3 is live or flagged for auto-replacement and not already in the 8 slots,
  // replace the first non-live candidate in priority order (starting with cam3).
  const pipgm3Source = sourceMap.get("PiPGM3");
  const shouldAutoIncludePiPgm3 =
    options.pipgm3AutoReplace === true || pipgm3Source?.state === "live";

  if (
    shouldAutoIncludePiPgm3 &&
    !effectiveOrder.some((slot) => slot.sourceId === "PiPGM3")
  ) {
    for (const candidateId of multiviewReplaceablePriority) {
      const slotIdx = effectiveOrder.findIndex(
        (slot) => slot.sourceId === candidateId && slot.replacedSourceId === null
      );
      if (slotIdx >= 0) {
        const candidateSource = sourceMap.get(candidateId);
        if (!candidateSource || candidateSource.state !== "live") {
          effectiveOrder[slotIdx] = {
            sourceId: "PiPGM3",
            replacedSourceId: candidateId
          };
          break;
        }
      }
    }
  }

  const tiles: MultiviewTile[] = effectiveOrder.map((slot, index) => {
    const s = sourceMap.get(slot.sourceId);
    const defaultDef = sourceDefinitions.find((d) => d.id === slot.sourceId);
    const pipgmMeta = options.pipgmStatusById?.get(slot.sourceId);

    return {
      index,
      sourceId: slot.sourceId,
      ...(slot.replacedSourceId ? { replacedSourceId: slot.replacedSourceId } : {}),
      label: s?.label ?? defaultDef?.label ?? slot.sourceId,
      kind: s?.kind ?? defaultDef?.kind ?? "unknown",
      state: s?.state ?? "unavailable",
      preview: s?.preview ?? { available: false, url: null },
      ...(pipgmMeta ? { pipgm: pipgmMeta } : {})
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

export function getSources(
  readyMediaPaths: ReadonlySet<string> = new Set(),
  previewBaseUrl?: string,
  options: { includeHidden?: boolean; unhiddenIds?: ReadonlySet<string> } = {}
) {
  return sourceDefinitions
    .filter((source) => {
      if (!source.defaultHidden) return true;
      if (options.includeHidden) return true;
      if (options.unhiddenIds?.has(source.id)) return true;
      if (readyMediaPaths.has(source.id)) return true;
      return false;
    })
    .map((source) => {
      const live = readyMediaPaths.has(source.id);
      return {
        id: source.id,
        label: source.label as string,
        kind: source.kind,
        hidden: source.defaultHidden && !options.unhiddenIds?.has(source.id),
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
