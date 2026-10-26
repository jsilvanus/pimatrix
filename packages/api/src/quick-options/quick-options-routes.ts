/**
 * HTTP routes for quick options. Writes go through the API's auth hook under /api/v1/.
 * Applying a quick option changes output routes, source effects and the HDMI key
 * composite's slide source only; it never calls the ATEM or a camera.
 */

import type { FastifyInstance } from "fastify";
import type { CompositeId, CompositeStatus } from "../composite/composite-model.js";
import type { CompositeService } from "../composite/composite-service.js";
import type { EffectsPipeline, EffectsStore } from "../effects/effects-model.js";
import type { OutputId, OutputSnapshot, OutputStore, SourceId } from "../model.js";
import {
  QuickOptionDuplicateError,
  QuickOptionLimitError,
  QuickOptionNameError,
  QuickOptionNotFoundError,
  SNAPSHOT_OUTPUT_IDS,
  type QuickOption,
  type QuickOptionSnapshot,
  type QuickOptionStore
} from "./quick-options-store.js";

export interface QuickOptionDeps {
  store: QuickOptionStore;
  outputStore: OutputStore;
  effectsStore: EffectsStore;
  compositeService: CompositeService;
  /** Routes an output the way PUT /outputs/{id}/source does (adapter, events, Hama on demand). */
  routeOutput: (outputId: OutputId, sourceId: string | null) => Promise<OutputSnapshot | undefined>;
  /** Announces changed effects (event stream, Hama restart). */
  effectsChanged: (sourceId: SourceId, effects: EffectsPipeline) => void;
}

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

function fail(reply: Reply, status: number, code: string, message: string): unknown {
  return reply.code(status).send({ error: { code, message } });
}

/** The current Outputs state as a snapshot. */
export function captureSnapshot(deps: Pick<QuickOptionDeps, "outputStore" | "effectsStore" | "compositeService">): QuickOptionSnapshot {
  const outputs = {} as QuickOptionSnapshot["outputs"];
  for (const id of SNAPSHOT_OUTPUT_IDS) outputs[id] = deps.outputStore.get(id)?.desiredSource ?? null;
  const effects: QuickOptionSnapshot["effects"] = {};
  for (const p of deps.effectsStore.list()) {
    effects[p.sourceId] = { crop: p.crop, rotation: p.rotation, fadeToBlack: p.fadeToBlack, muted: p.muted };
  }
  const composites: QuickOptionSnapshot["composites"] = {};
  for (const status of deps.compositeService.list()) {
    if (status.kind !== "hdmi-key") continue;
    composites[status.id] = { slideSource: status.slideSource, pipelineId: status.pipelineId, sourceId: status.sourceId };
  }
  return { outputs, effects, composites };
}

export interface AppliedState {
  outputs: OutputSnapshot[];
  effects: EffectsPipeline[];
  composites: CompositeStatus[];
}

/** Restores a snapshot. Only values that differ from the current state are written. */
export async function applySnapshot(deps: QuickOptionDeps, snapshot: QuickOptionSnapshot): Promise<AppliedState> {
  for (const id of SNAPSHOT_OUTPUT_IDS) {
    const wanted = snapshot.outputs[id];
    if (deps.outputStore.get(id)?.desiredSource !== wanted) await deps.routeOutput(id, wanted);
  }
  for (const [sourceId, saved] of Object.entries(snapshot.effects)) {
    const id = sourceId as SourceId;
    const current = deps.effectsStore.get(id);
    if (!current) continue;
    let latest: EffectsPipeline | undefined;
    if (JSON.stringify(current.crop) !== JSON.stringify(saved.crop)) latest = deps.effectsStore.updateCrop(id, saved.crop);
    if (current.rotation !== saved.rotation) latest = deps.effectsStore.setRotation(id, saved.rotation);
    if (current.fadeToBlack !== saved.fadeToBlack) latest = deps.effectsStore.setFadeToBlack(id, { fadeToBlack: saved.fadeToBlack });
    if (current.muted !== saved.muted) latest = deps.effectsStore.setMuted(id, { muted: saved.muted });
    if (latest) deps.effectsChanged(id, deps.effectsStore.get(id) ?? latest);
  }
  for (const [id, saved] of Object.entries(snapshot.composites)) {
    const current = deps.compositeService.get(id);
    if (current.kind !== "hdmi-key") continue;
    if (current.slideSource !== saved.slideSource || current.pipelineId !== saved.pipelineId || current.sourceId !== saved.sourceId) {
      await deps.compositeService.update(id as CompositeId, {
        slideSource: saved.slideSource,
        pipelineId: saved.pipelineId,
        sourceId: saved.sourceId
      });
    }
  }
  return {
    outputs: deps.outputStore.list(),
    effects: deps.effectsStore.list(),
    composites: deps.compositeService.list()
  };
}

export function registerQuickOptionRoutes(app: FastifyInstance, deps: QuickOptionDeps): void {
  const handle = (reply: Reply, error: unknown): unknown => {
    if (error instanceof QuickOptionNotFoundError) return fail(reply, 404, "QUICK_OPTION_NOT_FOUND", error.message);
    if (error instanceof QuickOptionNameError) return fail(reply, 422, "INVALID_NAME", error.message);
    if (error instanceof QuickOptionDuplicateError) return fail(reply, 409, "DUPLICATE_NAME", error.message);
    if (error instanceof QuickOptionLimitError) return fail(reply, 422, "TOO_MANY_QUICK_OPTIONS", error.message);
    throw error;
  };

  app.get("/api/v1/quick-options", async (): Promise<{ items: QuickOption[] }> => ({ items: deps.store.list() }));

  app.post<{ Body: { name?: unknown } }>("/api/v1/quick-options", async (request, reply) => {
    try {
      const created = deps.store.create(request.body?.name, captureSnapshot(deps));
      return reply.code(201).send(created);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/quick-options/:id/apply", async (request, reply) => {
    try {
      const option = deps.store.get(request.params.id);
      return reply.code(200).send(await applySnapshot(deps, option.snapshot));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.put<{ Params: { id: string }; Body: { name?: unknown } }>("/api/v1/quick-options/:id", async (request, reply) => {
    try {
      return reply.code(200).send(deps.store.rename(request.params.id, request.body?.name));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/quick-options/:id", async (request, reply) => {
    try {
      deps.store.delete(request.params.id);
      return reply.code(204).send();
    } catch (error) {
      return handle(reply, error);
    }
  });
}
