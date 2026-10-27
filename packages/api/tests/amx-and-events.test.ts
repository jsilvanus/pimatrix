import assert from "node:assert/strict";
import { Socket } from "node:net";
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
