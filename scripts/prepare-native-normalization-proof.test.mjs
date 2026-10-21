import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  assertLinuxExecutable,
  assertSourceIdentity,
  assertToolVersions,
  bundleNormalizationParent,
  ownedOutput,
  pinnedNormalizationImage,
} from "./prepare-native-normalization-proof.mjs";
import { sha } from "./native-normalization-proof.mjs";

const HASH = "a".repeat(64),
  COMMIT = "b".repeat(40);
function executable() {
  const bytes = Buffer.alloc(64);
  Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(bytes);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  return bytes;
}
test("denies library archives, wrong architecture, class, byte order and truncated tools", () => {
  assert.doesNotThrow(() => assertLinuxExecutable(executable()));
  for (const bytes of [
    Buffer.from("!<arch>\n"),
    Buffer.alloc(0),
    ...[
      [4, 1],
      [5, 2],
      [16, 1],
      [18, 183],
    ].map(([at, value]) => {
      const bytes = executable();
      bytes[at] = value;
      return bytes;
    }),
  ])
    assert.throws(() => assertLinuxExecutable(bytes));
});
test("requires the exact committed source with no modified or untracked paths", () => {
  assertSourceIdentity(COMMIT, COMMIT, "");
  for (const args of [
    [COMMIT, "c".repeat(40), ""],
    ["main", COMMIT, ""],
    [COMMIT, COMMIT, " M apps/api/src/native-normalization-proof-parent.ts"],
    [COMMIT, COMMIT, "?? scripts/extra.mjs"],
  ]) {
    assert.throws(() => assertSourceIdentity(...args));
  }
});
test("requires the pinned native toolchain and rejects Windows or newer tool substitutions", () => {
  const module = "module compiler\n\ngo 1.26.0\n\ntoolchain go1.26.8\n";
  assertToolVersions(
    "24.18.0",
    "go version go1.26.8 linux/amd64",
    "24.18.0\n",
    module,
  );
  for (const [node, go, source] of [
    ["24.18.1", "go version go1.26.8 linux/amd64", module],
    ["24.18.0", "go version go1.26.8 windows/amd64", module],
    ["24.18.0", "go version go1.26.9 linux/amd64", module],
    ["24.18.0", "go version go1.26.8 linux/amd64", "go 1.26.0"],
  ])
    assert.throws(() => assertToolVersions(node, go, "24.18.0", source));
});
test("image selection accepts only the reviewed architecture, Node line and immutable digest", () => {
  const inputs = {
    platform: "linux/amd64",
    toolchain: { node: "24.18.0" },
    bindings: { nodeBaseImage: { imageDigest: "sha256:" + HASH } },
  };
  assert.equal(pinnedNormalizationImage(inputs), "node@sha256:" + HASH);
  for (const value of [
    null,
    {},
    { ...inputs, platform: "linux/arm64" },
    { ...inputs, toolchain: { node: "24.17.0" } },
    { ...inputs, bindings: { nodeBaseImage: { imageDigest: "latest" } } },
  ])
    assert.throws(() => pinnedNormalizationImage(value));
});
test("public output cannot replace the cache root or escape the checkout", () => {
  const root = resolve(tmpdir(), "normalization-public-test");
  assert.equal(
    ownedOutput(root, resolve(root, ".cache", "new-proof")),
    resolve(root, ".cache", "new-proof"),
  );
  for (const path of [
    resolve(root, ".cache"),
    resolve(root, "elsewhere"),
    resolve(root, "..", "outside"),
    "relative",
    resolve(root, ".cache", "bad,name"),
  ])
    assert.throws(() => ownedOutput(root, path));
});
test("bundling fingerprints public inputs without evaluating the entry or writing bundle files", async () => {
  const root = await mkdtemp(
    resolve(tmpdir(), "cloudmarkup-normalization-bundle-"),
  );
  try {
    const entry = resolve(
      root,
      "apps/api/src/native-normalization-proof-parent-entry.ts",
    );
    await mkdir(resolve(root, "apps/api/src"), { recursive: true });
    const source =
      'throw new Error("The public entry must never execute during preparation.");\n';
    await writeFile(entry, source);
    const first = await bundleNormalizationParent(root);
    assert.equal(first.inputs.length, 1);
    assert.equal(first.inputs[0].sha256, sha(source));
    assert.match(Buffer.from(first.bytes).toString(), /must never execute/u);
    await writeFile(entry, source + "export const revision = 2;\n");
    const second = await bundleNormalizationParent(root);
    assert.notEqual(second.inputs[0].sha256, first.inputs[0].sha256);
    assert.notEqual(sha(second.bytes), sha(first.bytes));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("workflow isolates same-repository native verification and retains only closed metadata", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../.github/workflows/beta-native-normalization-verification.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(
    workflow.on.pull_request.paths.filter((path) => path.startsWith("!")),
    [
      "!packages/*/README.md",
      "!packages/*/AGENTS.md",
      "!services/iac-compiler/README.md",
      "!services/iac-compiler/AGENTS.md",
    ],
  );
  assert.equal(workflow.jobs.proof["timeout-minutes"], 20);
  assert.match(
    workflow.jobs.proof.if,
    /head\.repo\.full_name == github\.repository/u,
  );
  const steps = workflow.jobs.proof.steps;
  assert.equal(steps[0].with["persist-credentials"], false);
  const preparation = steps.find(
    (step) =>
      step.name === "Admit the disposable native host and prepare public tools",
  ).run;
  assert.ok(
    preparation.indexOf(
      'test "\u0024{RUNNER_ENVIRONMENT:-}" = "github-hosted"',
    ) < preparation.indexOf("sudo -n swapoff"),
  );
  assert.ok(
    preparation.indexOf("assertMemoryApplicationBuildHost();") <
      preparation.indexOf("docker pull"),
  );
  assert.match(preparation, /"\u0024GITHUB_SHA" "\u0024image_id"/u);
  const execute = steps.find(
    (step) =>
      step.name === "Execute the independently inspected full normalization",
  ).run;
  assert.ok(
    execute.indexOf("ulimit -c 0") <
      execute.indexOf("native-normalization-proof.mjs"),
  );
  const upload = steps.at(-1);
  assert.equal(upload.if, "\u0024{{ success() }}");
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    ".cache/native-normalization-public/public-build.json",
    ".cache/native-normalization-public/manifest.json",
    ".cache/native-normalization-records/*.admission.json",
    ".cache/native-normalization-records/*.result.json",
  ]);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.ok(!JSON.stringify(workflow).includes("secrets."));
  assert.ok(!JSON.stringify(workflow).includes("id-token"));
});
