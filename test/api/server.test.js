import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
let buildFile;
let copyFile;
let loadFile;
let server;
let port;
let previousContainerBin;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stevedore-api-stream-"));
  buildFile = path.join(tempDir, "build.tar");
  copyFile = path.join(tempDir, "copy.tar");
  loadFile = path.join(tempDir, "load.tar");
  const bin = path.join(tempDir, "container");
  fs.writeFileSync(bin, `#!/bin/sh
case "$1 $2" in
  "build -") cat > "${buildFile}"; echo built ;;
  "copy -") cat > "${copyFile}" ;;
  "image load") cat "$4" > "${loadFile}"; echo loaded ;;
  "image save") printf fake-tar ;;
  "image push") echo pushed ;;
  "image list"|"list "*) printf '[]\\n' ;;
  "image prune"|"prune") exit 0 ;;
  "network list"|"volume list") printf '[]\\n' ;;
  create) echo fake-id ;;
esac
exit 0
`, { mode: 0o755 });
  previousContainerBin = process.env.STEVEDORE_CONTAINER_BIN;
  process.env.STEVEDORE_CONTAINER_BIN = bin;
  const { createServer } = await import("../../src/api/server.js");
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousContainerBin === undefined) delete process.env.STEVEDORE_CONTAINER_BIN;
  else process.env.STEVEDORE_CONTAINER_BIN = previousContainerBin;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: { "content-type": "application/x-tar", "content-length": body.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("API raw request bodies", () => {
  it("streams Docker build tar data to container build", async () => {
    const payload = Buffer.from([0, 1, 2, 255, 10]);
    const response = await request("POST", "/build", payload);
    assert.equal(response.status, 200);
    assert.deepEqual(fs.readFileSync(buildFile), payload);
    assert.match(response.body.toString(), /built/);
  });

  it("streams container archive uploads to container copy", async () => {
    const payload = Buffer.from([9, 8, 7, 0, 255]);
    const response = await request("PUT", "/containers/fake/archive?path=%2Ftmp", payload);
    assert.equal(response.status, 200);
    assert.deepEqual(fs.readFileSync(copyFile), payload);
  });

  it("loads an image tar through a temporary archive", async () => {
    const payload = Buffer.from([4, 3, 2, 1, 0]);
    const response = await request("POST", "/images/load", payload);
    assert.equal(response.status, 200);
    assert.deepEqual(fs.readFileSync(loadFile), payload);
    assert.match(response.body.toString(), /loaded/);
  });

  it("streams saved images to the client", async () => {
    const response = await request("GET", "/images/get?names=alpine", Buffer.alloc(0));
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), "fake-tar");
  });

  it("streams push progress as Docker JSON messages", async () => {
    const response = await request("POST", "/images/library/alpine/push", Buffer.alloc(0));
    assert.equal(response.status, 200);
    assert.match(response.body.toString(), /pushed/);
    assert.match(response.body.toString(), /Pushed image library\/alpine/);
  });

  it("reports image prune results after native prune", async () => {
    const response = await request("POST", "/images/prune", Buffer.alloc(0));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body.toString()), { ImagesDeleted: [], SpaceReclaimed: 0 });
  });

  it("reports container prune results after native prune", async () => {
    const response = await request("POST", "/containers/prune", Buffer.alloc(0));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body.toString()), { ContainersDeleted: [], SpaceReclaimed: 0 });
  });
});
