/**
 * The PiPGM1-3 sources. Their pictures come from piprogram: the feed reads each pipeline's
 * snapshot every second and, when the slide changes (active item, step or size), fetches the
 * stage frame and shows it through a publisher that feeds MediaMTX (the same ffmpeg loop as the
 * composites). A fade to black, or a pipeline with no steps, stops the publisher, so the source
 * drops out of MediaMTX like any offline source. The snapshots are kept for listSources and the
 * multiview tiles.
 */

import fs from "node:fs";
import path from "node:path";
import { PIPROGRAM_PIPELINE_IDS, type PiprogramPipelineId } from "../composite/composite-model.js";
import type { PiprogramClient, PiprogramPipelineSnapshot } from "../composite/piprogram-feed.js";

/** What a PiPGM source needs to publish a picture. KeyPagePublisher fits. */
export interface PipgmSourcePublisher {
  show(pngPath: string): Promise<void>;
  stop(): Promise<void>;
}

export type PipgmPublishers = Record<PiprogramPipelineId, PipgmSourcePublisher>;

export interface PipgmSourceFeedOptions {
  client: PiprogramClient;
  publishers: PipgmPublishers;
  /** Directory for the PNG handed to each publisher (one file per pipeline). */
  dataDir: string;
  intervalMs?: number;
  onError?: (pipelineId: PiprogramPipelineId, message: string) => void;
}

const BLANK = "blank";

export class PipgmSourceFeed {
  private readonly snapshots = new Map<PiprogramPipelineId, PiprogramPipelineSnapshot>();
  /** What each publisher was last given: a frame key, or BLANK. */
  private readonly sent = new Map<PiprogramPipelineId, string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly options: PipgmSourceFeedOptions) {}

  /** The last snapshot of a pipeline, or null when piprogram has not answered. */
  snapshot(pipelineId: PiprogramPipelineId): PiprogramPipelineSnapshot | null {
    return this.snapshots.get(pipelineId) ?? null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the three pipelines. Overlapping passes are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const id of PIPROGRAM_PIPELINE_IDS) await this.follow(id);
    } finally {
      this.running = false;
    }
  }

  private async follow(id: PiprogramPipelineId): Promise<void> {
    let snapshot: PiprogramPipelineSnapshot;
    try {
      snapshot = await this.options.client.snapshot(id);
    } catch (error) {
      this.snapshots.delete(id);
      this.options.onError?.(id, messageOf(error));
      return;
    }
    this.snapshots.set(id, snapshot);

    if (snapshot.fadeToBlack || !snapshot.slideFeed.hasSlide) {
      if (this.sent.get(id) !== BLANK) {
        await this.options.publishers[id].stop();
        this.sent.set(id, BLANK);
      }
      return;
    }

    const { width, height } = snapshot.slideFeed;
    const key = [snapshot.activeItemId ?? "", snapshot.currentStep, width, height].join("|");
    if (this.sent.get(id) === key) return;
    try {
      const png = await this.options.client.frame(id, width, height, { transparent: false });
      const file = path.join(this.options.dataDir, `${id}.png`);
      fs.mkdirSync(this.options.dataDir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temp, png);
      fs.renameSync(temp, file);
      await this.options.publishers[id].show(file);
      this.sent.set(id, key);
    } catch (error) {
      // Not recorded as sent: the next tick tries again.
      this.options.onError?.(id, messageOf(error));
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
