import type { MultiviewSnapshot } from "./model.js";

export function renderMultiviewHtml(
  multiview: MultiviewSnapshot,
  previewBaseUrl?: string
): string {
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

      return `
    <div class="tile ${isFtb ? "tile-ftb" : ""}" id="tile-${tile.sourceId}">
      <div class="tile-header">
        <span class="tile-label">${tile.label} <small>(${tile.sourceId})</small>${replacedNote}</span>
        <div class="tile-badges">
          ${pipgmBadges}
          <span class="status-badge ${statusClass}" id="status-${tile.sourceId}">${statusText}</span>
        </div>
      </div>
      <div class="tile-content">
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>PiMatrix Multiview (8-Way)</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #151c2e;
      --border: #232d45;
      --text: #e2e8f0;
      --live: #22c55e;
      --offline: #ef4444;
      --warning: #f59e0b;
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
      /* Landscape default: 4 columns x 2 rows */
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(2, 1fr);
    }

    /* Automatic Phone / Portrait Orientation: 2 columns x 4 rows */
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
      z-index: 2;
      pointer-events: none;
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
    }
    .tile-label small { opacity: 0.75; font-size: 9px; }
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
  </style>
</head>
<body>
  <header>
    <div class="brand">Pi<span>Matrix</span> Multiview</div>
    <div class="meta">
      <span class="mode-pill" id="grid-mode">Auto (4x2 / 2x4)</span>
      <span id="sse-indicator" style="color: #64748b;">● Connected</span>
    </div>
  </header>
  <main class="grid">
    ${tilesHtml}
  </main>

  <script>
    // Live update orientation label
    function updateLayoutIndicator() {
      const isPortrait = window.matchMedia("(orientation: portrait), (max-aspect-ratio: 1/1)").matches;
      document.getElementById("grid-mode").textContent = isPortrait ? "Vertical 2x4" : "Landscape 4x2";
    }
    window.addEventListener("resize", updateLayoutIndicator);
    window.addEventListener("orientationchange", updateLayoutIndicator);
    updateLayoutIndicator();

    // Connect to SSE for real-time live/offline indicator changes
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

    sse.addEventListener("error", () => {
      indicator.style.color = "#ef4444";
      indicator.textContent = "○ Reconnecting";
    });
  </script>
</body>
</html>`;
}
