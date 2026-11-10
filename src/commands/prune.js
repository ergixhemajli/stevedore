/**
 * commands/prune.js
 *
 * stevedore prune → `docker system prune`.
 * Stevedore-only shorthand: real docker has no top-level `prune` command.
 */

import { prune } from "../utils/prune.js";

export default (args) => prune("system", args);
