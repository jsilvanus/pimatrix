import type { EffectsPipeline } from "./effects/effects-model.js";
import type { MultiviewSnapshot } from "./model.js";

export function renderMultiviewHtml(
  multiview: MultiviewSnapshot,
  previewBaseUrl?: string,
  effects: EffectsPipeline[] = []
): string {
  const effectsMap = new Map<string, EffectsPipeline>(effects.map((e) => [e.sourceId, e]));

  const tilesHtml = multiview.tiles
    .map((tile) => {
      const isLive = tile.state === "live";
      const isFtb = tile.pipgm?.fadeToBlack === true;
      const audioOn = tile.pipgm?.audioEnabled === true;
      const statusClass = isFtb ? "ftb" : isLive ? "live" : "offline";
      const statusText = isFtb ? "⬛ FTB" : tile.state.toUpperCase();
      const previewUrl = tile.preview.url ?? (previewBaseUrl ? `${previewBaseUrl}/${encodeURIComponent(tile.sourceId)}` : null);
      const replacedNote = tile.replacedSourceId ? ` <small class="replaced-tag">(replaces ${tile.replacedSourceId})</small>` : "";
      const pipgmBadges = tile.pipgm
        ? `<span class="pipgm-meta" id="pipgm-meta-${tile.sourceId}">${audioOn ? "🔊 ON" : "🔇 MUTED"} • ${tile.pipgm.orientation === "portrait" ? "9:16" : "16:9"}</span>`
        : "";
      const fx = effectsMap.get(tile.sourceId);
      const cropBadge = fx?.crop.enabled
        ? `<span class="crop-badge active" id="crop-badge-${tile.sourceId}">CROP ${fx.crop.aspectRatio}</span>`
        : `<span class="crop-badge" id="crop-badge-${tile.sourceId}" style="display:none">CROP</span>`;

      return `
    <div class="tile ${isFtb ? "tile-ftb" : ""}" id="tile-${tile.sourceId}">
      <div class="tile-header">
        <span class="tile-label">${tile.label} <small>(${tile.sourceId})</small>${replacedNote}</span>
        <div class="tile-badges">
          ${pipgmBadges}
          ${cropBadge}
          <button class="crop-btn" onclick="openCropModal('${tile.sourceId}', '${tile.label}')" title="Adjust Crop & Effects">✂ Crop</button>
          <span class="status-badge ${statusClass}" id="status-${tile.sourceId}">${statusText}</span>
        </div>
      </div>
      <div class="tile-content" id="content-${tile.sourceId}">
        ${
          previewUrl && isLive
            ? `<iframe src="${previewUrl}" allow="autoplay; fullscreen" loading="lazy"></iframe>`
            : `<div class="placeholder">
                <div class="icon">${isFtb ? "⬛" : "📹"}</div>
                <div class="name">${tile.label}</div>
                <div class="kind">${isFtb ? "FADED TO BLACK" : tile.kind}</div>
              </div>`
        }
        <div class="ftb-banner" id="ftb-banner-${tile.sourceId}" style="display: ${isFtb ? "flex" : "none"};">
          <span>⬛ OUTPUT FADED TO BLACK</span>
          <small id="ftb-summary-${tile.sourceId}">${tile.pipgm?.cuedSummary ?? ""}</small>
        </div>
      </div>
    </div>`;
    })
    .join("\n");

  const effectsJson = JSON.stringify(effects);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>PiMatrix Multiview (8-Way) & Effects</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #151c2e;
      --border: #232d45;
      --text: #e2e8f0;
      --live: #22c55e;
      --offline: #ef4444;
      --warning: #f59e0b;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      touch-action: manipulation;
    }
    header {
      background: rgba(11, 15, 25, 0.95);
      backdrop-filter: blur(8px);
      padding: 6px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      z-index: 10;
    }
    .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
    .brand span { color: #60a5fa; }
    .meta { font-size: 11px; color: #94a3b8; display: flex; gap: 10px; align-items: center; }
    .mode-pill {
      background: #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      border: 1px solid #334155;
    }

    /* Multiview Grid */
    .grid {
      display: grid;
      flex: 1;
      width: 100%;
      height: 100%;
      padding: 4px;
      gap: 4px;
      background: #000;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(2, 1fr);
    }

    @media (orientation: portrait), (max-aspect-ratio: 1/1) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
        grid-template-rows: repeat(4, 1fr);
      }
    }

    .tile {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .tile.tile-ftb {
      border-color: var(--warning);
    }
    .tile-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 3px 6px;
      background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 5;
    }
    .tile-badges {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .pipgm-meta {
      font-size: 8px;
      background: rgba(15, 23, 42, 0.85);
      color: #cbd5e1;
      padding: 1px 4px;
      border-radius: 2px;
      border: 1px solid #334155;
    }
    .replaced-tag {
      color: #38bdf8;
    }
    .tile-label {
      font-size: 11px;
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tile-label small { opacity: 0.75; font-size: 9px; }
    .tile-badges { display: flex; gap: 4px; align-items: center; }
    .status-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
      text-shadow: none;
      letter-spacing: 0.5px;
    }
    .status-badge.live { background: var(--live); color: #000; }
    .status-badge.offline { background: rgba(239, 68, 68, 0.4); color: #fca5a5; }
    .status-badge.ftb { background: var(--warning); color: #000; }

    .ftb-banner {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(245, 158, 11, 0.92);
      color: #000;
      font-size: 10px;
      font-weight: 800;
      padding: 3px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 3;
    }
    .ftb-banner small { font-weight: 600; font-size: 9px; opacity: 0.85; }

    .crop-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 2px;
      background: #8b5cf6;
      color: #fff;
      letter-spacing: 0.5px;
    }

    .crop-btn {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #475569;
      color: #cbd5e1;
      border-radius: 3px;
      font-size: 9px;
      padding: 1px 5px;
      cursor: pointer;
      pointer-events: auto;
    }
    .crop-btn:hover { background: #334155; color: #fff; }

    .tile-content {
      width: 100%;
      height: 100%;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
    }
    .tile-content iframe {
      width: 100%;
      height: 100%;
      border: 0;
      object-fit: contain;
    }
    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #475569;
      font-size: 11px;
    }
    .placeholder .icon { font-size: 22px; margin-bottom: 2px; opacity: 0.6; }
    .placeholder .name { color: #64748b; font-weight: 500; }
    .placeholder .kind { font-size: 9px; color: #475569; text-transform: uppercase; }

    /* Modal / Crop Controller */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-overlay.open { display: flex; }
    .modal-card {
      background: #111827;
      border: 1px solid #374151;
      border-radius: 8px;
      width: 92vw;
      max-width: 520px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #1f2937;
      padding-bottom: 8px;
    }
    .modal-title { font-size: 14px; font-weight: 700; color: #f3f4f6; }
    .modal-close {
      background: none;
      border: none;
      color: #9ca3af;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
    }

    /* Preview Canvas representation */
    .preview-box {
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #030712;
      border: 1px solid #1f2937;
      border-radius: 4px;
      position: relative;
      overflow: hidden;
    }
    .crop-rect {
      position: absolute;
      border: 2px dashed #3b82f6;
      background: rgba(59, 130, 246, 0.15);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
      transition: all 0.15s ease-out;
      pointer-events: none;
    }
    .crop-rect-label {
      position: absolute;
      top: 2px;
      left: 2px;
      font-size: 9px;
      background: #3b82f6;
      color: #fff;
      padding: 1px 3px;
      border-radius: 2px;
      font-weight: 600;
    }

    /* Controls */
    .ctrl-section { display: flex; flex-direction: column; gap: 6px; }
    .ctrl-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; }
    .btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn {
      background: #1f2937;
      border: 1px solid #374151;
      color: #e5e7eb;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      flex: 1;
      min-width: 90px;
      text-align: center;
    }
    .btn:hover { background: #374151; color: #fff; }
    .btn.active { background: #2563eb; border-color: #3b82f6; color: #fff; }
    .btn.accent { background: #0284c7; border-color: #38bdf8; }
    .btn.danger { background: #991b1b; border-color: #ef4444; }

    /* D-pad Pan & Zoom */
    .dpad-container {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    .dpad {
      display: grid;
      grid-template-columns: repeat(3, 40px);
      grid-template-rows: repeat(3, 36px);
      gap: 3px;
    }
    .dpad button {
      background: #1f2937;
      border: 1px solid #374151;
      color: #f3f4f6;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dpad button:hover { background: #3b82f6; color: #fff; }
    .zoom-group { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .crop-coords { font-size: 11px; color: #94a3b8; font-family: monospace; }
  </style>
</head>
<body>
  <header>
    <div class="brand">Pi<span>Matrix</span> Multiview & Effects</div>
    <div class="meta">
      <span class="mode-pill" id="grid-mode">Auto (4x2 / 2x4)</span>
      <span id="sse-indicator" style="color: #64748b;">● Connected</span>
    </div>
  </header>
  <main class="grid">
    ${tilesHtml}
  </main>

  <!-- Crop Modal -->
  <div class="modal-overlay" id="crop-modal" onclick="if(event.target===this)closeCropModal()">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title" id="modal-source-title">Crop & Effects: Source</div>
        <button class="modal-close" onclick="closeCropModal()">&times;</button>
      </div>

      <!-- Live Crop Box Preview -->
      <div class="preview-box" id="preview-box">
        <div class="crop-rect" id="crop-rect">
          <span class="crop-rect-label" id="crop-rect-label">9:16</span>
        </div>
      </div>

      <div class="crop-coords" id="crop-coords">
        x: 0, y: 0, w: 1920, h: 1080 | FFmpeg: null
      </div>

      <!-- Presets for Vertical / Landscape -->
      <div class="ctrl-section">
        <div class="ctrl-label">Aspect Ratio Presets</div>
        <div class="btn-row">
          <button class="btn accent" onclick="applyPreset('force-vertical-9-16')">📱 9:16 Vertical</button>
          <button class="btn accent" onclick="applyPreset('force-vertical-10-16')">📽 10:16 Epson Projector</button>
          <button class="btn" onclick="applyPreset('force-landscape-16-9')">🖥 16:9 Landscape</button>
          <button class="btn danger" onclick="applyPreset('reset')">↺ Full / Reset</button>
        </div>
      </div>

      <!-- Pan & Zoom Controls -->
      <div class="ctrl-section">
        <div class="ctrl-label">Move (Pan) & Resize (Zoom)</div>
        <div class="dpad-container">
          <div class="dpad">
            <div></div>
            <button onclick="moveCrop('up')">▲</button>
            <div></div>
            <button onclick="moveCrop('left')">◄</button>
            <button onclick="moveCrop('center')" style="font-size:10px;">⛶</button>
            <button onclick="moveCrop('right')">►</button>
            <div></div>
            <button onclick="moveCrop('down')">▼</button>
            <div></div>
          </div>
          <div class="zoom-group">
            <button class="btn" onclick="resizeCrop('in')">🔍+ Zoom In (Tighter Crop)</button>
            <button class="btn" onclick="resizeCrop('out')">🔍- Zoom Out (Wider Crop)</button>
            <button class="btn" onclick="toggleLockAspect()" id="btn-lock-aspect">🔒 Lock Aspect: ON</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Initial effects data from server
    let currentEffects = new Map((${effectsJson}).map(e => [e.sourceId, e]));
    let activeSourceId = null;

    function updateLayoutIndicator() {
      const isPortrait = window.matchMedia("(orientation: portrait), (max-aspect-ratio: 1/1)").matches;
      document.getElementById("grid-mode").textContent = isPortrait ? "Vertical 2x4" : "Landscape 4x2";
    }
    window.addEventListener("resize", updateLayoutIndicator);
    window.addEventListener("orientationchange", updateLayoutIndicator);
    updateLayoutIndicator();

    function openCropModal(sourceId, label) {
      activeSourceId = sourceId;
      document.getElementById("modal-source-title").textContent = "Crop & Effects: " + label + " (" + sourceId + ")";
      document.getElementById("crop-modal").classList.add("open");
      updateCropDisplay();
    }

    function closeCropModal() {
      document.getElementById("crop-modal").classList.remove("open");
      activeSourceId = null;
    }

    function updateCropDisplay() {
      if (!activeSourceId) return;
      const fx = currentEffects.get(activeSourceId);
      if (!fx) return;

      const crop = fx.crop;
      const rect = document.getElementById("crop-rect");
      const label = document.getElementById("crop-rect-label");
      const coords = document.getElementById("crop-coords");
      const lockBtn = document.getElementById("btn-lock-aspect");

      if (lockBtn) {
        lockBtn.textContent = crop.lockedAspectRatio ? "🔒 Lock Aspect: ON" : "🔓 Lock Aspect: OFF";
      }

      const sw = crop.sourceWidth || 1920;
      const sh = crop.sourceHeight || 1080;

      const leftPct = (crop.x / sw) * 100;
      const topPct = (crop.y / sh) * 100;
      const widthPct = (crop.width / sw) * 100;
      const heightPct = (crop.height / sh) * 100;

      rect.style.left = leftPct + "%";
      rect.style.top = topPct + "%";
      rect.style.width = widthPct + "%";
      rect.style.height = heightPct + "%";

      label.textContent = crop.aspectRatio + (crop.enabled ? " [ACTIVE]" : " [OFF]");
      coords.textContent = "x: " + crop.x + ", y: " + crop.y + ", w: " + crop.width + ", h: " + crop.height + " | FFmpeg: " + fx.ffmpegFilter;

      // Update tile badge
      const tileBadge = document.getElementById("crop-badge-" + activeSourceId);
      if (tileBadge) {
        if (crop.enabled) {
          tileBadge.style.display = "inline-block";
          tileBadge.textContent = "CROP " + crop.aspectRatio;
        } else {
          tileBadge.style.display = "none";
        }
      }
    }

    async function applyPreset(preset) {
      if (!activeSourceId) return;
      try {
        const res = await fetch("/api/v1/sources/" + activeSourceId + "/effects/crop/preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset })
        });
        if (res.ok) {
          const updated = await res.json();
          currentEffects.set(activeSourceId, updated);
          updateCropDisplay();
        }
      } catch (err) {
        console.error("Failed to apply crop preset", err);
      }
    }

    async function moveCrop(direction) {
      if (!activeSourceId) return;
      try {
        const res = await fetch("/api/v1/sources/" + activeSourceId + "/effects/crop/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction, delta: 32 })
        });
        if (res.ok) {
          const updated = await res.json();
          currentEffects.set(activeSourceId, updated);
          updateCropDisplay();
        }
      } catch (err) {
        console.error("Failed to move crop", err);
      }
    }

    async function resizeCrop(action) {
      if (!activeSourceId) return;
      try {
        const res = await fetch("/api/v1/sources/" + activeSourceId + "/effects/crop/resize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, factor: 0.1 })
        });
        if (res.ok) {
          const updated = await res.json();
          currentEffects.set(activeSourceId, updated);
          updateCropDisplay();
        }
      } catch (err) {
        console.error("Failed to resize crop", err);
      }
    }

    async function toggleLockAspect() {
      if (!activeSourceId) return;
      const current = currentEffects.get(activeSourceId);
      const newLocked = !(current && current.crop.lockedAspectRatio);
      try {
        const res = await fetch("/api/v1/sources/" + activeSourceId + "/effects/crop", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lockedAspectRatio: newLocked })
        });
        if (res.ok) {
          const updated = await res.json();
          currentEffects.set(activeSourceId, updated);
          updateCropDisplay();
        }
      } catch (err) {}
    }

    // Connect to SSE for real-time live/offline indicator and effects changes
    const sse = new EventSource("/api/v1/events");
    const indicator = document.getElementById("sse-indicator");

    sse.addEventListener("open", () => {
      indicator.style.color = "#22c55e";
      indicator.textContent = "● Live";
    });

    sse.addEventListener("source", (e) => {
      try {
        const data = JSON.parse(e.data);
        const badge = document.getElementById("status-" + data.id);
        if (badge) {
          badge.textContent = data.state.toUpperCase();
          badge.className = "status-badge " + (data.state === "live" ? "live" : "offline");
        }
      } catch (err) {}
    });

    sse.addEventListener("pipgm", (e) => {
      try {
        const data = JSON.parse(e.data);
        const p = data.pipeline;
        if (!p) return;
        const tile = document.getElementById("tile-" + p.id);
        const badge = document.getElementById("status-" + p.id);
        const meta = document.getElementById("pipgm-meta-" + p.id);
        const banner = document.getElementById("ftb-banner-" + p.id);
        const summary = document.getElementById("ftb-summary-" + p.id);
        if (tile) tile.className = "tile " + (p.fadeToBlack ? "tile-ftb" : "");
        if (badge) {
          badge.textContent = p.fadeToBlack ? "⬛ FTB" : p.state.toUpperCase();
          badge.className = "status-badge " + (p.fadeToBlack ? "ftb" : (p.state === "live" ? "live" : "offline"));
        }
        if (meta) {
          meta.textContent = (p.audioEnabled ? "🔊 ON" : "🔇 MUTED") + " • " + (p.orientation === "portrait" ? "9:16" : "16:9");
        }
        if (banner) {
          banner.style.display = p.fadeToBlack ? "flex" : "none";
        }
        if (summary && p.mobileAlert) {
          summary.textContent = p.mobileAlert.cuedSummary || "";
        }
      } catch (err) {}
    });

    sse.addEventListener("effects", (e) => {
      try {
        const payload = JSON.parse(e.data);
        currentEffects.set(payload.sourceId, payload.effects);
        if (activeSourceId === payload.sourceId) {
          updateCropDisplay();
        }
        const tileBadge = document.getElementById("crop-badge-" + payload.sourceId);
        if (tileBadge) {
          if (payload.effects.crop.enabled) {
            tileBadge.style.display = "inline-block";
            tileBadge.textContent = "CROP " + payload.effects.crop.aspectRatio;
          } else {
            tileBadge.style.display = "none";
          }
        }
      } catch (err) {}
    });

    sse.addEventListener("error", () => {
      indicator.style.color = "#ef4444";
      indicator.textContent = "○ Reconnecting";
    });
  </script>
</body>
</html>`;
}
