import dgram from "node:dgram";
import type { FastifyBaseLogger } from "fastify";
import {
  buildPanTiltDrive,
  buildPanTiltInquiry,
  buildPowerInquiry,
  buildPresetRecall,
  buildPresetReset,
  buildPresetSave,
  buildSmartFrame,
  buildZoom,
  buildZoomInquiry,
  createViscaPacket,
  parseViscaResponse,
  type PanTiltDirection,
  type SmartFrameMode,
  type ZoomAction
} from "./visca-protocol.js";

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

export type CameraConnectionState = "connected" | "disconnected" | "simulated";
export type SmartFrameState = "enabled" | "disabled" | "triggered" | "unsupported";

export interface CameraSnapshot {
  id: string;
  label: string;
  model: string;
  connection: CameraConnectionState;
  streaming: boolean;
  streamUrl: string | null;
  smartFrame: SmartFrameState;
  position: CameraPosition;
  presets: CameraPreset[];
}

export interface CameraAdapter {
  readonly id: string;
  readonly label: string;
  getSnapshot(): CameraSnapshot;
  move(direction: PanTiltDirection, panSpeed?: number, tiltSpeed?: number): Promise<void>;
  zoom(action: ZoomAction, speed?: number): Promise<void>;
  recallPreset(presetId: number): Promise<void>;
  savePreset(presetId: number, name?: string): Promise<void>;
  savePresetThumbnail(presetId: number, thumbnail: string): Promise<void>;
  resetPreset(presetId: number): Promise<void>;
  setSmartFrame(mode: SmartFrameMode): Promise<void>;
  startStream(): Promise<string | null>;
  stopStream(): Promise<void>;
  close(): Promise<void>;
}

export class SimulatedCameraAdapter implements CameraAdapter {
  readonly id: string;
  readonly label: string;
  readonly model = "AVer PTZ330 (Simulated)";
  private streaming = false;
  private smartFrame: SmartFrameState = "disabled";
  private position: CameraPosition = { pan: 0, tilt: 0, zoom: 0 };
  private readonly presets = new Map<number, { position: CameraPosition; name?: string; thumbnail?: string }>([
    [1, { position: { pan: 100, tilt: 50, zoom: 10 }, name: "Pulpit" }],
    [2, { position: { pan: -200, tilt: 30, zoom: 15 }, name: "Altar" }],
    [3, { position: { pan: 0, tilt: 10, zoom: 5 }, name: "Organ" }],
    [4, { position: { pan: 300, tilt: -10, zoom: 20 }, name: "Choir" }],
    [5, { position: { pan: -150, tilt: 0, zoom: 8 }, name: "Lectern" }],
    [6, { position: { pan: 0, tilt: 0, zoom: 0 }, name: "Wide Hall" }]
  ]);

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }

  getSnapshot(): CameraSnapshot {
    return {
      id: this.id,
      label: this.label,
      model: this.model,
      connection: "simulated",
      streaming: this.streaming,
      streamUrl: this.streaming ? `rtsp://127.0.0.1:8554/${this.id}` : null,
      smartFrame: this.smartFrame,
      position: { ...this.position },
      presets: [...this.presets.entries()]
        .map(([id, p]) => ({
          id,
          ...(p.name ? { name: p.name } : {}),
          ...(p.thumbnail ? { thumbnail: p.thumbnail } : {})
        }))
        .sort((a, b) => a.id - b.id)
    };
  }

  async move(direction: PanTiltDirection, panSpeed = 10, tiltSpeed = 10): Promise<void> {
    switch (direction) {
      case "up":
        this.position.tilt = Math.min(this.position.tilt + tiltSpeed * 5, 900);
        break;
      case "down":
        this.position.tilt = Math.max(this.position.tilt - tiltSpeed * 5, -300);
        break;
      case "left":
        this.position.pan = Math.max(this.position.pan - panSpeed * 5, -1700);
        break;
      case "right":
        this.position.pan = Math.min(this.position.pan + panSpeed * 5, 1700);
        break;
      case "upleft":
        this.position.tilt = Math.min(this.position.tilt + tiltSpeed * 5, 900);
        this.position.pan = Math.max(this.position.pan - panSpeed * 5, -1700);
        break;
      case "upright":
        this.position.tilt = Math.min(this.position.tilt + tiltSpeed * 5, 900);
        this.position.pan = Math.min(this.position.pan + panSpeed * 5, 1700);
        break;
      case "downleft":
        this.position.tilt = Math.max(this.position.tilt - tiltSpeed * 5, -300);
        this.position.pan = Math.max(this.position.pan - panSpeed * 5, -1700);
        break;
      case "downright":
        this.position.tilt = Math.max(this.position.tilt - tiltSpeed * 5, -300);
        this.position.pan = Math.min(this.position.pan + panSpeed * 5, 1700);
        break;
      case "home":
      case "reset":
        this.position.pan = 0;
        this.position.tilt = 0;
        break;
      case "stop":
        break;
    }
  }

  async zoom(action: ZoomAction, speed = 4): Promise<void> {
    if (action === "in") {
      this.position.zoom = Math.min(this.position.zoom + (speed + 1) * 10, 16384);
    } else if (action === "out") {
      this.position.zoom = Math.max(this.position.zoom - (speed + 1) * 10, 0);
    }
  }

  async recallPreset(presetId: number): Promise<void> {
    const preset = this.presets.get(presetId);
    if (preset) {
      this.position = { ...preset.position };
    }
  }

  async savePreset(presetId: number, name?: string): Promise<void> {
    const existing = this.presets.get(presetId);
    const resolvedName = name ?? existing?.name;
    this.presets.set(presetId, {
      position: { ...this.position },
      ...(resolvedName ? { name: resolvedName } : {}),
      ...(existing?.thumbnail ? { thumbnail: existing.thumbnail } : {})
    });
  }

  async savePresetThumbnail(presetId: number, thumbnail: string): Promise<void> {
    const existing = this.presets.get(presetId);
    this.presets.set(presetId, {
      position: existing ? { ...existing.position } : { ...this.position },
      ...(existing?.name ? { name: existing.name } : {}),
      thumbnail
    });
  }

  async resetPreset(presetId: number): Promise<void> {
    this.presets.delete(presetId);
  }

  async setSmartFrame(mode: SmartFrameMode): Promise<void> {
    if (mode === "enable") {
      this.smartFrame = "enabled";
    } else if (mode === "disable") {
      this.smartFrame = "disabled";
    } else if (mode === "trigger") {
      this.smartFrame = "triggered";
    }
  }

  async startStream(): Promise<string | null> {
    this.streaming = true;
    return `rtsp://127.0.0.1:8554/${this.id}`;
  }

  async stopStream(): Promise<void> {
    this.streaming = false;
  }

  async close(): Promise<void> {
    this.streaming = false;
  }
}

