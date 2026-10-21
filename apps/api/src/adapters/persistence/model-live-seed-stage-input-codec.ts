import {
  digestCanonicalValue,
  modelLiveSequenceInputV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  sha256DigestSchema,
  utcTimestampSchema,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
} from "@cloudmarkup/schemas";
import { inspectModelLiveSequenceV3 } from "@cloudmarkup/model-gateway";
import {
  ModelLiveSequenceAuthorityError,
  requireSequenceAuthority,
} from "./model-live-sequence-authority-codec.js";
import type { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
import type { SqlRow } from "./sql.js";
type Prepared = ReturnType<typeof prepareModelLiveSeedStageInputV3>;

/** Immutable issued metadata only. Restores neither RAM bytes nor current
 * operator, configuration, model-send or financial authority. */
export function parseIssuedModelLiveSeedStageInputRow(
  row: SqlRow,
  suppliedPlan: ModelLiveSequencePlanV3,
  suppliedSelection: ModelLiveSequenceSelectionV3,
  observedAt: string,
) {
  try {
    const plan = modelLiveSequencePlanV3Schema.parse(suppliedPlan);
    const selection =
      modelLiveSequenceSelectionV3Schema.parse(suppliedSelection);
    const raw = row["input_record"];
    const encoded = typeof raw === "string" ? raw : JSON.stringify(raw);
    requireSequenceAuthority(
      typeof encoded === "string" && Buffer.byteLength(encoded, "utf8") <= 8192,
    );
    const record = modelLiveSequenceInputV3Schema.parse(
      JSON.parse(encoded) as unknown,
    );
    const scope = plan.definition.scope;
    const configurationDigest = sha256DigestSchema.parse(
      "sha256:" + String(row["model_configuration_sha256"]),
    );
    const seedConfigurationDigest = sha256DigestSchema.parse(
      "sha256:" + String(row["seed_configuration_sha256"]),
    );
    requireSequenceAuthority(
      record.stageKey === "repair-1" &&
        record.planDigest === plan.planDigest &&
        record.selectionId === selection.selectionId &&
        record.selectionDigest === selection.selectionDigest &&
        row["organization_id"] === scope.organizationId &&
        row["project_id"] === scope.projectId &&
        row["principal_id"] === scope.userId &&
        row["operator_principal_id"] === plan.approval.operatorUserId &&
        row["plan_sha256"] === record.planDigest.slice(7) &&
        row["selection_id"] === record.selectionId &&
        row["stage_id"] === record.stageId &&
        row["invocation_id"] === record.invocationId &&
        row["input_sha256"] === record.inputBindingDigest.slice(7) &&
        Date.parse(utcTimestampSchema.parse(row["issued_at_text"])) ===
          Date.parse(record.issuedAt) &&
        Date.parse(record.issuedAt) >= Date.parse(selection.issuedAt) &&
        Date.parse(record.issuedAt) < Date.parse(plan.expiresAt) &&
        Date.parse(record.issuedAt) <=
          Date.parse(utcTimestampSchema.parse(observedAt)),
    );
    const projection = inspectModelLiveSequenceV3({
      plan,
      selection,
      inputs: [record],
      dispatches: [],
      outcomes: [],
      observedAt: record.issuedAt,
    });
    requireSequenceAuthority(
      projection.cases.some(
        (entry) =>
          entry.caseId === record.caseId &&
          entry.stageId === record.stageId &&
          entry.state === "requires-dispatch-admission",
      ),
    );
    return { record, configurationDigest, seedConfigurationDigest };
  } catch {
    throw new ModelLiveSequenceAuthorityError();
  }
}
/** Restore only metadata matching actual reconstructed current input. */
export function parseModelLiveSeedStageInputRow(
  row: SqlRow,
  prepared: Prepared,
  observedAt: string,
) {
  try {
    const issued = parseIssuedModelLiveSeedStageInputRow(
      row,
      prepared.plan,
      prepared.selection,
      observedAt,
    );
    const { inputBindingDigest, issuedAt, ...fields } = issued.record;
    void inputBindingDigest;
    void issuedAt;
    requireSequenceAuthority(
      digestCanonicalValue(fields) === digestCanonicalValue(prepared.fields) &&
        issued.configurationDigest === prepared.configurationDigest &&
        issued.seedConfigurationDigest === prepared.seedConfigurationDigest,
    );
    return issued.record;
  } catch {
    throw new ModelLiveSequenceAuthorityError();
  }
}
