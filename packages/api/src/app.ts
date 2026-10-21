import { createFleet } from "fffleet";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { inspectMediaMtx } from "./media-mtx.js";
import { createOutputStore, getSources, sourceDefinitions } from "./model.js";

export function buildApp(config: AppConfig, fetchImpl: typeof fetch = fetch): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  const outputStore = createOutputStore();
  const fleet = config.fffleetUrl ? createFleet({
    url: config.fffleetUrl,
    ...(config.fffleetToken ? { token: config.fffleetToken } : {}),
    ...(config.fffleetClientId && config.fffleetClientSecret
      ? { clientId: config.fffleetClientId, clientSecret: config.fffleetClientSecret, scope: "jobs" }
      : {}),
    fallback: "none",
    fetch: fetchImpl,
    requestTimeoutMs: 1500
  }) : null;

  app.addHook("onClose", async () => {
    await fleet?.close();
  });

  const mediaSnapshot = () => inspectMediaMtx(config.mediaMtxApiUrl, fetchImpl);
  const mediaStatus = async () => {
    const snapshot = await mediaSnapshot();
    return !snapshot.configured ? "not-configured" : snapshot.connected ? "connected" : "unavailable";
  };
  const fleetStatus = async () => {
    if (!fleet) return "not-configured";
    try {
      await fleet.capabilities();
      return "connected";
    } catch {
      return "unavailable";
    }
  };

  app.get("/health", async () => ({ status: "ok", service: "pimatrix" }));

  app.get("/ready", async (_request, reply) => {
    const media = await mediaStatus();
    return reply.code(200).send({
      ready: true,
      mode: config.mode,
      checks: {
        api: "ready",
        media,
        capture: "not-configured",
        display: "not-configured"
      }
    });
  });

  app.get("/api/v1/status", async () => ({
    apiVersion: "v1",
    service: "pimatrix",
    mode: config.mode,
    status: "running",
    integrations: {
      mediaMtx: await mediaStatus(),
      fffleet: await fleetStatus(),
      capture: "not-configured",
      display: "not-configured",
      amx: "not-configured"
    },
    counts: { sources: 8, outputs: 2 }
  }));

  app.get("/api/v1/sources", async () => {
    const snapshot = await mediaSnapshot();
    return { items: getSources(snapshot.readyPaths, config.previewBaseUrl) };
  });

  app.get<{ Params: { sourceId: string } }>("/api/v1/sources/:sourceId", async (request, reply) => {
    const snapshot = await mediaSnapshot();
    const source = getSources(snapshot.readyPaths, config.previewBaseUrl)
      .find((item) => item.id === request.params.sourceId);
    if (!source) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }
    return source;
  });

  app.get("/api/v1/outputs", async () => ({ items: outputStore.list() }));

  app.put<{ Params: { outputId: string }; Body: { sourceId?: unknown } }>(
    "/api/v1/outputs/:outputId/source",
    async (request, reply) => {
      if (!Object.prototype.hasOwnProperty.call(request.body ?? {}, "sourceId")) {
        return reply.code(422).send({
          error: { code: "SOURCE_REQUIRED", message: "Request body must include sourceId (or null to clear)" }
        });
      }
      const requestedSource = request.body.sourceId;
      if (requestedSource !== null &&
          (typeof requestedSource !== "string" ||
           !sourceDefinitions.some((source) => source.id === requestedSource))) {
        return reply.code(422).send({
          error: { code: "INVALID_SOURCE", message: "sourceId must be a known logical source ID or null" }
        });
      }
      const output = outputStore.setDesiredSource(
        request.params.outputId,
        requestedSource as import("./model.js").SourceId | null
      );
      if (!output) {
        return reply.code(404).send({
          error: { code: "OUTPUT_NOT_FOUND", message: `Unknown output ID: ${request.params.outputId}` }
        });
      }
      return reply.code(202).send(output);
    }
  );

  app.setNotFoundHandler(async (request, reply) => reply.code(404).send({
    error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url}` }
  }));

  return app;
}
