/**
 * HTTP routes for the slide composites. Reads are open to any client that may call the
 * API; writes (PUT, POST) go through the API's existing auth hook under /api/v1/.
 * The slide is sent as a raw PNG body (Content-Type: image/png).
 */

import type { FastifyInstance } from "fastify";
import { parseCompositePatch, COMPOSITE_IDS, type CompositeStatus } from "./composite-model.js";
import {
  CompositeNotFoundError,
  InvalidSlideError,
  MAX_SLIDE_BYTES,
  type CompositeService
} from "./composite-service.js";

function notFound(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, id: string): unknown {
  return reply.code(404).send({ error: { code: "COMPOSITE_NOT_FOUND", message: `Unknown composite: ${id}. Known: ${COMPOSITE_IDS.join(", ")}` } });
}

export function registerCompositeRoutes(app: FastifyInstance, composites: CompositeService): void {
  app.addContentTypeParser("image/png", { parseAs: "buffer", bodyLimit: MAX_SLIDE_BYTES }, (_request, body, done) => {
    done(null, body);
  });

  app.get("/api/v1/composites", async (): Promise<{ items: CompositeStatus[] }> => ({ items: composites.list() }));

  app.get<{ Params: { id: string } }>("/api/v1/composites/:id", async (request, reply) => {
    try {
      return composites.get(request.params.id);
    } catch (error) {
      if (error instanceof CompositeNotFoundError) return notFound(reply, request.params.id);
      throw error;
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/composites/slide", async (request, reply) => {
    const body = request.body;
    if (!(body instanceof Buffer)) {
      return reply.code(415).send({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Send the slide as image/png" } });
    }
    try {
      const items = await composites.setSlide(body);
      return reply.code(202).send({ items });
    } catch (error) {
      if (error instanceof InvalidSlideError) {
        return reply.code(422).send({ error: { code: "INVALID_SLIDE", message: error.message } });
      }
      throw error;
    }
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/composites/:id", async (request, reply) => {
    const validated = parseCompositePatch(request.body);
    if (!validated.ok) {
      return reply.code(422).send({ error: { code: "INVALID_COMPOSITE", message: validated.message } });
    }
    try {
      return reply.code(200).send(await composites.update(request.params.id, validated.patch));
    } catch (error) {
      if (error instanceof CompositeNotFoundError) return notFound(reply, request.params.id);
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/composites/:id/start", async (request, reply) => {
    try {
      return reply.code(200).send(await composites.update(request.params.id, { enabled: true }));
    } catch (error) {
      if (error instanceof CompositeNotFoundError) return notFound(reply, request.params.id);
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/v1/composites/:id/stop", async (request, reply) => {
    try {
      return reply.code(200).send(await composites.update(request.params.id, { enabled: false }));
    } catch (error) {
      if (error instanceof CompositeNotFoundError) return notFound(reply, request.params.id);
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/api/v1/composites/:id/preview.png", async (request, reply) => {
    try {
      const png = await composites.previewPng(request.params.id);
      if (!png) {
        return reply.code(404).send({ error: { code: "NO_SLIDE", message: "No slide has been sent yet" } });
      }
      return reply.type("image/png").send(png);
    } catch (error) {
      if (error instanceof CompositeNotFoundError) return notFound(reply, request.params.id);
      throw error;
    }
  });
}