/**
 * A camera CGI call failed. `reason` says why, so the API can answer clearly:
 * "auth" (401/403: wrong or missing login), "rejected" (other HTTP error) or
 * "unreachable" (no answer in time). The message never carries the login.
 */
export class CameraCgiError extends Error {
  constructor(
    message: string,
    readonly reason: "auth" | "rejected" | "unreachable",
    readonly status: number | null = null
  ) {
    super(message);
    this.name = "CameraCgiError";
  }
}

export interface CameraLogin {
  user: string;
  password: string;
}

export interface UdpViscaCameraConfig {
  id: string;
  label: string;
  host: string;
  viscaPort?: number | undefined;
  cgiPort?: number | undefined;
  /** HTTP Basic login for the camera CGI. Sent only as an Authorization header. */
  auth?: CameraLogin | undefined;
  rtspUrl?: string | undefined;
  rtmpTargetUrl?: string | undefined;
  logger?: FastifyBaseLogger | undefined;
}

export class UdpViscaCameraAdapter implements CameraAdapter {
  readonly id: string;
  readonly label: string;
  readonly model = "AVer PTZ330";
  private readonly host: string;
  private readonly viscaPort: number;
  private readonly cgiPort: number;
  private readonly authHeader: string | null;
  private readonly rtspUrl: string | null;
  private readonly rtmpTargetUrl: string | null;
  private readonly logger?: FastifyBaseLogger | undefined;

  private socket: dgram.Socket | null = null;
  private sequenceNumber = 1;
  private connected = false;
  private streaming = false;
  private smartFrame: SmartFrameState = "disabled";
  private position: CameraPosition = { pan: 0, tilt: 0, zoom: 0 };
  private readonly presets = new Map<number, { position: CameraPosition; name?: string; thumbnail?: string }>();

  constructor(config: UdpViscaCameraConfig) {
    this.id = config.id;
    this.label = config.label;
    this.host = config.host;
    this.viscaPort = config.viscaPort ?? 52381;
    this.cgiPort = config.cgiPort ?? 80;
    this.authHeader = config.auth
      ? `Basic ${Buffer.from(`${config.auth.user}:${config.auth.password}`).toString("base64")}`
      : null;
    this.rtspUrl = config.rtspUrl ?? `rtsp://${config.host}:554/live_st1`;
    this.rtmpTargetUrl = config.rtmpTargetUrl ?? null;
    this.logger = config.logger;
  }

