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

import { spawn } from "node:child_process";
import { CONTAINER_BIN, exec } from "../utils/exec.js";

const UNSUPPORTED = new Set(["--filter", "-f", "--last", "-n", "--latest", "-l", "--no-trunc", "--size", "-s"]);
const CONSUMES_VALUE = new Set(["--filter", "-f"]);
const SUPPORTED_FORMATS = new Set(["json", "table", "yaml", "toml"]);

function translateFormat(argv) {
  const out = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--format" && argv[i + 1]) {
      const val = argv[i + 1];
      if (SUPPORTED_FORMATS.has(val)) {
        out.push("--format", val);
      } else {
        console.warn(
          `stevedore: warning: --format "${val}" is a Go template and is not supported by apple/container. Use json|table|yaml|toml.`
        );
      }
      i += 2;
    } else if (token.startsWith("--format=")) {
      const val = token.slice("--format=".length);
      if (SUPPORTED_FORMATS.has(val)) {
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

function parseFormat(argv) {
  let format = "table";
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--format" && argv[i + 1]) {
      format = argv[i + 1];
      i += 2;
      continue;
    }
    if (token.startsWith("--format=")) {
      format = token.slice("--format=".length);
      i++;
      continue;
    }
    i++;
  }
  return format;
}

function stripFormat(argv) {
  const out = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === "--format" && argv[i + 1]) {
      i += 2;
      continue;
    }
    if (token.startsWith("--format=")) {
      i++;
      continue;
    }
    out.push(token);
    i++;
  }
  return out;
}

function hasQuiet(argv) {
  return argv.includes("-q") || argv.includes("--quiet");
}

function runListJson(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(CONTAINER_BIN, ["list", ...args, "--format", "json"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const msg = stderr.trim() || stdout.trim() || `container list exited with code ${code}`;
      reject(new Error(msg));
    });
  });
}

function bytesToMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const mib = Math.round(bytes / (1024 * 1024));
  return `${mib} MB`;
}

function formatPorts(publishedPorts) {
  if (!Array.isArray(publishedPorts) || publishedPorts.length === 0) return "-";
  return publishedPorts
    .map((p) => `${p.hostAddress ?? "0.0.0.0"}:${p.hostPort}->${p.containerPort}/${p.proto ?? "tcp"}`)
    .join(", ");
}

function renderTable(rows) {
  const headers = ["ID", "IMAGE", "OS", "ARCH", "STATE", "PORTS", "CPUS", "MEMORY", "STARTED"];
  const matrix = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? "-"))];
  const widths = headers.map((_, idx) => Math.max(...matrix.map((row) => String(row[idx]).length)));

  const fmt = (row) => row.map((cell, idx) => String(cell).padEnd(widths[idx])).join("  ").trimEnd();

  return [fmt(headers), ...rows.map((r) => fmt(headers.map((h) => r[h] ?? "-")))].join("\n");
}

function normalizeRows(listJson) {
  if (!Array.isArray(listJson)) return [];
  return listJson.map((item) => {
    const cfg = item?.configuration ?? {};
    const status = item?.status ?? {};

    return {
      ID: item?.id ?? cfg?.id ?? "-",
      IMAGE: cfg?.image?.reference ?? "-",
      OS: cfg?.platform?.os ?? "-",
      ARCH: cfg?.platform?.architecture ?? "-",
      STATE: status?.state ?? "-",
      PORTS: formatPorts(cfg?.publishedPorts),
      CPUS: Number.isFinite(cfg?.resources?.cpus) ? String(cfg.resources.cpus) : "-",
      MEMORY: bytesToMemory(cfg?.resources?.memoryInBytes),
      STARTED: status?.startedDate ?? "-",
    };
  });
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
  const format = parseFormat(translated);

  // Keep passthrough behavior for non-table formats and quiet mode.
  if (hasQuiet(translated) || (format && format !== "table")) {
    await exec(["list", ...translated]);
    return;
  }

  const withoutFormat = stripFormat(translated);

  try {
    const raw = await runListJson(withoutFormat);
    const parsed = JSON.parse(raw || "[]");
    const rows = normalizeRows(parsed);
    console.log(renderTable(rows));
  } catch {
    // Fallback to native output if JSON parsing/capture fails.
    await exec(["list", ...translated]);
  }
}
