import { generateApplication } from "@cloudmarkup/application-generator";
import {
  applicationBuildSourceFileV1Schema,
  applicationBuildSourceTreeDigest,
  sha256Digest,
  type ApplicationBuildSourceFileV1,
} from "@cloudmarkup/application-build-runner";
import { frozenFullBetaEvaluationDatasetV1 } from "@cloudmarkup/model-gateway";
import {
  applicationGenerationRequestV1Schema,
  digestCanonicalValue,
  modelEvaluationDatasetV1Schema,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import { z } from "zod";
import {
  createRepairSeedGenerationRequestV1,
  REPAIR_SEED_EXTENSION_PATH,
  REPAIR_SEED_WORKLOAD_ID,
} from "./production-model-live-repair-seed-definition.js";
import {
  ProductionRepairSeedSourceError,
  productionRepairSeedSourceV1Schema,
  REPAIR_SEED_CONTROL_SUFFIX,
  REPAIR_SEED_INVALID_SUFFIX,
  REPAIR_SEED_RECIPE_ID,
  REPAIR_SEED_RECIPE_VERSION,
  REPAIR_SEED_SOURCE_MAX_BYTES,
  type FixedHostSeedVariantV1,
  type ProductionRepairSeedSourceV1,
} from "./production-model-live-repair-seed-source-codec.js";

const caseIdSchema = z.enum([
  "evaluation_case_repair_success_full_beta_v1",
  "evaluation_case_repair_exhaustion_full_beta_v1",
]);
const requireSource = (value: boolean): void => {
  if (!value) throw new ProductionRepairSeedSourceError();
};
function checked<T>(work: () => T): T {
  try {
    return work();
  } catch {
    throw new ProductionRepairSeedSourceError();
  }
}
function bounded<T>(value: T): T {
  requireSource(
    new TextEncoder().encode(JSON.stringify(value)).length <=
      REPAIR_SEED_SOURCE_MAX_BYTES,
  );
  return value;
}
function recipeDigest(generationRequest: unknown) {
  return digestCanonicalValue({
    id: REPAIR_SEED_RECIPE_ID,
    version: REPAIR_SEED_RECIPE_VERSION,
    origin: "fixed-host-synthetic",
    generationRequestDigest: digestCanonicalValue(generationRequest),
    extensionPath: REPAIR_SEED_EXTENSION_PATH,
    positiveControlSuffixDigest: sha256Digest(REPAIR_SEED_CONTROL_SUFFIX),
    invalidSeedSuffixDigest: sha256Digest(REPAIR_SEED_INVALID_SUFFIX),
    predictedDiagnostic: {
      source: "typescript",
      code: "TS2322",
      path: REPAIR_SEED_EXTENSION_PATH,
    },
    observedValidation: "none",
  });
}

let fixedSource: ProductionRepairSeedSourceV1 | undefined;

/** No source/configuration/authority arguments; no I/O, model, build or receipt. */
export function createProductionRepairSeedSourceV1(): ProductionRepairSeedSourceV1 {
  // The recipe has only module-owned, versioned inputs. Keep its validated
  // scaffold private and give every caller detached data; no admission, clock,
  // tenant, execution result or configured source is cached.
  fixedSource ??= buildFixedSource();
  return structuredClone(fixedSource);
}

function buildFixedSource(): ProductionRepairSeedSourceV1 {
  return checked(() => {
    const initialRequest = createRepairSeedGenerationRequestV1();
    const initial = generateApplication(initialRequest);
    const original = initial.artifact.sourceFiles.find(
      (file) => file.path === REPAIR_SEED_EXTENSION_PATH,
    );
    if (
      original === undefined ||
      !("content" in original) ||
      typeof original.content !== "string" ||
      original.ownership !== "user-owned"
    )
      throw new ProductionRepairSeedSourceError();
    const generationRequest = applicationGenerationRequestV1Schema.parse({
      ...initialRequest,
      solutionRevision: solutionRevisionManifestV1Schema.parse({
        ...initialRequest.solutionRevision,
        sourceOwnership: [
          {
            path: REPAIR_SEED_EXTENSION_PATH,
            contentHash: original.checksum,
            ownership: "user-owned",
            ownerId: "repair_seed.owner",
            conflictBehavior: "preserve-user-content",
          },
        ],
      }),
    });
    const deterministicScaffold = generateApplication(generationRequest);
    requireSource(
      deterministicScaffold.artifact.diagnostics.every(
        (item) => item.severity !== "error",
      ),
    );
    const contract = deterministicScaffold.artifact.workloadContracts[0];
    requireSource(
      deterministicScaffold.artifact.workloadContracts.length === 1 &&
        contract?.workloadId === REPAIR_SEED_WORKLOAD_ID &&
        contract.implementationMode === "generated-starter",
    );
    const baselineFiles = deterministicScaffold.artifact.sourceFiles
      .map((file): ApplicationBuildSourceFileV1 => {
        if (!("content" in file) || typeof file.content !== "string")
          throw new ProductionRepairSeedSourceError();
        return applicationBuildSourceFileV1Schema.parse({
          path: file.path,
          ownership: file.ownership,
          mediaType: file.mediaType,
          content: file.content,
          checksum: file.checksum,
        });
      })
      .sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      );
    requireSource(
      baselineFiles.filter((file) => file.ownership !== "generated").length ===
        1,
    );
    const baseline = baselineFiles.find(
      (file) => file.path === REPAIR_SEED_EXTENSION_PATH,
    );
    requireSource(
      baseline?.content === original.content &&
        baseline.checksum === original.checksum,
    );
    const variant = (
      name: FixedHostSeedVariantV1["variant"],
      suffix: string,
    ): FixedHostSeedVariantV1 => {
      const files = baselineFiles.map((file) => {
        if (file.path !== REPAIR_SEED_EXTENSION_PATH) return { ...file };
        const content = file.content + suffix;
        return { ...file, content, checksum: sha256Digest(content) };
      });
      const extension = files.find(
        (file) => file.path === REPAIR_SEED_EXTENSION_PATH,
      );
      if (extension === undefined) throw new ProductionRepairSeedSourceError();
      return {
        variant: name,
        files,
        sourceTreeDigest: applicationBuildSourceTreeDigest(files),
        extensionContentDigest: extension.checksum,
      };
    };
    return productionRepairSeedSourceV1Schema.parse(
      bounded({
        kind: "cloudmarkup.model-live.repair-seed-source.v1",
        origin: "fixed-host-synthetic",
        authority: "unvalidated-source-only",
        recipe: {
          id: REPAIR_SEED_RECIPE_ID,
          version: REPAIR_SEED_RECIPE_VERSION,
          digest: recipeDigest(generationRequest),
        },
        generationRequest,
        deterministicScaffold,
        extensionPath: REPAIR_SEED_EXTENSION_PATH,
        baselineSourceDigest: applicationBuildSourceTreeDigest(baselineFiles),
        positiveControl: variant(
          "positive-control",
          REPAIR_SEED_CONTROL_SUFFIX,
        ),
        invalidSeed: variant("invalid-seed", REPAIR_SEED_INVALID_SUFFIX),
      }),
    );
  });
}

