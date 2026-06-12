/**
 * commands/top.js — not yet implemented / not supported by docker
 */
export default async function top(args) {
  console.warn("stevedore: 'top' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
