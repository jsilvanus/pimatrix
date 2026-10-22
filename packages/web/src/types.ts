export type FrontendTabId = "outputs" | "inputs" | "cameras" | "renderer";

export type SourceId =
  | "hama"
  // NOTE: Future `hama2` virtual/duplicate source will be added here so we can send
  // the uncropped `hama` signal to one output and `hama2` (as cropped) to another.
  | "rtmp1"
  | "rtmp2"
  | "cam1"
  | "cam2"
  | "cam3"
  | "PiPGM1"
  | "PiPGM2"
  | "PiPGM3";

export interface SourceItem {
  id: SourceId;
  label: string;
  kind: string;
  state: string;
  preview: {
    available: boolean;
    url: string | null;
  };
}

export interface OutputSnapshot {
  id: "hdmi0" | "hdmi1" | "multiview";
  label: string;
  desiredSource: string | null;
  observedSource: string | null;
  state: string;
}

export interface EffectsPipeline {
  sourceId: SourceId;
  crop: {
    enabled: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    aspectRatio: string;
    lockedAspectRatio: boolean;
  };
  rotation: number;
  fadeToBlack: boolean;
  muted: boolean;
  ffmpegFilter: string;
}

export interface CameraPreset {
  id: number;
  name?: string;
  thumbnail?: string;
}

export interface CameraPosition {
  pan: number;
  tilt: number;
  zoom: number;
}

export interface CameraSnapshot {
  id: string;
  label: string;
  model: string;
  connection: "connected" | "disconnected" | "simulated";
  streaming: boolean;
  streamUrl: string | null;
  smartFrame: "enabled" | "disabled" | "triggered" | "unsupported";
  position: CameraPosition;
  presets: CameraPreset[];
}

export interface PiPgmPipelineSnapshot {
  id: string;
  label: string;
  orientation: "landscape" | "portrait";
  fadeToBlack: boolean;
  audioEnabled: boolean;
  volume: number;
  state: string;
}

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
  sources: SourceItem[];
  outputs: OutputSnapshot[];
  effects: EffectsPipeline[];
  cameras: CameraSnapshot[];
  pipgmPipelines: PiPgmPipelineSnapshot[];
  multiview: {
    id: string;
    layout: "auto" | "landscape" | "portrait";
  };
  matrix: MatrixRouteState;
  rtspOut: RtspOutState;
  authRequired?: boolean;
  mediaMtxPassword?: string | null;
  isWhitelisted?: boolean | undefined;
  clientIp?: string | undefined;
}

declare global {
  interface Window {
    __PIMATRIX_INITIAL__?: FrontendInitialState;
    switchTab: (tab: FrontendTabId) => void;
    selectHdmiSource: (outputNum: 1 | 2, sourceId: string) => Promise<void>;
    openAuxModal: (outputNum: 1 | 2) => void;
    closeAuxModal: () => void;
    openAuthModal: () => void;
    closeAuthModal: () => void;
    submitAuthPassword: () => Promise<void>;
    clearAuthPassword: () => void;
    showMediaMtxModal: () => void;
    closeMediaMtxModal: () => void;
    copyMediaMtxPassword: () => void;
    confirmAuxPick: (sourceId: string | null, mvLayout?: "landscape" | "portrait") => Promise<void>;
    toggleOutputInputControl: (outputNum: 1 | 2, kind: "ftb" | "mute") => Promise<void>;
    toggleInputEffect: (sourceId: SourceId, kind: "ftb" | "mute") => Promise<void>;
    openOutputCropModal: (outputNum: 1 | 2) => void;
    openSourceCropModal: (sourceId: SourceId) => void;
    closeCropModal: () => void;
    applySourceCropPreset: (preset: string) => Promise<void>;
    moveSourceCrop: (direction: "left" | "right" | "up" | "down" | "center") => Promise<void>;
    resizeSourceCrop: (action: "in" | "out") => Promise<void>;
    toggleSourceCropLockAspect: () => Promise<void>;
    openRtspModal: () => void;
    closeRtspModal: () => void;
    assignRtsp: (sourceId: string, mvLayout?: "landscape" | "portrait") => Promise<void>;
    setRtspQualityProfile: (quality: "preview" | "full") => Promise<void>;
    updateRtspCustomQuality: () => Promise<void>;
    toggleRtspStream: () => Promise<void>;
    toggleMatrixLock: () => Promise<void>;
    routeMatrixCrosspoint: (input: number, output: number) => Promise<void>;
    selectCamera: (camId: "cam1" | "cam2") => void;
    toggleCamFocus: () => void;
    toggleCameraStream: (camId: "cam1" | "cam2") => Promise<void>;
    toggleSavePresetMode: () => void;
    setPresetViewMode: (mode: "name" | "number" | "thumb") => void;
    renderCameraPresets: () => void;
    handlePresetTap: (camId: "cam1" | "cam2", presetId: number) => Promise<void>;
    sendPTZMove: (direction: string) => Promise<void>;
    sendPTZZoom: (action: "in" | "out" | "stop") => Promise<void>;
    sendSmartFrame: (mode: "enable" | "disable" | "trigger") => Promise<void>;
    adjustPtzSpeed: (delta: number) => void;
  }
}
