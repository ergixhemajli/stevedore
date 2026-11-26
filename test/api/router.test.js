/**
 * test/api/router.test.js
 *
 * Tests for the Docker API router — route matching, version stripping,
 * 404 handling, and access control for restricted commands.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
let callLog;
let previousContainerBin;

before(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-router-"));
  callLog = path.join(tempDir, "calls");
  const bin = path.join(tempDir, "container");
  fs.writeFileSync(bin, `#!/bin/sh
log="${callLog}-$1-$2"
if [ "$1" = "registry" ]; then
  case "$*" in *registry-push.example*) log="${callLog}-registry-push" ;; *) log="${callLog}-registry-auth" ;; esac
fi
printf '%s\\n' "$*" >> "$log"
if [ "$1" = "list" ]; then printf '[]\\n'; exit 0; fi
if [ "$1" = "system" ] && [ "$2" = "version" ]; then echo fake-version; exit 0; fi
if [ "$1" = "create" ]; then echo fake-id; exit 0; fi
if [ "$1" = "inspect" ]; then echo '{"id":"fake","status":{"state":"stopped"}}'; exit 0; fi
if [ "$1" = "commit" ]; then echo fake-image-id; exit 0; fi
if [ "$1" = "exec" ]; then echo exec-output; exit 0; fi
if [ "$1" = "registry" ]; then cat >/dev/null; echo login; exit 0; fi
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then echo missing >&2; exit 1; fi
if [ "$1" = "volume" ] && [ "$2" = "inspect" ]; then echo '{"name":"test-volume","mountpoint":"/tmp"}'; exit 0; fi
if [ "$1" = "image" ] && [ "$2" = "pull" ]; then echo pulled; exit 0; fi
exit 0
`, { mode: 0o755 });
  previousContainerBin = process.env.STEVEDORE_CONTAINER_BIN;
  process.env.STEVEDORE_CONTAINER_BIN = bin;
});

after(() => {
  if (previousContainerBin === undefined) delete process.env.STEVEDORE_CONTAINER_BIN;
  else process.env.STEVEDORE_CONTAINER_BIN = previousContainerBin;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

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
      this.body = (this.body ?? "") + data;
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

describe("router — info and disk usage", () => {
  it("reports current container and image counts", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/info");
    await router(req, res, null);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.Containers, 0);
    assert.equal(body.Images, 0);
    assert.equal(body.ServerVersion, "25.0.0");
  });

  it("reports unsupported disk-usage details instead of returning fabricated data", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/system/df");
    await router(req, res, null);
    assert.equal(res.status, 501);
  });
});

describe("router — resources", () => {
  it("maps supported Docker network creation settings", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-network-create`, { force: true });
    const { req, res } = makeMockRequest("POST", "/networks/create");
    await router(req, res, {
      Name: "test-network",
      Driver: "bridge",
      Internal: true,
      Labels: { owner: "test" },
      IPAM: { Config: [{ Subnet: "10.20.0.0/24" }] },
    });
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.body).Id, "test-network");
    assert.equal(fs.readFileSync(`${callLog}-network-create`, "utf8").trim(), "network create --label owner=test --internal --subnet 10.20.0.0/24 test-network");
  });

  it("maps local volume labels and driver options", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-volume-create`, { force: true });
    const { req, res } = makeMockRequest("POST", "/volumes/create");
    await router(req, res, {
      Name: "test-volume",
      Driver: "local",
      DriverOpts: { type: "tmpfs" },
      Labels: { owner: "test" },
    });
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.body).Name, "test-volume");
    assert.equal(fs.readFileSync(`${callLog}-volume-create`, "utf8").trim(), "volume create --label owner=test --opt type=tmpfs test-volume");
  });

  it("inspects volumes without passing an unsupported format flag", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-volume-inspect`, { force: true });
    const { req, res } = makeMockRequest("GET", "/volumes/test-volume");
    await router(req, res, null);
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).Name, "test-volume");
    assert.deepEqual(fs.readFileSync(`${callLog}-volume-inspect`, "utf8").trim().split("\n"), ["volume inspect test-volume"]);
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

describe("router — commit", () => {
  it("commits a stopped container through container commit", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-inspect-fake`, { force: true });
    fs.rmSync(`${callLog}-commit-fake`, { force: true });
    const { req, res } = makeMockRequest("POST", "/commit?container=fake&repo=app&tag=snapshot");
    await router(req, res, null);
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.body).Id, "fake-image-id");
    assert.equal(fs.readFileSync(`${callLog}-inspect-fake`, "utf8").trim(), "inspect fake");
    assert.equal(fs.readFileSync(`${callLog}-commit-fake`, "utf8").trim(), "commit fake app:snapshot");
  });
});

describe("router — exec", () => {
  it("streams attached output and preserves the completed exit code", async () => {
    const { router } = await import("../../src/api/router.js");
    const create = makeMockRequest("POST", "/containers/fake/exec");
    await router(create.req, create.res, { Cmd: ["echo", "hello"], AttachStdout: true, AttachStderr: true, Tty: true });
    const execId = JSON.parse(create.res.body).Id;

    const start = makeMockRequest("POST", `/exec/${execId}/start`);
    let resolveEnd;
    const ended = new Promise((resolve) => { resolveEnd = resolve; });
    const end = start.res.end;
    start.res.end = function (body) {
      end.call(this, body);
      resolveEnd();
      return this;
    };
    await router(start.req, start.res, { Detach: false, Tty: true });
    await ended;
    assert.equal(start.res.body, "exec-output\n");
    assert.equal(fs.readFileSync(`${callLog}-exec---tty`, "utf8").trim(), "exec --tty fake echo hello");

    const inspect = makeMockRequest("GET", `/exec/${execId}/json`);
    await router(inspect.req, inspect.res, null);
    assert.equal(JSON.parse(inspect.res.body).ExitCode, 0);
  });
});

describe("router — unsupported Docker features", () => {
  it("returns explicit unsupported responses for missing native operations", async () => {
    const { router } = await import("../../src/api/router.js");
    const routes = [
      ["POST", "/networks/default/connect", 501],
      ["POST", "/networks/default/disconnect", 501],
      ["POST", "/containers/fake/pause", 501],
      ["POST", "/containers/fake/unpause", 501],
      ["POST", "/containers/fake/update", 501],
      ["POST", "/containers/fake/wait", 501],
      ["GET", "/images/alpine/history", 501],
    ];
    for (const [method, url, status] of routes) {
      const { req, res } = makeMockRequest(method, url);
      await router(req, res, null);
      assert.equal(res.status, status, `${method} ${url}`);
    }
  });
});

describe("router — events", () => {
  it("reports that Docker events are unsupported instead of streaming system logs", async () => {
    const { router } = await import("../../src/api/router.js");
    const { req, res } = makeMockRequest("GET", "/events");
    await router(req, res, null);
    assert.equal(res.status, 501);
    assert.match(JSON.parse(res.body).message, /events are not supported/);
  });
});

describe("router — auth", () => {
  it("logs in through registry login without adding the password to arguments", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-registry-auth`, { force: true });
    const { req, res } = makeMockRequest("POST", "/auth");
    await router(req, res, { Username: "user", Password: "secret", ServerAddress: "registry.example" });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(`${callLog}-registry-auth`, "utf8").trim(), "registry login --username user --password-stdin registry.example");
  });
});

describe("router — authenticated image push", () => {
  it("logs in from X-Registry-Auth over stdin and pushes the image", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-registry-push`, { force: true });
    fs.rmSync(`${callLog}-image-push`, { force: true });
    const { req, res } = makeMockRequest("POST", "/images/library/alpine/push");
    req.headers["x-registry-auth"] = Buffer.from(JSON.stringify({
      username: "user",
      password: "secret",
      serveraddress: "registry-push.example",
    })).toString("base64");
    let resolveEnd;
    const ended = new Promise((resolve) => { resolveEnd = resolve; });
    const end = res.end;
    res.end = function (body) {
      end.call(this, body);
      resolveEnd();
      return this;
    };
    await router(req, res, null);
    await ended;
    assert.equal(fs.readFileSync(`${callLog}-registry-push`, "utf8").trim(), "registry login --username user --password-stdin registry-push.example");
    assert.equal(fs.readFileSync(`${callLog}-image-push`, "utf8").trim(), "image push library/alpine");
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
  it("passes image tag and platform to container image pull", async () => {
    const { router } = await import("../../src/api/router.js");
    fs.rmSync(`${callLog}-image-pull`, { force: true });
    const { req, res } = makeMockRequest(
      "POST",
      "/images/create?fromImage=testcontainers%2Fryuk&tag=0.12.0&platform=linux%2Famd64"
    );
    let resolveEnd;
    const ended = new Promise((resolve) => { resolveEnd = resolve; });
    const end = res.end;
    res.end = function (body) {
      end.call(this, body);
      resolveEnd();
      return this;
    };
    await router(req, res, null);
    await ended;
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(`${callLog}-image-pull`, "utf8").trim(), "image pull testcontainers/ryuk:0.12.0 --platform linux/amd64");
  });
});

describe("container create — platform passthrough", () => {
  it("passes Platform to container create without invoking a real container", async () => {
    const { router } = await import("../../src/api/router.js");
    const body = JSON.stringify({ Image: "ubuntu:latest", Platform: "linux/arm64", HostConfig: {} });
    const { req, res } = makeMockRequest("POST", "/containers/create");
    await router(req, res, body);
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.body).Id, "fake-id");
    assert.match(fs.readdirSync(tempDir).filter((name) => name.startsWith("calls-create-")).map((name) => fs.readFileSync(path.join(tempDir, name), "utf8")).join(""), /--platform linux\/arm64/);
  });
});
