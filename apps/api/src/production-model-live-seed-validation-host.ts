import { createProductionSeedBuildInput } from "./production-model-live-seed-build-input.js";
import { modelLiveSeedValidationReceiptV1Schema } from "./adapters/persistence/model-live-seed-validation-codec.js";
import type { ApplicationBuildWorkspaceExecutor } from "@cloudmarkup/application-build-runner";
import {
  HOST_REPAIR_SEED_RECIPE_ID,
  HOST_REPAIR_SEED_RECIPE_VERSION,
  createApplicationHostRepairSeedRunner,
  inspectApplicationHostRepairSeedResultV1,
  inspectApplicationHostRepairSeedRequestV1,
  type ApplicationHostRepairSeedAdmissionConfig,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  digestCanonicalValue,
  modelLiveRepairCaseV3Schema,
  modelHostSeedRepairRequestV2Schema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import { bindProductionRepairSeedCaseV1 } from "./production-model-live-repair-seed-source.js";

export interface ProductionSeedValidationHostConfiguration {
  readonly admission: Omit<
    ApplicationHostRepairSeedAdmissionConfig,
    "definition"
  >;
  readonly executor: ApplicationBuildWorkspaceExecutor;
  /** Trusted native host preflight; must verify the existing RAM/no-swap policy.
   * Tests may use fake sessions, which never establish native execution proof. */
  assertHostIsolation(signal?: AbortSignal): Promise<void>;
}
export class ProductionSeedValidationHostError extends Error {
  constructor() {
    super("The fixed seed validation observation is unavailable.");
    this.name = "ProductionSeedValidationHostError";
  }
}
function requireObservation(value: boolean): asserts value {
  if (!value) throw new ProductionSeedValidationHostError();
}

function checkCancellation(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new ProductionSeedValidationHostError();
}

/** Owns the fixed source and runner call. No caller source, result or grade is
 * accepted. This returns content-free tool observation, not a tenant receipt.
 * No production registration or authority follows from constructing this host. */
export function createProductionSeedValidationHost(
  input: ProductionSeedValidationHostConfiguration,
) {
  const admission = structuredClone(input.admission);
  const executor = { open: input.executor.open.bind(input.executor) };
  const assertHostIsolation = input.assertHostIsolation.bind(input);
  const configurationDigest = digestCanonicalValue({
    admission,
    recipeId: HOST_REPAIR_SEED_RECIPE_ID,
    recipeVersion: HOST_REPAIR_SEED_RECIPE_VERSION,
  });
  async function prepare(
    rawCaseId: unknown,
    rawAssessedAt: unknown,
    signal?: AbortSignal,
  ) {
    const caseId = modelLiveRepairCaseV3Schema.parse(rawCaseId);
    const assessedAt = utcTimestampSchema.parse(rawAssessedAt);
    checkCancellation(signal);
    await assertHostIsolation(signal);
    checkCancellation(signal);
    // The case binder also reconstructs the fixed source, so both calls
    // deliberately follow native host admission.
    const caseBinding = bindProductionRepairSeedCaseV1(caseId);
    const { request, config } = createProductionSeedBuildInput(
      admission,
      assessedAt,
    );
    const admitted = inspectApplicationHostRepairSeedRequestV1(request, config);
    const metadata = {
      configurationDigest,
      caseBinding,
      assessedAt,
      ownershipDigest: digestCanonicalValue(
        request.solutionRevision.sourceOwnership,
      ),
      profileDigest: admission.policy.profile.digest,
      toolchainDigest: digestCanonicalValue(admission.policy.toolchain),
      builderDigest: admission.policy.builder.digest,
      scannerDigest: admission.policy.scanner.digest,
      bindings: admitted.bindings,
    };
    return { request, config, metadata };
  }
  return {
    configurationDigest,
    /** Reconstructs current fixed bindings after native admission. This is not execution evidence. */
    async inspect(
      rawCaseId: unknown,
      rawAssessedAt: unknown,
      signal?: AbortSignal,
    ) {
      try {
        const { metadata } = await prepare(rawCaseId, rawAssessedAt, signal);
        checkCancellation(signal);
        return { authority: "unissued-source-admission" as const, ...metadata };
      } catch {
        throw new ProductionSeedValidationHostError();
      }
    },
    /** Reconstructs RAM-only first-repair bytes from the fixed source and a
     * structurally matching receipt. The authenticated adapter must separately
     * restore current issued authority before and after this call. */
    async prepareRepairInput(
      rawReceipt: unknown,
      rawRequestedMode: unknown,
      signal?: AbortSignal,
    ) {
      try {
        const receipt =
          modelLiveSeedValidationReceiptV1Schema.parse(rawReceipt);
        const requestedMode =
          modelHostSeedRepairRequestV2Schema.shape.requestedMode.parse(
            rawRequestedMode,
          );
        const {
          request: buildRequest,
          config,
          metadata,
        } = await prepare(receipt.caseId, receipt.startedAt, signal);
        const equal = (left: unknown, right: unknown) =>
          digestCanonicalValue(left) === digestCanonicalValue(right);
        requireObservation(
          equal(receipt.bindings, metadata.bindings) &&
            receipt.caseDigest === metadata.caseBinding.caseDigest &&
            receipt.frozenInputDigest ===
              metadata.caseBinding.frozenInputDigest &&
            receipt.datasetDigest ===
              metadata.caseBinding.dataset.datasetDigest &&
            receipt.bindings.recipeDigest ===
              metadata.caseBinding.recipeDigest &&
            receipt.configurationDigest === metadata.configurationDigest &&
            receipt.ownershipDigest === metadata.ownershipDigest &&
            receipt.profileDigest === metadata.profileDigest &&
            receipt.toolchainDigest === metadata.toolchainDigest &&
            receipt.builderDigest === metadata.builderDigest &&
            receipt.scannerDigest === metadata.scannerDigest,
        );
        const file = buildRequest.source.files.find(
          (value) => value.path === buildRequest.source.extensionPath,
        );
        const compiler = config.policy.toolchain.find(
          (value) => value.id === "compiler.typescript",
        );
        requireObservation(file !== undefined && compiler !== undefined);
        const candidateId = "host_repair_seed_file";
        const failedCandidates = [
          {
            candidateId,
            content: file.content,
            contentDigest: file.checksum,
            encoding: "utf-8" as const,
            kind: "file" as const,
            ownership: "user-owned" as const,
            sourceAuthority: "fixed-host-synthetic" as const,
            path: file.path,
          },
        ];
        const request = modelHostSeedRepairRequestV2Schema.parse({
          contractVersion: 2,
          operation: "candidate.repair",
          requestedMode,
          currentAttempt: 1,
          maximumRepairAttempts: 2,
          boundary: {
            approvalPathIds: ["cloudmarkup.host-seed-repair"],
            boundaryId: "host_repair_seed",
            ownedPaths: [file.path],
            writeAuthority: "candidate-artifacts-only",
          },
          failedCandidates,
          failedCandidatesCanonicalization:
            "cloudmarkup.model-host-seed-files.canonical-json.v2",
          failedOutputDigest: digestCanonicalValue(failedCandidates),
          diagnostics: [
            {
              candidateId,
              diagnosticId: "host_repair_seed_ts2322",
              path: file.path,
              checkKind: "build",
              toolId: compiler.id,
              toolVersion: compiler.version,
              message:
                "The fixed TypeScript checker observed TS2322 in this file.",
              noSecretValues: true,
              redactionStatus: "not-required",
            },
          ],
          validationExpectations: [
            {
              checkId: "cloudmarkup.repair-seed.typecheck",
              kind: "build",
              required: true,
              successCondition: "must-pass",
              toolProfileId: config.policy.profile.id,
            },
          ],
          hostSeed: {
            recipeId: receipt.recipeId,
            recipeVersion: receipt.recipeVersion,
            recipeDigest: receipt.bindings.recipeDigest,
            sourceTreeDigest: receipt.bindings.sourceTreeDigest,
            solutionRevisionDigest: receipt.bindings.solutionRevisionDigest,
            ownershipDigest: receipt.ownershipDigest,
            seedValidationReceiptDigest: receipt.receiptDigest,
          },
        });
        checkCancellation(signal);
        return {
          authority: "unissued-repair-input" as const,
          configurationDigest,
          receiptDigest: receipt.receiptDigest,
          inputDigest: digestCanonicalValue(request),
          request,
        };
      } catch {
        throw new ProductionSeedValidationHostError();
      }
    },
    async run(
      rawCaseId: unknown,
      rawAssessedAt: unknown,
      signal?: AbortSignal,
    ) {
      try {
        const { request, config, metadata } = await prepare(
          rawCaseId,
          rawAssessedAt,
          signal,
        );
        const runner = createApplicationHostRepairSeedRunner({
          config,
          executor,
        });
        const observation = inspectApplicationHostRepairSeedResultV1(
          await runner.run(request, signal === undefined ? {} : { signal }),
          request,
          config,
        );
        checkCancellation(signal);
        requireObservation(
          observation.state === "failed" &&
            observation.cleanup === "verified" &&
            observation.reproducibility.state === "not-established" &&
            observation.steps.length === 3 &&
            observation.steps[0]?.step === "install" &&
            observation.steps[0].state === "passed" &&
            observation.steps[1]?.step === "lint" &&
            observation.steps[1].state === "passed" &&
            observation.steps[2]?.step === "typecheck" &&
            observation.steps[2].state === "failed" &&
            observation.diagnostics.length === 1 &&
            observation.diagnostics[0]?.code ===
              "application.host-repair-seed.observed-ts2322" &&
            observation.diagnostics[0].references.path ===
              config.definition.extensionPath &&
            observation.tests.length === 0 &&
            observation.findings.length === 0 &&
            observation.artifacts.length === 0,
        );
        return {
          authority: "unissued-tool-observation" as const,
          ...metadata,
          reportDigest: observation.reportDigest,
        };
      } catch {
        throw new ProductionSeedValidationHostError();
      }
    },
  };
}
