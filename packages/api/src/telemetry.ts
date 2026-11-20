import os from "node:os";
import type { CompositeStatus } from "./composite/composite-model.js";
import type { OutputSnapshot } from "./model.js";

export const HARDWARE_FPS_BUDGET = 30;

export interface FpsContributor {
  id: string;
  label: string;
  kind: "capture" | "feed" | "composite" | "effects" | "output";
  encodeFps: number;
  decodeFps: number;
  detail?: string;
}

export interface FpsBudget {
  budgetFps: number;
  encodeFps: number;
  decodeFps: number;
  totalFps: number;
  encodePercent: number;
  decodePercent: number;
  contributors: FpsContributor[];
}

export interface FpsBudgetInput {
  hama: {
    active: boolean;
    fps?: number | undefined;
    inputFormat?: string | undefined;
    videoCodec?: string | undefined;
    hasFilter?: boolean | undefined;
  };
  activePipgmIds: string[];
  composites: Pick<CompositeStatus, "id" | "enabled" | "state" | "slideSource" | "sourceId">[];
  effectsRelays: string[];
  effectsSlates: string[];
  outputs: Pick<OutputSnapshot, "id" | "desiredSource" | "observedSource" | "state">[];
  budgetFps?: number;
}

const STILL_SOURCE_IDS = new Set(["PiPGM1", "PiPGM2", "PiPGM3"]);

// cam1 and cam2 ingest 720p5 substreams; other live sources default to 25 fps.
const SOURCE_DEFAULT_FPS: Record<string, number> = {
  cam1: 5,
  cam2: 5
};

function getLiveSourceFps(sourceId: string | null | undefined, hamaFps?: number): number {
  if (!sourceId) return 25;
  if (sourceId === "hama") {
    return hamaFps && hamaFps > 0 ? hamaFps : 25;
  }
  return SOURCE_DEFAULT_FPS[sourceId] ?? 25;
}

/**
 * Estimates active hardware encode and decode FPS load against the 1080p30 budget.
 */
export function computeFpsBudget(input: FpsBudgetInput): FpsBudget {
  const budgetFps = input.budgetFps ?? HARDWARE_FPS_BUDGET;
  const contributors: FpsContributor[] = [];

  if (input.hama.active) {
    const fps = input.hama.fps && input.hama.fps > 0 ? input.hama.fps : 25;
    const fmt = input.hama.inputFormat?.toLowerCase();
    const isMjpeg = fmt === "mjpeg" || fmt === "mjpg";
    const isCopy = input.hama.videoCodec === "copy" && !input.hama.hasFilter;
    const encodeFps = isCopy ? 0 : fps;
    const decodeFps = isMjpeg ? fps : 0;
    contributors.push({
      id: "hama",
      label: "hama",
      kind: "capture",
      encodeFps,
      decodeFps,
      detail: isCopy ? "copy" : (input.hama.videoCodec ?? "h264")
    });
  }

  for (const id of input.activePipgmIds) {
    contributors.push({
      id,
      label: id,
      kind: "feed",
      encodeFps: 1,
      decodeFps: 0,
      detail: "still"
    });
  }

  const composeById = new Map(input.composites.map((c) => [c.id, c]));
  for (const comp of input.composites) {
    if (!comp.enabled || comp.state !== "running") continue;
    const isLive = comp.slideSource === "source";
    const liveFps = isLive ? getLiveSourceFps(comp.sourceId, input.hama.fps) : 1;
    contributors.push({
      id: comp.id,
      label: comp.id,
      kind: "composite",
      encodeFps: isLive ? liveFps : 1,
      decodeFps: isLive ? liveFps : 0,
      detail: isLive ? (comp.sourceId ? `live (${comp.sourceId})` : "live") : `still (${comp.slideSource})`
    });
  }

  for (const sourceId of input.effectsRelays) {
    const fps = getLiveSourceFps(sourceId, input.hama.fps);
    contributors.push({
      id: `${sourceId}-fx`,
      label: `${sourceId}-fx`,
      kind: "effects",
      encodeFps: fps,
      decodeFps: fps,
      detail: "relay"
    });
  }

  for (const slatePath of input.effectsSlates) {
    contributors.push({
      id: slatePath,
      label: slatePath,
      kind: "effects",
      encodeFps: 10,
      decodeFps: 0,
      detail: "slate"
    });
  }

  for (const out of input.outputs) {
    if (out.id !== "hdmi0" && out.id !== "hdmi1") continue;
    if (out.state !== "active" && out.state !== "starting") continue;
    const src = out.observedSource ?? out.desiredSource;
    if (!src) continue;

    let decodeFps: number;
    let modeDetail: string;
    if (STILL_SOURCE_IDS.has(src)) {
      decodeFps = 1;
      modeDetail = "still";
    } else if (src === "compose1") {
      const comp = composeById.get("compose1");
      const isLive = comp?.slideSource === "source";
      decodeFps = isLive ? getLiveSourceFps(comp?.sourceId, input.hama.fps) : 1;
      modeDetail = isLive ? "live" : "still";
    } else {
      decodeFps = getLiveSourceFps(src, input.hama.fps);
      modeDetail = "live";
    }

    contributors.push({
      id: out.id,
      label: `${out.id}: ${src}`,
      kind: "output",
      encodeFps: 0,
      decodeFps,
      detail: modeDetail
    });
  }

  const encodeFps = contributors.reduce((sum, c) => sum + c.encodeFps, 0);
  const decodeFps = contributors.reduce((sum, c) => sum + c.decodeFps, 0);

  return {
    budgetFps,
    encodeFps,
    decodeFps,
    totalFps: encodeFps + decodeFps,
    encodePercent: Math.round((encodeFps / budgetFps) * 100),
    decodePercent: Math.round((decodeFps / budgetFps) * 100),
    contributors
  };
}

