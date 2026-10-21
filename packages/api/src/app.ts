import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { getOutputs, getSources } from "./model.js";

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "pimatrix" }));

  app.get("/ready", async (_request, reply) => reply.code(200).send({
    ready: true,
    mode: config.mode,
    checks: { api: "ready", media: "not-configured", capture: "not-configured", display: "not-configured" }
  }));

  app.get("/api/v1/status", async () => ({
    apiVersion: "v1",
    service: "pimatrix",
    mode: config.mode,
    status: "running",
    integrations: {
      mediaMtx: "not-configured",
      fffleet: "not-configured",
      capture: "not-configured",
      display: "not-configured",
      amx: "not-configured"
    },
    counts: { sources: 8, outputs: 2 }
  }));

  app.get("/api/v1/sources", async () => ({ items: getSources() }));

  app.get<{ Params: { sourceId: string } }>("/api/v1/sources/:sourceId", async (request, reply) => {
    const source = getSources().find((item) => item.id === request.params.sourceId);
    if (!source) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }
    return source;
  });

  app.get("/api/v1/outputs", async () => ({ items: getOutputs() }));

  app.setNotFoundHandler(async (request, reply) => reply.code(404).send({
    error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url}` }
  }));

  return app;
}
