export interface MediaMtxSnapshot {
  configured: boolean;
  connected: boolean;
  readyPaths: ReadonlySet<string>;
}

interface MediaMtxPath {
  name?: unknown;
  ready?: unknown;
}

interface MediaMtxPathList {
  items?: unknown;
}

export async function inspectMediaMtx(
  apiUrl: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<MediaMtxSnapshot> {
  if (!apiUrl) return { configured: false, connected: false, readyPaths: new Set() };

  try {
    const response = await fetchImpl(`${apiUrl}/v3/paths/list`, {
      signal: AbortSignal.timeout(1500),
      headers: { accept: "application/json" }
    });
    if (!response.ok) return { configured: true, connected: false, readyPaths: new Set() };

    const payload = await response.json() as MediaMtxPathList;
    if (!Array.isArray(payload.items)) {
      return { configured: true, connected: false, readyPaths: new Set() };
    }

    const readyPaths = new Set<string>();
    for (const item of payload.items as MediaMtxPath[]) {
      if (typeof item.name === "string" && item.ready === true) readyPaths.add(item.name);
    }
    return { configured: true, connected: true, readyPaths };
  } catch {
    return { configured: true, connected: false, readyPaths: new Set() };
  }
}
