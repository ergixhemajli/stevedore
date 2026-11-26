import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { formatPublishedPorts } from "../../src/commands/port.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const publishedPorts = [
  { containerPort: 5432, hostPort: 15432, hostAddress: "127.0.0.1", proto: "tcp" },
  { containerPort: 5432, hostPort: 25432, hostAddress: "0.0.0.0", proto: "tcp" },
  { containerPort: 53, hostPort: 1053, hostAddress: "0.0.0.0", proto: "udp" },
];

describe("formatPublishedPorts", () => {
  it("prints Docker-style mappings in stable order", () => {
    assert.deepEqual(formatPublishedPorts(publishedPorts), [
      "53/udp -> 0.0.0.0:1053",
      "5432/tcp -> 0.0.0.0:25432",
      "5432/tcp -> 127.0.0.1:15432",
    ]);
  });

  it("filters by private port and protocol", () => {
    assert.deepEqual(formatPublishedPorts(publishedPorts, "5432/tcp"), [
      "0.0.0.0:25432",
      "127.0.0.1:15432",
    ]);
  });
});

describe("port via CLI", () => {
  let dir;
  let bin;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-port-"));
    bin = path.join(dir, "container");
    const list = JSON.stringify([{
      id: "abc123456789",
      configuration: { id: "web", publishedPorts },
    }]);
    fs.writeFileSync(bin, `#!/bin/sh\nif [ "$*" = "list --all --format json" ]; then printf '%s\\n' '${list}'; else exit 2; fi\n`, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function docker(args) {
    return spawnSync(process.execPath, [cli, "port", ...args], {
      encoding: "utf8",
      env: { ...process.env, STEVEDORE_CONTAINER_BIN: bin },
    });
  }

  it("looks up a container by name and reports all published ports", () => {
    const result = docker(["web"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "53/udp -> 0.0.0.0:1053\n5432/tcp -> 0.0.0.0:25432\n5432/tcp -> 127.0.0.1:15432\n");
  });

  it("looks up a container by ID prefix and selects a private port", () => {
    const result = docker(["abc123", "5432/tcp"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "0.0.0.0:25432\n127.0.0.1:15432\n");
  });

  it("fails when the container is not found", () => {
    const result = docker(["missing"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no such container/);
  });
});
