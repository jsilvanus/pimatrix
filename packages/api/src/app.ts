import { createFleet } from "fffleet";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { inspectMediaMtx } from "./media-mtx.js";
import { createOutputStore, getSources, sourceDefinitions } from "./model.js";
import { buildHamaCaptureSpec, StreamSupervisor } from "./stream-supervisor.js";

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
      ? { clientId: config.fffleetClientId, clientSecret: config.fffleetClientSecret, scope: "jobs"
      } : {}),
    fallback: "none",
    fetch: fetchImpl,
    requestTimeoutMs: 1500
  }) : null;

  // Capture must stay on the Pi that owns the USB device; never send /dev/video0 to a remote fleet.
  const localCaptureFleet = config.hamaEnabled ? createFleet({
    fallback: "none",
    local: { slots: { stream: 1 }, kinds: ["stream"] }
  }) : null;
  const captureSupervisor = new StreamSupervisor(
    localCaptureFleet,
    (attempt) => buildHamaCaptureSpec(config, attempt),
    config.hamaEnabled,
    config.streamRestartMinMs,
    config.streamRestartMaxMs
  );

  app.addHook("onReady", async () => {
    captureSupervisor.start();
  });
  app.addHook("onClose", async () => {
    await Promise.all([
      captureSupervisor.stop(),
      fleet?.close() ?? Promise.resolve()
    ]);
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
  const captureStatus = () => {
    const state = captureSupervisor.snapshot().state;
    if (state === "disabled") return "not-configured";
    if (state === "starting") return "starting";
    if (state === "running") return "running";
    if (state === "stopping") return "stopping";
    return state;
  };
  const listSources = async () => {
    const media = await mediaSnapshot();
    const items = getSources(media.readyPaths, config.previewBaseUrl);
    const capture = captureSupervisor.snapshot();
    const hama = items.find((source) => source.id === "hama");
    if (hama && !media.readyPaths.has("hama") && capture.state !== "disabled") {
      if (capture.state === "starting") hama.state = "starting";
      else if (capture.state === "degraded") hama.state = "degraded";
      else if (capture.state === "failed") hama.state = "failed";
    }
    return items;
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
        capture: captureStatus(),
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
      capture: captureStatus(),
      display: "not-configured",
      amx: "not-configured"
    },
    managedStreams: { hama: captureSupervisor.snapshot() },
    counts: { sources: 8, outputs: 2 }
  }));

  app.get("/api/v1/sources", async () => ({ items: await listSources() }));

  app.get<{ Params: { sourceId: string } }>("/api/v1/sources/:sourceId", async (request, reply) => {
    const source = (await listSources()).find((item) => item.id === request.params.sourceId);
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
