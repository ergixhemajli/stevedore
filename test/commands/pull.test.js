import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

describe("pull", () => {
  it("runs container image pull", () => {
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../../src/cli.js", import.meta.url)), "pull", "testcontainers/ryuk:0.14.0"],
      {
        encoding: "utf8",
        env: { ...process.env, STEVEDORE_CONTAINER_BIN: "/bin/echo" },
      }
    );

    assert.equal(output, "image pull testcontainers/ryuk:0.14.0\n");
  });
});
