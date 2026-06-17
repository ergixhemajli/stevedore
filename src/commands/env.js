/**
 * env.js
 *
 * Prints shell exports for stevedore + local app stability settings.
 *
 * Usage:
 *   stevedore env
 *   eval "$(stevedore env)"
 */

import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".stevedore");
const SOCKET_PATH = path.join(STATE_DIR, "docker.sock");

export default async function env(args) {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const maxLifetime = optionValue(args, "--db-hikari-max-lifetime-ms")
    ?? process.env.STEVEDORE_DB_HIKARI_MAX_LIFETIME_MS
    ?? "55000";

  const keepalive = optionValue(args, "--db-hikari-keepalive-time-ms")
    ?? process.env.STEVEDORE_DB_HIKARI_KEEPALIVE_TIME_MS
    ?? "30000";

  const lines = [
    `export DOCKER_HOST=unix://${SOCKET_PATH}`,
    `export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=${SOCKET_PATH}`,
    `export DB_HIKARI_MAX_LIFETIME_MS=${maxLifetime}`,
    `export DB_HIKARI_KEEPALIVE_TIME_MS=${keepalive}`,
  ];

  console.log(lines.join("\n"));
}

function optionValue(args, flag) {
  const direct = args.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1).trim();

  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1].trim();
  }

  return undefined;
}

function printHelp() {
  console.log(`
Usage: stevedore env [options]

Print shell exports for stevedore socket + JVM DB pool stability defaults.

Examples:
  stevedore env
  eval "$(stevedore env)"
  eval "$(stevedore env --db-hikari-max-lifetime-ms 45000 --db-hikari-keepalive-time-ms 25000)"

Options:
  --db-hikari-max-lifetime-ms <ms>   Override DB_HIKARI_MAX_LIFETIME_MS output
  --db-hikari-keepalive-time-ms <ms> Override DB_HIKARI_KEEPALIVE_TIME_MS output
  -h, --help                         Show this help
`);
}
