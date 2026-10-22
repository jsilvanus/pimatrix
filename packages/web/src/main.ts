import "./styles.css";
import type {
  CameraSnapshot,
  EffectsPipeline,
  FrontendInitialState,
  FrontendTabId,
  MatrixRouteState,
  OutputSnapshot,
  PiPgmPipelineSnapshot,
  RtspOutState,
  SourceId,
  SourceItem
} from "./types.js";

const DIRECT_HDMI_SOURCES = new Set(["hama", "rtmp1", "rtmp2", "PiPGM1", "PiPGM2"]);
const DIRECT_HDMI_SOURCE_LIST: SourceId[] = ["hama", "rtmp1", "rtmp2", "PiPGM1", "PiPGM2"];
const AUX_CAMERA_SOURCE_LIST: SourceId[] = ["cam1", "cam2", "cam3"];
// NOTE: Future `hama2` source will be added alongside `hama` so we can route uncropped `hama`
// to one destination and cropped `hama2` to another output independently.

const SOURCE_LABELS: Record<string, string> = {
  hama: "hama",
  // hama2: "hama 2 (crop)", // Planned duplicate Hama capture pipeline
  rtmp1: "rtmp1",
  rtmp2: "rtmp2",
  PiPGM1: "pipgm 1",
  PiPGM2: "pipgm 2",
  PiPGM3: "pipgm 3",
  cam1: "cam1",
  cam2: "cam2",
  cam3: "cam3",
  multiview: "multiview"
};

const MATRIX_INPUT_NAMES: Record<number, string> = {
  1: "LECTERN",
  2: "RACK PC",
  3: "PI 1",
  4: "PI 2"
};

const MATRIX_DEST_NAMES: Record<number, string> = {
  1: "Projector 1",
  2: "Projector 2",
  3: "Screen",
  4: "Videomikseri"
};

const DEFAULT_PRESET_NAMES: Record<string, Record<number, string>> = {
  cam1: {
    1: "Pulpit",
    2: "Altar",
    3: "Organ",
    4: "Choir",
    5: "Lectern",
    6: "Wide Hall"
  },
  cam2: {
    1: "Pastor Close",
    2: "Communion",
    3: "Baptismal",
    4: "Band Wide",
    5: "Aisle Center",
    6: "Sanctuary"
  }
};

// Application State
let activeTab: FrontendTabId = "outputs";
const sourcesMap = new Map<string, SourceItem>();
const outputsMap = new Map<string, OutputSnapshot>();
const effectsMap = new Map<string, EffectsPipeline>();
const camerasMap = new Map<string, CameraSnapshot>();
const pipgmMap = new Map<string, PiPgmPipelineSnapshot>();
let multiviewLayout: "auto" | "landscape" | "portrait" = "landscape";
let matrixState: MatrixRouteState = {
  locked: false,
  routes: { 1: 1, 2: 2, 3: null, 4: 3 }
};
let rtspOut: RtspOutState = {
  sourceId: "rtmp1",
  layout: "landscape",
  url: "rtsp://pimatrix.local:554/live",
  streaming: false,
  quality: "full",
  resolution: "1920x1080",
  bitrateKbps: 6200
};

// UI interactive state
let auxModalTargetOutput: 1 | 2 = 1;
let selectedCameraId: "cam1" | "cam2" = "cam1";
let camFocusMode: "dual" | "cam1" | "cam2" = "dual";
let savePresetMode = false;
let thumbCaptureMode = false;
let autoSweepingThumbs = false;
let presetDisplayMode: "name" | "number" | "thumb" = "name";
let ptzSpeed = 12;
const activePresetByCam: Record<"cam1" | "cam2", number> = { cam1: 1, cam2: 1 };

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string): void {
  const toast = document.getElementById("toast");
  const text = document.getElementById("toast-text");
  if (!toast || !text) return;
  text.textContent = msg;
  toast.classList.remove("opacity-0", "translate-y-2");
  toast.classList.add("opacity-100", "translate-y-0");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("opacity-100", "translate-y-0");
    toast.classList.add("opacity-0", "translate-y-2");
  }, 2400);
}

