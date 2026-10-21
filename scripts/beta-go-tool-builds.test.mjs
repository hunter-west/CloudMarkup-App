import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertReviewedGoSourceArtifact,
  buildReviewedGoSource,
  readReviewedGoBuildInputs,
  reviewedGoBuildProcess,
  reviewedGoSourceArtifact,
  readReviewedGoCache,
  writeReviewedGoCache,
} from "./beta-go-tool-builds.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
for (const tool of ["terraform", "tflint", "trivy"]) {
  test(`${tool}: exact public source, build inputs and output authority agree`, async () => {
    const artifact = reviewedGoSourceArtifact(tool);
    assert.doesNotThrow(() => assertReviewedGoSourceArtifact(artifact));
    const inputs = await readReviewedGoBuildInputs(repositoryRoot, tool);
    assert.deepEqual(
      inputs.map((input) => input.path),
      ["Dockerfile", "recipe.sh", "tool.patch"],
    );
    const dockerfile = inputs[0].bytes.toString("utf8");
    assert.match(
      dockerfile,
      /RUN --network=none bash \/inputs\/recipe\.sh build/u,
    );
    assert.doesNotMatch(
      dockerfile,
      /(?:--mount=type=secret|--mount=type=ssh|go generate|go test|curl|wget)/u,
    );
  });
}

test("artifact data cannot select arbitrary commands, sources, output paths, modes or byte pins", () => {
  for (const mutate of [
    (a) => {
      a.tool = "terraform; echo injected";
    },
    (a) => {
      a.url = "https://codeload.github.com/attacker/repo/tar.gz/main";
    },
    (a) => {
      a.sha256 = "0".repeat(64);
    },
    (a) => {
      a.members[0].destination = "../../escape";
    },
    (a) => {
      a.members[0].sha256 = "0".repeat(64);
    },
    (a) => {
      a.members[0].mode = "4755";
    },
    (a) => {
      a.buildArguments = ["--network=host"];
    },
  ]) {
    const artifact = reviewedGoSourceArtifact("terraform");
    mutate(artifact);
    assert.throws(
      () => assertReviewedGoSourceArtifact(artifact),
      /CONTEXT_GO_(?:TOOL_INVALID|AUTHORITY_DRIFT)/u,
    );
  }
  const fresh = reviewedGoSourceArtifact("terraform");
  fresh.members[0].sha256 = "0".repeat(64);
  assert.notEqual(
    reviewedGoSourceArtifact("terraform").members[0].sha256,
    fresh.members[0].sha256,
  );
});

test("builder strips ambient credentials, remote endpoints and command environment", () => {
  const build = reviewedGoBuildProcess(
    "trivy",
    resolve("context"),
    resolve("output"),
    resolve("home"),
  );
  assert.equal(build.command, "docker");
  assert.deepEqual(build.arguments.slice(0, 8), [
    "build",
    "--progress=plain",
    "--platform",
    "linux/amd64",
    "--build-arg",
    "TOOL=trivy",
    "--target",
    "output",
  ]);
  assert.equal(build.options.timeoutMs, 30 * 60 * 1000);
  assert.equal(build.options.maximumOutputBytes, 1024 * 1024);
  for (const name of [
    "AWS_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "NODE_OPTIONS",
    "GOFLAGS",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "HTTP_PROXY",
    "HTTPS_PROXY",
  ])
    assert.equal(Object.hasOwn(build.options.environment, name), false);
  assert.equal(
    build.options.environment.DOCKER_CONFIG,
    resolve("home", ".docker"),
  );
  assert.throws(
    () =>
      reviewedGoBuildProcess(
        "trivy",
        "relative",
        resolve("output"),
        resolve("home"),
      ),
    /CONTEXT_GO_PATH_INVALID/u,
  );
  assert.throws(
    () =>
      reviewedGoBuildProcess(
        "trivy",
        resolve("context"),
        resolve("out,type=docker"),
        resolve("home"),
      ),
    /CONTEXT_GO_PATH_INVALID/u,
  );
  assert.throws(
    () =>
      reviewedGoBuildProcess(
        "trivy",
        resolve("context"),
        resolve("output"),
        resolve("home"),
        "sh -c",
      ),
    /CONTEXT_GO_DOCKER_INVALID/u,
  );
});

