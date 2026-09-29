/**
 * test/api/filters.test.js
 *
 * Tests for src/api/filters.js — parsing and matching of Docker API filters.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFilters, matchesFilters } from "../../src/api/filters.js";

describe("parseFilters", () => {
  it("parses label filter", () => {
    const raw = '{"label":["com.docker.compose.project=myapp"]}';
    assert.deepEqual(parseFilters(raw), { label: ["com.docker.compose.project=myapp"] });
  });

  it("parses multiple filter types", () => {
    const raw = '{"label":["key=val"],"status":["running","exited"],"id":["abc"]}';
    const result = parseFilters(raw);
    assert.deepEqual(result, {
      label: ["key=val"],
      status: ["running", "exited"],
      id: ["abc"],
    });
  });

  it("returns {} for missing/empty", () => {
    assert.deepEqual(parseFilters(""), {});
    assert.deepEqual(parseFilters(null), {});
    assert.deepEqual(parseFilters(undefined), {});
  });

  it("returns {} for unparseable JSON", () => {
    assert.deepEqual(parseFilters("not json"), {});
    assert.deepEqual(parseFilters("{broken"), {});
  });
});

describe("matchesFilters", () => {
  // ---------- label ----------
  it("matches exact label key=value", () => {
    const item = { labels: { "com.docker.compose.project": "myapp", "env": "prod" } };
    assert.equal(matchesFilters({ label: ["com.docker.compose.project=myapp"] }, item), true);
  });

  it("rejects wrong label value", () => {
    const item = { labels: { "com.docker.compose.project": "other" } };
    assert.equal(matchesFilters({ label: ["com.docker.compose.project=myapp"] }, item), false);
  });

  it("matches label key-only (presence)", () => {
    const item = { labels: { "com.docker.compose.project": "myapp" } };
    assert.equal(matchesFilters({ label: ["com.docker.compose.project"] }, item), true);
  });

  it("rejects missing label key", () => {
    const item = { labels: { "other": "value" } };
    assert.equal(matchesFilters({ label: ["com.docker.compose.project"] }, item), false);
  });

  // ---------- name ----------
  it("matches name substring", () => {
    const item = { Name: "/mycontainer" };
    assert.equal(matchesFilters({ name: ["mycont"] }, item), true);
  });

  it("rejects wrong name", () => {
    const item = { Name: "/other" };
    assert.equal(matchesFilters({ name: ["mycont"] }, item), false);
  });

  // ---------- id ----------
  it("matches id prefix", () => {
    const item = { Id: "abc123def456" };
    assert.equal(matchesFilters({ id: ["abc123"] }, item), true);
  });

  it("rejects non-matching id prefix", () => {
    const item = { Id: "xyz789" };
    assert.equal(matchesFilters({ id: ["abc"] }, item), false);
  });

  // ---------- status ----------
  it("matches exact status", () => {
    const item = { Status: "running" };
    assert.equal(matchesFilters({ status: ["running"] }, item), true);
  });

  it("rejects wrong status", () => {
    const item = { Status: "exited" };
    assert.equal(matchesFilters({ status: ["running"] }, item), false);
  });

  // ---------- combined filters ----------
  it("requires ALL filter groups to match", () => {
    const item = {
      labels: { "com.docker.compose.project": "myapp", "env": "dev" },
      Status: "running",
    };
    // Both label and status must pass
    assert.equal(
      matchesFilters({ label: ["com.docker.compose.project=myapp"], status: ["running"] }, item),
      true
    );
    // Status mismatch → false
    assert.equal(
      matchesFilters({ label: ["com.docker.compose.project=myapp"], status: ["exited"] }, item),
      false
    );
  });

  // ---------- image ----------
  it("matches image filter", () => {
    const item = { Image: "postgres:15" };
    assert.equal(matchesFilters({ image: ["postgres"] }, item), true);
  });

  // ---------- network ----------
  it("matches network filter", () => {
    const item = { NetworkSettings: { Networks: { mynet: {}, other: {} } } };
    assert.equal(matchesFilters({ network: ["mynet"] }, item), true);
  });

  // ---------- empty filters ----------
  it("passes when filters is empty object", () => {
    const item = { labels: {}, Name: "/anything" };
    assert.equal(matchesFilters({}, item), true);
  });

  // ---------- undefined/nullable item ----------
  it("handles null/undefined item gracefully", () => {
    assert.doesNotThrow(() => matchesFilters({ label: ["key=val"] }, null));
    assert.doesNotThrow(() => matchesFilters({ label: ["key=val"] }, undefined));
  });
});
