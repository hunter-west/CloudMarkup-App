import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  applicationBuildSourceTreeDigest,
  applicationBuildSourceV1Schema,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  getArchitectureDocumentContentHash,
  validateArchitectureDocumentSemantics,
} from "@cloudmarkup/domain";
import {
  applicationGenerationRequestV1Schema,
  digestCanonicalValue,
  workloadImplementationV2Schema,
} from "@cloudmarkup/schemas";
import { frozenFullBetaEvaluationDatasetV1 } from "@cloudmarkup/model-gateway";
import { AWS_CURRENT_CATALOG_BINDING_V1 } from "@cloudmarkup/provider-aws";
import {
  bindProductionRepairSeedCaseV1,
  createProductionRepairSeedSourceV1,
  readProductionRepairSeedSourceV1,
} from "./production-model-live-repair-seed-source.js";
import {
  REPAIR_SEED_CONTROL_SUFFIX,
  REPAIR_SEED_INVALID_SUFFIX,
  ProductionRepairSeedSourceError,
  productionRepairSeedSourceV1Schema,
  REPAIR_SEED_SOURCE_MAX_BYTES,
  type ProductionRepairSeedSourceV1,
} from "./production-model-live-repair-seed-source-codec.js";

function extension(source: ProductionRepairSeedSourceV1, invalid = false) {
  const variant = invalid ? source.invalidSeed : source.positiveControl;
  const file = variant.files.find(
    (entry) => entry.path === source.extensionPath,
  );
  if (file === undefined) throw Error("Expected fixed extension.");
  return file;
}
function rehashVariant(source: ProductionRepairSeedSourceV1, invalid = false) {
  const variant = invalid ? source.invalidSeed : source.positiveControl;
  for (const file of variant.files) file.checksum = sha256Digest(file.content);
  variant.sourceTreeDigest = applicationBuildSourceTreeDigest(variant.files);
  variant.extensionContentDigest = extension(source, invalid).checksum;
}

