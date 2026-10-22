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
}

export function renderOperatorFrontendHtml(initial: FrontendInitialState): string {
  const safeInitialJson = JSON.stringify(initial).replace(/<\//g, "<\\/");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="shell-type" content="mobile_tab">
  <title>PiMatrix | Broadcast Routing & Camera Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script id="tailwind-config">
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "outline": "#7b7486",
            "inverse-surface": "#342f2b",
            "primary-fixed-dim": "#d3bbff",
            "secondary-fixed": "#e9ddff",
            "surface": "#fff8f5",
            "surface-container-highest": "#eae1da",
            "inverse-primary": "#d3bbff",
            "surface-container-high": "#f0e6e0",
            "primary": "#5300b7",
            "on-primary": "#ffffff",
            "on-secondary-container": "#fffbff",
            "on-secondary-fixed-variant": "#5516be",
            "surface-container-lowest": "#ffffff",
            "primary-fixed": "#ebddff",
            "on-tertiary-fixed-variant": "#6e3900",
            "tertiary-fixed": "#ffdcc3",
            "background": "#fff8f5",
            "on-error-container": "#93000a",
            "primary-container": "#6d28d9",
            "surface-dim": "#e2d8d2",
            "on-primary-container": "#dac5ff",
            "inverse-on-surface": "#f9efe8",
            "surface-container-low": "#fcf2eb",
            "error-container": "#ffdad6",
            "secondary-fixed-dim": "#d0bcff",
            "surface-bright": "#fff8f5",
            "surface-variant": "#eae1da",
            "on-primary-fixed-variant": "#5b00c5",
            "tertiary-container": "#884800",
            "tertiary-fixed-dim": "#ffb77d",
            "on-surface-variant": "#4a4455",
            "on-tertiary-container": "#ffc394",
            "tertiary": "#653400",
            "secondary-container": "#8455ef",
            "surface-container": "#f6ece6",
            "on-surface": "#1f1b17",
            "on-secondary-fixed": "#23005c",
            "on-error": "#ffffff",
            "on-tertiary-fixed": "#2f1500",
            "on-secondary": "#ffffff",
            "on-background": "#1f1b17",
            "outline-variant": "#ccc3d7",
            "surface-tint": "#7331df",
            "on-primary-fixed": "#250059",
            "on-tertiary": "#ffffff",
            "error": "#ba1a1a",
            "secondary": "#6b38d4"
          },
          borderRadius: {
            "DEFAULT": "0.125rem",
            "lg": "0.25rem",
            "xl": "0.5rem",
            "full": "0.75rem"
          },
          spacing: {
            "space-xl": "1.75rem",
            "space-xs": "0.25rem",
            "margin": "1rem",
            "space-md": "0.75rem",
            "space-sm": "0.5rem",
            "gutter": "0.75rem",
            "space-lg": "1.25rem"
          },
          fontFamily: {
            "body-sm": ["Inter", "sans-serif"],
            "body-lg": ["Inter", "sans-serif"],
            "body-md": ["Inter", "sans-serif"],
            "headline-lg": ["Inter", "sans-serif"],
            "headline-md": ["Inter", "sans-serif"],
            "headline-sm": ["Inter", "sans-serif"],
            "label-sm": ["JetBrains Mono", "monospace"],
            "label-md": ["JetBrains Mono", "monospace"],
            "label-lg": ["JetBrains Mono", "monospace"]
          },
          fontSize: {
            "body-sm": ["12px", { "lineHeight": "16px", "fontWeight": "400" }],
            "body-lg": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
            "body-md": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
            "headline-lg": ["28px", { "lineHeight": "34px", "letterSpacing": "-0.02em", "fontWeight": "700" }],
            "headline-md": ["22px", { "lineHeight": "28px", "letterSpacing": "-0.015em", "fontWeight": "600" }],
            "headline-sm": ["18px", { "lineHeight": "24px", "letterSpacing": "-0.01em", "fontWeight": "600" }],
            "label-sm": ["10px", { "lineHeight": "13px", "letterSpacing": "0.05em", "fontWeight": "500" }],
            "label-md": ["11px", { "lineHeight": "15px", "letterSpacing": "0.04em", "fontWeight": "500" }],
            "label-lg": ["13px", { "lineHeight": "18px", "letterSpacing": "0.02em", "fontWeight": "600" }]
          }
        }
      }
    };
  </script>
  <style>
    :root {
      --surface: #fff8f5;
      --surface-low: #fcf2eb;
      --surface-container: #f6ece6;
      --surface-high: #f0e6e0;
      --surface-highest: #eae1da;
      --on-surface: #1f1b17;
      --on-surface-variant: #4a4455;
      --primary: #5300b7;
      --primary-container: #6d28d9;
      --secondary: #6b38d4;
      --tertiary: #653400;
      --error: #ba1a1a;
      --outline-variant: #ccc3d7;
    }
    html, body {
      width: 100vw;
      margin: 0;
      padding: 0;
      background-color: var(--surface);
      color: var(--on-surface);
      font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
      overscroll-behavior: none;
      min-height: max(884px, 100dvh);
    }
    .pb-safe { padding-bottom: env(safe-area-inset-bottom, 0px); }
    .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
    ::-webkit-scrollbar { display: none; }
    .tab-panel { display: none; }
    .tab-panel.active { display: flex; flex-direction: column; }

    /* Native <dialog> styling with light-dismiss backdrop */
    dialog#aux-modal-overlay {
      border: none;
      padding: 0;
      background: transparent;
      max-width: 24rem;
      width: calc(100vw - 2rem);
      margin: auto;
      overflow: visible;
    }
    dialog#aux-modal-overlay::backdrop {
      background-color: rgba(31, 27, 23, 0.45);
      backdrop-filter: blur(4px);
    }
  </style>
