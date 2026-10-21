import { describe, expect, it } from "vitest";
import {
  applicationBuildArtifactFileV1Schema,
  applicationBuildRequestV1Schema,
  applicationBuildResultV1Schema,
  applicationBuildSourceTreeDigest,
  canonicalJson,
  createDeterministicLambdaZip,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  ApplicationHostRepairSeedAdmissionError,
  applicationHostRepairSeedArtifactV1Schema,
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  HOST_REPAIR_SEED_STEPS,
  HOST_REPAIR_SEED_SUFFIXES_BY_VERSION,
  inspectApplicationHostRepairSeedRequestV1,
  inspectApplicationHostRepairSeedResultV1,
  type ApplicationHostRepairSeedBuildRequestV1,
  type ApplicationHostRepairSeedBuildResultV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  applicationGenerationResultV1Schema,
  digestCanonicalValue,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { readProductionRepairSeedSourceV1 } from "./production-model-live-repair-seed-source.js";

import { hostExecutionFixture as fixture } from "./production-model-live-repair-seed-execution-fixture.js";

function syntheticObservation(f: ReturnType<typeof fixture>) {
  const { bindings } = inspectApplicationHostRepairSeedRequestV1(
    f.request,
    f.config,
  );
  const archive = createDeterministicLambdaZip([
    {
      path: "index.js",
      bytes: new TextEncoder().encode(
        "// synthetic codec fixture, no executed build\n",
      ),
    },
  ]);
  const path = f.envelope.contract.expectedArtifact.path;
  const artifacts = [
    { path, bytes: archive, mediaType: "application/zip" },
    {
      path: path.replace(/\/function\.zip$/u, "/artifact-manifest.json"),
      bytes: new TextEncoder().encode('{"fixture":"synthetic-no-build"}\n'),
      mediaType: "application/json",
    },
    {
      path: path
        .replace("application/artifacts/", "application/evidence/")
        .replace(/\/function\.zip$/u, "/sbom.cdx.json"),
      bytes: new TextEncoder().encode('{"fixture":"synthetic-no-scan"}\n'),
      mediaType: "application/vnd.cyclonedx+json",
    },
  ].map(({ path: artifactPath, bytes, mediaType }) =>
    applicationHostRepairSeedArtifactV1Schema.parse({
      path: artifactPath,
      bytesBase64: Buffer.from(bytes).toString("base64"),
      checksum: sha256Digest(bytes),
      sizeBytes: bytes.byteLength,
      mediaType,
      ownership: "host-synthetic-validation-artifact",
      bindings,
    }),
  );
  const body = {
    kind: "cloudmarkup.host-repair-seed-build.result",
    contractVersion: 1,
    origin: "fixed-host-synthetic",
    authority: "tool-observation-only",
    state: "passed",
    bindings,
    steps: HOST_REPAIR_SEED_STEPS.map(([step, executable]) => ({
      step,
      executable,
      state: "passed",
      outputBytes: 0,
    })),
    tests: ["unit", "contract"].map((kind) => ({
      kind,
      passed: 1,
      failed: 0,
      skipped: 0,
      state: "passed",
    })),
    diagnostics: [],
    findings: [],
    artifacts,
    cleanup: "verified",
    reproducibility: {
      state: "verified",
      firstArchiveChecksum: sha256Digest(archive),
      secondArchiveChecksum: sha256Digest(archive),
    },
  };
  return applicationHostRepairSeedBuildResultV1Schema.parse({
    ...body,
    reportDigest: sha256Digest(canonicalJson(body)),
  });
}
function rehashResult(result: ApplicationHostRepairSeedBuildResultV1) {
  const { reportDigest: previous, ...body } = result;
  expect(previous).toMatch(/^sha256:/u);
  result.reportDigest = sha256Digest(canonicalJson(body));
}
function rehashSource(request: ApplicationHostRepairSeedBuildRequestV1) {
  for (const file of request.source.files)
    file.checksum = sha256Digest(file.content);
  request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
    request.source.files,
  );
  const extension = request.source.files.find(
    (file) => file.path === request.source.extensionPath,
  );
  if (extension !== undefined)
    request.source.extensionContentDigest = extension.checksum;
}

