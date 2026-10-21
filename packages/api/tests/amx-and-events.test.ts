import assert from "node:assert/strict";
import { createServer, Socket } from "node:net";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("simulated display adapter updates observed source and active state", async () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_SIMULATED: "true"
  });
  const app = buildApp(config);
  try {
    const ready = (await app.inject("/ready")).json();
    assert.equal(ready.checks.display, "simulated");

    const status = (await app.inject("/api/v1/status")).json();
    assert.equal(status.integrations.display, "simulated");

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: "hama" }
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().desiredSource, "hama");
    assert.equal(response.json().observedSource, "hama");
    assert.equal(response.json().state, "active");

    // Clearing source sets it back to unavailable
    const clear = await app.inject({
      method: "PUT",
      url: "/api/v1/outputs/hdmi0/source",
      payload: { sourceId: null }
    });
    assert.equal(clear.statusCode, 202);
    assert.equal(clear.json().desiredSource, null);
    assert.equal(clear.json().observedSource, null);
    assert.equal(clear.json().state, "unavailable");
  } finally {
    await app.close();
  }
});

test("SSE endpoint /api/v1/events emits initial ready event and route changes", async () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_SIMULATED: "true"
  });
  const app = buildApp(config);

  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/v1/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.includes("text/event-stream"));

    const reader = response.body?.getReader();
    assert.ok(reader);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(text.includes("event: ready"));
    assert.ok(text.includes('"status":"connected"'));

    controller.abort();
  } finally {
    await app.close();
  }
});

test("AMX TCP listener accepts line-framed commands and controls routes", async () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_SIMULATED: "true",
    PIMATRIX_AMX_TCP_ENABLED: "true",
    PIMATRIX_AMX_TCP_PORT: "0" // ephemeral port
  });
  const app = buildApp(config);

  await app.ready();

  const listener = (app as unknown as { amxListener: { port: number } }).amxListener;
  assert.ok(listener && listener.port > 0);
  const port = listener.port;

  const client = new Socket();
  client.setEncoding("utf8");

  await new Promise<void>((resolve, reject) => {
    client.connect(port, "127.0.0.1", () => resolve());
    client.on("error", reject);
  });

  const sendAndReceive = async (cmd: string): Promise<string> => {
    return new Promise((resolve) => {
      client.once("data", (chunk: string) => {
        resolve(chunk.trim());
      });
      client.write(cmd);
    });
  };

  try {
    // 1. DEV:VERSION
    const ver = await sendAndReceive("DEV:VERSION;\r\n");
    assert.equal(ver, "DEV:VERSION:1;");

    // 2. PING
    const pong = await sendAndReceive("PING;\r\n");
    assert.equal(pong, "PONG;");

    // 3. STATUS
    const status = await sendAndReceive("STATUS;\r\n");
    assert.ok(status.startsWith("STATUS:OK:mode=simulation"));

    // 4. OUTPUT:SET
    const setRes = await sendAndReceive("OUTPUT:SET:hdmi0:hama;\r\n");
    assert.equal(setRes, "OUTPUT:OK:hdmi0:hama;");

    // 5. OUTPUT:LIST
    const listRes = await sendAndReceive("OUTPUT:LIST;\r\n");
    assert.ok(listRes.includes("hdmi0=hama:hama:active"));

    // 6. With message ID
    const withId = await sendAndReceive("REQ42:PING;\r\n");
    assert.equal(withId, "REQ42:PONG;");

    // 7. Unknown command error
    const err = await sendAndReceive("NOT_A_COMMAND;\r\n");
    assert.ok(err.includes("ERR:UNKNOWN_COMMAND"));
  } finally {
    client.destroy();
    await app.close();
  }
});

test("AMX matrix route endpoint with simulated AMX client", async () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_AMX_SIMULATED: "true"
  });
  const app = buildApp(config);
  try {
    const status = (await app.inject("/api/v1/status")).json();
    assert.equal(status.integrations.amx, "simulated");

    const validRoute = await app.inject({
      method: "POST",
      url: "/api/v1/matrix/route",
      payload: { input: 2, output: 4 }
    });
    assert.equal(validRoute.statusCode, 200);
    assert.equal(validRoute.json().success, true);
    assert.equal(validRoute.json().input, 2);
    assert.equal(validRoute.json().output, 4);
    assert.equal(validRoute.json().confirmed, true);

    const invalidInput = await app.inject({
      method: "POST",
      url: "/api/v1/matrix/route",
      payload: { input: 9, output: 1 }
    });
    assert.equal(invalidInput.statusCode, 422);
  } finally {
    await app.close();
  }
});

test("AMX matrix route with TCP NetLinx mock master", async () => {
  // Spin up a mock NetLinx master
  let mockServerPort = 0;
  const mockServer = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      // Expect: ATLONA:ROUTE:<reqId>:<in>:<out>;
      const match = /ATLONA:ROUTE:([^:]+):(\d+):(\d+);/.exec(chunk);
      if (match) {
        const reqId = match[1];
        const input = match[2];
        const output = match[3];
        socket.write(`ATLONA:CONFIRMED:${reqId}:${input}:${output};\r\n`);
      }
    });
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, "127.0.0.1", () => {
      const addr = mockServer.address();
      if (addr && typeof addr === "object") mockServerPort = addr.port;
      resolve();
    });
  });

  const config = loadConfig({
    PIMATRIX_MODE: "production",
    PIMATRIX_AMX_MASTER_HOST: "127.0.0.1",
    PIMATRIX_AMX_MASTER_PORT: String(mockServerPort)
  });
  const app = buildApp(config);

  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/matrix/route",
      payload: { input: 3, output: 2 }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().confirmed, true);
    assert.equal(res.json().input, 3);
    assert.equal(res.json().output, 2);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});
