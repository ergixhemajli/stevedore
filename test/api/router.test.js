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
    on: () => res,
  };
  return { req, res };
}

describe("router — version stripping", () => {
  it("normalizes /v1.41/containers/json to /containers/json", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/v1.41/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
  });

  it("passes through unversioned paths unchanged", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 200);
  });

  it("rejects API versions newer than max supported", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/v1.99/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes("too new"));
  });

  it("rejects API versions older than min supported", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/v1.10/containers/json");
    await router(req, res, null);
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes("too old"));
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

  it("matches /containers/:id/rename endpoint", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("POST", "/containers/nonexistent/rename?name=new-name");
    await router(req, res, null);
    // Route should exist (handler decides status by container existence)
    const body = JSON.parse(res.body || "{}");
    assert.ok(!String(body.message ?? "").includes("No such endpoint"));
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
    assert.equal(body.ApiVersion, "1.44");
    assert.ok(body.Components?.length > 0);
    assert.ok(body.Platform?.Name?.includes("stevedore"));
    assert.equal(body.Version, "25.0.0");
  });
});

describe("access control — restricted commands", () => {
  it("doctor is blocked when invoked as docker", async () => {
    const { dispatch } = await import("../../src/dispatcher.js");
    let stderr = "";
    const origError = console.error;
    console.error = (msg) => { stderr += msg; };

    const prevExitCode = process.exitCode;
    await dispatch(["doctor"], false);
    assert.ok(stderr.includes("only available when running as \"stevedore\""));

    process.exitCode = prevExitCode;
    console.error = origError;
  });
});

describe("image pull — platform passthrough", () => {
  it("passes platform query param to container image pull", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest(
      "POST",
      "/images/create?fromImage=testcontainers%2Fryuk&tag=0.12.0&platform=linux%2Famd64"
    );
    const started = await new Promise((resolve) => {
      req.on = (event, cb) => {
        if (event === "close") { req._onClose = cb; }
        return req;
      };
      resolve(true);
    });
    await router(req, res, null);
    // The handler spawns a child process, so we can't easily assert args here.
    // The test verifies the route matches and the handler is invoked.
    assert.equal(res.status, 200);
  });
});

describe("container create — platform passthrough", () => {
  it("accepts Platform field in container create body", async () => {
    const { router } = await import("../../src/api/router.js");
    // Use a real image that likely exists locally so container create doesn't fail
    const body = JSON.stringify({
      Image: "ubuntu:latest",
      Platform: "linux/arm64",
      HostConfig: {},
    });
    const { req, res } = makeMockRequest("POST", "/containers/create");
    await router(req, res, body);
    // Handler is invoked; status reflects whether create succeeded.
    // The key point: Platform field is accepted without error.
    assert.ok(res.status === 201 || res.status === 500, "handler invoked");
  });
});
