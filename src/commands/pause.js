/**
 * commands/pause.js — not yet implemented / not supported by docker
 */
export default async function pause(args) {
  console.warn("stevedore: 'pause' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
