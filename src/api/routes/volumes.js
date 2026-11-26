/**
 * src/api/routes/volumes.js
 */
import { run, runJSON, json, apiError } from "../run.js";
import { randomUUID } from "node:crypto";
import { parseFilters, matchesFilters, hasFilters } from "../filters.js";

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
    const name = body?.Name || randomUUID();
    if (body?.Driver && body.Driver !== "local") {
      return apiError(res, 501, `volume driver ${body.Driver} is not supported by apple/container`);
    }
    const args = ["volume", "create"];
    for (const [key, value] of Object.entries(body?.Labels ?? {})) args.push("--label", `${key}=${value}`);
    for (const [key, value] of Object.entries(body?.DriverOpts ?? {})) args.push("--opt", `${key}=${value}`);
    if (name) args.push(name);
    const { stdout, stderr, exitCode } = await run(args);
    if (exitCode !== 0) return apiError(res, 500, stderr);
    json(res, 201, toDockerVolume({ name: stdout.trim() || name, labels: body?.Labels ?? {} }));
  },
  async inspect({ params, res }) {
    const { stdout, exitCode } = await run(["volume", "inspect", params.name]);
    if (exitCode !== 0) return apiError(res, 404, `No such volume: ${params.name}`);
    try {
      const parsed = JSON.parse(stdout);
      json(res, 200, toDockerVolume(Array.isArray(parsed) ? parsed[0] : parsed));
    } catch { apiError(res, 500, "parse error"); }
  },
  async remove({ params, res }) {
    const { stderr, exitCode } = await run(["volume", "delete", params.name]);
    if (exitCode !== 0) return apiError(res, 404, stderr);
    res.writeHead(204); res.end();
  },
  async prune({ query, res }) {
    if (hasFilters(query.filters)) return apiError(res, 501, "volume prune filters are not supported by apple/container");
    const before = await runJSON(["volume", "list"]);
    const beforeDf = await runJSON(["system", "df"]).catch(() => null);
    const result = await run(["volume", "prune"]);
    if (result.exitCode !== 0) return apiError(res, 500, result.stderr);
    const after = await runJSON(["volume", "list"]);
    const afterDf = await runJSON(["system", "df"]).catch(() => null);
    const remaining = new Set((Array.isArray(after) ? after : after ? [after] : []).map((volume) => volume.name ?? volume.Name));
    const removed = (Array.isArray(before) ? before : before ? [before] : [])
      .map((volume) => volume.name ?? volume.Name)
      .filter((name) => name && !remaining.has(name));
    const beforeSize = Number(beforeDf?.volumes?.sizeInBytes) || 0;
    const afterSize = Number(afterDf?.volumes?.sizeInBytes) || 0;
    json(res, 200, { VolumesDeleted: removed, SpaceReclaimed: Math.max(0, beforeSize - afterSize) });
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
