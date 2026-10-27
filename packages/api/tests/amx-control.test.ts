import assert from "node:assert/strict";
import { Socket } from "node:net";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

async function withAmx(run: (send: (cmd: string) => Promise<string>, http: ReturnType<typeof buildApp>) => Promise<void>) {
  const dir = await import("node:fs").then((fs) => fs.mkdtempSync("/tmp/pimatrix-amx-"));
  const app = buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_SIMULATED: "true",
      PIMATRIX_AMX_TCP_ENABLED: "true",
      PIMATRIX_AMX_TCP_PORT: "0",
      PIMATRIX_QUICK_OPTIONS_FILE: `${dir}/quick.json`
    })
  );
  await app.ready();
  const port = (app as unknown as { amxListener: { port: number } }).amxListener.port;
  const client = new Socket();
  client.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    client.connect(port, "127.0.0.1", () => resolve());
    client.on("error", reject);
  });
  const send = (cmd: string): Promise<string> =>
    new Promise((resolve) => {
      client.once("data", (chunk: string) => resolve(chunk.trim()));
      client.write(`${cmd};\r\n`);
    });
  try {
    await run(send, app);
  } finally {
    client.destroy();
    await app.close();
  }
}

test("AMX TCP: camera commands are answered by pigateway, not here", async () => {
  await withAmx(async (send) => {
    assert.equal(await send("CAM:cam1:POWER:OFF"), "ERR:CAM_UNAVAILABLE;");
    assert.equal(await send("r7:CAM:LIST"), "r7:ERR:CAM_UNAVAILABLE;");
  });
});

test("AMX TCP: quick options by number, program and STATUS:ALL", async () => {
  await withAmx(async (send, app) => {
    const post = async (name: string, number?: number) =>
      app.inject({ method: "POST", url: "/api/v1/quick-options", payload: number ? { name, number } : { name } });
    const first = await post("Messu");
    assert.equal(first.json().number, 1);
    assert.equal((await post("Saarna", 5)).json().number, 5);
    assert.equal((await post("Toinen")).json().number, 2);
    assert.equal((await post("Sama numero", 5)).statusCode, 409);
    assert.equal((await post("Huono numero", 100)).statusCode, 422);

    assert.equal(await send("QUICK:LIST"), "QUICK:LIST:1=Messu,5=Saarna,2=Toinen;");
    assert.equal(await send("QUICK:RUN:5"), "QUICK:OK:5;");
    assert.equal(await send("QUICK:RUN:9"), "ERR:QUICK_NOT_FOUND:9;");
    const byNumber = await app.inject({ method: "POST", url: "/api/v1/quick-options/number/1/apply" });
    assert.equal(byNumber.statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/quick-options/number/42/apply" })).statusCode, 404);

    // piprogram is not configured in this test
    assert.equal(await send("PROGRAM:OFF"), "ERR:PROGRAM_UNAVAILABLE;");

    const all = await send("STATUS:ALL");
    assert.match(all, /^STATUS:ALL:mode=simulation,hdmi0=none,hdmi0state=unavailable,hdmi1=none,/);
    assert.doesNotMatch(all, /cam1pwr|atlona/, "camera and Atlona fields are added by pigateway");
    assert.match(all, /program=unavailable;$/);
  });
});
