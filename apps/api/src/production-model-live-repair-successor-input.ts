import {
  digestCanonicalValue as digest,
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  modelLiveSequenceOutcomeV4Schema,
  sha256Text,
} from "@cloudmarkup/schemas";
import type { ModelProviderHostSeedInvocationV3 } from "@cloudmarkup/model-gateway";
import {
  modelLiveSeedCandidateReceiptV1Schema,
  prepareFirstSeedCandidateOutcomeV4,
} from "./adapters/persistence/model-live-seed-candidate-codec.js";

export class ProductionRepairSuccessorInputError extends Error {
  readonly code = "model-live.repair-successor-input-unavailable";
  constructor() {
    super("The exact prior repair candidate is unavailable.");
    this.name = "ProductionRepairSuccessorInputError";
  }
}
function requireInput(value: boolean): asserts value {
  if (!value) throw new ProductionRepairSuccessorInputError();
}
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
type FirstObservation = Parameters<
  typeof prepareFirstSeedCandidateOutcomeV4
>[0];

/** Pure RAM-only derivation, not an issuer. The enclosing private sequence host
 * must authenticate the stored predecessor and current tenant/approval before
 * issuing a second input. No caller grade, restart from seed, or third attempt. */
export function prepareProductionRepairSuccessorInput(input: {
  readonly invocation: ModelProviderHostSeedInvocationV3;
  readonly first: FirstObservation;
  readonly recorded: ReturnType<typeof prepareFirstSeedCandidateOutcomeV4>;
}) {
  try {
    const first = structuredClone(input.first);
    const invocation = structuredClone(input.invocation);
    const request = modelHostSeedRepairRequestV2Schema.parse(
      invocation.request,
    );
    const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
      invocation.descriptor,
    );
    const receipt = modelLiveSeedCandidateReceiptV1Schema.parse(
      input.recorded.receipt,
    );
    const outcome = modelLiveSequenceOutcomeV4Schema.parse(
      input.recorded.outcome,
    );
    const projected = prepareFirstSeedCandidateOutcomeV4(first);
    requireInput(
      same(receipt, projected.receipt) && same(outcome, projected.outcome),
    );
    requireInput(
      receipt.disposition === "invalid-repairable" &&
        receipt.observedDefect === "TS2322" &&
        outcome.status === "validated" &&
        outcome.validation.status === "invalid" &&
        outcome.validation.repairable,
    );
    const source = request.failedCandidates[0];
    const candidate = first.host.candidate;
    requireInput(source !== undefined);
    requireInput(
      descriptor.inputDigest === digest({ request, scope: descriptor.scope }) &&
        descriptor.inputDigest === receipt.lineage.inputDigest &&
        descriptor.invocationId === receipt.invocationId &&
        descriptor.scope.organizationId === receipt.scope.organizationId &&
        descriptor.scope.projectId === receipt.scope.projectId &&
        descriptor.scope.userId === receipt.scope.userId &&
        request.hostSeed.seedValidationReceiptDigest ===
          receipt.seedReceiptDigest &&
        request.hostSeed.solutionRevisionDigest ===
          receipt.bindings.solutionRevisionDigest &&
        source.path === candidate.path &&
        source.contentDigest === candidate.baseDigest &&
        candidate.digest === sha256Text(candidate.content) &&
        candidate.digest === receipt.bindings.extensionContentDigest &&
        same(candidate.ownership, "user-owned-preserved") &&
        same(candidate.sourceAuthority, "unaccepted-model-repair") &&
        Buffer.byteLength(candidate.content, "utf8") <= 1024 * 1024,
    );
    const failedCandidates = [
      {
        candidateId: source.candidateId,
        kind: "file" as const,
        encoding: candidate.encoding,
        path: candidate.path,
        content: candidate.content,
        contentDigest: candidate.digest,
        ownership: candidate.ownership,
        sourceAuthority: candidate.sourceAuthority,
      },
    ];
    const successor = modelHostRepairSuccessorRequestV3Schema.parse({
      ...request,
      contractVersion: 3,
      currentAttempt: 2,
      failedCandidates,
      failedCandidatesCanonicalization:
        "cloudmarkup.model-host-repair-successor-files.canonical-json.v3",
      failedOutputDigest: digest(failedCandidates),
      diagnostics: request.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        diagnosticId: "host_repair_successor_ts2322",
        message:
          "The fixed TypeScript checker observed TS2322 in this prior repair candidate.",
      })),
      predecessor: {
        stageId: receipt.stageId,
        invocationId: receipt.invocationId,
        inputDigest: receipt.lineage.inputDigest,
        responseDigest: receipt.lineage.responseDigest,
        sourceTreeDigest: receipt.bindings.sourceTreeDigest,
        contentDigest: receipt.bindings.extensionContentDigest,
        validationReceiptDigest: receipt.receiptDigest,
        outcomeDigest: outcome.outcomeDigest,
      },
    });
    return {
      authority: "ram-only-unissued-repair-successor" as const,
      request: successor,
      inputDigest: digest(successor),
      predecessorOutcomeDigest: outcome.outcomeDigest,
      predecessorValidationReceiptDigest: receipt.receiptDigest,
    };
  } catch {
    throw new ProductionRepairSuccessorInputError();
  }
}
