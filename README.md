# PiMatrix

PiMatrix is the Raspberry Pi-side video routing and processing control plane for the Keskuskirkko AV system.

The implementation provides a simulation-first HTTP API and standalone CLI, MediaMTX path discovery, fffleet job supervision, an opt-in local Hama USB capture publisher, Server-Sent Events (SSE) for real-time state changes, an HDMI output display adapter, an inbound TCP listener for AMX NetLinx master control, and an outbound AMX client for requesting Atlona matrix routes. The supported capture model is Hama Video Recording/Streaming Stick, article no. 00074257. See the [device-specific capture guide](docs/hama-00074257.md) for official documentation, Linux mode discovery, and configuration. The Hama job is executed by a local fffleet runner on the Pi so a remote fleet can never be handed the Pi's `/dev/video*` device.

## Architecture

- `openapi/openapi.yaml` is the canonical HTTP contract.
- `packages/api-client` generates operation-specific TypeScript services and models from OpenAPI.
- `packages/api` implements the Node.js/Fastify service.
- `packages/cli` implements the operator-facing `pimatrix` command using generated service methods.
- The CLI uses HTTP only; it does not require Podman and does not connect directly to AMX, MediaMTX, or fffleet.
- MediaMTX carries media and provides WebRTC previews; the PiMatrix API only queries path state and returns preview URLs. It does not proxy video bytes.
- AMX NetLinx integration provides a constrained, line-framed TCP protocol on port 6600 for touch-panel queries and route actions, and an outbound TCP client adapter for requesting Atlona routes via NetLinx. AMX remains the sole controller of the Atlona matrix.

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

## Interactive Setup Wizard

PiMatrix provides an interactive setup script that walks through all environment variables, detects local network IPs, generates secure random tokens, and writes a configured .env:

`sh
npm run setup
# or on Linux / Raspberry Pi: ./setup.sh
# or on Windows PowerShell:   .\setup.ps1
`

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
- `PUT /api/v1/outputs/{outputId}/source` (sets route intent and applies to display adapter)
- `GET /api/v1/events` (Server-Sent Events stream for real-time status, source, and output changes)
- `POST /api/v1/matrix/route` (requests Atlona matrix routing through AMX NetLinx master)
- `GET /api/v1/atem` (ATEM switcher connection, program and preview input); `PUT /api/v1/atem/program` and `PUT /api/v1/atem/preview` (`{ "input": n }`); `POST /api/v1/atem/cut`. Answers 503 when no ATEM is configured or reachable.
- `GET /api/v1/cameras` (lists configured PTZ cameras with connection, streaming, and position state)
- `GET /api/v1/cameras/{cameraId}` (get details, position, and saved presets)
- `POST /api/v1/cameras/{cameraId}/move` (pan/tilt direction, panSpeed 1-24, tiltSpeed 1-23)
- `POST /api/v1/cameras/{cameraId}/zoom` (action: in, out, stop; speed 0-7)
- `POST /api/v1/cameras/{cameraId}/presets/{presetId}/recall` (recalls preset 0-254)
- `POST /api/v1/cameras/{cameraId}/presets/{presetId}/save` (saves current position to preset 0-254)
- `POST /api/v1/cameras/{cameraId}/smartframe` (controls SmartFrame AI auto-framing: enable, disable, trigger)
- `POST /api/v1/cameras/{cameraId}/stream/start` (commands camera to push RTMP feed or activates RTSP pull)
- `POST /api/v1/cameras/{cameraId}/stream/stop` (stops camera streaming feed)
- `GET /multiview` (responsive browser/phone WebRTC 8-way multiview: automatically 4x2 in landscape, 2x4 in portrait)
- `GET /api/v1/outputs/multiview` (get 8-way multiview configuration and live tile metadata)
- `PUT /api/v1/outputs/multiview/layout` (set layout mode: auto, landscape, or portrait)

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
- `PIMATRIX_DISPLAY_MODE`: `simulated`, `hardware`, or `disabled`; defaults to `disabled` unless simulation mode is active or configured.
- `PIMATRIX_DISPLAY_SIMULATED`: set to `true` to simulate active display adapter state upon routing.
- `PIMATRIX_HDMI_PLAYER`: player command for `hardware` display mode, one process per HDMI output; defaults to `ffplay`. Started with `-fs -noborder -an` (no audio) and the source RTSP URL; the output device is passed in `PIMATRIX_OUTPUT_DEVICE`. Unverified on hardware.
- `PIMATRIX_HDMI0_DEVICE`, `PIMATRIX_HDMI1_DEVICE`: optional per-output device for `hardware` mode: a DRM connector name such as `card1-HDMI-A-1` (on the Pi: `card1-HDMI-A-1` and `card1-HDMI-A-2`), a device path or a display name. Letters, digits and `. _ : / -` only. An output without a device is not configured. The player gets it in `PIMATRIX_OUTPUT_DEVICE`.
- `PIMATRIX_HDMI_SDL_VIDEODRIVER`: SDL video driver set for each player; defaults to `kmsdrm` (no desktop on the Pi). Set empty to inherit. ffplay cannot choose a connector itself, so a wrapper set as `PIMATRIX_HDMI_PLAYER` must select the connector named in `PIMATRIX_OUTPUT_DEVICE`. The `deploy/pi/pimatrix-player` wrapper overrides this setting and sets `SDL_VIDEODRIVER=wayland`, because it runs ffplay as a client of the labwc compositor (see `deploy/pi/README.md`). Verified on a Pi 4 with two outputs; see `deploy/pi/README.md`.
- `PIMATRIX_MEDIAMTX_RTSP_URL`: RTSP base URL of MediaMTX (for example `rtsp://127.0.0.1:8554`); a route's source is played from `<base>/<sourceId>`.
- `PIMATRIX_ATEM_HOST`: ATEM switcher address; unset keeps the ATEM adapter a stub. Control uses the `atem-connection` library (same as LCYT). Unverified on hardware.
- `PIMATRIX_ATEM_PORT`: ATEM control port; defaults to `9990`.
- `PIMATRIX_AMX_TCP_ENABLED`: set to `true` to start the inbound AMX TCP listener.
- `PIMATRIX_AMX_TCP_HOST`: inbound listener host; defaults to `127.0.0.1`.
- `PIMATRIX_AMX_TCP_PORT`: inbound listener port; defaults to `6600`.
- `PIMATRIX_AMX_SIMULATED`: set to `true` to simulate outbound AMX NetLinx master interactions.
- `PIMATRIX_AMX_MASTER_HOST`: target AMX NetLinx master IP/hostname for outbound matrix requests.
- `PIMATRIX_AMX_MASTER_PORT`: target AMX NetLinx master port; defaults to `6501`.
- `PIMATRIX_CAMERA_MODE`: `simulated` (default) or `hardware`.
- `PIMATRIX_CAM1_HOST`, `PIMATRIX_CAM1_VISCA_PORT` (default 52381), `PIMATRIX_CAM1_CGI_PORT` (default 80): Cam1 AVer PTZ330 network target.
- `PIMATRIX_CAM2_HOST`, `PIMATRIX_CAM2_VISCA_PORT` (default 52381), `PIMATRIX_CAM2_CGI_PORT` (default 80): Cam2 AVer PTZ330 network target.
- `LOG_LEVEL`: Fastify log level; defaults to `info`.