  getSnapshot(): CameraSnapshot {
    return {
      id: this.id,
      label: this.label,
      model: this.model,
      connection: this.connected ? "connected" : "disconnected",
      streaming: this.streaming,
      streamUrl: this.streaming ? this.rtspUrl : null,
      smartFrame: this.smartFrame,
      position: { ...this.position },
      presets: [...this.presets.entries()]
        .map(([id, p]) => ({
          id,
          ...(p.name ? { name: p.name } : {}),
          ...(p.thumbnail ? { thumbnail: p.thumbnail } : {})
        }))
        .sort((a, b) => a.id - b.id)
    };
  }

  private async ensureSocket(): Promise<dgram.Socket> {
    if (!this.socket) {
      this.socket = dgram.createSocket("udp4");
      this.socket.on("error", (err) => {
        this.logger?.warn({ err, camera: this.id }, "Camera UDP socket error");
      });
    }
    return this.socket;
  }

  private async sendCommand(payload: number[]): Promise<void> {
    const socket = await this.ensureSocket();
    const seq = this.sequenceNumber++;
    const packet = createViscaPacket(payload, seq);

    return new Promise((resolve, reject) => {
      socket.send(packet, this.viscaPort, this.host, (err) => {
        if (err) {
          this.connected = false;
          this.logger?.warn({ err, camera: this.id }, "Failed to send VISCA UDP packet");
          reject(err);
        } else {
          this.connected = true;
          resolve();
        }
      });
    });
  }

  async move(direction: PanTiltDirection, panSpeed = 10, tiltSpeed = 10): Promise<void> {
    const payload = buildPanTiltDrive(direction, panSpeed, tiltSpeed);
    await this.sendCommand(payload);
  }

  async zoom(action: ZoomAction, speed = 4): Promise<void> {
    const payload = buildZoom(action, speed);
    await this.sendCommand(payload);
  }

  async recallPreset(presetId: number): Promise<void> {
    const payload = buildPresetRecall(presetId);
    await this.sendCommand(payload);
  }

  async savePreset(presetId: number, name?: string): Promise<void> {
    const payload = buildPresetSave(presetId);
    await this.sendCommand(payload);
    const existing = this.presets.get(presetId);
    const resolvedName = name ?? existing?.name;
    this.presets.set(presetId, {
      position: { ...this.position },
      ...(resolvedName ? { name: resolvedName } : {}),
      ...(existing?.thumbnail ? { thumbnail: existing.thumbnail } : {})
    });
  }

  async savePresetThumbnail(presetId: number, thumbnail: string): Promise<void> {
    const existing = this.presets.get(presetId);
    this.presets.set(presetId, {
      position: existing ? { ...existing.position } : { ...this.position },
      ...(existing?.name ? { name: existing.name } : {}),
      thumbnail
    });
  }

  async resetPreset(presetId: number): Promise<void> {
    const payload = buildPresetReset(presetId);
    await this.sendCommand(payload);
    this.presets.delete(presetId);
  }

  async setSmartFrame(mode: SmartFrameMode): Promise<void> {
    const payload = buildSmartFrame(mode);
    await this.sendCommand(payload);
    this.smartFrame = mode === "enable" ? "enabled" : mode === "disable" ? "disabled" : "triggered";
  }

  async startStream(): Promise<string | null> {
    // Point the camera's RTMP push at MediaMTX, then switch it on. Failures are
    // not hidden: a rejected login or an unreachable camera throws CameraCgiError.
    if (this.rtmpTargetUrl) {
      await this.cgiSet(`vdo_rtmp_url,3,${encodeURIComponent(this.rtmpTargetUrl)}`);
      await this.cgiSet("vdo_rtmp_enable,3,1");
    }
    this.streaming = true;
    return this.rtspUrl;
  }

  async stopStream(): Promise<void> {
    try {
      await this.cgiSet("vdo_rtmp_enable,3,0");
    } finally {
      this.streaming = false;
    }
  }

  /** One CGI "Set" call. The login goes only in the Authorization header. */
  private async cgiSet(value: string): Promise<void> {
    const url = `http://${this.host}:${this.cgiPort}/cgi-bin?Set=${value}`;
    const headers: Record<string, string> = this.authHeader ? { Authorization: this.authHeader } : {};
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    } catch {
      this.logger?.warn({ camera: this.id }, "Camera CGI unreachable");
      throw new CameraCgiError(`Camera ${this.id} did not answer the CGI request`, "unreachable");
    }
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) {
      this.logger?.warn({ camera: this.id, status: res.status }, "Camera CGI rejected the login");
      throw new CameraCgiError(
        `Camera ${this.id} rejected the login (HTTP ${res.status}); check PIMATRIX_${this.id.toUpperCase()}_USER and _PASSWORD`,
        "auth",
        res.status
      );
    }
    if (!res.ok) {
      throw new CameraCgiError(`Camera ${this.id} answered HTTP ${res.status} to the CGI request`, "rejected", res.status);
    }
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.streaming = false;
    this.connected = false;
  }
}
