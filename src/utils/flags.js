/**
 * flags.js
 *
 * Shared helpers for translating Docker CLI flags to stevedore-compatible flags.
 *
 * Design principle: each helper receives a raw argv array and returns a new
 * array with flags rewritten/removed/added.  Helpers are pure functions so
 * they are easy to unit-test in isolation.
 *
 * When docker adds or changes flags, only this file (and the
 * relevant command handler) needs updating — not every command.
 */

// ---------------------------------------------------------------------------
// Generic argv parser
// ---------------------------------------------------------------------------

/**
 * Iterate over an argv array yielding [flag, value | null] pairs.
 * Handles:
 *   --flag value
 *   --flag=value
 *   -f value
 *   positional arguments (flag=null)
 *
 * @param {string[]} argv
 * @yields {[string, string | null]}
 */
export function* iterateArgs(argv) {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];

    if (token.startsWith("--") && token.includes("=")) {
      const eqIdx = token.indexOf("=");
      yield [token.slice(0, eqIdx), token.slice(eqIdx + 1)];
      i++;
    } else if (token.startsWith("-") && token.length > 1) {
      const next = argv[i + 1];
      const hasValue = next !== undefined && !next.startsWith("-");
      yield [token, hasValue ? next : null];
      i += hasValue ? 2 : 1;
    } else {
      yield [token, null];
      i++;
    }
  }
}

// ---------------------------------------------------------------------------
// Flag rename map — docker flag → stevedore-compatible flag
// Add entries here whenever a flag name differs.
// ---------------------------------------------------------------------------
const FLAG_RENAMES = new Map([
  // docker uses --net as shorthand for --network
  ["--net", "--network"],
]);

/**
 * Apply FLAG_RENAMES to an argv array.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function renameFlags(argv) {
  return argv.map((token) => {
    const base = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    const renamed = FLAG_RENAMES.get(base);
    if (!renamed) return token;
    return token.includes("=")
      ? renamed + token.slice(token.indexOf("="))
      : renamed;
  });
}

// ---------------------------------------------------------------------------
// Flag drop list — docker flags not supported by stevedore.
// Entries: [flag, consumesValue]
// These are silently dropped with a warning so scripts don't hard-fail.
// ---------------------------------------------------------------------------
const UNSUPPORTED_FLAGS = new Map([
  ["--no-healthcheck", false],
  ["--health-cmd", true],
  ["--health-interval", true],
  ["--health-retries", true],
  ["--health-start-period", true],
  ["--health-timeout", true],
  ["--isolation", true],
  ["--log-driver", true],
  ["--log-opt", true],
  ["--oom-kill-disable", false],
  ["--oom-score-adj", true],
  ["--pids-limit", true],
  ["--security-opt", true],
  ["--storage-opt", true],
  ["--sysctl", true],
  ["--userns", true],
  ["--uts", true],
  ["--ipc", true],
  ["--cgroup-parent", true],
  ["--cgroupns", true],
  ["--blkio-weight", true],
  ["--blkio-weight-device", true],
  ["--cpu-shares", true],
  ["--cpu-period", true],
  ["--cpu-quota", true],
  ["--cpu-rt-period", true],
  ["--cpu-rt-runtime", true],
  ["--cpuset-cpus", true],
  ["--cpuset-mems", true],
  ["--device-cgroup-rule", true],
  ["--device-read-bps", true],
  ["--device-read-iops", true],
  ["--device-write-bps", true],
  ["--device-write-iops", true],
  ["--disable-content-trust", false],
  ["--memory-reservation", true],
  ["--memory-swap", true],
  ["--memory-swappiness", true],
  ["--kernel-memory", true],
  ["--link", true],
  ["--link-local-ip", true],
  ["--mac-address", true],
  ["--add-host", true],
  ["--group-add", true],
  ["--domainname", true],
  ["--hostname", true],
  ["--ip", true],
  ["--ip6", true],
  ["--expose", true],
  ["--publish-all", false],
]);

/**
 * Remove unsupported docker flags from argv, printing a warning for each.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function dropUnsupportedFlags(argv) {
  const out = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    const base = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    const entry = UNSUPPORTED_FLAGS.get(base);
    if (entry !== undefined) {
      const consumesValue = entry;
      const hasInlineValue = token.includes("=");
      console.warn(
        `stevedore: warning: flag "${base}" is not supported and will be ignored`
      );
      if (consumesValue && !hasInlineValue && argv[i + 1] !== undefined && !argv[i + 1].startsWith("-")) {
        i += 2; // skip flag + value
      } else {
        i += 1; // skip flag only
      }
    } else {
      out.push(token);
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience: apply all translations in one call
// ---------------------------------------------------------------------------
/**
 * Run all flag transformations: rename, then drop unsupported.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function translateFlags(argv) {
  return dropUnsupportedFlags(renameFlags(argv));
}
