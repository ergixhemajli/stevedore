/**
 * src/api/router.js
 *
 * Matches incoming Docker API HTTP requests to route handlers.
 *
 * Route handlers live in src/api/routes/ — one file per Docker API resource
 * (containers, images, networks, volumes, system).
 *
 * Adding a new endpoint:
 *   1. Add a route entry to ROUTES below
 *   2. Implement the handler in the appropriate src/api/routes/*.js file
 *   3. Add a test in test/api/routes/<resource>.test.js
 *
 * Route matching supports:
 *   - Exact paths:          /v1.41/containers/json
 *   - Path parameters:      /v1.41/containers/:id/start
 *   - Version wildcarding:  /v(\d+\.\d+)/ is normalised before matching
 */

import { containers } from "./routes/containers.js";
import { images }     from "./routes/images.js";
import { networks }   from "./routes/networks.js";
import { volumes }    from "./routes/volumes.js";
import { system }     from "./routes/system.js";
import {
  DOCKER_API_MIN_VERSION,
  DOCKER_API_MAX_VERSION,
  extractApiVersionFromPath,
  compareVersion,
} from "./versioning.js";

// ---------------------------------------------------------------------------
// Route table
// Each entry: { method, pattern: RegExp, paramNames: string[], handler }
// ---------------------------------------------------------------------------
const ROUTES = [
  // ── System ────────────────────────────────────────────────────────────────
  r("GET",    "/_ping",                          [],           system.ping),
  r("HEAD",   "/_ping",                          [],           system.ping),
  r("GET",    "/info",                           [],           system.info),
  r("GET",    "/version",                        [],           system.version),
  r("GET",    "/events",                         [],           system.events),

  // ── Containers ────────────────────────────────────────────────────────────
  r("GET",    "/containers/json",                [],           containers.list),
  r("POST",   "/containers/create",              [],           containers.create),
  r("GET",    "/containers/:id/json",            ["id"],       containers.inspect),
  r("POST",   "/containers/:id/start",           ["id"],       containers.start),
  r("POST",   "/containers/:id/stop",            ["id"],       containers.stop),
  r("POST",   "/containers/:id/kill",            ["id"],       containers.kill),
  r("POST",   "/containers/:id/restart",         ["id"],       containers.restart),
  r("POST",   "/containers/:id/rename",          ["id"],       containers.rename),
  r("DELETE", "/containers/:id",                 ["id"],       containers.remove),
  r("GET",    "/containers/:id/logs",            ["id"],       containers.logs),
  r("GET",    "/containers/:id/top",             ["id"],       containers.top),
  r("POST",   "/containers/:id/exec",            ["id"],       containers.execCreate),
  r("POST",   "/exec/:id/start",                 ["id"],       containers.execStart),
  r("GET",    "/containers/:id/stats",           ["id"],       containers.stats),
  r("POST",   "/containers/:id/wait",            ["id"],       containers.wait),
  r("GET",    "/containers/:id/archive",         ["id"],       containers.getArchive),
  r("PUT",    "/containers/:id/archive",         ["id"],       containers.putArchive),

  // ── Images ────────────────────────────────────────────────────────────────
  // Note: image names may contain slashes (e.g. registry.io/repo/image:tag)
  r("GET",    "/images/json",                    [],           images.list),
  r("POST",   "/images/create",                  [],           images.pull),
  r("GET",    "/images/(.+)/json",               ["name"],     images.inspect),
  r("DELETE", "/images/(.+)",                    ["name"],     images.remove),
  r("POST",   "/images/(.+)/tag",                ["name"],     images.tag),
  r("GET",    "/images/(.+)/history",            ["name"],     images.history),
  r("POST",   "/build",                          [],           images.build),

  // ── Networks ──────────────────────────────────────────────────────────────
  r("GET",    "/networks",                       [],           networks.list),
  r("POST",   "/networks/create",                [],           networks.create),
  r("GET",    "/networks/:id",                   ["id"],       networks.inspect),
  r("DELETE", "/networks/:id",                   ["id"],       networks.remove),
  r("POST",   "/networks/prune",                 [],           networks.prune),

  // ── Volumes ───────────────────────────────────────────────────────────────
  r("GET",    "/volumes",                        [],           volumes.list),
  r("POST",   "/volumes/create",                 [],           volumes.create),
  r("GET",    "/volumes/:name",                  ["name"],     volumes.inspect),
  r("DELETE", "/volumes/:name",                  ["name"],     volumes.remove),
  r("POST",   "/volumes/prune",                  [],           volumes.prune),
];

