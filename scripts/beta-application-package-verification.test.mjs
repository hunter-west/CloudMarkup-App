import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import {
  candidatePackageGroups,
  candidatePackagePatterns,
  generationLock,
  runtimeClosure,
  verifiedTarballs,
} from "./beta-application-package-verification.mjs";

const bytes = Buffer.from("synthetic locked archive");
const integrity =
  "sha512-" + createHash("sha512").update(bytes).digest("base64");
const metadata = { resolution: { integrity } };

test("fixed CI package groups cover every application family exactly once", () => {
  const expected = [
    "notes",
    "notes-crud",
    "sqs-consumer-dlq",
    "s3-image-metadata",
    "sns-fanout-consumer",
    "eventbridge-scheduled",
    "eventbridge-target",
    "step-functions-task",
  ];
  assert.deepEqual(candidatePackagePatterns(), expected);
  const grouped = Object.keys(candidatePackageGroups).flatMap((group) =>
    candidatePackagePatterns(group),
  );
  assert.deepEqual(grouped, expected);
  assert.equal(new Set(grouped).size, expected.length);
  for (const group of ["", "notes", "constructor", "__proto__", "all,events"])
    assert.throws(() => candidatePackagePatterns(group), /Unknown fixed/);
  const selected = candidatePackagePatterns("events");
  selected.pop();
  assert.equal(candidatePackagePatterns("events").length, 4);
});

test("acquisition verifies exact SRI with fixed registry and no redirects", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(bytes);
  });
  const result = await verifiedTarballs({
    packages: { "@example/locked@1.2.3": metadata },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://registry.npmjs.org/@example/locked/-/locked-1.2.3.tgz",
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result[0].integrity, integrity);
  assert.equal(
    result[0].tarballDigest,
    "sha256:" + createHash("sha256").update(bytes).digest("hex"),
  );
});

test("acquisition sorts package names and versions using canonical UTF-16 identities", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const identities = [
    "pkg.extra@1.0.0",
    "pkg@2.0.0",
    "@scope/pkg-other@1.0.0",
    "pkg-other@1.0.0",
    "pkg@10.0.0",
    "@scope/pkg@1.0.0",
  ];
  const result = await verifiedTarballs({
    packages: Object.fromEntries(identities.map((key) => [key, metadata])),
  });
  assert.deepEqual(
    result.map(({ name, version }) => name + "@" + version),
    [
      "@scope/pkg@1.0.0",
      "@scope/pkg-other@1.0.0",
      "pkg@10.0.0",
      "pkg@2.0.0",
      "pkg-other@1.0.0",
      "pkg.extra@1.0.0",
    ],
  );
});

test("acquisition rejects invalid identities before a network request", async (t) => {
  const mocked = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Unexpected fetch");
  });
  for (const key of [
    "../escape@1.2.3",
    "pkg@https://bad.invalid/1",
    "pkg@1.2.3/../../x",
  ]) {
    await assert.rejects(
      verifiedTarballs({ packages: { [key]: metadata } }),
      /Noncanonical/,
    );
  }
  assert.equal(mocked.mock.callCount(), 0);
});

test("acquisition rejects changed bytes and failed HTTP", async (t) => {
  const mocked = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("changed"),
  );
  await assert.rejects(
    verifiedTarballs({ packages: { "pkg@1.2.3": metadata } }),
    /locked SRI/,
  );
  mocked.mock.mockImplementation(
    async () => new Response(null, { status: 403 }),
  );
  await assert.rejects(
    verifiedTarballs({ packages: { "pkg@1.2.3": metadata } }),
    /acquisition failed/,
  );
});

test("acquisition caps oversized archives and closed inventory", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    body: (async function* () {
      yield Buffer.alloc(40_000_001);
    })(),
  }));
  await assert.rejects(
    verifiedTarballs({ packages: { "pkg@1.2.3": metadata } }),
    /exceeds acquisition limit/,
  );
  await assert.rejects(
    verifiedTarballs({ packages: {} }),
    /Closed dependency inventory/,
  );
  await assert.rejects(
    verifiedTarballs({
      packages: Object.fromEntries(
        Array.from({ length: 513 }, (_, i) => [`pkg${i}@1.0.0`, metadata]),
      ),
    }),
    /Closed dependency inventory/,
  );
});

