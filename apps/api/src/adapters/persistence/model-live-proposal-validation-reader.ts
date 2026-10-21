import { requireModelLiveParserValidationBinding } from "./model-live-parser-validation.js";
import { requireModelLiveEventPolicyParity } from "../../model-live-event-policy.js";
import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationPlanV2Schema,
  modelRuntimeHostEvidenceV1Schema,
  modelRuntimeInputEvidenceV1Schema,
  normalizedModelUsageV1Schema,
  utcTimestampSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import {
  MODEL_LIVE_HOST_EVIDENCE_VERIFIER,
  MODEL_LIVE_HOST_EVIDENCE_VERSION,
} from "./model-live-runtime-host-evidence-codec.js";
import {
  liveJournalBindingSchema,
  liveJournalRead,
} from "./model-live-invocation-journal-codec.js";
import {
  modelLiveProposalValidationReceiptV2Schema,
  requireLiveValidation,
} from "./model-live-proposal-validation-codec.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

/** Read actual immutable issuance inside an independently authenticated scoped
 * journal/accounting transaction. Historical receipts may support financial
 * recovery after execution expires; this grants no new validation or dispatch.
 * Absence is distinct from malformed/substituted evidence, which fails closed. */
export async function readLiveProposalValidationReceipt(
  transaction: SqlExecutor,
  journal: SqlRow,
  admission: ModelLiveRuntimeAdmissionRequestV2,
) {
  if (journal["gateway_state"] !== "complete") return null;
  const b = liveJournalBindingSchema.parse(liveJournalRead(journal["binding"]));
  requireLiveValidation(
    b.scope.organizationId === admission.organizationId &&
      b.scope.projectId === admission.projectId &&
      b.scope.userId === admission.userId &&
      b.runtimeRequestDigest === admission.requestDigest &&
      b.liveEvaluationPlanDigest === admission.liveEvaluationPlanDigest &&
      b.liveEvaluationAuthorityDigest ===
        admission.liveEvaluationAuthorityDigest &&
      b.evaluationCaseId === admission.evaluationCaseId &&
      b.evaluationCaseDigest === admission.evaluationCaseDigest &&
      b.inputDigest === admission.inputDigest &&
      journal["organization_id"] === b.scope.organizationId &&
      journal["project_id"] === b.scope.projectId &&
      journal["principal_id"] === b.scope.userId &&
      journal["invocation_id"] === b.invocationId &&
      journal["binding_sha256"] === digestStructuredValue(b).slice(7),
  );
  const keys = [
    admission.organizationId,
    admission.projectId,
    admission.userId,
  ];
  const found = await transaction.query(
    sql(
      `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at FROM model_live_proposal_validation_receipts WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
      [...keys, b.invocationId],
    ),
  );
  if (found.rowCount === 0) return null;
  const row = found.rows[0];
  requireLiveValidation(found.rowCount === 1 && row !== undefined);
  const receipt = modelLiveProposalValidationReceiptV2Schema.parse(
    liveJournalRead(row["receipt_record"]),
  );
  const a = receipt.assessment;
  const usage = normalizedModelUsageV1Schema.parse(
    liveJournalRead(journal["normalized_usage"]),
  );
  requireLiveValidation(
    receipt.organizationId === admission.organizationId &&
      receipt.projectId === admission.projectId &&
      receipt.userId === admission.userId &&
      receipt.invocationId === b.invocationId &&
      receipt.journalBindingDigest === digestStructuredValue(b) &&
      receipt.runtimeRequestDigest === admission.requestDigest &&
      receipt.planDigest === admission.liveEvaluationPlanDigest &&
      receipt.approvalDigest === admission.liveEvaluationAuthorityDigest &&
      receipt.inputEvidenceDigest === admission.inputEvidenceDigest &&
      receipt.normalizedUsageDigest === digestStructuredValue(usage) &&
      usage.result === "succeeded" &&
      a.caseId === admission.evaluationCaseId &&
      a.caseDigest === admission.evaluationCaseDigest &&
      a.inputDigest === admission.inputDigest &&
      a.outputDigest === "sha256:" + String(journal["output_sha256"]) &&
      row["organization_id"] === receipt.organizationId &&
      row["project_id"] === receipt.projectId &&
      row["principal_id"] === receipt.userId &&
      row["invocation_id"] === receipt.invocationId &&
      row["receipt_id"] === receipt.receiptId &&
      row["receipt_sha256"] === receipt.receiptDigest.slice(7) &&
      row["input_evidence_id"] === receipt.inputEvidenceId &&
      row["operations_evidence_id"] === receipt.operationsEvidenceId &&
      row["ownership_evidence_id"] === receipt.ownershipEvidenceId,
  );
  const issued = await transaction.query(
    sql(
      "SELECT plan_record FROM model_live_evaluation_plans WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4",
      [...keys, receipt.planDigest.slice(7)],
    ),
  );
  requireLiveValidation(issued.rowCount === 1);
  const plan = modelLiveEvaluationPlanV2Schema.parse(
    liveJournalRead(issued.rows[0]?.["plan_record"]),
  );
  const caseBinding = plan.definition.cases.find((c) => c.caseId === a.caseId);
  const createdAt = Date.parse(utcTimestampSchema.parse(row["recorded_at"]));
  requireLiveValidation(
    plan.planDigest === receipt.planDigest &&
      plan.approval.approvalDigest === receipt.approvalDigest &&
      plan.definition.scope.organizationId === receipt.organizationId &&
      plan.definition.scope.projectId === receipt.projectId &&
      plan.definition.scope.userId === receipt.userId &&
      caseBinding?.caseDigest === a.caseDigest &&
      caseBinding.sourceInputDigest === a.sourceInputDigest &&
      caseBinding.invocationInputDigest === a.inputDigest &&
      createdAt >= Date.parse(plan.issuedAt) &&
      createdAt < Date.parse(plan.expiresAt),
  );
  requireModelLiveEventPolicyParity({
    evaluationPolicy: plan.definition.policy.evaluationRequirement,
    assessment: a,
  });
  const evidence = await transaction.query(
    sql(
      "SELECT * FROM model_live_runtime_host_evidence WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND evidence_id IN ($4,$5,$6)",
      [
        ...keys,
        receipt.inputEvidenceId,
        receipt.operationsEvidenceId,
        receipt.ownershipEvidenceId,
      ],
    ),
  );
  requireLiveValidation(evidence.rowCount === 3);
  for (const [id, digest, kind] of [
    [receipt.inputEvidenceId, receipt.inputEvidenceDigest, "input"],
    [
      receipt.operationsEvidenceId,
      receipt.operationsEvidenceDigest,
      "allow-listed-operations",
    ],
    [
      receipt.ownershipEvidenceId,
      receipt.ownershipEvidenceDigest,
      "source-ownership",
    ],
  ] as const) {
    const stored = evidence.rows.find((entry) => entry["evidence_id"] === id);
    requireLiveValidation(stored !== undefined);
    const raw = liveJournalRead(stored["evidence_record"]);
    const record =
      kind === "input"
        ? modelRuntimeInputEvidenceV1Schema.parse(raw)
        : modelRuntimeHostEvidenceV1Schema.parse(raw);
    requireLiveValidation(
      record.evidenceId === id &&
        record.evidenceDigest === digest &&
        record.verifierId === MODEL_LIVE_HOST_EVIDENCE_VERIFIER &&
        record.verifierVersion === MODEL_LIVE_HOST_EVIDENCE_VERSION &&
        record.operation === admission.operation &&
        record.organizationId === receipt.organizationId &&
        record.projectId === receipt.projectId &&
        record.inputDigest === a.inputDigest &&
        stored["evidence_kind"] === kind &&
        stored["evidence_sha256"] === digest.slice(7) &&
        stored["invocation_id"] === b.invocationId &&
        stored["plan_sha256"] === receipt.planDigest.slice(7) &&
        stored["case_id"] === a.caseId &&
        stored["case_sha256"] === a.caseDigest.slice(7) &&
        (record.recordKind === "model-runtime-input-evidence"
          ? record.userId === receipt.userId &&
            digestStructuredValue(record.requested) ===
              digestStructuredValue(admission.requested)
          : record.evidenceKind === kind &&
            record.outputDigest === a.outputDigest &&
            record.outputBytes === journal["output_bytes"] &&
            String(record.outputTokens) === usage.outputUnits &&
            record.catalogDigest ===
              caseBinding.authorityBinding.authorityTuple.catalogDigest &&
            record.responseSchemaDigest ===
              caseBinding.authorityBinding.authorityTuple
                .responseSchemaDigest &&
            record.runtimePolicyDigest ===
              plan.definition.policy.policyDigest &&
            stored["input_evidence_id"] === receipt.inputEvidenceId),
    );
  }
  const storedInput = evidence.rows.find(
    (entry) => entry["evidence_id"] === receipt.inputEvidenceId,
  );
  requireLiveValidation(storedInput !== undefined);
  await requireModelLiveParserValidationBinding({
    transaction,
    receipt,
    invocationScopeDigest: digestStructuredValue(b.scope),
    invocationDigest: "sha256:" + String(storedInput["invocation_sha256"]),
    descriptorDigest: "sha256:" + String(storedInput["descriptor_sha256"]),
  });
  return receipt;
}
