import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

function appWithKey() {
  return buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_API_KEY: "topsecret123",
      PIMATRIX_DISPLAY_MODE: "simulated"
    })
  );
}

test("query-string tokens are no longer accepted for control points", async () => {
  const app = appWithKey();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/outputs/rtsp/no-such-output/source?token=topsecret123",
      payload: {}
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("header tokens are still accepted for control points", async () => {
  const app = appWithKey();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify",
      headers: { "x-api-key": "topsecret123" },
      payload: {}
    });
    assert.notEqual(res.statusCode, 401);
  } finally {
    await app.close();
  }
});
