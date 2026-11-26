import { runJSON } from "../api/run.js";

export function formatPublishedPorts(publishedPorts, requestedPort) {
  const requested = requestedPort && parsePort(requestedPort);
  return (publishedPorts ?? [])
    .filter((port) => !requested || (
      String(port.containerPort) === requested.port &&
      (!requested.protocol || (port.proto ?? "tcp") === requested.protocol)
    ))
    .sort((a, b) => Number(a.containerPort) - Number(b.containerPort) || String(a.proto).localeCompare(String(b.proto)) || String(a.hostAddress).localeCompare(String(b.hostAddress)))
    .map((port) => {
      const address = port.hostAddress || "0.0.0.0";
      const host = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
      const binding = `${host}:${port.hostPort}`;
      return requestedPort ? binding : `${port.containerPort}/${port.proto ?? "tcp"} -> ${binding}`;
    });
}

function parsePort(value) {
  const match = /^(\d+)(?:\/(tcp|udp))?$/.exec(value);
  if (!match) throw new Error(`invalid port: ${value}`);
  return { port: match[1], protocol: match[2] };
}

function matchesContainer(item, name) {
  if (!item || typeof item !== "object") return false;
  const id = String(item.id ?? item.configuration?.id ?? "");
  const configId = String(item.configuration?.id ?? "");
  return id === name || id.startsWith(name) || configId === name;
}

export default async function port(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: docker port CONTAINER [PRIVATE_PORT[/PROTO]]");
    return;
  }
  if (args.length < 1 || args.length > 2) {
    console.error("Usage: docker port CONTAINER [PRIVATE_PORT[/PROTO]]");
    process.exitCode = 1;
    return;
  }

  const [name, requestedPort] = args;
  try {
    if (requestedPort) parsePort(requestedPort);
    const containers = await runJSON(["list", "--all"]);
    const matches = (Array.isArray(containers) ? containers : [containers]).filter((item) => matchesContainer(item, name));
    if (matches.length !== 1) {
      console.error(`stevedore: ${matches.length ? "ambiguous" : "no such"} container: ${name}`);
      process.exitCode = 1;
      return;
    }

    const ports = formatPublishedPorts(matches[0].configuration?.publishedPorts, requestedPort);
    if (requestedPort && ports.length === 0) {
      console.error(`stevedore: no public port ${requestedPort} published for ${name}`);
      process.exitCode = 1;
      return;
    }
    if (ports.length) console.log(ports.join("\n"));
  } catch (error) {
    console.error(`stevedore: ${error.message}`);
    process.exitCode = 1;
  }
}