export interface SystemHostMetrics {
  cpuUsagePercent: number;
  cpuCores: number;
  loadAvg: number[];
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    processRssBytes: number;
  };
  uptimeSeconds: number;
}

function readCpuTotals(): { idle: number; total: number; cores: number } {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total, cores: cpus.length || 1 };
}

/**
 * Samples host CPU usage via `os.cpus()` tick deltas and memory usage via `os` + `process`.
 */
export function createSystemMetricsSampler(): () => SystemHostMetrics {
  let prev = readCpuTotals();

  return (): SystemHostMetrics => {
    const curr = readCpuTotals();
    const idleDelta = curr.idle - prev.idle;
    const totalDelta = curr.total - prev.total;
    prev = curr;

    const loadAvg = os.loadavg();
    let cpuUsagePercent: number;
    if (totalDelta > 0) {
      cpuUsagePercent = ((totalDelta - idleDelta) / totalDelta) * 100;
    } else {
      cpuUsagePercent = ((loadAvg[0] ?? 0) / curr.cores) * 100;
    }
    cpuUsagePercent = Math.round(Math.max(0, Math.min(100, cpuUsagePercent)) * 10) / 10;

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

    return {
      cpuUsagePercent,
      cpuCores: curr.cores,
      loadAvg: loadAvg.map((v) => Math.round(v * 100) / 100),
      memory: {
        totalBytes,
        freeBytes,
        usedBytes,
        usedPercent,
        processRssBytes: process.memoryUsage().rss
      },
      uptimeSeconds: Math.round(os.uptime())
    };
  };
}

export interface FleetWorkerInfo {
  id: string;
  status: "online" | "offline" | "unknown";
  slots?: Record<string, unknown> | undefined;
  activeJobs?: number | undefined;
  capabilities?: string[] | undefined;
  lastSeenAt?: string | undefined;
}

export function extractFleetWorkers(
  caps: Record<string, unknown> | null | undefined,
  workersBody?: unknown
): FleetWorkerInfo[] {
  const rawList = Array.isArray((workersBody as { workers?: unknown })?.workers)
    ? ((workersBody as { workers: unknown[] }).workers)
    : Array.isArray(workersBody)
      ? workersBody
      : Array.isArray((caps as { workers?: unknown })?.workers)
        ? ((caps as { workers: unknown[] }).workers)
        : [];

  return rawList
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, idx) => {
      const id = String(item.id ?? item.name ?? item.workerId ?? `worker-${idx + 1}`);
      const rawStatus = String(item.status ?? item.state ?? (item.online === false ? "offline" : item.online === true ? "online" : "online")).toLowerCase();
      const status: FleetWorkerInfo["status"] =
        rawStatus === "online" || rawStatus === "ready" || rawStatus === "connected" || rawStatus === "idle" || rawStatus === "busy"
          ? "online"
          : rawStatus === "offline" || rawStatus === "disconnected" || rawStatus === "down"
            ? "offline"
            : "unknown";
      return {
        id,
        status,
        ...(item.slots && typeof item.slots === "object" ? { slots: item.slots as Record<string, unknown> } : {}),
        ...(typeof item.activeJobs === "number" ? { activeJobs: item.activeJobs } : {}),
        ...(Array.isArray(item.capabilities) ? { capabilities: item.capabilities.map(String) } : {}),
        ...(typeof item.lastSeenAt === "string" ? { lastSeenAt: item.lastSeenAt } : {})
      };
    });
}
