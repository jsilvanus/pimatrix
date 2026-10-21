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

export function getSources(readyMediaPaths: ReadonlySet<string> = new Set(), previewBaseUrl?: string) {
  return sourceDefinitions.map((source) => {
    const live = readyMediaPaths.has(source.id);
    return {
      ...source,
      state: live ? "live" as const : "unavailable" as const,
      preview: {
        available: live && Boolean(previewBaseUrl),
        url: live && previewBaseUrl ? `${previewBaseUrl}/${encodeURIComponent(source.id)}` : null
      }
    };
  });
}

export function getOutputs() {
  return outputDefinitions.map((output) => ({
    ...output,
    desiredSource: null,
    observedSource: null,
    state: "unavailable" as const
  }));
}
