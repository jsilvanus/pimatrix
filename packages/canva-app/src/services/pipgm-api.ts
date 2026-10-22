import { BUILD_CONFIG, type NetworkProfile } from "../config";
import type {
  CreatePiPgmCanvaRequest,
  CreatePiPgmCanvaResponse,
  PiPgmCanvaControlRequest,
  PiPgmCanvaControlResponse,
  PiPgmPipelineSnapshot,
  ConnectionStatus
} from "../types";

const KEY_PROFILE = "pimatrix_canva_profile";
const KEY_LAN_URL = "pimatrix_canva_lan_url";
const KEY_WAN_URL = "pimatrix_canva_wan_url";
const KEY_SECRET_TOKEN = "pimatrix_canva_secret_token";

export interface ConnectionCheckResult {
  status: ConnectionStatus;
  profile: NetworkProfile;
  url: string;
  pipelines?: PiPgmPipelineSnapshot[];
  error?: string;
  alternativeProfile?: {
    profile: NetworkProfile;
    url: string;
    available: boolean;
  };
}

export class PiPgmApiService {
  private profile: NetworkProfile;
  private lanUrl: string;
  private wanUrl: string;
  private secretToken: string;
  private sse: EventSource | null = null;
  private eventListeners: Set<(pipelines: PiPgmPipelineSnapshot[]) => void> = new Set();

  constructor() {
    this.profile = this.loadProfile();
    this.lanUrl = this.loadLanUrl();
    this.wanUrl = this.loadWanUrl();
    this.secretToken = this.loadSecretToken();
  }

  private loadProfile(): NetworkProfile {
    try {
      const stored = localStorage.getItem(KEY_PROFILE);
      if (stored === "wan" || stored === "lan") return stored;
    } catch {}
    return BUILD_CONFIG.defaultProfile;
  }

  private loadLanUrl(): string {
    try {
      const stored = localStorage.getItem(KEY_LAN_URL);
      if (stored && stored.trim()) return stored.trim().replace(/\/+$/, "");
    } catch {}
    return BUILD_CONFIG.lanUrl;
  }

  private loadWanUrl(): string {
    try {
      const stored = localStorage.getItem(KEY_WAN_URL);
      if (stored && stored.trim()) return stored.trim().replace(/\/+$/, "");
    } catch {}
    return BUILD_CONFIG.wanUrl;
  }

  private loadSecretToken(): string {
    try {
      const stored = localStorage.getItem(KEY_SECRET_TOKEN);
      if (stored !== null) return stored.trim();
    } catch {}
    return BUILD_CONFIG.canvaSecretToken;
  }

  getProfile(): NetworkProfile {
    return this.profile;
  }

  setProfile(profile: NetworkProfile): void {
    this.profile = profile;
    try {
      localStorage.setItem(KEY_PROFILE, profile);
    } catch {}
    this.restartSse();
  }

  getLanUrl(): string {
    return this.lanUrl;
  }

  setLanUrl(url: string): void {
    const clean = url.trim().replace(/\/+$/, "");
    this.lanUrl = clean;
    try {
      localStorage.setItem(KEY_LAN_URL, clean);
    } catch {}
    if (this.profile === "lan") {
      this.restartSse();
    }
  }

  getWanUrl(): string {
    return this.wanUrl;
  }

  setWanUrl(url: string): void {
    const clean = url.trim().replace(/\/+$/, "");
    this.wanUrl = clean;
    try {
      localStorage.setItem(KEY_WAN_URL, clean);
    } catch {}
    if (this.profile === "wan") {
      this.restartSse();
    }
  }

  getSecretToken(): string {
    return this.secretToken;
  }

  setSecretToken(token: string): void {
    const clean = token.trim();
    this.secretToken = clean;
    try {
      localStorage.setItem(KEY_SECRET_TOKEN, clean);
    } catch {}
  }

  getActiveUrl(): string {
    if (this.profile === "wan" && this.wanUrl) {
      return this.wanUrl;
    }
    return this.lanUrl;
  }

