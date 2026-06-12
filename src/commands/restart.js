/**
 * commands/restart.js — not yet implemented / not supported by docker
 */
export default async function restart(args) {
  console.warn("stevedore: 'restart' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
