import { repairSuccessorHostConfigurationDigest } from "../../production-model-live-repair-successor-host.js";
import { z } from "zod";
import {
  applicationHostRepairSuccessorBuildResultV2Schema,
  applicationHostRepairSuccessorLineageV2Schema,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  digestCanonicalValue as digest,
  modelLiveEvaluationScopeV2Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  normalizedModelUsageV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import type { createProductionRepairSuccessorValidationHost } from "../../production-model-live-repair-successor-host.js";
import {
  modelLiveSeedCandidateReceiptV1Schema,
  projectFirstSeedCandidateOutcomeV4,
} from "./model-live-seed-candidate-codec.js";
import { projectRepairCandidateOutcomeV4 } from "./model-live-repair-candidate-outcome.js";
import {
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
} from "./model-live-sequence-authority-codec.js";

export const modelLiveRepairSuccessorCandidateReceiptV2Schema = z
  .object({
    ...modelLiveSeedCandidateReceiptV1Schema.shape,
    contractVersion: z.literal(2),
    recordKind: z.literal(
      "model-live-repair-successor-candidate-validation-receipt",
    ),
    receiptId: solutionStableIdSchema.regex(/^repair_successor_[a-f0-9]{64}$/u),
    lineage: applicationHostRepairSuccessorLineageV2Schema,
    predecessorOutcomeDigest: sha256DigestSchema,
    predecessorValidationReceiptDigest: sha256DigestSchema,
    disposition: z.enum(["valid", "invalid-nonrepairable"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { receiptId, receiptDigest, ...body } = value;
    if (
      receiptId !== "repair_successor_" + digest(body).slice(7) ||
      receiptDigest !== digest({ ...body, receiptId }) ||
      value.lineage.invocationId !== value.invocationId ||
      digest(value.lineage) !== value.bindings.repairLineageDigest ||
      (value.disposition === "valid" && value.observedDefect !== "none") ||
      Date.parse(value.startedAt) > Date.parse(value.completedAt) ||
      Date.parse(value.completedAt) > Date.parse(value.issuedAt) ||
      Buffer.byteLength(JSON.stringify(value), "utf8") > 12288
    )
      ctx.addIssue({
        code: "custom",
        message: "Exact final candidate metadata is required.",
      });
  });
export type ModelLiveRepairSuccessorCandidateReceiptV2 = z.output<
  typeof modelLiveRepairSuccessorCandidateReceiptV2Schema
>;
type HostObservation = Awaited<
  ReturnType<
    ReturnType<typeof createProductionRepairSuccessorValidationHost>["run"]
  >
>;
interface Predecessor {
  readonly stage: unknown;
  readonly attemptObservation: unknown;
  readonly receipt: unknown;
}

/** Pure metadata only. The authenticated host must own native execution and
 * recheck configuration and authority before persisting the final receipt. */
export function prepareFinalRepairCandidateOutcomeV4(input: {
  readonly scope: unknown;
  readonly stage: unknown;
  readonly usage: unknown;
  readonly attemptObservation: unknown;
  readonly predecessor: Predecessor;
  readonly host: HostObservation;
  readonly issuedAt: string;
}) {
  const scope = modelLiveEvaluationScopeV2Schema.parse(input.scope);
  const stage = modelLiveSequenceInputV3Schema.parse(input.stage);
  const usage = normalizedModelUsageV1Schema.parse(input.usage);
  const attempt = modelLiveSequenceAttemptObservationV4Schema.parse(
    input.attemptObservation,
  );
  const result = applicationHostRepairSuccessorBuildResultV2Schema.parse(
    input.host.observation,
  );
  const prior = modelLiveSeedCandidateReceiptV1Schema.parse(
    input.predecessor.receipt,
  );
  const h = input.host;
  requireAuthority(
    result.cleanup === "verified" &&
      (result.state === "passed" || result.state === "failed") &&
      h.seedReceiptDigest === prior.seedReceiptDigest &&
      h.configurationDigest ===
        repairSuccessorHostConfigurationDigest(prior.configurationDigest) &&
      h.usageRecordId === usage.usageRecordId &&
      h.usageDigest === digest(usage) &&
      usage.result === "succeeded" &&
      usage.invocationId === stage.invocationId &&
      usage.inputDigest === stage.operationInputDigest &&
      scope.organizationId === usage.scope.organizationId &&
      scope.projectId === usage.scope.projectId &&
      scope.userId === usage.scope.userId &&
      same(scope, prior.scope) &&
      attempt.normalizedUsageDigest === digest(usage) &&
      h.candidate.invocationId === stage.invocationId &&
      h.candidate.inputDigest === stage.operationInputDigest &&
      h.candidate.digest === result.bindings.extensionContentDigest &&
      h.candidate.baseDigest === prior.bindings.extensionContentDigest &&
      Date.parse(h.startedAt) >= Date.parse(usage.completedAt) &&
      Date.parse(h.startedAt) >= Date.parse(attempt.observedAt),
  );
  const lineage = applicationHostRepairSuccessorLineageV2Schema.parse({
    baseDigest: h.candidate.baseDigest,
    inputDigest: h.candidate.inputDigest,
    invocationId: h.candidate.invocationId,
    patchDigest: h.candidate.patchDigest,
    responseDigest: h.candidate.responseDigest,
    predecessorRequestDigest: prior.bindings.requestDigest,
    predecessorReportDigest: prior.reportDigest,
    predecessorLineageDigest: prior.bindings.repairLineageDigest,
  });
  requireAuthority(digest(lineage) === result.bindings.repairLineageDigest);
  const body = {
    contractVersion: 2 as const,
    recordKind:
      "model-live-repair-successor-candidate-validation-receipt" as const,
    scope,
    stageId: stage.stageId,
    invocationId: stage.invocationId,
    inputBindingDigest: stage.inputBindingDigest,
    seedReceiptDigest: h.seedReceiptDigest,
    commercialAttemptObservationDigest: attempt.observationDigest,
    normalizedUsageDigest: digest(usage),
    providerResultDigest: h.providerResultDigest,
    configurationDigest: h.configurationDigest,
    bindings: result.bindings,
    lineage,
    reportDigest: result.reportDigest,
    predecessorOutcomeDigest: h.predecessorOutcomeDigest,
    predecessorValidationReceiptDigest: h.predecessorValidationReceiptDigest,
    disposition: result.state === "passed" ? "valid" : "invalid-nonrepairable",
    observedDefect: result.diagnostics.some(
      (d) => d.code === "application.host-repair-seed.observed-repair-ts2322",
    )
      ? "TS2322"
      : "none",
    cleanup: "verified" as const,
    startedAt: h.startedAt,
    completedAt: h.completedAt,
    issuedAt: input.issuedAt,
  };
  const identified = {
    ...body,
    receiptId: "repair_successor_" + digest(body).slice(7),
  };
  const receipt = modelLiveRepairSuccessorCandidateReceiptV2Schema.parse({
    ...identified,
    receiptDigest: digest(identified),
  });
  return {
    receipt,
    outcome: projectFinalRepairCandidateOutcomeV4(
      stage,
      attempt,
      receipt,
      input.predecessor,
    ),
  };
}
export function projectFinalRepairCandidateOutcomeV4(
  rawStage: unknown,
  rawAttempt: unknown,
  rawReceipt: unknown,
  predecessor: Predecessor,
) {
  const stage = modelLiveSequenceInputV3Schema.parse(rawStage);
  const attempt = modelLiveSequenceAttemptObservationV4Schema.parse(rawAttempt);
  const receipt =
    modelLiveRepairSuccessorCandidateReceiptV2Schema.parse(rawReceipt);
  const prior = modelLiveSeedCandidateReceiptV1Schema.parse(
    predecessor.receipt,
  );
  const priorAttempt = modelLiveSequenceAttemptObservationV4Schema.parse(
    predecessor.attemptObservation,
  );
  const outcome = projectFirstSeedCandidateOutcomeV4(
    predecessor.stage,
    priorAttempt,
    prior,
  );
  requireAuthority(
    stage.stageKey === "repair-2" &&
      stage.predecessor.kind === "stage" &&
      outcome.status === "validated" &&
      outcome.validation.status === "invalid" &&
      outcome.validation.repairable &&
      same(stage.predecessor, {
        kind: "stage",
        stageId: outcome.stageId,
        outcomeDigest: outcome.outcomeDigest,
        outputDigest: outcome.outputDigest,
        candidateDigest: outcome.candidateDigest,
        validationReceiptDigest: outcome.validationReceiptDigest,
      }) &&
      receipt.predecessorOutcomeDigest === outcome.outcomeDigest &&
      receipt.predecessorValidationReceiptDigest === prior.receiptDigest &&
      receipt.stageId === stage.stageId &&
      receipt.invocationId === stage.invocationId &&
      receipt.inputBindingDigest === stage.inputBindingDigest &&
      receipt.seedReceiptDigest === prior.seedReceiptDigest &&
      same(receipt.scope, prior.scope) &&
      receipt.configurationDigest ===
        repairSuccessorHostConfigurationDigest(prior.configurationDigest) &&
      receipt.lineage.inputDigest === stage.operationInputDigest &&
      receipt.lineage.baseDigest === prior.bindings.extensionContentDigest &&
      receipt.lineage.predecessorRequestDigest ===
        prior.bindings.requestDigest &&
      receipt.lineage.predecessorReportDigest === prior.reportDigest &&
      receipt.lineage.predecessorLineageDigest ===
        prior.bindings.repairLineageDigest &&
      receipt.commercialAttemptObservationDigest ===
        attempt.observationDigest &&
      receipt.normalizedUsageDigest === attempt.normalizedUsageDigest &&
      attempt.canonicalAttemptOrdinal === 2 &&
      priorAttempt.canonicalAttemptOrdinal === 1 &&
      attempt.canonicalWorkflowFingerprint ===
        priorAttempt.canonicalWorkflowFingerprint &&
      Date.parse(receipt.startedAt) >= Date.parse(attempt.observedAt),
  );
  return projectRepairCandidateOutcomeV4(stage, attempt, receipt);
}
