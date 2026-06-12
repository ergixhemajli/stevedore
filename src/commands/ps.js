/**
 * commands/ps.js
 *
 * stevedore ps → container list
 *
 * Flag differences:
 *   --filter / -f  → not natively supported by apple/container; dropped with warning
 *   --format       → apple/container supports json/table/yaml/toml (not Go templates)
 *   --last / -n    → not supported; dropped
 *   --latest / -l  → not supported; dropped
 *   --no-trunc     → not supported; dropped
 *   --size / -s    → not supported; dropped
 *   --all / -a     → supported ✓
 *   --quiet / -q   → supported ✓
 */

import { exec } from "../utils/exec.js";

const UNSUPPORTED = new Set(["--filter", "-f", "--last", "-n", "--latest", "-l", "--no-trunc", "--size", "-s"]);
const CONSUMES_VALUE = new Set(["--filter", "-f"]);

// --format go-template → warn and drop; --format json etc. → keep
function translateFormat(argv) {
  const out = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--format" && argv[i + 1]) {
      const val = argv[i + 1];
      if (["json", "table", "yaml", "toml"].includes(val)) {
        out.push("--format", val);
      } else {
        console.warn(
          `stevedore: warning: --format "${val}" is a Go template and is not supported by apple/container. Use json|table|yaml|toml.`
        );
      }
      i += 2;
    } else if (token.startsWith("--format=")) {
      const val = token.slice("--format=".length);
      if (["json", "table", "yaml", "toml"].includes(val)) {
        out.push(token);
      } else {
        console.warn(
          `stevedore: warning: --format "${val}" is a Go template and is not supported by apple/container. Use json|table|yaml|toml.`
        );
      }
      i++;
    } else {
      out.push(token);
      i++;
    }
  }
  return out;
}

export default async function ps(args) {
  const cleaned = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i];
    if (UNSUPPORTED.has(token)) {
      console.warn(`stevedore: warning: flag "${token}" is not supported and will be ignored`);
      if (CONSUMES_VALUE.has(token) && args[i + 1] && !args[i + 1].startsWith("-")) {
        i += 2;
      } else {
        i++;
      }
    } else {
      cleaned.push(token);
      i++;
    }
  }
  const translated = translateFormat(cleaned);
  await exec(["list", ...translated]);
}
