/**
 * test/utils/prune.test.js
 *
 * Runs the real CLI against a stub `container` binary that records its argv,
 * so prune flag mapping, confirmation and failure handling are checked
 * without touching any real containers.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parsePruneArgs } from "../../src/utils/prune.js";

const CLI = fileURLToPath(new URL("../../src/cli.js", import.meta.url));

describe("parsePruneArgs", () => {
  it("defaults everything to false", () => {
    assert.deepEqual(parsePruneArgs([]), { all: false, force: false, volumes: false });
  });

  it("parses long flags", () => {
    assert.deepEqual(parsePruneArgs(["--all", "--force", "--volumes"]), { all: true, force: true, volumes: true });
  });

  it("parses short flags, including clustered ones", () => {
    assert.deepEqual(parsePruneArgs(["-a"]), { all: true, force: false, volumes: false });
    assert.deepEqual(parsePruneArgs(["-f"]), { all: false, force: true, volumes: false });
    assert.deepEqual(parsePruneArgs(["-af"]), { all: true, force: true, volumes: false });
    assert.deepEqual(parsePruneArgs(["-fa"]), { all: true, force: true, volumes: false });
  });

  it("refuses --filter instead of silently widening the prune", () => {
    assert.throws(() => parsePruneArgs(["--filter", "until=24h"]), /--filter is not supported/);
    assert.throws(() => parsePruneArgs(["--filter=until=24h"]), /--filter is not supported/);
  });

  it("rejects unknown flags and positionals", () => {
    assert.throws(() => parsePruneArgs(["--bogus"]), /unknown prune flag "--bogus"/);
    assert.throws(() => parsePruneArgs(["-x"]), /unknown prune flag "-x"/);
    assert.throws(() => parsePruneArgs(["foo"]), /unknown prune flag "foo"/);
  });
});

describe("prune via CLI", () => {
  let dir, log, bin;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-prune-"));
    log = path.join(dir, "calls");
    bin = path.join(dir, "container");
    fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${log}"\n[ "$*" = "$STUB_FAIL" ] && exit 3\nexit 0\n`, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function docker(args, { input = "", env = {} } = {}) {
    fs.rmSync(log, { force: true });
    const r = spawnSync(process.execPath, [CLI, ...args], {
      input,
      encoding: "utf8",
      env: { ...process.env, STEVEDORE_CONTAINER_BIN: bin, ...env },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
  }

  it("system prune -f: stopped containers, unused networks, dangling images", () => {
    const r = docker(["system", "prune", "-f"]);
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prune", "network prune", "image prune"]);
  });

  it("system prune -af --volumes: also volumes, and all unused images", () => {
    const r = docker(["system", "prune", "-af", "--volumes"]);
    assert.equal(r.status, 0);
    assert.deepEqual(r.calls, ["prune", "network prune", "volume prune", "image prune --all"]);
  });

  it("image prune: dangling by default, -a for all unused", () => {
    assert.deepEqual(docker(["image", "prune", "-f"]).calls, ["image prune"]);
    assert.deepEqual(docker(["image", "prune", "-a", "-f"]).calls, ["image prune --all"]);
  });

  it("container, volume and network prune accept -f", () => {
    assert.deepEqual(docker(["container", "prune", "-f"]).calls, ["prune"]);
    assert.deepEqual(docker(["volume", "prune", "-f"]).calls, ["volume prune"]);
    assert.deepEqual(docker(["network", "prune", "-f"]).calls, ["network prune"]);
  });

  it("asks for confirmation and removes nothing unless the answer is y", () => {
    for (const input of ["n\n", "\n", "maybe\n", ""]) {
      const r = docker(["system", "prune", "-a"], { input });
      assert.equal(r.status, 0);
      assert.deepEqual(r.calls, [], `input ${JSON.stringify(input)}`);
      assert.match(r.stdout, /WARNING! This will remove:[\s\S]*all stopped containers/);
    }
  });

  it("proceeds after y/yes", () => {
    for (const input of ["y\n", "Y\n", "yes\n"]) {
      const r = docker(["system", "prune"], { input });
      assert.equal(r.status, 0);
      assert.deepEqual(r.calls, ["prune", "network prune", "image prune"]);
    }
  });

  it("stops at the first failing step and keeps its exit code", () => {
    const r = docker(["system", "prune", "-f"], { env: { STUB_FAIL: "network prune" } });
    assert.equal(r.status, 3);
    assert.deepEqual(r.calls, ["prune", "network prune"]);
  });

  it("--filter exits 1 and runs nothing", () => {
    const r = docker(["system", "prune", "-f", "--filter", "until=24h"]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.calls, []);
    assert.match(r.stderr, /--filter is not supported/);
  });

  it("container/image groups only support prune", () => {
    for (const group of ["container", "image"]) {
      const r = docker([group, "ls"]);
      assert.equal(r.status, 1);
      assert.deepEqual(r.calls, []);
      assert.match(r.stderr, new RegExp(`only "docker ${group} prune" is supported`));
    }
  });

  it("top-level prune is a shorthand for system prune", () => {
    assert.deepEqual(docker(["prune", "-f"]).calls, ["prune", "network prune", "image prune"]);
    assert.deepEqual(
      docker(["prune", "-af", "--volumes"]).calls,
      ["prune", "network prune", "volume prune", "image prune --all"]
    );
    assert.deepEqual(docker(["prune"], { input: "n\n" }).calls, []);
  });
});
