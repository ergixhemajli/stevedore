import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRestartArgs } from "../../src/commands/restart.js";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));

describe("restart", () => {
  it("maps timeout and signal flags to container stop", () => {
    assert.deepEqual(parseRestartArgs(["-t", "3", "--signal=SIGKILL", "one", "two"]), {
      containers: ["one", "two"],
      stopOptions: ["--time", "3", "--signal", "SIGKILL"],
    });
  });

  it("defaults to Docker's 10-second timeout", () => {
    assert.deepEqual(parseRestartArgs(["one"]).stopOptions, ["--time", "10"]);
  });
});

describe("restart via CLI", () => {
  let dir;
  let log;
  let bin;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-restart-"));
    log = path.join(dir, "calls");
    bin = path.join(dir, "container");
    fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> "$CALL_LOG"\n[ "$*" = "$STUB_FAIL" ] && exit 7\nexit 0\n`, { mode: 0o755 });
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function docker(args, env = {}) {
    fs.rmSync(log, { force: true });
    const result = spawnSync(process.execPath, [cli, "restart", ...args], {
      encoding: "utf8",
      env: { ...process.env, STEVEDORE_CONTAINER_BIN: bin, CALL_LOG: log, ...env },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
    return { ...result, calls };
  }

  it("stops and starts each requested container", () => {
    const result = docker(["-t", "3", "one", "two"]);
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, [
      "stop --time 3 one",
      "start one",
      "stop --time 3 two",
      "start two",
    ]);
  });

  it("does not start a container when stopping it fails", () => {
    const result = docker(["broken"], { STUB_FAIL: "stop --time 10 broken" });
    assert.equal(result.status, 7);
    assert.deepEqual(result.calls, ["stop --time 10 broken"]);
  });
});
