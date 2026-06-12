/**
 * commands/wait.js — not yet implemented / not supported by docker
 */
export default async function wait(args) {
  console.warn("stevedore: 'wait' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
