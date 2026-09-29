/**
 * filters.js — Docker API filter parsing and application.
 *
 * Docker Engine API passes filters as a JSON-encoded query parameter:
 *   filters={"label":["com.docker.compose.project=myapp","name=mycontainer"]}
 *   filters={"status":["running","exited"]}
 *   filters={"id":["abc123"]}
 *   filters={"name":["^mycontainer"]}   (prefix match, regex-like)
 *
 * Each filter key maps to an array of matchers. Matcher types:
 *   - "value" (no special prefix): exact match
 *   - "label=<key>=<value>" or "label=<key>": label filter
 *
 * This module parses the query, extracts label filters and simple-match
 * filters, and provides a filter function suitable for Array.prototype.filter.
 */

/**
 * Parse the `filters` query parameter into a structured object.
 * Returns {} when absent or unparseable.
 * @param {string} raw  Raw query-string value
 * @returns {Record<string, string[]>}
 */
export function parseFilters(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Flatten parsed filter values into a match predicate.
 * The predicate receives an item and returns true if the item passes all filters.
 * @param {Record<string, string[]>} filters  Parsed filter object
 * @param {object} item  Item to test (expects id, labels, status, name properties)
 * @returns {boolean}
 */
export function matchesFilters(filters, item) {
  if (!item) return false;
  for (const [key, values] of Object.entries(filters)) {
    if (!Array.isArray(values) || values.length === 0) continue;

    for (const matcher of values) {
      if (key === "label") {
        // label can be "key=value" or just "key"
        const eqIdx = matcher.indexOf("=");
        if (eqIdx === -1) {
          // key-only: does this label key exist?
          if (!(matcher in (item.labels ?? item.Labels ?? {}))) return false;
        } else {
          // key=value
          const lkey = matcher.slice(0, eqIdx);
          const lval = matcher.slice(eqIdx + 1);
          if ((item.labels ?? item.Labels ?? {})[lkey] !== lval) return false;
        }
      } else if (key === "name") {
        // name: exact match on container name (without leading /)
        const name = (item.Name ?? item.name ?? item.Id ?? "").replace(/^\//, "");
        if (!name.includes(matcher)) return false;
      } else if (key === "id") {
        // id: match on container/image ID prefix
        const id = (item.Id ?? item.id ?? "");
        if (!id.startsWith(matcher)) return false;
      } else if (key === "status") {
        // status: match on container status string
        const status = item.Status ?? item.status ?? item.State ?? "";
        if (status !== matcher) return false;
      } else if (key === "volume") {
        // volume: filter by mount name (simplified)
        const mounts = item.Mounts ?? item.mounts ?? [];
        const hasMount = Array.isArray(mounts) && mounts.some(
          (m) => m.Name === matcher || m.name === matcher
        );
        if (!hasMount) return false;
      } else if (key === "volume-type") {
        // volume-type: "bind" or "volume"
        const mounts = item.Mounts ?? item.mounts ?? [];
        const hasType = Array.isArray(mounts) && mounts.some(
          (m) => m.Type === matcher || m.type === matcher
        );
        if (!hasType) return false;
      } else if (key === "image") {
        // image: filter by container image name
        const img = item.Image ?? item.image ?? "";
        if (!img.includes(matcher)) return false;
      } else if (key === "network") {
        // network: filter by network name
        const networks = item.NetworkSettings?.Networks ?? item.networks ?? {};
        const netNames = Object.keys(networks);
        if (!netNames.some((n) => n.includes(matcher))) return false;
      } else if (key === "ancestor") {
        // ancestor: filter by image (used in images prune)
        const img = item.Image ?? item.image ?? item.RepoTags?.[0] ?? "";
        if (!img.includes(matcher)) return false;
      } else if (key === "reference") {
        // reference: for images pull
        const ref = item.RepoTags?.[0] ?? item.image ?? item.name ?? "";
        if (!ref.includes(matcher)) return false;
      }
    }
  }
  return true;
}
