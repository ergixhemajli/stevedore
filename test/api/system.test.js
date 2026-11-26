import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDockerInfo } from "../../src/api/routes/system.js";

describe("toDockerInfo", () => {
  it("reports live container and image counts from Apple Container data", () => {
    const info = toDockerInfo(
      {
        host: { architecture: "arm64", cpus: 8, operatingSystem: "macOS" },
        paths: { appRoot: "/container" },
      },
      [
        { status: { state: "running" } },
        { status: { state: "paused" } },
        { status: { state: "stopped" } },
      ],
      [{ id: "one" }, { id: "two" }]
    );

    assert.equal(info.Containers, 3);
    assert.equal(info.ContainersRunning, 1);
    assert.equal(info.ContainersPaused, 1);
    assert.equal(info.ContainersStopped, 1);
    assert.equal(info.Images, 2);
    assert.equal(info.Architecture, "arm64");
    assert.equal(info.NCPU, 8);
    assert.equal(info.DockerRootDir, "/container");
  });
});
