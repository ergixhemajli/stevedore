/**
 * src/api/routes/containers.js
 *
 * Docker API container endpoints translated to apple/container CLI calls.
 *
 * Testcontainers minimum surface needed:
 *   POST /containers/create       → container run (detached)
 *   POST /containers/:id/start    → container start
 *   POST /containers/:id/stop     → container stop
 *   DELETE /containers/:id        → container delete
 *   GET  /containers/:id/json     → container inspect
 *   GET  /containers/:id/logs     → container logs
 *   POST /containers/:id/wait     → wait for exit
 *   POST /containers/:id/exec     → container exec (create)
 *   POST /exec/:id/start          → container exec (run)
 *   GET  /containers/json         → container list
 */

import { run, runJSON, json, apiError } from "../run.js";
import { spawn } from "node:child_process";
import net from "node:net";
import { CONTAINER_BIN } from "../../utils/exec.js";
import { parseFilters, matchesFilters, hasFilters } from "../filters.js";

export const containers = {

  async commit({ query, body, res }) {
    const id = query.container;
    if (!id) return apiError(res, 400, "container query parameter required");
    if (query.changes || body?.Changes?.length || body?.Config) {
      return apiError(res, 501, "commit metadata changes are not supported by apple/container");
    }

    const inspected = await run(["inspect", id]);
    if (inspected.exitCode !== 0) return apiError(res, 404, `No such container: ${id}`);
    let state;
    try {
      const parsed = JSON.parse(inspected.stdout);
      state = (Array.isArray(parsed) ? parsed[0] : parsed)?.status?.state;
    } catch { return apiError(res, 500, "Failed to parse container state"); }
    if (!((state === "stopped" || state === "created") || query.pause === "0" || query.pause === "false")) {
      return apiError(res, 501, "apple/container cannot pause a running container during commit; stop it first or set pause=false");
    }

    const reference = query.repo
      ? `${query.repo}${query.tag ? `:${query.tag}` : ""}`
      : `stevedore/commit-${Date.now()}`;
    const result = await run(["commit", id, reference]);
    if (result.exitCode !== 0) return apiError(res, 500, result.stderr);
    json(res, 201, {
      Id: result.stdout.trim() || reference,
      Warnings: query.repo ? [] : ["apple/container requires a reference; Stevedore generated one"],
    });
  },

  async prune({ query, res }) {
    if (hasFilters(query.filters)) return apiError(res, 501, "container prune filters are not supported by apple/container");
    const before = toArray(await runJSON(["list", "--all"]));
    const beforeDf = await runJSON(["system", "df"]).catch(() => null);
    const { stderr, exitCode } = await run(["prune"]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const after = toArray(await runJSON(["list", "--all"]));
    const afterDf = await runJSON(["system", "df"]).catch(() => null);
    const remaining = new Set(after.map((item) => item.id ?? item.configuration?.id));
    const removed = before
      .filter((item) => item.status?.state !== "running")
      .map((item) => item.id ?? item.configuration?.id)
      .filter((id) => id && !remaining.has(id));
    const beforeSize = Number(beforeDf?.containers?.sizeInBytes) || 0;
    const afterSize = Number(afterDf?.containers?.sizeInBytes) || 0;
    json(res, 200, { ContainersDeleted: removed, SpaceReclaimed: Math.max(0, beforeSize - afterSize) });
  },

  // ── List ──────────────────────────────────────────────────────────────────
  async list({ query, res }) {
    const args = ["list"];
    if (query.all === "1" || query.all === "true") args.push("--all");
    const { stdout, exitCode, stderr } = await run([...args, "--format", "json"]);
    if (exitCode !== 0) return apiError(res, 500, stderr);

    // apple/container returns one JSON object per line or a JSON array
    const parsed = parseLines(stdout);
    const dockerFormat = parsed
      .map(toDockerContainer)
      .map((c) => ({ ...c, labels: c.Labels ?? c.labels ?? {} }))
      .filter((c) => matchesFilters(parseFilters(query.filters), c))
      .sort((a, b) => b.Created - a.Created);
    json(res, 200, dockerFormat);
  },

  // ── Create ────────────────────────────────────────────────────────────────
  async create({ query, body, res }) {
    // Docker API uses "Image" (capital I); some clients send "imageName"
    const image = body?.Image ?? body?.imageName ?? query?.Image ?? null;
    if (!image) return apiError(res, 400, "Image is required");

    let platform = body.Platform;
    if (!platform) {
      if (process.arch === "arm64") platform = "linux/arm64";
      else if (process.arch === "x64") platform = "linux/amd64";
    }

    const { args, warnings } = await buildRunArgs({ ...body, Image: image }, query.name, platform);

    // Use 'container create' (not 'run') so the container is NOT started yet.
    // This gives Testcontainers time to configure its resource reaper (Ryuk)
    // before the container begins executing.
    args[0] = "create"; // replace "run" with "create"
    args.splice(1, 1);  // remove "--detach" — create has no detach flag
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr || stdout);

    const id = stdout.trim().split("\n").pop();
    json(res, 201, { Id: id, Warnings: warnings });
  },

  // ── Inspect ───────────────────────────────────────────────────────────────
  async inspect({ params, res }) {
    const { stdout, exitCode } = await run(["inspect", params.id]);
    if (exitCode !== 0) return apiError(res, 404, `No such container: ${params.id}`);
    try {
      const parsed = JSON.parse(stdout);
      const raw = Array.isArray(parsed) ? parsed[0] : parsed;
      json(res, 200, toDockerInspect(raw));
    } catch {
      apiError(res, 500, "Failed to parse inspect output");
    }
  },

  // ── Start ─────────────────────────────────────────────────────────────────
  async start({ params, res }) {
    const { stderr, exitCode } = await run(["start", params.id]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },

  // ── Stop ──────────────────────────────────────────────────────────────────
  async stop({ params, query, res }) {
    const args = ["stop", params.id, "--time", query.t ?? "10"];
    // ponytail: fixed 60s server-side cap — `--time` is enforced by
    // apple/container itself, but a hung VM would otherwise hang the
    // client's HTTP request indefinitely.
    const { stderr, exitCode } = await run(args, { timeoutMs: 60_000 });
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },

  // ── Kill ──────────────────────────────────────────────────────────────────
  async kill({ params, query, res }) {
    const args = ["kill", params.id];
    if (query.signal) args.push("--signal", query.signal);
    const { stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },

  // ── Restart ───────────────────────────────────────────────────────────────
  async restart({ params, query, res }) {
    const stopArgs = ["stop", params.id, "--time", query.t ?? "10"];
    const stop = await run(stopArgs, { timeoutMs: 60_000 });
    if (stop.exitCode !== 0) return apiError(res, 404, stop.stderr);
    const { stderr, exitCode } = await run(["start", params.id], { timeoutMs: 60_000 });
    if (exitCode !== 0) return apiError(res, 404, stderr);
    bumpRestartCount(params.id);
    res.writeHead(204); res.end();
  },

  // ── Remove ────────────────────────────────────────────────────────────────
  async remove({ params, query, res }) {
    const args = ["delete", params.id];
    if (query.force === "1" || query.force === "true") args.push("--force");
    const { stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },

  async rename({ res }) {
    apiError(res, 501, "container rename is not supported by apple/container");
  },

  async attach({ res }) {
    apiError(res, 501, "container attach is not supported by apple/container");
  },

  async pause({ res }) {
    apiError(res, 501, "container pause is not supported by apple/container");
  },

  async unpause({ res }) {
    apiError(res, 501, "container unpause is not supported by apple/container");
  },

  async update({ res }) {
    apiError(res, 501, "container update is not supported by apple/container");
  },

  async changes({ res }) {
    apiError(res, 501, "container filesystem changes are not supported by apple/container");
  },

  async resize({ res }) {
    apiError(res, 501, "container terminal resize is not supported by apple/container");
  },

  // ── Logs ──────────────────────────────────────────────────────────────────
  // apple/container logs supports only: --boot --follow -n <n> --debug
  // (no --tail/--timestamps/--since/--until). Time filtering and timestamps
  // are therefore applied client-side on the way out.
  async logs({ params, query, res }) {
    const args = ["logs", params.id];
    const follow = query.follow === "1" || query.follow === "true";
    if (follow) args.push("--follow");
    if (query.tail && query.tail !== "all") args.push("-n", query.tail);

    const showTimestamps = query.timestamps === "1" || query.timestamps === "true";
    const since = parseDockerTime(query.since);
    const until = parseDockerTime(query.until);

    const showStdout = query.stdout !== "false" && query.stdout !== "0";
    const showStderr = query.stderr !== "false" && query.stderr !== "0";
    if (!showStdout && !showStderr) {
      return apiError(res, 400, "at least one of stdout or stderr must be enabled");
    }

    res.writeHead(200, { "Content-Type": "application/octet-stream" });

    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    // Per-stream line processor: buffers partial lines (chunk boundaries
    // split mid-line), drops consecutive duplicates, stamps + time-filters.
    // ponytail: apple/container logs carry no timestamps, so we stamp with
    // stream time — since/until filtering is exact for live lines only;
    // historical lines all read as "now".
    const processors = [];
    const makeProcessor = (stream) => {
      let pending = "";
      let lastLine = null;
      const emitLine = (line) => {
        if (line === "") return;
        if (line === lastLine) return; // consecutive dedup
        lastLine = line;
        let ts;
        if (showTimestamps) {
          ts = new Date().toISOString().slice(0, 19) + ".000000000Z";
          const t = Date.parse(ts);
          if (since !== null && t < since) return;
          if (until !== null && t > until) return;
        }
        const payload = showTimestamps ? `${ts} ${line}\n` : `${line}\n`;
        res.write(frameLog(stream, Buffer.from(payload)));
      };
      const onChunk = (chunk) => {
        if (res.destroyed) return;
        pending += chunk.toString();
        const nl = pending.lastIndexOf("\n");
        if (nl === -1) return;
        const complete = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        for (const raw of complete.split("\n")) emitLine(raw.replace(/\r$/, ""));
      };
      const flush = () => { if (pending) { const rest = pending; pending = ""; emitLine(rest.replace(/\r$/, "")); } };
      return { onChunk, flush };
    };

    if (showStdout) {
      const p = makeProcessor(1);
      processors.push(p);
      child.stdout.on("data", p.onChunk);
    }
    if (showStderr) {
      const p = makeProcessor(2);
      processors.push(p);
      child.stderr.on("data", p.onChunk);
    }

    child.on("close", () => { for (const p of processors) p.flush(); if (!res.destroyed) res.end(); });
    // res, not req: collectBody's for-await on req prevents req from emitting
    // 'close' on client disconnect — res fires in every case.
    res.on("close", () => child.kill());
  },

  async top({ res }) {
    apiError(res, 501, "container top is not supported by apple/container");
  },

  async export({ params, res }) {
    const check = await run(["inspect", params.id]);
    if (check.exitCode !== 0) return apiError(res, 404, `No such container: ${params.id}`);

    res.writeHead(200, { "Content-Type": "application/x-tar" });
    const child = spawn(CONTAINER_BIN, ["export", params.id], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(res);
    child.on("close", () => { if (!res.destroyed) res.end(); });
    res.on("close", () => child.kill());
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  async stats({ params, query, res }) {
    const args = ["stats", params.id, "--format", "json"];
    if (!(query.stream === "0" || query.stream === "false")) args.push("--follow");

    res.writeHead(200, { "Content-Type": "application/json" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (d) => {
      if (!res.destroyed) res.write(d);
    });
    child.on("close", () => {
      if (!res.destroyed) res.end();
    });
    res.on("close", () => {
      child.kill();
      if (!res.destroyed) res.end();
    });
  },

  async wait({ res }) {
    apiError(res, 501, "container wait is not supported by apple/container");
  },

  // ── Exec create ───────────────────────────────────────────────────────────
  async execInspect({ params, res }) {
    const stored = execStore.get(params.id);
    const result = execResults.get(params.id);
    const state = stored ?? result;
    if (!state) return apiError(res, 404, `No such exec: ${params.id}`);
    const config = state.config ?? {};
    const cmd = Array.isArray(config.Cmd) ? config.Cmd : [];
    json(res, 200, {
      ID: params.id,
      Running: Boolean(stored?.running),
      ExitCode: result?.exitCode ?? null,
      ProcessConfig: {
        privileged: Boolean(config.Privileged),
        user: config.User ?? "",
        tty: Boolean(config.Tty),
        entrypoint: cmd[0] ?? "",
        arguments: cmd.slice(1),
      },
      OpenStdin: Boolean(config.AttachStdin),
      OpenStdout: config.AttachStdout !== false,
      OpenStderr: config.AttachStderr !== false,
      CanRemove: false,
      ContainerID: state.containerId,
    });
  },

  async execCreate({ params, body, res }) {
    // Store the exec config keyed by a generated ID.
    // Real Docker has a separate exec API; we fake the ID and run at execStart.
    const id = `exec-${params.id}-${Date.now()}`;
    execStore.set(id, { containerId: params.id, config: body });
    json(res, 201, { Id: id });
  },

  // ── Exec start ────────────────────────────────────────────────────────────
  async execStart({ params, body, res }) {
    const stored = execStore.get(params.id);
    if (!stored) return apiError(res, 404, `No such exec: ${params.id}`);

    const { containerId, config } = stored;
    if (config?.AttachStdin) return apiError(res, 501, "interactive exec stdin is not supported by apple/container");
    const tty = body?.Tty ?? config?.Tty ?? false;
    const args = ["exec", ...(body?.Detach ? ["--detach"] : []), ...(tty ? ["--tty"] : [])];
    for (const value of config?.Env ?? []) args.push("--env", value);
    if (config?.User) args.push("--user", config.User);
    if (config?.WorkingDir) args.push("--workdir", config.WorkingDir);
    args.push(containerId, ...(config?.Cmd ?? []));
    if (body?.Detach) {
      const { stderr, exitCode } = await run(args);
      execStore.delete(params.id);
      execResults.set(params.id, { ...stored, exitCode });
      if (exitCode !== 0) return apiError(res, 500, stderr);
      res.writeHead(204); res.end();
      return;
    }

    execStore.set(params.id, { ...stored, running: true });
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    if (config?.AttachStdout !== false) {
      child.stdout.on("data", (chunk) => {
        if (!res.destroyed) res.write(tty ? chunk : frameLog(1, chunk));
      });
    }
    if (config?.AttachStderr !== false && !tty) {
      child.stderr.on("data", (chunk) => {
        if (!res.destroyed) res.write(frameLog(2, chunk));
      });
    }
    child.on("close", (code) => {
      execStore.delete(params.id);
      execResults.set(params.id, { ...stored, exitCode: code ?? 0 });
      if (!res.destroyed) res.end();
    });
    child.on("error", () => {
      execStore.delete(params.id);
      if (!res.destroyed) res.end();
    });
    res.on("close", () => child.kill());
  },

  // ── Archive (cp) ──────────────────────────────────────────────────────────
  async getArchive({ params, query, res }) {
    if (!query.path) return apiError(res, 400, "path query parameter required");
    const args = ["copy", `${params.id}:${query.path}`, "-"];
    res.writeHead(200, { "Content-Type": "application/x-tar" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.pipe(res);
    child.on("close", (code) => { if (code !== 0) res.end(); });
  },

  async putArchive({ params, query, req, res }) {
    if (!query.path) return apiError(res, 400, "path query parameter required");
    const args = ["copy", "-", `${params.id}:${query.path}`];
    const child = spawn(CONTAINER_BIN, args, { stdio: ["pipe", "ignore", "ignore"] });
    req.pipe(child.stdin);
    child.on("close", (code) => {
      if (code !== 0) return apiError(res, 500, "copy failed");
      res.writeHead(200); res.end();
    });
  },
};

// ---------------------------------------------------------------------------
// Restart tracking (container ID → restart count)
// ---------------------------------------------------------------------------
const restartCounters = new Map();

function bumpRestartCount(containerId) {
  const count = (restartCounters.get(containerId) ?? 0) + 1;
  restartCounters.set(containerId, count);
  return count;
}

function getRestartCount(containerId) {
  return restartCounters.get(containerId) ?? 0;
}

// ---------------------------------------------------------------------------
// In-memory exec store (exec ID → { containerId, config })
// ---------------------------------------------------------------------------
const execStore = new Map();
const execResults = new Map();

// ---------------------------------------------------------------------------
// Docker multiplexed log frame
// Header: [stream(1B), \0\0\0, size(4B big-endian)]
// ---------------------------------------------------------------------------
function frameLog(stream, chunk) {
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(chunk.length, 4);
  return Buffer.concat([header, chunk]);
}

// ---------------------------------------------------------------------------
// Parse Docker since/until query param: accepts Unix seconds (e.g. 1697055817,
// possibly fractional) or RFC3339 (e.g. 2023-10-11T17:03:37Z). Returns ms
// epoch, or null if absent/unparseable.
// ---------------------------------------------------------------------------
function parseDockerTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Date.parse(new Date(parseFloat(s) * 1000).toISOString());
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Flag builder: Docker ContainerConfig → container run args
// ---------------------------------------------------------------------------
async function buildRunArgs(config, name, platform) {
  const host = config.HostConfig ?? {};
  const args = ["run", "--detach"];
  const warnings = [];

  if (platform) args.push("--platform", platform);
  if (name) args.push("--name", name);
  if (host.OpenStdin) args.push("--interactive");
  if (config.Tty) args.push("--tty");
  for (const value of config.Env ?? []) args.push("--env", value);

  for (const [containerPort, hostBindings] of Object.entries(host.PortBindings ?? {})) {
    const [cPort, protocol = "tcp"] = containerPort.split("/");
    const destination = protocol === "tcp" ? cPort : `${cPort}/${protocol}`;
    for (const binding of hostBindings ?? []) {
      let hostPort = typeof binding.HostPort === "string" ? binding.HostPort.trim() : "";
      const hostIp = binding.HostIp || "";
      if (!hostPort) hostPort = String(await findFreePort());
      const normalizedHostIp = ["127.0.0.1", "localhost", "::1"].includes(hostIp) ? "" : hostIp;
      const host = normalizedHostIp.includes(":") && !normalizedHostIp.startsWith("[")
        ? `[${normalizedHostIp}]`
        : normalizedHostIp;
      args.push("--publish", host ? `${host}:${hostPort}:${destination}` : `${hostPort}:${destination}`);
    }
  }

  for (const bind of host.Binds ?? []) args.push("--volume", bind);
  for (const mount of host.Mounts ?? []) {
    const type = String(mount.Type ?? "").toLowerCase();
    const target = mount.Target ?? mount.Destination;
    if (!target || !["bind", "volume", "tmpfs"].includes(type)) {
      warnings.push(`mount type ${type || "unknown"} is not supported by apple/container`);
      continue;
    }
    if (type === "tmpfs") {
      const size = mount.TmpfsOptions?.SizeBytes;
      args.push("--tmpfs", `${target}${size ? `:size=${Math.ceil(size / 1048576)}m` : ""}`);
      continue;
    }
    const source = mount.Source ?? mount.Name;
    const parts = [`type=${type}`, `target=${target}`];
    if (source) parts.push(`source=${source}`);
    if (mount.ReadOnly) parts.push("readonly");
    args.push("--mount", parts.join(","));
  }
  for (const [target, options] of Object.entries(host.Tmpfs ?? {})) {
    args.push("--tmpfs", `${target}${options ? `:${options}` : ""}`);
  }

  for (const dns of host.Dns ?? []) args.push("--dns", dns);
  for (const option of host.DnsOptions ?? []) args.push("--dns-option", option);
  for (const search of host.DnsSearch ?? []) args.push("--dns-search", search);
  if (host.DnsDomain) args.push("--dns-domain", host.DnsDomain);
  for (const capability of host.CapAdd ?? []) args.push("--cap-add", capability);
  for (const capability of host.CapDrop ?? []) args.push("--cap-drop", capability);
  for (const limit of host.Ulimits ?? []) {
    args.push("--ulimit", `${limit.Name}=${limit.Soft}${limit.Hard !== undefined ? `:${limit.Hard}` : ""}`);
  }

  const network = host.NetworkMode;
  if (network && network !== "default") args.push("--network", network);
  for (const [key, value] of Object.entries(config.Labels ?? {})) args.push("--label", `${key}=${value}`);
  if (host.AutoRemove) args.push("--rm");
  if (host.Init) args.push("--init");
  if (host.ReadonlyRootfs) args.push("--read-only");

  const memory = host.Memory;
  if (memory) args.push("--memory", String(Math.ceil(memory / 1048576)));
  const cpuCount = host.NanoCpus
    ? host.NanoCpus / 1e9
    : host.CpuQuota && host.CpuPeriod
      ? host.CpuQuota / host.CpuPeriod
      : 0;
  if (cpuCount) args.push("--cpus", String(cpuCount));
  if (host.ShmSize) args.push("--shm-size", `${Math.ceil(host.ShmSize / 1048576)}M`);

  for (const [field, value] of [
    ["Hostname", config.Hostname],
    ["ExtraHosts", host.ExtraHosts],
    ["Privileged", host.Privileged],
    ["Devices", host.Devices],
    ["RestartPolicy", host.RestartPolicy?.Name && host.RestartPolicy.Name !== "no"],
    ["SecurityOpt", host.SecurityOpt],
    ["Sysctls", host.Sysctls],
    ["CpuShares", host.CpuShares],
    ["Healthcheck", config.Healthcheck],
  ]) {
    if (Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : value) {
      warnings.push(`${field} is not supported by apple/container`);
    }
  }

  if (config.WorkingDir) args.push("--workdir", config.WorkingDir);
  if (config.User) args.push("--user", config.User);
  args.push(config.Image);

  const entrypoint = Array.isArray(config.Entrypoint) ? config.Entrypoint : config.Entrypoint ? [config.Entrypoint] : [];
  const command = Array.isArray(config.Cmd) ? config.Cmd : config.Cmd ? [config.Cmd] : [];
  if (entrypoint.length) args.push("--entrypoint", entrypoint[0], ...entrypoint.slice(1));
  args.push(...command);

  return { args, warnings };
}

// ---------------------------------------------------------------------------
// Shape translators: apple/container JSON → Docker API JSON
// ---------------------------------------------------------------------------
export function toDockerContainer(c = {}) {
  // apple/container returns status as an object: {state, startedDate, networks}
  const cfg = c.configuration ?? {};
  const stateObj = typeof c.status === "object" ? c.status : {};
  const state = stateObj.state ?? c.state ?? c.State ?? "created";
  const started = stateObj.startedDate ?? "";

  const createdTs = cfg.creationDate
    ? Math.floor(new Date(cfg.creationDate).getTime() / 1000)
    : 0;

  // apple/container is inconsistent about where it puts the real 64-hex id
  // (top-level `id` vs `configuration.id`). Prefer the real id wherever it
  // is, and take the display name from compose labels so Name/Id never
  // swap between containers.
  const labels = cfg.labels ?? c.labels ?? {};
  const realId = c.id ?? c.ID ?? cfg.id ?? "";
  // Prefer the compose service label (clean name) over the container label
  // (project_service format from apple/container compose).
  const name = labels["com.docker.compose.service"]
    ?? labels["com.docker.compose.container"]
    ?? cfg.name ?? c.name ?? c.Name ?? "";

  return {
    Id: realId,
    Names: [name ? `/${name}` : realId],
    Image: cfg.image?.reference ?? c.image ?? c.Image ?? "",
    ImageID: cfg.image?.descriptor?.digest ?? c.imageID ?? "",
    Command: [cfg.initProcess?.executable, ...(cfg.initProcess?.arguments ?? [])]
      .filter(Boolean)
      .join(" "),
    Created: createdTs,
    Status: `${state}${started ? ` (${started})` : ""}`,
    State: state,
    Ports: (cfg.publishedPorts ?? []).map((p) => ({
      PrivatePort: p.containerPort,
      PublicPort: p.hostPort,
      Type: p.proto ?? "tcp",
      IP: p.hostAddress ?? "0.0.0.0",
    })),
    Labels: cfg.labels ?? c.labels ?? {},
    NetworkSettings: { Networks: {} },
    ExitCode: c.exitCode ?? stateObj.exitCode ?? undefined,
  };
}

function toDockerInspect(c = {}) {
  const cfg = c.configuration ?? {};
  const stateObj = typeof c.status === "object" ? c.status : {};
  const state = stateObj.state ?? c.state ?? c.State ?? "created";

  const imageRef = cfg.image?.reference ?? c.image ?? c.Image ?? "";
  const labels = cfg.labels ?? c.labels ?? {};
  const env = cfg.initProcess?.environment ?? c.env ?? [];
  const cmd = cfg.initProcess?.arguments ?? c.cmd ?? [];
  const entrypoint = cfg.initProcess?.executable ? [cfg.initProcess.executable] : [];

  const ports = {};
  for (const p of cfg.publishedPorts ?? []) {
    const proto = p.proto ?? "tcp";
    const key = `${p.containerPort}/${proto}`;
    ports[key] = [{
      HostIp: p.hostAddress ?? "0.0.0.0",
      HostPort: String(p.hostPort ?? ""),
    }];
  }

  const networks = {};
  for (const n of stateObj.networks ?? []) {
    const ip = (n.ipv4Address ?? "").split("/")[0];
    networks[n.network] = {
      NetworkID: n.network,
      EndpointID: "",
      Gateway: n.ipv4Gateway ?? "",
      IPAddress: ip,
      IPPrefixLen: 0,
      MacAddress: n.macAddress ?? "",
      Aliases: [],
    };
  }

  const primaryNetwork = (stateObj.networks ?? [])[0] ?? {};
  const primaryIp = (primaryNetwork.ipv4Address ?? "").split("/")[0] ?? "";
  const containerId = c.id ?? cfg.id ?? c.ID ?? "";
  const restartCount = getRestartCount(containerId);

  return {
    Id: containerId,
    Name: `/${cfg.id ?? c.id ?? c.name ?? c.Name ?? ""}`,
    Image: imageRef,
    Created: cfg.creationDate ?? c.created ?? "",
    State: {
      Status: state,
      Running: state === "running",
      Paused: state === "paused",
      Restarting: false,
      Dead: state === "dead",
      ExitCode: c.exitCode ?? stateObj.exitCode ?? undefined,
      Error: "",
      StartedAt: stateObj.startedDate ?? "",
      FinishedAt: stateObj.finishedDate ?? stateObj.finishedAt ?? "",
      Recreate: 0,
    },
    RestartCount: restartCount,
    Config: {
      Image: imageRef,
      Env: env,
      Cmd: cmd,
      Entrypoint: entrypoint,
      Labels: labels,
      WorkingDir: cfg.initProcess?.workingDirectory ?? "/",
      User: cfg.initProcess?.user?.id
        ? `${cfg.initProcess.user.id.uid}:${cfg.initProcess.user.id.gid}`
        : "",
    },
    HostConfig: {
      PortBindings: ports,
      Binds: [],
      NetworkMode: (cfg.networks?.[0]?.network ?? "default"),
    },
    NetworkSettings: {
      IPAddress: primaryIp,
      Gateway: primaryNetwork.ipv4Gateway ?? "",
      MacAddress: primaryNetwork.macAddress ?? "",
      Ports: ports,
      Networks: networks,
    },
    Mounts: [],
  };
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : null;
      server.close((err) => {
        if (err) return reject(err);
        if (!port) return reject(new Error("failed to allocate free port"));
        resolve(port);
      });
    });
  });
}

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function parseLines(stdout) {
  if (!stdout) return [];
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  // Try full JSON array first
  if (trimmed.startsWith("[")) {
    try { return JSON.parse(trimmed); } catch {}
  }
  // Fall back to one object per line (NDJSON)
  return trimmed.split("\n").flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}
