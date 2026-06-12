/**
 * src/api/versioning.js
 *
 * Docker Engine/API compatibility version constants and helpers.
 */

export const DOCKER_ENGINE_VERSION = "25.0.0";
export const DOCKER_API_MIN_VERSION = "1.24";
export const DOCKER_API_MAX_VERSION = "1.44";

/**
 * Extract API version from a path like /v1.44/containers/json.
 * Returns null when request is unversioned.
 *
 * @param {string} path
 * @returns {string|null}
 */
export function extractApiVersionFromPath(path) {
  return path.match(/^\/v(\d+\.\d+)(?:\/|$)/)?.[1] ?? null;
}

/**
 * Compare dotted numeric versions (e.g. 1.44, 1.24).
 * Returns: -1 if a<b, 0 if equal, 1 if a>b
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersion(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}