describe("actual fixed source with new host-only pure contracts (no runner execution)", () => {
  it.each([false, true])(
    "admits exact actual factory bytes for invalid=%s without rewriting the generator",
    (invalid) => {
      const f = fixture(invalid);
      const before = canonicalJson(f.source);
      const admitted = inspectApplicationHostRepairSeedRequestV1(
        f.request,
        f.config,
      );
      expect(admitted.originalBuildContract).toEqual(f.envelope);
      expect(admitted.effectiveInventory.authority).toBe(
        "host-source-admission-only",
      );
      expect(admitted.effectiveInventory.files).toHaveLength(
        f.source.positiveControl.files.length,
      );
      expect(admitted.bindings.baselineSourceDigest).not.toBe(
        admitted.bindings.sourceTreeDigest,
      );
      expect(canonicalJson(f.source)).toBe(before);
      expect(applicationBuildRequestV1Schema.safeParse(f.request).success).toBe(
        false,
      );
    },
  );

  const requestMutations: readonly [
    string,
    (r: ApplicationHostRepairSeedBuildRequestV1) => void,
  ][] = [
    [
      "wrong revision digest",
      (r) => {
        r.solutionRevisionDigest = sha256Digest("wrong");
      },
    ],
    [
      "coherently changed revision",
      (r) => {
        r.solutionRevision.createdAt = utcTimestampSchema.parse(
          "2026-09-12T01:00:00.000Z",
        );
        r.solutionRevisionDigest = sha256Digest(
          canonicalJson(r.solutionRevision),
        );
      },
    ],
    [
      "baseline digest",
      (r) => {
        r.source.baselineSourceDigest = sha256Digest("wrong");
      },
    ],
    [
      "recipe digest",
      (r) => {
        r.source.recipe.digest = sha256Digest("wrong");
      },
    ],
    [
      "source digest",
      (r) => {
        r.source.sourceTreeDigest = sha256Digest("wrong");
      },
    ],
    [
      "extension digest",
      (r) => {
        r.source.extensionContentDigest = sha256Digest("wrong");
      },
    ],
    [
      "coherent generated bytes",
      (r) => {
        const file = r.source.files.find(
          (item) => item.ownership === "generated",
        );
        if (file) file.content += "\n";
        rehashSource(r);
      },
    ],
    [
      "coherent control bytes",
      (r) => {
        const file = r.source.files.find(
          (item) => item.path === r.source.extensionPath,
        );
        if (file) file.content += "\nexport const unauthorized = true;\n";
        rehashSource(r);
      },
    ],
    [
      "swapped variant claim",
      (r) => {
        r.source.variant = "invalid-seed";
      },
    ],
    [
      "missing file",
      (r) => {
        r.source.files.pop();
        rehashSource(r);
      },
    ],
    [
      "duplicate file",
      (r) => {
        const file = r.source.files[0];
        if (file) r.source.files.push({ ...file });
        rehashSource(r);
      },
    ],
    [
      "AI ownership",
      (r) => {
        const file = r.source.files.find(
          (item) => item.path === r.source.extensionPath,
        );
        if (file) file.ownership = "ai-authored";
        rehashSource(r);
      },
    ],
    [
      "coherent lock bytes",
      (r) => {
        r.dependencyLock.lockfileContent += "# different\n";
        r.dependencyLock.lockfileChecksum = sha256Digest(
          r.dependencyLock.lockfileContent,
        );
      },
    ],
    [
      "lock package bytes",
      (r) => {
        const entry = r.dependencyLock.packages[0];
        if (entry) entry.tarballDigest = sha256Digest("wrong");
      },
    ],
    [
      "requested extra resources",
      (r) => {
        r.limits.cpuSeconds += 1;
      },
    ],
    [
      "wrong environment",
      (r) => {
        r.environment.environmentType = "production";
      },
    ],
  ];
  it.each(requestMutations)(
    "denies request substitution: %s",
    (_name, mutate) => {
      const f = fixture();
      const altered = structuredClone(f.request);
      mutate(altered);
      expect(
        applicationHostRepairSeedBuildRequestV1Schema.safeParse(altered)
          .success,
      ).toBe(true);
      expect(() =>
        inspectApplicationHostRepairSeedRequestV1(altered, f.config),
      ).toThrow(ApplicationHostRepairSeedAdmissionError);
    },
  );

  it("denies coherently modified trusted scaffold rather than trusting its new hash", () => {
    const f = fixture();
    const altered = structuredClone(f.config);
    altered.definition.deterministicScaffold.artifact.diagnostics.push({
      code: "FIXTURE_ALTERED",
      message: "Synthetic alternate diagnostic.",
      related: [],
      severity: "warning",
      source: { document: "solution-revision" },
    });
    altered.definition.deterministicScaffold.artifactDigest = sha256Digest(
      canonicalJson(altered.definition.deterministicScaffold.artifact),
    );
    expect(
      applicationGenerationResultV1Schema.safeParse(
        altered.definition.deterministicScaffold,
      ).success,
    ).toBe(true);
    expect(() =>
      inspectApplicationHostRepairSeedRequestV1(f.request, altered),
    ).toThrow(ApplicationHostRepairSeedAdmissionError);
  });

  it("rejoins synthetic result bytes while keeping them outside normal result/artifact contracts", () => {
    const f = fixture();
    const result = syntheticObservation(f);
    expect(
      inspectApplicationHostRepairSeedResultV1(result, f.request, f.config),
    ).toEqual(result);
    expect(applicationBuildResultV1Schema.safeParse(result).success).toBe(
      false,
    );
    for (const artifact of result.artifacts)
      expect(
        applicationBuildArtifactFileV1Schema.safeParse(artifact).success,
      ).toBe(false);
  });

  const resultMutations: readonly [
    string,
    (r: ApplicationHostRepairSeedBuildResultV1) => void,
  ][] = [
    [
      "request binding",
      (r) => {
        r.bindings.requestDigest = sha256Digest("wrong");
      },
    ],
    [
      "helper binding",
      (r) => {
        r.bindings.helperDigest = sha256Digest("wrong");
      },
    ],
    [
      "image binding",
      (r) => {
        r.bindings.imageDigest = sha256Digest("wrong");
      },
    ],
    [
      "lock binding",
      (r) => {
        r.bindings.dependencyLockDigest = sha256Digest("wrong");
      },
    ],
    [
      "cleanup",
      (r) => {
        r.cleanup = "not-established";
      },
    ],
    [
      "missing reproducibility",
      (r) => {
        r.reproducibility = { state: "not-established" };
      },
    ],
    [
      "different second archive",
      (r) => {
        if (r.reproducibility.state === "verified")
          r.reproducibility.secondArchiveChecksum = sha256Digest("different");
      },
    ],
    [
      "missing step",
      (r) => {
        r.steps.pop();
      },
    ],
    [
      "skipped step",
      (r) => {
        const step = r.steps[2];
        if (step) step.state = "skipped";
      },
    ],
    [
      "wrong command",
      (r) => {
        const step = r.steps[0];
        if (step) step.executable = "tsc";
      },
    ],
    [
      "skipped tests",
      (r) => {
        const test = r.tests[0];
        if (test) test.skipped = 1;
      },
    ],
    [
      "artifact checksum",
      (r) => {
        const artifact = r.artifacts[0];
        if (artifact) artifact.checksum = sha256Digest("wrong");
      },
    ],
    [
      "artifact size",
      (r) => {
        const artifact = r.artifacts[0];
        if (artifact) artifact.sizeBytes += 1;
      },
    ],
    [
      "extra output",
      (r) => {
        const step = r.steps[0];
        if (step) step.outputBytes = 1024 * 1024;
      },
    ],
  ];
  it.each(resultMutations)(
    "denies coherently rehashed synthetic result: %s",
    (_name, mutate) => {
      const f = fixture();
      const result = syntheticObservation(f);
      mutate(result);
      for (const artifact of result.artifacts)
        artifact.bindings = structuredClone(result.bindings);
      rehashResult(result);
      if (_name.endsWith("binding"))
        expect(
          applicationHostRepairSeedBuildResultV1Schema.safeParse(result)
            .success,
        ).toBe(true);
      expect(() =>
        inspectApplicationHostRepairSeedResultV1(result, f.request, f.config),
      ).toThrow(ApplicationHostRepairSeedAdmissionError);
    },
  );

  it("allows honest failed prefix with later checks absent and no artifacts", () => {
    const f = fixture(true);
    const result = syntheticObservation(f);
    result.state = "failed";
    result.steps = result.steps.slice(0, 3);
    const failed = result.steps[2];
    if (failed) failed.state = "failed";
    result.tests = [];
    result.artifacts = [];
    result.reproducibility = { state: "not-established" };
    rehashResult(result);
    expect(
      inspectApplicationHostRepairSeedResultV1(result, f.request, f.config)
        .state,
    ).toBe("failed");
    result.steps.push({
      step: "unit-tests",
      executable: "vitest",
      state: "passed",
      outputBytes: 0,
    });
    rehashResult(result);
    expect(() =>
      inspectApplicationHostRepairSeedResultV1(result, f.request, f.config),
    ).toThrow(ApplicationHostRepairSeedAdmissionError);
  });
});