// Generate an SVG data-URL picture for "Not Connected" camera state
function buildNotConnectedDataUrl(camLabel: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#221e1b"/>
        <stop offset="100%" stop-color="#14110f"/>
      </linearGradient>
    </defs>
    <rect width="640" height="360" fill="url(#bg)"/>
    <g stroke="#38322e" stroke-width="1" opacity="0.4">
      <line x1="0" y1="120" x2="640" y2="120"/>
      <line x1="0" y1="240" x2="640" y2="240"/>
      <line x1="213" y1="0" x2="213" y2="360"/>
      <line x1="426" y1="0" x2="426" y2="360"/>
    </g>
    <circle cx="320" cy="145" r="42" fill="#2c2623" stroke="#534b45" stroke-width="2"/>
    <path d="M302 133 h24 a4 4 0 0 1 4 4 v16 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4 v-16 a4 4 0 0 1 4 -4 z M330 140 l12 -7 v24 l-12 -7 z" fill="none" stroke="#9c928b" stroke-width="2.5" stroke-linejoin="round"/>
    <line x1="294" y1="122" x2="346" y2="168" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
    <text x="320" y="218" text-anchor="middle" fill="#e7ded8" font-family="JetBrains Mono, monospace" font-size="16" font-weight="700" letter-spacing="2">${camLabel} • NOT CONNECTED</text>
    <text x="320" y="242" text-anchor="middle" fill="#9c928b" font-family="Inter, sans-serif" font-size="12">MediaMTX preview feed offline — press Start Receiving</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Generate a snapshot thumbnail SVG data-URL when capturing a preset thumbnail
function generatePresetThumbnailDataUrl(
  camId: "cam1" | "cam2",
  presetId: number,
  presetName: string,
  pos: { pan: number; tilt: number; zoom: number }
): string {
  const hue = camId === "cam1" ? 268 : 25;
  const accent = camId === "cam1" ? "#6d28d9" : "#8f4c00";
  const offsetX = Math.max(-80, Math.min(80, Math.round(pos.pan / 15)));
  const offsetY = Math.max(-40, Math.min(40, Math.round(-pos.tilt / 15)));
  const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 38%, 22%)"/>
        <stop offset="100%" stop-color="hsl(${hue}, 30%, 12%)"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <g transform="translate(${offsetX}, ${offsetY})" opacity="0.35">
      <rect x="80" y="35" width="160" height="100" rx="8" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="4 4"/>
      <circle cx="160" cy="85" r="24" fill="none" stroke="#ffffff" stroke-width="1.5"/>
      <line x1="160" y1="50" x2="160" y2="120" stroke="#ffffff" stroke-width="1"/>
      <line x1="125" y1="85" x2="195" y2="85" stroke="#ffffff" stroke-width="1"/>
    </g>
    <rect x="8" y="8" width="64" height="20" rx="4" fill="${accent}"/>
    <text x="40" y="22" text-anchor="middle" fill="#ffffff" font-family="JetBrains Mono, monospace" font-size="11" font-weight="700">${camId.toUpperCase()} #${presetId}</text>
    <text x="160" y="94" text-anchor="middle" fill="#ffffff" font-family="Inter, sans-serif" font-size="15" font-weight="700">${presetName}</text>
    <text x="160" y="114" text-anchor="middle" fill="#d3bbff" font-family="JetBrains Mono, monospace" font-size="10">P:${pos.pan} T:${pos.tilt} Z:${pos.zoom}</text>
    <text x="310" y="170" text-anchor="end" fill="#cbd5e1" font-family="JetBrains Mono, monospace" font-size="9">SNAP ${timestamp}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ============================================================================
// Navigation & Header State
// ============================================================================
function switchTab(tab: FrontendTabId, pushUrl = true): void {
  activeTab = tab;
  const tabs: FrontendTabId[] = ["outputs", "inputs", "cameras", "renderer"];
  for (const t of tabs) {
    const panel = document.getElementById("tab-" + t);
    const nav = document.getElementById("nav-" + t);
    if (panel) {
      panel.classList.toggle("active", t === tab);
    }
    if (nav) {
      if (t === tab) {
        nav.className =
          "flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg bg-primary text-on-primary shadow-sm transition-all active:scale-95";
      } else {
        nav.className =
          "flex flex-col items-center justify-center min-w-[72px] h-11 px-space-xs rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-all active:scale-95";
      }
    }
  }

  const icon = document.getElementById("header-icon");
  const title = document.getElementById("header-title");
  const subtitle = document.getElementById("header-subtitle");
  const lockBtn = document.getElementById("lockToggleBtn");
  const camViewBtn = document.getElementById("toggleViewBtn");

  if (lockBtn) {
    lockBtn.classList.toggle("hidden", tab !== "inputs");
    lockBtn.classList.toggle("flex", tab === "inputs");
  }
  if (camViewBtn) {
    camViewBtn.classList.toggle("hidden", tab !== "cameras");
    camViewBtn.classList.toggle("flex", tab === "cameras");
  }

  if (tab === "outputs") {
    if (icon) icon.textContent = "crop_free";
    if (title) title.textContent = "PiMatrix";
    if (subtitle) subtitle.textContent = "Pi Outputs";
  } else if (tab === "inputs") {
    if (icon) icon.textContent = "settings_input_component";
    if (title) title.textContent = "Matrix Routing";
    if (subtitle) subtitle.textContent = "Atlona 4x4 Switcher";
  } else if (tab === "cameras") {
    if (icon) icon.textContent = "videocam";
    if (title) title.textContent = "Camera Control";
    if (subtitle) subtitle.textContent = "PTZ Optics & Presets";
  } else if (tab === "renderer") {
    if (icon) icon.textContent = "layers";
    if (title) title.textContent = "PiPGM Renderer";
    if (subtitle) subtitle.textContent = "Stub Placeholder";
  }

  if (pushUrl && window.history && window.history.replaceState) {
    const pathMap: Record<FrontendTabId, string> = {
      outputs: "/outputs",
      inputs: "/inputs",
      cameras: "/cameras",
      renderer: "/pipgm"
    };
    window.history.replaceState(null, "", pathMap[tab]);
  }
}

// ============================================================================
// Tab 1: Outputs & Input-Specific FTB / Mute
// ============================================================================
function getEffectiveOutputSource(outputNum: 1 | 2): string {
  const outputId = outputNum === 1 ? "hdmi0" : "hdmi1";
  const out = outputsMap.get(outputId);
  const src = out?.observedSource || out?.desiredSource;
  if (src) return src;
  return outputNum === 1 ? "PiPGM1" : "rtmp1";
}

function isSourceFtb(sourceId: string): boolean {
  if (!sourceId || sourceId === "multiview") return false;
  const fx = effectsMap.get(sourceId);
  if (fx && typeof fx.fadeToBlack === "boolean") return fx.fadeToBlack;
  const p = pipgmMap.get(sourceId);
  if (p) return p.fadeToBlack === true;
  return false;
}

function isSourceMuted(sourceId: string): boolean {
  if (!sourceId || sourceId === "multiview") return false;
  const fx = effectsMap.get(sourceId);
  if (fx && typeof fx.muted === "boolean") return fx.muted;
  const p = pipgmMap.get(sourceId);
  if (p) return !p.audioEnabled;
  return false;
}

function isSourceCropped(sourceId: string): boolean {
  if (!sourceId || sourceId === "multiview") return false;
  const fx = effectsMap.get(sourceId);
  return Boolean(fx?.crop?.enabled);
}

function getSourceCropAspect(sourceId: string): string {
  const fx = effectsMap.get(sourceId);
  return fx?.crop?.aspectRatio || "16:9";
}

function renderOutputsTab(): void {
  renderHdmiColumn(1);
  renderHdmiColumn(2);
  renderAuxModalCameras();
  renderRoutedToBadges();
  renderRtspSection();
  if (activeCropSourceId) {
    renderCropModal();
  }
}

// Helper to build a single input row with:
// - Left main button: tap to route, long-press (or right-click) to open Cropper
// - Right inline buttons: Mute button + FTB button (both live indicators & pre-activation toggles)
function buildInputRowWithInlineControls(
  outputNum: 1 | 2,
  src: SourceId,
  isSelected: boolean,
  customLabel?: string,
  onSelectExpr?: string
): string {
  const label = customLabel || SOURCE_LABELS[src] || src;
  const srcFtb = isSourceFtb(src);
  const srcMuted = isSourceMuted(src);
  const srcCropped = isSourceCropped(src);
  const cropRatio = getSourceCropAspect(src);
  const selectCall = onSelectExpr || `selectHdmiSource(${outputNum}, '${src}')`;

  const rowBg = isSelected
    ? "bg-primary text-on-primary shadow-sm border-primary"
    : "bg-surface-container-high hover:bg-surface-container-highest text-on-surface border-outline-variant/25 shadow-xs";

  const muteBtnClass = srcMuted
    ? "bg-tertiary text-on-tertiary shadow-xs"
    : isSelected
      ? "bg-black/20 hover:bg-black/30 text-on-primary/80"
      : "bg-surface-container hover:bg-surface-container-lowest text-on-surface-variant";

  const ftbBtnClass = srcFtb
    ? "bg-error text-on-error shadow-xs animate-pulse"
    : isSelected
      ? "bg-black/20 hover:bg-error hover:text-on-error text-on-primary/85"
      : "bg-surface-container hover:bg-error/20 text-on-surface-variant hover:text-error";

  const cropBadgeHtml = srcCropped
    ? `<span class="px-1 py-0.2 rounded text-[8px] font-bold ${isSelected ? "bg-white/25 text-on-primary" : "bg-primary/15 text-primary"}">${cropRatio}</span>`
    : "";

  return `
    <div class="hdmi${outputNum}-row flex items-center gap-1 w-full h-8 p-0.5 rounded-lg border transition-all ${rowBg}" data-source="${src}">
      <button
        type="button"
        data-crop-source="${src}"
        onclick="${selectCall}"
        oncontextmenu="event.preventDefault(); openSourceCropModal('${src}')"
        title="Tap to route ${label.toUpperCase()} • Hold to open Cropper"
        class="hdmi${outputNum}-btn flex-1 h-full px-1.5 rounded-md font-label-md text-[11px] uppercase ${isSelected ? "font-bold" : "font-semibold"} text-left flex items-center justify-between min-w-0 active:scale-[0.98] transition-all"
      >
        <span class="truncate flex items-center gap-1">
          ${isSelected ? '<span class="material-symbols-outlined text-[12px]">radio_button_checked</span>' : ""}
          <span>${label}</span>
        </span>
        <span class="flex items-center gap-1 flex-shrink-0">${cropBadgeHtml}</span>
      </button>
      <div class="flex items-center gap-0.5 pr-0.5 flex-shrink-0">
        <button
          type="button"
          onclick="event.stopPropagation(); toggleInputEffect('${src}', 'mute')"
          title="${srcMuted ? "Unmute" : "Mute"} ${label.toUpperCase()} (can pre-mute before activating)"
          class="w-6 h-6 rounded flex items-center justify-center transition-all active:scale-90 ${muteBtnClass}"
        >
          <span class="material-symbols-outlined text-[13px]">${srcMuted ? "volume_off" : "volume_up"}</span>
        </button>
        <button
          type="button"
          onclick="event.stopPropagation(); toggleInputEffect('${src}', 'ftb')"
          title="${srcFtb ? "Disable FTB on" : "Pre-FTB / Fade to Black"} ${label.toUpperCase()}"
          class="px-1.5 h-6 rounded font-label-sm text-[9px] font-bold uppercase flex items-center justify-center transition-all active:scale-90 ${ftbBtnClass}"
        >
          FTB
        </button>
      </div>
    </div>
  `;
}

function renderHdmiColumn(outputNum: 1 | 2): void {
  const activeSource = getEffectiveOutputSource(outputNum);
  const activeLabel = document.getElementById(`hdmi${outputNum}-active-label`);
  const ftbPill = document.getElementById(`hdmi${outputNum}-ftb-pill`);
  const cropPill = document.getElementById(`hdmi${outputNum}-crop-pill`);
  const inputsListEl = document.getElementById(`hdmi${outputNum}-inputs-list`);
  const auxContainerEl = document.getElementById(`hdmi${outputNum}-aux-container`);

  const friendlyName = SOURCE_LABELS[activeSource] || activeSource || "--";
  if (activeLabel) activeLabel.textContent = friendlyName;

  const activeFtb = isSourceFtb(activeSource);
  const activeCropped = isSourceCropped(activeSource);

  if (ftbPill) {
    ftbPill.classList.toggle("hidden", !activeFtb);
  }
  if (cropPill) {
    cropPill.classList.toggle("hidden", !activeCropped);
    if (activeCropped) {
      cropPill.textContent = `CROP ${getSourceCropAspect(activeSource)}`;
    }
  }

  // Render direct inputs list with inline Mute & FTB buttons on the right
  if (inputsListEl) {
    inputsListEl.innerHTML = DIRECT_HDMI_SOURCE_LIST.map((src) =>
      buildInputRowWithInlineControls(outputNum, src, src === activeSource)
    ).join("");
    bindLongPressForCropInside(inputsListEl);
  }

  // Render Auxiliary container
  const isAuxSelected = Boolean(activeSource && !DIRECT_HDMI_SOURCES.has(activeSource));
  if (auxContainerEl) {
    if (isAuxSelected && activeSource !== "multiview") {
      // Active Aux camera (cam1, cam2, cam3): show inline Mute & FTB + button to switch Aux
      const auxSrc = activeSource as SourceId;
      auxContainerEl.innerHTML = `
        <div class="flex flex-col gap-1">
          ${buildInputRowWithInlineControls(
            outputNum,
            auxSrc,
            true,
            `Aux: ${friendlyName}`,
            `openAuxModal(${outputNum})`
          )}
        </div>
      `;
      bindLongPressForCropInside(auxContainerEl);
    } else if (isAuxSelected && activeSource === "multiview") {
      const suffix = multiviewLayout === "portrait" ? " (2x4)" : " (4x2)";
      auxContainerEl.innerHTML = `
        <button type="button" id="hdmi${outputNum}-aux-btn" class="w-full p-1.5 rounded-lg border border-primary bg-primary text-on-primary text-left active:scale-[0.98] transition-all flex flex-col gap-0.5 shadow-sm" onclick="openAuxModal(${outputNum})">
          <div class="flex items-center justify-between w-full">
            <span class="font-label-md text-[11px] font-bold text-on-primary uppercase flex items-center gap-1">
              <span class="material-symbols-outlined text-[13px]">grid_view</span>Aux: ${friendlyName}${suffix}
            </span>
            <span class="material-symbols-outlined text-[14px] text-on-primary">verified</span>
          </div>
          <span class="font-label-sm text-[9px] text-on-primary/80 leading-none">cam 1-3 • multiview</span>
        </button>
      `;
    } else {
      auxContainerEl.innerHTML = `
        <button type="button" id="hdmi${outputNum}-aux-btn" class="w-full p-1.5 rounded-lg border border-dashed border-primary/40 bg-surface-container hover:bg-surface-container-high text-left active:scale-[0.98] transition-all flex flex-col gap-0.5" onclick="openAuxModal(${outputNum})">
          <div class="flex items-center justify-between w-full">
            <span class="font-label-md text-[11px] font-bold text-primary uppercase flex items-center gap-1">
              <span class="material-symbols-outlined text-[13px]">tune</span>Auxiliary
            </span>
            <span class="material-symbols-outlined text-[14px] text-primary">touch_app</span>
          </div>
          <span class="font-label-sm text-[9px] text-on-surface-variant leading-none">cam 1-3 • multiview</span>
        </button>
      `;
    }
  }
}

function renderAuxModalCameras(): void {
  const listEl = document.getElementById("aux-modal-cam-list");
  if (!listEl) return;
  const activeSource = getEffectiveOutputSource(auxModalTargetOutput);
  listEl.innerHTML = AUX_CAMERA_SOURCE_LIST.map((camId) =>
    buildInputRowWithInlineControls(
      auxModalTargetOutput,
      camId,
      activeSource === camId,
      SOURCE_LABELS[camId] || camId,
      `confirmAuxPick('${camId}')`
    )
  ).join("");
  bindLongPressForCropInside(listEl);
}

function renderRoutedToBadges(): void {
  // Atlona Input 3 = Pi 1 (hdmi 0), Input 4 = Pi 2 (hdmi 1)
  for (const [outputNum, atlonaInput] of [
    [1, 3],
    [2, 4]
  ] as const) {
    const container = document.getElementById(`hdmi${outputNum}-routed-badges`);
    if (!container) continue;
    const dests: string[] = [];
    for (const [outStr, inNum] of Object.entries(matrixState.routes || {})) {
      const outNum = Number(outStr);
      if (outNum === 3) continue; // Screen disabled
      if (inNum === atlonaInput && MATRIX_DEST_NAMES[outNum]) {
        dests.push(MATRIX_DEST_NAMES[outNum]);
      }
    }
    if (dests.length === 0) {
      container.innerHTML =
        '<span class="px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface-variant font-label-sm text-[9px] font-semibold leading-none">Unrouted</span>';
    } else {
      container.innerHTML = dests
        .map(
          (d) =>
            `<span class="px-1.5 py-0.5 rounded bg-surface-container-high border border-outline-variant/30 text-on-surface font-label-sm text-[9px] font-semibold leading-none">${d}</span>`
        )
        .join("");
    }
  }
}

async function selectHdmiSource(outputNum: 1 | 2, sourceId: string | null): Promise<void> {
  const outputId = outputNum === 1 ? "hdmi0" : "hdmi1";
  try {
    const res = await fetch(`/api/v1/outputs/${outputId}/source`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId })
    });
    if (res.ok) {
      const updated = (await res.json()) as OutputSnapshot;
      outputsMap.set(outputId, updated);
      renderOutputsTab();
      const label = sourceId ? SOURCE_LABELS[sourceId] || sourceId : "Cleared";
      showToast(`Pi ${outputNum} (hdmi ${outputNum - 1}) → ${label.toUpperCase()}`);
    }
  } catch {
    showToast(`Failed to route Pi ${outputNum}`);
  }
}

