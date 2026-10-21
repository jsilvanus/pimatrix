# PiMatrix local streaming lab (Windows + WSL2 + Docker)

This is a **development-only** test stack. It runs MediaMTX and synthetic FFmpeg
publishers so PiMatrix's MediaMTX discovery, source state and browser previews can
be tested without the Raspberry Pi or Hama capture stick.

It does not emulate a V4L2 device, HDMI output hardware, AMX, or a physical camera.
The `hama` path in this lab is a generated test pattern, not a real Hama capture.

## Requirements

- Docker Desktop with the WSL2 backend, or Docker Engine inside WSL2
- Docker Compose v2
- Node.js 20+ and npm available in the environment where PiMatrix is run

## Start the media services

From the repository root:

```sh
docker compose -f dev/streaming-lab/compose.yaml up -d --build
docker compose -f dev/streaming-lab/compose.yaml ps
docker compose -f dev/streaming-lab/compose.yaml logs -f mediamtx test-patterns
```

The stack publishes all PiMatrix logical source paths:
`hama`, `rtmp1`, `rtmp2`, `cam1`, `cam2`, `cam3`, `PiPGM1`, and `PiPGM2`.
Each path is a distinct 640x360, 10 fps moving test pattern with its source ID
drawn over it. These settings are intentionally modest for a Windows development
machine; change `WIDTH`, `HEIGHT`, or `FPS` in `compose.yaml` to stress-test.

## Verify MediaMTX

From the Windows host, open:

- MediaMTX WebRTC page: http://127.0.0.1:8889/hama
- Alternative paths: http://127.0.0.1:8889/cam1, http://127.0.0.1:8889/PiPGM1
- MediaMTX API: http://127.0.0.1:9997/v3/paths/list

The API endpoint should return JSON containing ready paths once the producers
have connected. If the browser page opens but video fails, check Docker's UDP
mapping for port 8189 and the MediaMTX logs. Some VPNs and firewall rules can
interfere with WebRTC's UDP traffic.

## Run PiMatrix against the lab

Keep the Docker stack running. In a second terminal at the repository root,
set the following environment variables and start the API. Do not enable the
physical Hama capture in this simulated setup.

PowerShell:

```powershell
$env:PIMATRIX_HOST = "127.0.0.1"
$env:PIMATRIX_PORT = "3000"
$env:PIMATRIX_MODE = "simulation"
$env:PIMATRIX_MEDIAMTX_API_URL = "http://127.0.0.1:9997"
$env:PIMATRIX_PREVIEW_BASE_URL = "http://127.0.0.1:8889"
$env:PIMATRIX_HAMA_ENABLED = "false"
npm install
npm run dev --workspace @pimatrix/api
```

WSL/Linux shell:

```sh
export PIMATRIX_HOST=127.0.0.1
export PIMATRIX_PORT=3000
export PIMATRIX_MODE=simulation
export PIMATRIX_MEDIAMTX_API_URL=http://127.0.0.1:9997
export PIMATRIX_PREVIEW_BASE_URL=http://127.0.0.1:8889
export PIMATRIX_HAMA_ENABLED=false
npm install
npm run dev --workspace @pimatrix/api
```

Then, in another terminal, try the API and generated CLI:

```sh
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/v1/status
curl http://127.0.0.1:3000/api/v1/sources
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 status
npm run dev --workspace @pimatrix/cli -- --server http://127.0.0.1:3000 sources list
```

The preview URL returned by PiMatrix is intended for a browser on the host.
If the API runs inside a container later, do not use a container-only hostname
as the browser preview base URL.

## Stop and clean up

```sh
docker compose -f dev/streaming-lab/compose.yaml down
```

Use `down -v` only if future lab services add volumes that you explicitly want
to delete; the current lab does not need persistent volumes.

## uStreamer and virtual V4L2 follow-up

uStreamer needs a Linux V4L2 capture device. The synthetic RTSP publishers above
exercise the MediaMTX path without V4L2 and therefore do not test uStreamer's
device-opening code. A true software-only V4L2 test requires a working
`v4l2loopback` module in the WSL2 kernel or a small Linux VM. Do not map a
Windows camera into this container and assume it is a Linux `/dev/videoN`
device. Keep uStreamer optional until that layer is proven.