// ---------------------------------------------------------------------------
// Route compiler
// ---------------------------------------------------------------------------
// ── URL param validators ────────────────────────────────────────────────
// Docker container/image/network/volume IDs are hex strings (short or full)
// Names can contain alphanumerics, dashes, underscores, dots, and slashes.
const CONTAINER_ID_RE  = /^[a-f0-9]{64}$/;
const SHORT_ID_RE      = /^[a-f0-9]{6,64}$/;
const IMAGE_NAME_RE    = /^[a-zA-Z0-9][a-zA-Z0-9.\/_:-]*$/;
const NETWORK_NAME_RE  = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const VOLUME_NAME_RE   = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Validate URL path parameters against Docker naming conventions.
 * Returns an error message string, or null if valid.
 */
function validateParams(params) {
  // Check container IDs
  if (params.id && typeof params.id === "string") {
    // Could be a short/full ID or a name — accept both
    if (!CONTAINER_ID_RE.test(params.id) && !SHORT_ID_RE.test(params.id) &&
        !NETWORK_NAME_RE.test(params.id) && !VOLUME_NAME_RE.test(params.id)) {
      return `invalid container ID or name: ${params.id}`;
    }
  }
  // Check image names (may contain slashes for registry paths)
  if (params.name && typeof params.name === "string") {
    if (!IMAGE_NAME_RE.test(params.name)) {
      return `invalid image name: ${params.name}`;
    }
  }
  return null;
}

function r(method, path, paramNames, handler) {
  const pattern = new RegExp(
    "^" + path.replace(/:([a-z]+)/gi, "([^/]+)") + "$"
  );
  return { method, pattern, paramNames, handler };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse}  res
 * @param {string|null} body
 */
export async function router(req, res, body) {
  // Strip API version prefix: /v1.41/containers/json → /containers/json
  const rawPath = req.url?.split("?")[0] ?? "/";
  const requestedApiVersion = extractApiVersionFromPath(rawPath);

  if (requestedApiVersion) {
    if (compareVersion(requestedApiVersion, DOCKER_API_MAX_VERSION) > 0) {
      return versionError(
        res,
        400,
        `client version ${requestedApiVersion} is too new. Maximum supported API version is ${DOCKER_API_MAX_VERSION}`
      );
    }
    if (compareVersion(requestedApiVersion, DOCKER_API_MIN_VERSION) < 0) {
      return versionError(
        res,
        400,
        `client version ${requestedApiVersion} is too old. Minimum supported API version is ${DOCKER_API_MIN_VERSION}`
      );
    }
  }

  const normalised = rawPath.replace(/^\/v\d+\.\d+/, "");
  const query = parseQuery(req.url);
  const apiVersion = requestedApiVersion ?? DOCKER_API_MAX_VERSION;

  for (const route of ROUTES) {
    if (route.method !== req.method) continue;
    const match = normalised.match(route.pattern);
    if (!match) continue;

    const params = {};
    route.paramNames.forEach((name, i) => {
      const raw = match[i + 1] ?? "";
      params[name] = decodePathParam(raw);
    });

    // Validate URL params
    const paramErr = validateParams(params);
    if (paramErr) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: paramErr }));
    }

    const bodyObj = body ? tryJSON(body) : null;
    await route.handler({ req, res, params, query, body: bodyObj, rawBody: body, apiVersion });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: `No such endpoint: ${req.method} ${normalised}` }));
}

function parseQuery(url) {
  const idx = url?.indexOf("?") ?? -1;
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

function tryJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function decodePathParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function versionError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message }));
}
