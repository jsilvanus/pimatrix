import type { MultiviewSnapshot } from "./model.js";

export function renderMultiviewHtml(
  multiview: MultiviewSnapshot,
  previewBaseUrl?: string
): string {
  const tilesHtml = multiview.tiles
    .map((tile) => {
      const isLive = tile.state === "live";
      const statusClass = isLive ? "live" : "offline";
      const previewUrl = tile.preview.url ?? (previewBaseUrl ? `${previewBaseUrl}/${encodeURIComponent(tile.sourceId)}` : null);

      return `
    <div class="tile" id="tile-${tile.sourceId}">
      <div class="tile-header">
        <span class="tile-label">${tile.label} <small>(${tile.sourceId})</small></span>
        <span class="status-badge ${statusClass}" id="status-${tile.sourceId}">${tile.state.toUpperCase()}</span>
      </div>
      <div class="tile-content">
        ${
          previewUrl && isLive
            ? `<iframe src="${previewUrl}" allow="autoplay; fullscreen" loading="lazy"></iframe>`
            : `<div class="placeholder">
                <div class="icon">📹</div>
                <div class="name">${tile.label}</div>
                <div class="kind">${tile.kind}</div>
              </div>`
        }
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
    .tile-header {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 3px 6px;
      background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 2;
      pointer-events: none;
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

    sse.addEventListener("error", () => {
      indicator.style.color = "#ef4444";
      indicator.textContent = "○ Reconnecting";
    });
  </script>
</body>
</html>`;
}
