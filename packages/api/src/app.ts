import { createFleet } from "fffleet";
import Fastify, { type FastifyInstance } from "fastify";
import { createAmxClient, type AmxClient } from "./amx/amx-client.js";
import { AmxTcpListener } from "./amx/amx-listener.js";
import type { AppConfig } from "./config.js";
import { createDisplayAdapter, type DisplayAdapter } from "./display-adapter.js";
import { PiMatrixEventBroker } from "./events.js";
import { inspectMediaMtx } from "./media-mtx.js";
import { createOutputStore, getSources, sourceDefinitions, type OutputId, type SourceId } from "./model.js";
import { buildHamaCaptureSpec, StreamSupervisor } from "./stream-supervisor.js";

export function buildApp(config: AppConfig, fetchImpl: typeof fetch = fetch): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  const outputStore = createOutputStore();
  const displayAdapter: DisplayAdapter = createDisplayAdapter(config.displayMode);
  const eventBroker = new PiMatrixEventBroker();

  const amxClient: AmxClient = createAmxClient(
    config.amxSimulated,
    config.amxMasterHost,
    config.amxMasterPort,
    app.log
  );

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

  const amxListener = config.amxTcpEnabled
    ? new AmxTcpListener({
        host: config.amxTcpHost,
        port: config.amxTcpPort,
        outputStore,
        displayAdapter,
        eventBroker,
        listSources,
        mode: config.mode,
        logger: app.log
      })
    : null;

  app.addHook("onReady", async () => {
    captureSupervisor.start();
    if (amxListener) {
      await amxListener.start();
    }
  });

  app.addHook("onClose", async () => {
    await Promise.all([
      captureSupervisor.stop(),
      amxListener ? amxListener.stop() : Promise.resolve(),
      amxClient.close(),
      displayAdapter.close(),
      fleet?.close() ?? Promise.resolve()
    ]);
  });

  // Expose services on Fastify instance for test inspections if needed
  (app as unknown as { amxListener?: AmxTcpListener | null }).amxListener = amxListener;
  (app as unknown as { eventBroker: PiMatrixEventBroker }).eventBroker = eventBroker;

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
        display: displayAdapter.getStatus()
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
      display: displayAdapter.getStatus(),
      amx: await amxClient.getStatus()
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
      if (
        requestedSource !== null &&
        (typeof requestedSource !== "string" ||
          !sourceDefinitions.some((source) => source.id === requestedSource))
      ) {
        return reply.code(422).send({
          error: { code: "INVALID_SOURCE", message: "sourceId must be a known logical source ID or null" }
        });
      }

      const output = outputStore.setDesiredSource(
        request.params.outputId,
        requestedSource as SourceId | null
      );
      if (!output) {
        return reply.code(404).send({
          error: { code: "OUTPUT_NOT_FOUND", message: `Unknown output ID: ${request.params.outputId}` }
        });
      }

      const observed = await displayAdapter.applyRoute(
        request.params.outputId as OutputId,
        requestedSource as SourceId | null
      );
      outputStore.setObservedState(request.params.outputId, observed.observedSource, observed.state);

      const current = outputStore.get(request.params.outputId as OutputId) ?? output;
      eventBroker.emit({
        type: "output",
        data: { output: current }
      });

      return reply.code(202).send(current);
    }
  );

  app.get("/api/v1/events", async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");

    reply.raw.write(
      `event: ready\ndata: ${JSON.stringify({ status: "connected", time: new Date().toISOString() })}\n\n`
    );

    const unsubscribe = eventBroker.subscribe((event) => {
      try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      } catch {
        // Socket closed
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": keep-alive\n\n");
      } catch {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post<{ Body: { input?: unknown; output?: unknown } }>(
    "/api/v1/matrix/route",
    async (request, reply) => {
      const input = Number(request.body?.input);
      const output = Number(request.body?.output);

      if (!Number.isInteger(input) || input < 1 || input > 4) {
        return reply.code(422).send({
          error: { code: "INVALID_INPUT", message: "Matrix input must be an integer between 1 and 4" }
        });
      }
      if (!Number.isInteger(output) || output < 1 || output > 4) {
        return reply.code(422).send({
          error: { code: "INVALID_OUTPUT", message: "Matrix output must be an integer between 1 and 4" }
        });
      }

      try {
        const result = await amxClient.routeMatrix(input, output);
        if (!result.success) {
          return reply.code(502).send({
            error: { code: "AMX_ROUTE_FAILED", message: result.message ?? "AMX request was not accepted" }
          });
        }
        return reply.code(200).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "AMX request failed";
        return reply.code(502).send({
          error: { code: "AMX_UNAVAILABLE", message }
        });
      }
    }
  );

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url}` }
    })
  );

  return app;
}
