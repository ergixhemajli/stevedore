import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../src/cli.js", import.meta.url));
const env = { ...process.env, STEVEDORE_CONTAINER_BIN: "/bin/echo" };

function run(...args) {
  return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", env });
}

const routes = [
  [["build", "."], "build .\n"],
  [["commit", "container-id", "image:tag"], "commit container-id image:tag\n"],
  [["cp", "container:/src", "."], "cp container:/src .\n"],
  [["exec", "-it", "container", "sh"], "exec -it container sh\n"],
  [["export", "container", "rootfs.tar"], "export container rootfs.tar\n"],
  [["inspect", "container"], "inspect container\n"],
  [["inspect", "--type=image", "image:tag"], "image inspect image:tag\n"],
  [["inspect", "--type", "network", "network-name"], "network inspect network-name\n"],
  [["inspect", "-t", "volume", "volume-name"], "volume inspect volume-name\n"],
  [["kill", "container"], "kill container\n"],
  [["logs", "container"], "logs container\n"],
  [["push", "image:tag"], "image push image:tag\n"],
  [["rmi", "image:tag"], "image delete image:tag\n"],
  [["tag", "source", "target"], "image tag source target\n"],
  [["save", "--output", "images.tar", "image"], "image save --output images.tar image\n"],
  [["load", "--input", "images.tar"], "image load --input images.tar\n"],
  [["login", "--username", "user", "registry"], "registry login --username user registry\n"],
  [["logout", "registry"], "registry logout registry\n"],
  [["image", "build", "."], "build .\n"],
  [["image", "inspect", "image:tag"], "image inspect image:tag\n"],
  [["image", "pull", "image:tag"], "image pull image:tag\n"],
  [["image", "rm", "image:tag"], "image delete image:tag\n"],
  [["container", "rm", "container-id"], "rm container-id\n"],
  [["images"], "image list\n"],
  [["ls", "--all"], "list --all\n"],
  [["network", "ls"], "network list\n"],
  [["rm", "container-id"], "rm container-id\n"],
  [["start", "container-id"], "start container-id\n"],
  [["stats", "container-id"], "stats container-id\n"],
  [["stop", "container-id"], "stop --time 10 container-id\n"],
  [["stop", "--timeout", "3", "container-id"], "stop --time 3 container-id\n"],
  [["volume", "rm", "volume-name"], "volume delete volume-name\n"],
  [["info"], "system status\n"],
  [["container", "ls", "--all"], "list --all\n"],
  [["system", "df"], "system df\n"],
  [["system", "info"], "system status\n"],
  [["help", "pull"], "image pull --help\n"],
];

describe("Docker command routing", () => {
  for (const [args, expected] of routes) {
    it(`${args.join(" ")} forwards to the expected container command`, () => {
      assert.equal(run(...args), expected);
    });
  }

  it("generates an image reference when Docker commit omits one", () => {
    assert.match(run("commit", "container-id"), /^commit container-id stevedore\/commit-\d+\n$/);
  });

  it("routes completion to the bundled shell scripts", () => {
    assert.match(run("completion", "bash"), /complete -F _stevedore_docker_complete docker/);
  });

  it("rejects system events instead of forwarding system logs", () => {
    assert.throws(() => run("system", "events"), (error) => {
      assert.equal(error.status, 1);
      assert.match(error.stderr.toString(), /system events.*not supported/);
      return true;
    });
  });
});
