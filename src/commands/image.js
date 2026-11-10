/**
 * commands/image.js
 *
 * stevedore image prune → shared prune helper (utils/prune.js).
 * Other `docker image <sub>` forms are not wired up; use the top-level command.
 */

import { prune } from "../utils/prune.js";

export default async function image([sub, ...rest]) {
  if (sub !== "prune") {
    throw new Error(
      `only "docker image prune" is supported; use the top-level command instead (docker images, docker rmi, docker pull, ...)`
    );
  }
  await prune("images", rest);
}