/** Strict source restoration compares actual configured bytes; rehashing a caller
 * alternative never changes the reviewed recipe. It issues no authority. */
export function readProductionRepairSeedSourceV1(
  raw: unknown,
): ProductionRepairSeedSourceV1 {
  return checked(() => {
    const cloned: unknown = structuredClone(raw);
    const parsed = productionRepairSeedSourceV1Schema.parse(bounded(cloned));
    const expected = createProductionRepairSeedSourceV1();
    requireSource(
      digestCanonicalValue(parsed) === digestCanonicalValue(expected),
    );
    return parsed;
  });
}

/** Case identity stays distinct from host recipe/source; no frozen input edits. */
export function bindProductionRepairSeedCaseV1(
  rawCaseId: z.input<typeof caseIdSchema>,
) {
  return checked(() => {
    const caseId = caseIdSchema.parse(rawCaseId);
    const dataset = modelEvaluationDatasetV1Schema.parse(
      frozenFullBetaEvaluationDatasetV1,
    );
    const selected = dataset.cases.find((entry) => entry.caseId === caseId);
    if (selected === undefined) throw new ProductionRepairSeedSourceError();
    requireSource(
      selected.caseKind ===
        (caseId === "evaluation_case_repair_success_full_beta_v1"
          ? "repair-success"
          : "repair-exhaustion") &&
        selected.input.repositoryFixtures.length === 0,
    );
    const source = createProductionRepairSeedSourceV1();
    return {
      dataset: {
        datasetId: dataset.datasetId,
        datasetVersion: dataset.datasetVersion,
        datasetDigest: dataset.datasetDigest,
      },
      caseId,
      caseDigest: selected.caseDigest,
      frozenInputDigest: digestCanonicalValue(selected.input),
      recipeDigest: source.recipe.digest,
    };
  });
}
