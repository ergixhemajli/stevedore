/**
 * src/api/routes/images.js
 */
import { run, json, apiError } from "../run.js";
import { spawn } from "node:child_process";
import { CONTAINER_BIN } from "../../utils/exec.js";

export const images = {

  async list({ query, res }) {
    const args = ["image", "list", "--format", "json"];
    if (query.all === "1") args.push("--all");
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const parsed = parseLines(stdout);
    json(res, 200, parsed.map(toDockerImage));
  },

  async pull({ query, req, res }) {
    const ref = query.fromImage + (query.tag ? `:${query.tag}` : "");
    if (!ref || ref === "undefined") return apiError(res, 400, "fromImage query parameter required");

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

    // If we're about to pull an arm variant, remove any existing local amd64
    // image with the same ref so the pull will fetch the arm64 variant. This
    // avoids Docker/container reusing a cached amd64 manifest and running
    // under QEMU on Apple Silicon.
    if (platform && platform.includes("arm")) {
      try {
        const { stdout: inspectOut, exitCode: inspectCode } = await run(["image", "inspect", ref]);
        if (inspectCode === 0) {
          try {
            const inspected = JSON.parse(inspectOut)[0];
            const existingArch = inspected?.variants?.[0]?.platform?.architecture;
            if (existingArch === "amd64") {
              res.write(JSON.stringify({ status: `Removing local amd64 image ${ref} to force ${platform} pull` }) + "\n");
              await run(["image", "delete", ref]);
            }
          } catch (e) {
            // ignore parse errors
          }
        }
      } catch (e) {
        // ignore inspect/delete failures
      }
    }

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

    req.on("close", () => {
      clearInterval(heartbeat);
      child.kill();
    });

    child.on("exit", (code) => {
      clearInterval(heartbeat);
      if (code !== 0) {
        res.write(JSON.stringify({ error: `pull failed with exit code ${code}` }) + "\n");
      } else {
        res.write(JSON.stringify({ status: `Pulled image ${ref}` }) + "\n");
      }
      res.end();
    }).on("error", (err) => {
      clearInterval(heartbeat);
      res.write(JSON.stringify({ error: err.message }) + "\n");
      res.end();
    });

    child.on("error", (err) => {
      clearInterval(heartbeat);
      res.write(JSON.stringify({ error: err.message }) + "\n");
      res.end();
    });
  },

  async inspect({ params, res }) {
    const { stdout, stderr, exitCode } = await run(["image", "inspect", params.name]);
    if (exitCode !== 0) return apiError(res, 404, `No such image: ${params.name}`);
    try { json(res, 200, toDockerImageInspect(JSON.parse(stdout)[0])); }
    catch { apiError(res, 500, "Failed to parse inspect output"); }
  },

  async remove({ params, query, res }) {
    const args = ["image", "delete", params.name];
    if (query.force === "1") args.push("--force");
    const { stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    json(res, 200, [{ Untagged: params.name }]);
  },

  async tag({ params, query, res }) {
    const target = query.repo + (query.tag ? `:${query.tag}` : "");
    const { stderr, exitCode } = await run(["image", "tag", params.name, target]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    res.writeHead(201); res.end();
  },

  async history({ params, res }) {
    // apple/container doesn't have image history — return empty
    json(res, 200, []);
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
    child.on("exit", (code) => {
      if (code !== 0) res.write(JSON.stringify({ error: "build failed" }) + "\n");
      res.end();
    });
  },
};

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
