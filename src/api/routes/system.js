import os from "node:os";
import { run, runJSON, json, apiError } from "../run.js";
import {
  DOCKER_ENGINE_VERSION,
  DOCKER_API_MIN_VERSION,
  DOCKER_API_MAX_VERSION,
} from "../versioning.js";

export const system = {
  async ping({ apiVersion, res }) {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Docker-Experimental": "false",
      "Ostype": "linux",
      "Server": "stevedore/0.1.0",
      "Api-Version": apiVersion ?? DOCKER_API_MAX_VERSION,
    });
    res.end("OK");
  },

  async version({ res }) {
    const { stdout } = await run(["system", "version"]);
    json(res, 200, {
      Version: DOCKER_ENGINE_VERSION,
      ApiVersion: DOCKER_API_MAX_VERSION,
      MinAPIVersion: DOCKER_API_MIN_VERSION,
      GitCommit: "",
      GoVersion: "",
      Os: "linux",
      Arch: process.arch,
      KernelVersion: "",
      BuildTime: "",
      Platform: { Name: "stevedore (apple/container)" },
      Components: [
        { Name: "stevedore", Version: "0.1.0", Details: { raw: stdout } },
      ],
    });
  },

  async auth({ body, res }) {
    const result = await authenticate(body ?? {});
    if (result.error) return apiError(res, 401, result.error);
    json(res, 200, { Status: "Login Succeeded", IdentityToken: "" });
  },

  async info({ res }) {
    try {
      const [status, containers, images] = await Promise.all([
        runJSON(["system", "status"]),
        runJSON(["list", "--all"]),
        runJSON(["image", "list"]),
      ]);
      json(res, 200, toDockerInfo(status, containers, images));
    } catch (error) {
      apiError(res, 500, error.message);
    }
  },

  async events({ res }) {
    apiError(res, 501, "Docker events are not supported by apple/container");
  },

  async df({ res }) {
    apiError(res, 501, "Docker system disk usage details are not fully available from apple/container");
  },
};

export async function authenticate(auth) {
  let username = auth.Username ?? auth.username;
  let password = auth.Password ?? auth.password;
  const identityToken = auth.IdentityToken ?? auth.identitytoken ?? auth.RegistryToken ?? auth.registrytoken;

  if ((!username || password === undefined) && typeof (auth.Auth ?? auth.auth) === "string") {
    const credentials = Buffer.from(auth.Auth ?? auth.auth, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    if (separator >= 0) {
      username = credentials.slice(0, separator);
      password = credentials.slice(separator + 1);
    }
  }
  if (identityToken) return { error: "registry identity tokens are not supported by apple/container" };
  if (!username || password === undefined) return { error: "username and password are required" };

  let server = auth.ServerAddress ?? auth.serveraddress ?? "docker.io";
  if (server === "https://index.docker.io/v1/" || server === "index.docker.io") server = "docker.io";
  else if (server.startsWith("http://") || server.startsWith("https://")) {
    try { server = new URL(server).host; } catch {}
  }

  const { stderr, exitCode } = await run(["registry", "login", "--username", username, "--password-stdin", server], {
    input: String(password),
    timeoutMs: 30_000,
  });
  return exitCode === 0 ? { success: true } : { error: stderr || "registry login failed" };
}

export function toDockerInfo(status, containers, images) {
  const containerRows = (Array.isArray(containers) ? containers : containers ? [containers] : []).filter(Boolean);
  const imageRows = (Array.isArray(images) ? images : images ? [images] : []).filter(Boolean);
  const running = containerRows.filter((item) => item.status?.state === "running").length;
  const paused = containerRows.filter((item) => item.status?.state === "paused").length;
  const host = status?.host ?? {};

  return {
    ID: "stevedore",
    Containers: containerRows.length,
    ContainersRunning: running,
    ContainersPaused: paused,
    ContainersStopped: containerRows.length - running - paused,
    Images: imageRows.length,
    Driver: "apple-container",
    MemoryLimit: true,
    SwapLimit: false,
    KernelMemory: false,
    CpuCfsPeriod: false,
    CpuCfsQuota: false,
    CPUShares: false,
    CPUSet: false,
    IPv4Forwarding: true,
    BridgeNfIptables: false,
    BridgeNfIp6tables: false,
    Debug: false,
    OomKillDisable: false,
    NGoroutines: 1,
    LoggingDriver: "local",
    CgroupDriver: "none",
    DockerRootDir: status?.paths?.appRoot ?? "",
    HttpProxy: process.env.HTTP_PROXY ?? process.env.http_proxy ?? "",
    HttpsProxy: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "",
    NoProxy: process.env.NO_PROXY ?? process.env.no_proxy ?? "",
    Name: os.hostname(),
    ServerVersion: DOCKER_ENGINE_VERSION,
    OperatingSystem: host.operatingSystem ?? "macOS",
    OSType: "linux",
    Architecture: host.architecture ?? process.arch,
    NCPU: host.cpus ?? os.cpus().length,
    MemTotal: os.totalmem(),
    raw: status,
  };
}