</head>
<body class="bg-surface font-body-md text-on-surface flex flex-col min-h-screen selection:bg-primary selection:text-on-primary">

  <!-- TOP FIXED BROADCAST HEADER -->
  <header class="fixed top-0 w-full z-40 pt-safe bg-surface/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] border-b border-outline-variant/25">
    <div class="h-16 px-margin max-w-2xl mx-auto flex items-center justify-between gap-space-sm">
      <div class="flex items-center gap-space-sm min-w-0">
        <div class="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-sm" id="header-icon-box">
          <span class="material-symbols-outlined text-on-primary text-[22px]" id="header-icon">crop_free</span>
        </div>
        <div class="flex flex-col min-w-0">
          <div class="flex items-center gap-space-xs">
            <span class="font-headline-sm text-headline-sm text-on-surface truncate leading-none font-bold" id="header-title">PiMatrix</span>
          </div>
          <span class="font-label-sm text-label-sm text-on-surface-variant truncate" id="header-subtitle">Pi Outputs</span>
        </div>
      </div>

      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Matrix Safety Lock Button (shown on Inputs/Matrix tab) -->
        <button id="lockToggleBtn" type="button" onclick="toggleMatrixLock()" class="hidden items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95">
          <span class="material-symbols-outlined text-[14px] text-tertiary" id="lockIcon">lock_open</span>
          <span class="text-tertiary" id="lockLabel">UNLOCKED</span>
        </button>

        <!-- Camera View Focus Toggle (shown on Cameras tab) -->
        <button id="toggleViewBtn" type="button" onclick="toggleCamFocus()" class="hidden items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-primary text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95">
          <span class="material-symbols-outlined text-[14px]">grid_view</span>
          <span id="viewModeLabel">Dual View</span>
        </button>

        <!-- Live SSE Status Pill -->
        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/30 text-on-surface-variant text-[10px] font-label-sm font-semibold">
          <span class="w-2 h-2 rounded-full bg-primary animate-pulse" id="sse-dot"></span>
          <span id="sse-status-text">ONLINE</span>
        </div>
      </div>
    </div>
  </header>

  <!-- MAIN VIEWPORT -->
  <main class="flex flex-col relative w-full max-w-2xl mx-auto pt-16 pb-24 bg-surface min-h-screen">

    <!-- =================================================================== -->
    <!-- TAB 1: PIMATRIX OUTPUTS (Stitch screen abc5e8b05f4d456fa8e46f80d67177c4) -->
    <!-- =================================================================== -->
    <section id="tab-outputs" class="tab-panel active w-full px-margin space-y-space-md pt-2">
      <!-- 2-Column Hardware Layout: HDMI 1 (Pi 1 / hdmi0) & HDMI 2 (Pi 2 / hdmi1) -->
      <div class="grid grid-cols-2 gap-space-sm w-full">

        <!-- COLUMN 1: HDMI 1 (Pi 1 -> hdmi0) -->
        <div class="bg-surface-container-low rounded-xl p-3 flex flex-col justify-between shadow-sm border border-outline-variant/30 space-y-3" id="hdmi-card-1">
          <!-- Header -->
          <div class="flex items-start justify-between gap-1">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h2 class="font-headline-sm text-[17px] font-bold text-on-surface leading-tight">HDMI 1</h2>
                <span id="hdmi1-ftb-pill" class="hidden px-1.5 py-0.5 rounded-full bg-error text-on-error text-[9px] font-label-sm font-bold uppercase animate-pulse">FTB</span>
              </div>
              <span class="font-label-sm text-[10px] text-on-surface-variant uppercase">Pi 1 (hdmi0)</span>
            </div>
            <div class="flex flex-col items-end gap-1 flex-shrink-0">
              <span class="font-label-sm text-[9px] text-on-surface-variant uppercase tracking-wider font-semibold leading-none">Routed To</span>
              <div class="flex flex-wrap items-center justify-end gap-1" id="hdmi1-routed-badges">
                <span class="px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface font-label-sm text-[9px] font-semibold leading-none">Standby</span>
              </div>
            </div>
          </div>

          <!-- Tactical Inputs Vertical List -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">Select Input:</span>
              <span class="font-label-sm text-[9px] text-primary font-semibold uppercase" id="hdmi1-active-label">--</span>
            </div>

            <button type="button" data-source="hama" class="hdmi1-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(1, 'hama')">
              <span>hama</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="rtmp1" class="hdmi1-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(1, 'rtmp1')">
              <span>rtmp1</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="rtmp2" class="hdmi1-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(1, 'rtmp2')">
              <span>rtmp2</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="PiPGM1" class="hdmi1-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(1, 'PiPGM1')">
              <span>pipgm 1</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="PiPGM2" class="hdmi1-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(1, 'PiPGM2')">
              <span>pipgm 2</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>

            <!-- Auxiliary Button with Dialog trigger -->
            <div class="relative pt-0.5">
              <button type="button" id="hdmi1-aux-btn" class="w-full p-1.5 rounded-lg border border-dashed border-primary/40 bg-surface-container hover:bg-surface-container-high text-left active:scale-[0.98] transition-all flex flex-col gap-0.5" onclick="openAuxModal(1)">
                <div class="flex items-center justify-between">
                  <span class="font-label-md text-[11px] font-bold text-primary uppercase flex items-center gap-1" id="hdmi1-aux-label">
                    <span class="material-symbols-outlined text-[13px]">tune</span>Auxiliary
                  </span>
                  <span class="material-symbols-outlined text-[14px] text-primary" id="hdmi1-aux-icon">touch_app</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Dedicated Output Controls (Input-Specific FTB & Mute for HDMI 1's selected input) -->
          <div class="pt-2 border-t border-outline-variant/30 flex flex-col gap-1">
            <div class="flex items-center justify-between text-[9px] font-label-sm text-on-surface-variant uppercase">
              <span>Input Controls</span>
              <span id="hdmi1-ctrl-target" class="font-bold text-primary">pipgm 1</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" class="flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-error/20 active:scale-[0.98] text-error font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs" id="btn-ftb-1" onclick="toggleOutputInputControl(1, 'ftb')">
                <span class="material-symbols-outlined text-[13px]">power_settings_new</span>
                <span>FTB</span>
              </button>
              <button type="button" class="flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface-variant font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs" id="btn-mute-1" onclick="toggleOutputInputControl(1, 'mute')">
                <span class="material-symbols-outlined text-[13px]" id="icon-mute-1">volume_up</span>
                <span id="label-mute-1">Mute</span>
              </button>
            </div>
          </div>
        </div>

        <!-- COLUMN 2: HDMI 2 (Pi 2 -> hdmi1) -->
        <div class="bg-surface-container-low rounded-xl p-3 flex flex-col justify-between shadow-sm border border-outline-variant/30 space-y-3" id="hdmi-card-2">
          <!-- Header -->
          <div class="flex items-start justify-between gap-1">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h2 class="font-headline-sm text-[17px] font-bold text-on-surface leading-tight">HDMI 2</h2>
                <span id="hdmi2-ftb-pill" class="hidden px-1.5 py-0.5 rounded-full bg-error text-on-error text-[9px] font-label-sm font-bold uppercase animate-pulse">FTB</span>
              </div>
              <span class="font-label-sm text-[10px] text-on-surface-variant uppercase">PI 2 (hdmi1)</span>
            </div>
            <div class="flex flex-col items-end gap-1 flex-shrink-0">
              <span class="font-label-sm text-[9px] text-on-surface-variant uppercase tracking-wider font-semibold leading-none">Routed To</span>
              <div class="flex flex-wrap items-center justify-end gap-1" id="hdmi2-routed-badges">
                <span class="px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface font-label-sm text-[9px] font-semibold leading-none">Standby</span>
              </div>
            </div>
          </div>

          <!-- Tactical Inputs Vertical List -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between">
              <span class="font-label-sm text-[10px] text-on-surface-variant uppercase tracking-wider">Select Input:</span>
              <span class="font-label-sm text-[9px] text-primary font-semibold uppercase" id="hdmi2-active-label">--</span>
            </div>

            <button type="button" data-source="hama" class="hdmi2-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(2, 'hama')">
              <span>hama</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="rtmp1" class="hdmi2-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(2, 'rtmp1')">
              <span>rtmp1</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="rtmp2" class="hdmi2-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(2, 'rtmp2')">
              <span>rtmp2</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="PiPGM1" class="hdmi2-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(2, 'PiPGM1')">
              <span>pipgm 1</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>
            <button type="button" data-source="PiPGM2" class="hdmi2-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs" onclick="selectHdmiSource(2, 'PiPGM2')">
              <span>pipgm 2</span>
              <span class="btn-indicators flex items-center gap-1"></span>
            </button>

            <!-- Auxiliary Button with Dialog trigger -->
            <div class="relative pt-0.5">
              <button type="button" id="hdmi2-aux-btn" class="w-full p-1.5 rounded-lg border border-dashed border-primary/40 bg-surface-container hover:bg-surface-container-high text-left active:scale-[0.98] transition-all flex flex-col gap-0.5" onclick="openAuxModal(2)">
                <div class="flex items-center justify-between">
                  <span class="font-label-md text-[11px] font-bold text-primary uppercase flex items-center gap-1" id="hdmi2-aux-label">
                    <span class="material-symbols-outlined text-[13px]">tune</span>Auxiliary
                  </span>
                  <span class="material-symbols-outlined text-[14px] text-primary" id="hdmi2-aux-icon">touch_app</span>
                </div>
              </button>
            </div>
          </div>

          <!-- Dedicated Output Controls (Input-Specific FTB & Mute for HDMI 2's selected input) -->
          <div class="pt-2 border-t border-outline-variant/30 flex flex-col gap-1">
            <div class="flex items-center justify-between text-[9px] font-label-sm text-on-surface-variant uppercase">
              <span>Input Controls</span>
              <span id="hdmi2-ctrl-target" class="font-bold text-primary">multiview</span>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" class="flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-error/20 active:scale-[0.98] text-error font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs" id="btn-ftb-2" onclick="toggleOutputInputControl(2, 'ftb')">
                <span class="material-symbols-outlined text-[13px]">power_settings_new</span>
                <span>FTB</span>
              </button>
              <button type="button" class="flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface-variant font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs" id="btn-mute-2" onclick="toggleOutputInputControl(2, 'mute')">
                <span class="material-symbols-outlined text-[13px]" id="icon-mute-2">volume_up</span>
                <span id="label-mute-2">Mute</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. BOTTOM SECTION: Network Stream Out (RTSP) Card -->
      <div class="w-full bg-surface-container-low rounded-xl p-space-md shadow-sm border border-outline-variant/30 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-9 h-9 rounded-lg bg-primary-container text-on-primary flex items-center justify-center flex-shrink-0">
              <span class="material-symbols-outlined text-[20px]">podcasts</span>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <h3 class="font-headline-sm text-[16px] font-bold text-on-surface truncate">Network Stream Out (RTSP)</h3>
                <span class="inline-block w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              </div>
              <p class="font-label-sm text-[11px] text-primary font-medium flex items-center gap-1">
                <span class="material-symbols-outlined text-[12px]">ads_click</span>Tap to toggle assignment matrix
              </p>
            </div>
          </div>
          <button type="button" class="px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-[11px] font-bold uppercase transition-all flex items-center gap-1 shadow-xs" onclick="toggleRtspDialog()">
            <span id="rtsp-current-assign">rtmp1</span>
            <span class="material-symbols-outlined text-[16px]">tune</span>
          </button>
        </div>

        <!-- Interactive Dialog / Assignment Popover Container -->
        <div class="bg-surface-container rounded-xl p-3 border border-outline-variant/40 space-y-2.5 transition-all" id="rtsp-dialog-box">
          <div class="flex items-center justify-between pb-1 border-b border-outline-variant/20">
            <div class="flex items-center gap-1.5">
              <span class="material-symbols-outlined text-primary text-[16px]">swap_calls</span>
              <span class="font-label-sm text-[11px] uppercase tracking-wider font-bold text-on-surface">RTSP Input Assignment Modal</span>
            </div>
            <a href="/multiview" class="font-label-sm text-[10px] text-primary font-bold hover:underline flex items-center gap-0.5">
              Open 8-Way Multiview <span class="material-symbols-outlined text-[12px]">open_in_new</span>
            </a>
          </div>

          <!-- Inputs ready for RTSP assignment grid -->
          <div class="grid grid-cols-3 gap-1.5">
            <button type="button" data-rtsp="hama" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('hama')">hama</button>
            <button type="button" data-rtsp="rtmp1" class="rtsp-choice-btn h-8 rounded-lg bg-primary text-on-primary font-label-md text-[11px] uppercase font-bold transition-all shadow-sm" onclick="assignRtsp('rtmp1')">rtmp1</button>
            <button type="button" data-rtsp="rtmp2" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('rtmp2')">rtmp2</button>
            <button type="button" data-rtsp="PiPGM1" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('PiPGM1')">pipgm 1</button>
            <button type="button" data-rtsp="PiPGM2" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('PiPGM2')">pipgm 2</button>
            <button type="button" data-rtsp="cam1" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('cam1')">cam1</button>
            <button type="button" data-rtsp="cam2" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('cam2')">cam2</button>
            <button type="button" data-rtsp="cam3" class="rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs" onclick="assignRtsp('cam3')">cam3</button>
            <div class="flex gap-1 col-span-1">
              <button type="button" data-rtsp="multiview:landscape" class="rtsp-choice-btn flex-1 h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-sm text-[9px] uppercase font-semibold transition-all flex flex-col items-center justify-center leading-none p-0.5" onclick="assignRtsp('multiview', 'landscape')">
                <span>MV</span>
                <span class="text-primary font-bold">4x2</span>
              </button>
              <button type="button" data-rtsp="multiview:portrait" class="rtsp-choice-btn flex-1 h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-sm text-[9px] uppercase font-semibold transition-all flex flex-col items-center justify-center leading-none p-0.5" onclick="assignRtsp('multiview', 'portrait')">
                <span>MV</span>
                <span class="text-secondary font-bold">2x4</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1 text-[10px] font-label-sm text-on-surface-variant">
            <span class="flex items-center gap-1" id="rtsp-url-readout">
              <span class="material-symbols-outlined text-[13px] text-primary">dns</span>rtsp://pimatrix.local:554/live
            </span>
            <span class="text-primary font-semibold">Bitrate: 6.2 Mbps</span>
          </div>
        </div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 2: PIMATRIX INPUTS / MATRIX ROUTING (Stitch screen 0f8f5216ab98477eaf542c215cd3e457) -->
    <!-- =================================================================== -->
    <section id="tab-inputs" class="tab-panel w-full px-margin pb-space-xl gap-space-md pt-2 select-none">
      <!-- Destination Cards Grid (Atlona AT-UHD-PRO3-44M via AMX NetLinx) -->
      <div class="flex flex-col gap-space-md w-full" id="destinationMatrix">

        <!-- Card 1: Projector 1 (Atlona Output 1) -->
        <div class="bg-surface-container-low rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col gap-space-sm transition-all">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <div class="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface">
                <span class="material-symbols-outlined text-[18px]">videocam</span>
              </div>
              <div>
                <h2 class="font-headline-sm text-[16px] leading-tight text-on-surface">Projector 1</h2>
                <span class="font-label-sm text-[9px] text-on-surface-variant uppercase">Atlona Out 1 (Epson EB-L1050U)</span>
              </div>
            </div>
            <span class="font-label-sm text-[10px] text-primary font-bold uppercase" id="matrix-out-1-status">IN 1 • LECTERN</span>
          </div>
          <div class="grid grid-cols-4 gap-space-xs p-1 bg-surface-container rounded-lg" data-dest="prj1" data-output="1">
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="1" data-src="Lectern" onclick="routeMatrixCrosspoint(1, 1)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Lectern</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI IN</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="2" data-src="Rack PC" onclick="routeMatrixCrosspoint(2, 1)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Rack PC</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 1</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="3" data-src="Pi 1" onclick="routeMatrixCrosspoint(3, 1)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 1</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 1</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="4" data-src="Pi 2" onclick="routeMatrixCrosspoint(4, 1)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 2</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 2</span>
            </button>
          </div>
        </div>

        <!-- Card 2: Projector 2 (Atlona Output 2) -->
        <div class="bg-surface-container-low rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col gap-space-sm transition-all">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <div class="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface">
                <span class="material-symbols-outlined text-[18px]">co_present</span>
              </div>
              <div>
                <h2 class="font-headline-sm text-[16px] leading-tight text-on-surface">Projector 2</h2>
                <span class="font-label-sm text-[9px] text-on-surface-variant uppercase">Atlona Out 2 (Epson EB-L1050U)</span>
              </div>
            </div>
            <span class="font-label-sm text-[10px] text-primary font-bold uppercase" id="matrix-out-2-status">IN 2 • RACK PC</span>
          </div>
          <div class="grid grid-cols-4 gap-space-xs p-1 bg-surface-container rounded-lg" data-dest="prj2" data-output="2">
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="1" data-src="Lectern" onclick="routeMatrixCrosspoint(1, 2)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Lectern</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI IN</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="2" data-src="Rack PC" onclick="routeMatrixCrosspoint(2, 2)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Rack PC</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 1</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="3" data-src="Pi 1" onclick="routeMatrixCrosspoint(3, 2)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 1</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 1</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="4" data-src="Pi 2" onclick="routeMatrixCrosspoint(4, 2)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 2</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">HDMI 2</span>
            </button>
          </div>
        </div>

        <!-- Card 3: Screen (DISABLED / MAINTENANCE - Atlona Output 3) -->
        <div class="bg-surface-container-high/80 rounded-xl p-space-md shadow-xs opacity-75 flex flex-col gap-space-sm relative overflow-hidden border border-outline-variant/30">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <div class="w-7 h-7 rounded-lg bg-surface-dim flex items-center justify-center text-outline">
                <span class="material-symbols-outlined text-[18px]">tv_off</span>
              </div>
              <div class="flex items-center gap-1.5">
                <h2 class="font-headline-sm text-[16px] leading-tight text-on-surface-variant">Screen</h2>
                <span class="material-symbols-outlined text-[14px] text-outline">lock</span>
              </div>
            </div>
            <div class="flex items-center gap-1 px-2.5 py-1 rounded-full bg-error-container text-on-error-container shadow-xs">
              <span class="material-symbols-outlined text-[13px]">build</span>
              <span class="font-label-sm text-label-sm font-bold uppercase tracking-wider">EI VIELÄ HANKITTU</span>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-space-xs p-1 bg-surface-container-highest/60 rounded-lg pointer-events-none">
            <button aria-disabled="true" class="h-12 flex flex-col items-center justify-center rounded bg-surface-dim text-outline cursor-not-allowed" disabled>
              <span class="material-symbols-outlined text-[13px] mb-0.5">lock</span>
              <span class="font-label-md text-label-md font-semibold">Lectern</span>
            </button>
            <button aria-disabled="true" class="h-12 flex flex-col items-center justify-center rounded bg-surface-dim text-outline cursor-not-allowed" disabled>
              <span class="material-symbols-outlined text-[13px] mb-0.5">lock</span>
              <span class="font-label-md text-label-md font-semibold">Rack PC</span>
            </button>
            <button aria-disabled="true" class="h-12 flex flex-col items-center justify-center rounded bg-surface-dim text-outline cursor-not-allowed" disabled>
              <span class="material-symbols-outlined text-[13px] mb-0.5">lock</span>
              <span class="font-label-md text-label-md font-semibold">Pi 1</span>
            </button>
            <button aria-disabled="true" class="h-12 flex flex-col items-center justify-center rounded bg-surface-dim text-outline cursor-not-allowed" disabled>
              <span class="material-symbols-outlined text-[13px] mb-0.5">lock</span>
              <span class="font-label-md text-label-md font-semibold">Pi 2</span>
            </button>
          </div>
        </div>

        <!-- Card 4: Videomikseri (Atlona Output 4) -->
        <div class="bg-surface-container-low rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col gap-space-sm transition-all">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-space-xs">
              <div class="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center text-on-surface">
                <span class="material-symbols-outlined text-[18px]">developer_board</span>
              </div>
              <div>
                <h2 class="font-headline-sm text-[16px] leading-tight text-on-surface">Videomikseri</h2>
                <span class="font-label-sm text-[9px] text-on-surface-variant uppercase">Atlona Out 4 (Roland V-1SDI / ATEM)</span>
              </div>
            </div>
            <span class="font-label-sm text-[10px] text-primary font-bold uppercase" id="matrix-out-4-status">IN 3 • PI 1</span>
          </div>
          <div class="grid grid-cols-4 gap-space-xs p-1 bg-surface-container rounded-lg" data-dest="atem" data-output="4">
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="1" data-src="Lectern" onclick="routeMatrixCrosspoint(1, 4)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Lectern</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">AUX 1</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="2" data-src="Rack PC" onclick="routeMatrixCrosspoint(2, 4)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Rack PC</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">AUX 2</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="3" data-src="Pi 1" onclick="routeMatrixCrosspoint(3, 4)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 1</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">AUX 3</span>
            </button>
            <button type="button" class="matrix-btn h-12 flex flex-col items-center justify-center rounded transition-all active:scale-95" data-input="4" data-src="Pi 2" onclick="routeMatrixCrosspoint(4, 4)">
              <span class="font-label-md text-label-md font-bold tracking-wider">Pi 2</span>
              <span class="matrix-sub font-label-sm text-[9px] uppercase tracking-tighter">AUX 4</span>
            </button>
          </div>
        </div>

        <!-- Per-Input Specific FTB & Mute Control Strip -->
        <div class="bg-surface-container-low rounded-xl p-space-md shadow-sm border border-outline-variant/30 flex flex-col gap-space-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="material-symbols-outlined text-primary text-[18px]">tune</span>
              <div>
                <h3 class="font-headline-sm text-[15px] font-bold text-on-surface leading-tight">Per-Input FTB &amp; Audio Mute</h3>
                <span class="font-label-sm text-[10px] text-on-surface-variant">Input-specific blackout &amp; mute across PiMatrix sources</span>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5" id="per-input-ftb-grid"></div>
        </div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 3: CAMERA CONTROL (Stitch screens 1c8b75ea9d8f459595223ae3db6618de & e8d8278e17ca4dc5a2c9956a2f1c1b43) -->
    <!-- =================================================================== -->
    <section id="tab-cameras" class="tab-panel w-full px-margin pb-6 gap-space-md pt-2">

      <!-- Dual Stream Feeds (Select Target for PTZ Drive) -->
      <div class="grid grid-cols-2 gap-space-sm w-full transition-all duration-300" id="monitorsContainer">
        <!-- Camera 01 Feed Card -->
        <div class="group relative flex flex-col bg-surface-container rounded-xl overflow-hidden shadow-sm border border-outline-variant/30 active:scale-[0.99] transition-all cursor-pointer" id="cam-card-1" onclick="selectCamera('cam1')">
          <div class="h-1.5 w-full bg-primary transition-colors" id="cam-glow-1"></div>
          <div class="relative w-full aspect-video bg-inverse-surface overflow-hidden" id="cam-viewport-1">
            <img class="w-full h-full object-cover" alt="Cam 1 Stage Left PTZ" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCKS_BgqyHzZFCEQqhVCWdc5tS4bLcezTX-QVCnur8csSK45y6nt92s-F8un6tl71qPNNJoz2sS5ud9moUPJiPgKhAO4RRVTf-vHfJJtd1OZx1PomlvnGIHq-YugCoMnw7TR10H_BM3Q7Jb8mDj2zn8bo8JedfHip-rl3Bf936YxboPnw1iZpI3thfObb2kKyye-AaDW-U_zUxIRypWgRjjhbdc48niXArGpiw2aeUziKogcmf3T8CFPQ">
            <div class="absolute inset-0 bg-gradient-to-t from-inverse-surface/80 via-transparent to-inverse-surface/30"></div>
            <div class="absolute top-1.5 left-1.5 flex items-center gap-1">
              <span class="px-1.5 py-0.5 rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold shadow-sm" id="cam-badge-1">CAM 01</span>
              <span class="px-1.5 py-0.5 rounded bg-error text-on-error font-label-sm text-[9px] font-bold" id="cam-live-chip-1">LIVE</span>
            </div>
            <div class="absolute top-1.5 right-1.5 flex items-center gap-1">
              <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block" id="cam-dot-1"></span>
            </div>
            <div class="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-inverse-on-surface">
              <span class="font-label-sm text-label-sm truncate">Stage Left PTZ</span>
              <span class="font-label-sm text-[9px] px-1 rounded bg-black/50" id="cam-pos-1">P:0 T:0 Z:0</span>
            </div>
            <div class="absolute inset-0 bg-primary/10 flex items-center justify-center" id="cam-select-indicator-1">
              <span class="px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-[10px] shadow-md flex items-center gap-1">
                <span class="material-symbols-outlined text-[12px]">videocam</span> ACTIVE DRIVER
              </span>
            </div>
          </div>
          <div class="px-space-sm py-1.5 bg-surface-container-high flex items-center justify-between gap-1">
            <span class="font-label-sm text-[10px] text-on-surface-variant truncate" id="cam-meta-1">VISCA · 1080p59.94</span>
            <button type="button" onclick="event.stopPropagation(); toggleCameraStream('cam1')" id="cam-stream-btn-1" class="px-1.5 py-0.5 rounded bg-surface-container-lowest text-primary font-label-sm text-[9px] font-bold uppercase shadow-xs">Stream</button>
          </div>
        </div>

        <!-- Camera 02 Feed Card -->
        <div class="group relative flex flex-col bg-surface-container rounded-xl overflow-hidden shadow-sm border border-outline-variant/30 active:scale-[0.99] transition-all cursor-pointer" id="cam-card-2" onclick="selectCamera('cam2')">
          <div class="h-1.5 w-full bg-surface-variant transition-colors" id="cam-glow-2"></div>
          <div class="relative w-full aspect-video bg-inverse-surface overflow-hidden" id="cam-viewport-2">
            <img class="w-full h-full object-cover" alt="Cam 2 Pulpit Altar PTZ" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCQl1pRFAxVXZvm8CNRYanxyEzxl-jIPo_3CbH11wfeCSk-Y7YepVqwowAURVneRKOJkUyXF_iIuUo4p2WmmqxDsuvpP4ddCh3B8qBhC833aSvYYhcPVHANKoQcsUi0dfPeBqzW_7EX3cspBOolADADyy18_SfOlo3uDnZy8F636s_33o2tv_3hxZtHqZMi2ir6YluHzWl_JVvCwav0Yt-fucgeJGgeZ70s6Umh5sqMf_ZS4_yzbit_dA">
            <div class="absolute inset-0 bg-gradient-to-t from-inverse-surface/80 via-transparent to-inverse-surface/30"></div>
            <div class="absolute top-1.5 left-1.5 flex items-center gap-1">
              <span class="px-1.5 py-0.5 rounded bg-surface-container-lowest/90 text-on-surface font-label-sm text-label-sm font-bold shadow-sm" id="cam-badge-2">CAM 02</span>
              <span class="px-1.5 py-0.5 rounded bg-tertiary-container text-on-tertiary-container font-label-sm text-[9px] font-bold" id="cam-live-chip-2">PVW</span>
            </div>
            <div class="absolute top-1.5 right-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block" id="cam-dot-2"></span>
            </div>
            <div class="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between text-inverse-on-surface">
              <span class="font-label-sm text-label-sm truncate">Pulpit / Altar</span>
              <span class="font-label-sm text-[9px] px-1 rounded bg-black/50" id="cam-pos-2">P:0 T:0 Z:0</span>
            </div>
            <div class="absolute inset-0 bg-secondary/10 flex items-center justify-center hidden" id="cam-select-indicator-2">
              <span class="px-2 py-0.5 rounded-full bg-secondary text-on-secondary font-label-sm text-[10px] shadow-md flex items-center gap-1">
                <span class="material-symbols-outlined text-[12px]">videocam</span> ACTIVE DRIVER
              </span>
            </div>
          </div>
          <div class="px-space-sm py-1.5 bg-surface-container-high flex items-center justify-between gap-1">
            <span class="font-label-sm text-[10px] text-on-surface-variant truncate" id="cam-meta-2">VISCA · 1080p59.94</span>
            <button type="button" onclick="event.stopPropagation(); toggleCameraStream('cam2')" id="cam-stream-btn-2" class="px-1.5 py-0.5 rounded bg-surface-container-lowest text-secondary font-label-sm text-[9px] font-bold uppercase shadow-xs">Stream</button>
          </div>
        </div>
      </div>

      <!-- Single Cam Detailed Parameter Matrix (Stitch screen e8d8278e17ca4dc5a2c9956a2f1c1b43) -->
      <div class="w-full bg-surface-container rounded-xl p-space-md flex flex-col gap-space-sm shadow-sm border border-outline-variant/30" id="expandedConfigPanel">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-xs">
            <span class="w-2 h-2 rounded-full bg-primary animate-ping"></span>
            <h2 class="font-label-lg text-label-lg font-bold text-on-surface uppercase" id="param-matrix-title">CAM 01 PARAMETER MATRIX</h2>
          </div>
          <span class="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded" id="param-matrix-visca">VISCA over IP: UDP 52381</span>
        </div>

        <!-- Config Toggles Bar: SAVE PRESET & THUMB CAPTURE -->
        <div class="grid grid-cols-2 gap-space-xs pt-space-xs">
          <button type="button" class="flex items-center justify-between px-space-sm py-2 bg-surface rounded-lg shadow-sm active:scale-98 transition-all" id="savePresetBtn" onclick="toggleSavePresetMode()">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="material-symbols-outlined text-primary text-[18px]">bookmark_add</span>
              <div class="text-left">
                <div class="font-label-sm text-label-sm font-bold text-on-surface">SAVE PRESET</div>
                <div class="font-body-sm text-[10px] text-on-surface-variant leading-none" id="savePresetSub">Tap slot to store</div>
              </div>
            </div>
            <div class="w-8 h-4 rounded-full bg-surface-container-highest flex items-center p-0.5 transition-colors" id="savePresetPill">
              <div class="w-3 h-3 rounded-full bg-outline transition-transform" id="savePresetKnob"></div>
            </div>
          </button>

          <button type="button" class="flex items-center justify-between px-space-sm py-2 bg-surface rounded-lg shadow-sm active:scale-98 transition-all" id="setThumbBtn" onclick="toggleThumbCaptureMode()">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="material-symbols-outlined text-secondary text-[18px]">add_a_photo</span>
              <div class="text-left">
                <div class="font-label-sm text-label-sm font-bold text-on-surface">THUMB CAPTURE</div>
                <div class="font-body-sm text-[10px] text-on-surface-variant leading-none">Snapshot on tap</div>
              </div>
            </div>
            <div class="w-8 h-4 rounded-full bg-surface-container-highest flex items-center p-0.5 transition-colors" id="thumbPill">
              <div class="w-3 h-3 rounded-full bg-outline transition-transform" id="thumbKnob"></div>
            </div>
          </button>
        </div>

        <!-- Numerical Preset Slot Input & Display Mode -->
        <div class="flex items-center gap-space-xs pt-1">
          <div class="flex-1 bg-surface rounded-lg px-space-sm py-1.5 flex items-center gap-space-xs shadow-sm">
            <span class="material-symbols-outlined text-on-surface-variant text-[16px]">list_alt</span>
            <label class="font-label-sm text-label-sm text-on-surface-variant uppercase" for="presetRangeInput">Visible:</label>
            <input class="font-label-sm text-label-sm text-primary font-bold bg-transparent outline-none flex-1 tracking-wider" id="presetRangeInput" type="text" value="1, 2, 3, 4, 5, 6" onchange="renderCameraPresets()" oninput="renderCameraPresets()">
          </div>
          <div class="flex bg-surface-container-highest rounded-lg p-0.5">
            <button type="button" class="preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase font-bold bg-surface text-primary shadow-sm" data-mode="name" onclick="setPresetViewMode('name')">Name</button>
            <button type="button" class="preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase text-on-surface-variant" data-mode="number" onclick="setPresetViewMode('number')">Num</button>
            <button type="button" class="preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase text-on-surface-variant" data-mode="thumb" onclick="setPresetViewMode('thumb')">Thumb</button>
          </div>
        </div>
      </div>

      <!-- Cam 01 Presets Bank -->
      <div class="bg-surface-container-low rounded-xl p-space-sm shadow-sm border border-outline-variant/30 flex flex-col gap-space-xs" id="cam1-presets-section">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-xs">
            <span class="material-symbols-outlined text-primary text-[18px]">linked_camera</span>
            <span class="font-label-md text-label-md text-on-surface font-bold tracking-tight">CAM 01 PRESETS</span>
            <span class="font-label-sm text-label-sm text-on-surface-variant">(Stage Left PTZ)</span>
          </div>
          <span class="font-label-sm text-[10px] text-primary font-semibold" id="cam1-sf-badge">SmartFrame: OFF</span>
        </div>
        <div class="grid grid-cols-3 gap-space-xs pt-1" id="cam1-presets-grid"></div>
      </div>

      <!-- Cam 02 Presets Bank -->
      <div class="bg-surface-container-low rounded-xl p-space-sm shadow-sm border border-outline-variant/30 flex flex-col gap-space-xs" id="cam2-presets-section">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-xs">
            <span class="material-symbols-outlined text-secondary text-[18px]">photo_camera</span>
            <span class="font-label-md text-label-md text-on-surface font-bold tracking-tight">CAM 02 PRESETS</span>
            <span class="font-label-sm text-label-sm text-on-surface-variant">(Pulpit / Altar)</span>
          </div>
          <span class="font-label-sm text-[10px] text-secondary font-semibold" id="cam2-sf-badge">SmartFrame: OFF</span>
        </div>
        <div class="grid grid-cols-3 gap-space-xs pt-1" id="cam2-presets-grid"></div>
      </div>

      <!-- Shared D-Pad Controller & Zoom / Focus Console -->
      <div class="bg-surface-container rounded-xl p-space-sm shadow-sm border border-outline-variant/30 flex flex-col gap-space-sm">
        <div class="flex items-center justify-between pb-1">
          <div class="flex items-center gap-space-xs">
            <span class="material-symbols-outlined text-primary text-[20px]">gamepad</span>
            <span class="font-label-md text-label-md text-on-surface font-bold uppercase tracking-wider">PTZ Movement &amp; Optics</span>
          </div>
          <div class="px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm font-bold uppercase" id="target-indicator">TARGET: CAM 01 (STAGE LEFT)</div>
        </div>

        <div class="grid grid-cols-12 gap-space-sm items-center">
          <!-- Tactile Hardware D-Pad (7 cols) -->
          <div class="col-span-7 flex flex-col items-center justify-center p-2 bg-surface-container-low rounded-xl">
            <div class="relative w-36 h-36 flex items-center justify-center">
              <!-- UP -->
              <button type="button" class="absolute top-0 w-11 h-11 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface shadow-xs active:scale-95 flex items-center justify-center transition-all" onclick="sendPTZMove('up')">
                <span class="material-symbols-outlined text-[24px]">keyboard_arrow_up</span>
              </button>
              <!-- DOWN -->
              <button type="button" class="absolute bottom-0 w-11 h-11 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface shadow-xs active:scale-95 flex items-center justify-center transition-all" onclick="sendPTZMove('down')">
                <span class="material-symbols-outlined text-[24px]">keyboard_arrow_down</span>
              </button>
              <!-- LEFT -->
              <button type="button" class="absolute left-0 w-11 h-11 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface shadow-xs active:scale-95 flex items-center justify-center transition-all" onclick="sendPTZMove('left')">
                <span class="material-symbols-outlined text-[24px]">keyboard_arrow_left</span>
              </button>
              <!-- RIGHT -->
              <button type="button" class="absolute right-0 w-11 h-11 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface shadow-xs active:scale-95 flex items-center justify-center transition-all" onclick="sendPTZMove('right')">
                <span class="material-symbols-outlined text-[24px]">keyboard_arrow_right</span>
              </button>
              <!-- HOME (Center) -->
              <button type="button" class="w-12 h-12 rounded-full bg-primary-container text-on-primary hover:bg-primary shadow-sm active:scale-90 flex flex-col items-center justify-center transition-all" onclick="sendPTZMove('home')">
                <span class="material-symbols-outlined text-[18px]">home</span>
                <span class="font-label-sm text-[9px] uppercase tracking-tighter leading-none">HOME</span>
              </button>
            </div>
            <!-- Pan/Tilt Speed Attenuator -->
            <div class="w-full flex items-center justify-between pt-2 px-1">
              <span class="font-label-sm text-label-sm text-on-surface-variant uppercase" id="ptz-speed-label">SPD 12 (0x0C)</span>
              <div class="flex items-center gap-1">
                <button type="button" onclick="adjustPtzSpeed(-2)" class="w-5 h-5 rounded bg-surface-container-highest text-on-surface flex items-center justify-center text-xs font-bold active:scale-90">-</button>
                <div class="w-12 h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
                  <div class="h-full bg-primary transition-all" id="ptz-speed-bar" style="width: 50%"></div>
                </div>
                <button type="button" onclick="adjustPtzSpeed(2)" class="w-5 h-5 rounded bg-surface-container-highest text-on-surface flex items-center justify-center text-xs font-bold active:scale-90">+</button>
              </div>
            </div>
          </div>

          <!-- Zoom & SmartFrame/Focus Control Ribbons (5 cols) -->
          <div class="col-span-5 flex flex-col gap-space-xs">
            <!-- Zoom Bank -->
            <div class="bg-surface-container-low rounded-xl p-space-xs flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="font-label-sm text-label-sm text-on-surface-variant font-semibold">ZOOM</span>
                <span class="font-label-sm text-label-sm text-primary font-bold">OPTICAL</span>
              </div>
              <div class="grid grid-cols-2 gap-1">
                <button type="button" class="h-10 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface font-label-md text-label-md font-bold flex items-center justify-center gap-1 active:scale-95 transition-all" onclick="sendPTZZoom('in')">
                  <span class="material-symbols-outlined text-[16px]">zoom_in</span> IN
                </button>
                <button type="button" class="h-10 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface font-label-md text-label-md font-bold flex items-center justify-center gap-1 active:scale-95 transition-all" onclick="sendPTZZoom('out')">
                  <span class="material-symbols-outlined text-[16px]">zoom_out</span> OUT
                </button>
              </div>
            </div>

            <!-- Focus & SmartFrame Bank -->
            <div class="bg-surface-container-low rounded-xl p-space-xs flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <span class="font-label-sm text-label-sm text-on-surface-variant font-semibold">AI / FOCUS</span>
                <button type="button" onclick="sendSmartFrame('trigger')" class="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-sm text-[9px] font-bold uppercase">SMART TRIG</button>
              </div>
              <div class="grid grid-cols-2 gap-1">
                <button type="button" class="h-10 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface font-label-md text-[10px] font-semibold flex items-center justify-center text-center leading-tight active:scale-95 transition-all" onclick="sendSmartFrame('enable')">
                  AI ON
                </button>
                <button type="button" class="h-10 rounded-lg bg-surface-container-highest hover:bg-primary hover:text-on-primary text-on-surface font-label-md text-[10px] font-semibold flex items-center justify-center text-center leading-tight active:scale-95 transition-all" onclick="sendSmartFrame('disable')">
                  AI OFF
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- =================================================================== -->
    <!-- TAB 4: PIPGM RENDERER (STUB ONLY — as requested)                    -->
    <!-- =================================================================== -->
    <section id="tab-renderer" class="tab-panel w-full px-margin pb-6 gap-space-md pt-4">
      <div class="p-space-lg rounded-xl bg-surface-container-low border border-outline-variant/40 shadow-sm flex flex-col items-center justify-center text-center gap-space-sm">
        <div class="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <span class="material-symbols-outlined text-[26px]">layers</span>
        </div>
        <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">PiPGM Renderer</h2>
        <p class="font-body-md text-body-md text-on-surface-variant max-w-md">
          PiPGM renderer tab stub. Use the <strong>Outputs</strong> tab to route <code>pipgm 1</code> or <code>pipgm 2</code> to HDMI outputs and control input-specific FTB and audio mute.
        </p>
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm uppercase">
          <span class="w-2 h-2 rounded-full bg-primary"></span>
          STUB PLACEHOLDER
        </div>
      </div>
    </section>

  </main>

  <!-- =================================================================== -->
  <!-- AUXILIARY FEEDS MODAL (<dialog closedby="any"> per modern-web-guidance) -->
  <!-- =================================================================== -->
  <dialog id="aux-modal-overlay" closedby="any" aria-labelledby="aux-dialog-title">
    <div class="bg-surface-container-low rounded-2xl w-full p-4 shadow-xl border border-outline-variant/40 space-y-3">
      <div class="flex items-center justify-between pb-2 border-b border-outline-variant/30">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <span class="material-symbols-outlined text-[18px]">tune</span>
          </div>
          <div>
            <h4 class="font-headline-sm text-[15px] font-bold text-on-surface leading-none" id="aux-dialog-title">Auxiliary Feeds Modal</h4>
            <span class="font-label-sm text-[10px] text-on-surface-variant uppercase" id="aux-target-label">Assigning to HDMI 1</span>
          </div>
        </div>
        <button type="button" class="w-7 h-7 rounded-full bg-surface-container-high hover:bg-surface-container-highest text-on-surface flex items-center justify-center" onclick="closeAuxModal()">
          <span class="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
      <p class="font-body-sm text-[12px] text-on-surface-variant">Select a camera or multiview pipeline to route to this hardware output bus:</p>
      <div class="grid grid-cols-2 gap-2">
        <button type="button" class="h-11 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary transition-all flex items-center justify-center gap-1.5 font-label-md text-label-md uppercase font-semibold text-on-surface" onclick="confirmAuxPick('cam1')">
          <span class="material-symbols-outlined text-[16px]">videocam</span>
          <span>cam1</span>
        </button>
        <button type="button" class="h-11 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary transition-all flex items-center justify-center gap-1.5 font-label-md text-label-md uppercase font-semibold text-on-surface" onclick="confirmAuxPick('cam2')">
          <span class="material-symbols-outlined text-[16px]">videocam</span>
          <span>cam2</span>
        </button>
        <button type="button" class="h-11 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary transition-all flex items-center justify-center gap-1.5 font-label-md text-label-md uppercase font-semibold text-on-surface" onclick="confirmAuxPick('cam3')">
          <span class="material-symbols-outlined text-[16px]">videocam</span>
          <span>cam3</span>
        </button>
        <button type="button" class="h-11 rounded-lg bg-surface-container-high hover:bg-primary-container hover:text-on-primary transition-all flex flex-col items-center justify-center p-1 text-on-surface" onclick="confirmAuxPick('multiview', 'landscape')">
          <div class="flex items-center gap-1 font-label-md text-[11px] uppercase font-bold">
            <span class="material-symbols-outlined text-[14px]">grid_view</span>
            <span>Multiview</span>
          </div>
          <span class="text-[9px] font-label-sm opacity-80 uppercase">4x2 Landscape</span>
        </button>
      </div>
      <div class="pt-1 flex flex-col gap-1.5">
        <button type="button" class="w-full h-9 rounded-lg bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface font-label-sm text-[11px] uppercase font-semibold flex items-center justify-center gap-1.5" onclick="confirmAuxPick('multiview', 'portrait')">
          <span class="material-symbols-outlined text-[14px]">view_week</span>
          <span>Multiview 2x4 Vertical Orientation</span>
        </button>
        <button type="button" class="w-full h-8 rounded-lg bg-surface-container-highest/60 hover:bg-error-container hover:text-on-error-container text-on-surface-variant font-label-sm text-[10px] uppercase font-semibold flex items-center justify-center gap-1" onclick="confirmAuxPick(null)">
          <span class="material-symbols-outlined text-[13px]">link_off</span>
          <span>Unroute / Clear Output</span>
        </button>
      </div>
    </div>
  </dialog>

  <!-- TOAST NOTIFICATION -->
  <div class="fixed bottom-20 left-1/2 -translate-x-1/2 bg-inverse-surface text-inverse-on-surface px-4 py-2 rounded-full font-label-md text-label-md shadow-xl pointer-events-none transition-all duration-200 z-50 flex items-center gap-2 opacity-0 translate-y-2" id="toast">
    <span class="material-symbols-outlined text-[16px] text-primary-fixed-dim">verified</span>
    <span id="toast-text">Ready</span>
  </div>

  <!-- BOTTOM FIXED NAVIGATION BAR -->
  <nav class="fixed bottom-0 w-full z-40 pb-safe bg-surface-container-low/95 backdrop-blur-xl shadow-[0_-2px_10px_rgba(0,0,0,0.05)] border-t border-outline-variant/25">
    <div class="flex items-center justify-around h-16 px-space-xs max-w-2xl mx-auto">
      <a href="#outputs" id="nav-outputs" onclick="switchTab('outputs'); return false;" class="flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg transition-all">
        <span class="material-symbols-outlined text-[20px]">settings_input_hdmi</span>
        <span class="font-label-sm text-label-sm uppercase tracking-wider">Outputs</span>
      </a>
      <a href="#inputs" id="nav-inputs" onclick="switchTab('inputs'); return false;" class="flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg transition-all">
        <span class="material-symbols-outlined text-[20px]">router</span>
        <span class="font-label-sm text-label-sm uppercase tracking-wider">Inputs</span>
      </a>
      <a href="#cameras" id="nav-cameras" onclick="switchTab('cameras'); return false;" class="flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg transition-all">
        <span class="material-symbols-outlined text-[20px]">videocam</span>
        <span class="font-label-sm text-label-sm uppercase tracking-wider">Cameras</span>
      </a>
      <a href="#renderer" id="nav-renderer" onclick="switchTab('renderer'); return false;" class="flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg transition-all">
        <span class="material-symbols-outlined text-[20px]">layers</span>
        <span class="font-label-sm text-label-sm uppercase tracking-wider">Renderer</span>
      </a>
    </div>
  </nav>

  <script>
    const INITIAL_STATE = ${safeInitialJson};

    const appState = {
      activeTab: INITIAL_STATE.activeTab || "outputs",
      sources: new Map((INITIAL_STATE.sources || []).map(s => [s.id, s])),
      outputs: new Map((INITIAL_STATE.outputs || []).map(o => [o.id, o])),
      effects: new Map((INITIAL_STATE.effects || []).map(e => [e.sourceId, e])),
      cameras: new Map((INITIAL_STATE.cameras || []).map(c => [c.id, c])),
      pipgm: new Map((INITIAL_STATE.pipgmPipelines || []).map(p => [p.id, p])),
      multiviewLayout: (INITIAL_STATE.multiview && INITIAL_STATE.multiview.layout) || "auto",
      matrix: INITIAL_STATE.matrix || { locked: false, routes: { 1: 1, 2: 2, 3: null, 4: 3 } },
      rtspOut: INITIAL_STATE.rtspOut || { sourceId: "rtmp1", layout: "landscape", url: "rtsp://pimatrix.local:554/live" },
      // Track last selected input on each HDMI column so input-specific FTB/Mute always has a target
      selectedInputByHdmi: {
        1: "PiPGM1",
        2: "PiPGM2"
      },
      auxModalTargetHdmi: 1,
      activeCameraId: "cam1",
      isSingleCamFocus: false,
      savePresetMode: false,
      thumbCaptureMode: false,
      presetViewMode: "name",
      ptzSpeed: 12,
      activePresetByCam: { cam1: 1, cam2: 1 },
      capturedThumbs: {}
    };

    // Initialize selectedInputByHdmi from backend output state if already routed
    const initHdmi0 = appState.outputs.get("hdmi0");
    if (initHdmi0 && (initHdmi0.observedSource || initHdmi0.desiredSource)) {
      appState.selectedInputByHdmi[1] = initHdmi0.observedSource || initHdmi0.desiredSource;
    }
    const initHdmi1 = appState.outputs.get("hdmi1");
    if (initHdmi1 && (initHdmi1.observedSource || initHdmi1.desiredSource)) {
      appState.selectedInputByHdmi[2] = initHdmi1.observedSource || initHdmi1.desiredSource;
    }

    // Fallback for browsers without <dialog closedby> support (modern-web-guidance: light-dismiss-a-dialog)
    const auxDialog = document.getElementById("aux-modal-overlay");
    if (auxDialog && !("closedBy" in HTMLDialogElement.prototype)) {
      auxDialog.addEventListener("click", (event) => {
        if (event.target !== auxDialog) return;
        const rect = auxDialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        auxDialog.close();
      });
    }

    let toastTimer = null;
    function showToast(message) {
      const toast = document.getElementById("toast");
      const text = document.getElementById("toast-text");
      if (!toast || !text) return;
      text.textContent = message;
      toast.classList.remove("opacity-0", "translate-y-2");
      toast.classList.add("opacity-100", "translate-y-0");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.add("opacity-0", "translate-y-2");
        toast.classList.remove("opacity-100", "translate-y-0");
      }, 1800);
    }

    function formatSourceDisplay(sourceId) {
      if (!sourceId) return "UNROUTED";
      if (sourceId === "PiPGM1") return "pipgm 1";
      if (sourceId === "PiPGM2") return "pipgm 2";
      if (sourceId === "PiPGM3") return "pipgm 3";
      if (sourceId === "multiview") {
        const mode = appState.multiviewLayout === "portrait" ? "2x4" : "4x2";
        return "MULTIVIEW (" + mode + ")";
      }
      return sourceId;
    }

    // =========================================================================
    // TAB NAVIGATION
    // =========================================================================
    function switchTab(tabId) {
      appState.activeTab = tabId;
      const tabs = ["outputs", "inputs", "cameras", "renderer"];
      for (const id of tabs) {
        const panel = document.getElementById("tab-" + id);
        const nav = document.getElementById("nav-" + id);
        if (panel) {
          panel.classList.toggle("active", id === tabId);
        }
        if (nav) {
          if (id === tabId) {
            nav.className = "flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg transition-all bg-surface-container-highest text-primary font-bold";
            nav.setAttribute("aria-current", "page");
          } else {
            nav.className = "flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg text-on-surface-variant hover:text-on-surface transition-all";
            nav.removeAttribute("aria-current");
          }
        }
      }

      const headerTitle = document.getElementById("header-title");
      const headerSubtitle = document.getElementById("header-subtitle");
      const headerIcon = document.getElementById("header-icon");
      const lockBtn = document.getElementById("lockToggleBtn");
      const camViewBtn = document.getElementById("toggleViewBtn");

      if (lockBtn) lockBtn.className = tabId === "inputs" ? "flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95" : "hidden";
      if (camViewBtn) camViewBtn.className = tabId === "cameras" ? "flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-primary text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95" : "hidden";

      if (tabId === "outputs") {
        headerTitle.textContent = "PiMatrix";
        headerSubtitle.textContent = "Pi Outputs";
        headerIcon.textContent = "crop_free";
      } else if (tabId === "inputs") {
        headerTitle.textContent = "PiMatrix";
        headerSubtitle.textContent = "Matrix Routing";
        headerIcon.textContent = "router";
      } else if (tabId === "cameras") {
        headerTitle.textContent = "PiMatrix";
        headerSubtitle.textContent = "Camera Control";
        headerIcon.textContent = "videocam";
      } else if (tabId === "renderer") {
        headerTitle.textContent = "PiPGM";
        headerSubtitle.textContent = "Renderer";
        headerIcon.textContent = "layers";
      }

      if (window.location.hash !== "#" + tabId) {
        history.replaceState(null, "", "#" + tabId);
      }
    }

    // =========================================================================
    // TAB 1: OUTPUTS & INPUT-SPECIFIC FTB / MUTE
    // =========================================================================
    function getEffectiveOutputSource(hdmiNum) {
      const outputId = hdmiNum === 1 ? "hdmi0" : "hdmi1";
      const out = appState.outputs.get(outputId);
      const routed = out ? (out.observedSource || out.desiredSource) : null;
      return routed || appState.selectedInputByHdmi[hdmiNum] || (hdmiNum === 1 ? "PiPGM1" : "PiPGM2");
    }

    function isInputFtbActive(sourceId) {
      if (!sourceId || sourceId === "multiview") return false;
      const fx = appState.effects.get(sourceId);
      if (fx && typeof fx.fadeToBlack === "boolean") return fx.fadeToBlack;
      const p = appState.pipgm.get(sourceId);
      if (p) return Boolean(p.fadeToBlack);
      return false;
    }

    function isInputMuted(sourceId) {
      if (!sourceId || sourceId === "multiview") return false;
      const fx = appState.effects.get(sourceId);
      if (fx && typeof fx.muted === "boolean") return fx.muted;
      const p = appState.pipgm.get(sourceId);
      if (p) return !p.audioEnabled;
      return false;
    }

    async function selectHdmiSource(hdmiNum, sourceId) {
      const outputId = hdmiNum === 1 ? "hdmi0" : "hdmi1";
      if (sourceId) {
        appState.selectedInputByHdmi[hdmiNum] = sourceId;
      }
      try {
        const res = await fetch("/api/v1/outputs/" + outputId + "/source", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId })
        });
        if (res.ok) {
          const updated = await res.json();
          appState.outputs.set(outputId, updated);
          renderOutputsTab();
          showToast("HDMI " + hdmiNum + " ➔ " + formatSourceDisplay(sourceId).toUpperCase());
        } else {
          showToast("Failed to route HDMI " + hdmiNum);
        }
      } catch (err) {
        showToast("Network error routing HDMI " + hdmiNum);
      }
    }

    function openAuxModal(hdmiNum) {
      appState.auxModalTargetHdmi = hdmiNum;
      const label = document.getElementById("aux-target-label");
      if (label) label.textContent = "Assigning to HDMI " + hdmiNum + " (Pi " + hdmiNum + ")";
      if (auxDialog && typeof auxDialog.showModal === "function") {
        auxDialog.showModal();
      }
    }

    function closeAuxModal() {
      if (auxDialog && auxDialog.open) {
        auxDialog.close();
      }
    }

    async function confirmAuxPick(sourceId, layoutMode) {
      closeAuxModal();
      const hdmiNum = appState.auxModalTargetHdmi;
      if (sourceId === "multiview" && layoutMode) {
        try {
          const mvRes = await fetch("/api/v1/outputs/multiview/layout", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layout: layoutMode })
          });
          if (mvRes.ok) {
            const mv = await mvRes.json();
            appState.multiviewLayout = mv.layout;
          }
        } catch {}
      }
      await selectHdmiSource(hdmiNum, sourceId);
    }

    async function toggleOutputInputControl(hdmiNum, controlKind) {
      const sourceId = getEffectiveOutputSource(hdmiNum);
      if (!sourceId || sourceId === "multiview") {
        showToast("Select a specific input source first");
        return;
      }
      await toggleSourceEffectControl(sourceId, controlKind);
    }

    async function toggleSourceEffectControl(sourceId, controlKind) {
      const endpoint = "/api/v1/sources/" + encodeURIComponent(sourceId) + "/effects/" + (controlKind === "ftb" ? "ftb" : "mute");
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toggle: true })
        });
        if (res.ok) {
          const updated = await res.json();
          appState.effects.set(sourceId, updated);
          if (appState.pipgm.has(sourceId)) {
            const p = appState.pipgm.get(sourceId);
            p.fadeToBlack = updated.fadeToBlack;
            p.audioEnabled = !updated.muted;
          }
          renderOutputsTab();
          renderInputsTab();
          const stateText = controlKind === "ftb"
            ? (updated.fadeToBlack ? "FTB ACTIVE" : "FTB OFF")
            : (updated.muted ? "MUTED" : "AUDIO ON");
          showToast(formatSourceDisplay(sourceId).toUpperCase() + ": " + stateText);
        }
      } catch (err) {
        showToast("Failed to update " + controlKind.toUpperCase());
      }
    }

    function toggleRtspDialog() {
      const box = document.getElementById("rtsp-dialog-box");
      if (box) {
        box.classList.toggle("hidden");
      }
    }

    async function assignRtsp(sourceId, layoutMode) {
      try {
        const res = await fetch("/api/v1/outputs/rtsp/source", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId, ...(layoutMode ? { layout: layoutMode } : {}) })
        });
        if (res.ok) {
          const updated = await res.json();
          appState.rtspOut = updated;
          if (layoutMode) {
            appState.multiviewLayout = layoutMode;
          }
          renderOutputsTab();
          showToast("RTSP Out ➔ " + formatSourceDisplay(sourceId).toUpperCase());
        }
      } catch {
        showToast("Failed to assign RTSP stream");
      }
    }

    function renderOutputsTab() {
      const directSources = ["hama", "rtmp1", "rtmp2", "PiPGM1", "PiPGM2"];
      const auxSources = ["cam1", "cam2", "cam3", "multiview"];

      for (const hdmiNum of [1, 2]) {
        const outputId = hdmiNum === 1 ? "hdmi0" : "hdmi1";
        const out = appState.outputs.get(outputId);
        const activeSource = out ? (out.observedSource || out.desiredSource) : null;
        const effectiveTarget = activeSource || appState.selectedInputByHdmi[hdmiNum];

        const activeLabel = document.getElementById("hdmi" + hdmiNum + "-active-label");
        if (activeLabel) {
          activeLabel.textContent = activeSource ? formatSourceDisplay(activeSource) : "Standby";
        }

        const ctrlTarget = document.getElementById("hdmi" + hdmiNum + "-ctrl-target");
        if (ctrlTarget) {
          ctrlTarget.textContent = formatSourceDisplay(effectiveTarget);
        }

        // Update direct input buttons
        const btns = document.querySelectorAll(".hdmi" + hdmiNum + "-btn");
        btns.forEach(btn => {
          const src = btn.getAttribute("data-source");
          const isSelected = activeSource === src;
          const isFtb = isInputFtbActive(src);
          const isMuted = isInputMuted(src);

          if (isSelected) {
            btn.className = "hdmi" + hdmiNum + "-btn w-full h-8 px-2 rounded-lg bg-primary-container text-on-primary font-bold active:scale-[0.98] font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-sm";
          } else {
            btn.className = "hdmi" + hdmiNum + "-btn w-full h-8 px-2 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface font-label-md text-[12px] uppercase transition-all flex items-center justify-between shadow-xs";
          }

          const ind = btn.querySelector(".btn-indicators");
          if (ind) {
            let badges = "";
            if (isFtb) {
              badges += '<span class="px-1 py-0.2 rounded bg-error text-on-error text-[8px] font-bold">FTB</span>';
            }
            if (isMuted) {
              badges += '<span class="material-symbols-outlined text-[12px] opacity-80">volume_off</span>';
            }
            badges += '<span class="w-1.5 h-1.5 rounded-full ' + (isSelected ? "bg-on-primary" : "bg-transparent") + '"></span>';
            ind.innerHTML = badges;
          }
        });

        // Update Auxiliary button state
        const auxBtn = document.getElementById("hdmi" + hdmiNum + "-aux-btn");
        const auxLabel = document.getElementById("hdmi" + hdmiNum + "-aux-label");
        const auxIcon = document.getElementById("hdmi" + hdmiNum + "-aux-icon");
        if (auxBtn && auxLabel && auxIcon) {
          if (activeSource && auxSources.includes(activeSource)) {
            auxBtn.className = "w-full p-1.5 rounded-lg bg-primary-container text-on-primary text-left active:scale-[0.98] transition-all flex flex-col gap-0.5 shadow-sm";
            auxLabel.className = "font-label-md text-[11px] font-bold uppercase flex items-center gap-1 text-on-primary";
            const iconName = activeSource === "multiview" ? "grid_view" : "videocam";
            auxLabel.innerHTML = '<span class="material-symbols-outlined text-[13px]">' + iconName + '</span>AUX: ' + formatSourceDisplay(activeSource);
            auxIcon.className = "material-symbols-outlined text-[14px] text-on-primary";
            auxIcon.textContent = "check_circle";
          } else {
            auxBtn.className = "w-full p-1.5 rounded-lg border border-dashed border-primary/40 bg-surface-container hover:bg-surface-container-high text-left active:scale-[0.98] transition-all flex flex-col gap-0.5";
            auxLabel.className = "font-label-md text-[11px] font-bold text-primary uppercase flex items-center gap-1";
            auxLabel.innerHTML = '<span class="material-symbols-outlined text-[13px]">tune</span>Auxiliary';
            auxIcon.className = "material-symbols-outlined text-[14px] text-primary";
            auxIcon.textContent = "touch_app";
          }
        }

        // Update FTB & Mute buttons for the selected input on this HDMI column
        const ftbActive = isInputFtbActive(effectiveTarget);
        const muteActive = isInputMuted(effectiveTarget);
        const ftbBtn = document.getElementById("btn-ftb-" + hdmiNum);
        const ftbPill = document.getElementById("hdmi" + hdmiNum + "-ftb-pill");
        const muteBtn = document.getElementById("btn-mute-" + hdmiNum);
        const muteIcon = document.getElementById("icon-mute-" + hdmiNum);
        const muteLabel = document.getElementById("label-mute-" + hdmiNum);

        if (ftbPill) {
          ftbPill.className = ftbActive
            ? "px-1.5 py-0.5 rounded-full bg-error text-on-error text-[9px] font-label-sm font-bold uppercase animate-pulse"
            : "hidden";
        }
        if (ftbBtn) {
          ftbBtn.className = ftbActive
            ? "flex-1 h-8 rounded-lg bg-error text-on-error active:scale-[0.98] font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-sm"
            : "flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-error/20 active:scale-[0.98] text-error font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs";
        }
        if (muteBtn && muteIcon && muteLabel) {
          if (muteActive) {
            muteBtn.className = "flex-1 h-8 rounded-lg bg-tertiary-container text-on-tertiary-container active:scale-[0.98] font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-sm";
            muteIcon.textContent = "volume_off";
            muteLabel.textContent = "Muted";
          } else {
            muteBtn.className = "flex-1 h-8 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] text-on-surface-variant font-label-sm text-[11px] font-bold flex items-center justify-center gap-1 transition-all shadow-xs";
            muteIcon.textContent = "volume_up";
            muteLabel.textContent = "Mute";
          }
        }

        // Update "Routed To" badges from Atlona matrix state (input 3 = Pi 1, input 4 = Pi 2)
        const matrixInputNum = hdmiNum === 1 ? 3 : 4;
        const destLabels = { 1: "Proj 1", 2: "Proj 2", 4: "Mixer" };
        const matchedDests = [];
        for (const [outKey, inVal] of Object.entries(appState.matrix.routes || {})) {
          if (Number(inVal) === matrixInputNum && destLabels[outKey]) {
            matchedDests.push(destLabels[outKey]);
          }
        }
        const badgeContainer = document.getElementById("hdmi" + hdmiNum + "-routed-badges");
        if (badgeContainer) {
          if (matchedDests.length > 0) {
            badgeContainer.innerHTML = matchedDests
              .map(d => '<span class="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed border border-primary/20 font-label-sm text-[9px] font-bold leading-none">' + d + '</span>')
              .join("");
          } else {
            badgeContainer.innerHTML = '<span class="px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface-variant font-label-sm text-[9px] font-semibold leading-none">Unrouted</span>';
          }
        }
      }

      // Update RTSP card
      const rtspLabel = document.getElementById("rtsp-current-assign");
      if (rtspLabel) {
        rtspLabel.textContent = appState.rtspOut.sourceId === "multiview"
          ? "MV (" + (appState.rtspOut.layout === "portrait" ? "2x4" : "4x2") + ")"
          : formatSourceDisplay(appState.rtspOut.sourceId);
      }
      const rtspBtns = document.querySelectorAll(".rtsp-choice-btn");
      rtspBtns.forEach(btn => {
        const key = btn.getAttribute("data-rtsp");
        const activeKey = appState.rtspOut.sourceId === "multiview"
          ? "multiview:" + (appState.rtspOut.layout || "landscape")
          : appState.rtspOut.sourceId;
        if (key === activeKey) {
          btn.classList.add("ring-2", "ring-primary", "bg-primary", "text-on-primary");
          btn.classList.remove("bg-surface-container-highest", "text-on-surface");
        } else {
          btn.classList.remove("ring-2", "ring-primary", "bg-primary", "text-on-primary");
          btn.classList.add("bg-surface-container-highest", "text-on-surface");
        }
      });
    }

    // =========================================================================
    // TAB 2: INPUTS & ATLONA MATRIX ROUTING
    // =========================================================================
    async function toggleMatrixLock() {
      const nextLocked = !appState.matrix.locked;
      try {
        const res = await fetch("/api/v1/matrix/lock", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locked: nextLocked })
        });
        if (res.ok) {
          appState.matrix = await res.json();
        } else {
          appState.matrix.locked = nextLocked;
        }
      } catch {
        appState.matrix.locked = nextLocked;
      }
      renderInputsTab();
      showToast(appState.matrix.locked ? "SAFETY LOCK ACTIVE — SWITCHING BLOCKED" : "MATRIX UNLOCKED — LIVE SWITCHING READY");
    }

    async function routeMatrixCrosspoint(input, output) {
      if (appState.matrix.locked) {
        showToast("CANNOT ROUTE: MATRIX IS LOCKED");
        return;
      }
      try {
        const res = await fetch("/api/v1/matrix/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input, output })
        });
        if (res.ok) {
          appState.matrix.routes[output] = input;
          renderInputsTab();
          renderOutputsTab();
          const inputNames = { 1: "Lectern", 2: "Rack PC", 3: "Pi 1", 4: "Pi 2" };
          const outputNames = { 1: "PRJ1", 2: "PRJ2", 4: "MIXER" };
          showToast("SWITCHED: " + (outputNames[output] || ("OUT " + output)) + " ➔ " + (inputNames[input] || ("IN " + input)));
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.error?.message || "Matrix route failed");
        }
      } catch {
        showToast("Network error requesting matrix route");
      }
    }

    function renderInputsTab() {
      const lockIcon = document.getElementById("lockIcon");
      const lockLabel = document.getElementById("lockLabel");
      if (lockIcon && lockLabel) {
        if (appState.matrix.locked) {
          lockIcon.textContent = "lock";
          lockLabel.textContent = "LOCKED";
          lockIcon.className = "material-symbols-outlined text-[14px] text-error";
          lockLabel.className = "text-error";
        } else {
          lockIcon.textContent = "lock_open";
          lockLabel.textContent = "UNLOCKED";
          lockIcon.className = "material-symbols-outlined text-[14px] text-tertiary";
          lockLabel.className = "text-tertiary";
        }
      }

      const inputNames = { 1: "LECTERN", 2: "RACK PC", 3: "PI 1", 4: "PI 2" };
      const containers = document.querySelectorAll("[data-output]");
      containers.forEach(container => {
        const outNum = Number(container.getAttribute("data-output"));
        const activeIn = Number(appState.matrix.routes[outNum] || 0);
        const statusEl = document.getElementById("matrix-out-" + outNum + "-status");
        if (statusEl && activeIn) {
          statusEl.textContent = "IN " + activeIn + " • " + (inputNames[activeIn] || "");
        }

        const buttons = container.querySelectorAll(".matrix-btn");
        buttons.forEach(btn => {
          const inNum = Number(btn.getAttribute("data-input"));
          const sub = btn.querySelector(".matrix-sub");
          if (inNum === activeIn) {
            btn.className = "matrix-btn h-12 flex flex-col items-center justify-center rounded bg-primary-container text-on-primary shadow-md transition-all active:scale-95";
            if (sub) {
              sub.className = "matrix-sub font-label-sm text-[9px] uppercase tracking-tighter text-on-primary/90 flex items-center gap-0.5";
              sub.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-surface-container-lowest"></span>LIVE';
            }
          } else {
            btn.className = "matrix-btn h-12 flex flex-col items-center justify-center rounded bg-surface-container-low hover:bg-surface-container-highest text-on-surface shadow-xs transition-all active:scale-95";
            if (sub) {
              sub.className = "matrix-sub font-label-sm text-[9px] uppercase tracking-tighter text-on-surface-variant";
              sub.textContent = "READY";
            }
          }
        });
      });

      // Render Per-Input FTB & Mute Grid
      const grid = document.getElementById("per-input-ftb-grid");
      if (grid) {
        const inputIds = ["hama", "rtmp1", "rtmp2", "cam1", "cam2", "cam3", "PiPGM1", "PiPGM2"];
        grid.innerHTML = inputIds.map(id => {
          const ftb = isInputFtbActive(id);
          const muted = isInputMuted(id);
          return \`
            <div class="p-2 rounded-lg bg-surface-container flex flex-col gap-1.5 border border-outline-variant/30">
              <div class="flex items-center justify-between">
                <span class="font-label-md text-[11px] font-bold uppercase text-on-surface">\${formatSourceDisplay(id)}</span>
                <span class="w-2 h-2 rounded-full \${ftb ? 'bg-error animate-pulse' : 'bg-emerald-500'}"></span>
              </div>
              <div class="flex items-center gap-1">
                <button type="button" onclick="toggleSourceEffectControl('\${id}', 'ftb')" class="flex-1 py-1 rounded font-label-sm text-[9px] font-bold uppercase transition-all \${ftb ? 'bg-error text-on-error shadow-xs' : 'bg-surface-container-highest text-on-surface-variant hover:text-error'}">
                  \${ftb ? 'FTB ON' : 'FTB'}
                </button>
                <button type="button" onclick="toggleSourceEffectControl('\${id}', 'mute')" class="flex-1 py-1 rounded font-label-sm text-[9px] font-bold uppercase transition-all \${muted ? 'bg-tertiary-container text-on-tertiary-container shadow-xs' : 'bg-surface-container-highest text-on-surface-variant'}">
                  \${muted ? 'MUTED' : 'AUDIO'}
                </button>
              </div>
            </div>
          \`;
        }).join("");
      }
    }

    // =========================================================================
    // TAB 3: CAMERAS & PTZ CONTROL
    // =========================================================================
    const DEFAULT_PRESET_NAMES = {
      cam1: {
        1: "Wide Altar",
        2: "Lectern Close",
        3: "Choir Bank",
        4: "Baptismal",
        5: "Wide Hall",
        6: "Organ Loft"
      },
      cam2: {
        1: "Altar Wide",
        2: "Pulpit Tight",
        3: "Communion",
        4: "Choir Master",
        5: "Balcony Cent.",
        6: "Podium Ret."
      }
    };

    function selectCamera(camId) {
      appState.activeCameraId = camId;
      renderCamerasTab();
      showToast((camId === "cam1" ? "Camera 01" : "Camera 02") + " selected for PTZ driving");
    }

    function toggleCamFocus() {
      appState.isSingleCamFocus = !appState.isSingleCamFocus;
      const monitors = document.getElementById("monitorsContainer");
      const card1 = document.getElementById("cam-card-1");
      const card2 = document.getElementById("cam-card-2");
      const label = document.getElementById("viewModeLabel");

      if (appState.isSingleCamFocus) {
        monitors.classList.remove("grid-cols-2");
        monitors.classList.add("grid-cols-1");
        if (appState.activeCameraId === "cam1") {
          card1.classList.remove("hidden");
          card2.classList.add("hidden");
        } else {
          card2.classList.remove("hidden");
          card1.classList.add("hidden");
        }
        if (label) label.textContent = "Single Focus";
      } else {
        monitors.classList.add("grid-cols-2");
        monitors.classList.remove("grid-cols-1");
        card1.classList.remove("hidden");
        card2.classList.remove("hidden");
        if (label) label.textContent = "Dual View";
      }
    }

    function toggleSavePresetMode() {
      appState.savePresetMode = !appState.savePresetMode;
      const pill = document.getElementById("savePresetPill");
      const knob = document.getElementById("savePresetKnob");
      const sub = document.getElementById("savePresetSub");
      if (appState.savePresetMode) {
        pill.classList.replace("bg-surface-container-highest", "bg-primary");
        knob.classList.add("translate-x-3.5", "bg-white");
        knob.classList.remove("bg-outline");
        if (sub) sub.textContent = "ARMED: Tap slot to save";
        showToast("SAVE PRESET MODE ARMED — Tap any preset slot to store current PTZ position");
      } else {
        pill.classList.replace("bg-primary", "bg-surface-container-highest");
        knob.classList.remove("translate-x-3.5", "bg-white");
        knob.classList.add("bg-outline");
        if (sub) sub.textContent = "Tap slot to store";
      }
      renderCameraPresets();
    }

    function toggleThumbCaptureMode() {
      appState.thumbCaptureMode = !appState.thumbCaptureMode;
      const pill = document.getElementById("thumbPill");
      const knob = document.getElementById("thumbKnob");
      if (appState.thumbCaptureMode) {
        pill.classList.replace("bg-surface-container-highest", "bg-secondary");
        knob.classList.add("translate-x-3.5", "bg-white");
        knob.classList.remove("bg-outline");
        showToast("THUMB CAPTURE ARMED — Tap preset to snapshot");
      } else {
        pill.classList.replace("bg-secondary", "bg-surface-container-highest");
        knob.classList.remove("translate-x-3.5", "bg-white");
        knob.classList.add("bg-outline");
      }
    }

    function setPresetViewMode(mode) {
      appState.presetViewMode = mode;
      document.querySelectorAll(".preset-view-mode-btn").forEach(btn => {
        if (btn.getAttribute("data-mode") === mode) {
          btn.className = "preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase font-bold bg-surface text-primary shadow-sm";
        } else {
          btn.className = "preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase text-on-surface-variant";
        }
      });
      renderCameraPresets();
    }

    function parseVisiblePresetSlots() {
      const input = document.getElementById("presetRangeInput");
      const raw = (input && input.value) ? input.value : "1, 2, 3, 4, 5, 6";
      const slots = [];
      for (const part of raw.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        if (trimmed.includes("-")) {
          const [startStr, endStr] = trimmed.split("-");
          const start = Number(startStr);
          const end = Number(endStr);
          if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 254 && start <= end) {
            for (let i = start; i <= Math.min(end, start + 23); i++) slots.push(i);
          }
        } else {
          const num = Number(trimmed);
          if (Number.isInteger(num) && num >= 0 && num <= 254) slots.push(num);
        }
      }
      return slots.length > 0 ? slots : [1, 2, 3, 4, 5, 6];
    }

    function getPresetName(camId, presetId) {
      const cam = appState.cameras.get(camId);
      if (cam && Array.isArray(cam.presets)) {
        const found = cam.presets.find(p => p.id === presetId);
        if (found && found.name) return found.name;
      }
      return (DEFAULT_PRESET_NAMES[camId] && DEFAULT_PRESET_NAMES[camId][presetId]) || ("Preset " + presetId);
    }

    async function handlePresetClick(camId, presetId) {
      appState.activeCameraId = camId;
      if (appState.thumbCaptureMode) {
        appState.capturedThumbs[camId + ":" + presetId] = new Date().toLocaleTimeString();
        showToast(camId.toUpperCase() + " Preset " + presetId + ": Thumbnail captured");
        renderCameraPresets();
        return;
      }

      if (appState.savePresetMode) {
        const currentName = getPresetName(camId, presetId);
        try {
          const res = await fetch("/api/v1/cameras/" + camId + "/presets/" + presetId + "/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: currentName })
          });
          if (res.ok) {
            const camRes = await fetch("/api/v1/cameras/" + camId);
            if (camRes.ok) appState.cameras.set(camId, await camRes.json());
            appState.activePresetByCam[camId] = presetId;
            toggleSavePresetMode();
            renderCamerasTab();
            showToast(camId.toUpperCase() + " Preset " + presetId + " (" + currentName + ") SAVED");
          }
        } catch {
          showToast("Failed to save preset");
        }
        return;
      }

      try {
        const res = await fetch("/api/v1/cameras/" + camId + "/presets/" + presetId + "/recall", {
          method: "POST"
        });
        if (res.ok) {
          const camRes = await fetch("/api/v1/cameras/" + camId);
          if (camRes.ok) appState.cameras.set(camId, await camRes.json());
          appState.activePresetByCam[camId] = presetId;
          renderCamerasTab();
          showToast(camId.toUpperCase() + " Preset " + String(presetId).padStart(2, "0") + ": \\"" + getPresetName(camId, presetId) + "\\" recalled");
        }
      } catch {
        showToast("Failed to recall preset");
      }
    }

    function adjustPtzSpeed(delta) {
      appState.ptzSpeed = Math.max(1, Math.min(24, appState.ptzSpeed + delta));
      const hex = "0x" + appState.ptzSpeed.toString(16).toUpperCase().padStart(2, "0");
      const label = document.getElementById("ptz-speed-label");
      const bar = document.getElementById("ptz-speed-bar");
      if (label) label.textContent = "SPD " + appState.ptzSpeed + " (" + hex + ")";
      if (bar) bar.style.width = Math.round((appState.ptzSpeed / 24) * 100) + "%";
    }

    async function sendPTZMove(direction) {
      const camId = appState.activeCameraId || "cam1";
      const panSpeed = appState.ptzSpeed;
      const tiltSpeed = Math.min(23, appState.ptzSpeed);
      try {
        const res = await fetch("/api/v1/cameras/" + camId + "/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction, panSpeed, tiltSpeed })
        });
        if (res.ok) {
          const camRes = await fetch("/api/v1/cameras/" + camId);
          if (camRes.ok) appState.cameras.set(camId, await camRes.json());
          renderCamerasTab();
          showToast(camId.toUpperCase() + ": MOVE " + direction.toUpperCase());
        }
      } catch {
        showToast("PTZ move failed");
      }
    }

    async function sendPTZZoom(action) {
      const camId = appState.activeCameraId || "cam1";
      const speed = Math.min(7, Math.max(1, Math.round(appState.ptzSpeed / 3)));
      try {
        const res = await fetch("/api/v1/cameras/" + camId + "/zoom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, speed })
        });
        if (res.ok) {
          const camRes = await fetch("/api/v1/cameras/" + camId);
          if (camRes.ok) appState.cameras.set(camId, await camRes.json());
          renderCamerasTab();
          showToast(camId.toUpperCase() + ": ZOOM " + action.toUpperCase());
        }
      } catch {
        showToast("PTZ zoom failed");
      }
    }

    async function sendSmartFrame(mode) {
      const camId = appState.activeCameraId || "cam1";
      try {
        const res = await fetch("/api/v1/cameras/" + camId + "/smartframe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode })
        });
        if (res.ok) {
          const camRes = await fetch("/api/v1/cameras/" + camId);
          if (camRes.ok) appState.cameras.set(camId, await camRes.json());
          renderCamerasTab();
          showToast(camId.toUpperCase() + ": SmartFrame " + mode.toUpperCase());
        }
      } catch {
        showToast("SmartFrame command failed");
      }
    }

    async function toggleCameraStream(camId) {
      const cam = appState.cameras.get(camId);
      const isStreaming = cam && cam.streaming;
      const action = isStreaming ? "stop" : "start";
      try {
        const res = await fetch("/api/v1/cameras/" + camId + "/stream/" + action, {
          method: "POST"
        });
        if (res.ok) {
          const camRes = await fetch("/api/v1/cameras/" + camId);
          if (camRes.ok) appState.cameras.set(camId, await camRes.json());
          renderCamerasTab();
          showToast(camId.toUpperCase() + " stream " + (action === "start" ? "STARTED" : "STOPPED"));
        }
      } catch {
        showToast("Failed to toggle camera stream");
      }
    }

    function renderCameraPresets() {
      const slots = parseVisiblePresetSlots();
      for (const [idx, camId] of [[1, "cam1"], [2, "cam2"]]) {
        const grid = document.getElementById("cam" + idx + "-presets-grid");
        if (!grid) continue;
        const activePreset = appState.activePresetByCam[camId] || 1;
        const activeColor = idx === 1 ? "bg-primary text-on-primary" : "bg-secondary text-on-secondary";
        const numColor = idx === 1 ? "text-primary" : "text-secondary";

        grid.innerHTML = slots.map(slot => {
          const isSelected = activePreset === slot;
          const name = getPresetName(camId, slot);
          const padNum = String(slot).padStart(2, "0");
          const thumbStamp = appState.capturedThumbs[camId + ":" + slot];

          let bodyHtml = "";
          if (appState.presetViewMode === "number") {
            bodyHtml = '<span class="font-headline-sm text-[18px] font-bold">' + padNum + '</span>';
          } else if (appState.presetViewMode === "thumb") {
            bodyHtml = '<span class="font-label-sm text-[10px] font-bold">' + padNum + " • " + name + '</span>' +
              '<span class="font-label-sm text-[9px] opacity-75">' + (thumbStamp ? ("SNAP " + thumbStamp) : "LIVE THUMB") + '</span>';
          } else {
            bodyHtml = '<span class="font-label-sm text-label-sm ' + (isSelected ? "" : numColor) + ' font-bold">' + padNum + '</span>' +
              '<span class="font-label-md text-label-md font-semibold leading-tight line-clamp-1">' + name + '</span>';
          }

          return \`
            <button type="button" onclick="handlePresetClick('\${camId}', \${slot})" class="group relative flex flex-col items-start justify-between p-2 rounded-lg \${isSelected ? activeColor + ' shadow-sm' : 'bg-surface-container hover:bg-surface-container-high text-on-surface shadow-xs'} transition-all text-left min-h-[48px]">
              \${bodyHtml}
            </button>
          \`;
        }).join("");
      }
    }

    function renderCamerasTab() {
      const isCam1 = appState.activeCameraId === "cam1";
      const glow1 = document.getElementById("cam-glow-1");
      const glow2 = document.getElementById("cam-glow-2");
      const badge1 = document.getElementById("cam-badge-1");
      const badge2 = document.getElementById("cam-badge-2");
      const ind1 = document.getElementById("cam-select-indicator-1");
      const ind2 = document.getElementById("cam-select-indicator-2");
      const targetLabel = document.getElementById("target-indicator");
      const paramTitle = document.getElementById("param-matrix-title");

      if (isCam1) {
        if (glow1) glow1.className = "h-1.5 w-full bg-primary transition-colors";
        if (glow2) glow2.className = "h-1.5 w-full bg-surface-variant transition-colors";
        if (badge1) badge1.className = "px-1.5 py-0.5 rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold shadow-sm";
        if (badge2) badge2.className = "px-1.5 py-0.5 rounded bg-surface-container-lowest/90 text-on-surface font-label-sm text-label-sm font-bold shadow-sm";
        if (ind1) ind1.classList.remove("hidden");
        if (ind2) ind2.classList.add("hidden");
        if (targetLabel) {
          targetLabel.textContent = "TARGET: CAM 01 (STAGE LEFT)";
          targetLabel.className = "px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm font-bold uppercase";
        }
        if (paramTitle) paramTitle.textContent = "CAM 01 PARAMETER MATRIX";
      } else {
        if (glow1) glow1.className = "h-1.5 w-full bg-surface-variant transition-colors";
        if (glow2) glow2.className = "h-1.5 w-full bg-secondary transition-colors";
        if (badge1) badge1.className = "px-1.5 py-0.5 rounded bg-surface-container-lowest/90 text-on-surface font-label-sm text-label-sm font-bold shadow-sm";
        if (badge2) badge2.className = "px-1.5 py-0.5 rounded bg-secondary text-on-secondary font-label-sm text-label-sm font-bold shadow-sm";
        if (ind1) ind1.classList.add("hidden");
        if (ind2) ind2.classList.remove("hidden");
        if (targetLabel) {
          targetLabel.textContent = "TARGET: CAM 02 (PULPIT/ALTAR)";
          targetLabel.className = "px-2 py-0.5 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-bold uppercase";
        }
        if (paramTitle) paramTitle.textContent = "CAM 02 PARAMETER MATRIX";
      }

      for (const [idx, camId] of [[1, "cam1"], [2, "cam2"]]) {
        const cam = appState.cameras.get(camId);
        if (!cam) continue;
        const posEl = document.getElementById("cam-pos-" + idx);
        if (posEl && cam.position) {
          posEl.textContent = "P:" + cam.position.pan + " T:" + cam.position.tilt + " Z:" + cam.position.zoom;
        }
        const sfEl = document.getElementById("cam" + idx + "-sf-badge");
        if (sfEl) {
          sfEl.textContent = "SmartFrame: " + String(cam.smartFrame || "disabled").toUpperCase();
        }
        const streamBtn = document.getElementById("cam-stream-btn-" + idx);
        if (streamBtn) {
          streamBtn.textContent = cam.streaming ? "Stop Stream" : "Start Stream";
          streamBtn.className = cam.streaming
            ? "px-1.5 py-0.5 rounded bg-error text-on-error font-label-sm text-[9px] font-bold uppercase shadow-xs"
            : "px-1.5 py-0.5 rounded bg-surface-container-lowest text-primary font-label-sm text-[9px] font-bold uppercase shadow-xs";
        }
      }

      renderCameraPresets();
    }

    // =========================================================================
    // REAL-TIME SSE CONNECTION (/api/v1/events)
    // =========================================================================
    function connectSse() {
      const sse = new EventSource("/api/v1/events");
      const dot = document.getElementById("sse-dot");
      const text = document.getElementById("sse-status-text");

      sse.addEventListener("open", () => {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-primary animate-pulse";
        if (text) text.textContent = "ONLINE";
      });

      sse.addEventListener("output", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.output) {
            appState.outputs.set(payload.output.id, payload.output);
            renderOutputsTab();
          }
        } catch {}
      });

      sse.addEventListener("effects", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.sourceId && payload.effects) {
            appState.effects.set(payload.sourceId, payload.effects);
            renderOutputsTab();
            renderInputsTab();
          }
        } catch {}
      });

      sse.addEventListener("pipgm", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.pipeline) {
            appState.pipgm.set(payload.pipeline.id, payload.pipeline);
            renderOutputsTab();
            renderInputsTab();
          }
        } catch {}
      });

      sse.addEventListener("matrix", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload) {
            appState.matrix = {
              locked: Boolean(payload.locked),
              routes: payload.routes || appState.matrix.routes
            };
            renderInputsTab();
            renderOutputsTab();
          }
        } catch {}
      });

      sse.addEventListener("rtsp", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.sourceId) {
            appState.rtspOut = payload;
            renderOutputsTab();
          }
        } catch {}
      });

      sse.addEventListener("camera", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload && payload.id) {
            const cam = appState.cameras.get(payload.id) || { id: payload.id, position: { pan: 0, tilt: 0, zoom: 0 }, presets: [] };
            if (payload.position) cam.position = payload.position;
            if (payload.smartFrame) cam.smartFrame = payload.smartFrame;
            if (typeof payload.streaming === "boolean") cam.streaming = payload.streaming;
            if (typeof payload.presetId === "number") appState.activePresetByCam[payload.id] = payload.presetId;
            appState.cameras.set(payload.id, cam);
            renderCamerasTab();
          }
        } catch {}
      });

      sse.addEventListener("error", () => {
        if (dot) dot.className = "w-2 h-2 rounded-full bg-error";
        if (text) text.textContent = "RECONNECTING";
      });
    }

    // Boot UI
    (function init() {
      const hash = window.location.hash.replace("#", "");
      if (["outputs", "inputs", "cameras", "renderer"].includes(hash)) {
        appState.activeTab = hash;
      }
      switchTab(appState.activeTab);
      renderOutputsTab();
      renderInputsTab();
      renderCamerasTab();
      connectSse();
    })();
  </script>
</body>
</html>`;
}
