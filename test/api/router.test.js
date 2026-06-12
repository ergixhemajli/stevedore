/**
 * test/api/router.test.js
 *
 * Tests for the Docker API router — route matching, version stripping,
 * 404 handling, and access control for restricted commands.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

function makeMockRequest(method, url) {
  const req = {
    method,
    url,
    headers: {},
    on: () => req,
    once: () => req,
    off: () => req,
  };
  const res = {
    headersSent: false,
    writeHead: function (status, headers = {}) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end: function (data = "") {
      this.body = data;
      return this;
    },
    write: function (data) {
      this.body = (this.body ?? "") + data;
      return true;
    },
  };
  return { req, res };
}

describe("router — version stripping", () => {
  it("normalizes /v1.41/containers/json to /containers/json", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/v1.41/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 200);
    assert.equal(res.body, "[]");
  });

  it("passes through unversioned paths unchanged", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 200);
  });
});

describe("router — 404", () => {
  it("returns 404 for unknown endpoints", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/nonexistent");
    await router(req, res, null);
    assert.equal(res.status, 404);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes("No such endpoint"));
  });
});

describe("router — ping", () => {
  it("GET /_ping returns OK with correct headers", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/_ping");
    await router(req, res, null);
    assert.equal(res.status, 200);
    assert.equal(res.body, "OK");
    assert.equal(res.headers["Content-Type"], "text/plain");
    assert.ok(res.headers["Api-Version"]?.startsWith("1."));
  });

  it("decodes URL-encoded route params (e.g. image names)", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/v1.41/images/testcontainers%2Fryuk:0.12.0/json");
    await router(req, res, null);
    // Whether the image exists or not, the route param should be decoded.
    // If missing, the message should contain testcontainers/ryuk:0.12.0 (not %2F).
    const body = JSON.parse(res.body);
    if (body.message?.startsWith("No such image:")) {
      assert.ok(body.message.includes("testcontainers/ryuk:0.12.0"));
      assert.ok(!body.message.includes("%2F"));
    }
  });
});

describe("router — version endpoint", () => {
  it("returns Docker-compatible version shape", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/version");
    await router(req, res, null);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ApiVersion?.startsWith("1."));
    assert.ok(body.Components?.length > 0);
    assert.ok(body.Platform?.Name?.includes("stevedore"));
  });
});

describe("access control — restricted commands", () => {
  it("doctor is only available when invoked as stevedore", async () => {
    const { dispatch } = await import("../../src/dispatcher.js");
    let stderr = "";
    const origError = console.error;
    console.error = (msg) => { stderr += msg; };

    await dispatch(["doctor"], false);
    assert.ok(stderr.includes("only available when running as \"stevedore\""));

    stderr = "";
    await dispatch(["doctor"], true);
    assert.ok(!stderr.includes("only available"));

    console.error = origError;
  });

  it("socket is available under both docker and stevedore names", async () => {
    const { dispatch } = await import("../../src/dispatcher.js");
    let stderr = "";
    const origError = console.error;
    console.error = (msg) => { stderr += msg; };

    // docker socket status → should work (not blocked)
    await dispatch(["socket", "status"], false);
    assert.ok(!stderr.includes("only available"));

    // stevedore socket status → should also work
    stderr = "";
    await dispatch(["socket", "status"], true);
    assert.ok(!stderr.includes("only available"));

    console.error = origError;
  });
});
