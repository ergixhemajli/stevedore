/**
 * src/api/routes/system.js
 *
 * Docker API system endpoints.
 * These are the first thing Testcontainers checks — it hits /_ping and
 * /version to detect the Docker environment before doing anything else.
 */

import { run, json, apiError } from "../run.js";

// Keep these Docker-like to satisfy docker-java / Testcontainers version checks.
const DOCKER_ENGINE_VERSION = "25.0.0";
const DOCKER_API_VERSION = "1.44";

export const system = {

  /**
   * GET /_ping  — Testcontainers hits this first to verify the socket works.
   * Must return exactly "OK" with status 200.
   */
  async ping({ req, res }) {
    // Extract API version from request URL
    const apiVersion = (req.url ?? "").match(/\/v(\d+\.\d+)/)?.[1] ?? DOCKER_API_VERSION;
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Docker-Experimental": "false",
      "Ostype": "linux",
      "Server": "stevedore/0.1.0",
      "Api-Version": apiVersion,
    });
    res.end("OK");
  },

  /**
   * GET /version — Testcontainers reads this to confirm API compatibility.
   */
  async version({ res }) {
    const { stdout } = await run(["system", "version"]);
    // Parse whatever apple/container returns and wrap it in Docker's shape
    // Use the version from the request URL if available
    const apiVersion = DOCKER_API_VERSION;
    json(res, 200, {
      Version: DOCKER_ENGINE_VERSION,
      ApiVersion: apiVersion,
      MinAPIVersion: "1.24",
      GitCommit: "",
      GoVersion: "",
      Os: "linux",
      Arch: "arm64",
      KernelVersion: "",
      BuildTime: "",
      Platform: { Name: "stevedore (apple/container)" },
      Components: [
        { Name: "stevedore", Version: "0.1.0", Details: { raw: stdout } },
      ],
    });
  },

  /**
   * GET /info — system-wide information.
   */
  async info({ res }) {
    const { stdout } = await run(["system", "status"]);
    json(res, 200, {
      ID: "stevedore",
      Containers: 0,
      ContainersRunning: 0,
      ContainersPaused: 0,
      ContainersStopped: 0,
      Images: 0,
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
      DockerRootDir: "",
      HttpProxy: "",
      HttpsProxy: "",
      NoProxy: "",
      Name: "stevedore",
      ServerVersion: DOCKER_ENGINE_VERSION,
      OperatingSystem: "macOS",
      OSType: "linux",
      Architecture: "aarch64",
      NCPU: 1,
      MemTotal: 0,
      raw: stdout,
    });
  },

  /**
   * GET /events — streams container events.
   * Testcontainers may call this; we keep the connection open and forward
   * output from `container system logs --follow`.
   */
  async events({ req, res }) {
    res.writeHead(200, { "Content-Type": "application/json" });

    const { spawn } = await import("node:child_process");
    const { CONTAINER_BIN } = await import("../../utils/exec.js");
    const child = spawn(CONTAINER_BIN, ["system", "logs", "--follow"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    child.stdout.on("data", (chunk) => res.write(chunk));
    req.on("close", () => child.kill());
    child.on("exit", () => res.end());
  },
};
