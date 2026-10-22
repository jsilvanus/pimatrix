export type NetworkProfile = "lan" | "wan";

export interface AppBuildConfig {
  pluginName: string;
  orgName: string;
  lanUrl: string;
  wanUrl: string;
  canvaSecretToken: string;
  defaultProfile: NetworkProfile;
}

// Safely access environment variables across Vite browser bundling and Node.js testing
const env: Record<string, string | undefined> =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : typeof process !== "undefined" && process.env
    ? process.env
    : {};

/**
 * Build-time configuration injected via Vite env variables:
 * - VITE_PLUGIN_NAME (default: "PiMatrix Canva App")
 * - VITE_ORG_NAME (default: "Riihimäen Keskuskirkko")
 * - VITE_LAN_URL (default: "http://127.0.0.1:3000")
 * - VITE_WAN_URL (default: "")
 * - VITE_CANVA_SECRET_TOKEN (default: "")
 * - VITE_DEFAULT_PROFILE (default: "lan")
 */
export const BUILD_CONFIG: AppBuildConfig = {
  pluginName: env.VITE_PLUGIN_NAME?.trim() || "PiMatrix Canva App",
  orgName: env.VITE_ORG_NAME?.trim() || "Riihimäen Keskuskirkko",
  lanUrl: env.VITE_LAN_URL?.trim() || "http://127.0.0.1:3000",
  wanUrl: env.VITE_WAN_URL?.trim() || "",
  canvaSecretToken: env.VITE_CANVA_SECRET_TOKEN?.trim() || "",
  defaultProfile: (env.VITE_DEFAULT_PROFILE?.trim() === "wan" ? "wan" : "lan") as NetworkProfile
};
