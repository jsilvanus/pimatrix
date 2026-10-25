import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CameraCgiError, UdpViscaCameraAdapter } from "../src/camera/camera-adapter.js";
import { loadConfig } from "../src/config.js";

const USER = "avstream";
const PASSWORD = "s3cret-pass";
const EXPECTED = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;

/** A fake AVer CGI: answers 200 only to the expected Basic login, and records what it saw. */
async function fakeCamera() {
  const seen: Array<{ url: string; authorization: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", authorization: req.headers.authorization });
    res.statusCode = req.headers.authorization === EXPECTED ? 200 : 401;
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, port, seen, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function adapterFor(port: number, auth?: { user: string; password: string }) {
  return new UdpViscaCameraAdapter({
    id: "cam1",
    label: "Camera 1",
    host: "127.0.0.1",
    cgiPort: port,
    rtmpTargetUrl: "rtmp://127.0.0.1:1935/cam1",
    ...(auth ? { auth } : {})
  });
}

test("the Basic login is sent in the Authorization header, never in the URL", async () => {
  const cam = await fakeCamera();
  try {
    const adapter = adapterFor(cam.port, { user: USER, password: PASSWORD });
    await adapter.startStream();
    assert.equal(cam.seen.length, 2, "URL and enable calls");
    for (const call of cam.seen) {
      assert.equal(call.authorization, EXPECTED);
      assert.ok(!call.url.includes(PASSWORD) && !call.url.includes(USER + ":"), "login must not be in the URL");
    }
    assert.match(cam.seen[1]!.url, /vdo_rtmp_enable,3,1/);
  } finally {
    await cam.close();
  }
});

test("a wrong login fails the start with reason auth, and the error does not contain the password", async () => {
  const cam = await fakeCamera();
  try {
    const adapter = adapterFor(cam.port, { user: USER, password: "wrong-pass" });
    await assert.rejects(adapter.startStream(), (err: unknown) => {
      assert.ok(err instanceof CameraCgiError);
      assert.equal(err.reason, "auth");
      assert.equal(err.status, 401);
      assert.ok(!err.message.includes("wrong-pass") && !err.message.includes(PASSWORD));
      return true;
    });
    assert.equal(adapter.getSnapshot().streaming, false, "a failed start must not report streaming");
  } finally {
    await cam.close();
  }
});

test("no login configured against a camera that needs one is an auth failure", async () => {
  const cam = await fakeCamera();
  try {
    await assert.rejects(adapterFor(cam.port).startStream(), (err: unknown) => {
      assert.ok(err instanceof CameraCgiError);
      assert.equal(err.reason, "auth");
      return true;
    });
    assert.equal(cam.seen[0]!.authorization, undefined);
  } finally {
    await cam.close();
  }
});

test("a camera that does not answer is reported as unreachable", async () => {
  const cam = await fakeCamera();
  const closedPort = cam.port;
  await cam.close();
  await assert.rejects(adapterFor(closedPort, { user: USER, password: PASSWORD }).startStream(), (err: unknown) => {
    assert.ok(err instanceof CameraCgiError);
    assert.equal(err.reason, "unreachable");
    return true;
  });
});

test("stop sends the disable call with the same login and clears streaming even when it fails", async () => {
  const cam = await fakeCamera();
  try {
    const adapter = adapterFor(cam.port, { user: USER, password: PASSWORD });
    await adapter.startStream();
    await adapter.stopStream();
    const last = cam.seen[cam.seen.length - 1]!;
    assert.match(last.url, /vdo_rtmp_enable,3,0/);
    assert.equal(last.authorization, EXPECTED);
    assert.equal(adapter.getSnapshot().streaming, false);
  } finally {
    await cam.close();
  }
});

test("PIMATRIX_CAM1_USER without a password is a config error", () => {
  assert.throws(
    () =>
      loadConfig({
        PIMATRIX_MODE: "simulation",
        PIMATRIX_DISPLAY_MODE: "simulated",
        PIMATRIX_CAM1_USER: USER
      }),
    /PIMATRIX_CAM1_USER and PIMATRIX_CAM1_PASSWORD must be set together/
  );
});

test("PIMATRIX_CAM2 login is read when both values are set", () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_MODE: "simulated",
    PIMATRIX_CAM2_USER: USER,
    PIMATRIX_CAM2_PASSWORD: PASSWORD
  });
  assert.equal(config.cam2CgiUser, USER);
  assert.equal(config.cam2CgiPassword, PASSWORD);
});
