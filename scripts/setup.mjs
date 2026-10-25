#!/usr/bin/env node

/**
 * PiMatrix Interactive Setup Wizard
 * Configures .env with interactive prompts, input validation, and automatic defaults.
 * Works interactively (TTY) and supports piped automated inputs (non-TTY).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");
const envExamplePath = path.join(rootDir, ".env.example");

// ANSI color helpers
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m"
};

function banner() {
  console.log(`
${c.cyan}${c.bold}================================================================${c.reset}
${c.green}${c.bold}                  PiMatrix Interactive Setup Wizard              ${c.reset}
${c.cyan}${c.bold}================================================================${c.reset}
This wizard configures your environment variables for AV control,
LAN operator whitelisting, external TLS with Let's Encrypt, and hardware.

${c.dim}• Press [Enter] on any question to accept the [default value].${c.reset}
${c.dim}• Type 'gen' on password prompts to generate a secure random key.${c.reset}
${c.cyan}================================================================${c.reset}
`);
}

function getLocalIps() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

function parseExistingEnv(filepath) {
  const result = {};
  if (!fs.existsSync(filepath)) return result;
  const content = fs.readFileSync(filepath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (val.includes(" #")) {
        val = val.slice(0, val.indexOf(" #")).trim();
      }
      result[key] = val;
    }
  }
  return result;
}

function generateSecret(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

async function createLineReader() {
  if (process.stdin.isTTY) {
    const rl = readlinePromises.createInterface({ input, output });
    return {
      ask: async (prompt) => {
        return await rl.question(prompt);
      },
      close: () => rl.close()
    };
  }

  // Non-TTY (piped input / automated script)
  const lines = [];
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
  }
  let index = 0;
  return {
    ask: async (prompt) => {
      process.stdout.write(prompt);
      if (index < lines.length) {
        const val = lines[index++];
        process.stdout.write(`${val}\n`);
        return val;
      }
      process.stdout.write("\n");
      return "";
    },
    close: () => {}
  };
}

async function ask(reader, question, defaultValue = "", options = {}) {
  const displayDefault = defaultValue ? ` ${c.dim}[${defaultValue}]${c.reset}` : "";
  const prompt = `${c.bold}${question}${displayDefault}: ${c.reset}`;
  const raw = await reader.ask(prompt);
  const answer = (raw ?? "").trim();

  if (answer.toLowerCase() === "gen") {
    const generated = generateSecret(options.secretBytes || 16);
    console.log(`   ${c.green}➜ Generated: ${generated}${c.reset}`);
    return generated;
  }

  return answer !== "" ? answer : defaultValue;
}

async function askYesNo(reader, question, defaultBool = true) {
  const hint = defaultBool ? "Y/n" : "y/N";
  const displayDefault = ` ${c.dim}[${hint}]${c.reset}`;
  const prompt = `${c.bold}${question}${displayDefault}: ${c.reset}`;
  const raw = await reader.ask(prompt);
  const answer = (raw ?? "").trim().toLowerCase();

  if (answer === "") return defaultBool;
  return answer === "y" || answer === "yes";
}

async function main() {
  banner();
  const reader = await createLineReader();

  try {
    const existing = parseExistingEnv(envPath);
    const localIps = getLocalIps();
    const primaryIp = localIps[0] || "127.0.0.1";
    console.log(`${c.dim}Detected local network IP: ${c.cyan}${primaryIp}${c.reset}\n`);

    const cfg = {};

    // -------------------------------------------------------------
    // Section 1: Core Runtime
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 1. Server Runtime & Operation Mode${c.reset}`);
    cfg.PIMATRIX_MODE = await ask(
      reader,
      "Runtime mode (simulation for mock hardware, production for live AV)",
      existing.PIMATRIX_MODE || "simulation"
    );
    cfg.PIMATRIX_HOST = await ask(
      reader,
      "Server bind address",
      existing.PIMATRIX_HOST || "0.0.0.0"
    );
    cfg.PIMATRIX_PORT = await ask(
      reader,
      "Server HTTP port",
      existing.PIMATRIX_PORT || "3000"
    );
    cfg.PIMATRIX_DISPLAY_MODE = await ask(
      reader,
      "Display mode (simulated, hardware, or disabled)",
      existing.PIMATRIX_DISPLAY_MODE || (cfg.PIMATRIX_MODE === "simulation" ? "simulated" : "hardware")
    );

    console.log();

    // -------------------------------------------------------------
    // Section 2: Security, Passwords & LAN Whitelist
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 2. Security & Control Point Access Control${c.reset}`);
    console.log(`${c.dim}   (Type 'gen' to create random strong keys, or leave blank to disable)${c.reset}`);
    
    cfg.PIMATRIX_API_KEY = await ask(
      reader,
      "API Key / Admin Password for control operations",
      existing.PIMATRIX_API_KEY || "gen"
    );

    const defaultAuthAllowed = existing.PIMATRIX_AUTH_ALLOWED_HOSTS || (primaryIp !== "127.0.0.1" ? `127.0.0.1, ${primaryIp}` : "127.0.0.1");
    cfg.PIMATRIX_AUTH_ALLOWED_HOSTS = await ask(
      reader,
      "LAN Operator IP Whitelist (comma-separated IPs/subnets exempt from password)",
      defaultAuthAllowed
    );

    cfg.PIMATRIX_AMX_ALLOWED_HOSTS = await ask(
      reader,
      "AMX TCP listener allowed IP whitelist",
      existing.PIMATRIX_AMX_ALLOWED_HOSTS || "127.0.0.1"
    );

    cfg.PIMATRIX_MEDIAMTX_PASSWORD = await ask(
      reader,
      "MediaMTX RTMP/RTSP ingest password (stream key)",
      existing.PIMATRIX_MEDIAMTX_PASSWORD || "gen"
    );

    console.log();

    // -------------------------------------------------------------
    // Section 3: External Domain & TLS (Remote Access)
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 3. External Domain & TLS (Let's Encrypt Reverse Proxy)${c.reset}`);
    const setupDomain = await askYesNo(
      reader,
      "Do you want to configure the external TLS reverse proxy?",
      Boolean(existing.PIMATRIX_DOMAIN || false)
    );

    if (setupDomain) {
      cfg.PIMATRIX_DOMAIN = await ask(
        reader,
        "Domain name pointing to your router's WAN IP (e.g. matrix.keskuskirkko.fi)",
        existing.PIMATRIX_DOMAIN || ""
      );
      cfg.LETSENCRYPT_EMAIL = await ask(
        reader,
        "Email address for Let's Encrypt certificate renewal alerts",
        existing.LETSENCRYPT_EMAIL || (cfg.PIMATRIX_DOMAIN ? `av-admin@${cfg.PIMATRIX_DOMAIN}` : "")
      );
      cfg.PIMATRIX_TLS_PORT = await ask(
        reader,
        "External WAN TLS listening port",
        existing.PIMATRIX_TLS_PORT || "8443"
      );
      const isStaging = await askYesNo(
        reader,
        "Use Let's Encrypt Staging environment (recommended for initial setup/testing)?",
        existing.CERTBOT_STAGING === "true"
      );
      cfg.CERTBOT_STAGING = isStaging ? "true" : "false";

      const restrictWan = await askYesNo(
        reader,
        "Keep the WAN port closed (blocks the admin UI and matrix from the internet)?",
        existing.RESTRICT_WAN !== "false"
      );
      cfg.RESTRICT_WAN = restrictWan ? "true" : "false";
    } else {
      cfg.PIMATRIX_DOMAIN = "";
      cfg.LETSENCRYPT_EMAIL = "";
      cfg.PIMATRIX_TLS_PORT = "8443";
      cfg.CERTBOT_STAGING = "false";
      cfg.RESTRICT_WAN = "true";
    }

    console.log();

    // -------------------------------------------------------------
    // Section 4: MediaMTX & Streaming URLs
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 4. MediaMTX Streaming Integration${c.reset}`);
    cfg.PIMATRIX_MEDIAMTX_API_URL = await ask(
      reader,
      "MediaMTX API URL",
      existing.PIMATRIX_MEDIAMTX_API_URL || "http://127.0.0.1:9997"
    );
    cfg.PIMATRIX_PREVIEW_BASE_URL = await ask(
      reader,
      "MediaMTX WebRTC preview base URL (reachable by operator browsers)",
      existing.PIMATRIX_PREVIEW_BASE_URL || `http://${primaryIp}:8889`
    );

    console.log();

    // -------------------------------------------------------------
    // Section 5: AMX NetLinx TCP Integration
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 5. AMX NetLinx Integration${c.reset}`);
    const amxEnabled = await askYesNo(
      reader,
      "Enable inbound AMX TCP control listener (port 6600)?",
      existing.PIMATRIX_AMX_TCP_ENABLED !== "false"
    );
    cfg.PIMATRIX_AMX_TCP_ENABLED = amxEnabled ? "true" : "false";
    if (amxEnabled) {
      cfg.PIMATRIX_AMX_TCP_HOST = await ask(
        reader,
        "AMX TCP listener host",
        existing.PIMATRIX_AMX_TCP_HOST || "0.0.0.0"
      );
      cfg.PIMATRIX_AMX_TCP_PORT = await ask(
        reader,
        "AMX TCP listener port",
        existing.PIMATRIX_AMX_TCP_PORT || "6600"
      );
      const amxSim = await askYesNo(
        reader,
        "Simulate outbound AMX NetLinx master?",
        existing.PIMATRIX_AMX_SIMULATED !== "false"
      );
      cfg.PIMATRIX_AMX_SIMULATED = amxSim ? "true" : "false";
      if (!amxSim) {
        cfg.PIMATRIX_AMX_MASTER_HOST = await ask(
          reader,
          "Target AMX Master IP address",
          existing.PIMATRIX_AMX_MASTER_HOST || "192.168.1.50"
        );
        cfg.PIMATRIX_AMX_MASTER_PORT = await ask(
          reader,
          "Target AMX Master port",
          existing.PIMATRIX_AMX_MASTER_PORT || "6501"
        );
      }
    }

    console.log();

    // -------------------------------------------------------------
    // Section 6: PTZ Cameras & Hardware Capture
    // -------------------------------------------------------------
    console.log(`${c.cyan}${c.bold}▶ 6. PTZ Cameras & Hama Capture Stick${c.reset}`);
    cfg.PIMATRIX_CAMERA_MODE = await ask(
      reader,
      "Camera mode (simulated or hardware)",
      existing.PIMATRIX_CAMERA_MODE || "simulated"
    );
    if (cfg.PIMATRIX_CAMERA_MODE === "hardware") {
      cfg.PIMATRIX_CAM1_NAME = await ask(reader, "Camera 1 display name", existing.PIMATRIX_CAM1_NAME || "Pulpit PTZ");
      cfg.PIMATRIX_CAM1_HOST = await ask(reader, "Camera 1 IP address", existing.PIMATRIX_CAM1_HOST || "192.168.1.101");
      cfg.PIMATRIX_CAM2_NAME = await ask(reader, "Camera 2 display name", existing.PIMATRIX_CAM2_NAME || "Altar PTZ");
      cfg.PIMATRIX_CAM2_HOST = await ask(reader, "Camera 2 IP address", existing.PIMATRIX_CAM2_HOST || "192.168.1.102");
    }

    const hamaEnabled = await askYesNo(
      reader,
      "Enable Hama USB Capture Card stream (/dev/video0)?",
      existing.PIMATRIX_HAMA_ENABLED === "true"
    );
    cfg.PIMATRIX_HAMA_ENABLED = hamaEnabled ? "true" : "false";
    if (hamaEnabled) {
      cfg.PIMATRIX_HAMA_DEVICE = await ask(
        reader,
        "Hama V4L2 device path",
        existing.PIMATRIX_HAMA_DEVICE || "/dev/video0"
      );
      cfg.PIMATRIX_HAMA_RTSP_URL = await ask(
        reader,
        "MediaMTX RTSP publish URL for Hama stream",
        existing.PIMATRIX_HAMA_RTSP_URL || "rtsp://127.0.0.1:8554/hama"
      );
    }

    console.log();

    // -------------------------------------------------------------
    // Review and Save
    // -------------------------------------------------------------
    console.log(`${c.yellow}${c.bold}================================================================${c.reset}`);
    console.log(`${c.yellow}${c.bold}                 Configuration Summary                          ${c.reset}`);
    console.log(`${c.yellow}${c.bold}================================================================${c.reset}`);
    for (const [k, v] of Object.entries(cfg)) {
      if (v) {
        console.log(`  ${c.cyan}${k.padEnd(28)}${c.reset} = ${c.green}${v}${c.reset}`);
      }
    }
    console.log(`${c.yellow}================================================================${c.reset}\n`);

    const saveConfirm = await askYesNo(reader, "Write these settings to .env?", true);
    if (!saveConfirm) {
      console.log(`${c.red}Aborted. No changes were written.${c.reset}`);
      return;
    }

    // Backup existing .env if it exists
    if (fs.existsSync(envPath)) {
      const backupPath = `${envPath}.bak.${Date.now()}`;
      fs.copyFileSync(envPath, backupPath);
      console.log(`\n${c.dim}Backed up previous .env to: ${backupPath}${c.reset}`);
    }

    // Build .env content
    const envLines = [
      "# PiMatrix Environment Configuration",
      `# Generated interactively on ${new Date().toISOString()}`,
      "",
      "# ==========================================",
      "# Server Runtime",
      "# ==========================================",
      `PIMATRIX_HOST=${cfg.PIMATRIX_HOST}`,
      `PIMATRIX_PORT=${cfg.PIMATRIX_PORT}`,
      `PIMATRIX_MODE=${cfg.PIMATRIX_MODE}`,
      `PIMATRIX_DISPLAY_MODE=${cfg.PIMATRIX_DISPLAY_MODE}`,
      "",
      "# ==========================================",
      "# Security & Access Control",
      "# ==========================================",
      `PIMATRIX_API_KEY=${cfg.PIMATRIX_API_KEY || ""}`,
      `PIMATRIX_AUTH_ALLOWED_HOSTS=${cfg.PIMATRIX_AUTH_ALLOWED_HOSTS || ""}`,
      `PIMATRIX_AMX_ALLOWED_HOSTS=${cfg.PIMATRIX_AMX_ALLOWED_HOSTS || ""}`,
      `PIMATRIX_MEDIAMTX_PASSWORD=${cfg.PIMATRIX_MEDIAMTX_PASSWORD || ""}`,
      "",
      "# ==========================================",
      "# External Domain & TLS (Nginx + Certbot)",
      "# ==========================================",
      `PIMATRIX_DOMAIN=${cfg.PIMATRIX_DOMAIN || ""}`,
      `LETSENCRYPT_EMAIL=${cfg.LETSENCRYPT_EMAIL || ""}`,
      `PIMATRIX_TLS_PORT=${cfg.PIMATRIX_TLS_PORT || "8443"}`,
      `CERTBOT_STAGING=${cfg.CERTBOT_STAGING || "false"}`,
      `RESTRICT_WAN=${cfg.RESTRICT_WAN || "true"}`,
      "",
      "# ==========================================",
      "# MediaMTX Streaming",
      "# ==========================================",
      `PIMATRIX_MEDIAMTX_API_URL=${cfg.PIMATRIX_MEDIAMTX_API_URL || "http://127.0.0.1:9997"}`,
      `PIMATRIX_PREVIEW_BASE_URL=${cfg.PIMATRIX_PREVIEW_BASE_URL || `http://${primaryIp}:8889`}`,
      "",
      "# ==========================================",
      "# AMX NetLinx Integration",
      "# ==========================================",
      `PIMATRIX_AMX_TCP_ENABLED=${cfg.PIMATRIX_AMX_TCP_ENABLED || "true"}`,
      `PIMATRIX_AMX_TCP_HOST=${cfg.PIMATRIX_AMX_TCP_HOST || "0.0.0.0"}`,
      `PIMATRIX_AMX_TCP_PORT=${cfg.PIMATRIX_AMX_TCP_PORT || "6600"}`,
      `PIMATRIX_AMX_SIMULATED=${cfg.PIMATRIX_AMX_SIMULATED || "true"}`
    ];

    if (cfg.PIMATRIX_AMX_MASTER_HOST) {
      envLines.push(`PIMATRIX_AMX_MASTER_HOST=${cfg.PIMATRIX_AMX_MASTER_HOST}`);
      envLines.push(`PIMATRIX_AMX_MASTER_PORT=${cfg.PIMATRIX_AMX_MASTER_PORT || "6501"}`);
    }

    envLines.push(
      "",
      "# ==========================================",
      "# PTZ Cameras",
      "# ==========================================",
      `PIMATRIX_CAMERA_MODE=${cfg.PIMATRIX_CAMERA_MODE || "simulated"}`
    );

    if (cfg.PIMATRIX_CAM1_HOST) {
      envLines.push(`PIMATRIX_CAM1_NAME=${cfg.PIMATRIX_CAM1_NAME || "Camera 1"}`);
      envLines.push(`PIMATRIX_CAM1_HOST=${cfg.PIMATRIX_CAM1_HOST}`);
    }
    if (cfg.PIMATRIX_CAM2_HOST) {
      envLines.push(`PIMATRIX_CAM2_NAME=${cfg.PIMATRIX_CAM2_NAME || "Camera 2"}`);
      envLines.push(`PIMATRIX_CAM2_HOST=${cfg.PIMATRIX_CAM2_HOST}`);
    }

    envLines.push(
      "",
      "# ==========================================",
      "# Hama USB Capture Card",
      "# =========================================="
    );
    envLines.push(`PIMATRIX_HAMA_ENABLED=${cfg.PIMATRIX_HAMA_ENABLED || "false"}`);
    if (cfg.PIMATRIX_HAMA_ENABLED === "true") {
      envLines.push(`PIMATRIX_HAMA_DEVICE=${cfg.PIMATRIX_HAMA_DEVICE || "/dev/video0"}`);
      envLines.push(`PIMATRIX_HAMA_RTSP_URL=${cfg.PIMATRIX_HAMA_RTSP_URL || "rtsp://127.0.0.1:8554/hama"}`);
    }

    envLines.push("");

    fs.writeFileSync(envPath, envLines.join("\n"), "utf8");
    console.log(`\n${c.green}${c.bold}✔ .env file created successfully!${c.reset}\n`);

    console.log(`${c.cyan}${c.bold}Next steps:${c.reset}`);
    console.log(`  ${c.bold}Start locally:${c.reset}           npm run dev`);
    console.log(`  ${c.bold}Start full Docker stack:${c.reset} docker compose up -d`);
    console.log(`  ${c.bold}Start TLS reverse proxy:${c.reset} docker compose -f deploy/tls-proxy/compose.yaml up -d`);
    console.log();
  } finally {
    reader.close();
  }
}

main().catch((err) => {
  console.error(`${c.red}Setup error: ${err.message}${c.reset}`);
  process.exit(1);
});
