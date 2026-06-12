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

  async pull({ query, res }) {
    const ref = query.fromImage + (query.tag ? `:${query.tag}` : "");
    if (!ref || ref === "undefined") return apiError(res, 400, "fromImage query parameter required");
    res.writeHead(200, { "Content-Type": "application/json" });
    const child = spawn(CONTAINER_BIN, ["image", "pull", ref], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => res.write(JSON.stringify({ status: d.toString().trim() }) + "\n"));
    child.stderr.on("data", (d) => res.write(JSON.stringify({ status: d.toString().trim() }) + "\n"));
    child.on("exit", (code) => {
      if (code !== 0) res.write(JSON.stringify({ error: `pull failed with exit code ${code}` }) + "\n");
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
