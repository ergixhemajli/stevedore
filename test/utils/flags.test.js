/**
 * test/utils/flags.test.js
 *
 * Unit tests for src/utils/flags.js using Node's built-in test runner.
 * Run with: node --test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renameFlags, dropUnsupportedFlags, translateFlags, splitFlagsAtPositional } from "../../src/utils/flags.js";

describe("renameFlags", () => {
  it("renames --net to --network", () => {
    assert.deepEqual(
      renameFlags(["--net", "bridge"]),
      ["--network", "bridge"]
    );
  });

  it("renames --net=bridge to --network=bridge", () => {
    assert.deepEqual(
      renameFlags(["--net=bridge"]),
      ["--network=bridge"]
    );
  });

  it("leaves unknown flags unchanged", () => {
    assert.deepEqual(
      renameFlags(["--name", "mycontainer"]),
      ["--name", "mycontainer"]
    );
  });

  it("handles empty array", () => {
    assert.deepEqual(renameFlags([]), []);
  });
});

describe("dropUnsupportedFlags", () => {
  it("drops --log-driver and its value", () => {
    const result = dropUnsupportedFlags(["--log-driver", "json-file", "--name", "foo"]);
    assert.deepEqual(result, ["--name", "foo"]);
  });

  it("drops --no-healthcheck (no value)", () => {
    const result = dropUnsupportedFlags(["--no-healthcheck", "--name", "foo"]);
    assert.deepEqual(result, ["--name", "foo"]);
  });

  it("drops inline --log-driver=json-file", () => {
    const result = dropUnsupportedFlags(["--log-driver=json-file", "--name", "foo"]);
    assert.deepEqual(result, ["--name", "foo"]);
  });

  it("preserves supported flags", () => {
    const result = dropUnsupportedFlags(["-d", "--name", "web", "-p", "8080:80"]);
    assert.deepEqual(result, ["-d", "--name", "web", "-p", "8080:80"]);
  });
});

describe("translateFlags", () => {
  it("renames and drops in one pass", () => {
    const result = translateFlags(["--net", "bridge", "--log-driver", "json-file", "--name", "foo"]);
    assert.deepEqual(result, ["--network", "bridge", "--name", "foo"]);
  });
});

describe("splitFlagsAtPositional", () => {
  it("splits run args at the image name", () => {
    const result = splitFlagsAtPositional(["-it", "--name", "mycontainer", "alpine", "echo", "hello"], "run");
    assert.deepStrictEqual(result.flags, ["-it", "--name", "mycontainer"]);
    assert.deepStrictEqual(result.positional, ["alpine", "echo", "hello"]);
  });

  it("splits run args when no flags present", () => {
    const result = splitFlagsAtPositional(["alpine", "echo", "hello"], "run");
    assert.deepStrictEqual(result.flags, []);
    assert.deepStrictEqual(result.positional, ["alpine", "echo", "hello"]);
  });

  it("splits exec args at the container name", () => {
    const result = splitFlagsAtPositional(["-it", "--user", "root", "mycontainer", "sh"], "exec");
    assert.deepStrictEqual(result.flags, ["-it", "--user", "root"]);
    assert.deepStrictEqual(result.positional, ["mycontainer", "sh"]);
  });

  it("no split when all flags", () => {
    const result = splitFlagsAtPositional(["-it", "--name", "c1"], "run");
    assert.deepStrictEqual(result.flags, ["-it", "--name", "c1"]);
    assert.deepStrictEqual(result.positional, []);
  });
});

describe("translateFlags with commandType", () => {
  it("translates only flags before positional for run", () => {
    // --hostname after alpine should NOT be translated (not a docker CLI flag)
    const result = translateFlags(["-it", "--name", "c1", "alpine", "--hostname", "x"], "run");
    assert.deepStrictEqual(result, ["-it", "--name", "c1", "alpine", "--hostname", "x"]);
  });

  it("drops unsupported flags before positional", () => {
    const result = translateFlags(["--log-driver", "json-file", "--name", "c1", "alpine"], "run");
    // --log-driver is dropped, but console.warn is called
    assert.deepStrictEqual(result, ["--name", "c1", "alpine"]);
  });

  it("does not split when commandType is undefined", () => {
    const result = translateFlags(["-it", "--name", "c1", "alpine"]);
    assert.deepStrictEqual(result, ["-it", "--name", "c1", "alpine"]);
  });
});
