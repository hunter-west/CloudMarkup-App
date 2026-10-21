import { digestStructuredValue } from "@cloudmarkup/model-gateway";
import type { ModelLiveProposalValidationReceiptV2 } from "./model-live-proposal-validation-codec.js";
import { requireParserInput } from "./model-live-parser-input-codec.js";
import { readModelLiveParserInputReceipt } from "./model-live-parser-input.js";
import type { SqlExecutor } from "./sql.js";

/** Shared by issuance and historical terminal/accounting reads. Absence retains
 * old receipt meaning only; it cannot admit a successor. This performs no write,
 * reconciliation or current-approval check during historical recovery. */
export async function requireModelLiveParserValidationBinding(input: {
  readonly transaction: SqlExecutor;
  readonly receipt: ModelLiveProposalValidationReceiptV2;
  readonly invocationScopeDigest: string;
  readonly invocationDigest: string;
  readonly descriptorDigest: string;
}) {
  const { receipt } = input;
  const assessment = receipt.assessment;
  const issued = await readModelLiveParserInputReceipt(
    input.transaction,
    receipt,
  );
  const successor =
    assessment.validatorVersion === "2.9.0" ||
    assessment.validatorVersion === "2.10.0";
  if (issued === null) {
    requireParserInput(!successor);
    return;
  }
  requireParserInput(
    successor &&
      "repositoryInputReceipt" in assessment &&
      "repositoryParser" in assessment &&
      assessment.repositoryInputReceipt.receiptId === issued.receiptId &&
      assessment.repositoryInputReceipt.receiptDigest ===
        issued.receiptDigest &&
      digestStructuredValue(assessment.repositoryParser) ===
        digestStructuredValue(issued.repositoryParser) &&
      issued.planDigest === receipt.planDigest &&
      issued.approvalDigest === receipt.approvalDigest &&
      issued.runtimeRequestDigest === receipt.runtimeRequestDigest &&
      issued.inputEvidenceId === receipt.inputEvidenceId &&
      issued.inputEvidenceDigest === receipt.inputEvidenceDigest &&
      issued.invocationScopeDigest === input.invocationScopeDigest &&
      issued.invocationDigest === input.invocationDigest &&
      issued.descriptorDigest === input.descriptorDigest &&
      issued.caseId === assessment.caseId &&
      issued.caseDigest === assessment.caseDigest &&
      issued.sourceInputDigest === assessment.sourceInputDigest &&
      issued.inputDigest === assessment.inputDigest &&
      (assessment.validatorVersion === "2.10.0") ===
        (issued.caseId ===
          "evaluation_case_external_existing_resource_full_beta_v1"),
  );
}
