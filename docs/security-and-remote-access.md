# Security and Remote Access Architecture

PiMatrix is designed for AV production environments where low latency and local reliability are paramount, while selectively allowing remote integrations (such as Canva presentation control) from external networks.

> [!TIP]
> **Interactive Wizard:** Run 
pm run setup (or ./setup.sh / .\setup.ps1) to automatically configure your .env file with guided prompts, auto-detected LAN IPs, and generated keys.

---

## 1. Network Architecture Overview

```
                          ┌────────────────────────────────────────────────────────┐
                          │                     LOCAL NETWORK                      │
                          │                                                        │
                          │   LAN Operator / Touchscreen (Whitelisted IP)          │
                          │   ─── Direct HTTP (port 3000, No Password) ────┐       │
                          │                                                │       │
                          │   Other LAN Clients (Laptops, Phones)          │       │
                          │   ─── Direct HTTP (port 3000, Auth Required) ──┤       │
                          │                                                │       │
                          │   AMX NetLinx Master Controller                │       │
                          │   ─── TCP (port 6600, IP Whitelisted) ─────────┤       │
                          │                                                ▼       │
                          │                                     ┌──────────────────────┐
                          │                                     │  PiMatrix Core App   │
                          │                                     │  (Node.js / Fastify) │
                          │                                     │  - Port 3000 (HTTP)  │
                          │                                     │  - Port 6600 (AMX)   │
                          │                                     └──────────────────────┘
                          │                                                ▲
                          │                                                │ Upstream Proxy
                          │                                                │ (http://127.0.0.1:3000)
                          │   ┌────────────────────────────────────────────┴───────┐
                          │   │  deploy/tls-proxy (Nginx + Certbot Alpine Image)   │
                          │   │  - Auto-provisions Let's Encrypt TLS Certificate   │
                          │   │  - Port 80 (ACME HTTP-01 challenge)                │
                          │   │  - Port 8443 (External HTTPS via TLS)              │
                          │   └────────────────────────────────────────────────────┘
                          │                         ▲
                          └─────────────────────────┼──────────────────────────────┘
                                                    │
                                         Router Port Forward (WAN 8443 -> LAN 8443)
                                         Router Port Forward (WAN 80   -> LAN 80)
                                                    │
                                       ┌────────────┴───────────┐
                                       │        INTERNET        │
                                       │   Canva Cloud App /    │
                                       │   Remote Operators     │
                                       │   (HTTPS via TLS)      │
                                       └────────────────────────┘
```

### Why No TLS on LAN?
- **Zero Certificate Overhead:** Local touch panels, AMX controllers, hardware decoders, and wall displays on an isolated AV LAN do not manage CA root stores or handle renewal failures.
- **Fail-Safe Operation:** If the church internet connection goes down or a certificate renewal fails, local Sunday service AV switching continues uninterrupted.
- **Minimal Latency:** Eliminates TLS handshake latency on high-frequency SSE event streams and control commands.
- **Port Separation:** Internal traffic remains on standard HTTP (port 3000), while external traffic is terminated via TLS on a dedicated port (e.g. 8443 or 443).

---

## 2. Automated TLS Proxy Container (`deploy/tls-proxy`)

PiMatrix includes a dedicated, lightweight Alpine container (`deploy/tls-proxy`) combining **Nginx 1.27** and **Certbot** that fully automates TLS certificate creation and renewals.

### Environment Variables (.env)
```env
# Domain name pointing to your router's WAN IP
PIMATRIX_DOMAIN=matrix.keskuskirkko.fi

# Email for Let's Encrypt certificate renewal notices
LETSENCRYPT_EMAIL=av-admin@keskuskirkko.fi

# External TLS port (default: 8443)
PIMATRIX_TLS_PORT=8443

# Set to true during initial testing to avoid hitting Let's Encrypt production rate limits
CERTBOT_STAGING=false

# Restrict WAN port to only permit Canva presentation integration endpoints
RESTRICT_TO_CANVA=true
```

