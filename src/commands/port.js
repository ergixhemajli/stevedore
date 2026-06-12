/**
 * commands/port.js — not yet implemented / not supported by docker
 */
export default async function port(args) {
  console.warn("stevedore: 'port' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
