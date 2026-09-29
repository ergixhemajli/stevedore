/**
 * commands/import.js — not yet implemented / not supported by docker
 */
export default async function imageImport(args) {
  console.warn("stevedore: 'docker import' is not yet supported by apple/container or stevedore.");
  process.exitCode = 1;
}
