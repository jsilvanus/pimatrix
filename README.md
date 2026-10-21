# PiMatrix

PiMatrix is the Raspberry Pi-side video routing and processing control plane for the Keskuskirkko AV system.

The implementation provides a simulation-first HTTP API and standalone CLI, MediaMTX path discovery, fffleet job supervision, and an opt-in local Hama USB capture publisher. The supported capture model is Hama Video Recording/Streaming Stick, article no. 00074257. See the [device-specific capture guide](docs/hama-00074257.md) for official documentation, Linux mode discovery, and configuration. The Hama job is executed by a local fffleet runner on the Pi so a remote fleet can never be handed the Pi's `/dev/video*` device.

## Architecture

- `openapi/openapi.yaml` is the canonical HTTP contract.
- `packages/api-client` generates operation-specific TypeScript services and models from OpenAPI.
- `packages/api` implements the Node.js/Fastify service.
- `packages/cli` implements the operator-facing `pimatrix` command using generated service methods.
- The CLI uses HTTP only; it does not require Podman and does not connect directly to AMX, MediaMTX, or fffleet.
- MediaMTX carries media and provides WebRTC previews; the PiMatrix API only queries path state and returns preview URLs. It does not proxy video bytes.

## Requirements

- Node.js 20 or newer
- npm

## Install, generate, build, test

Run from the repository root:

```sh
npm install
npm run generate:api
npm run build
npm test
```

Generated API client code is a build artifact and is not committed. It is regenerated from `openapi/openapi.yaml` before compilation.

## Run the API

```sh
npm run dev --workspace @pimatrix/api
```

Default URL: `http://127.0.0.1:3000`.

- `GET /health`
- `GET /ready`
- `GET /api/v1/status`
- `GET /api/v1/sources`
- `GET /api/v1/sources/{sourceId}`
- `GET /api/v1/outputs`
- `PUT /api/v1/outputs/{outputId}/source` (records desired route intent; does not yet drive HDMI hardware)

Environment:

- `PIMATRIX_HOST`: bind address; defaults to `127.0.0.1`.
- `PIMATRIX_PORT`: HTTP port; defaults to `3000`.
- `PIMATRIX_MODE`: `simulation` (default) or `production`.
- `PIMATRIX_MEDIAMTX_API_URL`: optional MediaMTX HTTP API base URL, e.g. `http://127.0.0.1:9997`.
- `PIMATRIX_PREVIEW_BASE_URL`: optional browser-reachable WebRTC base URL, e.g. `http://pi.local:8889`.
- `FFFLEET_URL`: optional remote fffleet orchestrator URL for future non-device jobs. If configured, PiMatrix probes its capabilities and reports the connection state. Hama capture always uses a separate local fffleet runner.
- `FFFLEET_TOKEN`: optional static bearer token for fffleet.
- `FFFLEET_CLIENT_ID` and `FFFLEET_CLIENT_SECRET`: optional client credentials; set both together instead of `FFFLEET_TOKEN`.
- `PIMATRIX_HAMA_ENABLED`: set to `true` to start the local Hama capture stream; default `false` so simulation never tries to open hardware.
- `PIMATRIX_HAMA_DEVICE`: V4L2 device path; defaults to `/dev/video0`.
- `PIMATRIX_HAMA_INPUT_FORMAT`: optional V4L2 input format (for example `mjpeg`), only set after checking the device formats.
- `PIMATRIX_HAMA_WIDTH`, `PIMATRIX_HAMA_HEIGHT`, `PIMATRIX_HAMA_FRAME_RATE`: optional capture-mode overrides. Width and height must be supplied together; omitted values leave mode selection to FFmpeg/V4L2.
- `PIMATRIX_HAMA_VIDEO_CODEC`: optional `copy` or `libx264`; omitted by default because the manual does not identify the Linux capture pixel format.
- `PIMATRIX_HAMA_RTSP_URL`: required when Hama capture is enabled; the RTSP publish URL for MediaMTX, e.g. `rtsp://127.0.0.1:8554/hama` when API and MediaMTX share the host network, or `rtsp://mediamtx:8554/hama` on a shared container network.
- `PIMATRIX_STREAM_RESTART_MIN_MS`: initial retry delay, default `1000`.
- `PIMATRIX_STREAM_RESTART_MAX_MS`: maximum retry delay, default `30000` (maximum accepted: 5 minutes).
- `LOG_LEVEL`: Fastify log level; defaults to `info`.