When MediaMTX is configured, PiMatrix checks `/v3/paths/list`. Ready paths whose names match the logical source IDs are reported as live. A preview URL is returned only when the matching path is ready and `PIMATRIX_PREVIEW_BASE_URL` is set. The base URL must be reachable from the operator's browser; it must not be a container-only hostname.

PiMatrix submits the Hama capture stream to its local fffleet runner with application-owned IDs (`pimatrix-hama-capture-<attempt>`). It monitors job state/stderr, cancels the job during shutdown, and retries failed or unexpectedly ended streams with bounded exponential backoff.

## AMX NetLinx Integration

### Inbound TCP Listener (Port 6600)

Exposes a line-framed, `;`-terminated ASCII protocol matching NetLinx conventions:

- `DEV:VERSION;` &rarr; `DEV:VERSION:1;`
- `PING;` &rarr; `PONG;`
- `STATUS;` &rarr; `STATUS:OK:mode=simulation,sources=8,outputs=2;`
- `SOURCE:LIST;` &rarr; `SOURCE:LIST:hama=live,rtmp1=unavailable,...;`
- `SOURCE:GET:<sourceId>;` &rarr; `SOURCE:<sourceId>:<state>:<previewAvailable>;`
- `OUTPUT:LIST;` &rarr; `OUTPUT:LIST:hdmi0=<desired>:<observed>:<state>,...;`
- `OUTPUT:SET:<outputId>:<sourceId|none>;` &rarr; `OUTPUT:OK:<outputId>:<sourceId|none>;`
- `HELP;` &rarr; list of available commands.

Supports optional message IDs (e.g. `REQ01:PING;` &rarr; `REQ01:PONG;`).

### Outbound AMX Client Adapter

When an Atlona route change is requested (`POST /api/v1/matrix/route` or `pimatrix matrix route <in> <out>`), PiMatrix sends:
`ATLONA:ROUTE:<requestId>:<input>:<output>;` to the AMX NetLinx master on port 6501. AMX remains the sole controller of the Atlona matrix.

## Camera Control (VISCA over IP & CGI)

PiMatrix controls the two installed AVer PTZ330 cameras (`cam1` and `cam2`) over the AV network using standard **VISCA over IP** (UDP port 52381) and camera HTTP CGI (port 80):

- **Movement & Zoom:** Continuous pan/tilt drive (`up`, `down`, `left`, `right`, `upleft`, `upright`, `downleft`, `downright`, `stop`, `home`, `reset`) with pan speed (1–24) and tilt speed (1–23); optical zoom (`in`, `out`, `stop`) with speed (0–7).
- **Presets:** 255 addressable preset memory slots (`0`–`254`) supporting recall and save (replacing the 6-preset cap of the legacy AMX IR remote).
- **SmartFrame AI Auto-Framing:** Trigger or toggle AVer SmartFrame via VISCA memory codes (`enable` = 0x5A, `disable` = 0x5B, `trigger` = 0x5C).
- **Streaming Feed Control:** Command the camera to start/stop RTMP push streaming to MediaMTX via CGI (`vdo_rtmp_enable`), or coordinate RTSP pull (`rtsp://<ip>:554/live_st1`).
- **Simulated Mode:** When `PIMATRIX_CAMERA_MODE=simulated`, camera positions, presets, and streaming states are fully simulated in memory for offline testing.