function openAuxModal(outputNum: 1 | 2): void {
  auxModalTargetOutput = outputNum;
  const label = document.getElementById("aux-target-label");
  if (label) label.textContent = `Assigning to Pi ${outputNum} (hdmi ${outputNum - 1})`;
  renderAuxModalCameras();
  const dialog = document.getElementById("aux-modal-overlay") as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  }
}

function closeAuxModal(): void {
  const dialog = document.getElementById("aux-modal-overlay") as HTMLDialogElement | null;
  if (dialog && dialog.open) {
    dialog.close();
  }
}

async function confirmAuxPick(
  sourceId: string | null,
  mvLayout?: "landscape" | "portrait"
): Promise<void> {
  if (sourceId === "multiview" && mvLayout) {
    try {
      const mvRes = await fetch("/api/v1/outputs/multiview/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: mvLayout })
      });
      if (mvRes.ok) {
        multiviewLayout = mvLayout;
      }
    } catch {
      // ignore
    }
  }
  await selectHdmiSource(auxModalTargetOutput, sourceId);
  closeAuxModal();
}

async function toggleOutputInputControl(outputNum: 1 | 2, kind: "ftb" | "mute"): Promise<void> {
  const activeSource = getEffectiveOutputSource(outputNum);
  if (!activeSource || activeSource === "multiview") {
    showToast("Select a specific input source for FTB/Mute");
    return;
  }
  await toggleInputEffect(activeSource as SourceId, kind);
}

async function toggleInputEffect(sourceId: SourceId, kind: "ftb" | "mute"): Promise<void> {
  const endpoint =
    kind === "ftb"
      ? `/api/v1/sources/${encodeURIComponent(sourceId)}/effects/ftb`
      : `/api/v1/sources/${encodeURIComponent(sourceId)}/effects/mute`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggle: true })
    });
    if (res.ok) {
      const updated = (await res.json()) as EffectsPipeline;
      effectsMap.set(sourceId, updated);
      renderOutputsTab();
      const friendly = (SOURCE_LABELS[sourceId] || sourceId).toUpperCase();
      if (kind === "ftb") {
        showToast(`${friendly}: ${updated.fadeToBlack ? "FADED TO BLACK" : "LIVE (FTB OFF)"}`);
      } else {
        showToast(`${friendly}: ${updated.muted ? "AUDIO MUTED" : "AUDIO UNMUTED"}`);
      }
    }
  } catch {
    showToast(`Failed to update ${kind.toUpperCase()} for ${sourceId}`);
  }
}

// ============================================================================
// Crop & Effects Modal Outside Multiview (Long-press Output/Input + Drag View)
// ============================================================================
let activeCropSourceId: SourceId | null = null;

function buildSimulatedCropSceneSvg(sourceId: string): string {
  const label = (SOURCE_LABELS[sourceId] || sourceId).toUpperCase();
  const hue =
    sourceId === "hama"
      ? 210
      : sourceId.startsWith("rtmp")
        ? 160
        : sourceId.startsWith("cam")
          ? 268
          : 28;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="100%" height="100%" preserveAspectRatio="none">
    <defs>
      <linearGradient id="cbg-${sourceId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 42%, 22%)"/>
        <stop offset="50%" stop-color="hsl(${hue}, 35%, 15%)"/>
        <stop offset="100%" stop-color="hsl(${hue}, 30%, 10%)"/>
      </linearGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#cbg-${sourceId})"/>
    <g stroke="rgba(255,255,255,0.14)" stroke-width="3">
      <line x1="640" y1="0" x2="640" y2="1080"/>
      <line x1="1280" y1="0" x2="1280" y2="1080"/>
      <line x1="0" y1="360" x2="1920" y2="360"/>
      <line x1="0" y1="720" x2="1920" y2="720"/>
      <rect x="240" y="135" width="1440" height="810" fill="none" stroke-dasharray="16 12"/>
      <circle cx="960" cy="540" r="220" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="4"/>
      <line x1="960" y1="260" x2="960" y2="820"/>
      <line x1="680" y1="540" x2="1240" y2="540"/>
    </g>
    <!-- Reference subject markers so user can clearly see what is inside the cropped region -->
    <rect x="700" y="210" width="520" height="660" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-width="4"/>
    <circle cx="960" cy="390" r="85" fill="rgba(255,255,255,0.2)"/>
    <path d="M810 680 C810 545 1110 545 1110 680 Z" fill="rgba(255,255,255,0.2)"/>
    <text x="960" y="810" text-anchor="middle" fill="#ffffff" font-family="JetBrains Mono, monospace" font-size="64" font-weight="800" letter-spacing="6">${label} FEED</text>
    <text x="120" y="110" fill="rgba(255,255,255,0.5)" font-family="JetBrains Mono, monospace" font-size="40">NW (0,0)</text>
    <text x="1800" y="110" text-anchor="end" fill="rgba(255,255,255,0.5)" font-family="JetBrains Mono, monospace" font-size="40">NE (1920,0)</text>
    <text x="120" y="1010" fill="rgba(255,255,255,0.5)" font-family="JetBrains Mono, monospace" font-size="40">SW (0,1080)</text>
    <text x="1800" y="1010" text-anchor="end" fill="rgba(255,255,255,0.5)" font-family="JetBrains Mono, monospace" font-size="40">SE (1920,1080)</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function ensureSourceEffects(sourceId: SourceId): EffectsPipeline {
  let fx = effectsMap.get(sourceId);
  if (!fx) {
    fx = {
      sourceId,
      crop: {
        enabled: false,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        sourceWidth: 1920,
        sourceHeight: 1080,
        aspectRatio: "16:9",
        lockedAspectRatio: false
      },
      rotation: 0,
      fadeToBlack: false,
      muted: false,
      ffmpegFilter: "null"
    };
    effectsMap.set(sourceId, fx);
  }
  return fx;
}

function openOutputCropModal(outputNum: 1 | 2): void {
  const src = getEffectiveOutputSource(outputNum);
  if (!src || src === "multiview") {
    showToast("Select a video input source to crop");
    return;
  }
  openSourceCropModal(src as SourceId);
}

function openSourceCropModal(sourceId: SourceId): void {
  activeCropSourceId = sourceId;
  ensureSourceEffects(sourceId);
  renderCropModal();
  const dialog = document.getElementById("crop-modal-overlay") as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  }
  // Re-render after modal layout settles so clientWidth/clientHeight of the upper preview are accurate
  requestAnimationFrame(() => renderCropModal());
}

function closeCropModal(): void {
  const dialog = document.getElementById("crop-modal-overlay") as HTMLDialogElement | null;
  if (dialog && dialog.open) {
    dialog.close();
  }
  activeCropSourceId = null;
}

