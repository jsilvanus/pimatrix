import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";

/** A concrete H.264 encoder ffmpeg is started with. */
export type Encoder = "libx264" | "h264_v4l2m2m";

/**
 * What the configuration asks for. `auto` tries the hardware encoder (Pi 4 V4L2 M2M) and
 * falls back to libx264 (CPU); the two names force that encoder first.
 */
export type EncoderSetting = "auto" | Encoder;

export const HARDWARE_ENCODER: Encoder = "h264_v4l2m2m";

export function isEncoderSetting(value: string): value is EncoderSetting {
  return value === "auto" || value === "libx264" || value === "h264_v4l2m2m";
}

export interface EncoderPolicyOptions {
  /** Retry with libx264 when the hardware encoder fails to start. Default true (PIMATRIX_ENCODER_FALLBACK=off turns it off). */
  fallback?: boolean;
  /** Default process.platform. Anything but "linux" has no V4L2 M2M encoder. */
  platform?: NodeJS.Platform;
  /** One-time check that the hardware encoder can work here. Tests replace it. */
  probe?: () => Promise<boolean>;
  /** ffmpeg used by the default probe. */
  ffmpeg?: string;
  logger?: { warn(obj: object, msg: string): void } | undefined;
}

/** Cheap one-time probe: ffmpeg lists h264_v4l2m2m and a /dev/video* node exists. Never throws. */
export async function probeHardwareEncoder(ffmpeg = "ffmpeg"): Promise<boolean> {
  try {
    const nodes = await readdir("/dev");
    if (!nodes.some((name) => /^video\d+$/.test(name))) return false;
    const listing = await new Promise<string>((resolve, reject) => {
      execFile(ffmpeg, ["-hide_banner", "-encoders"], { timeout: 5000, maxBuffer: 1 << 20 }, (error, stdout) =>
        error ? reject(error) : resolve(stdout)
      );
    });
    return /\bh264_v4l2m2m\b/.test(listing);
  } catch {
    return false;
  }
}

/**
 * The one place that decides which encoder a publisher or capture starts with.
 * Shared by the composite/key publisher, the effects layer and the Hama capture, so a
 * hardware failure seen by one is remembered by all for the life of the process.
 */
export class EncoderPolicy {
  private readonly fallbackEnabled: boolean;
  private readonly platform: NodeJS.Platform;
  private readonly probeFn: () => Promise<boolean>;
  private readonly logger: EncoderPolicyOptions["logger"];
  private probed: Promise<boolean> | null = null;
  private hardwareFailed = false;
  private warned = false;

  constructor(options: EncoderPolicyOptions = {}) {
    this.fallbackEnabled = options.fallback ?? true;
    this.platform = options.platform ?? process.platform;
    this.probeFn = options.probe ?? (() => probeHardwareEncoder(options.ffmpeg));
    this.logger = options.logger;
  }

  get fallback(): boolean {
    return this.fallbackEnabled;
  }

  /** True once the hardware encoder has failed and libx264 is used instead. */
  get usingFallback(): boolean {
    return this.hardwareFailed;
  }

  private hardwarePossible(): Promise<boolean> {
    if (this.platform !== "linux") return Promise.resolve(false);
    this.probed ??= this.probeFn().catch(() => false);
    return this.probed;
  }

  /** The encoder to start with now. Explicit libx264 is never touched. */
  async pick(setting: EncoderSetting): Promise<Encoder> {
    if (setting === "libx264" || this.hardwareFailed) return "libx264";
    // An explicit hardware encoder with the fallback off is used as asked, probe or not.
    if (setting === HARDWARE_ENCODER && !this.fallbackEnabled) return HARDWARE_ENCODER;
    return (await this.hardwarePossible()) ? HARDWARE_ENCODER : "libx264";
  }

  /**
   * Report that a process using `encoder` died in its start window. Returns true when the
   * caller should start again (now libx264 is picked); the fallback is remembered and logged once.
   */
  noteFailure(encoder: Encoder, reason: string): boolean {
    if (encoder !== HARDWARE_ENCODER || !this.fallbackEnabled) return false;
    this.hardwareFailed = true;
    if (!this.warned) {
      this.warned = true;
      this.logger?.warn({ reason }, "h264_v4l2m2m failed to start; using libx264 (CPU) from now on");
    }
    return true;
  }

  /**
   * The libx264 retry failed in its start window too, so the encoder was not the problem
   * (for example the source was down): forget the fallback and let the hardware be tried again.
   */
  revertFallback(): void {
    this.hardwareFailed = false;
    this.warned = false;
  }
}