test("lock projection preserves exact resolutions and rejects undeclared dependencies", () => {
  const source = {
    importers: {
      ".": {
        dependencies: {
          pkg: { specifier: "1.2.3", version: "1.2.3" },
          extra: { specifier: "4.5.6", version: "4.5.6" },
        },
      },
    },
    packages: { "pkg@1.2.3": metadata },
    snapshots: { "pkg@1.2.3": {} },
  };
  const result = generationLock(stringify(source), {
    dependencies: { pkg: "1.2.3" },
  });
  assert.deepEqual(result.lock.packages, source.packages);
  assert.deepEqual(parse(result.content).snapshots, source.snapshots);
  assert.deepEqual(Object.keys(result.lock.importers["."].dependencies), [
    "pkg",
  ]);
  assert.throws(
    () =>
      generationLock(stringify(source), { dependencies: { pkg: "^1.2.3" } }),
    /exact acquired toolchain lock/,
  );
  assert.throws(
    () =>
      generationLock(stringify(source), { dependencies: { unknown: "1.2.3" } }),
    /exact acquired toolchain lock/,
  );
});

test("runtime closure follows transitive dependencies and rejects optional or missing snapshots", () => {
  const contract = {
    dependencies: [
      { name: "pkg", version: "1.2.3", kind: "runtime" },
      { name: "dev", version: "9.0.0", kind: "development" },
    ],
  };
  const lock = {
    snapshots: {
      "pkg@1.2.3": { dependencies: { child: "2.0.0" } },
      "child@2.0.0": { dependencies: { pkg: "1.2.3" } },
    },
  };
  assert.deepEqual(
    [...runtimeClosure(contract, lock)],
    ["pkg@1.2.3", "child@2.0.0"],
  );
  assert.throws(
    () => runtimeClosure(contract, { snapshots: {} }),
    /absent runtime snapshot/,
  );
  assert.throws(
    () =>
      runtimeClosure(contract, {
        snapshots: {
          "pkg@1.2.3": { optionalDependencies: { child: "2.0.0" } },
        },
      }),
    /Unreviewed optional/,
  );
});

test("GitHub verification uses same-repository PRs without credentials or deployment authority", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../.github/workflows/beta-runner-verification.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.deepEqual(
    workflow.on.pull_request.paths.filter((path) => path.startsWith("!")),
    ["!packages/*/README.md", "!packages/*/AGENTS.md"],
  );
  const job = workflow.jobs.package;
  assert.equal(job["timeout-minutes"], 45);
  assert.deepEqual(
    job.strategy.matrix.group,
    Object.keys(candidatePackageGroups),
  );
  assert.equal(job.strategy["fail-fast"], false);
  assert.equal(job.strategy["max-parallel"], 2);
  assert.match(
    job.if,
    /github.event.pull_request.head.repo.full_name == github.repository/,
  );
  assert.equal(job.environment, undefined);
  const cache = job.steps.find(
    (step) => step.name === "Restore hash-verified public Go tools",
  );
  assert.equal(
    cache.uses,
    "actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306",
  );
  assert.deepEqual(Object.keys(cache.with).sort(), ["key", "path"]);
  assert.equal(cache.with.path, ".cache/reviewed-go-tools");
  assert.ok(
    cache.with.key.includes(
      "hashFiles('infra/images/go-tools/**', 'scripts/beta-go-tool-builds.mjs')",
    ),
  );

  for (const step of job.steps) {
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    assert.doesNotMatch(
      JSON.stringify(step),
      /secrets\.|id-token|docker.sock|cdk deploy|aws-actions/,
    );
  }
  assert.equal(job.steps[0].with["persist-credentials"], false);
  const materialization = job.steps.find((step) =>
    step.name.startsWith("Materialize verified"),
  );
  assert.match(
    materialization.run,
    /pnpm beta:image-contexts:archive:application /,
  );
  assert.doesNotMatch(materialization.run, /beta:image-contexts:archive /);
  // A pnpm script supplies npm_execpath for exact CLI-byte admission.
  // Direct node or pnpm exec invocation omits that required authority.
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(
    manifest.scripts["beta:image-contexts:archive:application"],
    "node scripts/beta-image-contexts.mjs archive-application",
  );
  const execution = job.steps.find((step) =>
    step.name.startsWith("Run actual isolated"),
  );
  assert.match(
    execution.run,
    /scripts\/beta-application-package-verification.mjs/,
  );
  assert.ok(execution.run.includes("${{ matrix.group }}"));
  const retention = job.steps.find(
    (step) => step.name === "Retain actual candidate evidence",
  );
  assert.equal(
    retention.with.name,
    "beta-runner-candidate-evidence-${{ matrix.group }}",
  );
});
