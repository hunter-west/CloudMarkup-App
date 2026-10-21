import {
  digestCanonicalValue,
  modelEvaluationAuthorityBindingV1Schema,
  modelEvaluationDatasetV1Schema,
  modelEvaluationReportV1Schema,
  modelNormalPromotionReceiptV1Schema,
  modelNormalPromotionScopeV1Schema,
  modelRuntimeControlPolicyV1Schema,
  utcTimestampSchema,
  type ModelNormalPromotionReceiptV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import { inspectModelValueForSecretCandidatesV1 } from "./security.js";

export class ModelNormalPromotionBindingError extends Error {
  readonly code = "model-normal-promotion.bindings-invalid";
  constructor() {
    super(
      "The proposed normal promotion metadata does not match its evidence.",
    );
    this.name = "ModelNormalPromotionBindingError";
  }
}

export interface ModelNormalPromotionBindingCheckV1 {
  readonly kind: "bindings-match";
  readonly receipt: ModelNormalPromotionReceiptV1;
  readonly issuanceVerified: false;
  readonly currentAuthorityVerified: false;
  readonly capabilityActivated: false;
}

const inputSchema = z
  .object({
    receipt: modelNormalPromotionReceiptV1Schema,
    dataset: modelEvaluationDatasetV1Schema,
    report: modelEvaluationReportV1Schema,
    policy: modelRuntimeControlPolicyV1Schema,
    expectedScope: modelNormalPromotionScopeV1Schema,
    expectedAuthorityBinding: modelEvaluationAuthorityBindingV1Schema,
    observedAt: utcTimestampSchema,
  })
  .strict();
const same = (left: unknown, right: unknown): boolean =>
  digestCanonicalValue(left) === digestCanonicalValue(right);
function requireBinding(condition: boolean): asserts condition {
  if (!condition) throw new ModelNormalPromotionBindingError();
}

/** Offline exact-binding check ONLY. All inputs remain untrusted comparison
 * data, including observedAt and expected values. There is no durable report
 * issuer/current-revocation authority in this composition, so even a matching
 * result explicitly provides no issuance or runtime authority. Do not use this
 * as ModelRuntimeAuthorityResolverV1 or feed it into admission/dispatch.
 * No report mutation, persistence, clock read, provider or caller-proof port. */
export function checkModelNormalPromotionBindingsV1(
  value: unknown,
): ModelNormalPromotionBindingCheckV1 {
  try {
    const input = inputSchema.parse(value);
    const { receipt, report, dataset, policy } = input;
    const evidence = receipt.evaluation;
    const gate = policy.evaluationGate;
    const tuple = receipt.authorityBinding.authorityTuple;
    requireBinding(
      inspectModelValueForSecretCandidatesV1(receipt).detectedValueCount === 0,
    );
    requireBinding(
      same(receipt.scope, input.expectedScope) &&
        same(receipt.authorityBinding, input.expectedAuthorityBinding),
    );
    requireBinding(
      report.executionMode === "opt-in-live" &&
        !report.normalCi &&
        report.activationRecommendation === "hold" &&
        report.deterministicPassed,
    );
    requireBinding(
      report.environment === evidence.environment &&
        report.liveEvaluationAuthorityDigest ===
          evidence.liveEvaluationAuthorityDigest,
    );
    requireBinding(
      report.evaluationReportId === evidence.reportId &&
        report.reportDigest === evidence.reportDigest &&
        report.evaluationResultSetDigest === evidence.resultSetDigest,
    );
    requireBinding(
      report.datasetDigest === evidence.datasetDigest &&
        dataset.datasetDigest === evidence.datasetDigest &&
        same(report.datasetCaseDigests, evidence.datasetCaseDigests) &&
        same(
          dataset.cases.map((entry) => entry.caseDigest),
          evidence.datasetCaseDigests,
        ),
    );
    for (const evaluationCase of dataset.cases) {
      const result = report.caseResults.find(
        (entry) => entry.caseDigest === evaluationCase.caseDigest,
      );
      requireBinding(result !== undefined);
      requireBinding(
        result.caseId === evaluationCase.caseId &&
          same(
            result.authorityRequirement,
            evaluationCase.expected.authorityRequirement,
          ),
      );
      requireBinding(
        same(
          result.scores
            .filter((score) => score.applicable)
            .map((score) => score.dimension)
            .sort(),
          [...evaluationCase.targetDimensions].sort(),
        ),
      );
    }
    requireBinding(
      report.evaluationPolicyId === evidence.evaluationPolicyId &&
        report.evaluationPolicyVersion === evidence.evaluationPolicyVersion &&
        report.evaluationPolicyDigest === evidence.evaluationPolicyDigest,
    );
    requireBinding(
      report.authorityBindings.some((entry) =>
        same(entry, receipt.authorityBinding),
      ),
    );
    requireBinding(
      policy.policyId === receipt.runtimePolicy.policyId &&
        policy.policyVersion === receipt.runtimePolicy.policyVersion &&
        policy.policyDigest === receipt.runtimePolicy.policyDigest &&
        policy.runtimeControlConfigurationDigest ===
          receipt.runtimePolicy.runtimeControlConfigurationDigest,
    );
    requireBinding(
      same(gate.authorityTuple, tuple) &&
        gate.authorityTupleDigest ===
          receipt.authorityBinding.authorityTupleDigest,
    );
    requireBinding(
      gate.evaluationReportId === evidence.reportId &&
        gate.evaluationReportDigest === evidence.reportDigest &&
        gate.evaluationResultSetDigest === evidence.resultSetDigest &&
        gate.datasetDigest === evidence.datasetDigest &&
        same(gate.datasetCaseDigests, evidence.datasetCaseDigests),
    );
    requireBinding(
      gate.evaluationPolicyId === evidence.evaluationPolicyId &&
        gate.evaluationPolicyVersion === evidence.evaluationPolicyVersion &&
        gate.evaluationPolicyDigest === evidence.evaluationPolicyDigest,
    );
    requireBinding(
      gate.deterministicQualityBasisPoints ===
        report.deterministicQualityBasisPoints &&
        report.deterministicQualityBasisPoints >=
          gate.minimumDeterministicQualityBasisPoints,
    );
    requireBinding(
      policy.allowlists.routes.includes(receipt.routeId) &&
        policy.allowlists.roles.includes(tuple.role) &&
        policy.allowlists.modelConfigurationReferences.includes(
          tuple.modelConfigurationReference,
        ),
    );
    requireBinding(
      !policy.killSwitches.global.engaged &&
        !policy.killSwitches.capabilitySwitches.some(
          (entry) => entry.operation === tuple.operation && entry.engaged,
        ),
    );
    requireBinding(
      !policy.administrativeSuspensions.some((entry) =>
        entry.scope === "organization"
          ? entry.scopeId === receipt.scope.organizationId
          : entry.scopeId === receipt.scope.userId,
      ),
    );
    const observed = Date.parse(input.observedAt);
    requireBinding(
      Number.isFinite(observed) &&
        Date.parse(report.finishedAt) <= Date.parse(receipt.issuedAt) &&
        Date.parse(receipt.effectiveFrom) <= observed &&
        observed < Date.parse(receipt.expiresAt),
    );
    return {
      kind: "bindings-match",
      receipt,
      issuanceVerified: false,
      currentAuthorityVerified: false,
      capabilityActivated: false,
    };
  } catch {
    throw new ModelNormalPromotionBindingError();
  }
}
