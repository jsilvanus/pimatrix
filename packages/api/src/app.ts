import fs from "node:fs";
import { createFleet } from "fffleet";
import Fastify, { type FastifyInstance } from "fastify";
import { createAmxClient, type AmxClient } from "./amx/amx-client.js";
import { AmxTcpListener } from "./amx/amx-listener.js";
import { AtemAdapter } from "./atem/atem-adapter.js";
import { registerAtemRoutes } from "./atem/atem-routes.js";
import { CameraService } from "./camera/camera-service.js";
import { CameraCgiError } from "./camera/camera-adapter.js";
import type { PanTiltDirection, SmartFrameMode, ZoomAction } from "./camera/visca-protocol.js";
import type { AppConfig } from "./config.js";
import { createDisplayAdapter, type DisplayAdapter } from "./display-adapter.js";
import { PiMatrixEventBroker } from "./events.js";
import {
  EffectsStore,
  type AspectRatioPreset,
  type CropPresetAction,
  type CropSettings,
  type MoveDirection,
  type RotationDegrees
} from "./effects/effects-model.js";
import {
  renderOperatorFrontendHtml,
  resolveWebAssetFile,
  type FrontendTabId,
  type MatrixRouteState,
  type RtspOutState
} from "./frontend-html.js";
import { inspectMediaMtx } from "./media-mtx.js";
import {
  createOutputStore,
  getMultiview,
  getSources,
  multiviewSourceOrder,
  sourceDefinitions,
  type MultiviewLayoutMode,
  type MultiviewTilePiPgmStatus,
  type OutputId,
  type SourceId
} from "./model.js";
import { renderMultiviewHtml } from "./multiview-html.js";
import type {
  PiPgmControlAction,
  PiPgmOrientation,
  PiPgmPipelineId,
  PptxAnimationEffect
} from "./pipgm/pipgm-model.js";
import { PiPgmService } from "./pipgm/pipgm-service.js";
import { renderPiPgmStageHtml } from "./pipgm/stage-html.js";
import { buildHamaCaptureSpec, StreamSupervisor } from "./stream-supervisor.js";
import { isIpWhitelisted } from "./ip-whitelist.js";

/** Maps a failed camera CGI call to a 502 with a reason, so a bad login is visible in the API. */
function sendCameraCgiError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown): unknown {
  if (err instanceof CameraCgiError) {
    const code =
      err.reason === "auth" ? "CAMERA_LOGIN_REJECTED" : err.reason === "unreachable" ? "CAMERA_UNREACHABLE" : "CAMERA_REJECTED";
    return reply.code(502).send({ error: { code, message: err.message } });
  }
  throw err;
}

