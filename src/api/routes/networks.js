/**
 * src/api/routes/networks.js
 */
import { run, json, apiError } from "../run.js";
import { parseFilters, matchesFilters } from "../filters.js";

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

    const args = ["network", "create"];

    // Docker compose relies on network labels such as:
    // - com.docker.compose.project
    // - com.docker.compose.network
    // Preserve them so compose can detect ownership correctly.
    for (const [k, v] of Object.entries(body.Labels ?? {})) {
      args.push("--label", `${k}=${v}`);
    }

    if (body.Internal === true) args.push("--internal");

    // Map network options to apple/container's --option key=value
    for (const [k, v] of Object.entries(body.Options ?? {})) {
      args.push("--option", `${k}=${v}`);
    }

    // Driver is not directly compatible with apple/container plugin naming.
    // Compose commonly sends "bridge"; ignore driver hints for compatibility.

    args.push(body.Name);

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
