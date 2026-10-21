import { materializeHostRepairSuccessorPatchV4 } from "@cloudmarkup/ai-extension-generation";
import { applicationBuildSourceTreeDigest } from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidatePolicyV1Schema,
  applicationHostRepairSuccessorBuildRequestV2Schema,
  applicationHostRepairSuccessorLineageV2Schema,
  createApplicationHostRepairSuccessorRunner,
  inspectApplicationHostRepairCandidateResultV1,
  inspectApplicationHostRepairSuccessorResultV2,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  normalizeModelHostRepairSuccessorUsageV4,
  serializedByteLength,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue as digest,
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  normalizedModelUsageV1Schema,
  utcTimestampSchema,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import { modelLiveSeedValidationReceiptV1Schema } from "./adapters/persistence/model-live-seed-validation-codec.js";
import { createProductionSeedBuildInput } from "./production-model-live-seed-build-input.js";
import { createProductionSeedCandidateBuildInput } from "./production-model-live-seed-candidate-build-input.js";
import {
  createProductionSeedCandidateValidationHost,
  type ProductionSeedCandidateHostConfiguration,
} from "./production-model-live-seed-candidate-host.js";
import { createProductionSeedValidationHost } from "./production-model-live-seed-validation-host.js";
import { prepareProductionRepairSuccessorInput } from "./production-model-live-repair-successor-input.js";

export class ProductionRepairSuccessorHostError extends Error {
  readonly code = "model-live.repair-successor-validation-unavailable";
  constructor() {
    super("The bound final repair validation is unavailable.");
    this.name = "ProductionRepairSuccessorHostError";
  }
}
function exact(value: boolean): asserts value {
  if (!value) throw new ProductionRepairSuccessorHostError();
}
function checkCancellation(signal: AbortSignal | undefined): void {
  exact(signal?.aborted !== true);
}
const same = (a: unknown, b: unknown) => digest(a) === digest(b);

/** Private RAM-only composition. The current authenticated journal must own the
 * supplied actual first outcome and final provider response. No caller grade,
 * financial mutation, receipt issuance or model dispatch occurs in this host. */