function renderCropModal(): void {
  if (!activeCropSourceId) return;
  const fx = ensureSourceEffects(activeCropSourceId);
  const crop = fx.crop;
  const sw = crop.sourceWidth || 1920;
  const sh = crop.sourceHeight || 1080;
  const cw = Math.max(32, crop.width || sw);
  const ch = Math.max(32, crop.height || sh);
  const cx = Math.max(0, Math.min(sw - cw, crop.x || 0));
  const cy = Math.max(0, Math.min(sh - ch, crop.y || 0));

  const friendly = (SOURCE_LABELS[activeCropSourceId] || activeCropSourceId).toUpperCase();
  const titleEl = document.getElementById("crop-dialog-title");
  const zoomedBadge = document.getElementById("crop-zoomed-badge");
  const coordsEl = document.getElementById("crop-coords-readout");
  const rectEl = document.getElementById("crop-interactive-rect");
  const rectTag = document.getElementById("crop-rect-tag");
  const lockIcon = document.getElementById("crop-lock-aspect-icon");
  const lockLabel = document.getElementById("crop-lock-aspect-label");

  if (titleEl) {
    titleEl.textContent = `Crop & Effects: ${friendly}`;
  }
  if (zoomedBadge) {
    zoomedBadge.textContent = `${crop.aspectRatio}${crop.enabled ? " [ACTIVE]" : " [FULL]"} • ${cw}x${ch}`;
  }
  if (coordsEl) {
    coordsEl.textContent = `x:${cx} y:${cy} w:${cw} h:${ch}`;
  }
  if (rectEl) {
    rectEl.style.left = `${(cx / sw) * 100}%`;
    rectEl.style.top = `${(cy / sh) * 100}%`;
    rectEl.style.width = `${(cw / sw) * 100}%`;
    rectEl.style.height = `${(ch / sh) * 100}%`;
  }
  if (rectTag) {
    rectTag.textContent = `${crop.aspectRatio}${crop.enabled ? " • ON" : ""}`;
  }
  if (lockIcon && lockLabel) {
    lockIcon.textContent = crop.lockedAspectRatio ? "lock" : "lock_open";
    lockLabel.textContent = `Lock Aspect: ${crop.lockedAspectRatio ? "ON" : "OFF"}`;
  }

  // Render background feed into both #crop-full-feed (lower interactive box) and #crop-zoomed-feed (upper unobstructed cropped preview)
  const srcItem = sourcesMap.get(activeCropSourceId);
  const liveUrl = srcItem?.preview?.available && srcItem.preview.url ? srcItem.preview.url : null;
  const fallbackImgUrl = buildSimulatedCropSceneSvg(activeCropSourceId);

  const fullFeedEl = document.getElementById("crop-full-feed");
  if (fullFeedEl && fullFeedEl.getAttribute("data-rendered-source") !== `${activeCropSourceId}:${liveUrl || "sim"}`) {
    fullFeedEl.setAttribute("data-rendered-source", `${activeCropSourceId}:${liveUrl || "sim"}`);
    if (liveUrl) {
      fullFeedEl.innerHTML = `<iframe src="${liveUrl}" class="w-full h-full border-0 pointer-events-none" allow="autoplay"></iframe>`;
    } else {
      fullFeedEl.innerHTML = `<img src="${fallbackImgUrl}" alt="${friendly}" class="w-full h-full object-cover pointer-events-none" />`;
    }
  }

  const zoomedViewport = document.getElementById("crop-zoomed-viewport");
  const zoomedFeed = document.getElementById("crop-zoomed-feed");
  if (zoomedViewport && zoomedFeed) {
    if (zoomedFeed.getAttribute("data-rendered-source") !== `${activeCropSourceId}:${liveUrl || "sim"}`) {
      zoomedFeed.setAttribute("data-rendered-source", `${activeCropSourceId}:${liveUrl || "sim"}`);
      if (liveUrl) {
        zoomedFeed.innerHTML = `<iframe src="${liveUrl}" class="w-full h-full border-0 pointer-events-none" allow="autoplay"></iframe>`;
      } else {
        zoomedFeed.innerHTML = `<img src="${fallbackImgUrl}" alt="${friendly} Cropped" class="w-full h-full object-cover pointer-events-none" />`;
      }
    }

    // Fit zoomedViewport inside its 144px-tall parent while matching the exact (cw : ch) aspect ratio
    const parent = zoomedViewport.parentElement;
    const maxW = (parent?.clientWidth || 380) - 8;
    const maxH = (parent?.clientHeight || 140) - 8;
    let targetH = maxH;
    let targetW = Math.round((cw / ch) * targetH);
    if (targetW > maxW) {
      targetW = maxW;
      targetH = Math.max(24, Math.round((ch / cw) * targetW));
    }

    zoomedViewport.style.width = `${targetW}px`;
    zoomedViewport.style.height = `${targetH}px`;

    // Scale and translate the 1920x1080 source coordinate space so only (cx, cy, cw, ch) fills zoomedViewport
    const scaleX = targetW / cw;
    const scaleY = targetH / ch;
    zoomedFeed.style.width = `${sw}px`;
    zoomedFeed.style.height = `${sh}px`;
    zoomedFeed.style.transform = `scale(${scaleX}, ${scaleY}) translate(${-cx}px, ${-cy}px)`;
  }
}

function bindLongPressForCropInside(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLElement>("[data-crop-source]");
  buttons.forEach((btn) => {
    const src = btn.getAttribute("data-crop-source") as SourceId | null;
    if (!src) return;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressFired = false;

    btn.addEventListener("pointerdown", () => {
      longPressFired = false;
      holdTimer = setTimeout(() => {
        longPressFired = true;
        holdTimer = null;
        openSourceCropModal(src);
      }, 450);
    });

    const cancel = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    btn.addEventListener("pointercancel", cancel);
    btn.addEventListener(
      "click",
      (e) => {
        if (longPressFired) {
          e.preventDefault();
          e.stopImmediatePropagation();
          longPressFired = false;
        }
      },
      true
    );
  });
}

function bindOutputHeadersLongPressForCrop(): void {
  for (const outputNum of [1, 2] as const) {
    const headerZone = document.getElementById(`hdmi${outputNum}-header-zone`);
    if (!headerZone) continue;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    headerZone.addEventListener("pointerdown", () => {
      holdTimer = setTimeout(() => {
        holdTimer = null;
        openOutputCropModal(outputNum);
      }, 450);
    });
    const cancel = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    headerZone.addEventListener("pointerup", cancel);
    headerZone.addEventListener("pointerleave", cancel);
    headerZone.addEventListener("pointercancel", cancel);
    headerZone.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openOutputCropModal(outputNum);
    });
  }
}

