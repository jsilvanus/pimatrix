/**
 * Quick options: named snapshots of the Outputs state (what each HDMI output shows,
 * the per-source effects and the HDMI key composite's slide source), saved on the
 * backend so they survive a restart. Like camera presets, but for outputs.
 *
 * A snapshot never holds ATEM or camera state: applying one must not touch either.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CropSettings, RotationDegrees } from "../effects/effects-model.js";
import type { CompositeId } from "../composite/composite-model.js";
import { LIVE_SOURCE_IDS, PIPROGRAM_PIPELINE_IDS, type LiveSourceId, type PiprogramPipelineId } from "../composite/composite-model.js";
import { sourceDefinitions } from "../model.js";

export const MAX_QUICK_OPTION_NAME = 40;
export const MAX_QUICK_OPTIONS = 50;
export const MAX_QUICK_OPTION_NUMBER = 99;
/** Outputs a snapshot routes. The multiview output has no route of its own. */
export const SNAPSHOT_OUTPUT_IDS = ["hdmi0", "hdmi1"] as const;
export type SnapshotOutputId = (typeof SNAPSHOT_OUTPUT_IDS)[number];

export interface SnapshotEffects {
  crop: CropSettings;
  rotation: RotationDegrees;
  fadeToBlack: boolean;
  muted: boolean;
}

export interface SnapshotComposite {
  slideSource: "upload" | "piprogram" | "source";
  pipelineId: PiprogramPipelineId;
  /** Older saved options have no sourceId; they apply as "hama" (unused unless slideSource is "source"). */
  sourceId: LiveSourceId;
}

export interface QuickOptionSnapshot {
  /** Routed source per output ("multiview" and null are allowed). */
  outputs: Record<SnapshotOutputId, string | null>;
  effects: Record<string, SnapshotEffects>;
  /** Only HDMI key composites: the ATEM media composite is never part of a snapshot. */
  composites: Partial<Record<CompositeId, SnapshotComposite>>;
}

export interface QuickOption {
  id: string;
  /** Short number (1-99) the AMX touch panel uses to run this option; unique. */
  number: number;
  name: string;
  createdAt: string;
  snapshot: QuickOptionSnapshot;
}

