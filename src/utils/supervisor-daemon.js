/**
 * supervisor-daemon.js — Entry point for supervisor daemon process.
 *
 * This is forked by supervisor.js and runs the supervisor loop.
 */

import { supervisorLoop } from "../utils/supervisor.js";

supervisorLoop().catch((err) => {
  console.error("stevedore: supervisor fatal error:", err.message);
  process.exit(1);
});