function bindCropInteractiveDrag(): void {
  const box = document.getElementById("crop-interactive-box");
  if (!box) return;

  let dragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startCropX = 0;
  let startCropY = 0;

  box.addEventListener("pointerdown", (e) => {
    if (!activeCropSourceId) return;
    const fx = ensureSourceEffects(activeCropSourceId);
    dragging = true;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startCropX = fx.crop.x;
    startCropY = fx.crop.y;
    if (typeof box.setPointerCapture === "function") {
      try {
        box.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic pointer events without active pointerId
      }
    }
  });

  box.addEventListener("pointermove", (e) => {
    if (!dragging || !activeCropSourceId) return;
    const fx = ensureSourceEffects(activeCropSourceId);
    const rect = box.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const sw = fx.crop.sourceWidth || 1920;
    const sh = fx.crop.sourceHeight || 1080;
    const dx = Math.round(((e.clientX - startClientX) / rect.width) * sw);
    const dy = Math.round(((e.clientY - startClientY) / rect.height) * sh);

    const nextX = Math.max(0, Math.min(sw - fx.crop.width, Math.round((startCropX + dx) / 2) * 2));
    const nextY = Math.max(0, Math.min(sh - fx.crop.height, Math.round((startCropY + dy) / 2) * 2));

    fx.crop.x = nextX;
    fx.crop.y = nextY;
    fx.crop.enabled = true;
    renderCropModal();
  });

  const commitDrag = async () => {
    if (!dragging || !activeCropSourceId) return;
    dragging = false;
    const sourceId = activeCropSourceId;
    const fx = ensureSourceEffects(sourceId);
    try {
      const res = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/effects/crop`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          x: fx.crop.x,
          y: fx.crop.y
        })
      });
      if (res.ok) {
        const updated = (await res.json()) as EffectsPipeline;
        effectsMap.set(sourceId, updated);
        renderOutputsTab();
      }
    } catch {
      // ignore
    }
  };

  box.addEventListener("pointerup", () => void commitDrag());
  box.addEventListener("pointercancel", () => void commitDrag());
}

async function applySourceCropPreset(preset: string): Promise<void> {
  if (!activeCropSourceId) return;
  const sourceId = activeCropSourceId;
  try {
    const res = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/effects/crop/preset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset })
    });
    if (res.ok) {
      const updated = (await res.json()) as EffectsPipeline;
      effectsMap.set(sourceId, updated);
      renderOutputsTab();
      showToast(`${(SOURCE_LABELS[sourceId] || sourceId).toUpperCase()} Crop → ${ updated.crop.enabled ? updated.crop.aspectRatio : "RESET"}`);
    }
  } catch {
    showToast("Failed to apply crop preset");
  }
}

async function moveSourceCrop(direction: "left" | "right" | "up" | "down" | "center"): Promise<void> {
  if (!activeCropSourceId) return;
  const sourceId = activeCropSourceId;
  try {
    const res = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/effects/crop/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, delta: 32 })
    });
    if (res.ok) {
      const updated = (await res.json()) as EffectsPipeline;
      effectsMap.set(sourceId, updated);
      renderOutputsTab();
    }
  } catch {
    // ignore
  }
}

async function resizeSourceCrop(action: "in" | "out"): Promise<void> {
  if (!activeCropSourceId) return;
  const sourceId = activeCropSourceId;
  try {
    const res = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/effects/crop/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, factor: 0.1 })
    });
    if (res.ok) {
      const updated = (await res.json()) as EffectsPipeline;
      effectsMap.set(sourceId, updated);
      renderOutputsTab();
    }
  } catch {
    // ignore
  }
}

async function toggleSourceCropLockAspect(): Promise<void> {
  if (!activeCropSourceId) return;
  const sourceId = activeCropSourceId;
  const fx = ensureSourceEffects(sourceId);
  const nextLocked = !fx.crop.lockedAspectRatio;
  try {
    const res = await fetch(`/api/v1/sources/${encodeURIComponent(sourceId)}/effects/crop`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockedAspectRatio: nextLocked })
    });
    if (res.ok) {
      const updated = (await res.json()) as EffectsPipeline;
      effectsMap.set(sourceId, updated);
      renderOutputsTab();
    }
  } catch {
    // ignore
  }
}

// ============================================================================
// Network Stream Out (RTSP): Dedicated Dialog Button under Heading + Start/Stop
// ============================================================================
function openRtspModal(): void {
  renderRtspSection();
  const dialog = document.getElementById("rtsp-modal-overlay") as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  }
}

function closeRtspModal(): void {
  const dialog = document.getElementById("rtsp-modal-overlay") as HTMLDialogElement | null;
  if (dialog && dialog.open) {
    dialog.close();
  }
}

function renderRtspSection(): void {
  const configBtnLabel = document.getElementById("rtsp-config-btn-label");
  const dialogStatusPill = document.getElementById("rtsp-dialog-status-pill");
  const streamBtn = document.getElementById("rtsp-stream-btn");
  const streamIcon = document.getElementById("rtsp-stream-icon");
  const streamLabel = document.getElementById("rtsp-stream-label");
  const liveDot = document.getElementById("rtsp-live-dot");
  const qualityBadge = document.getElementById("rtsp-quality-badge");

  const srcName =
    rtspOut.sourceId === "multiview"
      ? `MV (${rtspOut.layout === "portrait" ? "2x4" : "4x2"})`
      : SOURCE_LABELS[rtspOut.sourceId] || rtspOut.sourceId;

  const qualityLabel = rtspOut.quality === "preview" ? "Preview" : "Full";
  if (configBtnLabel) {
    configBtnLabel.textContent = `Source & Settings (${srcName})`;
  }

  if (dialogStatusPill) {
    if (rtspOut.streaming) {
      dialogStatusPill.textContent = "STREAMING LIVE";
      dialogStatusPill.className =
        "px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 font-bold uppercase text-[9px]";
    } else {
      dialogStatusPill.textContent = "STOPPED";
      dialogStatusPill.className =
        "px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-bold uppercase text-[9px]";
    }
  }

  if (qualityBadge) {
    const mbps = (rtspOut.bitrateKbps / 1000).toFixed(1);
    qualityBadge.textContent = `${qualityLabel.toUpperCase()} ${rtspOut.resolution} • ${mbps} Mbps`;
  }

  if (liveDot) {
    liveDot.className = rtspOut.streaming
      ? "inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
      : "inline-block w-2 h-2 rounded-full bg-outline";
  }

  if (streamBtn && streamIcon && streamLabel) {
    if (rtspOut.streaming) {
      streamBtn.className =
        "px-3 py-2 rounded-lg bg-error text-on-error font-label-sm text-[11px] font-bold uppercase transition-all flex items-center gap-1.5 shadow-sm active:scale-95 flex-shrink-0";
      streamIcon.textContent = "stop";
      streamLabel.textContent = "Stop Stream";
    } else {
      streamBtn.className =
        "px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-[11px] font-bold uppercase transition-all flex items-center gap-1.5 shadow-sm active:scale-95 flex-shrink-0";
      streamIcon.textContent = "play_arrow";
      streamLabel.textContent = "Start Stream";
    }
  }

  // Update buttons inside RTSP modal
  const btns = document.querySelectorAll<HTMLButtonElement>(".rtsp-choice-btn");
  btns.forEach((btn) => {
    const key = btn.getAttribute("data-rtsp") || "";
    let isActive = false;
    if (key.startsWith("multiview:")) {
      const lay = key.split(":")[1];
      isActive = rtspOut.sourceId === "multiview" && rtspOut.layout === lay;
    } else {
      isActive = rtspOut.sourceId === key;
    }

    if (key.startsWith("multiview:")) {
      btn.className = isActive
        ? "rtsp-choice-btn flex-1 h-8 rounded-lg bg-primary text-on-primary font-label-sm text-[9px] uppercase font-bold transition-all flex flex-col items-center justify-center leading-none p-0.5 shadow-sm"
        : "rtsp-choice-btn flex-1 h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-sm text-[9px] uppercase font-semibold transition-all flex flex-col items-center justify-center leading-none p-0.5";
    } else {
      btn.className = isActive
        ? "rtsp-choice-btn h-8 rounded-lg bg-primary text-on-primary font-label-md text-[11px] uppercase font-bold transition-all shadow-sm"
        : "rtsp-choice-btn h-8 rounded-lg bg-surface-container-highest hover:bg-primary/20 text-on-surface font-label-md text-[11px] uppercase font-semibold transition-all shadow-xs";
    }
  });

  // Update profile buttons & selects inside RTSP modal
  const pvwBtn = document.getElementById("rtsp-profile-preview");
  const fullBtn = document.getElementById("rtsp-profile-full");
  if (pvwBtn && fullBtn) {
    if (rtspOut.quality === "preview") {
      pvwBtn.className =
        "p-2 rounded-lg border border-primary bg-primary text-on-primary text-left flex flex-col gap-0.5 transition-all shadow-sm";
      fullBtn.className =
        "p-2 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface text-left flex flex-col gap-0.5 transition-all";
    } else {
      pvwBtn.className =
        "p-2 rounded-lg border border-outline-variant/40 bg-surface-container-high text-on-surface text-left flex flex-col gap-0.5 transition-all";
      fullBtn.className =
        "p-2 rounded-lg border border-primary bg-primary text-on-primary text-left flex flex-col gap-0.5 transition-all shadow-sm";
    }
  }

  const resSelect = document.getElementById("rtsp-resolution-select") as HTMLSelectElement | null;
  const bitSelect = document.getElementById("rtsp-bitrate-select") as HTMLSelectElement | null;
  if (resSelect && rtspOut.resolution) resSelect.value = rtspOut.resolution;
  if (bitSelect && rtspOut.bitrateKbps) bitSelect.value = String(rtspOut.bitrateKbps);
}

async function assignRtsp(sourceId: string, mvLayout?: "landscape" | "portrait"): Promise<void> {
  try {
    const res = await fetch("/api/v1/outputs/rtsp/source", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId,
        ...(mvLayout ? { layout: mvLayout } : {})
      })
    });
    if (res.ok) {
      rtspOut = (await res.json()) as RtspOutState;
      renderRtspSection();
      showToast(`RTSP Stream Source → ${(SOURCE_LABELS[sourceId] || sourceId).toUpperCase()}`);
    }
  } catch {
    showToast("Failed to assign RTSP source");
  }
}

async function setRtspQualityProfile(quality: "preview" | "full"): Promise<void> {
  const resolution = quality === "preview" ? "640x360" : "1920x1080";
  const bitrateKbps = quality === "preview" ? 800 : 6200;
  try {
    const res = await fetch("/api/v1/outputs/rtsp/source", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: rtspOut.sourceId,
        layout: rtspOut.layout,
        quality,
        resolution,
        bitrateKbps
      })
    });
    if (res.ok) {
      rtspOut = (await res.json()) as RtspOutState;
      renderRtspSection();
      showToast(
        `RTSP Quality → ${quality === "preview" ? "PREVIEW (360p / 800 kbps)" : "FULL (1080p / 6200 kbps)"}`
      );
    }
  } catch {
    showToast("Failed to update RTSP quality");
  }
}

async function updateRtspCustomQuality(): Promise<void> {
  const resSelect = document.getElementById("rtsp-resolution-select") as HTMLSelectElement | null;
  const bitSelect = document.getElementById("rtsp-bitrate-select") as HTMLSelectElement | null;
  const resolution = resSelect?.value || rtspOut.resolution;
  const bitrateKbps = Number(bitSelect?.value || rtspOut.bitrateKbps);
  const quality: "preview" | "full" =
    resolution === "640x360" || bitrateKbps <= 1000 ? "preview" : "full";

  try {
    const res = await fetch("/api/v1/outputs/rtsp/source", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: rtspOut.sourceId,
        layout: rtspOut.layout,
        quality,
        resolution,
        bitrateKbps
      })
    });
    if (res.ok) {
      rtspOut = (await res.json()) as RtspOutState;
      renderRtspSection();
      showToast(`RTSP → ${resolution} @ ${bitrateKbps} kbps`);
    }
  } catch {
    showToast("Failed to update RTSP settings");
  }
}

async function toggleRtspStream(): Promise<void> {
  try {
    const res = await fetch("/api/v1/outputs/rtsp/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toggle: true })
    });
    if (res.ok) {
      rtspOut = (await res.json()) as RtspOutState;
      renderRtspSection();
      showToast(rtspOut.streaming ? "RTSP Network Stream STARTED" : "RTSP Network Stream STOPPED");
    }
  } catch {
    showToast("Failed to toggle RTSP stream");
  }
}

// ============================================================================
// Tab 2: Inputs / Atlona 4x4 Matrix Routing
// ============================================================================
function renderMatrixTab(): void {
  const lockIcon = document.getElementById("lockIcon");
  const lockLabel = document.getElementById("lockLabel");
  const lockBtn = document.getElementById("lockToggleBtn");

  if (lockIcon && lockLabel && lockBtn) {
    if (matrixState.locked) {
      lockIcon.textContent = "lock";
      lockIcon.className = "material-symbols-outlined text-[14px] text-error";
      lockLabel.textContent = "LOCKED";
      lockLabel.className = "text-error";
      lockBtn.className = `${activeTab === "inputs" ? "flex" : "hidden"} items-center gap-1 px-2.5 py-1 rounded-full bg-error-container border border-error/30 text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95`;
    } else {
      lockIcon.textContent = "lock_open";
      lockIcon.className = "material-symbols-outlined text-[14px] text-tertiary";
      lockLabel.textContent = "UNLOCKED";
      lockLabel.className = "text-tertiary";
      lockBtn.className = `${activeTab === "inputs" ? "flex" : "hidden"} items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant/40 text-[10px] font-label-sm font-bold uppercase transition-all active:scale-95`;
    }
  }

  for (const outNum of [1, 2, 4]) {
    const activeIn = matrixState.routes?.[outNum] || 1;
    const statusEl = document.getElementById(`matrix-out-${outNum}-status`);
    if (statusEl) {
      statusEl.textContent = `IN ${activeIn} • ${MATRIX_INPUT_NAMES[activeIn] || `INPUT ${activeIn}`}`;
    }

    const group = document.querySelector(`[data-output="${outNum}"]`);
    if (!group) continue;
    const buttons = group.querySelectorAll<HTMLButtonElement>(".matrix-btn");
    buttons.forEach((btn) => {
      const inNum = Number(btn.getAttribute("data-input"));
      const sub = btn.querySelector(".matrix-sub");
      if (inNum === activeIn) {
        btn.className =
          "matrix-btn h-12 flex flex-col items-center justify-center rounded bg-primary text-on-primary shadow-sm transition-all active:scale-95";
        if (sub)
          sub.className =
            "matrix-sub font-label-sm text-[9px] text-on-primary-container uppercase tracking-tighter";
      } else {
        btn.className =
          "matrix-btn h-12 flex flex-col items-center justify-center rounded bg-surface-container-highest text-on-surface hover:bg-surface-dim transition-all active:scale-95";
        if (sub)
          sub.className =
            "matrix-sub font-label-sm text-[9px] text-on-surface-variant uppercase tracking-tighter";
      }
    });
  }
}

async function toggleMatrixLock(): Promise<void> {
  const nextLocked = !matrixState.locked;
  try {
    const res = await fetch("/api/v1/matrix/lock", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locked: nextLocked })
    });
    if (res.ok) {
      matrixState = (await res.json()) as MatrixRouteState;
      renderMatrixTab();
      showToast(matrixState.locked ? "Matrix Safety LOCKED" : "Matrix UNLOCKED");
    }
  } catch {
    matrixState.locked = nextLocked;
    renderMatrixTab();
  }
}

async function routeMatrixCrosspoint(input: number, output: number): Promise<void> {
  if (matrixState.locked) {
    showToast("Matrix is LOCKED — unlock in top bar to route");
    return;
  }
  try {
    const res = await fetch("/api/v1/matrix/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, output })
    });
    if (res.ok) {
      matrixState.routes[output] = input;
      renderMatrixTab();
      renderRoutedToBadges();
      showToast(`${MATRIX_DEST_NAMES[output]} → ${MATRIX_INPUT_NAMES[input]}`);
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      showToast(err?.error?.message || "Matrix route failed");
    }
  } catch {
    showToast("Matrix route request failed");
  }
}

// ============================================================================
// Tab 3: Camera Control (Overview & Single-View Parameter Matrix + Presets)
// ============================================================================
function selectCamera(camId: "cam1" | "cam2"): void {
  selectedCameraId = camId;
  renderCamerasTab();
}

function toggleCamFocus(): void {
  if (camFocusMode === "dual") {
    camFocusMode = selectedCameraId;
  } else if (camFocusMode === "cam1") {
    camFocusMode = "cam2";
    selectedCameraId = "cam2";
  } else {
    camFocusMode = "dual";
  }
  renderCamerasTab();
}

function renderCameraFeedViewport(camId: "cam1" | "cam2", idx: 1 | 2): void {
  const feedBox = document.getElementById(`cam-feed-box-${idx}`);
  if (!feedBox) return;

  const cam = camerasMap.get(camId);
  const src = sourcesMap.get(camId);
  const isReceiving = cam?.streaming === true;
  const previewUrl = src?.preview?.available && src?.preview?.url ? src.preview.url : null;

  // Show live MediaMTX preview iframe when receiving and MediaMTX preview URL is available;
  // otherwise render the "Not Connected" picture!
  const desiredKey = isReceiving && previewUrl ? `iframe:${previewUrl}` : `offline:${camId}`;
  if (feedBox.getAttribute("data-render-key") === desiredKey) {
    return;
  }
  feedBox.setAttribute("data-render-key", desiredKey);

  if (isReceiving && previewUrl) {
    feedBox.innerHTML = `<iframe src="${previewUrl}" class="w-full h-full border-0 pointer-events-none" allow="autoplay; fullscreen"></iframe>`;
  } else {
    const imgUrl = buildNotConnectedDataUrl(idx === 1 ? "CAM 01" : "CAM 02");
    feedBox.innerHTML = `<img src="${imgUrl}" alt="CAM 0${idx} Not Connected" class="w-full h-full object-cover"/>`;
  }
}

function renderCamerasTab(): void {
  const card1 = document.getElementById("cam-card-1");
  const card2 = document.getElementById("cam-card-2");
  const glow1 = document.getElementById("cam-glow-1");
  const glow2 = document.getElementById("cam-glow-2");
  const badge1 = document.getElementById("cam-badge-1");
  const badge2 = document.getElementById("cam-badge-2");
  const targetInd = document.getElementById("target-indicator");
  const paramTitle = document.getElementById("param-matrix-title");
  const viewModeLabel = document.getElementById("viewModeLabel");
  const monitorsContainer = document.getElementById("monitorsContainer");
  const expandedConfigPanel = document.getElementById("expandedConfigPanel");
  const cam1PresetsSection = document.getElementById("cam1-presets-section");
  const cam2PresetsSection = document.getElementById("cam2-presets-section");

  const isCam1 = selectedCameraId === "cam1";
  if (glow1) glow1.className = `h-1.5 w-full transition-colors ${isCam1 ? "bg-primary" : "bg-surface-variant"}`;
  if (glow2) glow2.className = `h-1.5 w-full transition-colors ${!isCam1 ? "bg-secondary" : "bg-surface-variant"}`;
  if (badge1)
    badge1.className = isCam1
      ? "px-1.5 py-0.5 rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold shadow-sm"
      : "px-1.5 py-0.5 rounded bg-surface-container-lowest/90 text-on-surface font-label-sm text-label-sm font-bold shadow-sm";
  if (badge2)
    badge2.className = !isCam1
      ? "px-1.5 py-0.5 rounded bg-secondary text-on-secondary font-label-sm text-label-sm font-bold shadow-sm"
      : "px-1.5 py-0.5 rounded bg-surface-container-lowest/90 text-on-surface font-label-sm text-label-sm font-bold shadow-sm";

  if (targetInd) {
    targetInd.textContent = isCam1
      ? "TARGET: CAM 01 (STAGE LEFT)"
      : "TARGET: CAM 02 (PULPIT / ALTAR)";
  }
  if (paramTitle) {
    paramTitle.textContent = isCam1 ? "CAM 01 PARAMETER MATRIX" : "CAM 02 PARAMETER MATRIX";
  }

  // Dual View vs. Single View visibility:
  // - Dual View: Show both cameras, show both presets, HIDE Parameter Matrix
  // - Single View: Show only focused camera, show ONLY that camera's presets, SHOW Parameter Matrix
  if (monitorsContainer && card1 && card2) {
    if (camFocusMode === "dual") {
      monitorsContainer.className = "grid grid-cols-2 gap-space-sm w-full transition-all duration-300";
      card1.classList.remove("hidden");
      card2.classList.remove("hidden");
      if (viewModeLabel) viewModeLabel.textContent = "Dual View";
      if (expandedConfigPanel) {
        expandedConfigPanel.classList.add("hidden");
        expandedConfigPanel.classList.remove("flex");
      }
      if (cam1PresetsSection) cam1PresetsSection.classList.remove("hidden");
      if (cam2PresetsSection) cam2PresetsSection.classList.remove("hidden");
    } else if (camFocusMode === "cam1") {
      monitorsContainer.className = "grid grid-cols-1 gap-space-sm w-full transition-all duration-300";
      card1.classList.remove("hidden");
      card2.classList.add("hidden");
      if (viewModeLabel) viewModeLabel.textContent = "CAM 01 Focus";
      if (expandedConfigPanel) {
        expandedConfigPanel.classList.remove("hidden");
        expandedConfigPanel.classList.add("flex");
      }
      if (cam1PresetsSection) cam1PresetsSection.classList.remove("hidden");
      if (cam2PresetsSection) cam2PresetsSection.classList.add("hidden");
    } else {
      monitorsContainer.className = "grid grid-cols-1 gap-space-sm w-full transition-all duration-300";
      card1.classList.add("hidden");
      card2.classList.remove("hidden");
      if (viewModeLabel) viewModeLabel.textContent = "CAM 02 Focus";
      if (expandedConfigPanel) {
        expandedConfigPanel.classList.remove("hidden");
        expandedConfigPanel.classList.add("flex");
      }
      if (cam1PresetsSection) cam1PresetsSection.classList.add("hidden");
      if (cam2PresetsSection) cam2PresetsSection.classList.remove("hidden");
    }
  }

  // Update each camera's telemetry, feed viewport, and Start/Stop Receiving button
  (["cam1", "cam2"] as const).forEach((camId, idx) => {
    const n = (idx + 1) as 1 | 2;
    const cam = camerasMap.get(camId);
    renderCameraFeedViewport(camId, n);
    if (!cam) return;

    const posEl = document.getElementById(`cam-pos-${n}`);
    if (posEl && cam.position) {
      posEl.textContent = `P:${cam.position.pan} T:${cam.position.tilt} Z:${cam.position.zoom}`;
    }

    const sfBadge = document.getElementById(`cam${n}-sf-badge`);
    if (sfBadge) {
      sfBadge.textContent = `SmartFrame: ${(cam.smartFrame || "disabled").toUpperCase()}`;
    }

    const streamBtn = document.getElementById(`cam-stream-btn-${n}`);
    const dot = document.getElementById(`cam-dot-${n}`);
    const meta = document.getElementById(`cam-meta-${n}`);

    if (streamBtn) {
      streamBtn.textContent = cam.streaming ? "Stop Receiving" : "Start Receiving";
      streamBtn.className = cam.streaming
        ? "px-2 py-0.5 rounded bg-error text-on-error font-label-sm text-[9px] font-bold uppercase shadow-xs"
        : `px-2 py-0.5 rounded bg-surface-container-lowest ${n === 1 ? "text-primary" : "text-secondary"} font-label-sm text-[9px] font-bold uppercase shadow-xs`;
    }
    if (dot) {
      dot.className = cam.streaming
        ? "w-2 h-2 rounded-full bg-emerald-500 inline-block"
        : "w-2 h-2 rounded-full bg-outline inline-block";
    }
    if (meta) {
      meta.textContent = cam.streaming ? "Receiving Preview" : "Not Receiving";
    }
  });

  renderCameraPresets();
}

function parseVisiblePresets(): number[] {
  const input = document.getElementById("presetRangeInput") as HTMLInputElement | null;
  const raw = input ? input.value : "1, 2, 3, 4, 5, 6";
  const nums: number[] = [];
  raw.split(",").forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    if (trimmed.includes("-")) {
      const [aStr, bStr] = trimmed.split("-");
      const a = parseInt(aStr ?? "", 10);
      const b = parseInt(bStr ?? "", 10);
      if (!Number.isNaN(a) && !Number.isNaN(b) && a <= b) {
        for (let i = a; i <= Math.min(b, a + 24); i++) {
          if (i >= 0 && i <= 254 && !nums.includes(i)) nums.push(i);
        }
      }
    } else {
      const n = parseInt(trimmed, 10);
      if (!Number.isNaN(n) && n >= 0 && n <= 254 && !nums.includes(n)) {
        nums.push(n);
      }
    }
  });
  return nums.length > 0 ? nums : [1, 2, 3, 4, 5, 6];
}

function getPresetName(camId: "cam1" | "cam2", presetId: number): string {
  const cam = camerasMap.get(camId);
  const found = cam?.presets?.find((p) => p.id === presetId);
  if (found?.name) return found.name;
  return DEFAULT_PRESET_NAMES[camId]?.[presetId] || `Preset ${presetId}`;
}

function getPresetThumbnail(camId: "cam1" | "cam2", presetId: number): string | undefined {
  const cam = camerasMap.get(camId);
  const found = cam?.presets?.find((p) => p.id === presetId);
  return found?.thumbnail;
}

function renderCameraPresets(): void {
  const slots = parseVisiblePresets();
  (["cam1", "cam2"] as const).forEach((camId) => {
    const grid = document.getElementById(`${camId}-presets-grid`);
    if (!grid) return;
    const isCam1 = camId === "cam1";
    const activeSlot = activePresetByCam[camId];

    grid.innerHTML = slots
      .map((slotId) => {
        const isSelected = slotId === activeSlot;
        const name = getPresetName(camId, slotId);
        const thumbUrl = getPresetThumbnail(camId, slotId);
        const numLabel = `P-${String(slotId).padStart(2, "0")}`;

        if (presetDisplayMode === "thumb") {
          const borderCls = isSelected
            ? isCam1
              ? "border-2 border-primary ring-2 ring-primary/20"
              : "border-2 border-secondary ring-2 ring-secondary/20"
            : "border border-outline-variant/40";
          const imgHtml = thumbUrl
            ? `<img src="${thumbUrl}" alt="${name}" class="w-full h-16 object-cover"/>`
            : `<div class="w-full h-16 bg-inverse-surface flex flex-col items-center justify-center text-inverse-on-surface/60">
                 <span class="material-symbols-outlined text-[16px]">photo_camera</span>
                 <span class="font-label-sm text-[8px] uppercase">No Thumb</span>
               </div>`;
          return `<button type="button" onclick="handlePresetTap('${camId}', ${slotId})" class="rounded-lg overflow-hidden bg-surface-container-high ${borderCls} flex flex-col active:scale-95 transition-all text-left shadow-xs">
            <div class="relative w-full h-16">
              ${imgHtml}
              <span class="absolute top-1 left-1 px-1 py-0.2 rounded bg-black/70 text-white font-label-sm text-[8px] font-bold">${numLabel}</span>
            </div>
            <div class="px-1.5 py-1 flex items-center justify-between w-full bg-surface-container-low">
              <span class="font-body-md text-[10px] font-semibold text-on-surface truncate">${name}</span>
            </div>
          </button>`;
        }

        const activeCls = isSelected
          ? isCam1
            ? "bg-primary text-on-primary shadow-sm"
            : "bg-secondary text-on-secondary shadow-sm"
          : "bg-surface-container-high hover:bg-surface-container-highest text-on-surface";

        const subCls = isSelected ? "opacity-80" : "text-on-surface-variant";

        if (presetDisplayMode === "number") {
          return `<button type="button" onclick="handlePresetTap('${camId}', ${slotId})" class="h-12 rounded-lg ${activeCls} p-space-xs flex flex-col items-center justify-center active:scale-95 transition-all">
            <span class="font-label-lg text-[14px] font-bold">${numLabel}</span>
          </button>`;
        }

        return `<button type="button" onclick="handlePresetTap('${camId}', ${slotId})" class="h-12 rounded-lg ${activeCls} p-space-xs flex flex-col justify-between items-start active:scale-95 transition-all">
          <div class="w-full flex items-center justify-between">
            <span class="font-label-sm text-[9px] uppercase ${subCls}">${numLabel}</span>
            ${
              thumbUrl
                ? `<span class="material-symbols-outlined text-[11px] ${subCls}" title="Thumbnail saved">image</span>`
                : ""
            }
          </div>
          <span class="font-body-md text-xs font-semibold truncate w-full text-left">${name}</span>
        </button>`;
      })
      .join("");
  });
}

function toggleSavePresetMode(): void {
  savePresetMode = !savePresetMode;
  if (savePresetMode && thumbCaptureMode) {
    thumbCaptureMode = false;
    updateThumbToggleUi();
  }
  const pill = document.getElementById("savePresetPill");
  const knob = document.getElementById("savePresetKnob");
  const sub = document.getElementById("savePresetSub");
  if (pill && knob) {
    if (savePresetMode) {
      pill.className = "w-8 h-4 rounded-full bg-primary flex items-center p-0.5 transition-colors";
      knob.className = "w-3 h-3 rounded-full bg-on-primary translate-x-4 transition-transform";
      if (sub) sub.textContent = "ARMED: Tap slot to save";
      showToast("Save Preset ARMED — tap any preset slot to store");
    } else {
      pill.className =
        "w-8 h-4 rounded-full bg-surface-container-highest flex items-center p-0.5 transition-colors";
      knob.className = "w-3 h-3 rounded-full bg-outline transition-transform";
      if (sub) sub.textContent = "Tap slot to store";
    }
  }
}

function updateThumbToggleUi(): void {
  const pill = document.getElementById("thumbPill");
  const knob = document.getElementById("thumbKnob");
  const sub = document.getElementById("thumbCaptureSub");
  if (pill && knob) {
    if (thumbCaptureMode) {
      pill.className = "w-8 h-4 rounded-full bg-secondary flex items-center p-0.5 transition-colors";
      knob.className = "w-3 h-3 rounded-full bg-on-secondary translate-x-4 transition-transform";
      if (sub) sub.textContent = "Tap slot to snap thumb";
    } else {
      pill.className =
        "w-8 h-4 rounded-full bg-surface-container-highest flex items-center p-0.5 transition-colors";
      knob.className = "w-3 h-3 rounded-full bg-outline transition-transform";
      if (sub) sub.textContent = "Tap or hold for auto";
    }
  }
}

async function captureAndSaveThumbnailForPreset(
  camId: "cam1" | "cam2",
  presetId: number
): Promise<void> {
  const cam = camerasMap.get(camId);
  const pos = cam?.position ?? { pan: 0, tilt: 0, zoom: 0 };
  const name = getPresetName(camId, presetId);
  const dataUrl = generatePresetThumbnailDataUrl(camId, presetId, name, pos);

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/presets/${presetId}/thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnail: dataUrl })
    });
    if (res.ok) {
      const data = (await res.json()) as { camera?: CameraSnapshot };
      if (data.camera) {
        camerasMap.set(camId, data.camera);
      }
    }
  } catch {
    // Fallback local update
    if (cam) {
      const existing = cam.presets.find((p) => p.id === presetId);
      if (existing) {
        existing.thumbnail = dataUrl;
      } else {
        cam.presets.push({ id: presetId, name, thumbnail: dataUrl });
      }
    }
  }

  // Per user instruction: "when we capture a thumbnail for preset 3, we save that image and show it, then preset view is set to thumb."
  setPresetViewMode("thumb");
}

// Long hold on THUMB CAPTURE: automatic recall preset N + wait 2 sec + record thumb, move on to next preset
async function runAutoThumbnailSweep(): Promise<void> {
  if (autoSweepingThumbs) return;
  autoSweepingThumbs = true;
  const camId = selectedCameraId;
  const presets = parseVisiblePresets();
  const badge = document.getElementById("auto-sweep-badge");
  if (badge) {
    badge.classList.remove("hidden");
  }

  showToast(`Auto Thumb Capture started for ${camId.toUpperCase()} (${presets.length} presets)`);

  try {
    for (let i = 0; i < presets.length; i++) {
      const presetId = presets[i]!;
      activePresetByCam[camId] = presetId;
      if (badge) {
        badge.textContent = `Auto-Thumb: Preset ${presetId} (${i + 1}/${presets.length}) — recalling & waiting 2s...`;
      }
      renderCameraPresets();

      // 1. Recall preset N
      await fetch(`/api/v1/cameras/${camId}/presets/${presetId}/recall`, {
        method: "POST"
      }).catch(() => {});

      const camRes = await fetch(`/api/v1/cameras/${camId}`).catch(() => null);
      if (camRes && camRes.ok) {
        camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
        renderCamerasTab();
      }

      // 2. Wait 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 3. Record thumbnail & switch view to thumb
      await captureAndSaveThumbnailForPreset(camId, presetId);
      showToast(`Captured thumbnail for ${camId.toUpperCase()} Preset ${presetId}`);
    }
    showToast(`Completed Auto Thumb Capture (${presets.length} presets)`);
  } finally {
    autoSweepingThumbs = false;
    if (badge) {
      badge.classList.add("hidden");
    }
  }
}

function bindThumbCaptureButton(): void {
  const btn = document.getElementById("setThumbBtn");
  if (!btn) return;

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let longHoldTriggered = false;

  btn.addEventListener("pointerdown", () => {
    longHoldTriggered = false;
    holdTimer = setTimeout(() => {
      longHoldTriggered = true;
      holdTimer = null;
      void runAutoThumbnailSweep();
    }, 600);
  });

  const clearHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  btn.addEventListener("pointerup", clearHold);
  btn.addEventListener("pointerleave", clearHold);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (longHoldTriggered) {
      longHoldTriggered = false;
      return;
    }
    thumbCaptureMode = !thumbCaptureMode;
    if (thumbCaptureMode && savePresetMode) {
      toggleSavePresetMode();
    }
    updateThumbToggleUi();
    if (thumbCaptureMode) {
      showToast("Thumb Capture ARMED — tap any preset to snap thumbnail (or hold button for auto-sweep)");
    }
  });
}

function setPresetViewMode(mode: "name" | "number" | "thumb"): void {
  presetDisplayMode = mode;
  const btns = document.querySelectorAll<HTMLButtonElement>(".preset-view-mode-btn");
  btns.forEach((btn) => {
    if (btn.getAttribute("data-mode") === mode) {
      btn.className =
        "preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase font-bold bg-surface text-primary shadow-sm";
    } else {
      btn.className =
        "preset-view-mode-btn px-2 py-1 rounded font-label-sm text-[10px] uppercase text-on-surface-variant";
    }
  });
  renderCameraPresets();
}

async function handlePresetTap(camId: "cam1" | "cam2", presetId: number): Promise<void> {
  selectedCameraId = camId;
  activePresetByCam[camId] = presetId;

  if (savePresetMode) {
    const defaultName = getPresetName(camId, presetId);
    try {
      const res = await fetch(`/api/v1/cameras/${camId}/presets/${presetId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: defaultName })
      });
      if (res.ok) {
        if (thumbCaptureMode) {
          await captureAndSaveThumbnailForPreset(camId, presetId);
          thumbCaptureMode = false;
          updateThumbToggleUi();
        }
        showToast(`Saved ${camId.toUpperCase()} Preset ${presetId} (${defaultName})`);
        toggleSavePresetMode();
        const camRes = await fetch(`/api/v1/cameras/${camId}`);
        if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
        renderCamerasTab();
      }
    } catch {
      showToast("Failed to save preset");
    }
    return;
  }

  if (thumbCaptureMode) {
    await captureAndSaveThumbnailForPreset(camId, presetId);
    thumbCaptureMode = false;
    updateThumbToggleUi();
    showToast(`Captured thumbnail for ${camId.toUpperCase()} Preset ${presetId}`);
    return;
  }

  try {
    const res = await fetch(`/api/v1/cameras/${camId}/presets/${presetId}/recall`, {
      method: "POST"
    });
    if (res.ok) {
      showToast(`Recalled ${camId.toUpperCase()} Preset ${presetId}`);
      const camRes = await fetch(`/api/v1/cameras/${camId}`);
      if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
      renderCamerasTab();
    }
  } catch {
    showToast("Failed to recall preset");
  }
}

