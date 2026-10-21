import { createProductionSeedCandidateBuildInput } from "./production-model-live-seed-candidate-build-input.js";
import {
  materializeHostSeedRepairCandidateV3,
  materializeHostSeedRepairPatchV2,
} from "@cloudmarkup/ai-extension-generation";
import type { ApplicationBuildWorkspaceExecutor } from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidatePolicyV1Schema,
  createApplicationHostRepairCandidateRunner,
  inspectApplicationHostRepairCandidateResultV1,
  type ApplicationHostRepairCandidatePolicyV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  normalizeModelHostSeedUsageV3,
  resolveReviewedHostPatchRepairPromptV3,
  serializedByteLength,
  type ModelProviderHostSeedInvocationV3,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue,
  modelHostSeedRepairRequestV2Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  normalizedModelUsageV1Schema,
  utcTimestampSchema,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { modelLiveSeedValidationReceiptV1Schema } from "./adapters/persistence/model-live-seed-validation-codec.js";
import { createProductionSeedBuildInput } from "./production-model-live-seed-build-input.js";
import {
  createProductionSeedValidationHost,
  type ProductionSeedValidationHostConfiguration,
} from "./production-model-live-seed-validation-host.js";

export interface ProductionSeedCandidateHostConfiguration {
  readonly seed: ProductionSeedValidationHostConfiguration;
  readonly policy: ApplicationHostRepairCandidatePolicyV1;
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly now?: () => Date;
}
export class ProductionSeedCandidateHostError extends Error {
  readonly code = "model-live.seed-candidate-validation-unavailable";
  constructor() {
    super("The bound seed candidate validation is unavailable.");
    this.name = "ProductionSeedCandidateHostError";
  }
}
function requireCandidate(value: boolean): asserts value {
  if (!value) throw new ProductionSeedCandidateHostError();
}
function checkCancellation(signal: AbortSignal | undefined): void {
  requireCandidate(signal?.aborted !== true);
}
const same = (a: unknown, b: unknown) =>
  digestCanonicalValue(a) === digestCanonicalValue(b);

/** Private RAM-only host composition. It owns source restoration, exact patch
 * materialization and the actual runner call. It accepts no caller grade or
 * validator report. Authentication, journal issuance and original response
 * provenance must be supplied by the enclosing current-stage host; this object
 * never issues a receipt, settles credits, dispatches a model or writes files. */
export function createProductionSeedCandidateValidationHost(
  input: ProductionSeedCandidateHostConfiguration,
) {
  const seed = createProductionSeedValidationHost(input.seed);
  const admission = structuredClone(input.seed.admission);
  const policy = applicationHostRepairCandidatePolicyV1Schema.parse(
    input.policy,
  );
  const executor = { open: input.executor.open.bind(input.executor) };
  const now = input.now ?? (() => new Date());
  const configurationDigest = digestCanonicalValue({
    kind: "cloudmarkup.host-seed-candidate-validation",
    contractVersion: 1,
    seedConfigurationDigest: seed.configurationDigest,
    policy,
    maximumPatchHunks: 32,
  });
  return {
    configurationDigest,
    async run(
      raw: {
        readonly seedReceipt: unknown;
        readonly invocation: ModelProviderHostSeedInvocationV3;
        readonly providerResult: ModelProviderResultV1;
        readonly usage: NormalizedModelUsageV1;
      },
      signal?: AbortSignal,
    ) {
      try {
        checkCancellation(signal);
        const receipt = modelLiveSeedValidationReceiptV1Schema.parse(
          raw.seedReceipt,
        );
        const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
          raw.invocation.descriptor,
        );
        const request = modelHostSeedRepairRequestV2Schema.parse(
          raw.invocation.request,
        );
        const usage = normalizedModelUsageV1Schema.parse(raw.usage);
        requireCandidate(
          descriptor.scope.organizationId === receipt.scope.organizationId &&
            descriptor.scope.projectId === receipt.scope.projectId &&
            descriptor.scope.userId === receipt.scope.userId,
        );
        const maximumOutputBytes = raw.invocation.maximumOutputBytes;
        requireCandidate(
          Number.isSafeInteger(maximumOutputBytes) &&
            maximumOutputBytes > 0 &&
            maximumOutputBytes <= 4 * 1024 * 1024 &&
            serializedByteLength(raw.providerResult.content) <=
              maximumOutputBytes,
        );
        const providerResult = structuredClone(raw.providerResult);
        requireCandidate(
          usage.result === "succeeded" &&
            Date.parse(usage.startedAt) >= Date.parse(receipt.completedAt) &&
            same(
              usage,
              normalizeModelHostSeedUsageV3({
                descriptor,
                providerUsage: providerResult.usage,
                result: "succeeded",
                startedAtMilliseconds: Date.parse(usage.startedAt),
                completedAtMilliseconds: Date.parse(usage.completedAt),
              }),
            ),
        );
        const restored = await seed.prepareRepairInput(
          receipt,
          request.requestedMode,
          signal,
        );
        checkCancellation(signal);
        requireCandidate(same(restored.request, request));
        const { request: seedRequest, config: seedConfig } =
          createProductionSeedBuildInput(admission, receipt.startedAt);
        const assessedAt = utcTimestampSchema.parse(now().toISOString());
        requireCandidate(
          Date.parse(assessedAt) >= Date.parse(usage.completedAt),
        );
        const materialize =
          resolveReviewedHostPatchRepairPromptV3(descriptor) !== null
            ? materializeHostSeedRepairPatchV2
            : materializeHostSeedRepairCandidateV3;
        const candidate = materialize({
          descriptor,
          request,
          content: providerResult.content,
          maximumOutputBytes,
          allowedApprovalPathIds: new Set(["cloudmarkup.host-seed-repair"]),
          limits: {
            maximumFileBytes: policy.defaultLimits.maxFileBytes,
            maximumPatchHunks: 32,
          },
        });
        const { build, config } = createProductionSeedCandidateBuildInput({
          seed: { request: seedRequest, config: seedConfig },
          policy,
          candidate,
          assessedAt,
        });
        const runner = createApplicationHostRepairCandidateRunner({
          executor,
          config,
        });
        const observation = inspectApplicationHostRepairCandidateResultV1(
          await runner.run(build, signal === undefined ? {} : { signal }),
          build,
          config,
        );
        checkCancellation(signal);
        const completedAt = utcTimestampSchema.parse(now().toISOString());
        requireCandidate(Date.parse(completedAt) >= Date.parse(assessedAt));
        return {
          startedAt: assessedAt,
          completedAt,
          authority: "ram-only-unissued-candidate-validation" as const,
          configurationDigest,
          seedReceiptDigest: receipt.receiptDigest,
          providerResultDigest: digestCanonicalValue(providerResult),
          usageRecordId: usage.usageRecordId,
          usageDigest: digestCanonicalValue(usage),
          candidate,
          observation,
        };
      } catch {
        throw new ProductionSeedCandidateHostError();
      }
    },
  };
}