### How It Works
1. **Bootstrap Phase:** When the container starts, it immediately generates a 2048-bit self-signed certificate so Nginx can start listening on port 8443 without errors.
2. **ACME HTTP-01 Challenge:** Nginx responds to Let's Encrypt validation requests on `http://<your-domain>/.well-known/acme-challenge/` (port 80).
3. **Automatic Issuance & Hot Reload:** Certbot acquires the official certificate from Let's Encrypt and automatically reloads Nginx with the verified TLS certificate.
4. **Automated Background Renewal:** A daemon runs every 12 hours inside the container. When the certificate nears expiration, Certbot automatically renews it and reloads Nginx.
5. **Surface Hardening (`RESTRICT_TO_CANVA=true`):** External traffic hitting port 8443 is strictly limited to `/canva/` and `/api/v1/pipgm/canva/`. All attempts to access the admin UI, camera PTZ, or matrix routes from the WAN port receive an immediate `403 Forbidden`.

### Running the TLS Proxy
Run via Docker Compose:
```bash
# Standalone TLS proxy:
docker compose -f deploy/tls-proxy/compose.yaml up -d

# Or the complete stack (PiMatrix + MediaMTX + TLS Proxy):
docker compose up -d
```

---

## 3. Frictionless LAN Operator Whitelist (`PIMATRIX_AUTH_ALLOWED_HOSTS`)

To ensure maximum operational speed and reliability during live services, AV technicians in the control room should not be interrupted by password dialogs.

### Configuration
In `.env` or system environment:
```env
PIMATRIX_API_KEY=my-strong-password
PIMATRIX_AUTH_ALLOWED_HOSTS=127.0.0.1,192.168.1.50,192.168.1.100,10.0.0.0/24
```

### Supported Formats
- **Exact IPs:** `127.0.0.1`, `192.168.1.50`
- **Subnet Wildcards:** `192.168.1.*`
- **CIDR Ranges:** `192.168.1.0/24`, `10.0.0.0/16`
- **IPv4-Mapped IPv6:** `::ffff:192.168.1.50` (handled automatically)

### Behavior
- When a request originates from a whitelisted IP:
  - All mutating control actions (HDMI source switching, cropping, matrix routes, camera PTZ) are permitted **without requiring an API key or Bearer token**.
  - The Web UI detects the whitelisted status and displays a green **`LAN PASS`** badge in the header.
  - The password modal does **not** pop up.
- When a request originates from an unlisted IP (e.g. guest Wi-Fi or remote WAN client):
  - Mutating actions require the valid `PIMATRIX_API_KEY`.
  - The Web UI displays a red **`LOCKED`** badge and prompts for the password.

---

## 4. Other Security & Authentication Features

### Dedicated Canva App Token (`PIMATRIX_CANVA_APP_TOKEN`)
- The Canva presentation app can be built with a dedicated token:
  ```env
  PIMATRIX_CANVA_APP_TOKEN=canva-secure-token-xyz
  ```
- Any request reaching `/canva/*` or `/api/v1/pipgm/canva/*` accepts either `PIMATRIX_CANVA_APP_TOKEN` or `PIMATRIX_API_KEY`.
- Canva CORS preflight `OPTIONS` requests are automatically permitted without credentials.

### AMX NetLinx TCP IP Whitelist (`PIMATRIX_AMX_ALLOWED_HOSTS`)
- Protects the line-oriented AMX TCP control port (default `6600`).
- Specify comma-separated IPv4 or IPv6 addresses permitted to send AMX commands:
  ```env
  PIMATRIX_AMX_ALLOWED_HOSTS=127.0.0.1,192.168.1.50
  ```
- Unlisted TCP connections are dropped immediately before processing any commands.

### MediaMTX Stream Password (`PIMATRIX_MEDIAMTX_PASSWORD`)
- Configure the stream publish key for RTMP/SRT encoders:
  ```env
  PIMATRIX_MEDIAMTX_PASSWORD=my-stream-key
  ```
- In the Web UI, operators click **Stream Key** in the header bar to view and copy RTMP/RTSP ingest URLs and credentials directly into OBS Studio or vMix.

### Windows Companion App
- Includes a **Key** field directly in the header connection bar next to Target and Port.
- Persisted in `appsettings.json` under `PiMatrixApiKey` and sent as Bearer authorization.