export class QuickOptionNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickOptionNameError";
  }
}
export class QuickOptionDuplicateError extends Error {
  constructor(name: string) {
    super(`A quick option named "${name}" already exists`);
    this.name = "QuickOptionDuplicateError";
  }
}
export class QuickOptionNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickOptionNumberError";
  }
}
export class QuickOptionNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown quick option: ${id}`);
    this.name = "QuickOptionNotFoundError";
  }
}
export class QuickOptionLimitError extends Error {
  constructor() {
    super(`At most ${MAX_QUICK_OPTIONS} quick options can be saved`);
    this.name = "QuickOptionLimitError";
  }
}

/** Trims the name and checks its length; throws QuickOptionNameError. */
export function normaliseQuickOptionName(value: unknown): string {
  if (typeof value !== "string") throw new QuickOptionNameError("name must be a string");
  const name = value.trim();
  if (name.length === 0) throw new QuickOptionNameError("name must not be empty");
  if (name.length > MAX_QUICK_OPTION_NAME) {
    throw new QuickOptionNameError(`name must be at most ${MAX_QUICK_OPTION_NAME} characters`);
  }
  return name;
}

/** Checks a quick option number; throws QuickOptionNumberError. */
export function checkQuickOptionNumber(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_QUICK_OPTION_NUMBER) {
    throw new QuickOptionNumberError(`number must be an integer from 1 to ${MAX_QUICK_OPTION_NUMBER}`);
  }
  return value as number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const sourceIdSet = new Set<string>(sourceDefinitions.map((s) => s.id));

/** Checks a saved snapshot read from disk; returns null when it is not usable. */
export function parseSnapshot(input: unknown): QuickOptionSnapshot | null {
  if (!isObject(input) || !isObject(input.outputs) || !isObject(input.effects) || !isObject(input.composites)) {
    return null;
  }
  const outputs = {} as Record<SnapshotOutputId, string | null>;
  for (const id of SNAPSHOT_OUTPUT_IDS) {
    const value = input.outputs[id];
    if (value === null || value === "multiview" || (typeof value === "string" && sourceIdSet.has(value))) {
      outputs[id] = value;
    } else {
      return null;
    }
  }
  const effects: Record<string, SnapshotEffects> = {};
  for (const [sourceId, raw] of Object.entries(input.effects)) {
    if (!sourceIdSet.has(sourceId) || !isObject(raw) || !isObject(raw.crop)) continue;
    const crop = raw.crop;
    if (
      typeof crop.enabled !== "boolean" ||
      !["x", "y", "width", "height", "sourceWidth", "sourceHeight"].every((k) => Number.isFinite(crop[k])) ||
      typeof crop.aspectRatio !== "string" ||
      typeof crop.lockedAspectRatio !== "boolean" ||
      ![0, 90, 180, 270].includes(raw.rotation as number) ||
      typeof raw.fadeToBlack !== "boolean" ||
      typeof raw.muted !== "boolean"
    ) {
      continue;
    }
    effects[sourceId] = {
      crop: crop as unknown as CropSettings,
      rotation: raw.rotation as RotationDegrees,
      fadeToBlack: raw.fadeToBlack,
      muted: raw.muted
    };
  }
  const composites: QuickOptionSnapshot["composites"] = {};
  for (const [id, raw] of Object.entries(input.composites)) {
    if (id !== "compose1" || !isObject(raw)) continue;
    if (
      (raw.slideSource === "upload" || raw.slideSource === "piprogram" || raw.slideSource === "source") &&
      (PIPROGRAM_PIPELINE_IDS as readonly string[]).includes(raw.pipelineId as string)
    ) {
      const sourceId = (LIVE_SOURCE_IDS as readonly string[]).includes(raw.sourceId as string) ? (raw.sourceId as LiveSourceId) : "hama";
      composites[id] = { slideSource: raw.slideSource, pipelineId: raw.pipelineId as PiprogramPipelineId, sourceId };
    }
  }
  return { outputs, effects, composites };
}

function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export class QuickOptionStore {
  private items: QuickOption[] = [];

  /** `file` undefined keeps everything in memory (tests). */
  constructor(private readonly file?: string) {
    this.load();
  }

  list(): QuickOption[] {
    return this.items.map(clone);
  }

  get(id: string): QuickOption {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new QuickOptionNotFoundError(id);
    return clone(item);
  }

  getByNumber(number: number): QuickOption {
    const item = this.items.find((entry) => entry.number === number);
    if (!item) throw new QuickOptionNotFoundError(`number ${number}`);
    return clone(item);
  }

  /** The lowest number from 1 that no option uses. */
  private freeNumber(): number {
    let n = 1;
    while (this.items.some((entry) => entry.number === n)) n += 1;
    return n;
  }

  create(name: unknown, snapshot: QuickOptionSnapshot, number?: unknown): QuickOption {
    const clean = normaliseQuickOptionName(name);
    const wanted = number === undefined || number === null ? this.freeNumber() : checkQuickOptionNumber(number);
    if (this.items.some((entry) => entry.number === wanted)) {
      throw new QuickOptionNumberError(`Quick option number ${wanted} is already in use`);
    }
    if (this.items.some((entry) => sameName(entry.name, clean))) throw new QuickOptionDuplicateError(clean);
    if (this.items.length >= MAX_QUICK_OPTIONS) throw new QuickOptionLimitError();
    const item: QuickOption = {
      id: `qo-${crypto.randomUUID().slice(0, 8)}`,
      number: wanted,
      name: clean,
      createdAt: new Date().toISOString(),
      snapshot: clone(snapshot)
    };
    this.items.push(item);
    this.persist();
    return clone(item);
  }

  rename(id: string, name: unknown): QuickOption {
    const clean = normaliseQuickOptionName(name);
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new QuickOptionNotFoundError(id);
    if (this.items.some((entry) => entry.id !== id && sameName(entry.name, clean))) {
      throw new QuickOptionDuplicateError(clean);
    }
    item.name = clean;
    this.persist();
    return clone(item);
  }

  setNumber(id: string, number: unknown): QuickOption {
    const wanted = checkQuickOptionNumber(number);
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new QuickOptionNotFoundError(id);
    if (this.items.some((entry) => entry.id !== id && entry.number === wanted)) {
      throw new QuickOptionNumberError(`Quick option number ${wanted} is already in use`);
    }
    item.number = wanted;
    this.persist();
    return clone(item);
  }

  delete(id: string): void {
    const index = this.items.findIndex((entry) => entry.id === id);
    if (index < 0) throw new QuickOptionNotFoundError(id);
    this.items.splice(index, 1);
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, items: this.items }, null, 2));
    fs.renameSync(temp, this.file);
  }

  /** Reads the saved file; an unreadable file or an entry that does not validate is skipped. */
  private load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    let saved: unknown;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return;
    }
    const items = isObject(saved) && Array.isArray(saved.items) ? saved.items : [];
    for (const raw of items) {
      if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.createdAt !== "string") continue;
      const snapshot = parseSnapshot(raw.snapshot);
      let name: string;
      try {
        name = normaliseQuickOptionName(raw.name);
      } catch {
        continue;
      }
      if (!snapshot || this.items.some((entry) => entry.id === raw.id || sameName(entry.name, name))) continue;
      // Options saved before numbers existed get the lowest free number, in saved order.
      const savedNumber = typeof raw.number === "number" && Number.isInteger(raw.number) &&
        raw.number >= 1 && raw.number <= MAX_QUICK_OPTION_NUMBER &&
        !this.items.some((entry) => entry.number === raw.number) ? raw.number : null;
      this.items.push({ id: raw.id, number: savedNumber ?? 0, name, createdAt: raw.createdAt, snapshot });
    }
    for (const item of this.items) if (item.number === 0) item.number = this.freeNumber();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
