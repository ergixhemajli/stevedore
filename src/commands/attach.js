/**
 * commands/attach.js — not yet implemented / not supported by docker
 */
export default async function attach(args) {
  console.warn("stevedore: 'attach' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
