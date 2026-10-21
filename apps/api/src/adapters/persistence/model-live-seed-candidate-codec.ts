import { projectRepairCandidateOutcomeV4 } from "./model-live-repair-candidate-outcome.js";
import { z } from "zod";
import {
  applicationHostRepairCandidateBindingsV1Schema,
  applicationHostRepairCandidateBuildResultV1Schema,
  applicationHostRepairCandidateLineageV1Schema,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  digestCanonicalValue as digest,
  modelLiveEvaluationScopeV2Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  normalizedModelUsageV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
} from "@cloudmarkup/schemas";
import type { createProductionSeedCandidateValidationHost } from "../../production-model-live-seed-candidate-host.js";
import { requireSequenceAuthority as requireAuthority } from "./model-live-sequence-authority-codec.js";

const stage = modelLiveSequenceInputV3Schema.shape;
export const modelLiveSeedCandidateReceiptV1Schema = z
  .object({
    contractVersion: z.literal(1),
    recordKind: z.literal("model-live-seed-candidate-validation-receipt"),
    receiptId: solutionStableIdSchema.regex(/^seed_candidate_[a-f0-9]{64}$/u),
    receiptDigest: sha256DigestSchema,
    scope: modelLiveEvaluationScopeV2Schema,
    stageId: stage.stageId,
    invocationId: stage.invocationId,
    inputBindingDigest: sha256DigestSchema,
    seedReceiptDigest: sha256DigestSchema,
    commercialAttemptObservationDigest: sha256DigestSchema,
    normalizedUsageDigest: sha256DigestSchema,
    providerResultDigest: sha256DigestSchema,
    configurationDigest: sha256DigestSchema,
    bindings: applicationHostRepairCandidateBindingsV1Schema,
    lineage: applicationHostRepairCandidateLineageV1Schema,
    reportDigest: sha256DigestSchema,
    disposition: z.enum([
      "valid",
      "invalid-repairable",
      "invalid-nonrepairable",
    ]),
    observedDefect: z.enum(["TS2322", "none"]),
    cleanup: z.literal("verified"),
    startedAt: utcTimestampSchema,
    completedAt: utcTimestampSchema,
    issuedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    const { receiptId, receiptDigest, ...body } = v;
    if (
      receiptId !== "seed_candidate_" + digest(body).slice(7) ||
      receiptDigest !== digest({ ...body, receiptId }) ||
      (v.disposition === "invalid-repairable") !==
        (v.observedDefect === "TS2322") ||
      v.lineage.invocationId !== v.invocationId ||
      digest(v.lineage) !== v.bindings.repairLineageDigest ||
      Date.parse(v.startedAt) > Date.parse(v.completedAt) ||
      Date.parse(v.completedAt) > Date.parse(v.issuedAt) ||
      Buffer.byteLength(JSON.stringify(v), "utf8") > 12288
    )
      ctx.addIssue({
        code: "custom",
        message: "Exact candidate validation metadata is required.",
      });
  });
export type ModelLiveSeedCandidateReceiptV1 = z.output<
  typeof modelLiveSeedCandidateReceiptV1Schema
>;
type HostObservation = Awaited<
  ReturnType<
    ReturnType<typeof createProductionSeedCandidateValidationHost>["run"]
  >
>;

/** Pure metadata projection, never an issuer. Only the closed authenticated host
 * may persist this after owning the actual candidate runner call. */