test("changed source bytes fail before a build or staging write", async () => {
  let called = false;
  await assert.rejects(
    buildReviewedGoSource({
      artifact: reviewedGoSourceArtifact("terraform"),
      sourceBytes: Buffer.from("untrusted source"),
      repositoryRoot,
      stagingRoot: resolve("nonexistent-staging"),
      runProcess: () => {
        called = true;
      },
    }),
    /CONTEXT_GO_INPUT_DRIFT/u,
  );
  assert.equal(called, false);
});

test("changed build recipe and multiply linked patch fail before process launch", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-go-build-authority-"),
  );
  try {
    const inputsRoot = resolve(root, "infra/images/go-tools");
    await mkdir(resolve(inputsRoot, "patches"), { recursive: true });
    const actual = await readReviewedGoBuildInputs(repositoryRoot, "tflint");
    for (const input of actual)
      await writeFile(
        resolve(
          inputsRoot,
          input.path === "tool.patch" ? "patches/tflint.patch" : input.path,
        ),
        input.bytes,
      );
    await writeFile(
      resolve(inputsRoot, "recipe.sh"),
      Buffer.from("unreviewed recipe"),
    );
    await assert.rejects(
      readReviewedGoBuildInputs(root, "tflint"),
      /CONTEXT_GO_FILE_INVALID/u,
    );
    await writeFile(resolve(inputsRoot, "recipe.sh"), actual[1].bytes);
    await link(
      resolve(inputsRoot, "patches/tflint.patch"),
      resolve(root, "linked-patch"),
    );
    await assert.rejects(
      readReviewedGoBuildInputs(root, "tflint"),
      /CONTEXT_GO_FILE_INVALID/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a cache miss remains optional and cannot change reviewed tool authority", async () => {
  assert.equal(
    await readReviewedGoCache(undefined, reviewedGoSourceArtifact("trivy")),
    undefined,
  );
  assert.equal(
    await readReviewedGoCache(
      resolve("missing-go-cache"),
      reviewedGoSourceArtifact("trivy"),
    ),
    undefined,
  );
  const changed = reviewedGoSourceArtifact("trivy");
  changed.members[0].sha256 = "0".repeat(64);
  await assert.rejects(
    readReviewedGoCache(undefined, changed),
    /CONTEXT_GO_AUTHORITY_DRIFT/u,
  );
});

test("cached tool bytes, inventory and links are rejected before execution", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "cloudmarkup-go-cache-"));
  const artifact = reviewedGoSourceArtifact("trivy");
  const entry = resolve(root, `trivy-${artifact.members[0].sha256}`);
  try {
    await mkdir(entry);
    await writeFile(resolve(entry, "unexpected"), "untrusted");
    await assert.rejects(
      readReviewedGoCache(root, artifact),
      /CONTEXT_GO_CACHE_INVALID/u,
    );
    await rm(resolve(entry, "unexpected"));
    for (const member of artifact.members)
      await writeFile(resolve(entry, member.archivePath), "untrusted");
    await assert.rejects(
      readReviewedGoCache(root, artifact),
      /CONTEXT_GO_FILE_INVALID/u,
    );
    await link(resolve(entry, "trivy"), resolve(root, "extra-link"));
    await assert.rejects(
      readReviewedGoCache(root, artifact),
      /CONTEXT_GO_FILE_INVALID/u,
    );
    await assert.rejects(
      writeReviewedGoCache(root, artifact, []),
      /CONTEXT_GO_CACHE_INVALID/u,
    );
    await assert.rejects(
      writeReviewedGoCache(
        root,
        artifact,
        artifact.members.map((output) => ({
          output,
          bytes: Buffer.from("untrusted"),
        })),
      ),
      /CONTEXT_GO_INPUT_DRIFT/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
