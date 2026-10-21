import {
  digestStructuredValue,
  fullBetaRepositorySourcesV1,
  validateModelLiveEvaluationRequestV2,
  type ModelProviderInvocationV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  modelRuntimeInputEvidenceV1Schema,
  utcTimestampSchema,
  type ModelLiveRuntimeAdmissionRequestV2,
} from "@cloudmarkup/schemas";
import { prepareModelLiveRepositoryInput } from "../../model-live-repository-input.js";
import { createModelLiveRepositoryParserAuthority } from "../../model-live-repository-parser-authority.js";
import { requireProductionModelLiveCaseSource } from "../../production-model-live-case-source.js";
import type { PinnedCompilerConfiguration } from "../pinned-go-executable.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import {
  identifyModelLiveParserInputReceipt,
  modelLiveParserInputReceiptV1Schema,
  ModelLiveParserInputError,
  requireParserInput,
  type ModelLiveParserInputReceiptV1,
} from "./model-live-parser-input-codec.js";
import { sql, type SqlExecutor } from "./sql.js";

const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const read = (raw: unknown): unknown =>
  typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
type Identity = Pick<
  ModelLiveParserInputReceiptV1,
  "organizationId" | "projectId" | "userId" | "invocationId"
>;
const keys = (scope: Identity) => [
  scope.organizationId,
  scope.projectId,
  scope.userId,
  scope.invocationId,
];

/** Requires an independently authenticated scoped transaction. No current
 * approval is required for this historical metadata read, and no write occurs. */
export async function readModelLiveParserInputReceipt(
  transaction: SqlExecutor,
  identity: Identity,
) {
  const found = await transaction.query(
    sql(
      "SELECT * FROM model_live_parser_input_receipts WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4",
      keys(identity),
    ),
  );
  if (found.rowCount === 0) return null;
  const row = found.rows[0];
  requireParserInput(found.rowCount === 1 && row !== undefined);
  const receipt = modelLiveParserInputReceiptV1Schema.parse(
    read(row["receipt_record"]),
  );
  requireParserInput(
    same(keys(receipt), keys(identity)) &&
      row["organization_id"] === identity.organizationId &&
      row["project_id"] === identity.projectId &&
      row["principal_id"] === identity.userId &&
      row["invocation_id"] === identity.invocationId &&
      row["receipt_id"] === receipt.receiptId &&
      row["receipt_sha256"] === receipt.receiptDigest.slice(7) &&
      row["plan_sha256"] === receipt.planDigest.slice(7) &&
      row["case_id"] === receipt.caseId &&
      row["input_evidence_id"] === receipt.inputEvidenceId,
  );
  return receipt;
}

/** Fixed pre-inference parser host. There is deliberately no method accepting
 * parser metadata, result digests, a parser callback or caller-supplied grades.
 * Actual source parsing runs outside SQL; current authority is checked again
 * before append-only issuance. Existing identical issuance is replayable. */
