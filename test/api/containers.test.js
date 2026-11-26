/**
 * test/api/containers.test.js
 *
 * Checks how Docker create requests are translated into `container create`
 * args, using a stub `container` binary that records its argv.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("containers.create", () => {
  let dir, log, containers;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-create-"));
    log = path.join(dir, "calls");
    const bin = path.join(dir, "container");
    fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${log}"\necho fake-id\n`, { mode: 0o755 });
    process.env.STEVEDORE_CONTAINER_BIN = bin;
    ({ containers } = await import("../../src/api/routes/containers.js"));
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function create(body) {
    fs.rmSync(log, { force: true });
    const res = {
      writeHead(status) { this.status = status; return this; },
      end(data = "") { this.body = data; return this; },
    };
    await containers.create({ query: {}, body, res });
    return { res, args: fs.readFileSync(log, "utf8").trim().split(" ") };
  }

  it("passes --rm when HostConfig.AutoRemove is set (Testcontainers' Ryuk relies on it)", async () => {
    const { res, args } = await create({ Image: "testcontainers/ryuk:0.12.0", HostConfig: { AutoRemove: true } });
    assert.equal(res.status, 201);
    assert.equal(args[0], "create");
    assert.ok(args.includes("--rm"));
    assert.ok(args.indexOf("--rm") < args.indexOf("testcontainers/ryuk:0.12.0"), "--rm must precede the image");
  });

  it("omits --rm when AutoRemove is false or absent", async () => {
    assert.ok(!(await create({ Image: "alpine", HostConfig: { AutoRemove: false } })).args.includes("--rm"));
    assert.ok(!(await create({ Image: "alpine" })).args.includes("--rm"));
  });

  it("maps supported mounts and CPU limits and warns for unsupported fields", async () => {
    const { res, args } = await create({
      Image: "alpine",
      Hostname: "custom-host",
      HostConfig: {
        Mounts: [{ Type: "bind", Source: "/host/data", Target: "/data", ReadOnly: true }],
        CpuQuota: 50000,
        CpuPeriod: 100000,
        ExtraHosts: ["database:127.0.0.1"],
      },
    });
    assert.equal(res.status, 201);
    assert.ok(args.includes("--mount"));
    assert.ok(args.includes("type=bind,target=/data,source=/host/data,readonly"));
    assert.ok(args.includes("--cpus"));
    assert.ok(args.includes("0.5"));
    assert.ok(!args.includes("--add-host"));
    assert.deepEqual(JSON.parse(res.body).Warnings, [
      "Hostname is not supported by apple/container",
      "ExtraHosts is not supported by apple/container",
    ]);
  });
});
