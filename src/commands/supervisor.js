/**
 * commands/supervisor.js
 *
 * stevedore supervisor start|stop|status
 * Manages the background restart supervisor.
 */

import { startSupervisor, stopSupervisor, isRunning } from "../utils/supervisor.js";

export default async function supervisor(args) {
  const [action] = args;

  switch (action) {
    case "start":
      await startSupervisor();
      break;
    case "stop":
      await stopSupervisor();
      break;
    case "status":
      if (isRunning()) {
        console.log("supervisor: running");
      } else {
        console.log("supervisor: stopped");
      }
      break;
    case "--help":
    case "-h":
    case "help":
      console.log("Usage: stevedore supervisor [start|stop|status]");
      console.log("");
      console.log("Manage the background restart supervisor that monitors containers");
      console.log("with restart policies and automatically restarts them.");
      console.log("");
      console.log("Commands:");
      console.log("  start   Start the supervisor daemon");
      console.log("  stop    Stop the supervisor daemon");
      console.log("  status  Show supervisor status");
      break;
    default:
      console.error(`stevedore: unknown supervisor command: ${action}`);
      console.error('Run "stevedore supervisor --help" for usage.');
      process.exitCode = 1;
      break;
  }
}
