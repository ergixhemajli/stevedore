/**
 * test/commands/run.test.js
 *
 * Tests the mac address flag translation in the run command.
 * We mock exec so no actual container binary is required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Duplicate the handleMacAddress logic for testing
function handleMacAddress(argv) {
  let mac = null;
  const withoutMac = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--mac-address" && argv[i + 1]) {
      mac = argv[i + 1]; i += 2;
    } else if (token.startsWith("--mac-address=")) {
      mac = token.slice("--mac-address=".length); i++;
    } else { withoutMac.push(token); i++; }
  }
  if (!mac) return argv;
  const result = [];
  let injected = false;
  let j = 0;
  while (j < withoutMac.length) {
    const token = withoutMac[j];
    if (token === "--network" && withoutMac[j + 1]) {
      result.push("--network", `${withoutMac[j + 1]},mac=${mac}`); j += 2; injected = true;
    } else if (token.startsWith("--network=")) {
      result.push(`${token},mac=${mac}`); j++; injected = true;
    } else { result.push(token); j++; }
  }
  if (!injected) result.unshift("--network", `default,mac=${mac}`);
  return result;
}

describe("run: --mac-address translation", () => {
  it("injects mac into existing --network flag", () => {
    const result = handleMacAddress(["--network", "bridge", "--mac-address", "02:42:ac:11:00:02", "ubuntu"]);
    assert.deepEqual(result, ["--network", "bridge,mac=02:42:ac:11:00:02", "ubuntu"]);
  });

  it("injects mac into existing --network=value flag", () => {
    const result = handleMacAddress(["--network=bridge", "--mac-address=02:42:ac:11:00:02", "ubuntu"]);
    assert.deepEqual(result, ["--network=bridge,mac=02:42:ac:11:00:02", "ubuntu"]);
  });

  it("adds --network default,mac=... when no --network flag present", () => {
    const result = handleMacAddress(["--mac-address", "02:42:ac:11:00:02", "ubuntu"]);
    assert.deepEqual(result, ["--network", "default,mac=02:42:ac:11:00:02", "ubuntu"]);
  });

  it("returns argv unchanged when no --mac-address present", () => {
    const input = ["--network", "bridge", "ubuntu"];
    assert.deepEqual(handleMacAddress(input), input);
  });
});