export async function issueModelLiveParserInputReceipt(input: {
  readonly plans: PostgresModelLiveEvaluationPlans;
  readonly definitionId: string;
  readonly invocation: ModelProviderInvocationV1;
  readonly admission: ModelLiveRuntimeAdmissionRequestV2;
  readonly compiler: PinnedCompilerConfiguration;
}): Promise<ModelLiveParserInputReceiptV1> {
  try {
    const invocation = structuredClone(input.invocation);
    const admission = modelLiveRuntimeAdmissionRequestV2Schema.parse(
      input.admission,
    );
    const compiler = Object.freeze(structuredClone(input.compiler));
    const reference = {
      definitionId: input.definitionId,
      planDigest: admission.liveEvaluationPlanDigest,
      caseId: admission.evaluationCaseId,
    };
    const evaluationCase = await input.plans.requireCurrentCase(reference);
    requireProductionModelLiveCaseSource({ evaluationCase, invocation });
    const source = fullBetaRepositorySourcesV1.find(
      (candidate) => candidate.caseKind === evaluationCase.caseKind,
    );
    requireParserInput(source !== undefined);
    const parsed = await prepareModelLiveRepositoryInput({
      caseKind: source.caseKind,
      compiler,
    });
    const request = invocation.request;
    const snapshotDigest =
      request.operation === "repository.interpret"
        ? request.repositorySnapshotDigest
        : request.operation === "operations.propose"
          ? request.planningContext?.approvedRepositoryEvidence
              ?.repositorySnapshotDigest
          : undefined;
    requireParserInput(snapshotDigest !== undefined);
    const repositoryParser = createModelLiveRepositoryParserAuthority({
      result: parsed.result,
      expectedSnapshotDigest: snapshotDigest,
      compiler,
    });
    requireParserInput(
      same(await input.plans.requireCurrentCase(reference), evaluationCase),
    );
    return await input.plans.withIssuedMetadata(
      reference,
      async ({ transaction, plan, requireCurrentApproval }) => {
        await requireCurrentApproval();
        const scope = invocation.descriptor.scope;
        const binding = plan.definition.cases.find(
          (candidate) => candidate.caseId === reference.caseId,
        );
        requireParserInput(
          scope.projectId !== undefined &&
            binding !== undefined &&
            scope.organizationId === plan.definition.scope.organizationId &&
            scope.projectId === plan.definition.scope.projectId &&
            scope.userId === plan.definition.scope.userId &&
            binding.caseDigest === evaluationCase.caseDigest &&
            binding.sourceInputDigest ===
              digestStructuredValue(evaluationCase.input) &&
            binding.invocationInputDigest ===
              invocation.descriptor.inputDigest &&
            invocation.descriptor.inputDigest ===
              digestStructuredValue({ request, scope }),
        );
        const evidence = await transaction.query(
          sql(
            "SELECT * FROM model_live_runtime_host_evidence WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 AND case_id=$5 AND invocation_id=$6 AND evidence_kind='input' AND evidence_sha256=$7",
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              plan.planDigest.slice(7),
              reference.caseId,
              invocation.descriptor.invocationId,
              admission.inputEvidenceDigest.slice(7),
            ],
          ),
        );
        const row = evidence.rows[0];
        requireParserInput(evidence.rowCount === 1 && row !== undefined);
        const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse(
          read(row["evidence_record"]),
        );
        requireParserInput(
          row["invocation_sha256"] ===
            digestStructuredValue(invocation).slice(7) &&
            row["descriptor_sha256"] ===
              digestStructuredValue(invocation.descriptor).slice(7) &&
            row["invocation_scope_sha256"] ===
              digestStructuredValue(scope).slice(7) &&
            row["case_sha256"] === binding.caseDigest.slice(7) &&
            row["input_sha256"] === binding.invocationInputDigest.slice(7) &&
            row["evidence_sha256"] === inputEvidence.evidenceDigest.slice(7) &&
            row["evidence_id"] === inputEvidence.evidenceId,
        );
        const stamp = (
          await transaction.query(
            sql(
              "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
            ),
          )
        ).rows[0]?.["now"];
        validateModelLiveEvaluationRequestV2({
          plan,
          request: admission,
          inputEvidence,
          observedAt: utcTimestampSchema.parse(stamp),
        });
        const receipt = identifyModelLiveParserInputReceipt({
          contractVersion: 1,
          recordKind: "model-live-parser-input-receipt",
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          userId: scope.userId,
          invocationId: invocation.descriptor.invocationId,
          invocationScopeDigest: digestStructuredValue(scope),
          invocationDigest: digestStructuredValue(invocation),
          descriptorDigest: digestStructuredValue(invocation.descriptor),
          requestDigest: digestStructuredValue(request),
          runtimeRequestDigest: admission.requestDigest,
          planDigest: plan.planDigest,
          approvalDigest: plan.approval.approvalDigest,
          caseId: binding.caseId,
          caseDigest: binding.caseDigest,
          sourceInputDigest: binding.sourceInputDigest,
          inputDigest: binding.invocationInputDigest,
          inputEvidenceId: inputEvidence.evidenceId,
          inputEvidenceDigest: inputEvidence.evidenceDigest,
          repositoryParser,
        });
        const existing = await readModelLiveParserInputReceipt(
          transaction,
          receipt,
        );
        if (existing !== null) {
          requireParserInput(same(existing, receipt));
          return existing;
        }
        await transaction.query(
          sql(
            "INSERT INTO model_live_parser_input_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,plan_sha256,case_id,input_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (organization_id,project_id,principal_id,invocation_id) DO NOTHING",
            [
              ...keys(receipt),
              receipt.receiptId,
              receipt.receiptDigest.slice(7),
              receipt.planDigest.slice(7),
              receipt.caseId,
              receipt.inputEvidenceId,
              JSON.stringify(receipt),
            ],
          ),
        );
        requireParserInput(
          same(
            await readModelLiveParserInputReceipt(transaction, receipt),
            receipt,
          ),
        );
        return receipt;
      },
    );
  } catch {
    throw new ModelLiveParserInputError();
  }
}
