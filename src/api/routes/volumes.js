/**
 * src/api/routes/volumes.js
 */
import { run, json, apiError } from "../run.js";
import { parseFilters, matchesFilters } from "../filters.js";

export const volumes = {
  async list({ query, res }) {
    const { stdout, exitCode, stderr } = await run(["volume", "list", "--format", "json"]);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    const parsed = parseLines(stdout);
    const dockerFormat = parsed.map(toDockerVolume);
    json(res, 200, { Volumes: query.filters
      ? dockerFormat.filter((vol) => matchesFilters(parseFilters(query.filters), vol))
      : dockerFormat,
      Warnings: []
    });
  },
  async create({ body, res }) {
    const name = body?.Name ?? "";
    const args = ["volume", "create", ...(name ? [name] : [])];
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    json(res, 201, toDockerVolume({ name: stdout.trim() || name }));
  },
  async inspect({ params, res }) {
    const { stdout, stderr, exitCode } = await run(["volume", "inspect", params.name, "--format", "json"]);
    if (exitCode !== 0) return apiError(res, 404, `No such volume: ${params.name}`);
    try { json(res, 200, toDockerVolume(JSON.parse(stdout))); }
    catch { apiError(res, 500, "parse error"); }
  },
  async remove({ params, res }) {
    const { stderr, exitCode } = await run(["volume", "delete", params.name]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },
  async prune({ res }) {
    await run(["volume", "prune"]);
    json(res, 200, { VolumesDeleted: [], SpaceReclaimed: 0 });
  },
};

function toDockerVolume(v) {
  return {
    Name: v.name ?? v.Name ?? "",
    Driver: "local",
    Mountpoint: v.mountpoint ?? v.Mountpoint ?? "",
    CreatedAt: v.created ?? "",
    Status: {},
    Labels: v.labels ?? {},
    Scope: "local",
    Options: {},
  };
}

function parseLines(s) {
  if (!s?.trim()) return [];
  if (s.trim().startsWith("[")) { try { return JSON.parse(s); } catch {} }
  return s.trim().split("\n").flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}
