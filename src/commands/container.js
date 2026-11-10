/**
 * commands/container.js
 *
 * stevedore container prune → shared prune helper (utils/prune.js).
 * Other `docker container <sub>` forms are not wired up; use the top-level command.
 */

import { prune } from "../utils/prune.js";

export default async function container([sub, ...rest]) {
  if (sub !== "prune") {
    throw new Error(
      `only "docker container prune" is supported; use the top-level command instead (docker ps, docker rm, ...)`
    );
  }
  await prune("containers", rest);
}
