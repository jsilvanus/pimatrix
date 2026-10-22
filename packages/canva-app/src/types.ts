export type CanvaRenderMode = "embed" | "exported_mp4" | "exported_slides";

export type PiPgmPipelineId = "PiPGM1" | "PiPGM2" | "PiPGM3";

export type AspectRatioSelection = "vertical" | "10:16" | "landscape" | "custom";

export interface CustomResolution {
  width: number;
  height: number;
}

export interface CanvaPageInfo {
  pageNumber: number;
  title?: string;
  durationMs?: number;
  assetUrl?: string;
}

export interface CreatePiPgmCanvaRequest {
  designId: string;
  title?: string;
  embedUrl?: string;
  viewUrl?: string;
  editUrl?: string;
  pageCount?: number;
  pages?: CanvaPageInfo[];
  targetPipelineId?: PiPgmPipelineId;
  cueImmediately?: boolean;
  orientation?: "landscape" | "portrait";
  aspectRatio?: AspectRatioSelection | string;
  customResolution?: CustomResolution;
  mode?: CanvaRenderMode;
  autoExport?: boolean;
  exportFormat?: "mp4" | "png";
  exportUrls?: string[];
}

export interface PiPgmStepDescriptor {
  stepIndex: number;
  totalSteps: number;
  label: string;
  subLabel?: string;
  slideNumber?: number;
  previewText?: string[];
  assetUrl?: string;
}

export interface PiPgmItem {
  id: string;
  title: string;
  kind: "canva" | "pptx" | "youtube" | "video" | "image" | "hymn";
  createdAt: string;
  steps: PiPgmStepDescriptor[];
  canva?: {
    designId: string;
    title: string;
    mode: CanvaRenderMode;
    embedUrl: string;
    viewUrl?: string;
    pageCount: number;
    pushedFromCanvaApp?: boolean;
    aspectRatio?: string;
    resolution?: CustomResolution;
  };
}

export interface PiPgmPipelineSnapshot {
  id: PiPgmPipelineId;
  label: string;
  orientation: "landscape" | "portrait";
  resolution?: CustomResolution;
  activeItemId: string | null;
  currentStep: number;
  playbackState: "stopped" | "playing" | "paused";
  fadeToBlack: boolean;
  audioEnabled: boolean;
  linkedWith?: PiPgmPipelineId[];
  mobileAlert?: {
    fadeToBlackActive: boolean;
    signCode: string;
  };
}

export interface CreatePiPgmCanvaResponse {
  accepted: boolean;
  item: PiPgmItem;
  pipeline: PiPgmPipelineSnapshot | null;
}

export interface PiPgmCanvaControlRequest {
  designId?: string;
  targetPipelineId?: PiPgmPipelineId | "all";
  action:
    | "next"
    | "prev"
    | "gotoPage"
    | "gotoStep"
    | "ftb"
    | "mute"
    | "play"
    | "pause"
    | "stop"
    | "restart"
    | "mode";
  pageNumber?: number;
  stepIndex?: number;
  fadeToBlack?: boolean;
  ftbToggle?: boolean;
  audioEnabled?: boolean;
  muteToggle?: boolean;
  mode?: CanvaRenderMode;
  sync?: boolean;
}

export interface PiPgmCanvaControlResponse {
  success: boolean;
  action: string;
  pipelines: PiPgmPipelineSnapshot[];
}

export interface CanvaDesignInfo {
  designId: string;
  title: string;
  pageCount: number;
  embedUrl: string;
  viewUrl?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  isSimulated?: boolean;
}

export type ConnectionStatus = "connected" | "connecting" | "offline" | "error";

export interface PostMessageControlPayload {
  type?: "canva:control" | "pipgm:control";
  action: string;
  pageNumber?: number;
  stepIndex?: number;
  fadeToBlack?: boolean;
  audioEnabled?: boolean;
  mode?: CanvaRenderMode;
}
