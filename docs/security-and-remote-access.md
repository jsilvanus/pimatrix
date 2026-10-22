# Security and Remote Access Architecture

PiMatrix is designed for AV production environments where low latency and local reliability are paramount, while selectively allowing remote integrations (such as Canva presentation control) from external networks.

---

## 1. Network Architecture Overview

```
                          ┌──────────────────────────────────────────────┐
                          │                LOCAL NETWORK                 │
                          │                                              │
                          │   Touchscreens / Browsers (LAN)              │
                          │   ─── HTTP (port 3000) ──────────────────┐   │
                          │                                          │   │
                          │   AMX NetLinx Master Controller          │   │
                          │   ─── TCP (port 6600, IP Whitelisted) ───┤   │
                          │                                          ▼   │
                          │                               ┌──────────────────────┐
                          │                               │  PiMatrix Core App   │
                          │                               │  (Node.js / Fastify) │
                          │                               │  - Port 3000 (HTTP)  │
                          │                               │  - Port 6600 (AMX)   │
                          │                               └──────────────────────┘
                          │                                          ▲
                          │                                          │ Proxy Pass
                          │                                          │ (http://127.0.0.1:3000)
                          │   ┌──────────────────────────────────────┴───┐
                          │   │       Nginx Reverse Proxy + TLS          │
                          │   │          (Let's Encrypt / Certbot)       │
                          │   │            Listening on Port 8443        │
                          │   └──────────────────────────────────────────┘
                          │                         ▲
                          └─────────────────────────┼────────────────────┘
                                                    │
                                         Port Forward (WAN 8443 -> LAN 8443)
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
- **Minimal Latency:** Eliminates TLS handshake latency on high-frequency SSE event streams and control commands.
- **Port Separation:** Internal traffic remains on standard HTTP (port 3000), while external traffic is terminated via TLS on a dedicated port (e.g. 8443 or 443).

---

## 2. Remote Access for Canva (Nginx + Certbot Reverse Proxy)

To allow Canva cloud services to control PiMatrix presentation scenes without exposing your internal network unencrypted:

1. **Router Configuration:**
   - Forward a dedicated public port (e.g. `8443`) from your WAN IP to port `8443` on the Raspberry Pi / host machine running Nginx.

2. **Certbot TLS Certificate:**
   Obtain a free Let's Encrypt certificate for your dynamic DNS or domain (e.g. `pimatrix.church.org`):
   ```bash
   sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot certonly --standalone -d pimatrix.church.org
   ```

3. **Nginx Reverse Proxy Configuration:**
   Create `/etc/nginx/sites-available/pimatrix-remote.conf`:
   ```nginx
   # Dedicated TLS port for external Canva / Remote API access
   server {
       listen 8443 ssl http2;
       server_name pimatrix.church.org;

       ssl_certificate /etc/letsencrypt/live/pimatrix.church.org/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/pimatrix.church.org/privkey.pem;

       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers HIGH:!aNULL:!MD5;
       ssl_prefer_server_ciphers on;

       # Restrict access to Canva control endpoints (optional) or reverse proxy all routes
       location /api/v1/pipgm/canva/ {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;

           # Forward real client information
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto https;
       }

       # Canva web app assets & endpoints
       location /canva/ {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto https;
       }

       # Global API / UI fallback
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;

           # WebSocket / SSE support
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto https;
       }
   }
   ```
   Enable and restart Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/pimatrix-remote.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl restart nginx
   ```

---

## 3. Authentication & Access Control

### API Key / Bearer Token (`PIMATRIX_API_KEY`)
- When `PIMATRIX_API_KEY` is configured in your environment or `.env` file, all mutating control points require authentication:
  - HDMI source routing (`PUT /api/v1/outputs/:output/source`)
  - Video cropping, aspect ratio, and PTZ controls
  - FTB (Fade to Black) and Audio Mute toggles
  - Matrix crosspoint routing (`POST /api/v1/matrix/route`)
- **How to provide the key:**
  - HTTP Header: `Authorization: Bearer <PIMATRIX_API_KEY>` or `X-API-Key: <PIMATRIX_API_KEY>`
  - Query String: `?key=<PIMATRIX_API_KEY>` or `?token=<PIMATRIX_API_KEY>`
- Read-only queries (`/health`, `/ready`, `/api/v1/status`, `/api/v1/sources`) remain accessible without credentials so status dashboards and monitors do not break.

### Dedicated Canva App Token (`PIMATRIX_CANVA_APP_TOKEN`)
- The Canva presentation app can be built with a hardcoded or configured token:
  ```env
  PIMATRIX_CANVA_APP_TOKEN=canva-secure-token-xyz
  ```
- Any request reaching `/canva/*` or `/api/v1/pipgm/canva/*` will accept either `PIMATRIX_CANVA_APP_TOKEN` or `PIMATRIX_API_KEY`.
- Canva CORS preflight `OPTIONS` requests are automatically permitted without credentials so browser-based integrations execute smoothly.

### AMX NetLinx TCP IP Whitelist (`PIMATRIX_AMX_ALLOWED_HOSTS`)
- Protects the line-oriented AMX TCP control port (default `6600`).
- Specify comma-separated IPv4 or IPv6 addresses permitted to send AMX commands:
  ```env
  PIMATRIX_AMX_ALLOWED_HOSTS=127.0.0.1,192.168.1.50
  ```
- If an unauthorized host connects, PiMatrix logs the attempt and drops the TCP connection immediately before processing any commands.

### MediaMTX Stream Password (`PIMATRIX_MEDIAMTX_PASSWORD`)
- Configure the stream publish key for your RTMP/SRT encoders:
  ```env
  PIMATRIX_MEDIAMTX_PASSWORD=my-stream-key
  ```
- In the Web UI, operators can click the **Stream Key** button in the header bar to view and copy the configured RTMP/RTSP ingest credentials directly into OBS Studio, vMix, or hardware encoders.

---

## 4. Client Applications Configuration

### Web UI
1. When `PIMATRIX_API_KEY` is enabled on the server, the Web UI automatically displays a password prompt modal upon loading or after an unauthorized request.
2. The user enters the password once; it is saved in browser `localStorage` (`pimatrix_auth_token`).
3. Subsequent REST API requests attach the token automatically via an Authorization header.
4. An **Auth / Lock** button in the top navigation bar allows operators to view auth status, change passwords, or lock/logout the console.

### Windows Companion App
1. The Companion application includes a **Key** field directly in the top header connection bar next to Target and Port.
2. The key is automatically persisted in `appsettings.json` under `PiMatrixApiKey`.
3. Background polling and manual commands send the key as an `Authorization: Bearer <key>` header with every HTTP request.

### Command Line Interface (CLI)
- Supply the key via option or environment variable:
  ```bash
  # Via CLI flag:
  pimatrix outputs route hdmi0 rtmp1 --api-key my-secret-key

  # Via environment variable:
  export PIMATRIX_API_KEY=my-secret-key
  pimatrix outputs route hdmi0 rtmp1
  ```
