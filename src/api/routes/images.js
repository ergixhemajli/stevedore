/**
 * src/api/routes/images.js
 */
import { run, runJSON, json, apiError } from "../run.js";
import { spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { CONTAINER_BIN } from "../../utils/exec.js";
import { authenticate } from "./system.js";
import { parseFilters, matchesFilters, hasFilters } from "../filters.js";

export const images = {

  async list({ query, res }) {
    const args = ["image", "list", "--format", "json"];
    if (query.all === "1" || query.all === "true") args.push("--all");
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const parsed = parseLines(stdout);
    const dockerFormat = parsed.map(toDockerImage);
    json(res, 200, query.filters
      ? dockerFormat.filter((img) => matchesFilters(parseFilters(query.filters), img))
      : dockerFormat
    );
  },

  async pull({ query, res }) {
    const rawImage = query.fromImage;
    const tag = query.tag;

    if (!rawImage || rawImage === "undefined" || rawImage === "null") {
      return apiError(res, 400, "fromImage query parameter required");
    }

    // ── Image reference normalization ─────────────────────────────────────
    // Normalize short image names to full references:
    //   alpine      → docker.io/library/alpine:latest
    //   alpine:3.14 → docker.io/library/alpine:3.14
    //   nginx:latest → docker.io/library/nginx:latest
    //   already-qualified.io/repo → pass through
    //   image@sha256:abc → pass through (digest reference)
    let ref = rawImage;
    if (!ref.includes("/") && !ref.startsWith("@")) {
      ref = `docker.io/library/${ref}`;
    }
    const lastComponent = ref.slice(ref.lastIndexOf("/") + 1);
    if (!ref.includes("@") && !lastComponent.includes(":")) {
      ref = `${ref}:${tag || "latest"}`;
    }
    if (!ref) return apiError(res, 400, "fromImage query parameter required");

    res.writeHead(200, { "Content-Type": "application/json" });

    // Send an initial progress event so docker-java/Testcontainers immediately
    // receives a PullResponseItem and starts its watchdog timer from activity.
    res.write(JSON.stringify({ status: `Pulling image ${ref}` }) + "\n");

    const args = ["image", "pull", ref];
    // Prefer a platform that matches the host architecture when no explicit
    // platform is provided. This avoids pulling an amd64 variant on arm64
    // Apple Silicon hosts which would otherwise run under QEMU emulation.
    // The client may pass a platform via the Docker API query param; if set,
    // honor that first.
    let platform = query.platform;
    if (!platform) {
      if (process.arch === "arm64") platform = "linux/arm64";
      else if (process.arch === "x64") platform = "linux/amd64";
    }
    if (platform) args.push("--platform", platform);

    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    const emitLines = (buf) => {
      const text = buf.toString();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        res.write(JSON.stringify({ status: trimmed }) + "\n");
      }
    };

    child.stdout.on("data", emitLines);
    child.stderr.on("data", emitLines);

    // Some pulls are silent for >30s with apple/container. Emit heartbeat
    // progress frames so Testcontainers pull watchdog sees forward activity.
    const heartbeat = setInterval(() => {
      if (res.writableEnded || child.killed) return;
      res.write(JSON.stringify({
        status: `Pulling image ${ref}`,
        progressDetail: { current: 1, total: 1 },
      }) + "\n");
    }, 5000);

    res.on("close", () => {
      clearInterval(heartbeat);
      child.kill();
    });

    child.on("close", (code) => {
      clearInterval(heartbeat);
      if (res.destroyed) return;
      if (code !== 0) {
        res.write(JSON.stringify({ error: `pull failed with exit code ${code}` }) + "\n");
      } else {
        res.write(JSON.stringify({ status: `Pulled image ${ref}` }) + "\n");
      }
      res.end();
    });

    child.on("error", (err) => {
      clearInterval(heartbeat);
      if (res.destroyed) return;
      res.write(JSON.stringify({ error: err.message }) + "\n");
      res.end();
    });
  },

  async inspect({ params, res }) {
    const { stdout, exitCode } = await run(["image", "inspect", params.name]);
    if (exitCode !== 0) return apiError(res, 404, `No such image: ${params.name}`);
    try {
      const parsed = JSON.parse(stdout);
      json(res, 200, toDockerImageInspect(Array.isArray(parsed) ? parsed[0] : parsed));
    } catch { apiError(res, 500, "Failed to parse inspect output"); }
  },

  async load({ req, res }) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "stevedore-image-load-"));
    const archive = path.join(tempDir, "image.tar");
    try {
      await pipeline(req, createWriteStream(archive));
      const { stdout, stderr, exitCode } = await run(["image", "load", "--input", archive]);
      if (exitCode !== 0) return apiError(res, 500, stderr);
      const lines = stdout ? stdout.split(/\r?\n/).filter(Boolean) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(lines.map((line) => JSON.stringify({ stream: `${line}\n` })).join("\n") + (lines.length ? "\n" : ""));
    } catch (error) {
      apiError(res, 500, error.message);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },

  async save({ params, query, res }) {
    const references = params.name
      ? [params.name]
      : String(query.names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    if (!references.length) return apiError(res, 400, "image name required");
    const check = await run(["image", "inspect", ...references]);
    if (check.exitCode !== 0) return apiError(res, 404, check.stderr);

    res.writeHead(200, { "Content-Type": "application/x-tar" });
    const child = spawn(CONTAINER_BIN, ["image", "save", ...references], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(res);
    child.on("close", (code) => {
      if (res.destroyed) return;
      if (code !== 0) return res.destroy(new Error("image save failed"));
      res.end();
    });
    child.on("error", (error) => { if (!res.destroyed) res.destroy(error); });
    res.on("close", () => child.kill());
  },

  async push({ params, query, req, res }) {
    const header = req.headers?.["x-registry-auth"];
    if (header) {
      let auth;
      try { auth = JSON.parse(Buffer.from(header, "base64").toString("utf8")); }
      catch { return apiError(res, 400, "invalid X-Registry-Auth header"); }
      if (Object.keys(auth ?? {}).length) {
        const login = await authenticate(auth);
        if (login.error) return apiError(res, login.error.includes("not supported") ? 501 : 401, login.error);
      }
    }

    const name = params.name;
    const lastComponent = name.slice(name.lastIndexOf("/") + 1);
    const reference = query.tag && !lastComponent.includes(":") && !name.includes("@") ? `${name}:${query.tag}` : name;
    const args = ["image", "push", reference];
    if (query.platform) args.push("--platform", query.platform);
    res.writeHead(200, { "Content-Type": "application/json" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const emit = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) res.write(JSON.stringify({ status: line.trim() }) + "\n");
      }
    };
    child.stdout.on("data", emit);
    child.stderr.on("data", emit);
    child.on("close", (code) => {
      if (res.destroyed) return;
      if (code !== 0) res.write(JSON.stringify({ error: `push failed with exit code ${code}` }) + "\n");
      else res.write(JSON.stringify({ status: `Pushed image ${reference}` }) + "\n");
      res.end();
    });
    child.on("error", (error) => {
      if (!res.destroyed) {
        res.write(JSON.stringify({ error: error.message }) + "\n");
        res.end();
      }
    });
    res.on("close", () => child.kill());
  },

  async prune({ query, res }) {
    const filters = parseFilters(query.filters);
    if (query.filters && hasFilters(query.filters) && Object.keys(filters).length === 0) {
      return apiError(res, 400, "invalid filters JSON");
    }
    const entries = Object.entries(filters);
    if (entries.some(([key]) => key !== "dangling")) {
      return apiError(res, 501, "image prune filter is not supported by apple/container");
    }
    if (filters.dangling && (filters.dangling.length !== 1 || !["true", "false"].includes(filters.dangling[0]))) {
      return apiError(res, 400, "invalid dangling filter");
    }
    const all = filters.dangling?.[0] === "false";
    const before = toArray(await runJSON(["image", "list"]));
    const beforeDf = await runJSON(["system", "df"]).catch(() => null);
    const result = await run(["image", "prune", ...(all ? ["--all"] : [])]);
    if (result.exitCode !== 0) return apiError(res, 500, result.stderr);
    const after = toArray(await runJSON(["image", "list"]));
    const afterDf = await runJSON(["system", "df"]).catch(() => null);
    const remaining = new Set(after.map((image) => image.id ?? image.ID));
    const deleted = before.filter((image) => !remaining.has(image.id ?? image.ID));
    const ImagesDeleted = deleted.flatMap((image) => [
      ...(image.tags ?? []).map((tag) => ({ Untagged: tag })),
      { Deleted: image.id ?? image.ID },
    ]);
    const beforeSize = Number(beforeDf?.images?.sizeInBytes) || 0;
    const afterSize = Number(afterDf?.images?.sizeInBytes) || 0;
    const SpaceReclaimed = Math.max(0, beforeSize - afterSize);
    json(res, 200, { ImagesDeleted, SpaceReclaimed });
  },

  async remove({ params, query, res }) {
    const args = ["image", "delete", params.name];
    if (query.force === "1" || query.force === "true") args.push("--force");
    const { stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    json(res, 200, [{ Untagged: params.name }]);
  },

  async tag({ params, query, res }) {
    if (!query.repo) return apiError(res, 400, "repo query parameter required");
    const target = query.repo + (query.tag ? `:${query.tag}` : "");
    const { stderr, exitCode } = await run(["image", "tag", params.name, target]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    res.writeHead(201); res.end();
  },

  async history({ res }) {
    apiError(res, 501, "image history is not supported by apple/container");
  },

  async search({ res }) {
    apiError(res, 501, "registry search is not supported by apple/container");
  },

  async build({ req, query, res }) {
    // Pipe the tar body directly to `container build -`
    const tag = query.t;
    const args = ["build", ...(tag ? ["-t", tag] : []), "-"];
    res.writeHead(200, { "Content-Type": "application/json" });
    const child = spawn(CONTAINER_BIN, args, { stdio: ["pipe", "pipe", "pipe"] });
    req.pipe(child.stdin);
    child.stdout.on("data", (d) => res.write(JSON.stringify({ stream: d.toString() }) + "\n"));
    child.stderr.on("data", (d) => res.write(JSON.stringify({ stream: d.toString() }) + "\n"));
    child.on("close", (code) => {
      if (code !== 0) res.write(JSON.stringify({ error: "build failed" }) + "\n");
      res.end();
    });
  },
};

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function toDockerImage(i) {
  return {
    Id: i.id ?? i.ID ?? "",
    RepoTags: i.tags ?? (i.name ? [i.name] : ["<none>:<none>"]),
    RepoDigests: [],
    Created: i.created ?? 0,
    Size: i.size ?? 0,
    VirtualSize: i.size ?? 0,
    Labels: i.labels ?? {},
  };
}

function toDockerImageInspect(i) {
  // apple/container inspect returns: { id, configuration, variants }
  // Flatten to Docker's inspect format
  const name = i.configuration?.name ?? "";
  const arch = i.variants?.[0]?.platform?.architecture ?? "arm64";
  const cmd = i.variants?.[0]?.config?.config?.Cmd ?? ["/bin/sh"];

  return {
    Id: i.id ?? "",
    RepoTags: [name],
    RepoDigests: [`${name}@${i.configuration?.descriptor?.digest ?? ""}`],
    Created: i.configuration?.creationDate ?? "",
    Size: i.variants?.reduce((sum, v) => sum + (v.size ?? 0), 0) ?? 0,
    Config: {
      Env: i.variants?.[0]?.config?.config?.Env ?? [],
      Cmd: cmd,
      Labels: {},
      Image: name,
      WorkingDir: i.variants?.[0]?.config?.config?.WorkingDir ?? "/",
    },
    Architecture: arch,
    Os: "linux",
    OsVersion: "",
    OsFeatures: [],
    Variant: arch === "arm64" ? "v8" : "",
  };
}

function parseLines(stdout) {
  if (!stdout?.trim()) return [];
  if (stdout.trim().startsWith("[")) { try { return JSON.parse(stdout); } catch {} }
  return stdout.trim().split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}