export function prepareFirstSeedCandidateOutcomeV4(input: {
  readonly scope: unknown;
  readonly stage: unknown;
  readonly usage: unknown;
  readonly attemptObservation: unknown;
  readonly host: HostObservation;
  readonly issuedAt: string;
}) {
  const scope = modelLiveEvaluationScopeV2Schema.parse(input.scope);
  const stage = modelLiveSequenceInputV3Schema.parse(input.stage);
  const usage = normalizedModelUsageV1Schema.parse(input.usage);
  const attempt = modelLiveSequenceAttemptObservationV4Schema.parse(
    input.attemptObservation,
  );
  const result = applicationHostRepairCandidateBuildResultV1Schema.parse(
    input.host.observation,
  );
  const h = input.host;
  requireAuthority(
    stage.stageKey === "repair-1" && stage.predecessor.kind === "seed",
  );
  requireAuthority(
    result.cleanup === "verified" &&
      (result.state === "passed" || result.state === "failed") &&
      h.seedReceiptDigest === stage.predecessor.validationReceiptDigest &&
      h.usageRecordId === usage.usageRecordId &&
      h.usageDigest === digest(usage) &&
      usage.result === "succeeded" &&
      usage.invocationId === stage.invocationId &&
      usage.inputDigest === stage.operationInputDigest &&
      scope.organizationId === usage.scope.organizationId &&
      scope.projectId === usage.scope.projectId &&
      scope.userId === usage.scope.userId &&
      attempt.inputBindingDigest === stage.inputBindingDigest &&
      attempt.normalizedUsageDigest === digest(usage) &&
      h.candidate.invocationId === stage.invocationId &&
      h.candidate.inputDigest === stage.operationInputDigest &&
      h.candidate.digest === result.bindings.extensionContentDigest &&
      Date.parse(h.startedAt) >= Date.parse(usage.completedAt) &&
      Date.parse(h.startedAt) >= Date.parse(attempt.observedAt),
  );
  for (const key of [
    "selectionId",
    "selectionDigest",
    "planDigest",
    "caseId",
    "caseDigest",
    "stageKey",
    "stageId",
    "invocationId",
  ] as const)
    requireAuthority(stage[key] === attempt[key]);
  const lineage = applicationHostRepairCandidateLineageV1Schema.parse({
    baseDigest: h.candidate.baseDigest,
    inputDigest: h.candidate.inputDigest,
    invocationId: h.candidate.invocationId,
    patchDigest: h.candidate.patchDigest,
    responseDigest: h.candidate.responseDigest,
  });
  requireAuthority(digest(lineage) === result.bindings.repairLineageDigest);
  const repairable =
    result.state === "failed" &&
    result.diagnostics.length === 1 &&
    result.diagnostics[0]?.code ===
      "application.host-repair-seed.observed-repair-ts2322" &&
    result.steps.length === 3 &&
    result.steps[0]?.state === "passed" &&
    result.steps[1]?.state === "passed" &&
    result.steps[2]?.step === "typecheck" &&
    result.steps[2].state === "failed";
  const body = {
    contractVersion: 1 as const,
    recordKind: "model-live-seed-candidate-validation-receipt" as const,
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
    disposition:
      result.state === "passed"
        ? "valid"
        : repairable
          ? "invalid-repairable"
          : "invalid-nonrepairable",
    observedDefect: repairable ? "TS2322" : "none",
    cleanup: "verified" as const,
    startedAt: h.startedAt,
    completedAt: h.completedAt,
    issuedAt: input.issuedAt,
  };
  const identified = {
    ...body,
    receiptId: "seed_candidate_" + digest(body).slice(7),
  };
  const receipt = modelLiveSeedCandidateReceiptV1Schema.parse({
    ...identified,
    receiptDigest: digest(identified),
  });
  return {
    receipt,
    outcome: projectFirstSeedCandidateOutcomeV4(stage, attempt, receipt),
  };
}
export function projectFirstSeedCandidateOutcomeV4(
  rawStage: unknown,
  rawAttempt: unknown,
  rawReceipt: unknown,
) {
  const stage = modelLiveSequenceInputV3Schema.parse(rawStage);
  const attempt = modelLiveSequenceAttemptObservationV4Schema.parse(rawAttempt);
  const receipt = modelLiveSeedCandidateReceiptV1Schema.parse(rawReceipt);
  requireAuthority(
    stage.stageKey === "repair-1" &&
      stage.predecessor.kind === "seed" &&
      receipt.stageId === stage.stageId &&
      receipt.invocationId === stage.invocationId &&
      receipt.inputBindingDigest === stage.inputBindingDigest &&
      receipt.seedReceiptDigest === stage.predecessor.validationReceiptDigest &&
      receipt.lineage.inputDigest === stage.operationInputDigest &&
      receipt.commercialAttemptObservationDigest ===
        attempt.observationDigest &&
      receipt.normalizedUsageDigest === attempt.normalizedUsageDigest &&
      Date.parse(receipt.startedAt) >= Date.parse(attempt.observedAt),
  );
  return projectRepairCandidateOutcomeV4(stage, attempt, receipt);
}
