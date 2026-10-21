# PiMatrix

PiMatrix is the Raspberry Pi-side video routing and processing control plane for the Keskuskirkko AV system.

The application is being built incrementally. The initial implementation provides a simulation-first HTTP API, a canonical OpenAPI contract, and a standalone CLI. MediaMTX, fffleet, capture hardware, HDMI presentation, and AMX integration are not implemented yet.

## Architecture

- `openapi/openapi.yaml` is the canonical HTTP contract.
- `packages/api-client` generates TypeScript API types from OpenAPI and exposes a typed `openapi-fetch` client.
- `packages/api` implements the Node.js/Fastify service.
- `packages/cli` implements the operator-facing `pimatrix` command using the generated API client.
- The CLI uses HTTP only; it does not require Podman and does not connect directly to AMX, MediaMTX, or fffleet.

OpenAPI generates the API types used by the client. The human-oriented command layer stays small and uses that generated client, so endpoint paths, request types and response types are not duplicated.

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

Generated API declarations are build artifacts and are not committed. The build regenerates them from `openapi/openapi.yaml` before compiling the client, API and CLI.

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
- `LOG_LEVEL`: Fastify log level; defaults to `info`.

Simulation is the default. No source or output is reported as live until a real adapter provides observed state. `production` is currently only a configuration value and does not activate hardware integrations.

## Use the CLI

```sh
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 status
npm run dev --workspace @pimatrix/cli -- --json sources list
npm run dev --workspace @pimatrix/cli -- --json outputs list
```

Once built, the `pimatrix` executable is available from the CLI workspace package. It supports `--server`, `PIMATRIX_URL`, and `--json`.

## Planned integration order

1. API and generated-client foundation
2. Media ingest and WebRTC previews through MediaMTX
3. fffleet job lifecycle and supervision
4. Independent HDMI output adapter and per-output processing
5. Vite operator UI and deployment hardening
6. AMX integration last; AMX remains the sole Atlona controller

The initial implementation skips hardware proof as requested. Validate the code with build and tests before adding live media integrations.
