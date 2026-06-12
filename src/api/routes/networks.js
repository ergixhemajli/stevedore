/**
 * src/api/routes/networks.js
 */
import { run, json, apiError } from "../run.js";

export const networks = {
  async list({ res }) {
    const { stdout, exitCode, stderr } = await run(["network", "list", "--format", "json"]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const parsed = parseLines(stdout);
    json(res, 200, parsed.map(toDockerNetwork));
  },
  async create({ body, res }) {
    if (!body?.Name) return apiError(res, 400, "Name required");
    const args = ["network", "create", body.Name];
    if (body.Driver && body.Driver !== "bridge") args.push("--driver", body.Driver);
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    json(res, 201, { Id: stdout.trim() || body.Name, Warning: "" });
  },
  async inspect({ params, res }) {
    const { stdout, stderr, exitCode } = await run(["network", "inspect", params.id]);
    if (exitCode !== 0) return apiError(res, 404, `No such network: ${params.id}`);
    try { json(res, 200, toDockerNetwork(JSON.parse(stdout)[0])); }
    catch { apiError(res, 500, "parse error"); }
  },
  async remove({ params, res }) {
    const { stderr, exitCode } = await run(["network", "delete", params.id]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },
  async prune({ res }) {
    await run(["network", "prune"]);
    json(res, 200, { NetworksDeleted: [] });
  },
};

function toDockerNetwork(n) {
  const config = n.configuration ?? {};
  return {
    Name: config.name ?? n.name ?? n.Name ?? "",
    Id: n.id ?? n.ID ?? config.name ?? "",
    Driver: n.driver ?? "bridge",
    Scope: "local",
    IPAM: { Driver: "default", Config: [] },
    Internal: false,
    Attachable: false,
    Ingress: false,
    Containers: {},
    Options: {},
    Labels: config.labels ?? {},
    Status: {
      Containers: {},
      Extends: false,
      Integrity: "",
    },
  };
}

function parseLines(s) {
  if (!s?.trim()) return [];
  if (s.trim().startsWith("[")) { try { return JSON.parse(s); } catch {} }
  return s.trim().split("\n").flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}