describe("fixed host recipe version compatibility", () => {
  it.each([false, true])(
    "preserves historical suffix admission for invalid=%s without current authority",
    (invalid) => {
      const f = fixture(invalid);
      const definition = structuredClone(f.config.definition);
      const historical = HOST_REPAIR_SEED_SUFFIXES_BY_VERSION["1.0.0"];
      const current = HOST_REPAIR_SEED_SUFFIXES_BY_VERSION["1.1.0"];
      expect(historical["positive-control"]).toBe(
        "\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = 1;\n",
      );
      expect(historical["invalid-seed"]).toBe(current["invalid-seed"]);
      for (const file of definition.positiveControl.files) {
        if (file.path !== definition.extensionPath) continue;
        expect(file.content.endsWith(current["positive-control"])).toBe(true);
        file.content =
          file.content.slice(0, -current["positive-control"].length) +
          historical["positive-control"];
        file.checksum = sha256Digest(file.content);
        definition.positiveControl.extensionContentDigest = file.checksum;
      }
      definition.positiveControl.sourceTreeDigest =
        applicationBuildSourceTreeDigest(definition.positiveControl.files);
      const recipeDigest = (version: "1.0.0" | "1.1.0") => {
        const suffixes = HOST_REPAIR_SEED_SUFFIXES_BY_VERSION[version];
        return digestCanonicalValue({
          id: definition.recipe.id,
          version,
          origin: "fixed-host-synthetic",
          generationRequestDigest: digestCanonicalValue(
            definition.generationRequest,
          ),
          extensionPath: definition.extensionPath,
          positiveControlSuffixDigest: sha256Digest(
            suffixes["positive-control"],
          ),
          invalidSeedSuffixDigest: sha256Digest(suffixes["invalid-seed"]),
          predictedDiagnostic: {
            source: "typescript",
            code: "TS2322",
            path: definition.extensionPath,
          },
          observedValidation: "none",
        });
      };
      definition.recipe = {
        ...definition.recipe,
        version: "1.0.0",
        digest: recipeDigest("1.0.0"),
      };
      const variant = invalid
        ? definition.invalidSeed
        : definition.positiveControl;
      const request = applicationHostRepairSeedBuildRequestV1Schema.parse({
        ...f.request,
        source: {
          ...f.request.source,
          recipe: definition.recipe,
          files: variant.files,
          sourceTreeDigest: variant.sourceTreeDigest,
          extensionContentDigest: variant.extensionContentDigest,
        },
      });
      const config = { ...f.config, definition };
      expect(() =>
        inspectApplicationHostRepairSeedRequestV1(request, config),
      ).not.toThrow();
      expect(() => readProductionRepairSeedSourceV1(definition)).toThrow();
      definition.recipe = {
        ...definition.recipe,
        version: "1.1.0",
        digest: recipeDigest("1.1.0"),
      };
      request.source.recipe = definition.recipe;
      expect(() =>
        inspectApplicationHostRepairSeedRequestV1(request, config),
      ).toThrow(ApplicationHostRepairSeedAdmissionError);
    },
  );
});