describe("fixed host-synthetic repair seed source", () => {
  it("generates syntactically valid TypeScript for both unvalidated variants", () => {
    const source = createProductionRepairSeedSourceV1();
    expect(source.recipe.version).toBe("1.1.0");
    for (const variant of [source.positiveControl, source.invalidSeed]) {
      for (const file of variant.files.filter((entry) =>
        entry.path.endsWith(".ts"),
      )) {
        const output = transpileModule(file.content, {
          fileName: file.path,
          reportDiagnostics: true,
          compilerOptions: {
            module: ModuleKind.NodeNext,
            target: ScriptTarget.ES2024,
          },
        });
        expect(output.diagnostics, file.path).toEqual([]);
      }
    }
  });

  it("uses the real generator over a semantically valid fixed manual starter", () => {
    const source = createProductionRepairSeedSourceV1();
    const request = applicationGenerationRequestV1Schema.parse(
      source.generationRequest,
    );
    expect(
      validateArchitectureDocumentSemantics(request.architectureDocument),
    ).toEqual([]);
    expect(request.architectureDocument.nodes).toHaveLength(4);
    expect(
      request.architectureDocument.nodes
        .map((node) => node.semantic.serviceType)
        .sort(),
    ).toEqual([
      "aws.apigateway.http-api",
      "aws.cloudwatch.log-group",
      "aws.dynamodb.table",
      "aws.lambda.function",
    ]);
    // This is a newly generated host-synthetic scaffold, not historical model
    // evidence. Its exact input follows the installed generator/catalog.
    expect(request.architectureDocument.catalog).toEqual(
      AWS_CURRENT_CATALOG_BINDING_V1,
    );
    expect(request.architectureDocument.edges).toHaveLength(3);
    expect(
      request.architectureDocument.applicationContracts.contracts,
    ).toHaveLength(6);
    expect(request.solutionRevision.architecture.contentHash).toBe(
      getArchitectureDocumentContentHash(request.architectureDocument),
    );
    expect(request.workloadBehavior.workloads).toHaveLength(1);
    expect(request.workloadBehavior.workloads[0]).toMatchObject({
      implementation: { mode: "generated-starter" },
      provenance: { source: "manual" },
      extensions: [],
      compatibility: { modelGateways: [] },
    });
    expect(request.solutionRevision.aiExtensionIds).toEqual([]);
    expect(request.solutionRevision.evidenceIdsAtFreeze).toEqual([]);
    expect(
      source.deterministicScaffold.artifact.diagnostics.filter(
        (item) => item.severity === "error",
      ),
    ).toEqual([]);
    expect(
      source.deterministicScaffold.artifact.workloadContracts[0]
        ?.implementationMode,
    ).toBe("generated-starter");
    expect(request.solutionRevision.versions.compiler.state).toBe(
      "not-applicable",
    );
  });

  it("repeats exact bytes, preserves the source constants and returns detached data", () => {
    const original = createProductionRepairSeedSourceV1();
    const frozenBefore = digestCanonicalValue(
      frozenFullBetaEvaluationDatasetV1,
    );
    const repeat = createProductionRepairSeedSourceV1();
    expect(repeat).toEqual(original);
    expect(readProductionRepairSeedSourceV1(original)).toEqual(original);
    extension(repeat).content = "changed";
    repeat.generationRequest.architectureDocument.nodes.splice(0);
    repeat.invalidSeed.files.splice(0);
    repeat.deterministicScaffold.artifact.sourceFiles.splice(0);
    expect(() => readProductionRepairSeedSourceV1(repeat)).toThrow(
      ProductionRepairSeedSourceError,
    );
    expect(createProductionRepairSeedSourceV1()).toEqual(original);
    expect(digestCanonicalValue(frozenFullBetaEvaluationDatasetV1)).toBe(
      frozenBefore,
    );
  });

  it("changes exactly one permitted path and retains every baseline generated byte", () => {
    const source = createProductionRepairSeedSourceV1();
    const baseline = source.deterministicScaffold.artifact.sourceFiles;
    expect(source.positiveControl.files.map((file) => file.path)).toEqual(
      source.invalidSeed.files.map((file) => file.path),
    );
    const changed = source.positiveControl.files.filter(
      (file, index) =>
        file.content !== source.invalidSeed.files[index]?.content,
    );
    expect(changed.map((file) => file.path)).toEqual([source.extensionPath]);
    for (const file of source.positiveControl.files) {
      const original = baseline.find((entry) => entry.path === file.path);
      expect(original).toBeDefined();
      expect(file.ownership).toBe(original?.ownership);
      if (file.path !== source.extensionPath)
        expect(file).toMatchObject({
          content:
            original !== undefined && "content" in original
              ? original.content
              : undefined,
          checksum: original?.checksum,
        });
    }
    expect(extension(source).ownership).toBe("user-owned");
    expect(extension(source).content).toContain(
      'implementation: "user-required"',
    );
    expect(
      extension(source).content.endsWith(
        "\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = Math.abs(1);\n",
      ),
    ).toBe(true);
    expect(
      extension(source, true).content.endsWith(
        '\n// Host-synthetic compiler control; not application behavior.\nexport const repairSeedTypeWitness: number = "invalid";\n',
      ),
    ).toBe(true);
    expect(REPAIR_SEED_CONTROL_SUFFIX).not.toBe(REPAIR_SEED_INVALID_SUFFIX);
    expect(source.positiveControl.sourceTreeDigest).not.toBe(
      source.invalidSeed.sourceTreeDigest,
    );
  });

  it("keeps baseline ownership bound to the final immutable revision", () => {
    const source = createProductionRepairSeedSourceV1();
    const baseline = source.deterministicScaffold.artifact.sourceFiles.find(
      (file) => file.path === source.extensionPath,
    );
    expect(source.generationRequest.solutionRevision.sourceOwnership).toEqual([
      {
        path: source.extensionPath,
        contentHash: baseline?.checksum,
        ownership: "user-owned",
        ownerId: "repair_seed.owner",
        conflictBehavior: "preserve-user-content",
      },
    ]);
    expect(source.generationRequest.existingFiles).toEqual([]);
  });

  it.each([
    "evaluation_case_repair_success_full_beta_v1",
    "evaluation_case_repair_exhaustion_full_beta_v1",
  ] as const)(
    "binds the unchanged %s input separately from the source recipe",
    (caseId) => {
      const expected = frozenFullBetaEvaluationDatasetV1.cases.find(
        (entry) => entry.caseId === caseId,
      );
      if (expected === undefined) throw Error("Expected frozen case.");
      const binding = bindProductionRepairSeedCaseV1(caseId);
      expect(binding).toEqual({
        dataset: {
          datasetId: frozenFullBetaEvaluationDatasetV1.datasetId,
          datasetVersion: frozenFullBetaEvaluationDatasetV1.datasetVersion,
          datasetDigest: frozenFullBetaEvaluationDatasetV1.datasetDigest,
        },
        caseId,
        caseDigest: expected.caseDigest,
        frozenInputDigest: digestCanonicalValue(expected.input),
        recipeDigest: createProductionRepairSeedSourceV1().recipe.digest,
      });
      expect(expected.input.repositoryFixtures).toEqual([]);
      expect(binding.frozenInputDigest).not.toBe(binding.recipeDigest);
    },
  );

  it.each([
    "evaluation_case_simple_serverless_api_v1",
    "repair-success",
    "evaluation_case_repair_success_v2",
  ])("denies unsupported case identity %s", (caseId) => {
    expect(() =>
      bindProductionRepairSeedCaseV1(
        caseId as Parameters<typeof bindProductionRepairSeedCaseV1>[0],
      ),
    ).toThrow(ProductionRepairSeedSourceError);
  });

  it("does not produce current AI/generated request authority or accepted extension evidence", () => {
    const source = createProductionRepairSeedSourceV1();
    expect(applicationBuildSourceV1Schema.safeParse(source).success).toBe(
      false,
    );
    expect(
      applicationBuildSourceV1Schema.safeParse(source.positiveControl).success,
    ).toBe(false);
    const implementation =
      source.generationRequest.workloadBehavior.workloads[0]?.implementation;
    expect(
      workloadImplementationV2Schema.safeParse({
        ...implementation,
        mode: "ai-assisted-custom",
        sourceOwnership: "ai-authored",
      }).success,
    ).toBe(false);
    expect(
      workloadImplementationV2Schema.safeParse({
        ...implementation,
        mode: "ai-assisted-custom",
        sourceOwnership: "ai-authored",
        extension: {
          extensionId: "repair_seed.extension",
          extensionContractVersion: 1,
          ownership: "ai-authored",
          digest: source.positiveControl.extensionContentDigest,
          validationEvidenceIds: [],
        },
      }).success,
    ).toBe(false);
  });

  const mutations: readonly [
    string,
    (source: ProductionRepairSeedSourceV1) => unknown,
  ][] = [
    [
      "extra result authority",
      (source) => ({ ...source, validationReceiptId: "not-issued" }),
    ],
    ["wrong source origin", (source) => ({ ...source, origin: "ai-authored" })],
    [
      "arbitrary recipe digest",
      (source) => ({
        ...source,
        recipe: { ...source.recipe, digest: `sha256:${"0".repeat(64)}` },
      }),
    ],
    [
      "wrong baseline digest",
      (source) => ({
        ...source,
        baselineSourceDigest: `sha256:${"0".repeat(64)}`,
      }),
    ],
    [
      "alternate permitted path",
      (source) => ({ ...source, extensionPath: "application/src/other.ts" }),
    ],
    [
      "swapped variants",
      (source) => ({
        ...source,
        positiveControl: source.invalidSeed,
        invalidSeed: source.positiveControl,
      }),
    ],
    [
      "AI ownership substitution",
      (source) => {
        extension(source).ownership = "ai-authored";
        rehashVariant(source);
        return source;
      },
    ],
    [
      "coherently rehashed alternate control",
      (source) => {
        extension(source).content = extension(source).content.replace(
          "number = Math.abs(1)",
          "number = 2",
        );
        rehashVariant(source);
        return source;
      },
    ],
    [
      "coherently rehashed alternate defect",
      (source) => {
        extension(source, true).content = extension(
          source,
          true,
        ).content.replace('"invalid"', '"another"');
        rehashVariant(source, true);
        return source;
      },
    ],
    [
      "coherently rehashed generated change",
      (source) => {
        const file = source.positiveControl.files.find(
          (entry) => entry.ownership === "generated",
        );
        if (file === undefined) throw Error("Expected generated file.");
        file.content += "\n";
        rehashVariant(source);
        return source;
      },
    ],
    [
      "missing generated file",
      (source) => {
        source.positiveControl.files.pop();
        rehashVariant(source);
        return source;
      },
    ],
    [
      "duplicate file",
      (source) => {
        source.positiveControl.files.push({ ...extension(source) });
        rehashVariant(source);
        return source;
      },
    ],
    [
      "unbounded additional content",
      (source) => ({ ...source, extra: "x".repeat(1024 * 1024) }),
    ],
    [
      "JSON text instead of the closed object",
      (source) => JSON.stringify(source),
    ],
  ];
  it.each(mutations)(
    "denies %s without returning source in the error",
    (_name, mutate) => {
      const source = createProductionRepairSeedSourceV1();
      const input = mutate(source);
      if (_name === "unbounded additional content") {
        expect(readProductionRepairSeedSourceV1(source)).toEqual(source);
        expect(
          new TextEncoder().encode(JSON.stringify(input)).byteLength,
        ).toBeGreaterThan(REPAIR_SEED_SOURCE_MAX_BYTES);
        const parse = vi.spyOn(productionRepairSeedSourceV1Schema, "parse");
        try {
          expect(() => readProductionRepairSeedSourceV1(input)).toThrow(
            ProductionRepairSeedSourceError,
          );
          expect(() => readProductionRepairSeedSourceV1(input)).toThrow(
            "The fixed unvalidated repair source is unavailable.",
          );
          expect(parse).not.toHaveBeenCalled();
        } finally {
          parse.mockRestore();
        }
        return;
      }
      expect(() => readProductionRepairSeedSourceV1(input)).toThrow(
        "The fixed unvalidated repair source is unavailable.",
      );
    },
  );
});
