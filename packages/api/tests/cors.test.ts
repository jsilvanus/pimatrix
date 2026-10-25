import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const ORIGIN = "http://kirkonpi.local:8080";

function appWithCors(value?: string) {
  return buildApp(
    loadConfig({
      PIMATRIX_MODE: "simulation",
      PIMATRIX_DISPLAY_MODE: "simulated",
      ...(value === undefined ? {} : { PIMATRIX_CORS_ORIGINS: value })
    })
  );
}

test("a preflight from a listed origin is answered before routing", async () => {
  const app = appWithCors(`${ORIGIN}, http://other.local`);
  try {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/outputs",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "authorization,content-type"
      }
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], ORIGIN);
    assert.match(String(res.headers["access-control-allow-methods"]), /PUT/);
    assert.match(String(res.headers["access-control-allow-headers"]), /Authorization/);
    assert.equal(res.headers.vary, "Origin");
  } finally {
    await app.close();
  }
});

test("a preflight from an unlisted origin gets no CORS headers", async () => {
  const app = appWithCors(ORIGIN);
  try {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/outputs",
      headers: { origin: "http://evil.example", "access-control-request-method": "PUT" }
    });
    assert.equal(res.headers["access-control-allow-origin"], undefined);
    assert.notEqual(res.statusCode, 204);
  } finally {
    await app.close();
  }
});

test("a GET from a listed origin echoes it back; an unlisted one gets nothing", async () => {
  const app = appWithCors(ORIGIN);
  try {
    const allowed = await app.inject({ method: "GET", url: "/api/v1/outputs", headers: { origin: ORIGIN } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.headers["access-control-allow-origin"], ORIGIN);

    const other = await app.inject({ method: "GET", url: "/api/v1/outputs", headers: { origin: "http://evil.example" } });
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  } finally {
    await app.close();
  }
});

test("without PIMATRIX_CORS_ORIGINS the API sends no CORS headers", async () => {
  const app = appWithCors();
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/outputs", headers: { origin: ORIGIN } });
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  } finally {
    await app.close();
  }
});

test("PIMATRIX_CORS_ORIGINS is parsed into a list", () => {
  const config = loadConfig({
    PIMATRIX_MODE: "simulation",
    PIMATRIX_DISPLAY_MODE: "simulated",
    PIMATRIX_CORS_ORIGINS: " http://a.local , http://b.local ,"
  });
  assert.deepEqual(config.corsOrigins, ["http://a.local", "http://b.local"]);
});
