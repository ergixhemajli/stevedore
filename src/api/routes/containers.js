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
import { parseFilters, matchesFilters } from "../filters.js";

export const containers = {

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
      .filter((c) => matchesFilters(parseFilters(query.filters), c));
    json(res, 200, dockerFormat);
  },

  // ── Create ────────────────────────────────────────────────────────────────
  async create({ query, body, res }) {
    if (!body?.Image) return apiError(res, 400, "Image is required");

    let platform = body.Platform;
    if (!platform) {
      if (process.arch === "arm64") platform = "linux/arm64";
      else if (process.arch === "x64") platform = "linux/amd64";
    }

    const args = await buildRunArgs(body, query.name, platform);

    // Use 'container create' (not 'run') so the container is NOT started yet.
    // This gives Testcontainers time to configure its resource reaper (Ryuk)
    // before the container begins executing.
    args[0] = "create"; // replace "run" with "create"
    args.splice(1, 1);  // remove "--detach" — create has no detach flag
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr || stdout);

    const id = stdout.trim().split("\n").pop();
    json(res, 201, { Id: id, Warnings: [] });
  },

  // ── Inspect ───────────────────────────────────────────────────────────────
  async inspect({ params, res }) {
    const { stdout, stderr, exitCode } = await run(["inspect", params.id]);
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
    const args = ["stop", params.id];
    if (query.t) args.push("--time", query.t);
    const { stderr, exitCode } = await run(args);
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
  async restart({ params, res }) {
    bumpRestartCount(params.id);
    await run(["stop", params.id]);
    const { stderr, exitCode } = await run(["start", params.id]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
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

  // ── Rename ────────────────────────────────────────────────────────────────
  // apple/container does not support renaming containers (internal ID is immutable).
  // Return 204 as a no-op. Compose will keep the internal suffixed IDs
  // (e.g. atlas-db_atlas-db) but won't crash on recreate.
  async rename({ params, query, res }) {
    res.writeHead(204); res.end();
  },

  // ── Logs ──────────────────────────────────────────────────────────────────
  async logs({ params, query, req, res }) {
    const args = ["logs", params.id];
    if (query.follow === "1" || query.follow === "true") args.push("--follow");
    if (query.tail && query.tail !== "all") args.push("--tail", query.tail);

    res.writeHead(200, { "Content-Type": "application/octet-stream" });

    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    // Docker log stream multiplexing header: [stream_type(1), 0,0,0, size(4)]
    child.stdout.on("data", (chunk) => res.write(frameLog(1, chunk)));
    child.stderr.on("data", (chunk) => res.write(frameLog(2, chunk)));
    child.on("close", () => res.end());
    req.on("close", () => child.kill());
  },

  // ── Top ───────────────────────────────────────────────────────────────────
  async top({ params, res }) {
    // apple/container doesn't support top; return a minimal response
    json(res, 200, { Titles: ["PID", "USER", "TIME", "COMMAND"], Processes: [] });
  },

  // ── Stats ─────────────────────────────────────────────────────────────────
  async stats({ params, query, req, res }) {
    const args = ["stats", params.id, "--format", "json"];
    if (!(query.stream === "0" || query.stream === "false")) args.push("--follow");

    res.writeHead(200, { "Content-Type": "application/json" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (d) => res.write(d));
    child.on("close", () => res.end());
    req.on("close", () => child.kill());
  },

  // ── Wait ──────────────────────────────────────────────────────────────────
  async wait({ params, res }) {
    const { stdout, exitCode } = await run(["wait", params.id]);
    const code = parseInt(stdout.trim(), 10) || 0;
    json(res, 200, { StatusCode: code });
  },

  // ── Exec create ───────────────────────────────────────────────────────────
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
    const cmd = config?.Cmd ?? [];
    const args = ["exec", containerId, ...cmd];

    if (body?.Detach) {
      const { stderr, exitCode } = await run(args);
      if (exitCode !== 0) return apiError(res, 500, stderr);
      res.writeHead(204); res.end();
    } else {
      // Attach mode — stream output back
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => res.write(frameLog(1, d)));
      child.stderr.on("data", (d) => res.write(frameLog(2, d)));
      child.on("close", () => res.end());
    }

    execStore.delete(params.id);
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
// Flag builder: Docker ContainerConfig → container run args
// ---------------------------------------------------------------------------
async function buildRunArgs(config, name, platform) {
  const args = ["run", "--detach"];

  if (platform) args.push("--platform", platform);
  if (name) args.push("--name", name);

  // Environment
  for (const e of config.Env ?? []) args.push("--env", e);

  // Port bindings
  const bindings = config.HostConfig?.PortBindings ?? {};
  for (const [containerPort, hostBindings] of Object.entries(bindings)) {
    const cPort = containerPort.split("/")[0];
    for (const hb of hostBindings ?? []) {
      const hostPortRaw = hb.HostPort;
      let hostPort = typeof hostPortRaw === "string" ? hostPortRaw.trim() : "";
      const hostIp = hb.HostIp || "";

      // Docker semantics: empty HostPort means "assign a random host port".
      // apple/container requires an explicit host port, so we allocate one.
      if (!hostPort) {
        hostPort = String(await findFreePort());
      }

      // apple/container currently behaves inconsistently with loopback-only
      // publish bindings coming from Docker API (e.g. 127.0.0.1:10101:5432),
      // where the port can appear open but not forward traffic.
      // For compatibility, treat loopback HostIp as unspecified.
      const normalizedHostIp = ["127.0.0.1", "localhost", "::1"].includes(hostIp)
        ? ""
        : hostIp;

      const bind = normalizedHostIp
        ? `${normalizedHostIp}:${hostPort}:${cPort}`
        : `${hostPort}:${cPort}`;
      args.push("--publish", bind);
    }
  }

  // Volume mounts (Binds = legacy named volumes)
  for (const mount of config.HostConfig?.Binds ?? []) args.push("--volume", mount);

  // Additional mounts (HostConfig.Mounts) — skip host/path if app doesn't set them
  // (apple/container may not support this yet)

  // Extra hosts
  for (const host of config.HostConfig?.ExtraHosts ?? []) {
    args.push("--add-host", host);
  }

  // Tmpfs mounts
  for (const [dest, opts] of Object.entries(config.HostConfig?.Tmpfs ?? {})) {
    args.push("--tmpfs", `${dest}${opts ? ":" + opts : ""}`);
  }

  // Network
  const network = config.HostConfig?.NetworkMode;
  if (network && network !== "default") args.push("--network", network);

  // Labels
  for (const [k, v] of Object.entries(config.Labels ?? {})) args.push("--label", `${k}=${v}`);

  // Memory limit — apple/container --memory takes MiB (not bytes)
  const mem = config.HostConfig?.Memory;
  if (mem) args.push("--memory", String(Math.ceil(mem / 1048576)));

  // CPU quota — NanoCpus → --cpus (float)
  const cpus = config.HostConfig?.NanoCpus;
  if (cpus) args.push("--cpus", String(cpus / 1e9));

  // CpuQuota / CpuPeriod → --cpu-quota (apple/container may not support both)
  if (config.HostConfig?.CpuQuota && config.HostConfig?.CpuPeriod) {
    args.push("--cpu-quota", String(config.HostConfig.CpuQuota));
    args.push("--cpu-period", String(config.HostConfig.CpuPeriod));
  }

  // Hostname
  if (config.Hostname) args.push("--hostname", config.Hostname);

  // Working directory
  if (config.WorkingDir) args.push("--workdir", config.WorkingDir);

  // User
  if (config.User) args.push("--user", config.User);

  // Image
  args.push(config.Image);

  // Entrypoint + Cmd — apple/container --entrypoint takes only the executable;
  // the rest of the entrypoint + Cmd are treated as positional args.
  const entrypoint = config.Entrypoint ?? [];
  const cmd = config.Cmd ?? [];

  if (entrypoint.length) {
    args.push("--entrypoint", entrypoint[0]);
    if (entrypoint.length > 1) {
      args.push(...entrypoint.slice(1));
    }
    if (cmd.length) {
      args.push(...cmd);
    }
  } else {
    // No entrypoint: Cmd is the command to run.
    if (cmd.length) args.push(...cmd);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Shape translators: apple/container JSON → Docker API JSON
// ---------------------------------------------------------------------------
function toDockerContainer(c = {}) {
  // apple/container returns status as an object: {state, startedDate, networks}
  const cfg = c.configuration ?? {};
  const stateObj = typeof c.status === "object" ? c.status : {};
  const state = stateObj.state ?? c.state ?? c.State ?? "created";
  const started = stateObj.startedDate ?? "";

  const createdTs = cfg.creationDate
    ? Math.floor(new Date(cfg.creationDate).getTime() / 1000)
    : 0;

  return {
    Id: c.id ?? cfg.id ?? c.ID ?? "",
    Names: [`/${cfg.id ?? c.name ?? c.Name ?? ""}`],
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
