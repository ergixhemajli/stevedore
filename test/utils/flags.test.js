/**
 * test/utils/flags.test.js
 *
 * Unit tests for src/utils/flags.js using Node's built-in test runner.
 * Run with: node --test
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renameFlags, dropUnsupportedFlags, translateFlags } from "../../src/utils/flags.js";

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