export function buildApp(config: AppConfig, fetchImpl: typeof fetch = fetch): FastifyInstance {
  const app = Fastify({
    trustProxy: true,
    bodyLimit: 50 * 1024 * 1024, // 50 MB for direct .pptx, video, and image uploads
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  const outputStore = createOutputStore();
  const effectsStore = new EffectsStore(sourceDefinitions.map((s) => s.id));
  const displayAdapter: DisplayAdapter = createDisplayAdapter(config.displayMode, config);
  const atem = new AtemAdapter();
  registerAtemRoutes(app, atem);
  const eventBroker = new PiMatrixEventBroker();
  // The HDMI player moves from "starting" to "active" on a timer, not on a route call,
  // so keep the output store and the event stream in step with every state change.
  displayAdapter.onStateChange?.((observed) => {
    outputStore.setObservedState(observed.id, observed.observedSource, observed.state);
    const current = outputStore.get(observed.id);
    if (current) eventBroker.emit({ type: "output", data: { output: current } });
  });
  let multiviewLayout: MultiviewLayoutMode = "auto";
  const multiviewSlotOverrides = new Map<number, SourceId>();

  const matrixState: MatrixRouteState = {
    locked: false,
    routes: {
      1: 1, // Projector 1 -> Lectern
      2: 2, // Projector 2 -> Rack PC
      3: null, // Screen -> Ei vielä hankittu
      4: 3 // Videomikseri -> Pi 1
    }
  };

  let rtspOutState: RtspOutState = {
    sourceId: "rtmp1",
    layout: "landscape",
    url: "rtsp://pimatrix.local:554/live",
    streaming: false,
    quality: "full",
    resolution: "1920x1080",
    bitrateKbps: 6200
  };

  const pipgmService = new PiPgmService({
    eventBroker,
    canvaConfig: {
      apiBaseUrl: config.canvaApiBaseUrl,
      accessToken: config.canvaAccessToken,
      fetchImpl
    }
  });

  const cameraService = new CameraService({
    mode: config.mode,
    eventBroker,
    logger: app.log,
    cam1Name: config.cam1Name,
    cam1Host: config.cam1Host,
    cam1ViscaPort: config.cam1ViscaPort,
    cam1CgiPort: config.cam1CgiPort,
    cam1CgiUser: config.cam1CgiUser,
    cam1CgiPassword: config.cam1CgiPassword,
    cam2Name: config.cam2Name,
    cam2Host: config.cam2Host,
    cam2ViscaPort: config.cam2ViscaPort,
    cam2CgiPort: config.cam2CgiPort,
    cam2CgiUser: config.cam2CgiUser,
    cam2CgiPassword: config.cam2CgiPassword,
    mediaMtxRtspBaseUrl: config.previewBaseUrl?.replace(/^http/, "rtsp"),
    mediaMtxRtmpBaseUrl: config.mediaMtxRtmpUrl
  });

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
    (attempt) => {
      const hamaEffects = effectsStore.get("hama");
      const filter =
        hamaEffects && (hamaEffects.crop.enabled || hamaEffects.fadeToBlack)
          ? hamaEffects.ffmpegFilter
          : undefined;
      return buildHamaCaptureSpec(config, attempt, filter);
    },
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

  const listSources = async (includeHidden = false) => {
    const media = await mediaSnapshot();
    const unhiddenIds = new Set<string>();
    if (!pipgmService.isPipelineHidden("PiPGM3")) {
      unhiddenIds.add("PiPGM3");
    }

    const items = getSources(media.readyPaths, config.previewBaseUrl, {
      includeHidden,
      unhiddenIds
    });

    // Apply env-configured camera names (PIMATRIX_CAM1_NAME, PIMATRIX_CAM2_NAME, PIMATRIX_CAM3_NAME)
    const camNameById: Record<string, string | undefined> = {
      cam1: config.cam1Name,
      cam2: config.cam2Name,
      cam3: config.cam3Name
    };
    for (const item of items) {
      if (camNameById[item.id]) {
        item.label = camNameById[item.id]!;
      }
    }

    const capture = captureSupervisor.snapshot();
    const hama = items.find((source) => source.id === "hama");
    if (hama && !media.readyPaths.has("hama") && capture.state !== "disabled") {
      if (capture.state === "starting") hama.state = "starting";
      else if (capture.state === "degraded") hama.state = "degraded";
      else if (capture.state === "failed") hama.state = "failed";
    }

    for (const p of pipgmService.listPipelines(true)) {
      const src = items.find((item) => item.id === p.id);
      if (src && !media.readyPaths.has(p.id) && p.activeItemId !== null) {
        src.state = "live";
        if (!src.preview.url) {
          src.preview = {
            available: true,
            url: p.stageUrl
          };
        }
      }
    }

    return items;
  };

  const buildCurrentMultiview = async () => {
    const allSources = await listSources(true);
    const pipgmStatusById = new Map<string, MultiviewTilePiPgmStatus>();
    for (const p of pipgmService.listPipelines(true)) {
      pipgmStatusById.set(p.id, {
        orientation: p.orientation,
        fadeToBlack: p.fadeToBlack,
        audioEnabled: p.audioEnabled,
        signCode: p.mobileAlert.signCode,
        cuedSummary: p.mobileAlert.cuedSummary
      });
    }

    return getMultiview(allSources, multiviewLayout, {
      slotOverrides: multiviewSlotOverrides,
      pipgm3AutoReplace: pipgmService.isPipelineActiveOnMultiview("PiPGM3"),
      pipgmStatusById
    });
  };

  const renderFrontendPage = async (activeTab: FrontendTabId, request?: { ip?: string }) => {
    const sources = await listSources(true);
    const outputs = outputStore.list();
    const effects = effectsStore.list();
    const cameras = cameraService.list();
    const pipgmPipelines = pipgmService.listPipelines(true);
    const multiview = await buildCurrentMultiview();
    return renderOperatorFrontendHtml({
      activeTab,
      mode: config.mode,
      sources,
      outputs,
      effects,
      cameras,
      pipgmPipelines,
      multiview,
      matrix: matrixState,
      rtspOut: rtspOutState,
      authRequired: Boolean(config.apiKey),
      mediaMtxPassword: config.mediaMtxPassword ?? null,
      isWhitelisted: isIpWhitelisted(request?.ip, config.authAllowedHosts),
      clientIp: request?.ip
    });
  };

  const amxListener = config.amxTcpEnabled
    ? new AmxTcpListener({
        host: config.amxTcpHost,
        port: config.amxTcpPort,
        outputStore,
        displayAdapter,
        pipgmService,
        eventBroker,
        listSources: () => listSources(false),
        mode: config.mode,
        logger: app.log,
        ...(config.amxAllowedHosts && config.amxAllowedHosts.length > 0
          ? { allowedIps: config.amxAllowedHosts }
          : {})
      })
    : null;

  app.addHook("onReady", async () => {
    captureSupervisor.start();
    if (config.atemHost) {
      await atem.connect(config.atemHost, config.atemPort).catch((error: unknown) => {
        app.log.error({ err: error }, "ATEM connection failed; retrying is not automatic");
      });
    }
    if (amxListener) {
      await amxListener.start();
    }
  });

  app.addHook("onClose", async () => {
    await Promise.all([
      atem.disconnect(),
      captureSupervisor.stop(),
      cameraService.close(),
      amxListener ? amxListener.stop() : Promise.resolve(),
      amxClient.close(),
      displayAdapter.close(),
      fleet?.close() ?? Promise.resolve()
    ]);
  });

  // CORS for the /api/v1 routes, only for origins listed in PIMATRIX_CORS_ORIGINS.
  // Preflights are answered here, before routing, so an OPTIONS request never 404s.
  // The Canva routes keep their own headers (they set "*" themselves).
  const corsAllowed = new Set(config.corsOrigins ?? []);
  const corsOriginFor = (origin: string | undefined): string | null => {
    if (!origin || corsAllowed.size === 0) return null;
    return corsAllowed.has(origin) ? origin : null;
  };
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "OPTIONS" || !request.url.startsWith("/api/v1/")) return;
    const allowed = corsOriginFor(request.headers.origin);
    if (!allowed) return;
    return reply
      .code(204)
      .header("Access-Control-Allow-Origin", allowed)
      .header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
      .header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key")
      .header("Access-Control-Max-Age", "600")
      .header("Vary", "Origin")
      .send();
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (!request.url.startsWith("/api/v1/") || reply.hasHeader("Access-Control-Allow-Origin")) return payload;
    const allowed = corsOriginFor(request.headers.origin);
    reply.header("Vary", "Origin");
    if (allowed) reply.header("Access-Control-Allow-Origin", allowed);
    return payload;
  });

  // Authentication hook for control points
  app.addHook("onRequest", async (request, reply) => {
    const method = request.method;
    // Safe read methods and OPTIONS preflights never require auth
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return;
    }

    const url = request.url.split("?")[0] || "";
    // Only protect /api/v1/ mutating endpoints
    if (!url.startsWith("/api/v1/")) {
      return;
    }

    // Skip auth verification endpoint itself
    if (url === "/api/v1/auth/verify") {
      return;
    }

    // If client IP is whitelisted (LAN operator access), bypass authentication
    if (isIpWhitelisted(request.ip, config.authAllowedHosts)) {
      return;
    }

    // If no credentials configured, allow control in open development mode
    if (!config.apiKey && !config.canvaAppToken) {
      return;
    }

    // Extract token from Bearer or x-api-key header (query-string tokens leak into logs)
    const authHeader = request.headers.authorization;
    let token: string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (typeof request.headers["x-api-key"] === "string") {
      token = request.headers["x-api-key"].trim();
    }

    // Canva control points: accept either canvaAppToken or apiKey
    if (/^\/api\/v1\/pipgm\/(canva\/|items\/[^/]+\/canva\/)/.test(url)) {
      if (config.canvaAppToken && token === config.canvaAppToken) {
        return;
      }
      if (config.apiKey && token === config.apiKey) {
        return;
      }
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Valid Canva application token or API key required"
      });
    }

    // All other control points: verify apiKey
    if (config.apiKey && token !== config.apiKey) {
      return reply.status(401).send({
        statusCode: 401,
        error: "Unauthorized",
        message: "Valid API key or Bearer token required for control operations"
      });
    }
  });

  app.get("/api/v1/auth/status", async (request) => {
    const clientIp = request.ip;
    const isWhitelisted = isIpWhitelisted(clientIp, config.authAllowedHosts);
    // The MediaMTX password is only for operators: LAN clients, open mode or a valid key.
    const presented = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7).trim()
      : typeof request.headers["x-api-key"] === "string"
        ? request.headers["x-api-key"].trim()
        : undefined;
    const isOperator = isWhitelisted || !config.apiKey || presented === config.apiKey;
    return {
      authRequired: Boolean(config.apiKey),
      canvaAuthRequired: Boolean(config.canvaAppToken),
      isWhitelisted,
      clientIp,
      mediaMtxPassword: isOperator ? (config.mediaMtxPassword ?? null) : null
    };
  });

  app.post("/api/v1/auth/verify", async (request, reply) => {
    const clientIp = request.ip;
    const isWhitelisted = isIpWhitelisted(clientIp, config.authAllowedHosts);
    if (isWhitelisted) {
      return { valid: true, authRequired: Boolean(config.apiKey), isWhitelisted: true, clientIp };
    }
    if (!config.apiKey) {
      return { valid: true, authRequired: false, isWhitelisted: false, clientIp };
    }
    const body = (request.body as { key?: string }) ?? {};
    const authHeader = request.headers.authorization;
    const token = body.key?.trim() ||
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined) ||
      (typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"].trim() : undefined);

    if (token === config.apiKey) {
      return { valid: true, authRequired: true, isWhitelisted: false, clientIp };
    }
    return reply.status(401).send({
      statusCode: 401,
      valid: false,
      error: "Unauthorized",
      message: "Invalid API key"
    });
  });

  // Expose services on Fastify instance for test inspections if needed
  (app as unknown as { amxListener?: AmxTcpListener | null }).amxListener = amxListener;
  (app as unknown as { eventBroker: PiMatrixEventBroker }).eventBroker = eventBroker;
  (app as unknown as { cameraService: CameraService }).cameraService = cameraService;
  (app as unknown as { pipgmService: PiPgmService }).pipgmService = pipgmService;
  (app as unknown as { effectsStore: EffectsStore }).effectsStore = effectsStore;
  (app as unknown as { captureSupervisor: StreamSupervisor }).captureSupervisor = captureSupervisor;

  // =========================================================================
  // Operator Frontend UI Routes (Built with Vite in @pimatrix/web)
  // =========================================================================

  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const asset = resolveWebAssetFile(request.params["*"]);
    if (!asset) {
      return reply.code(404).send({
        error: { code: "ASSET_NOT_FOUND", message: `Unknown frontend asset: ${request.url}` }
      });
    }
    return reply.type(asset.contentType).send(fs.readFileSync(asset.filePath));
  });

  app.get("/", async (request, reply) => {
    const html = await renderFrontendPage("outputs", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/outputs", async (request, reply) => {
    const html = await renderFrontendPage("outputs", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/inputs", async (request, reply) => {
    const html = await renderFrontendPage("inputs", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/cameras", async (request, reply) => {
    const html = await renderFrontendPage("cameras", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/renderer", async (request, reply) => {
    const html = await renderFrontendPage("renderer", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/pipgm", async (request, reply) => {
    const html = await renderFrontendPage("renderer", request);
    return reply.type("text/html; charset=utf-8").send(html);
  });

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

  app.get("/api/v1/status", async () => {
    const visibleSources = await listSources(false);
    return {
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
      counts: {
        sources: visibleSources.length,
        outputs: outputStore.list().length,
        cameras: cameraService.list().length,
        pipgmPipelines: pipgmService.listPipelines(true).length
      }
    };
  });

  app.get<{ Querystring: { includeHidden?: string } }>("/api/v1/sources", async (request) => {
    const includeHidden = request.query?.includeHidden === "true";
    const items = await listSources(includeHidden);
    return {
      items: items.map(({ id, label, kind, state, preview }) => ({
        id,
        label,
        kind,
        state,
        preview
      }))
    };
  });

  app.get<{ Params: { sourceId: string } }>("/api/v1/sources/:sourceId", async (request, reply) => {
    const source = (await listSources(true)).find((item) => item.id === request.params.sourceId);
    if (!source) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }
    return {
      id: source.id,
      label: source.label,
      kind: source.kind,
      state: source.state,
      preview: source.preview
    };
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
      const isValidLogicalSource =
        requestedSource === "multiview" ||
        (typeof requestedSource === "string" &&
          sourceDefinitions.some((source) => source.id === requestedSource));

      if (requestedSource !== null && !isValidLogicalSource) {
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

  // Network Stream Out (RTSP) assignment & stream control endpoints
  app.get("/api/v1/outputs/rtsp", async () => rtspOutState);

  app.put<{
    Body: {
      sourceId?: unknown;
      layout?: unknown;
      quality?: unknown;
      resolution?: unknown;
      bitrateKbps?: unknown;
    };
  }>("/api/v1/outputs/rtsp/source", async (request, reply) => {
    if (!Object.prototype.hasOwnProperty.call(request.body ?? {}, "sourceId")) {
      return reply.code(422).send({
        error: { code: "SOURCE_REQUIRED", message: "Request body must include sourceId (or null to clear)" }
      });
    }
    const requestedSource = request.body.sourceId;
    const isValidLogicalSource =
      requestedSource === "multiview" ||
      (typeof requestedSource === "string" &&
        sourceDefinitions.some((source) => source.id === requestedSource));

    if (requestedSource !== null && !isValidLogicalSource) {
      return reply.code(422).send({
        error: { code: "INVALID_SOURCE", message: "sourceId must be a known logical source ID, 'multiview', or null" }
      });
    }

    const layoutRaw = request.body?.layout;
    if (
      layoutRaw !== undefined &&
      layoutRaw !== "landscape" &&
      layoutRaw !== "portrait"
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_LAYOUT", message: "layout must be 'landscape' or 'portrait'" }
      });
    }

    const qualityRaw = request.body?.quality;
    if (qualityRaw !== undefined && qualityRaw !== "preview" && qualityRaw !== "full") {
      return reply.code(422).send({
        error: { code: "INVALID_QUALITY", message: "quality must be 'preview' or 'full'" }
      });
    }

    const resolutionRaw = request.body?.resolution;
    if (resolutionRaw !== undefined && typeof resolutionRaw !== "string") {
      return reply.code(422).send({
        error: { code: "INVALID_RESOLUTION", message: "resolution must be a string (e.g. '1920x1080' or '640x360')" }
      });
    }

    const bitrateRaw = request.body?.bitrateKbps !== undefined ? Number(request.body.bitrateKbps) : undefined;
    if (bitrateRaw !== undefined && (!Number.isFinite(bitrateRaw) || bitrateRaw < 100 || bitrateRaw > 50000)) {
      return reply.code(422).send({
        error: { code: "INVALID_BITRATE", message: "bitrateKbps must be between 100 and 50000" }
      });
    }

    rtspOutState = {
      ...rtspOutState,
      sourceId: (requestedSource as string | null) ?? "rtmp1",
      ...(layoutRaw !== undefined ? { layout: layoutRaw } : {}),
      ...(qualityRaw !== undefined ? { quality: qualityRaw } : {}),
      ...(resolutionRaw !== undefined ? { resolution: resolutionRaw } : {}),
      ...(bitrateRaw !== undefined ? { bitrateKbps: bitrateRaw } : {})
    };

    eventBroker.emit({
      type: "rtsp",
      data: { ...rtspOutState }
    });

    return reply.code(200).send(rtspOutState);
  });

  app.post<{ Body: { streaming?: unknown; toggle?: unknown } }>(
    "/api/v1/outputs/rtsp/stream",
    async (request, reply) => {
      const body = request.body ?? {};
      if (body.streaming !== undefined && typeof body.streaming !== "boolean") {
        return reply.code(422).send({
          error: { code: "INVALID_STREAMING_VALUE", message: "streaming must be a boolean" }
        });
      }
      if (body.toggle !== undefined && typeof body.toggle !== "boolean") {
        return reply.code(422).send({
          error: { code: "INVALID_TOGGLE_VALUE", message: "toggle must be a boolean" }
        });
      }

      const nextStreaming =
        typeof body.streaming === "boolean"
          ? body.streaming
          : body.toggle === true
            ? !rtspOutState.streaming
            : !rtspOutState.streaming;

      rtspOutState = {
        ...rtspOutState,
        streaming: nextStreaming
      };

      eventBroker.emit({
        type: "rtsp",
        data: { ...rtspOutState }
      });

      return reply.code(200).send(rtspOutState);
    }
  );

  app.get("/multiview", async (_request, reply) => {
    const mv = await buildCurrentMultiview();
    const html = renderMultiviewHtml(mv, config.previewBaseUrl, effectsStore.list());
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get("/api/v1/outputs/multiview", async () => {
    return buildCurrentMultiview();
  });

  app.put<{ Body: { layout?: unknown } }>(
    "/api/v1/outputs/multiview/layout",
    async (request, reply) => {
      const layout = String(request.body?.layout ?? "");
      if (!["auto", "landscape", "portrait"].includes(layout)) {
        return reply.code(422).send({
          error: { code: "INVALID_LAYOUT", message: "layout must be 'auto', 'landscape', or 'portrait'" }
        });
      }
      multiviewLayout = layout as MultiviewLayoutMode;
      return buildCurrentMultiview();
    }
  );

  app.put<{
    Body: { slotIndex?: unknown; replaceSourceId?: unknown; sourceId?: unknown };
  }>("/api/v1/outputs/multiview/slot", async (request, reply) => {
    const body = request.body ?? {};
    const requestedSource = body.sourceId;

    if (
      requestedSource !== null &&
      (typeof requestedSource !== "string" ||
        !sourceDefinitions.some((s) => s.id === requestedSource))
    ) {
      return reply.code(422).send({
        error: {
          code: "INVALID_SOURCE",
          message: "sourceId must be a valid SourceId (e.g. PiPGM3) or null to reset slot"
        }
      });
    }

    let slotIdx = -1;
    if (body.slotIndex !== undefined) {
      const parsedIdx = Number(body.slotIndex);
      if (!Number.isInteger(parsedIdx) || parsedIdx < 0 || parsedIdx > 7) {
        return reply.code(422).send({
          error: { code: "INVALID_SLOT_INDEX", message: "slotIndex must be an integer between 0 and 7" }
        });
      }
      slotIdx = parsedIdx;
    } else if (typeof body.replaceSourceId === "string") {
      slotIdx = multiviewSourceOrder.indexOf(body.replaceSourceId as SourceId);
      if (slotIdx < 0) {
        return reply.code(422).send({
          error: {
            code: "INVALID_REPLACE_SOURCE",
            message: `Source ${body.replaceSourceId} is not one of the 8 default multiview slots`
          }
        });
      }
    } else {
      return reply.code(422).send({
        error: {
          code: "SLOT_TARGET_REQUIRED",
          message: "Provide either slotIndex (0-7) or replaceSourceId (e.g. 'cam3')"
        }
      });
    }

    if (requestedSource === null) {
      multiviewSlotOverrides.delete(slotIdx);
    } else {
      multiviewSlotOverrides.set(slotIdx, requestedSource as SourceId);
    }

    return reply.code(200).send(await buildCurrentMultiview());
  });

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

  // =========================================================================
  // Atlona Matrix State, Safety Lock, and Crosspoint Routing
  // =========================================================================

  app.get("/api/v1/matrix", async () => matrixState);

  app.put<{ Body: { locked?: unknown } }>("/api/v1/matrix/lock", async (request, reply) => {
    if (typeof request.body?.locked !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_LOCK_STATE", message: "locked must be a boolean" }
      });
    }
    matrixState.locked = request.body.locked;
    eventBroker.emit({
      type: "matrix",
      data: {
        locked: matrixState.locked,
        routes: { ...matrixState.routes }
      }
    });
    return reply.code(200).send(matrixState);
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
        const amxStatus = await amxClient.getStatus();
        let result;
        if (config.mode === "simulation" && amxStatus === "not-configured") {
          result = {
            requestId: `sim-${Date.now()}`,
            success: true,
            input,
            output,
            confirmed: true,
            message: "Simulated Atlona route confirmed"
          };
        } else {
          result = await amxClient.routeMatrix(input, output);
        }

        if (!result.success) {
          return reply.code(502).send({
            error: { code: "AMX_ROUTE_FAILED", message: result.message ?? "AMX request was not accepted" }
          });
        }

        matrixState.routes[output] = input;
        eventBroker.emit({
          type: "matrix",
          data: {
            locked: matrixState.locked,
            routes: { ...matrixState.routes },
            lastChange: { input, output }
          }
        });

        return reply.code(200).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "AMX request failed";
        return reply.code(502).send({
          error: { code: "AMX_UNAVAILABLE", message }
        });
      }
    }
  );

  // =========================================================================
  // PiPGM Multi-Format Renderers & Control Endpoints
  // =========================================================================

  app.get<{ Params: { pipelineId: string } }>("/pipgm/:pipelineId/stage", async (request, reply) => {
    const pipeline = pipgmService.getPipeline(request.params.pipelineId);
    if (!pipeline) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }
    const html = renderPiPgmStageHtml(pipeline);
    return reply.type("text/html; charset=utf-8").send(html);
  });

  app.get<{ Querystring: { includeHidden?: string } }>("/api/v1/pipgm/pipelines", async (request) => {
    const includeHidden = request.query?.includeHidden !== "false";
    return { items: pipgmService.listPipelines(includeHidden) };
  });

  app.get<{ Params: { pipelineId: string } }>("/api/v1/pipgm/pipelines/:pipelineId", async (request, reply) => {
    const pipeline = pipgmService.getPipeline(request.params.pipelineId);
    if (!pipeline) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }
    return reply.code(200).send(pipeline);
  });

  app.put<{
    Params: { pipelineId: string };
    Body: {
      orientation?: unknown;
      hidden?: unknown;
      linked?: unknown;
      fadeDurationMs?: unknown;
    };
  }>("/api/v1/pipgm/pipelines/:pipelineId/config", async (request, reply) => {
    if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }

    const body = request.body ?? {};
    if (body.orientation !== undefined && body.orientation !== "landscape" && body.orientation !== "portrait") {
      return reply.code(422).send({
        error: { code: "INVALID_ORIENTATION", message: "orientation must be 'landscape' or 'portrait'" }
      });
    }
    if (body.hidden !== undefined && typeof body.hidden !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_HIDDEN", message: "hidden must be a boolean" }
      });
    }
    if (body.linked !== undefined && typeof body.linked !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_LINKED", message: "linked must be a boolean" }
      });
    }
    if (
      body.fadeDurationMs !== undefined &&
      (typeof body.fadeDurationMs !== "number" ||
        !Number.isFinite(body.fadeDurationMs) ||
        body.fadeDurationMs < 0 ||
        body.fadeDurationMs > 10000)
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_FADE_DURATION", message: "fadeDurationMs must be between 0 and 10000" }
      });
    }

    const updated = pipgmService.updatePipelineConfig(request.params.pipelineId, {
      ...(body.orientation !== undefined ? { orientation: body.orientation as PiPgmOrientation } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
      ...(body.linked !== undefined ? { linked: body.linked } : {}),
      ...(body.fadeDurationMs !== undefined ? { fadeDurationMs: body.fadeDurationMs } : {})
    });

    return reply.code(200).send(updated);
  });

  const validControlActions = new Set<PiPgmControlAction>([
    "next",
    "prev",
    "gotoStep",
    "gotoItem",
    "play",
    "pause",
    "stop",
    "restart"
  ]);

  app.post<{
    Params: { pipelineId: string };
    Body: {
      action?: unknown;
      stepIndex?: unknown;
      itemId?: unknown;
      itemIndex?: unknown;
      advanceItemOnEnd?: unknown;
      sync?: unknown;
    };
  }>("/api/v1/pipgm/pipelines/:pipelineId/control", async (request, reply) => {
    if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }

    const action = String(request.body?.action ?? "") as PiPgmControlAction;
    if (!validControlActions.has(action)) {
      return reply.code(422).send({
        error: {
          code: "INVALID_CONTROL_ACTION",
          message: `action must be one of: ${[...validControlActions].join(", ")}`
        }
      });
    }

    const stepIndex = request.body?.stepIndex !== undefined ? Number(request.body.stepIndex) : undefined;
    if (stepIndex !== undefined && (!Number.isInteger(stepIndex) || stepIndex < 0)) {
      return reply.code(422).send({
        error: { code: "INVALID_STEP_INDEX", message: "stepIndex must be a non-negative integer" }
      });
    }

    const itemIndex = request.body?.itemIndex !== undefined ? Number(request.body.itemIndex) : undefined;
    if (itemIndex !== undefined && (!Number.isInteger(itemIndex) || itemIndex < 0)) {
      return reply.code(422).send({
        error: { code: "INVALID_ITEM_INDEX", message: "itemIndex must be a non-negative integer" }
      });
    }

    const updated = pipgmService.control(request.params.pipelineId, {
      action,
      ...(stepIndex !== undefined ? { stepIndex } : {}),
      ...(typeof request.body?.itemId === "string" ? { itemId: request.body.itemId } : {}),
      ...(itemIndex !== undefined ? { itemIndex } : {}),
      ...(typeof request.body?.advanceItemOnEnd === "boolean"
        ? { advanceItemOnEnd: request.body.advanceItemOnEnd }
        : {}),
      ...(typeof request.body?.sync === "boolean" ? { sync: request.body.sync } : {})
    });

    return reply.code(200).send(updated);
  });

  app.post<{
    Params: { pipelineId: string };
    Body: { fadeToBlack?: unknown; toggle?: unknown; durationMs?: unknown; sync?: unknown };
  }>("/api/v1/pipgm/pipelines/:pipelineId/ftb", async (request, reply) => {
    if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }

    const body = request.body ?? {};
    if (body.fadeToBlack !== undefined && typeof body.fadeToBlack !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_FTB_VALUE", message: "fadeToBlack must be a boolean" }
      });
    }

    const durationMs = body.durationMs !== undefined ? Number(body.durationMs) : undefined;
    if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 10000)) {
      return reply.code(422).send({
        error: { code: "INVALID_FADE_DURATION", message: "durationMs must be between 0 and 10000" }
      });
    }

    const updated = pipgmService.setFadeToBlack(request.params.pipelineId, {
      ...(typeof body.fadeToBlack === "boolean" ? { fadeToBlack: body.fadeToBlack } : {}),
      ...(typeof body.toggle === "boolean" ? { toggle: body.toggle } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(typeof body.sync === "boolean" ? { sync: body.sync } : {})
    });

    if (updated) {
      const fx = effectsStore.setFadeToBlack(request.params.pipelineId as SourceId, {
        fadeToBlack: updated.fadeToBlack
      });
      if (fx) {
        eventBroker.emit({
          type: "effects",
          data: { sourceId: request.params.pipelineId as SourceId, effects: fx }
        });
      }
    }

    return reply.code(200).send(updated);
  });

  app.post<{
    Params: { pipelineId: string };
    Body: { audioEnabled?: unknown; toggle?: unknown; volume?: unknown; sync?: unknown };
  }>("/api/v1/pipgm/pipelines/:pipelineId/audio", async (request, reply) => {
    if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }

    const body = request.body ?? {};
    if (body.audioEnabled !== undefined && typeof body.audioEnabled !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_AUDIO_VALUE", message: "audioEnabled must be a boolean" }
      });
    }

    const volume = body.volume !== undefined ? Number(body.volume) : undefined;
    if (volume !== undefined && (!Number.isFinite(volume) || volume < 0 || volume > 100)) {
      return reply.code(422).send({
        error: { code: "INVALID_VOLUME", message: "volume must be between 0 and 100" }
      });
    }

    const updated = pipgmService.setAudio(request.params.pipelineId, {
      ...(typeof body.audioEnabled === "boolean" ? { audioEnabled: body.audioEnabled } : {}),
      ...(typeof body.toggle === "boolean" ? { toggle: body.toggle } : {}),
      ...(volume !== undefined ? { volume } : {}),
      ...(typeof body.sync === "boolean" ? { sync: body.sync } : {})
    });

    if (updated) {
      const fx = effectsStore.setMuted(request.params.pipelineId as SourceId, {
        muted: !updated.audioEnabled
      });
      if (fx) {
        eventBroker.emit({
          type: "effects",
          data: { sourceId: request.params.pipelineId as SourceId, effects: fx }
        });
      }
    }

    return reply.code(200).send(updated);
  });

  app.post<{
    Params: { pipelineId: string };
    Body: { itemId?: unknown; cueImmediately?: unknown };
  }>("/api/v1/pipgm/pipelines/:pipelineId/playlist", async (request, reply) => {
    if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
      return reply.code(404).send({
        error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
      });
    }

    const itemId = typeof request.body?.itemId === "string" ? request.body.itemId.trim() : "";
    if (!itemId) {
      return reply.code(422).send({
        error: { code: "ITEM_ID_REQUIRED", message: "itemId is required" }
      });
    }

    const updated = pipgmService.addItemToPipeline(
      request.params.pipelineId,
      itemId,
      request.body?.cueImmediately === true
    );
    if (!updated) {
      return reply.code(404).send({
        error: { code: "ITEM_NOT_FOUND", message: `Unknown PiPGM item: ${itemId}` }
      });
    }

    return reply.code(200).send(updated);
  });

  app.delete<{ Params: { pipelineId: string; itemId: string } }>(
    "/api/v1/pipgm/pipelines/:pipelineId/playlist/:itemId",
    async (request, reply) => {
      if (!pipgmService.isValidPipelineId(request.params.pipelineId)) {
        return reply.code(404).send({
          error: { code: "PIPELINE_NOT_FOUND", message: `Unknown PiPGM pipeline: ${request.params.pipelineId}` }
        });
      }

      const updated = pipgmService.removeItemFromPipeline(request.params.pipelineId, request.params.itemId);
      return reply.code(200).send(updated);
    }
  );

  // Shared Library & Format-Specific Item Creation
  app.get("/api/v1/pipgm/items", async () => ({
    items: pipgmService.listLibraryItems()
  }));

  app.get<{ Params: { itemId: string } }>("/api/v1/pipgm/items/:itemId", async (request, reply) => {
    const item = pipgmService.getLibraryItem(request.params.itemId);
    if (!item) {
      return reply.code(404).send({
        error: { code: "ITEM_NOT_FOUND", message: `Unknown PiPGM item: ${request.params.itemId}` }
      });
    }
    return reply.code(200).send(item);
  });

  app.post<{
    Body: {
      title?: unknown;
      hymnNumber?: unknown;
      includeTitleSlide?: unknown;
      stanzas?: unknown;
      rawText?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
    };
  }>("/api/v1/pipgm/items/hymn", async (request, reply) => {
    const body = request.body ?? {};
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return reply.code(422).send({
        error: { code: "TITLE_REQUIRED", message: "Hymn title is required" }
      });
    }

    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const stanzasInput = Array.isArray(body.stanzas)
      ? (body.stanzas as Array<{ stanzaNumber?: string | number; lines: string[]; refrain?: boolean }>)
      : undefined;

    const item = pipgmService.createHymnItem({
      title,
      ...(typeof body.hymnNumber === "string" ? { hymnNumber: body.hymnNumber } : {}),
      ...(typeof body.includeTitleSlide === "boolean" ? { includeTitleSlide: body.includeTitleSlide } : {}),
      ...(stanzasInput ? { stanzas: stanzasInput } : {}),
      ...(typeof body.rawText === "string" ? { rawText: body.rawText } : {}),
      ...(typeof body.targetPipelineId === "string"
        ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
        : {}),
      ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {})
    });

    return reply.code(201).send(item);
  });

  app.post<{
    Body: {
      title?: unknown;
      urlOrId?: unknown;
      startSeconds?: unknown;
      endSeconds?: unknown;
      autoplay?: unknown;
      loop?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
    };
  }>("/api/v1/pipgm/items/youtube", async (request, reply) => {
    const body = request.body ?? {};
    const urlOrId = typeof body.urlOrId === "string" ? body.urlOrId.trim() : "";
    if (!urlOrId) {
      return reply.code(422).send({
        error: { code: "YOUTUBE_URL_REQUIRED", message: "urlOrId is required" }
      });
    }

    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const item = pipgmService.createYouTubeItem({
      urlOrId,
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.startSeconds === "number" ? { startSeconds: body.startSeconds } : {}),
      ...(typeof body.endSeconds === "number" ? { endSeconds: body.endSeconds } : {}),
      ...(typeof body.autoplay === "boolean" ? { autoplay: body.autoplay } : {}),
      ...(typeof body.loop === "boolean" ? { loop: body.loop } : {}),
      ...(typeof body.targetPipelineId === "string"
        ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
        : {}),
      ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {})
    });

    if (!item) {
      return reply.code(422).send({
        error: { code: "INVALID_YOUTUBE_URL", message: "Could not extract a valid 11-character YouTube video ID" }
      });
    }

    return reply.code(201).send(item);
  });

  app.post<{
    Body: {
      kind?: unknown;
      title?: unknown;
      filename?: unknown;
      mimeType?: unknown;
      dataBase64?: unknown;
      fit?: unknown;
      caption?: unknown;
      durationMs?: unknown;
      autoplay?: unknown;
      loop?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
    };
  }>("/api/v1/pipgm/items/media", async (request, reply) => {
    const body = request.body ?? {};
    const kind = body.kind;
    if (kind !== "video" && kind !== "image") {
      return reply.code(422).send({
        error: { code: "INVALID_MEDIA_KIND", message: "kind must be 'video' or 'image'" }
      });
    }

    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    if (!filename) {
      return reply.code(422).send({
        error: { code: "FILENAME_REQUIRED", message: "filename is required" }
      });
    }

    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const item = pipgmService.createUploadedMediaItem({
      kind,
      filename,
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.mimeType === "string" ? { mimeType: body.mimeType } : {}),
      ...(typeof body.dataBase64 === "string" ? { dataBase64: body.dataBase64 } : {}),
      ...(body.fit === "contain" || body.fit === "cover" ? { fit: body.fit } : {}),
      ...(typeof body.caption === "string" ? { caption: body.caption } : {}),
      ...(typeof body.durationMs === "number" ? { durationMs: body.durationMs } : {}),
      ...(typeof body.autoplay === "boolean" ? { autoplay: body.autoplay } : {}),
      ...(typeof body.loop === "boolean" ? { loop: body.loop } : {}),
      ...(typeof body.targetPipelineId === "string"
        ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
        : {}),
      ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {})
    });

    return reply.code(201).send(item);
  });

  app.post<{
    Body: {
      title?: unknown;
      filename?: unknown;
      dataBase64?: unknown;
      animateBulletsByDefault?: unknown;
      slides?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
    };
  }>("/api/v1/pipgm/items/pptx", async (request, reply) => {
    const body = request.body ?? {};
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    if (!filename) {
      return reply.code(422).send({
        error: { code: "FILENAME_REQUIRED", message: "filename is required for .pptx upload" }
      });
    }

    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const slidesInput = Array.isArray(body.slides)
      ? (body.slides as Array<{
          slideNumber?: number;
          title: string;
          bullets?: string[];
          notes?: string;
          builds?: Array<{ effect?: PptxAnimationEffect; targetText?: string; durationMs?: number }>;
        }>)
      : undefined;

    const item = pipgmService.createPptxItem({
      filename,
      ...(typeof body.title === "string" ? { title: body.title } : {}),
      ...(typeof body.dataBase64 === "string" ? { dataBase64: body.dataBase64 } : {}),
      ...(typeof body.animateBulletsByDefault === "boolean"
        ? { animateBulletsByDefault: body.animateBulletsByDefault }
        : {}),
      ...(slidesInput ? { slides: slidesInput } : {}),
      ...(typeof body.targetPipelineId === "string"
        ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
        : {}),
      ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {})
    });

    return reply.code(201).send(item);
  });

  app.post<{
    Body: {
      designId?: unknown;
      title?: unknown;
      embedUrl?: unknown;
      viewUrl?: unknown;
      editUrl?: unknown;
      pageCount?: unknown;
      pages?: unknown;
      exportUrls?: unknown;
      exportFormat?: unknown;
      mode?: unknown;
      autoExport?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
      orientation?: unknown;
    };
  }>("/api/v1/pipgm/items/canva", async (request, reply) => {
    const body = request.body ?? {};
    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const item = await pipgmService.createOrPushCanvaItem(
      {
        ...(typeof body.designId === "string" ? { designId: body.designId } : {}),
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.embedUrl === "string" ? { embedUrl: body.embedUrl } : {}),
        ...(typeof body.viewUrl === "string" ? { viewUrl: body.viewUrl } : {}),
        ...(typeof body.editUrl === "string" ? { editUrl: body.editUrl } : {}),
        ...(typeof body.pageCount === "number" ? { pageCount: body.pageCount } : {}),
        ...(Array.isArray(body.pages) ? { pages: body.pages as never } : {}),
        ...(Array.isArray(body.exportUrls) ? { exportUrls: body.exportUrls as string[] } : {}),
        ...(body.exportFormat === "mp4" || body.exportFormat === "png"
          ? { exportFormat: body.exportFormat }
          : {}),
        ...(body.mode === "embed" || body.mode === "exported_mp4" || body.mode === "exported_slides"
          ? { mode: body.mode }
          : {}),
        ...(typeof body.autoExport === "boolean" ? { autoExport: body.autoExport } : {}),
        ...(typeof body.targetPipelineId === "string"
          ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
          : {}),
        ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {}),
        ...(body.orientation === "landscape" || body.orientation === "portrait"
          ? { orientation: body.orientation }
          : {})
      },
      false
    );

    if (!item) {
      return reply.code(422).send({
        error: { code: "INVALID_CANVA_DESIGN", message: "Valid Canva designId or embedUrl/viewUrl is required" }
      });
    }

    return reply.code(201).send(item);
  });

  // CORS preflight for the Canva App plugin running inside Canva's editor iframe

  app.options("/api/v1/pipgm/canva/control", async (_request, reply) => {
    return reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Access-Control-Allow-Methods", "POST, OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
      .code(204)
      .send();
  });

  app.post<{
    Body: {
      designId?: unknown;
      targetPipelineId?: unknown;
      action?: unknown;
      pageNumber?: unknown;
      stepIndex?: unknown;
      fadeToBlack?: unknown;
      ftbToggle?: unknown;
      audioEnabled?: unknown;
      muteToggle?: unknown;
      mode?: unknown;
      sync?: unknown;
    };
  }>("/api/v1/pipgm/canva/control", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const body = request.body ?? {};

    const validActions = new Set([
      "next",
      "prev",
      "gotoPage",
      "gotoStep",
      "ftb",
      "mute",
      "play",
      "pause",
      "stop",
      "restart",
      "mode"
    ]);

    if (typeof body.action !== "string" || !validActions.has(body.action)) {
      return reply.code(422).send({
        error: {
          code: "INVALID_CANVA_CONTROL_ACTION",
          message: "action must be one of: next, prev, gotoPage, gotoStep, ftb, mute, play, pause, stop, restart, mode"
        }
      });
    }

    if (
      body.targetPipelineId !== undefined &&
      body.targetPipelineId !== "all" &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: {
          code: "INVALID_PIPELINE_ID",
          message: "targetPipelineId must be PiPGM1, PiPGM2, PiPGM3, or all"
        }
      });
    }

    const result = pipgmService.controlCanvaPresentation({
      action: body.action as never,
      ...(typeof body.designId === "string" ? { designId: body.designId } : {}),
      ...(typeof body.targetPipelineId === "string" ? { targetPipelineId: body.targetPipelineId } : {}),
      ...(typeof body.pageNumber === "number" ? { pageNumber: body.pageNumber } : {}),
      ...(typeof body.stepIndex === "number" ? { stepIndex: body.stepIndex } : {}),
      ...(typeof body.fadeToBlack === "boolean" ? { fadeToBlack: body.fadeToBlack } : {}),
      ...(typeof body.ftbToggle === "boolean" ? { ftbToggle: body.ftbToggle } : {}),
      ...(typeof body.audioEnabled === "boolean" ? { audioEnabled: body.audioEnabled } : {}),
      ...(typeof body.muteToggle === "boolean" ? { muteToggle: body.muteToggle } : {}),
      ...(body.mode === "embed" || body.mode === "exported_mp4" || body.mode === "exported_slides" ? { mode: body.mode } : {}),
      ...(typeof body.sync === "boolean" ? { sync: body.sync } : {})
    });

    return reply.code(200).send(result);
  });

  app.options("/api/v1/pipgm/canva/push", async (_request, reply) => {
    return reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Access-Control-Allow-Methods", "POST, OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type, Authorization")
      .code(204)
      .send();
  });

  app.post<{
    Body: {
      designId?: unknown;
      title?: unknown;
      embedUrl?: unknown;
      viewUrl?: unknown;
      editUrl?: unknown;
      pageCount?: unknown;
      pages?: unknown;
      exportUrls?: unknown;
      exportFormat?: unknown;
      mode?: unknown;
      autoExport?: unknown;
      targetPipelineId?: unknown;
      cueImmediately?: unknown;
      orientation?: unknown;
    };
  }>("/api/v1/pipgm/canva/push", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const body = request.body ?? {};

    if (
      body.targetPipelineId !== undefined &&
      (typeof body.targetPipelineId !== "string" || !pipgmService.isValidPipelineId(body.targetPipelineId))
    ) {
      return reply.code(422).send({
        error: { code: "INVALID_PIPELINE_ID", message: "targetPipelineId must be PiPGM1, PiPGM2, or PiPGM3" }
      });
    }

    const item = await pipgmService.createOrPushCanvaItem(
      {
        ...(typeof body.designId === "string" ? { designId: body.designId } : {}),
        ...(typeof body.title === "string" ? { title: body.title } : {}),
        ...(typeof body.embedUrl === "string" ? { embedUrl: body.embedUrl } : {}),
        ...(typeof body.viewUrl === "string" ? { viewUrl: body.viewUrl } : {}),
        ...(typeof body.editUrl === "string" ? { editUrl: body.editUrl } : {}),
        ...(typeof body.pageCount === "number" ? { pageCount: body.pageCount } : {}),
        ...(Array.isArray(body.pages) ? { pages: body.pages as never } : {}),
        ...(Array.isArray(body.exportUrls) ? { exportUrls: body.exportUrls as string[] } : {}),
        ...(body.exportFormat === "mp4" || body.exportFormat === "png"
          ? { exportFormat: body.exportFormat }
          : {}),
        ...(body.mode === "embed" || body.mode === "exported_mp4" || body.mode === "exported_slides"
          ? { mode: body.mode }
          : {}),
        ...(typeof body.autoExport === "boolean" ? { autoExport: body.autoExport } : {}),
        ...(typeof body.targetPipelineId === "string"
          ? { targetPipelineId: body.targetPipelineId as PiPgmPipelineId }
          : {}),
        ...(typeof body.cueImmediately === "boolean" ? { cueImmediately: body.cueImmediately } : {}),
        ...(body.orientation === "landscape" || body.orientation === "portrait"
          ? { orientation: body.orientation }
          : {})
      },
      true
    );

    if (!item) {
      return reply.code(422).send({
        error: { code: "INVALID_CANVA_DESIGN", message: "Valid Canva designId or embedUrl/viewUrl is required" }
      });
    }

    const targetPipeline =
      typeof body.targetPipelineId === "string"
        ? pipgmService.getPipeline(body.targetPipelineId) ?? null
        : null;

    return reply.code(201).send({
      accepted: true,
      item,
      pipeline: targetPipeline
    });
  });

  app.post<{
    Params: { itemId: string };
    Body: { format?: unknown; orientation?: unknown; switchToExportedMode?: unknown };
  }>("/api/v1/pipgm/items/:itemId/canva/export", async (request, reply) => {
    const body = request.body ?? {};
    const format = body.format === undefined ? "mp4" : body.format;
    if (format !== "mp4" && format !== "png") {
      return reply.code(422).send({
        error: { code: "INVALID_EXPORT_FORMAT", message: "format must be 'mp4' or 'png'" }
      });
    }

    const orientation =
      body.orientation === "portrait" || body.orientation === "landscape"
        ? body.orientation
        : "landscape";

    const updated = await pipgmService.exportCanvaItem(request.params.itemId, {
      format,
      orientation,
      ...(typeof body.switchToExportedMode === "boolean"
        ? { switchToExportedMode: body.switchToExportedMode }
        : {})
    });

    if (!updated) {
      return reply.code(404).send({
        error: { code: "CANVA_ITEM_NOT_FOUND", message: `Canva item not found: ${request.params.itemId}` }
      });
    }

    return reply.code(200).send(updated);
  });

  app.get<{ Params: { assetId: string } }>("/api/v1/pipgm/assets/:assetId", async (request, reply) => {
    const asset = pipgmService.getAsset(request.params.assetId);
    if (!asset) {
      return reply.code(404).send({
        error: { code: "ASSET_NOT_FOUND", message: `Unknown asset ID: ${request.params.assetId}` }
      });
    }
    return reply
      .header("Content-Type", asset.mimeType)
      .header("Content-Disposition", `inline; filename="${asset.filename.replace(/"/g, "")}"`)
      .send(asset.data ?? Buffer.alloc(0));
  });

  // Cameras
  app.get("/api/v1/cameras", async () => ({ items: cameraService.list() }));

  app.get<{ Params: { cameraId: string } }>("/api/v1/cameras/:cameraId", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }
    return reply.code(200).send(camera);
  });

  const validDirections = new Set([
    "up",
    "down",
    "left",
    "right",
    "upleft",
    "upright",
    "downleft",
    "downright",
    "stop",
    "home",
    "reset"
  ]);

  app.post<{
    Params: { cameraId: string };
    Body: { direction?: unknown; panSpeed?: unknown; tiltSpeed?: unknown };
  }>("/api/v1/cameras/:cameraId/move", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }

    const direction = String(request.body?.direction ?? "");
    if (!validDirections.has(direction)) {
      return reply.code(422).send({
        error: {
          code: "INVALID_DIRECTION",
          message: `direction must be one of: ${[...validDirections].join(", ")}`
        }
      });
    }

    const panSpeed = request.body?.panSpeed !== undefined ? Number(request.body.panSpeed) : undefined;
    if (panSpeed !== undefined && (!Number.isInteger(panSpeed) || panSpeed < 1 || panSpeed > 24)) {
      return reply.code(422).send({
        error: { code: "INVALID_PAN_SPEED", message: "panSpeed must be an integer between 1 and 24" }
      });
    }

    const tiltSpeed = request.body?.tiltSpeed !== undefined ? Number(request.body.tiltSpeed) : undefined;
    if (tiltSpeed !== undefined && (!Number.isInteger(tiltSpeed) || tiltSpeed < 1 || tiltSpeed > 23)) {
      return reply.code(422).send({
        error: { code: "INVALID_TILT_SPEED", message: "tiltSpeed must be an integer between 1 and 23" }
      });
    }

    await cameraService.move(
      request.params.cameraId,
      direction as PanTiltDirection,
      panSpeed,
      tiltSpeed
    );

    return reply.code(200).send({
      cameraId: request.params.cameraId,
      success: true,
      action: `move:${direction}`
    });
  });

  const validZoomActions = new Set(["in", "out", "stop"]);

  app.post<{
    Params: { cameraId: string };
    Body: { action?: unknown; speed?: unknown };
  }>("/api/v1/cameras/:cameraId/zoom", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }

    const action = String(request.body?.action ?? "");
    if (!validZoomActions.has(action)) {
      return reply.code(422).send({
        error: { code: "INVALID_ZOOM_ACTION", message: "action must be 'in', 'out', or 'stop'" }
      });
    }

    const speed = request.body?.speed !== undefined ? Number(request.body.speed) : undefined;
    if (speed !== undefined && (!Number.isInteger(speed) || speed < 0 || speed > 7)) {
      return reply.code(422).send({
        error: { code: "INVALID_ZOOM_SPEED", message: "speed must be an integer between 0 and 7" }
      });
    }

    await cameraService.zoom(request.params.cameraId, action as ZoomAction, speed);

    return reply.code(200).send({
      cameraId: request.params.cameraId,
      success: true,
      action: `zoom:${action}`
    });
  });

  app.post<{ Params: { cameraId: string; presetId: string } }>(
    "/api/v1/cameras/:cameraId/presets/:presetId/recall",
    async (request, reply) => {
      const camera = cameraService.get(request.params.cameraId);
      if (!camera) {
        return reply.code(404).send({
          error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
        });
      }

      const presetId = Number(request.params.presetId);
      if (!Number.isInteger(presetId) || presetId < 0 || presetId > 254) {
        return reply.code(422).send({
          error: { code: "INVALID_PRESET_ID", message: "presetId must be an integer between 0 and 254" }
        });
      }

      await cameraService.recallPreset(request.params.cameraId, presetId);

      return reply.code(200).send({
        cameraId: request.params.cameraId,
        success: true,
        action: `preset:recall:${presetId}`
      });
    }
  );

  app.post<{
    Params: { cameraId: string; presetId: string };
    Body: { name?: unknown };
  }>("/api/v1/cameras/:cameraId/presets/:presetId/save", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }

    const presetId = Number(request.params.presetId);
    if (!Number.isInteger(presetId) || presetId < 0 || presetId > 254) {
      return reply.code(422).send({
        error: { code: "INVALID_PRESET_ID", message: "presetId must be an integer between 0 and 254" }
      });
    }

    const name = typeof request.body?.name === "string" ? request.body.name.trim() : undefined;

    await cameraService.savePreset(request.params.cameraId, presetId, name);

    return reply.code(200).send({
      cameraId: request.params.cameraId,
      success: true,
      action: `preset:save:${presetId}`
    });
  });

  app.post<{
    Params: { cameraId: string; presetId: string };
    Body: { thumbnail?: unknown };
  }>("/api/v1/cameras/:cameraId/presets/:presetId/thumbnail", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }

    const presetId = Number(request.params.presetId);
    if (!Number.isInteger(presetId) || presetId < 0 || presetId > 254) {
      return reply.code(422).send({
        error: { code: "INVALID_PRESET_ID", message: "presetId must be an integer between 0 and 254" }
      });
    }

    const thumbnail = typeof request.body?.thumbnail === "string" ? request.body.thumbnail.trim() : "";
    if (!thumbnail) {
      return reply.code(422).send({
        error: { code: "THUMBNAIL_REQUIRED", message: "thumbnail data URL or string is required" }
      });
    }

    const updated = await cameraService.savePresetThumbnail(request.params.cameraId, presetId, thumbnail);

    return reply.code(200).send({
      cameraId: request.params.cameraId,
      presetId,
      success: true,
      action: `preset:thumbnail:${presetId}`,
      camera: updated
    });
  });

  const validSmartFrameModes = new Set(["enable", "disable", "trigger"]);

  app.post<{
    Params: { cameraId: string };
    Body: { mode?: unknown };
  }>("/api/v1/cameras/:cameraId/smartframe", async (request, reply) => {
    const camera = cameraService.get(request.params.cameraId);
    if (!camera) {
      return reply.code(404).send({
        error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
      });
    }

    const mode = String(request.body?.mode ?? "");
    if (!validSmartFrameModes.has(mode)) {
      return reply.code(422).send({
        error: { code: "INVALID_SMARTFRAME_MODE", message: "mode must be 'enable', 'disable', or 'trigger'" }
      });
    }

    await cameraService.setSmartFrame(request.params.cameraId, mode as SmartFrameMode);

    return reply.code(200).send({
      cameraId: request.params.cameraId,
      success: true,
      action: `smartframe:${mode}`
    });
  });

  app.post<{ Params: { cameraId: string } }>(
    "/api/v1/cameras/:cameraId/stream/start",
    async (request, reply) => {
      const camera = cameraService.get(request.params.cameraId);
      if (!camera) {
        return reply.code(404).send({
          error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
        });
      }

      try {
        const { streamUrl } = await cameraService.startStream(request.params.cameraId);
        return reply.code(200).send({
          cameraId: request.params.cameraId,
          streaming: true,
          streamUrl,
          message: "Camera stream started"
        });
      } catch (err) {
        return sendCameraCgiError(reply, err);
      }
    }
  );

  app.post<{ Params: { cameraId: string } }>(
    "/api/v1/cameras/:cameraId/stream/stop",
    async (request, reply) => {
      const camera = cameraService.get(request.params.cameraId);
      if (!camera) {
        return reply.code(404).send({
          error: { code: "CAMERA_NOT_FOUND", message: `Unknown camera ID: ${request.params.cameraId}` }
        });
      }

      try {
        await cameraService.stopStream(request.params.cameraId);
      } catch (err) {
        return sendCameraCgiError(reply, err);
      }

      return reply.code(200).send({
        cameraId: request.params.cameraId,
        streaming: false,
        streamUrl: null,
        message: "Camera stream stopped"
      });
    }
  );

  // Effects Pipelines
  app.get<{ Querystring: { includeHidden?: string } }>("/api/v1/effects", async (request) => {
    const includeHidden = request.query?.includeHidden === "true";
    const items = effectsStore.list().filter((e) => {
      if (e.sourceId === "PiPGM3" && !includeHidden && pipgmService.isPipelineHidden("PiPGM3")) {
        return false;
      }
      return true;
    });
    return { items };
  });

  app.get<{ Params: { sourceId: string } }>("/api/v1/sources/:sourceId/effects", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }
    const effects = effectsStore.get(sourceId);
    return reply.code(200).send(effects);
  });

  const validAspectRatios = new Set(["16:9", "9:16", "16:10", "10:16", "4:3", "1:1", "free"]);

  app.put<{
    Params: { sourceId: string };
    Body: {
      enabled?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      sourceWidth?: unknown;
      sourceHeight?: unknown;
      aspectRatio?: unknown;
      lockedAspectRatio?: unknown;
    };
  }>("/api/v1/sources/:sourceId/effects/crop", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const body = request.body ?? {};
    const updates: Partial<CropSettings> = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_PROPERTY", message: "enabled must be a boolean" }
        });
      }
      updates.enabled = body.enabled;
    }

    if (body.x !== undefined) {
      const x = Number(body.x);
      if (!Number.isFinite(x) || x < 0) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "x must be a non-negative number" }
        });
      }
      updates.x = x;
    }

    if (body.y !== undefined) {
      const y = Number(body.y);
      if (!Number.isFinite(y) || y < 0) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "y must be a non-negative number" }
        });
      }
      updates.y = y;
    }

    if (body.width !== undefined) {
      const width = Number(body.width);
      if (!Number.isFinite(width) || width <= 0) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "width must be a positive number" }
        });
      }
      updates.width = width;
    }

    if (body.height !== undefined) {
      const height = Number(body.height);
      if (!Number.isFinite(height) || height <= 0) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "height must be a positive number" }
        });
      }
      updates.height = height;
    }

    if (body.sourceWidth !== undefined) {
      const sw = Number(body.sourceWidth);
      if (!Number.isFinite(sw) || sw < 16) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "sourceWidth must be a positive number >= 16" }
        });
      }
      updates.sourceWidth = sw;
    }

    if (body.sourceHeight !== undefined) {
      const sh = Number(body.sourceHeight);
      if (!Number.isFinite(sh) || sh < 16) {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_BOUNDS", message: "sourceHeight must be a positive number >= 16" }
        });
      }
      updates.sourceHeight = sh;
    }

    if (body.aspectRatio !== undefined) {
      const ar = String(body.aspectRatio);
      if (!validAspectRatios.has(ar)) {
        return reply.code(422).send({
          error: {
            code: "INVALID_ASPECT_RATIO",
            message: `aspectRatio must be one of: ${[...validAspectRatios].join(", ")}`
          }
        });
      }
      updates.aspectRatio = ar as AspectRatioPreset;
    }

    if (body.lockedAspectRatio !== undefined) {
      if (typeof body.lockedAspectRatio !== "boolean") {
        return reply.code(422).send({
          error: { code: "INVALID_CROP_PROPERTY", message: "lockedAspectRatio must be a boolean" }
        });
      }
      updates.lockedAspectRatio = body.lockedAspectRatio;
    }

    const updated = effectsStore.updateCrop(sourceId, updates);
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  const validPresets = new Set([
    "force-vertical-9-16",
    "force-vertical-10-16",
    "force-landscape-16-9",
    "force-landscape-16-10",
    "center",
    "reset"
  ]);

  app.post<{
    Params: { sourceId: string };
    Body: { preset?: unknown };
  }>("/api/v1/sources/:sourceId/effects/crop/preset", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const preset = String(request.body?.preset ?? "");
    if (!validPresets.has(preset)) {
      return reply.code(422).send({
        error: {
          code: "INVALID_PRESET",
          message: `preset must be one of: ${[...validPresets].join(", ")}`
        }
      });
    }

    const updated = effectsStore.applyPreset(sourceId, preset as CropPresetAction);
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  const validMoveDirections = new Set(["left", "right", "up", "down", "center"]);

  app.post<{
    Params: { sourceId: string };
    Body: { direction?: unknown; delta?: unknown };
  }>("/api/v1/sources/:sourceId/effects/crop/move", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const direction = String(request.body?.direction ?? "");
    if (!validMoveDirections.has(direction)) {
      return reply.code(422).send({
        error: {
          code: "INVALID_DIRECTION",
          message: `direction must be one of: ${[...validMoveDirections].join(", ")}`
        }
      });
    }

    const delta = request.body?.delta !== undefined ? Number(request.body.delta) : undefined;
    if (delta !== undefined && (!Number.isFinite(delta) || delta <= 0)) {
      return reply.code(422).send({
        error: { code: "INVALID_DELTA", message: "delta must be a positive number" }
      });
    }

    const updated = effectsStore.moveCrop(sourceId, direction as MoveDirection, delta);
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  const validResizeActions = new Set(["in", "out"]);

  app.post<{
    Params: { sourceId: string };
    Body: { action?: unknown; factor?: unknown };
  }>("/api/v1/sources/:sourceId/effects/crop/resize", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const action = String(request.body?.action ?? "");
    if (!validResizeActions.has(action)) {
      return reply.code(422).send({
        error: { code: "INVALID_ACTION", message: "action must be 'in' or 'out'" }
      });
    }

    const factor = request.body?.factor !== undefined ? Number(request.body.factor) : undefined;
    if (factor !== undefined && (!Number.isFinite(factor) || factor <= 0 || factor >= 1)) {
      return reply.code(422).send({
        error: { code: "INVALID_FACTOR", message: "factor must be a number between 0 and 1" }
      });
    }

    const updated = effectsStore.resizeCrop(sourceId, action as "in" | "out", factor);
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  const validRotations = new Set([0, 90, 180, 270]);

  app.post<{
    Params: { sourceId: string };
    Body: { rotation?: unknown };
  }>("/api/v1/sources/:sourceId/effects/rotation", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const rotation = Number(request.body?.rotation);
    if (!validRotations.has(rotation)) {
      return reply.code(422).send({
        error: { code: "INVALID_ROTATION", message: "rotation must be 0, 90, 180, or 270" }
      });
    }

    const updated = effectsStore.setRotation(sourceId, rotation as RotationDegrees);
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  // Input-specific Fade to Black (FTB) and Mute endpoints
  app.post<{
    Params: { sourceId: string };
    Body: { fadeToBlack?: unknown; toggle?: unknown; durationMs?: unknown; sync?: unknown };
  }>("/api/v1/sources/:sourceId/effects/ftb", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const body = request.body ?? {};
    if (body.fadeToBlack !== undefined && typeof body.fadeToBlack !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_FTB_VALUE", message: "fadeToBlack must be a boolean" }
      });
    }
    if (body.toggle !== undefined && typeof body.toggle !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_TOGGLE_VALUE", message: "toggle must be a boolean" }
      });
    }

    const current = effectsStore.get(sourceId);
    const nextFtb =
      typeof body.fadeToBlack === "boolean"
        ? body.fadeToBlack
        : body.toggle === true
          ? !(current?.fadeToBlack ?? false)
          : !(current?.fadeToBlack ?? false);

    const updated = effectsStore.setFadeToBlack(sourceId, { fadeToBlack: nextFtb });
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    if (pipgmService.isValidPipelineId(sourceId)) {
      pipgmService.setFadeToBlack(sourceId, {
        fadeToBlack: nextFtb,
        ...(typeof body.durationMs === "number" ? { durationMs: body.durationMs } : {}),
        ...(typeof body.sync === "boolean" ? { sync: body.sync } : {})
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    if (sourceId === "hama" && captureSupervisor.snapshot().state === "running") {
      void captureSupervisor.restart().catch(() => undefined);
    }

    return reply.code(200).send(updated);
  });

  app.post<{
    Params: { sourceId: string };
    Body: { muted?: unknown; toggle?: unknown; sync?: unknown };
  }>("/api/v1/sources/:sourceId/effects/mute", async (request, reply) => {
    const sourceId = request.params.sourceId as SourceId;
    if (!sourceDefinitions.some((s) => s.id === sourceId)) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    const body = request.body ?? {};
    if (body.muted !== undefined && typeof body.muted !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_MUTE_VALUE", message: "muted must be a boolean" }
      });
    }
    if (body.toggle !== undefined && typeof body.toggle !== "boolean") {
      return reply.code(422).send({
        error: { code: "INVALID_TOGGLE_VALUE", message: "toggle must be a boolean" }
      });
    }

    const current = effectsStore.get(sourceId);
    const nextMuted =
      typeof body.muted === "boolean"
        ? body.muted
        : body.toggle === true
          ? !(current?.muted ?? false)
          : !(current?.muted ?? false);

    const updated = effectsStore.setMuted(sourceId, { muted: nextMuted });
    if (!updated) {
      return reply.code(404).send({
        error: { code: "SOURCE_NOT_FOUND", message: `Unknown source ID: ${request.params.sourceId}` }
      });
    }

    if (pipgmService.isValidPipelineId(sourceId)) {
      pipgmService.setAudio(sourceId, {
        audioEnabled: !nextMuted,
        ...(typeof body.sync === "boolean" ? { sync: body.sync } : {})
      });
    }

    eventBroker.emit({
      type: "effects",
      data: { sourceId, effects: updated }
    });

    return reply.code(200).send(updated);
  });

  // Output effects mapping
  app.get<{ Params: { outputId: string } }>("/api/v1/outputs/:outputId/effects", async (request, reply) => {
    const output = outputStore.get(request.params.outputId as OutputId);
    if (!output) {
      return reply.code(404).send({
        error: { code: "OUTPUT_NOT_FOUND", message: `Unknown output ID: ${request.params.outputId}` }
      });
    }

    const activeSource = output.observedSource ?? output.desiredSource;
    if (!activeSource) {
      return reply.code(200).send({
        outputId: output.id,
        sourceId: null,
        effects: null,
        message: "No source currently routed to this output"
      });
    }

    const effects = effectsStore.get(activeSource);
    return reply.code(200).send({
      outputId: output.id,
      sourceId: activeSource,
      effects
    });
  });

  app.put<{
    Params: { outputId: string };
    Body: {
      enabled?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      sourceWidth?: unknown;
      sourceHeight?: unknown;
      aspectRatio?: unknown;
      lockedAspectRatio?: unknown;
    };
  }>("/api/v1/outputs/:outputId/effects/crop", async (request, reply) => {
    const output = outputStore.get(request.params.outputId as OutputId);
    if (!output) {
      return reply.code(404).send({
        error: { code: "OUTPUT_NOT_FOUND", message: `Unknown output ID: ${request.params.outputId}` }
      });
    }

    const activeSource = output.observedSource ?? output.desiredSource;
    if (!activeSource) {
      return reply.code(422).send({
        error: { code: "OUTPUT_NOT_ROUTED", message: "Output is not routed to any source" }
      });
    }

    return app.inject({
      method: "PUT",
      url: `/api/v1/sources/${activeSource}/effects/crop`,
      payload: request.body
    }).then((res) => reply.code(res.statusCode).send(JSON.parse(res.payload)));
  });

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send({
      error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url}` }
    })
  );

  return app;
}
