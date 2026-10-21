/** Explicit native proof over one fixed host recipe. No model or release authority. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  generationLock,
  runtimeClosure,
} from "./beta-application-package-verification.mjs";
import {
  prepareBetaMemoryApplicationTools,
  runMemoryProofCommand,
  verifyPreparedBetaMemoryApplication,
} from "./beta-memory-application-verification.mjs";

const digest = (bytes) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
const tool = (id, version, hash) => ({ id, version, digest: hash });
const owner = "cloudmarkup.owner=cloudmarkup.application-memory-workspace.v1";
const requireValue = (value) => {
  if (!value) throw new Error("Fixed host repair proof failed.");
};
const phases = new Set([
  "public-preparation",
  "notes-proof",
  "source-bundle",
  "source-admission",
  "request-admission",
  "invalid-seed",
  "positive-control",
  ...["invalid-seed", "positive-control"].flatMap((variant) =>
    ["request-admission", "execution", "result-admission", "observation"].map(
      (stage) => variant + "." + stage,
    ),
  ),
  "cleanup",
  "source-readback",
  "retention",
]);
const closedValue = (value, allowed) =>
  allowed.includes(value) ? value : "unclassified";
const observationStates = ["passed", "failed", "error", "cancelled", "skipped"];
const observationSteps = [
  "install",
  "lint",
  "typecheck",
  "unit-tests",
  "contract-tests",
  "dependency-scan",
  "secret-scan",
  "compile",
  "production-prune",
];
const observationCodes = [
  "command-failed",
  "observed-ts2322",
  "workspace-unavailable",
  "cleanup-failed",
  "tool-output-invalid",
  "test-summary-invalid",
  "expected-defect-absent",
  "cancelled-before-open",
  "final-admission-overdue",
].map((code) => "application.host-repair-seed." + code);
export function closedHostRepairFailure(phase, observation) {
  return (
    JSON.stringify({
      kind: "cloudmarkup.host-repair-native-failure.v1",
      phase: phases.has(phase) ? phase : "public-preparation",
      status: "failed",
      ...(observation === undefined
        ? {}
        : {
            observation: {
              state: closedValue(observation?.state, observationStates),
              cleanup: closedValue(observation?.cleanup, [
                "verified",
                "not-established",
              ]),
              step: closedValue(observation?.step, observationSteps),
              stepState: closedValue(observation?.stepState, observationStates),
              diagnostic: closedValue(
                observation?.diagnostic,
                observationCodes,
              ),
            },
          }),
    }) + "\n"
  );
}
/** Retain only fixed fields after full contract and exact-request admission. */
export function projectHostRepairObservation(result, bindings, variant) {
  requireValue(["invalid-seed", "positive-control"].includes(variant));
  requireValue(JSON.stringify(result.bindings) === JSON.stringify(bindings));
  requireValue(result.cleanup === "verified");
  requireValue(/^sha256:[a-f0-9]{64}$/u.test(result.reportDigest));
  if (variant === "invalid-seed") {
    requireValue(
      result.state === "failed" &&
        result.artifacts.length === 0 &&
        result.tests.length === 0 &&
        result.findings.length === 0 &&
        result.reproducibility.state === "not-established" &&
        result.steps.length === 3 &&
        result.steps[0].step === "install" &&
        result.steps[0].state === "passed" &&
        result.steps[1].step === "lint" &&
        result.steps[1].state === "passed" &&
        result.steps[2].step === "typecheck" &&
        result.steps[2].state === "failed" &&
        result.diagnostics.length === 1 &&
        result.diagnostics[0].code ===
          "application.host-repair-seed.observed-ts2322" &&
        result.diagnostics[0].source === "typecheck",
    );
  } else {
    requireValue(
      result.state === "passed" &&
        result.diagnostics.length === 0 &&
        result.steps.length === 9 &&
        result.steps.every((step) => step.state === "passed") &&
        result.tests.length === 2 &&
        result.tests.every(
          (test) =>
            test.state === "passed" &&
            test.passed > 0 &&
            test.failed === 0 &&
            test.skipped === 0,
        ) &&
        result.reproducibility.state === "verified" &&
        result.reproducibility.firstArchiveChecksum ===
          result.reproducibility.secondArchiveChecksum &&
        result.artifacts.length === 3,
    );
    requireValue(
      result.findings.every(
        (finding) =>
          finding.source !== "secret" &&
          !["high", "critical", "unknown"].includes(finding.severity),
      ),
    );
    for (const artifact of result.artifacts) {
      const bytes = Buffer.from(artifact.bytesBase64, "base64");
      requireValue(
        artifact.ownership === "host-synthetic-validation-artifact" &&
          bytes.length > 0 &&
          bytes.length === artifact.sizeBytes &&
          bytes.toString("base64") === artifact.bytesBase64 &&
          digest(bytes) === artifact.checksum,
      );
    }
  }
  return {
    variant,
    state: result.state,
    bindings: structuredClone(bindings),
    reportDigest: result.reportDigest,
    cleanup: result.cleanup,
    observedDefect: variant === "invalid-seed" ? "TS2322" : null,
    steps: result.steps.map(({ step, state }) => ({ step, state })),
    tests: result.tests.map(({ kind, passed, failed, skipped }) => ({
      kind,
      passed,
      failed,
      skipped,
    })),
    findingCount: result.findings.length,
    reproducibility: structuredClone(result.reproducibility),
    artifacts: result.artifacts.map(
      ({ path, checksum, sizeBytes, ownership }) => ({
        path,
        checksum,
        sizeBytes,
        ownership,
      }),
    ),
  };
}
function assertEmptyOwnedInventory(docker) {
  for (const args of [
    ["ps", "--all", "--quiet", "--filter", "label=" + owner],
    ["volume", "ls", "--quiet", "--filter", "label=" + owner],
  ])
    requireValue(runMemoryProofCommand(docker, args) === "");
}
async function bundleSource(repo, output) {
  const result = await build({
    absWorkingDir: repo,
    entryPoints: ["apps/api/src/production-model-live-repair-seed-source.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    write: false,
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  requireValue(
    result.outputFiles.length === 1 &&
      result.outputFiles[0].contents.length < 33554432,
  );
  const inputs = [];
  for (const file of Object.keys(result.metafile.inputs).sort()) {
    requireValue(
      !file.startsWith("../") &&
        !file.includes("/../") &&
        !file.startsWith("/"),
    );
    const bytes = await readFile(resolve(repo, file));
    inputs.push({
      file: file.replaceAll("\\", "/"),
      bytes: bytes.length,
      digest: digest(bytes),
    });
  }
  const path = resolve(output, "public-fixed-source-factory.mjs");
  const bytes = result.outputFiles[0].contents;
  await writeFile(path, bytes, { flag: "wx" });
  return { path, digest: digest(bytes), inputs };
}
export async function runBetaHostRepairSeedVerification(input) {
  let phase = "public-preparation";
  let failureObservation;
  try {
    const prepared = await prepareBetaMemoryApplicationTools(input);
    // Share immutable public tools; each actual candidate still owns its workspace.
    phase = "notes-proof";
    await verifyPreparedBetaMemoryApplication(input, prepared);
    const {
      repo,
      api,
      sourceCommit,
      output,
      baseImage,
      image,
      reference,
      pins,
      sourceLock,
      tarballs,
      closure,
      cacheDigest,
      toolchain,
      inputs,
    } = prepared;
    const moduleBase = pathToFileURL(
      resolve(repo, "apps/api/package.json"),
    ).href;
    const host = await import(
      import.meta.resolve(
        "@cloudmarkup/application-build-runner/host-repair-seed",
        moduleBase,
      )
    );
    phase = "source-bundle";
    const factory = await bundleSource(repo, output);
    const sourceModule = await import(pathToFileURL(factory.path).href);
    phase = "source-admission";
    // No candidate exists until native no-swap/core admission and public acquisition pass.
    await api.assertMemoryApplicationBuildHost();
    assertEmptyOwnedInventory(input.dockerExecutable);
    const definition = sourceModule.createProductionRepairSeedSourceV1();
    phase = "request-admission";
    const envelope =
      definition.deterministicScaffold.artifact.buildContracts[0];
    const manifest = definition.positiveControl.files.find(
      (file) => file.path === "application/package.json",
    );
    requireValue(envelope !== undefined && manifest !== undefined);
    const { lock, content } = generationLock(
      sourceLock,
      JSON.parse(manifest.content),
    );
    const runtime = runtimeClosure(envelope.contract, lock);
    const dependencies = envelope.contract.dependencies.map(
      ({ name, version, kind }) => ({ name, version, kind }),
    );
    const direct = new Map(
      dependencies.map((entry) => [
        entry.name + "@" + entry.version,
        entry.kind,
      ]),
    );
    const profile = host.createApplicationHostRepairSeedProfileV1();
    const policy = host.applicationHostRepairSeedPolicyV1Schema.parse({
      contractVersion: 1,
      builder: tool(
        "cloudmarkup.application-builder",
        "1.0.0",
        digest(api.canonicalJson(closure)),
      ),
      container: {
        image,
        digest: reference.slice(image.length + 1),
        platform: "linux/amd64",
        pnpmStorePath: "/opt/cloudmarkup/pnpm-store",
      },
      dependencyCacheDigest: cacheDigest,
      defaultLimits: {
        cpuSeconds: 120,
        maxArtifactBytes: 16777216,
        maxFileBytes: 4194304,
        maxFiles: 20000,
        maxOutputBytes: 2097152,
        maxProcesses: 64,
        maxTotalFileBytes: 134217728,
        memoryMiB: 4096,
        wallTimeMilliseconds: 600000,
      },
      dependencyAllowlist: dependencies,
      dependencyDenylist: ["event-stream", "ua-parser-js"],
      profile,
      scanner: tool("aquasecurity.trivy", inputs.toolchain.trivy, pins.trivy),
      secretScanner: tool(
        "aquasecurity.trivy-secret",
        inputs.toolchain.trivy,
        pins.trivy,
      ),
      toolchain,
    });
    const dependencyLock = api.applicationDependencyLockV1Schema.parse({
      cache: {
        digest: cacheDigest,
        kind: "prepackaged-content-addressed",
        network: "deny",
      },
      contractVersion: 1,
      lifecycleScripts: "deny",
      lockfileChecksum: digest(content),
      lockfileContent: content,
      lockfilePath: "application/pnpm-lock.yaml",
      packageManager: toolchain[1],
      packageManifestChecksum: manifest.checksum,
      packages: tarballs.map(({ name, version, integrity, tarballDigest }) => ({
        name,
        version,
        integrity,
        tarballDigest,
        kind:
          direct.get(name + "@" + version) ??
          (runtime.has(name + "@" + version)
            ? "transitive-runtime"
            : "transitive-development"),
      })),
    });
    const environment = {
      environmentId: "environment.development",
      environmentType: "development",
    };
    const config = {
      definition,
      policy,
      dependencyLock,
      environment,
      helperDigest: pins.helper,
    };
    const executor = host.createMemoryHostRepairSeedContainerExecutor({
      containerRuntimeExecutable: input.dockerExecutable,
      policy,
      helperDigest: pins.helper,
      cacheBytes: 1536 * 1024 * 1024,
    });
    const runner = host.createApplicationHostRepairSeedRunner({
      executor,
      config,
    });
    const observations = [];
    for (const variant of [
      definition.invalidSeed,
      definition.positiveControl,
    ]) {
      phase = variant.variant + ".request-admission";
      failureObservation = undefined;
      const request = host.applicationHostRepairSeedBuildRequestV1Schema.parse({
        kind: "cloudmarkup.host-repair-seed-build.request",
        contractVersion: 1,
        assessedAt: new Date().toISOString(),
        environment,
        profile,
        limits: policy.defaultLimits,
        dependencyLock,
        solutionRevision: definition.generationRequest.solutionRevision,
        solutionRevisionDigest: digest(
          api.canonicalJson(definition.generationRequest.solutionRevision),
        ),
        source: {
          origin: definition.origin,
          recipe: definition.recipe,
          variant: variant.variant,
          deterministicScaffold: definition.deterministicScaffold,
          baselineSourceDigest: definition.baselineSourceDigest,
          extensionPath: definition.extensionPath,
          extensionContentDigest: variant.extensionContentDigest,
          files: variant.files,
          sourceTreeDigest: variant.sourceTreeDigest,
        },
      });
      const admitted = host.inspectApplicationHostRepairSeedRequestV1(
        request,
        config,
      );
      phase = variant.variant + ".execution";
      const executed = await runner.run(request);
      // Finite classifications only, even if later admission rejects the result.
      failureObservation = {
        state: executed.state,
        cleanup: executed.cleanup,
        step: executed.steps.at(-1)?.step,
        stepState: executed.steps.at(-1)?.state,
        diagnostic: executed.diagnostics.at(-1)?.code,
      };
      phase = variant.variant + ".result-admission";
      const result = host.inspectApplicationHostRepairSeedResultV1(
        executed,
        request,
        config,
      );
      phase = variant.variant + ".observation";
      observations.push(
        projectHostRepairObservation(
          result,
          admitted.bindings,
          variant.variant,
        ),
      );
    }
    failureObservation = undefined;
    phase = "cleanup";
    assertEmptyOwnedInventory(input.dockerExecutable);
    phase = "source-readback";
    requireValue(
      runMemoryProofCommand("git", ["rev-parse", "HEAD"]) === sourceCommit &&
        runMemoryProofCommand("git", [
          "status",
          "--porcelain",
          "--untracked-files=normal",
        ]) === "",
    );
    const record = {
      contractVersion: 1,
      recordKind: "actual-linux-fixed-host-repair-proof",
      sourceCommit,
      sourceAuthority: "fixed-host-synthetic",
      hostedAiEvidence: false,
      releaseAdmission: "not-issued",
      baseImage,
      image: reference,
      helperDigest: pins.helper,
      toolPins: pins,
      builderClosure: closure,
      dependencyCacheDigest: cacheDigest,
      sourceFactory: { digest: factory.digest, inputs: factory.inputs },
      exactCleanupVerified: true,
      observations,
    };
    phase = "retention";
    await writeFile(
      resolve(output, "host-repair-observation.json"),
      JSON.stringify(record, null, 2) + "\n",
      { flag: "wx" },
    );
    return record;
  } catch {
    throw new Error(closedHostRepairFailure(phase, failureObservation));
  }
}
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [runtimeRoot, outputRoot, dockerExecutable] = process.argv.slice(2);
  Promise.resolve()
    .then(() => {
      requireValue(
        process.argv.length === 5 &&
          runtimeRoot &&
          outputRoot &&
          dockerExecutable,
      );
      return runBetaHostRepairSeedVerification({
        runtimeRoot: resolve(runtimeRoot),
        outputRoot: resolve(outputRoot),
        dockerExecutable,
      });
    })
    .then((record) => {
      process.stdout.write(
        JSON.stringify({
          recordKind: record.recordKind,
          sourceCommit: record.sourceCommit,
          exactCleanupVerified: record.exactCleanupVerified,
          states: record.observations.map(({ variant, state }) => ({
            variant,
            state,
          })),
        }) + "\n",
      );
    })
    .catch((error) => {
      // Only our closed record can leave the proof; no raw tool or source content.
      let phase = "public-preparation";
      let observation;
      try {
        const failure = JSON.parse(error.message);
        phase = failure.phase;
        observation = failure.observation;
      } catch {
        /* closed default */
      }
      process.stderr.write(closedHostRepairFailure(phase, observation));
      process.exitCode = 1;
    });
}
