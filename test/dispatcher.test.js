/**
 * test/dispatcher.test.js
 *
 * Smoke-tests the dispatcher: checks that known commands resolve without throwing
 * and that unknown commands throw with a useful message.
 *
 * We override STEVEDORE_CONTAINER_BIN so exec() never actually runs a binary.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Point to a no-op script
process.env.STEVEDORE_CONTAINER_BIN = "/usr/bin/true";

import { dispatch } from "../src/dispatcher.js";

describe("dispatcher", () => {
  it("throws for unknown subcommand", async () => {
    await assert.rejects(
      () => dispatch(["notacommand"]),
      /unknown stevedore command/
    );
  });

  it("resolves for --help without throwing", async () => {
    // printHelp just console.logs; should not throw
    await assert.doesNotReject(() => dispatch(["--help"]));
  });
});