export function createProductionRepairSuccessorValidationHost(
  input: ProductionSeedCandidateHostConfiguration,
) {
  const seed = createProductionSeedValidationHost(input.seed);
  const predecessorConfigurationDigest =
    createProductionSeedCandidateValidationHost(input).configurationDigest;
  const admission = structuredClone(input.seed.admission);
  const policy = applicationHostRepairCandidatePolicyV1Schema.parse(
    input.policy,
  );
  const executor = { open: input.executor.open.bind(input.executor) };
  const now = input.now ?? (() => new Date());
  const configurationDigest = repairSuccessorHostConfigurationDigest(
    predecessorConfigurationDigest,
  );
  return {
    configurationDigest,
    async run(
      raw: {
        readonly seedReceipt: unknown;
        readonly predecessor: Parameters<
          typeof prepareProductionRepairSuccessorInput
        >[0];
        readonly invocation: ModelProviderHostRepairSuccessorInvocationV4;
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
        const descriptor =
          modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse(
            raw.invocation.descriptor,
          );
        const request = modelHostRepairSuccessorRequestV3Schema.parse(
          raw.invocation.request,
        );
        const maximumOutputBytes = raw.invocation.maximumOutputBytes;
        exact(
          Number.isSafeInteger(maximumOutputBytes) &&
            maximumOutputBytes > 0 &&
            maximumOutputBytes <= 4 * 1024 * 1024 &&
            serializedByteLength(raw.providerResult.content) <=
              maximumOutputBytes,
        );
        // Copy all RAM data before any asynchronous isolation check.
        const providerResult = structuredClone(raw.providerResult);
        const predecessor = structuredClone(raw.predecessor);
        const derived = prepareProductionRepairSuccessorInput(predecessor);
        const usage = normalizedModelUsageV1Schema.parse(raw.usage);
        exact(
          same(request, derived.request) &&
            same(descriptor.scope, predecessor.invocation.descriptor.scope) &&
            descriptor.inputDigest ===
              digest({ request, scope: descriptor.scope }) &&
            predecessor.first.host.configurationDigest ===
              predecessorConfigurationDigest &&
            predecessor.first.host.seedReceiptDigest ===
              receipt.receiptDigest &&
            usage.result === "succeeded" &&
            Date.parse(usage.startedAt) >=
              Date.parse(predecessor.recorded.outcome.observedAt) &&
            same(
              usage,
              normalizeModelHostRepairSuccessorUsageV4({
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
        exact(same(restored.request, predecessor.invocation.request));
        const first = createProductionSeedCandidateBuildInput({
          seed: createProductionSeedBuildInput(admission, receipt.startedAt),
          policy,
          candidate: predecessor.first.host.candidate,
          assessedAt: predecessor.first.host.startedAt,
        });
        const observed = inspectApplicationHostRepairCandidateResultV1(
          predecessor.first.host.observation,
          first.build,
          first.config,
        );
        const assessedAt = utcTimestampSchema.parse(now().toISOString());
        exact(Date.parse(assessedAt) >= Date.parse(usage.completedAt));
        const candidate = materializeHostRepairSuccessorPatchV4({
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
        const lineage = applicationHostRepairSuccessorLineageV2Schema.parse({
          baseDigest: candidate.baseDigest,
          inputDigest: candidate.inputDigest,
          invocationId: candidate.invocationId,
          patchDigest: candidate.patchDigest,
          responseDigest: candidate.responseDigest,
          predecessorRequestDigest: observed.bindings.requestDigest,
          predecessorReportDigest: observed.reportDigest,
          predecessorLineageDigest: observed.bindings.repairLineageDigest,
        });
        const files = first.build.source.files.map((file) =>
          file.path === candidate.path
            ? {
                ...file,
                content: candidate.content,
                checksum: candidate.digest,
              }
            : file,
        );
        const build = applicationHostRepairSuccessorBuildRequestV2Schema.parse({
          ...first.build,
          contractVersion: 2,
          assessedAt,
          source: {
            ...first.build.source,
            origin: "model-successor-of-host-repair",
            lineage,
            files,
            extensionContentDigest: candidate.digest,
            sourceTreeDigest: applicationBuildSourceTreeDigest(files),
          },
        });
        const config = {
          predecessor: first.config,
          predecessorRequest: first.build,
          predecessorResult: observed,
          lineage,
        };
        const runner = createApplicationHostRepairSuccessorRunner({
          executor,
          config,
        });
        const observation = inspectApplicationHostRepairSuccessorResultV2(
          await runner.run(build, signal === undefined ? {} : { signal }),
          build,
          config,
        );
        checkCancellation(signal);
        const completedAt = utcTimestampSchema.parse(now().toISOString());
        exact(Date.parse(completedAt) >= Date.parse(assessedAt));
        return {
          startedAt: assessedAt,
          completedAt,
          authority: "ram-only-unissued-successor-validation" as const,
          configurationDigest,
          seedReceiptDigest: receipt.receiptDigest,
          predecessorOutcomeDigest: derived.predecessorOutcomeDigest,
          predecessorValidationReceiptDigest:
            derived.predecessorValidationReceiptDigest,
          providerResultDigest: digest(providerResult),
          usageRecordId: usage.usageRecordId,
          usageDigest: digest(usage),
          candidate,
          observation,
        };
      } catch {
        throw new ProductionRepairSuccessorHostError();
      }
    },
  };
}

/** The final host configuration is explicitly derived from the fixed first host. */
export function repairSuccessorHostConfigurationDigest(
  predecessorConfigurationDigest: string,
) {
  return digest({
    kind: "cloudmarkup.host-repair-successor-validation",
    contractVersion: 2,
    predecessorConfigurationDigest,
    maximumPatchHunks: 32,
  });
}