  private getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extraHeaders
    };
    if (this.secretToken) {
      headers["Authorization"] = `Bearer ${this.secretToken}`;
      headers["X-Canva-Secret"] = this.secretToken;
    }
    return headers;
  }

  /**
   * Check connection to active profile, and check alternative profile if active fails.
   */
  async checkConnection(): Promise<ConnectionCheckResult> {
    const activeUrl = this.getActiveUrl();
    const headers = this.getHeaders();

    try {
      const res = await fetch(`${activeUrl}/api/v1/pipgm/pipelines?includeHidden=true`, {
        method: "GET",
        headers
      });

      if (res.ok) {
        const data = await res.json();
        const pipelines: PiPgmPipelineSnapshot[] = Array.isArray(data) ? data : data.pipelines || [];
        return {
          status: "connected",
          profile: this.profile,
          url: activeUrl,
          pipelines
        };
      }

      return {
        status: "error",
        profile: this.profile,
        url: activeUrl,
        error: `HTTP ${res.status}: ${res.statusText}`
      };
    } catch (activeErr) {
      // Primary profile failed. Check alternative profile if available.
      const altProfile: NetworkProfile = this.profile === "lan" ? "wan" : "lan";
      const altUrl = altProfile === "wan" ? this.wanUrl : this.lanUrl;

      let alternativeResult: { profile: NetworkProfile; url: string; available: boolean } | undefined;

      if (altUrl && altUrl !== activeUrl) {
        try {
          const altRes = await fetch(`${altUrl}/api/v1/pipgm/pipelines?includeHidden=true`, {
            method: "GET",
            headers
          });
          if (altRes.ok) {
            alternativeResult = { profile: altProfile, url: altUrl, available: true };
          }
        } catch {
          // Alt profile is also down
        }
      }

      return {
        status: "offline",
        profile: this.profile,
        url: activeUrl,
        error: activeErr instanceof Error ? activeErr.message : String(activeErr),
        alternativeProfile: alternativeResult
      };
    }
  }

  /**
   * Get all PiPGM pipelines.
   */
  async getPipelines(): Promise<PiPgmPipelineSnapshot[]> {
    const activeUrl = this.getActiveUrl();
    const res = await fetch(`${activeUrl}/api/v1/pipgm/pipelines?includeHidden=true`, {
      method: "GET",
      headers: this.getHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch pipelines: HTTP ${res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data.pipelines || [];
  }

  /**
   * Push Canva Design to PiPGM Store or Program pipeline (Endpoint A).
   */
  async pushDesign(request: CreatePiPgmCanvaRequest): Promise<CreatePiPgmCanvaResponse> {
    const activeUrl = this.getActiveUrl();
    const res = await fetch(`${activeUrl}/api/v1/pipgm/canva/push`, {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(request)
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson.error?.message) {
          errorMsg = errorJson.error.message;
        }
      } catch {}
      throw new Error(`Push failed: ${errorMsg}`);
    }

    return await res.json();
  }

  /**
   * Control active Canva presentation (Endpoint B).
   */
  async controlPresentation(request: PiPgmCanvaControlRequest): Promise<PiPgmCanvaControlResponse> {
    const activeUrl = this.getActiveUrl();
    const res = await fetch(`${activeUrl}/api/v1/pipgm/canva/control`, {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(request)
    });

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        if (errorJson.error?.message) {
          errorMsg = errorJson.error.message;
        }
      } catch {}
      throw new Error(`Control failed: ${errorMsg}`);
    }

    return await res.json();
  }

  /**
   * Subscribe to real-time events via Server-Sent Events (SSE).
   */
  subscribeEvents(listener: (pipelines: PiPgmPipelineSnapshot[]) => void): () => void {
    this.eventListeners.add(listener);
    if (!this.sse) {
      this.startSse();
    }
    return () => {
      this.eventListeners.delete(listener);
      if (this.eventListeners.size === 0) {
        this.stopSse();
      }
    };
  }

  private startSse(): void {
    if (typeof EventSource === "undefined") return;
    try {
      const activeUrl = this.getActiveUrl();
      this.sse = new EventSource(`${activeUrl}/api/v1/events`);
      this.sse.addEventListener("pipgm", (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data);
          const pipelines: PiPgmPipelineSnapshot[] = Array.isArray(parsed)
            ? parsed
            : parsed.pipeline
            ? [parsed.pipeline]
            : parsed.pipelines || [];

          if (pipelines.length > 0) {
            for (const listener of this.eventListeners) {
              listener(pipelines);
            }
          }
        } catch (err) {
          console.warn("Failed to parse SSE pipgm event:", err);
        }
      });
      this.sse.onerror = () => {
        // SSE reconnects automatically
      };
    } catch (err) {
      console.warn("Could not initiate SSE connection:", err);
    }
  }

  private stopSse(): void {
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
  }

  private restartSse(): void {
    this.stopSse();
    if (this.eventListeners.size > 0) {
      this.startSse();
    }
  }
}

export const pipgmApi = new PiPgmApiService();
