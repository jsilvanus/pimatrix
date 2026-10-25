/**
 * ATEM switcher adapter, built on the `atem-connection` library (the same
 * library and call names lcyt-bridge's AtemPool uses: connect, disconnect,
 * changeProgramInput, changePreviewInput, cut, and the 'connected',
 * 'disconnected', 'stateChanged', 'error' events, with state read from
 * `atem.state.video.mixEffects[me]`).
 *
 * Without a host the adapter is a no-op stub: it never opens a socket and
 * reports connected=false. Hardware behaviour is not verified in this repo.
 */

import { Atem } from "atem-connection";

export const DEFAULT_ATEM_PORT = 9990;

export interface AtemTransitionState {
  inTransition: boolean;
  remainingFrames: number;
}

export interface AtemAdapterState {
  connected: boolean;
  programInput: number | null;
  previewInput: number | null;
  transition: AtemTransitionState;
}

export type AtemStateListener = (state: AtemAdapterState) => void;

/** The subset of the atem-connection client this adapter uses (injectable for tests). */
export interface AtemClient {
  connect(address: string, port?: number): Promise<void>;
  disconnect(): Promise<void>;
  changeProgramInput(input: number, me?: number): Promise<void>;
  changePreviewInput(input: number, me?: number): Promise<void>;
  cut(me?: number): Promise<void>;
  readonly state: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface AtemAdapterOptions {
  /** 0-based M/E index the adapter switches (0 = M/E 1). */
  meIndex?: number;
  /** Creates the library client; tests pass a fake so no socket is opened. */
  createClient?: () => AtemClient;
}

const IDLE_TRANSITION: AtemTransitionState = { inTransition: false, remainingFrames: 0 };

function assertInput(input: number, name: string): void {
  if (!Number.isInteger(input) || input < 1) {
    throw new RangeError(`${name} must be a positive integer input number`);
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class AtemAdapter {
  private readonly meIndex: number;
  private readonly createClient: () => AtemClient;
  private client: AtemClient | null = null;
  private connected = false;
  private listeners = new Set<AtemStateListener>();

  constructor(options: AtemAdapterOptions = {}) {
    this.meIndex = options.meIndex ?? 0;
    this.createClient = options.createClient ?? (() => new Atem() as unknown as AtemClient);
  }

  /**
   * Connect to an ATEM. A missing or empty host keeps the adapter a stub
   * (nothing is opened, connected stays false).
   */
  async connect(host?: string, port: number = DEFAULT_ATEM_PORT): Promise<void> {
    const target = host?.trim();
    if (!target) return;
    if (this.client) await this.disconnect();

    const client = this.createClient();
    this.client = client;
    client.on("connected", () => {
      if (this.client !== client) return;
      this.connected = true;
      this.emit();
    });
    client.on("disconnected", () => {
      if (this.client !== client) return;
      this.connected = false;
      this.emit();
    });
    client.on("stateChanged", () => {
      if (this.client === client && this.connected) this.emit();
    });
    // Listening keeps an 'error' event from becoming an unhandled crash.
    client.on("error", () => undefined);

    await client.connect(target, port);
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    const wasConnected = this.connected;
    this.connected = false;
    if (client) {
      try {
        await client.disconnect();
      } catch {
        /* already gone */
      }
    }
    if (wasConnected) this.emit();
  }

  getState(): AtemAdapterState {
    if (!this.client || !this.connected) {
      return { connected: false, programInput: null, previewInput: null, transition: { ...IDLE_TRANSITION } };
    }
    const me = readMixEffect(this.client.state, this.meIndex);
    return {
      connected: true,
      programInput: me?.programInput ?? null,
      previewInput: me?.previewInput ?? null,
      transition: me?.transition ?? { ...IDLE_TRANSITION },
    };
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  onStateChange(listener: AtemStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setProgram(input: number): Promise<void> {
    assertInput(input, "input");
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.changeProgramInput(input, this.meIndex);
  }

  async setPreview(input: number): Promise<void> {
    assertInput(input, "input");
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.changePreviewInput(input, this.meIndex);
  }

  async cut(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.cut(this.meIndex);
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error("ATEM is not connected");
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

interface MixEffectReading {
  programInput: number | null;
  previewInput: number | null;
  transition: AtemTransitionState;
}

/** Reads one M/E row from the library's state object without trusting its shape. */
function readMixEffect(state: unknown, meIndex: number): MixEffectReading | null {
  const video = (state as { video?: { mixEffects?: unknown } } | undefined)?.video;
  const mixEffects = video?.mixEffects;
  if (!Array.isArray(mixEffects)) return null;
  const me = mixEffects[meIndex] as
    | { programInput?: unknown; previewInput?: unknown; transitionPosition?: { inTransition?: unknown; remainingFrames?: unknown } }
    | undefined;
  if (!me) return null;
  const position = me.transitionPosition;
  return {
    programInput: readNumber(me.programInput),
    previewInput: readNumber(me.previewInput),
    transition: {
      inTransition: position?.inTransition === true,
      remainingFrames: readNumber(position?.remainingFrames) ?? 0,
    },
  };
}