## 8-Way Multiview Output (`multiview`)

PiMatrix provides an automatic 8-way multiview aggregating all logical sources in fixed order:
1. `cam1` (Camera 1)
2. `cam2` (Camera 2)
3. `cam3` (Camera 3)
4. `hama` (Hama capture)
5. `rtmp1` (RTMP 1)
6. `rtmp2` (RTMP 2)
7. `PiPGM1` (Pi Programme 1)
8. `PiPGM2` (Pi Programme 2)

- **Automatic Orientation:** When accessed directly on a mobile phone or desktop browser (`http://<host>:3000/multiview`), CSS Grid automatically adjusts:
  - **Horizontal / Landscape:** 4 columns × 2 rows (4x2).
  - **Vertical / Portrait (Phone):** 2 columns × 4 rows (2x4).
- **WebRTC Streaming:** Live video tiles load via WebRTC and automatically update status via Server-Sent Events.

## Local Windows/WSL streaming lab

A Docker Compose development lab runs MediaMTX and synthetic FFmpeg sources without
the Raspberry Pi or capture hardware. See [the lab guide](dev/streaming-lab/README.md).
Quick start:

```sh
npm run lab:up
npm run lab:logs
npm run lab:down
```

## Use the CLI

```sh
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 status
npm run dev --workspace @pimatrix/cli -- --json sources list
npm run dev --workspace @pimatrix/cli -- sources show hama
npm run dev --workspace @pimatrix/cli -- --json outputs list
npm run dev --workspace @pimatrix/cli -- outputs set hdmi0 hama
npm run dev --workspace @pimatrix/cli -- outputs set hdmi0 none
npm run dev --workspace @pimatrix/cli -- matrix route 2 4
npm run dev --workspace @pimatrix/cli -- cameras list
npm run dev --workspace @pimatrix/cli -- cameras show cam1
npm run dev --workspace @pimatrix/cli -- cameras move cam1 up --speed 12
npm run dev --workspace @pimatrix/cli -- cameras zoom cam1 in --speed 4
npm run dev --workspace @pimatrix/cli -- cameras preset recall cam1 2
npm run dev --workspace @pimatrix/cli -- cameras preset save cam1 7 --name "Choir Back"
npm run dev --workspace @pimatrix/cli -- cameras smartframe cam1 trigger
npm run dev --workspace @pimatrix/cli -- cameras stream start cam1
npm run dev --workspace @pimatrix/cli -- cameras stream stop cam1
npm run dev --workspace @pimatrix/cli -- multiview show
npm run dev --workspace @pimatrix/cli -- multiview layout portrait
```

Once built, the `pimatrix` executable is available from the CLI workspace package. It supports `--server`, `PIMATRIX_URL`, and `--json`.

## Security, Authentication & Remote Access

PiMatrix provides fine-grained security tailored for AV production facilities:
- **LAN Direct HTTP:** Local touchscreens, monitors, and companion apps communicate via fast, unencrypted HTTP without TLS certificate overhead or renewal failures.
- **Remote Access (Canva / Internet):** A dedicated WAN port can be routed through an Nginx reverse proxy + Certbot TLS termination on port 8443, preserving security for external cloud integrations.
- **Control Point Authentication:** Set PIMATRIX_API_KEY to protect HDMI routing, crop/effects, matrix switching, and PTZ camera movements.
- **Web UI & Companion App:** The web console provides a password screen storing the token in localStorage. The Windows Companion app provides an API Key configuration field.
- **LAN Operator Whitelist:** Exempt trusted touch panels and control room IPs from password entry with PIMATRIX_AUTH_ALLOWED_HOSTS.
- `PIMATRIX_CORS_ORIGINS`: comma-separated browser origins (for example `http://kirkonpi.local:8080`) allowed to call `/api/v1` cross-origin. Preflights are answered and responses echo the origin only for listed origins. Unset = no CORS headers on `/api/v1`. The Canva routes keep their own `*` headers.
- **AMX IP Whitelist:** Restrict AMX NetLinx TCP connections on port 6600 using PIMATRIX_AMX_ALLOWED_HOSTS.
- **Automated TLS Reverse Proxy:** A small Nginx + Certbot Alpine container in deploy/tls-proxy auto-provisions and renews Let's Encrypt certificates using PIMATRIX_DOMAIN and LETSENCRYPT_EMAIL.

See the full [Security & Remote Access Guide](docs/security-and-remote-access.md) and [.env.example](.env.example) for setup instructions.

## Podman / Container Deployment

Build container:

```sh
podman build -t pimatrix -f deploy/Containerfile .
```

Run container:

```sh
podman run -d --name pimatrix -p 3000:3000 -p 6600:6600 pimatrix
```
