# PiMatrix

PiMatrix is the Raspberry Pi-side video routing and processing control plane for the Keskuskirkko AV system.

The initial implementation provides a simulation-first HTTP API and standalone CLI. The API now optionally discovers live MediaMTX paths and exposes browser-facing preview URLs for ready paths. Capture ingestion, fffleet job management, HDMI presentation, and AMX integration remain separate follow-on steps.

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

Environment:

- `PIMATRIX_HOST`: bind address; defaults to `127.0.0.1`.
- `PIMATRIX_PORT`: HTTP port; defaults to `3000`.
- `PIMATRIX_MODE`: `simulation` (default) or `production`.
- `PIMATRIX_MEDIAMTX_API_URL`: optional MediaMTX HTTP API base URL, e.g. `http://127.0.0.1:9997`.
- `PIMATRIX_PREVIEW_BASE_URL`: optional browser-reachable WebRTC base URL, e.g. `http://pi.local:8889`.
- `LOG_LEVEL`: Fastify log level; defaults to `info`.

When MediaMTX is configured, PiMatrix checks `/v3/paths/list`. Ready paths whose names match the logical source IDs are reported as live. A preview URL is returned only when the matching path is ready and `PIMATRIX_PREVIEW_BASE_URL` is set. The base URL must be reachable from the operator's browser; it must not be a container-only hostname.

MediaMTX path matching is currently by exact source ID (`hama`, `rtmp1`, `rtmp2`, `cam1`, `cam2`, `cam3`, `PiPGM1`, `PiPGM2`). PiMatrix does not yet launch or supervise ingest processes, and this adapter does not claim to prove that a physical capture device is configured correctly.

Simulation is the default. `production` is currently only a configuration value and does not activate capture or display hardware. API liveness remains healthy when MediaMTX is unavailable; the integration status reports the failure separately.

## Use the CLI

```sh
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 status
npm run dev --workspace @pimatrix/cli -- --json sources list
npm run dev --workspace @pimatrix/cli -- --json outputs list
```

Once built, the `pimatrix` executable is available from the CLI workspace package. It supports `--server`, `PIMATRIX_URL`, and `--json`.

## Planned integration order

1. API and OpenAPI-generated client/CLI
2. MediaMTX discovery and WebRTC preview status
3. fffleet job lifecycle, managed ingest and supervision
4. Independent HDMI output adapter and per-output processing
5. Vite operator UI and deployment hardening
6. AMX integration last; AMX remains the sole Atlona controller

The initial implementation skips the hardware-proof phase as requested. Build/test status is reported by GitHub Actions; do not assume a commit is verified until CI finishes successfully.