async function sendPTZMove(direction: string): Promise<void> {
  const camId = selectedCameraId;
  const tiltSpeed = Math.min(23, ptzSpeed);
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction, panSpeed: ptzSpeed, tiltSpeed })
    });
    if (res.ok) {
      const camRes = await fetch(`/api/v1/cameras/${camId}`);
      if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
      renderCamerasTab();
    }
  } catch {
    showToast("PTZ Move failed");
  }
}

async function sendPTZZoom(action: "in" | "out" | "stop"): Promise<void> {
  const camId = selectedCameraId;
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/zoom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, speed: 4 })
    });
    if (res.ok) {
      const camRes = await fetch(`/api/v1/cameras/${camId}`);
      if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
      renderCamerasTab();
    }
  } catch {
    showToast("Zoom command failed");
  }
}

async function sendSmartFrame(mode: "enable" | "disable" | "trigger"): Promise<void> {
  const camId = selectedCameraId;
  try {
    const res = await fetch(`/api/v1/cameras/${camId}/smartframe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode })
    });
    if (res.ok) {
      const camRes = await fetch(`/api/v1/cameras/${camId}`);
      if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
      renderCamerasTab();
      showToast(`${camId.toUpperCase()} SmartFrame: ${mode.toUpperCase()}`);
    }
  } catch {
    showToast("SmartFrame command failed");
  }
}

async function toggleCameraStream(camId: "cam1" | "cam2"): Promise<void> {
  const cam = camerasMap.get(camId);
  const endpoint = cam?.streaming
    ? `/api/v1/cameras/${camId}/stream/stop`
    : `/api/v1/cameras/${camId}/stream/start`;
  try {
    const res = await fetch(endpoint, { method: "POST" });
    if (res.ok) {
      const camRes = await fetch(`/api/v1/cameras/${camId}`);
      if (camRes.ok) camerasMap.set(camId, (await camRes.json()) as CameraSnapshot);
      renderCamerasTab();
      showToast(
        `${camId.toUpperCase()}: ${cam?.streaming ? "Stopped receiving preview" : "Started receiving preview"}`
      );
    }
  } catch {
    showToast("Camera receive toggle failed");
  }
}

function adjustPtzSpeed(delta: number): void {
  ptzSpeed = Math.max(1, Math.min(24, ptzSpeed + delta));
  const hex = "0x" + ptzSpeed.toString(16).toUpperCase().padStart(2, "0");
  const label = document.getElementById("ptz-speed-label");
  const bar = document.getElementById("ptz-speed-bar");
  if (label) label.textContent = `SPD ${ptzSpeed} (${hex})`;
  if (bar) bar.style.width = `${Math.round((ptzSpeed / 24) * 100)}%`;
}

// ============================================================================
// Dialog light-dismiss backdrop fallback
// ============================================================================
function bindDialogBackdropDismiss(dialogId: string): void {
  const dialog = document.getElementById(dialogId) as HTMLDialogElement | null;
  if (!dialog) return;
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      dialog.close();
    }
  });
}

// ============================================================================
// Hydration, REST Fallback & SSE Real-Time Synchronization
// ============================================================================
function applyInitialState(init: FrontendInitialState): void {
  activeTab = init.activeTab || "outputs";
  for (const s of init.sources || []) sourcesMap.set(s.id, s);
  for (const o of init.outputs || []) outputsMap.set(o.id, o);
  for (const e of init.effects || []) effectsMap.set(e.sourceId, e);
  for (const c of init.cameras || []) camerasMap.set(c.id, c);
  for (const p of init.pipgmPipelines || []) pipgmMap.set(p.id, p);
  if (init.multiview?.layout) multiviewLayout = init.multiview.layout;
  if (init.matrix) matrixState = init.matrix;
  if (init.rtspOut) rtspOut = { ...rtspOut, ...init.rtspOut };
}

async function fetchInitialFromApiIfNeeded(): Promise<void> {
  if (window.__PIMATRIX_INITIAL__) {
    applyInitialState(window.__PIMATRIX_INITIAL__);
    return;
  }

  // Determine tab from pathname if opened directly via Vite dev server
  const p = window.location.pathname;
  if (p.startsWith("/inputs")) activeTab = "inputs";
  else if (p.startsWith("/cameras")) activeTab = "cameras";
  else if (p.startsWith("/pipgm") || p.startsWith("/renderer")) activeTab = "renderer";
  else activeTab = "outputs";

  const [srcRes, outRes, fxRes, camRes, matRes, rtspRes] = await Promise.all([
    fetch("/api/v1/sources?includeHidden=true").catch(() => null),
    fetch("/api/v1/outputs").catch(() => null),
    fetch("/api/v1/effects?includeHidden=true").catch(() => null),
    fetch("/api/v1/cameras").catch(() => null),
    fetch("/api/v1/matrix").catch(() => null),
    fetch("/api/v1/outputs/rtsp").catch(() => null)
  ]);

  if (srcRes?.ok) {
    const data = (await srcRes.json()) as { items: SourceItem[] };
    data.items.forEach((s) => sourcesMap.set(s.id, s));
  }
  if (outRes?.ok) {
    const data = (await outRes.json()) as { items: OutputSnapshot[] };
    data.items.forEach((o) => outputsMap.set(o.id, o));
  }
  if (fxRes?.ok) {
    const data = (await fxRes.json()) as { items: EffectsPipeline[] };
    data.items.forEach((e) => effectsMap.set(e.sourceId, e));
  }
  if (camRes?.ok) {
    const data = (await camRes.json()) as { items: CameraSnapshot[] };
    data.items.forEach((c) => camerasMap.set(c.id, c));
  }
  if (matRes?.ok) {
    matrixState = (await matRes.json()) as MatrixRouteState;
  }
  if (rtspRes?.ok) {
    rtspOut = { ...rtspOut, ...((await rtspRes.json()) as RtspOutState) };
  }
}

function connectSse(): void {
  const sse = new EventSource("/api/v1/events");
  const sseDot = document.getElementById("sse-dot");
  const sseText = document.getElementById("sse-status-text");

  sse.addEventListener("open", () => {
    if (sseDot) sseDot.className = "w-2 h-2 rounded-full bg-emerald-500 animate-pulse";
    if (sseText) sseText.textContent = "ONLINE";
  });

  sse.addEventListener("output", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as { output?: OutputSnapshot };
      if (payload.output) {
        outputsMap.set(payload.output.id, payload.output);
        renderOutputsTab();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("effects", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as {
        sourceId?: SourceId;
        effects?: EffectsPipeline;
      };
      if (payload.sourceId && payload.effects) {
        effectsMap.set(payload.sourceId, payload.effects);
        renderOutputsTab();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("pipgm", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as { pipeline?: PiPgmPipelineSnapshot };
      if (payload.pipeline) {
        pipgmMap.set(payload.pipeline.id, payload.pipeline);
        const existingFx = effectsMap.get(payload.pipeline.id);
        if (existingFx) {
          existingFx.fadeToBlack = payload.pipeline.fadeToBlack;
          existingFx.muted = !payload.pipeline.audioEnabled;
        }
        renderOutputsTab();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("matrix", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as MatrixRouteState;
      if (payload) {
        matrixState = {
          locked: Boolean(payload.locked),
          routes: payload.routes || matrixState.routes
        };
        renderMatrixTab();
        renderRoutedToBadges();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("rtsp", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as RtspOutState;
      if (payload) {
        rtspOut = { ...rtspOut, ...payload };
        renderRtspSection();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("camera", (e) => {
    try {
      const payload = JSON.parse((e as MessageEvent).data) as {
        id: string;
        position?: { pan: number; tilt: number; zoom: number };
        streaming?: boolean;
        smartFrame?: CameraSnapshot["smartFrame"];
      };
      const cam = camerasMap.get(payload.id);
      if (cam) {
        if (payload.position) cam.position = payload.position;
        if (typeof payload.streaming === "boolean") cam.streaming = payload.streaming;
        if (payload.smartFrame) cam.smartFrame = payload.smartFrame;
        renderCamerasTab();
      }
    } catch {
      // ignore
    }
  });

  sse.addEventListener("error", () => {
    if (sseDot) sseDot.className = "w-2 h-2 rounded-full bg-error";
    if (sseText) sseText.textContent = "RECONNECTING";
  });
}

// Expose global handlers for inline onclick attributes
window.switchTab = (tab) => switchTab(tab, true);
window.selectHdmiSource = selectHdmiSource;
window.openAuxModal = openAuxModal;
window.closeAuxModal = closeAuxModal;
window.confirmAuxPick = confirmAuxPick;
window.toggleOutputInputControl = toggleOutputInputControl;
window.toggleInputEffect = toggleInputEffect;
window.openOutputCropModal = openOutputCropModal;
window.openSourceCropModal = openSourceCropModal;
window.closeCropModal = closeCropModal;
window.applySourceCropPreset = applySourceCropPreset;
window.moveSourceCrop = moveSourceCrop;
window.resizeSourceCrop = resizeSourceCrop;
window.toggleSourceCropLockAspect = toggleSourceCropLockAspect;
window.openRtspModal = openRtspModal;
window.closeRtspModal = closeRtspModal;
window.assignRtsp = assignRtsp;
window.setRtspQualityProfile = setRtspQualityProfile;
window.updateRtspCustomQuality = updateRtspCustomQuality;
window.toggleRtspStream = toggleRtspStream;
window.toggleMatrixLock = toggleMatrixLock;
window.routeMatrixCrosspoint = routeMatrixCrosspoint;
window.selectCamera = selectCamera;
window.toggleCamFocus = toggleCamFocus;
window.toggleCameraStream = toggleCameraStream;
window.toggleSavePresetMode = toggleSavePresetMode;
window.setPresetViewMode = setPresetViewMode;
window.renderCameraPresets = renderCameraPresets;
window.handlePresetTap = handlePresetTap;
window.sendPTZMove = sendPTZMove;
window.sendPTZZoom = sendPTZZoom;
window.sendSmartFrame = sendSmartFrame;
window.adjustPtzSpeed = adjustPtzSpeed;

async function bootstrap(): Promise<void> {
  bindDialogBackdropDismiss("aux-modal-overlay");
  bindDialogBackdropDismiss("rtsp-modal-overlay");
  bindDialogBackdropDismiss("crop-modal-overlay");
  bindOutputHeadersLongPressForCrop();
  bindCropInteractiveDrag();
  bindThumbCaptureButton();

  await fetchInitialFromApiIfNeeded();

  switchTab(activeTab, false);
  renderOutputsTab();
  renderMatrixTab();
  renderCamerasTab();
  connectSse();
}

void bootstrap();
