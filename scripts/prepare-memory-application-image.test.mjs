import assert from "node:assert/strict";
import test from "node:test";
import {
  memoryImageDockerfile,
  pinnedApplicationImage,
} from "./prepare-memory-application-image.mjs";

const base = "cloudmarkup-application-build@sha256:" + "a".repeat(64);
const helper = "sha256:" + "b".repeat(64);
test("memory image inherits one exact pinned tool image and binds actual helper bytes", () => {
  const dockerfile = memoryImageDockerfile(base, helper);
  assert.ok(dockerfile.startsWith("FROM " + base + "\n"));
  assert.ok(
    dockerfile.includes('cloudmarkup.memory-workspace.sha256="' + helper + '"'),
  );
  assert.ok(
    dockerfile.includes(
      "COPY --chown=65532:65532 --chmod=0444 memory-workspace-v1.mjs",
    ),
  );
  assert.ok(dockerfile.includes("USER 65532:65532"));
  assert.doesNotMatch(dockerfile, /^(?:RUN|ADD|VOLUME|EXPOSE) /mu);
});
for (const value of [
  "cloudmarkup-application-build:candidate",
  "cloudmarkup-application-build:latest@sha256:" + "a".repeat(64),
  "cloudmarkup-application-build:candidate@sha256:" + "a".repeat(63),
  base + "\nRUN bad",
  "https://invalid.test/image",
  "sha256:" + "a".repeat(64),
]) {
  test("rejects noncanonical base image " + JSON.stringify(value), () => {
    assert.throws(() => pinnedApplicationImage(value));
  });
}
test("rejects mutable or malformed helper authority", () => {
  assert.throws(() => memoryImageDockerfile(base, "latest"));
  assert.throws(() => memoryImageDockerfile(base, helper + "\n"));
});

test("local candidate tag retains the exact manifest digest in FROM", () => {
  const tagged =
    "cloudmarkup-application-build:candidate@sha256:" + "a".repeat(64);
  assert.equal(pinnedApplicationImage(tagged), tagged);
  assert.equal(
    memoryImageDockerfile(tagged, helper).split("\n")[0],
    "FROM " + tagged,
  );
});

test("local OCI helper context preserves the exact base identity in preparation", () => {
  assert.equal(
    memoryImageDockerfile(base, helper, true).split("\n")[0],
    "FROM cloudmarkup-memory-base",
  );
  assert.throws(() => memoryImageDockerfile("mutable:tag", helper, true));
});
