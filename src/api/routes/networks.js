/**
 * src/api/routes/networks.js
 */
import { run, runJSON, json, apiError } from "../run.js";
import { parseFilters, matchesFilters, hasFilters } from "../filters.js";

export const networks = {
  async list({ query, res }) {
    const { stdout, exitCode, stderr } = await run(["network", "list", "--format", "json"]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const parsed = parseLines(stdout);
    const dockerFormat = parsed.map(toDockerNetwork);
    json(res, 200, query.filters
      ? dockerFormat.filter((net) => matchesFilters(parseFilters(query.filters), net))
      : dockerFormat
    );
  },
  async create({ body, res }) {
    if (!body?.Name) return apiError(res, 400, "Name required");
    if (body.Driver && body.Driver !== "bridge") {
      return apiError(res, 501, `network driver ${body.Driver} is not supported by apple/container`);
    }
    if (body.Attachable || body.Ingress) return apiError(res, 501, "attachable and ingress networks are not supported by apple/container");

    const args = ["network", "create"];
    for (const [key, value] of Object.entries(body.Labels ?? {})) args.push("--label", `${key}=${value}`);
    if (body.Internal === true) args.push("--internal");
    for (const [key, value] of Object.entries(body.Options ?? {})) args.push("--option", `${key}=${value}`);

    for (const config of body.IPAM?.Config ?? []) {
      if (config.Gateway) return apiError(res, 501, "custom network gateways are not supported by apple/container");
      if (config.Subnet) args.push(config.Subnet.includes(":") ? "--subnet-v6" : "--subnet", config.Subnet);
    }

    args.push(body.Name);
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    json(res, 201, { Id: stdout.trim() || body.Name, Warning: "" });
  },
  async connect({ res }) {
    apiError(res, 501, "network connect is not supported by apple/container");
  },
  async disconnect({ res }) {
    apiError(res, 501, "network disconnect is not supported by apple/container");
  },
  async inspect({ params, res }) {
    const { stdout, exitCode } = await run(["network", "inspect", params.id]);
    if (exitCode !== 0) return apiError(res, 404, `No such network: ${params.id}`);
    try {
      const parsed = JSON.parse(stdout);
      json(res, 200, toDockerNetwork(Array.isArray(parsed) ? parsed[0] : parsed));
    } catch { apiError(res, 500, "parse error"); }
  },
  async remove({ params, res }) {
    const { stderr, exitCode } = await run(["network", "delete", params.id]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },
  async prune({ query, res }) {
    if (hasFilters(query.filters)) return apiError(res, 501, "network prune filters are not supported by apple/container");
    const before = await runJSON(["network", "list"]);
    const result = await run(["network", "prune"]);
    if (result.exitCode !== 0) return apiError(res, 500, result.stderr);
    const after = await runJSON(["network", "list"]);
    const remaining = new Set((Array.isArray(after) ? after : after ? [after] : []).map((network) => network.id ?? network.ID));
    const removed = (Array.isArray(before) ? before : before ? [before] : [])
      .map((network) => network.id ?? network.ID)
      .filter((id) => id && !remaining.has(id));
    json(res, 200, { NetworksDeleted: removed });
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
    Options: config.options ?? {},
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
