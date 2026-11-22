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

/**
 * inspectMediaMtx behind a short cache. Calls within `cacheMs` of the last answer reuse it, and
 * calls while a fetch is running share that fetch. 0 turns the cache off (every call fetches).
 * Nothing else invalidates it: a path that becomes ready shows up within `cacheMs`.
 */
export function createMediaMtxInspector(
  apiUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  cacheMs = 1000,
  now: () => number = Date.now
): () => Promise<MediaMtxSnapshot> {
  if (!apiUrl || cacheMs <= 0) return () => inspectMediaMtx(apiUrl, fetchImpl);
  let cached: { at: number; value: MediaMtxSnapshot } | null = null;
  let pending: Promise<MediaMtxSnapshot> | null = null;
  return () => {
    if (pending) return pending;
    if (cached && now() - cached.at < cacheMs) return Promise.resolve(cached.value);
    pending = inspectMediaMtx(apiUrl, fetchImpl)
      .then((value) => {
        cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
