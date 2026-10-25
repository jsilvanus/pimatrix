import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("PIMATRIX_MEDIAMTX_RTMP_URL is optional and kept without a trailing slash", () => {
  assert.equal(loadConfig({}).mediaMtxRtmpUrl, undefined);
  assert.equal(
    loadConfig({ PIMATRIX_MEDIAMTX_RTMP_URL: " rtmp://192.168.1.10:1935/ " }).mediaMtxRtmpUrl,
    "rtmp://192.168.1.10:1935"
  );
});

test("PIMATRIX_MEDIAMTX_RTMP_URL is not derived from the preview base URL", () => {
  const config = loadConfig({ PIMATRIX_PREVIEW_BASE_URL: "http://kirkonpi.local:8889" });
  assert.equal(config.mediaMtxRtmpUrl, undefined);
});

test("PIMATRIX_MEDIAMTX_RTMP_URL rejects other schemes, credentials and queries", () => {
  assert.throws(() => loadConfig({ PIMATRIX_MEDIAMTX_RTMP_URL: "rtsp://192.168.1.10:8554" }), /PIMATRIX_MEDIAMTX_RTMP_URL/);
  assert.throws(() => loadConfig({ PIMATRIX_MEDIAMTX_RTMP_URL: "rtmp://user:pw@192.168.1.10:1935" }), /PIMATRIX_MEDIAMTX_RTMP_URL/);
  assert.throws(() => loadConfig({ PIMATRIX_MEDIAMTX_RTMP_URL: "rtmp://192.168.1.10:1935/?key=x" }), /PIMATRIX_MEDIAMTX_RTMP_URL/);
});
