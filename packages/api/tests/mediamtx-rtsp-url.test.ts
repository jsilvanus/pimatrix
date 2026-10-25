import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("PIMATRIX_MEDIAMTX_RTSP_URL is is read as given and is not derived from the preview URL", () => {
  assert.equal(loadConfig({}).mediaMtxRtspUrl, undefined);
  assert.equal(
    loadConfig({ PIMATRIX_MEDIAMTX_RTSP_URL: "rtsp://192.0.2.10:8554/" }).mediaMtxRtspUrl,
    "rtsp://192.0.2.10:8554/"
  );
  assert.equal(loadConfig({ PIMATRIX_PREVIEW_BASE_URL: "http://kirkonpi.local:8889" }).mediaMtxRtspUrl, undefined);
});
