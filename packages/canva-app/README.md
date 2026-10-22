# PiMatrix Canva App Plugin

Official Canva App Plugin for the **PiMatrix** AV Control System at Riihimäen Keskuskirkko.

Built with the [Canva Apps SDK](https://www.canva.dev/docs/apps/) (`@canva/app-ui-kit`, `@canva/design`) and React + Vite.

---

## 1. Capabilities & Architecture

The PiMatrix Canva App runs directly inside the Canva editor side panel or modal, providing seamless broadcast integration:

1. **Host Configuration & Dual Network Profiles**:
   - **LAN (Sanctuary Wi-Fi / Local Network)**: Default `http://192.168.1.100:3000` or `http://127.0.0.1:3000`.
   - **Internet / WAN (Router Port Forwarding)**: e.g. `http://yourchurch.dyndns.org:3000` or `https://pimatrix.church.fi`.
   - Quick 1-click toggle between `[ 🏠 Sanctuary LAN ]` and `[ 🌐 Internet (WAN) ]`.
   - Automatic cross-network availability detection (suggests switching if the other endpoint is online).
   - Real-time bidirectional synchronization with stage playback via Server-Sent Events (SSE on `/api/v1/events`).

2. **Team-Only Scoped Security**:
   - Protected with a Canva Secret Key / Shared Bearer token (`PIMATRIX_CANVA_SECRET_TOKEN`).
   - When exposed to the Internet via router port forwarding, only authorized team members with the Canva app can trigger push and control actions.

3. **Screen Formats & Aspect Ratios (Native Church Orientation Support)**:
   - Program 1 in the sanctuary is **usually vertical / portrait** (projector/podium screens).
   - The plugin provides 4 one-click screen format choices on push:
     - **Vertical 9:16 (1080×1920)**: Default standard mobile stream and vertical sanctuary displays.
     - **10:16 Sanctuary (1200×1920)**: Native resolution for Riihimäen Keskuskirkko's rotated Epson church projector.
     - **Landscape 16:9 (1920×1080)**: Standard wide monitors and landscape overflow feeds.
     - **Custom Resolution (W × H)**: Custom pixel dimensions with live target orientation calculation.

4. **Push Presentation to Air & Library**:
   - **Push to Program 1 (Sanctuary)**: Directly cues and routes to the church sanctuary projectors (`targetPipelineId: "PiPGM1"`), dynamically applying the chosen screen format (Vertical 9:16, 10:16 Epson, Landscape 16:9, or Custom).
   - **Push to Program 2 (Mobile 9:16 Portrait)**: Formats and cues to the vertical live stream (`targetPipelineId: "PiPGM2"`).
   - **Push to Program 3 (Auxiliary / Overflow)**: Cues to the auxiliary/overflow foyer feeds (`targetPipelineId: "PiPGM3"`).
   - **Save to Library (Store Only)**: Pushes Canva design metadata (`designId`, `title`, `embedUrl`, `pageCount`) without changing what's on air.
   - **Render Modes**: Switch between `Canva Live Embed` (interactive iframe), `PNG Slide Deck` (high reliability cached static slides), and `MP4 Video` (video playback).
   - **Canva Native Export**: Export slide decks directly via Canva Apps SDK `requestExport({ acceptedFileTypes: ["png", "video"] })`.

5. **Live Remote Control Console**:
   - **Pipeline Target Selector**: Toggle between `Auto (By Active Design)`, `Program 1`, `Program 2`, `Program 3`, or `All Sync`.
   - **Fade to Black (FTB)**: Instant church blackout toggle with glowing red indicator (`action: "ftb"`).
   - **Audio Mute/Unmute**: Independent master audio toggle for the presentation (`action: "mute"`).
   - **Slide Navigation**: Large `PREV` and `NEXT` slide step buttons (`action: "prev"` / `action: "next"`).
   - **Direct Slide Jump**: Interactive page number buttons jumping directly to slide $n$ (`action: "gotoPage"`).
   - **Playback Controls**: `Play`, `Pause`, `Stop`, and `Restart` for video modes.
   - **Render Mode Toggle**: Dynamic live switching of active rendering engine (`action: "mode"`).

---

## 2. Build-Time Configuration for Team-Only App

You can configure the plugin branding, default addresses, and team security token when compiling the application.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_PLUGIN_NAME` | Display name of the plugin inside Canva | `PiMatrix Canva App` |
| `VITE_ORG_NAME` | Organization / Church name | `Riihimäen Keskuskirkko` |
| `VITE_LAN_URL` | Local network IP/hostname for sanctuary usage | `http://127.0.0.1:3000` |
| `VITE_WAN_URL` | Internet / Router forwarded address | *(empty)* |
| `VITE_CANVA_SECRET_TOKEN` | Shared team secret token for Internet authorization | *(empty)* |
| `VITE_DEFAULT_PROFILE` | Default network profile (`lan` or `wan`) | `lan` |

### Example Build Command

```bash
# Custom build for your church team:
VITE_PLUGIN_NAME="Keskuskirkko Live Canva" \
VITE_ORG_NAME="Riihimäen Keskuskirkko" \
VITE_LAN_URL="http://192.168.1.100:3000" \
VITE_WAN_URL="http://keskuskirkko.dyndns.org:3000" \
VITE_CANVA_SECRET_TOKEN="keskuskirkko-canva-secret-team" \
npm run build --workspace @pimatrix/canva-app
```

Or copy `.env.example` to `.env.local` in `packages/canva-app/` and run `npm run build`.

---

## 3. Router Port-Forwarding & Security Setup

To allow volunteers or pastors to control slides from home or outside the church network:

1. **Router Port Forwarding**:
   - In your church router, forward an external port (e.g. `3000` or `8443`) to the Raspberry Pi IP (e.g. `192.168.1.100:3000`).
2. **Restrict Access to Canva Control Only**:
   - Set `PIMATRIX_CANVA_SECRET_TOKEN="your-secure-token"` in the PiMatrix environment on the Pi.
   - The PiMatrix server will automatically reject any incoming push or control requests on `/api/v1/pipgm/canva/*` with `401 Unauthorized` unless the matching secret token is supplied in `Authorization: Bearer <token>` or `X-Canva-Secret: <token>`.
   - The Canva plugin automatically sends this token on all requests.

---

## 4. Development & Testing

```bash
# Start local development server
npm run dev --workspace @pimatrix/canva-app

# Run unit tests
npm test --workspace @pimatrix/canva-app

# Build for distribution
npm run build --workspace @pimatrix/canva-app
```