When MediaMTX is configured, PiMatrix checks `/v3/paths/list`. Ready paths whose names match the logical source IDs are reported as live. A preview URL is returned only when the matching path is ready and `PIMATRIX_PREVIEW_BASE_URL` is set. The base URL must be reachable from the operator's browser; it must not be a container-only hostname.

PiMatrix now submits the Hama capture stream to its local fffleet runner with application-owned IDs (`pimatrix-hama-capture-<attempt>`). It monitors job state/stderr, cancels the job during shutdown, and retries failed or unexpectedly ended streams with bounded exponential backoff. The separate optional remote fffleet client remains capability-discovery only; PiMatrix does not yet submit remote jobs.

When Hama capture is enabled, FFmpeg opens the configured V4L2 device once and publishes it to the configured MediaMTX RTSP path. The supported model is Hama Video Recording/Streaming Stick (article 00074257). The [official Hama product page](https://ae.hama.com/00074257/hama-video-recording-stick-usb-plug-hdmi-socket-4k) and [manual (PDF)](https://support.hama.com/webresources/article-documents/00074/man/00074257man_bg_cs_de_el_en_es_fi_fr_hu_it_nl_pl_pt_ro_ru_sk_sv_tr.pdf) advertise 4K/30 input, 1080p/60 output and USB 3.0 / USB 3.2 Gen 1. The manual lists Windows and macOS requirements but does not specify Linux support, V4L2 pixel formats or enumerated capture modes.

The capture path is disabled by default and does not force a pixel format, resolution, frame rate or codec. On the Pi, install `v4l-utils`, then run `v4l2-ctl --list-devices` and `v4l2-ctl --list-formats-ext -d /dev/videoN` (replace `/dev/videoN` with the node associated with Hama). Set explicit `PIMATRIX_HAMA_*` overrides only from those results. The advertised 1080p/60 output is a vendor maximum, not proof Linux exposes that exact mode. Linux compatibility and capture behavior remain to be verified on the actual Pi.

MediaMTX path matching is currently by exact source ID (`hama`, `rtmp1`, `rtmp2`, `cam1`, `cam2`, `cam3`, `PiPGM1`, `PiPGM2`). The Hama capture publisher is supervised locally; broader RTMP, camera, and renderer ingest ownership remains future work. The adapter does not prove that a physical capture device is configured correctly.

Simulation is the default. `production` is currently only a configuration value and does not activate capture or display hardware. API liveness remains healthy when MediaMTX is unavailable; the integration status reports the failure separately.

## Local Windows/WSL streaming lab

A Docker Compose development lab runs MediaMTX and synthetic FFmpeg sources without
the Raspberry Pi or capture hardware. See [the lab guide](dev/streaming-lab/README.md).
Quick start:

```sh
npm run lab:up
npm run lab:logs
npm run lab:down
```

The `hama` path in this lab is a synthetic test pattern, not the physical Hama stick.
The lab does not emulate a V4L2 device, HDMI output, or AMX.

## Use the CLI

```sh
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 status
npm run dev --workspace @pimatrix/cli -- --json sources list
npm run dev --workspace @pimatrix/cli -- --json outputs list
npm run dev --workspace @pimatrix/cli -- outputs set hdmi0 hama
npm run dev --workspace @pimatrix/cli -- outputs set hdmi0 none
```

Once built, the `pimatrix` executable is available from the CLI workspace package. It supports `--server`, `PIMATRIX_URL`, and `--json`.

## Planned integration order

1. API and OpenAPI-generated client/CLI
2. MediaMTX discovery and WebRTC preview status
3. fffleet local stream job lifecycle/supervision and opt-in Hama capture publisher (implemented); broader RTMP/camera/renderer stream ownership remains future work
4. Output route intent API/CLI (implemented), then independent HDMI output adapter and per-output processing
5. Vite operator UI and deployment hardening
6. AMX integration last; AMX remains the sole Atlona controller

The initial implementation skips the hardware-proof phase as requested. Build/test status is reported by GitHub Actions; do not assume a commit is verified until CI finishes successfully.
