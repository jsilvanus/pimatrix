import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CameraSnapshot } from "./camera/camera-adapter.js";
import type { EffectsPipeline } from "./effects/effects-model.js";
import type { MultiviewSnapshot, OutputSnapshot, SourceId, SourceState } from "./model.js";
import type { PiPgmPipelineSnapshot } from "./pipgm/pipgm-model.js";

export type FrontendTabId = "outputs" | "inputs" | "cameras" | "renderer";

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

export interface FrontendInitialState {
  activeTab: FrontendTabId;
  mode: "simulation" | "production";
  sources: Array<{
    id: SourceId;
    label: string;
    kind: string;
    state: SourceState;
    preview: { available: boolean; url: string | null };
  }>;
  outputs: OutputSnapshot[];
  effects: EffectsPipeline[];
  cameras: CameraSnapshot[];
  pipgmPipelines: PiPgmPipelineSnapshot[];
  multiview: MultiviewSnapshot;
  matrix: MatrixRouteState;
  rtspOut: RtspOutState;
  authRequired?: boolean;
  mediaMtxPassword?: string | null;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// Works whether running from packages/api/src (tsx) or packages/api/dist (node)
const webPackageRoot = path.resolve(currentDir, "../../web");
const webDistDir = path.join(webPackageRoot, "dist");
const webSrcIndexHtml = path.join(webPackageRoot, "index.html");

export function resolveWebAssetFile(assetRelativePath: string): {
  filePath: string;
  contentType: string;
} | null {
  const safeRel = assetRelativePath.replace(/^[/\\]+/, "");
  const candidate = path.resolve(webDistDir, "assets", safeRel);
  const assetsRoot = path.resolve(webDistDir, "assets");
  if (!candidate.startsWith(assetsRoot) || !fs.existsSync(candidate)) {
    return null;
  }

  const ext = path.extname(candidate).toLowerCase();
  const mimeByExt: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2",
    ".woff": "font/woff"
  };

  return {
    filePath: candidate,
    contentType: mimeByExt[ext] ?? "application/octet-stream"
  };
}

export function renderOperatorFrontendHtml(initial: FrontendInitialState): string {
  const distIndex = path.join(webDistDir, "index.html");
  const templatePath = fs.existsSync(distIndex) ? distIndex : webSrcIndexHtml;
  const rawHtml = fs.readFileSync(templatePath, "utf8");
  const safeInitialJson = JSON.stringify(initial).replace(/<\//g, "<\\/");
  const injection = `<script id="pimatrix-initial-state">window.__PIMATRIX_INITIAL__ = ${safeInitialJson};</script>\n</head>`;
  return rawHtml.replace("</head>", injection);
}
