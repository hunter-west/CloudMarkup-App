import { readModelLiveParserInputReceipt } from "./model-live-parser-input.js";
import { requireModelLiveParserValidationBinding } from "./model-live-parser-validation.js";
import { assessModelLiveEventCaseSuccessorV2 } from "../../model-live-event-case-assessment-successor.js";
import { requireModelLiveEventPolicyParity } from "../../model-live-event-policy.js";
import { assessModelLiveEventCaseV2 } from "../../model-live-event-case-assessment.js";
import { assessModelLiveExternalCaseV2_10 } from "../../model-live-external-case-assessment-v2-10.js";
import { assessModelLiveRepositoryCaseV2_9 } from "../../model-live-repository-case-assessment-v2-9.js";
import type { PinnedCompilerConfiguration } from "../pinned-go-executable.js";
import { assessModelLiveBoundedRefusalCaseV2 } from "../../model-live-bounded-refusal-case-assessment.js";
import {
  assessModelLiveProposalCaseV2,
  assessModelLiveIntentCaseV2,
  digestStructuredValue,
  selectModelLiveEventValidatorVersion,
  type AssistantWorkflowAuthorizationV1,
  type ModelProviderInvocationV1,
  type ModelGatewayResultV1,
  type SolutionProposalAssessmentInputV2,
} from "@cloudmarkup/model-gateway";
import { modelRuntimeInputEvidenceV1Schema } from "@cloudmarkup/schemas";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import type { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import type { PostgresModelLiveRuntimeHostEvidence } from "./model-live-runtime-host-evidence.js";
import {
  identifyLiveProposalValidationReceipt,
  modelLiveProposalValidationReceiptV2Schema,
  ModelLiveProposalValidationError,
  requireLiveValidation,
  type ModelLiveProposalValidationReceiptV2,
} from "./model-live-proposal-validation-codec.js";
import { sql } from "./sql.js";
import { assessModelLiveQuestionsCaseV2 } from "../../model-live-questions-case-assessment.js";
import { assessModelLivePrivateVpcCaseV2 } from "../../model-live-private-vpc-case-assessment.js";

const same = (a: unknown, b: unknown) =>
  digestStructuredValue(a) === digestStructuredValue(b);
const read = (raw: unknown): unknown =>
  typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;

/** Host-owned validator. Dependencies and authorization come from authenticated
 * composition, never provider/request JSON. It calls the actual deterministic
 * validator itself; no caller grade or arbitrary evaluation callback is accepted.
 * Intent extraction uses the fixed Intent validator; operations require actual
 * provider-rule and review dependencies. Full case, prompt, response,
 * architecture and review content remain in RAM. */
export class PostgresModelLiveProposalCaseValidator {
  readonly #plans: PostgresModelLiveEvaluationPlans;
  readonly #evidence: PostgresModelLiveRuntimeHostEvidence;
  readonly #definitionId: string;
  readonly #repositoryCompiler: PinnedCompilerConfiguration | undefined;
  readonly #dependencies:
    SolutionProposalAssessmentInputV2["dependencies"] | undefined;
  readonly #authorization: AssistantWorkflowAuthorizationV1 | undefined;
  constructor(input: {
    readonly plans: PostgresModelLiveEvaluationPlans;
    readonly evidence: PostgresModelLiveRuntimeHostEvidence;
    readonly definitionId: string;
    readonly repositoryCompiler?: PinnedCompilerConfiguration;
    readonly dependencies?: SolutionProposalAssessmentInputV2["dependencies"];
    readonly authorization?: AssistantWorkflowAuthorizationV1;
  }) {
    this.#plans = input.plans;
    this.#evidence = input.evidence;
    this.#definitionId = input.definitionId;
    this.#repositoryCompiler =
      input.repositoryCompiler === undefined
        ? undefined
        : Object.freeze(structuredClone(input.repositoryCompiler));
    this.#dependencies =
      input.dependencies === undefined
        ? undefined
        : {
            ...input.dependencies,
            allowedApprovalPathIds: new Set(
              input.dependencies.allowedApprovalPathIds,
            ),
            ...(input.dependencies.validationRules === undefined
              ? {}
              : {
                  validationRules: [...input.dependencies.validationRules],
                }),
          };
    this.#authorization = input.authorization;
  }
  async issue(input: {
    readonly invocation: ModelProviderInvocationV1;
    readonly proposal?: Omit<SolutionProposalAssessmentInputV2, "dependencies">;
    readonly repository?: ModelGatewayResultV1<"repository.interpret">;
    readonly intent?: ModelGatewayResultV1<"intent.extract">;
    readonly questions?: ModelGatewayResultV1<"requirements.blocking-questions">;
    readonly journal: PostgresModelLiveInvocationJournal;
    readonly signal?: AbortSignal;
  }) {
    try {
      const invocation = structuredClone(input.invocation);
      const proposal = structuredClone(input.proposal);
      const intent = structuredClone(input.intent);
      const questions = structuredClone(input.questions);
      const repository = structuredClone(input.repository);
      const supplied = repository ?? questions ?? intent ?? proposal?.result;
      requireLiveValidation(supplied !== undefined);
      const completed: ModelGatewayResultV1 = { ...supplied };
      const journal = input.journal;
      const signal = input.signal;
      const aborted = () => signal?.aborted === true;
      requireLiveValidation(
        !aborted() &&
          same(
            Object.keys(input).sort(),
            [
              "invocation",
              "journal",
              ...(repository !== undefined
                ? ["repository"]
                : questions !== undefined
                  ? ["questions"]
                  : intent === undefined
                    ? ["proposal"]
                    : ["intent"]),
              ...(signal === undefined ? [] : ["signal"]),
            ].sort(),
          ) &&
          same(completed.descriptor, invocation.descriptor) &&
          (repository !== undefined
            ? questions === undefined &&
              intent === undefined &&
              proposal === undefined &&
              this.#repositoryCompiler !== undefined &&
              invocation.request.operation === "repository.interpret"
            : questions !== undefined
              ? intent === undefined &&
                proposal === undefined &&
                invocation.request.operation ===
                  "requirements.blocking-questions"
              : intent !== undefined
                ? proposal === undefined &&
                  invocation.request.operation === "intent.extract"
                : proposal !== undefined &&
                  invocation.request.operation === "operations.propose" &&
                  same(proposal.input.modelRequest, invocation.request)),
      );
      // Finish each brief transaction before starting deterministic domain work.
      const before = await journal.withCompletedOutputMetadata(
        completed,
        async ({
          transaction,
          admission,
          binding,
          commercialWorkflow,
          plan,
          result,
        }) => {
          requireLiveValidation(binding.scope.projectId !== undefined);
          const parserInput = await readModelLiveParserInputReceipt(
            transaction,
            {
              organizationId: binding.scope.organizationId,
              projectId: binding.scope.projectId,
              userId: binding.scope.userId,
              invocationId: binding.invocationId,
            },
          );
          return {
            admission,
            binding,
            commercialWorkflow,
            plan,
            result,
            parserInput,
          };
        },
      );
      const reference = {
        definitionId: this.#definitionId,
        planDigest: before.plan.planDigest,
        caseId: before.binding.evaluationCaseId,
      };
      const evaluationCase = await this.#plans.requireCurrentCase(reference);
      requireLiveValidation(
        before.plan.definition.definitionId === this.#definitionId &&
          evaluationCase.caseDigest === before.binding.evaluationCaseDigest,
      );
      const eventValidator =
        evaluationCase.caseKind === "event-driven-image-processing"
          ? selectModelLiveEventValidatorVersion(
              before.plan.definition.policy.evaluationRequirement,
            )
          : undefined;
      const output = await this.#evidence.issueOutput({
        invocation,
        result: completed,
        journal,
      });
      let assessment: ModelLiveProposalValidationReceiptV2["assessment"];
      if (repository !== undefined) {
        requireLiveValidation(
          this.#repositoryCompiler !== undefined && before.parserInput !== null,
        );
        assessment = await assessModelLiveRepositoryCaseV2_9({
          evaluationCase,
          request: invocation.request,
          descriptor: invocation.descriptor,
          response: repository.response,
          outputDigest: output.outputDigest,
          compiler: this.#repositoryCompiler,
          repositoryInput: before.parserInput,
        });
      } else if (questions !== undefined) {
        assessment = assessModelLiveQuestionsCaseV2({
          evaluationCase,
          request: invocation.request,
          descriptor: invocation.descriptor,
          response: questions.response,
          outputDigest: output.outputDigest,
        });
      } else if (intent !== undefined) {
        assessment = assessModelLiveIntentCaseV2({
          evaluationCase,
          request: invocation.request,
          descriptor: invocation.descriptor,
          response: intent.response,
          outputDigest: output.outputDigest,
        });
      } else {
        requireLiveValidation(
          proposal !== undefined &&
            this.#dependencies !== undefined &&
            this.#authorization !== undefined,
        );
        const assessmentInput = {
          evaluationCase,
          proposal: { ...proposal, dependencies: this.#dependencies },
          commercialWorkflow: before.commercialWorkflow,
          authorization: this.#authorization,
          ...(signal === undefined ? {} : { signal }),
        };
        if (evaluationCase.caseKind === "external-existing-resource") {
          requireLiveValidation(
            this.#repositoryCompiler !== undefined &&
              before.parserInput !== null,
          );
          assessment = (
            await assessModelLiveExternalCaseV2_10({
              ...assessmentInput,
              compiler: this.#repositoryCompiler,
              repositoryInput: before.parserInput,
            })
          ).metadata;
        } else if (eventValidator !== undefined) {
          assessment = (
            eventValidator === "2.11.0"
              ? await assessModelLiveEventCaseSuccessorV2({
                  ...assessmentInput,
                  evaluationPolicy:
                    before.plan.definition.policy.evaluationRequirement,
                })
              : await assessModelLiveEventCaseV2(assessmentInput)
          ).metadata;
        } else
          assessment = (
            await (
              evaluationCase.caseKind === "private-vpc-application"
                ? assessModelLivePrivateVpcCaseV2
                : [
                      "nonexistent-unsupported-services",
                      "excessive-resource-request",
                    ].includes(evaluationCase.caseKind)
                  ? assessModelLiveBoundedRefusalCaseV2
                  : assessModelLiveProposalCaseV2
            )(assessmentInput)
          ).metadata;
      }
      requireLiveValidation(
        !aborted() &&
          same(await this.#plans.requireCurrentCase(reference), evaluationCase),
      );
      return await journal.withCompletedOutputMetadata(
        completed,
        async ({ transaction, ...current }) => {
          const beforeJournal = {
            admission: before.admission,
            binding: before.binding,
            commercialWorkflow: before.commercialWorkflow,
            plan: before.plan,
            result: before.result,
          };
          requireLiveValidation(!aborted() && same(current, beforeJournal));
          requireModelLiveEventPolicyParity({
            evaluationPolicy:
              current.plan.definition.policy.evaluationRequirement,
            assessment,
          });
          const b = current.binding;
          const scope = b.scope;
          requireLiveValidation(scope.projectId !== undefined);
          const operation = output.allowListedOperationsEvidence;
          const ownership = output.sourceOwnershipEvidence;
          const rows = await transaction.query(
            sql(
              "SELECT * FROM model_live_runtime_host_evidence WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4 AND case_id=$5 AND invocation_id=$6 AND (evidence_id=$7 OR evidence_id=$8 OR (evidence_kind='input' AND evidence_sha256=$9))",
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                reference.planDigest.slice(7),
                reference.caseId,
                b.invocationId,
                operation.evidenceId,
                ownership.evidenceId,
                current.admission.inputEvidenceDigest.slice(7),
              ],
            ),
          );
          requireLiveValidation(rows.rowCount === 3);
          const inputRow = rows.rows.find(
            (row) => row["evidence_kind"] === "input",
          );
          const inputEvidence = modelRuntimeInputEvidenceV1Schema.parse(
            read(inputRow?.["evidence_record"]),
          );
          for (const evidence of [inputEvidence, operation, ownership]) {
            const row = rows.rows.find(
              (candidate) => candidate["evidence_id"] === evidence.evidenceId,
            );
            requireLiveValidation(
              row?.["evidence_sha256"] === evidence.evidenceDigest.slice(7) &&
                row["case_sha256"] === evaluationCase.caseDigest.slice(7) &&
                row["input_sha256"] === b.inputDigest.slice(7) &&
                row["invocation_sha256"] ===
                  digestStructuredValue(invocation).slice(7) &&
                row["descriptor_sha256"] ===
                  digestStructuredValue(invocation.descriptor).slice(7) &&
                same(read(row["evidence_record"]), evidence),
            );
          }
          requireLiveValidation(
            inputEvidence.evidenceDigest ===
              current.admission.inputEvidenceDigest &&
              assessment.outputDigest === output.outputDigest &&
              assessment.inputDigest === b.inputDigest &&
              output.outputDigest ===
                digestStructuredValue(current.result.response),
          );
          const receipt = identifyLiveProposalValidationReceipt({
            contractVersion: 2,
            recordKind: "model-live-proposal-validation-receipt",
            organizationId: scope.organizationId,
            projectId: scope.projectId,
            userId: scope.userId,
            invocationId: b.invocationId,
            journalBindingDigest: digestStructuredValue(b),
            runtimeRequestDigest: b.runtimeRequestDigest,
            planDigest: b.liveEvaluationPlanDigest,
            approvalDigest: b.liveEvaluationAuthorityDigest,
            inputEvidenceId: inputEvidence.evidenceId,
            inputEvidenceDigest: inputEvidence.evidenceDigest,
            operationsEvidenceId: operation.evidenceId,
            operationsEvidenceDigest: operation.evidenceDigest,
            ownershipEvidenceId: ownership.evidenceId,
            ownershipEvidenceDigest: ownership.evidenceDigest,
            normalizedUsageDigest: digestStructuredValue(current.result.usage),
            assessment,
          });
          await requireModelLiveParserValidationBinding({
            transaction,
            receipt,
            invocationScopeDigest: digestStructuredValue(scope),
            invocationDigest: digestStructuredValue(invocation),
            descriptorDigest: digestStructuredValue(invocation.descriptor),
          });
          await transaction.query(
            sql(
              "INSERT INTO model_live_proposal_validation_receipts (organization_id,project_id,principal_id,invocation_id,receipt_id,receipt_sha256,input_evidence_id,operations_evidence_id,ownership_evidence_id,receipt_record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT (organization_id,project_id,principal_id,invocation_id) DO NOTHING",
              [
                receipt.organizationId,
                receipt.projectId,
                receipt.userId,
                receipt.invocationId,
                receipt.receiptId,
                receipt.receiptDigest.slice(7),
                receipt.inputEvidenceId,
                receipt.operationsEvidenceId,
                receipt.ownershipEvidenceId,
                JSON.stringify(receipt),
              ],
            ),
          );
          const stored = await transaction.query(
            sql(
              "SELECT receipt_sha256,receipt_record FROM model_live_proposal_validation_receipts WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4",
              [
                receipt.organizationId,
                receipt.projectId,
                receipt.userId,
                receipt.invocationId,
              ],
            ),
          );
          requireLiveValidation(
            stored.rowCount === 1 &&
              stored.rows[0]?.["receipt_sha256"] ===
                receipt.receiptDigest.slice(7) &&
              same(
                modelLiveProposalValidationReceiptV2Schema.parse(
                  read(stored.rows[0]["receipt_record"]),
                ),
                receipt,
              ) &&
              !aborted(),
          );
          return receipt;
        },
      );
    } catch {
      throw new ModelLiveProposalValidationError();
    }
  }
}
