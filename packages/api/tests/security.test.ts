import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("control points require authentication when PIMATRIX_API_KEY is configured", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_API_KEY: "topsecret123",
      PIMATRIX_DISPLAY_MODE: "simulated"
    })
  );

  try {
    // 1. Read endpoints should be public
    const health = await app.inject("/health");
    assert.equal(health.statusCode, 200);

    const status = await app.inject("/api/v1/status");
    assert.equal(status.statusCode, 200);

    const authStatus = await app.inject("/api/v1/auth/status");
    assert.equal(authStatus.statusCode, 200);
    assert.equal(authStatus.json().authRequired, true);

    // 2. Control point without auth should be rejected
    const unauthRoute = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: "rtmp1" }
    });
    assert.equal(unauthRoute.statusCode, 401);
    assert.equal(unauthRoute.json().error, "Unauthorized");

    // 3. Control point with wrong key should be rejected
    const badKeyRoute = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      headers: { authorization: "Bearer wrongkey" },
      payload: { sourceId: "rtmp1" }
    });
    assert.equal(badKeyRoute.statusCode, 401);

    // 4. Control point with valid Bearer token should succeed
    const validBearer = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      headers: { authorization: "Bearer topsecret123" },
      payload: { sourceId: "rtmp1" }
    });
    assert.equal(validBearer.statusCode, 202);

    // 5. Control point with x-api-key header should succeed
    const validHeader = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      headers: { "x-api-key": "topsecret123" },
      payload: { sourceId: "cam1" }
    });
    assert.equal(validHeader.statusCode, 202);

    // 6. Verify auth endpoint
    const verifyGood = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { key: "topsecret123" }
    });
    assert.equal(verifyGood.statusCode, 200);
    assert.equal(verifyGood.json().valid, true);

    const verifyBad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      payload: { key: "wrong" }
    });
    assert.equal(verifyBad.statusCode, 401);
    assert.equal(verifyBad.json().valid, false);
  } finally {
    await app.close();
  }
});

test("canva app token authenticates canva control endpoints", async () => {
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_API_KEY: "admin-key",
      PIMATRIX_CANVA_APP_TOKEN: "canva-secret-token"
    })
  );

  try {
    // Unauthenticated Canva request rejected
    const unauth = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      payload: { action: "next" }
    });
    assert.equal(unauth.statusCode, 401);

    // Canva token authenticated
    const withCanvaToken = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      headers: { authorization: "Bearer canva-secret-token" },
      payload: { action: "next" }
    });
    assert.equal(withCanvaToken.statusCode, 200);

    // Admin API key also accepted for Canva routes
    const withAdminKey = await app.inject({
      method: "POST",
      url: "/api/v1/pipgm/canva/control",
      headers: { authorization: "Bearer admin-key" },
      payload: { action: "next" }
    });
    assert.equal(withAdminKey.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("AMX TCP listener enforces IP whitelist", async () => {
  // 1. When non-whitelisted IP connects, socket is closed immediately
  const blockedApp = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_AMX_TCP_ENABLED: "true",
      PIMATRIX_AMX_TCP_HOST: "127.0.0.1",
      PIMATRIX_AMX_TCP_PORT: 0,
      PIMATRIX_AMX_ALLOWED_HOSTS: "192.168.1.99" // 127.0.0.1 not allowed
    })
  );

  await blockedApp.ready();
  const blockedListener = (blockedApp as unknown as { amxListener: { port: number } }).amxListener;
  const blockedPort = blockedListener.port;

  const { Socket } = await import("node:net");
  const blockedClient = new Socket();

  const closed = await new Promise<boolean>((resolve) => {
    blockedClient.connect(blockedPort, "127.0.0.1", () => {
      // Connected, but server should destroy it immediately
    });
    blockedClient.on("close", () => resolve(true));
    blockedClient.on("error", () => resolve(true));
    setTimeout(() => resolve(false), 500);
  });
  blockedClient.destroy();
  await blockedApp.close();
  assert.equal(closed, true);

  // 2. When whitelisted, connection is accepted
  const allowedApp = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_AMX_TCP_ENABLED: "true",
      PIMATRIX_AMX_TCP_HOST: "127.0.0.1",
      PIMATRIX_AMX_TCP_PORT: 0,
      PIMATRIX_AMX_ALLOWED_HOSTS: "127.0.0.1"
    })
  );

  await allowedApp.ready();
  const allowedListener = (allowedApp as unknown as { amxListener: { port: number } }).amxListener;
  const allowedPort = allowedListener.port;

  const allowedClient = new Socket();
  allowedClient.setEncoding("utf8");

  await new Promise<void>((resolve, reject) => {
    allowedClient.connect(allowedPort, "127.0.0.1", () => resolve());
    allowedClient.on("error", reject);
  });

  const reply = await new Promise<string>((resolve) => {
    allowedClient.once("data", (data: string) => resolve(data.trim()));
    allowedClient.write("PING;\r\n");
  });

  allowedClient.destroy();
  await allowedApp.close();
  assert.equal(reply, "PONG;");
});
