import type { CanvaDesignInfo } from "../types";

/**
 * Helper to decode JWT payload without external libraries.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Canva SDK abstraction service.
 * Supports active Canva Apps SDK in Canva iframe, with safe fallback for dev/testing.
 */
export class CanvaSdkService {
  private cachedInfo: CanvaDesignInfo | null = null;

  /**
   * Determine whether the app is executing inside a Canva editor iframe.
   */
  isInsideCanva(): boolean {
    try {
      return window.self !== window.top && typeof window.parent?.postMessage === "function";
    } catch {
      return false;
    }
  }

  /**
   * Retrieve active design metadata from Canva SDK or fallback mock.
   */
  async getActiveDesign(): Promise<CanvaDesignInfo> {
    if (this.cachedInfo && !this.cachedInfo.isSimulated) {
      return this.cachedInfo;
    }

    try {
      // Dynamic import to avoid SSR or environment issues if Canva SDK fails to load
      const designModule = await import("@canva/design");

      let designId = "DAF_CHURCH_2026";
      let title = "Sunday Worship Presentation";
      let pageCount = 3;
      let defaultWidth = 1920;
      let defaultHeight = 1080;

      // 1. Try to get design metadata
      if (typeof designModule.getDesignMetadata === "function") {
        try {
          const meta = await designModule.getDesignMetadata();
          if (meta.title) title = meta.title;
          if (meta.pageMetadata && Array.isArray(meta.pageMetadata)) {
            pageCount = meta.pageMetadata.length || 1;
          }
          if (meta.defaultPageDimensions) {
            defaultWidth = meta.defaultPageDimensions.width;
            defaultHeight = meta.defaultPageDimensions.height;
          }
        } catch (metaErr) {
          console.warn("Canva SDK getDesignMetadata failed, using defaults:", metaErr);
        }
      }

      // 2. Try to get design token for authentic designId
      if (typeof designModule.getDesignToken === "function") {
        try {
          const tokenRes = await designModule.getDesignToken();
          if (tokenRes && tokenRes.token) {
            const payload = decodeJwtPayload(tokenRes.token);
            if (payload && typeof payload.designId === "string") {
              designId = payload.designId;
            } else if (payload && typeof payload.sub === "string") {
              designId = payload.sub;
            }
          }
        } catch (tokErr) {
          console.warn("Canva SDK getDesignToken failed, using fallback designId:", tokErr);
        }
      }

      const embedUrl = `https://www.canva.com/design/${encodeURIComponent(designId)}/view?embed`;
      const viewUrl = `https://www.canva.com/design/${encodeURIComponent(designId)}/view`;

      this.cachedInfo = {
        designId,
        title,
        pageCount,
        embedUrl,
        viewUrl,
        defaultWidth,
        defaultHeight,
        isSimulated: !this.isInsideCanva()
      };

      return this.cachedInfo;
    } catch (err) {
      console.warn("Canva Apps SDK not detected in environment; loading simulation mode:", err);
      const fallback: CanvaDesignInfo = {
        designId: "DAF_KESKUSKIRKKO_LIVE",
        title: "Riihimäen Keskuskirkko Jumalanpalvelus",
        pageCount: 5,
        embedUrl: "https://www.canva.com/design/DAF_KESKUSKIRKKO_LIVE/view?embed",
        viewUrl: "https://www.canva.com/design/DAF_KESKUSKIRKKO_LIVE/view",
        defaultWidth: 1920,
        defaultHeight: 1080,
        isSimulated: true
      };
      this.cachedInfo = fallback;
      return fallback;
    }
  }

  /**
   * Trigger Canva's native export dialog using requestExport.
   */
  async exportDesignLocally(format: "png" | "mp4" = "png"): Promise<string[] | null> {
    try {
      const designModule = await import("@canva/design");
      if (typeof designModule.requestExport === "function") {
        const fileType = format === "mp4" ? "video" : "png";
        const response = await designModule.requestExport({
          acceptedFileTypes: [fileType]
        });

        // Parse export URLs if available
        if (response && Array.isArray((response as unknown as { exportUrls?: string[] }).exportUrls)) {
          return (response as unknown as { exportUrls: string[] }).exportUrls;
        }
        if (response && Array.isArray((response as unknown as { urls?: string[] }).urls)) {
          return (response as unknown as { urls: string[] }).urls;
        }
        return [];
      }
    } catch (err) {
      console.error("Local Canva export error or user cancelled:", err);
    }
    return null;
  }

  /**
   * Relay control commands via window.parent or window.opener postMessage.
   * Useful when embedded inside PiPGM stage viewer or presentation view.
   */
  relayPostMessage(message: {
    action: string;
    pageNumber?: number;
    stepIndex?: number;
    fadeToBlack?: boolean;
    audioEnabled?: boolean;
    mode?: "embed" | "exported_mp4" | "exported_slides";
  }): void {
    const payload = {
      type: "canva:control",
      ...message
    };

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
      if (window.opener) {
        window.opener.postMessage(payload, "*");
      }
    } catch (err) {
      console.warn("postMessage relay failed:", err);
    }
  }
}

export const canvaSdk = new CanvaSdkService();
