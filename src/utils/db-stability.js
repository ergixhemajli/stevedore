/**
 * db-stability.js
 *
 * Global runtime env injection to reduce idle DB connection timeouts across apps.
 *
 * This applies conservative defaults for common Java/Hikari property names.
 * Users can disable by setting STEVEDORE_DISABLE_DB_STABILITY=1.
 */

const DISABLE_VALUES = new Set(["1", "true", "yes", "on"]);

export const DB_STABILITY_DEFAULTS = {
  DB_HIKARI_MAX_LIFETIME_MS: "840000",
  DB_HIKARI_KEEPALIVE_TIME_MS: "300000",
  SPRING_DATASOURCE_HIKARI_MAX_LIFETIME: "840000",
  SPRING_DATASOURCE_HIKARI_KEEPALIVE_TIME: "300000",
};

function isDisabled() {
  const raw = process.env.STEVEDORE_DISABLE_DB_STABILITY;
  return raw ? DISABLE_VALUES.has(raw.trim().toLowerCase()) : false;
}

function hasEnvArg(args, key) {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "-e" || token === "--env") {
      const value = args[i + 1] ?? "";
      if (value.startsWith(`${key}=`)) return true;
      i++;
      continue;
    }
    if (token.startsWith("--env=")) {
      const value = token.slice("--env=".length);
      if (value.startsWith(`${key}=`)) return true;
    }
  }
  return false;
}

/**
 * Inject default env vars for run/create argv unless already present.
 * @param {string[]} args
 * @returns {string[]}
 */
export function injectDbStabilityEnvArgs(args) {
  if (isDisabled()) return args;

  const injected = [];
  for (const [key, value] of Object.entries(DB_STABILITY_DEFAULTS)) {
    if (process.env[key]) continue;
    if (hasEnvArg(args, key)) continue;
    injected.push("-e", `${key}=${value}`);
  }

  if (injected.length === 0) return args;
  return [...injected, ...args];
}

/**
 * Merge defaults into an env object (used by compose process env).
 * Existing keys win.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string | undefined>}
 */
export function injectDbStabilityProcessEnv(env) {
  if (isDisabled()) return env;
  const out = { ...env };
  for (const [key, value] of Object.entries(DB_STABILITY_DEFAULTS)) {
    if (out[key] == null || out[key] === "") out[key] = value;
  }
  return out;
}
