/**
 * test/api/container-shape.test.js
 *
 * Ensures toDockerContainer normalises id/name deterministically so docker
 * compose output doesn't show mixed id/name values.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDockerContainer } from "../../src/api/routes/containers.js";

describe("toDockerContainer", () => {
  it("prefers top-level id over configuration.id for Id", () => {
    const c = toDockerContainer({
      id: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      configuration: { id: "atlas-db" },
    });
    assert.equal(
      c.Id,
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
    );
  });

  it("falls back to configuration.id when top-level id is missing", () => {
    const c = toDockerContainer({
      configuration: { id: "abc123" },
    });
    assert.equal(c.Id, "abc123");
  });

  it("takes Name from compose service label (not project_service format)", () => {
    const c = toDockerContainer({
      id: "abc123",
      configuration: {
        id: "some-other-value",
        labels: {
          "com.docker.compose.service": "atlas-db",
          "com.docker.compose.container": "atlas-keyclo_atlas-db",
        },
      },
    });
    assert.deepEqual(c.Names, ["/atlas-db"]);
  });

  it("falls back to top-level name when no compose label present", () => {
    const c = toDockerContainer({
      id: "abc123",
      name: "atlas-keycloak",
      configuration: { id: "abc123" },
    });
    assert.deepEqual(c.Names, ["/atlas-keycloak"]);
  });
});
