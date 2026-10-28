const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const semver = require("semver");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const engine = JSON.parse(read("package.json")).engines.node;
const fromLines = (file) =>
  read(file)
    .split(/\r?\n/)
    .filter((line) => /^FROM\s/i.test(line));

test("builder uses the approved exact patched Node 26 Debian image", () => {
  assert.deepEqual(fromLines("Dockerfile.base"), ["FROM node:26.12.1 AS deps"]);
});

test("runner uses the matching slim image and retains the BASE_IMAGE stage", () => {
  assert.deepEqual(fromLines("Dockerfile"), [
    "FROM ${BASE_IMAGE} AS base",
    "FROM node:26.12.1-slim AS runner",
  ]);
});

test("engine admits the security floor and later stable Node 26 releases", () => {
  // Later versions are range probes, not claims of image availability or qualification.
  for (const version of [
    "26.12.1",
    "26.12.1+build.1",
    "26.12.2",
    "26.13.0",
    "26.99.99",
  ]) {
    assert.equal(
      semver.satisfies(version, engine),
      true,
      `must admit ${version}`
    );
  }
});

test("engine rejects old Node 26 releases, prereleases, and Node 27", () => {
  for (const version of [
    "26.0.0",
    "26.3.0",
    "26.3.1",
    "26.6.0",
    "26.11.1",
    "26.12.0",
    "26.12.1-rc.1",
    "26.13.0-rc.1",
    "27.0.0-rc.1",
    "27.0.0",
    "27.1.0",
  ]) {
    assert.equal(
      semver.satisfies(version, engine),
      false,
      `must reject ${version}`
    );
  }
});

test("every non-26 engine branch and its boundary behavior is preserved", () => {
  const branches = engine.split(" || ");
  assert.equal(branches.length, 4);
  assert.equal(
    branches.slice(0, 3).join(" || "),
    ">=20.12 <21 || 22 || 24 <24.17.0"
  );

  for (const [version, accepted] of [
    ["20.11.99", false],
    ["20.12.0", true],
    ["20.99.99", true],
    ["21.0.0", false],
    ["22.0.0", true],
    ["22.99.99", true],
    ["23.0.0", false],
    ["24.0.0", true],
    ["24.16.99", true],
    ["24.17.0", false],
    ["24.22.1", false],
    ["25.0.0", false],
  ]) {
    assert.equal(
      semver.satisfies(version, engine),
      accepted,
      `preserve ${version}`
    );
  }
});
