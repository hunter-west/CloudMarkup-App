import {
  modelLiveInvocationSetReferenceV2Schema,
  type ModelLiveInvocationSetReferenceV2,
} from "./model-live-invocation-set-codec.js";
import { requireSelectedModelLiveInvocationInTransaction } from "./model-live-invocation-sets.js";
import {
  digestStructuredValue,
  type ModelCommercialWorkflowRecordV1,
  type ModelCommercialDispatchIntentV1,
  type ModelLiveCommercialInvocationRecoveryPortV2,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialOperationRequestV1,
  type ModelGatewayResultV1,
  type ModelInvocationClaimResultV1,
  type ModelInvocationClaimV1,
  type ModelInvocationStore,
  type ModelUsageRecorder,
  type ModelUsageEvidenceSourceV1,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveRuntimeAdmissionRequestV2Schema,
  solutionStableIdSchema,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveRuntimeAdmissionRequestV2,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import {
  liveJournalBindingSchema,
  liveJournalAssert,
  liveJournalJson,
  liveJournalRead,
  liveJournalSame,
  liveJournalScope,
  liveJournalUsage,
  liveJournalGeneration,
  ModelLiveJournalError,
  type ModelLiveJournalBindingV2,
} from "./model-live-invocation-journal-codec.js";
import {
  modelLiveAccountingBindingSchema,
  verifyModelLiveAccountingRuntime,
  MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
  type ModelLiveAccountingBinding,
} from "./model-live-commercial-accounting-codec.js";
import { parseLiveRuntimeRecord } from "./model-live-runtime-admission-codec.js";
import {
  parseWorkflowRecord,
  parseWorkflowRequest,
} from "./model-commercial-workflow-codec.js";
import { parseResult } from "./model-runtime-invocation-codec.js";
import {
  liveJournalCallback,
  liveJournalClaim,
  recoverLiveJournalRow,
} from "./model-live-invocation-recovery-codec.js";
import { readLiveProposalValidationReceipt } from "./model-live-proposal-validation-reader.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { sql, type SqlExecutor, type SqlRow } from "./sql.js";

const hex = (value: string) => value.slice(7);
/** Host-only invocation/usage metadata. Never stores prompts or output bodies.
 * Preparation and output acceptance require current approval; recording actual
 * usage and failure after withdrawal remains possible for financial recovery.
 * This journal does not validate a design, settle credits or authorize dispatch.
 * The real host still owns the final HTTP spend/approval fence. */
export class PostgresModelLiveInvocationJournal
  implements
    ModelInvocationStore,
    ModelUsageRecorder,
    ModelUsageEvidenceSourceV1,
    ModelLiveCommercialInvocationRecoveryPortV2
{
  readonly #binding: ModelLiveJournalBindingV2;
  readonly #request: ModelCommercialOperationRequestV1;
  readonly #admission: ModelLiveRuntimeAdmissionRequestV2;
  readonly #accounting: ModelLiveAccountingBinding;
  readonly #plans: PostgresModelLiveEvaluationPlans;
  readonly #definitionId: string;
  readonly #selectedInvocationSet:
    ModelLiveInvocationSetReferenceV2 | undefined;
  constructor(input: {
    readonly binding: ModelLiveJournalBindingV2;
    readonly request: ModelCommercialOperationRequestV1;
    readonly admissionRequest: ModelLiveRuntimeAdmissionRequestV2;
    readonly accountingBinding: ModelLiveAccountingBinding;
    readonly plans: PostgresModelLiveEvaluationPlans;
    readonly definitionId: string;
    /** Explicit private selected V2 path; absent for historical reads/recovery. */
    readonly selectedInvocationSet?: ModelLiveInvocationSetReferenceV2;
  }) {
    try {
      this.#selectedInvocationSet =
        input.selectedInvocationSet === undefined
          ? undefined
          : modelLiveInvocationSetReferenceV2Schema.parse(
              input.selectedInvocationSet,
            );
      this.#binding = liveJournalBindingSchema.parse(input.binding);
      this.#request = parseWorkflowRequest(
        input.request,
        liveJournalScope(this.#binding),
      );
      this.#admission = modelLiveRuntimeAdmissionRequestV2Schema.parse(
        input.admissionRequest,
      );
      this.#accounting = modelLiveAccountingBindingSchema.parse(
        input.accountingBinding,
      );
      this.#plans = input.plans;
      this.#definitionId = solutionStableIdSchema.parse(input.definitionId);
      const b = this.#binding,
        a = this.#admission;
      liveJournalAssert(
        b.requestDigest === digestStructuredValue(this.#request) &&
          b.scope.jobId === this.#request.jobId &&
          b.runtimeRequestDigest === a.requestDigest &&
          b.accountingBindingDigest ===
            digestStructuredValue(this.#accounting) &&
          b.liveEvaluationPlanDigest === a.liveEvaluationPlanDigest &&
          b.liveEvaluationAuthorityDigest === a.liveEvaluationAuthorityDigest &&
          b.evaluationCaseId === a.evaluationCaseId &&
          b.evaluationCaseDigest === a.evaluationCaseDigest &&
          b.inputDigest === a.inputDigest &&
          b.idempotencyKeyDigest === a.idempotencyKeyDigest,
      );
      liveJournalJson(b);
    } catch {
      throw new ModelLiveJournalError();
    }
  }
  get binding(): ModelLiveJournalBindingV2 {
    return structuredClone(this.#binding);
  }
  #keys() {
    const b = this.#binding;
    return [
      b.scope.organizationId,
      b.scope.projectId ?? null,
      b.scope.userId,
      b.invocationId,
    ];
  }
  async #transaction<T>(
    work: (
      tx: SqlExecutor,
      callback: ModelCommercialInvocationContextV1,
      dispatch: ModelCommercialDispatchIntentV1,
      workflow: ModelCommercialWorkflowRecordV1,
      plan: ModelLiveEvaluationPlanV2,
    ) => Promise<T>,
    current = false,
    active = false,
  ): Promise<T> {
    try {
      return await this.#plans.withIssuedMetadata(
        {
          definitionId: this.#definitionId,
          planDigest: this.#binding.liveEvaluationPlanDigest,
        },
        async ({ transaction: tx, plan, requireCurrentApproval }) => {
          if (current) await requireCurrentApproval();
          const scope = liveJournalScope(this.#binding);
          // Same organization -> plan -> workflow -> runtime -> journal order as
          // shared accounting. Do not perform provider calls in this transaction.
          const row = (
            await tx.query(
              sql(
                `SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active
          FROM model_commercial_workflows WHERE organization_id=$1 AND project_id=$2
          AND principal_id=$3 AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE`,
                [
                  ...this.#keys().slice(0, 3),
                  this.#request.multiCallWorkflowId,
                  hex(scope.tenantScopeDigest),
                ],
              ),
            )
          ).rows[0];
          const runtimeRow = (
            await tx.query(
              sql(
                `SELECT snapshot,snapshot_sha256,lease_expires_at>clock_timestamp() AS active
          FROM model_runtime_admissions WHERE organization_id=$1 AND project_id=$2
          AND principal_id=$3 AND scope_sha256=$4 FOR SHARE`,
                [
                  ...this.#keys().slice(0, 3),
                  hex(this.#accounting.runtimeScopeDigest),
                ],
              ),
            )
          ).rows[0];
          liveJournalAssert(row !== undefined && runtimeRow !== undefined);
          const workflow = parseWorkflowRecord(
            liveJournalRead(row["snapshot"]),
            scope,
          );
          const runtime = parseLiveRuntimeRecord(
            liveJournalRead(runtimeRow["snapshot"]),
            scope,
          );
          verifyModelLiveAccountingRuntime(
            workflow,
            runtime,
            this.#accounting,
            plan,
          );
          liveJournalAssert(
            row["snapshot_sha256"] === hex(digestStructuredValue(workflow)) &&
              runtimeRow["snapshot_sha256"] ===
                hex(digestStructuredValue(runtime)) &&
              liveJournalSame(workflow.request, this.#request) &&
              liveJournalSame(runtime.request, this.#admission) &&
              workflow.reservationReceipt?.result.accepted === true &&
              workflow.reservationReceipt.result.reservationId ===
                this.#request.reservationId &&
              workflow.dispatchIntent !== null &&
              (!active ||
                (row["active"] === true &&
                  runtimeRow["active"] === true &&
                  runtime.executionLease?.recoveryOnly === false &&
                  !runtime.recoveryRequired)),
          );
          const reservation = (
            await tx.query(
              sql(
                `SELECT live_binding,live_binding_sha256,accepted FROM model_commercial_reservation_decisions
          WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
          AND workflow_id=$4 AND scope_sha256=$5 AND mapping_version=$6 FOR SHARE`,
                [
                  ...this.#keys().slice(0, 3),
                  this.#request.multiCallWorkflowId,
                  hex(scope.tenantScopeDigest),
                  MODEL_LIVE_ACCOUNTING_WINDOW_MAPPING,
                ],
              ),
            )
          ).rows[0];
          liveJournalAssert(
            reservation !== undefined &&
              liveJournalSame(
                liveJournalRead(reservation["live_binding"]),
                this.#accounting,
              ) &&
              reservation["live_binding_sha256"] ===
                hex(this.#binding.accountingBindingDigest),
          );
          // Receipt replay flags vary; canonical reservation identity/acceptance do not.
          liveJournalAssert(reservation["accepted"] === true);
          const result = await work(
            tx,
            liveJournalCallback(workflow),
            workflow.dispatchIntent,
            workflow,
            plan,
          );
          if (active) {
            const currentLease = await tx.query(
              sql(
                "SELECT (w.lease_expires_at>clock_timestamp() AND r.lease_expires_at>clock_timestamp()) AS active FROM model_commercial_workflows w JOIN model_runtime_admissions r ON r.organization_id=w.organization_id AND r.project_id=w.project_id AND r.principal_id=w.principal_id WHERE w.organization_id=$1 AND w.project_id=$2 AND w.principal_id=$3 AND w.workflow_id=$4 AND w.scope_sha256=$5 AND r.scope_sha256=$6",
                [
                  ...this.#keys().slice(0, 3),
                  this.#request.multiCallWorkflowId,
                  hex(scope.tenantScopeDigest),
                  hex(this.#accounting.runtimeScopeDigest),
                ],
              ),
            );
            liveJournalAssert(
              currentLease.rowCount === 1 &&
                currentLease.rows[0]?.["active"] === true,
            );
          }
          return result;
        },
      );
    } catch {
      throw new ModelLiveJournalError();
    }
  }
  async #load(
    tx: SqlExecutor,
    callback: ModelCommercialInvocationContextV1,
  ): Promise<SqlRow | null> {
    const row = (
      await tx.query(
        sql(
          `SELECT * FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2
      AND principal_id=$3 AND invocation_id=$4 FOR UPDATE`,
          this.#keys(),
        ),
      )
    ).rows[0];
    if (row === undefined) return null;
    liveJournalAssert(
      liveJournalSame(liveJournalRead(row["binding"]), this.#binding) &&
        row["binding_sha256"] === hex(digestStructuredValue(this.#binding)) &&
        liveJournalSame(liveJournalRead(row["callback_metadata"]), callback),
    );
    return row;
  }

  /** Authenticate existing journal metadata only. A complete model response is
   * still pending until a separate deterministic validator receipt is issued.
   * Unknown failed usage stays pending so a late actual receipt can recover. */
  async recoverVerified(
    input: Parameters<
      ModelLiveCommercialInvocationRecoveryPortV2["recoverVerified"]
    >[0],
  ): ReturnType<
    ModelLiveCommercialInvocationRecoveryPortV2["recoverVerified"]
  > {
    liveJournalAssert(
      liveJournalSame(input.request, this.#request) &&
        liveJournalSame(input.admissionRequest, this.#admission),
    );
    return this.#transaction(async (tx, callback, dispatch, workflow) => {
      liveJournalAssert(liveJournalSame(input.dispatchIntent, dispatch));
      const row = await this.#load(tx, callback);
      const receipt =
        row === null
          ? null
          : await readLiveProposalValidationReceipt(tx, row, this.#admission);
      return recoverLiveJournalRow(
        row,
        workflow,
        this.#admission,
        digestStructuredValue(this.#accounting),
        this.#binding,
        receipt,
      );
    });
  }

  /** Current authorized metadata read. This does not re-run a validator or
   * return a response body. The shared reader authenticates the actual receipt,
   * frozen case, output digest, usage and all three durable host evidence rows. */
  async readValidatedUsage() {
    const evaluationCase = await this.#plans.requireCurrentCase({
      definitionId: this.#definitionId,
      planDigest: this.#binding.liveEvaluationPlanDigest,
      caseId: this.#binding.evaluationCaseId,
    });
    return this.#transaction(
      async (tx, callback, _dispatch, _workflow, plan) => {
        const row = await this.#load(tx, callback);
        liveJournalAssert(row !== null && row["gateway_state"] === "complete");
        const receipt = await readLiveProposalValidationReceipt(
          tx,
          row,
          this.#admission,
        );
        liveJournalAssert(receipt !== null);
        const usage = this.#usage(
          liveJournalRead(row["normalized_usage"]),
          callback,
        );
        liveJournalAssert(usage.result === "succeeded");
        const binding = plan.definition.cases.find(
          (c) => c.caseId === receipt.assessment.caseId,
        );
        liveJournalAssert(
          evaluationCase.caseId === binding?.caseId &&
            evaluationCase.caseDigest === binding.caseDigest &&
            digestStructuredValue(evaluationCase.input) ===
              binding.sourceInputDigest &&
            binding.authorityBinding.authorityTupleDigest ===
              this.#admission.evaluationAuthorityTupleDigest,
        );
        return {
          receipt,
          usage,
          evaluationCase,
          authorityBinding: binding.authorityBinding,
        };
      },
      true,
    );
  }

  async prepare(raw: ModelCommercialInvocationContextV1): Promise<void> {
    await this.#transaction(
      async (tx, callback, _dispatch, _workflow, plan) => {
        if (this.#selectedInvocationSet !== undefined) {
          await requireSelectedModelLiveInvocationInTransaction({
            transaction: tx,
            plan,
            reference: this.#selectedInvocationSet,
            selected: {
              caseId: this.#binding.evaluationCaseId,
              caseDigest: this.#binding.evaluationCaseDigest,
              invocationId: this.#binding.invocationId,
            },
          });
        }
        liveJournalAssert(liveJournalSame(raw, callback));
        if ((await this.#load(tx, callback)) !== null) return;
        await tx.query(
          sql(
            `INSERT INTO model_live_invocations
        (organization_id,project_id,principal_id,invocation_id,scope_sha256,workflow_id,
        reservation_id,dispatch_intent_id,binding_sha256,binding,callback_metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
            [
              ...this.#keys(),
              hex(liveJournalScope(this.#binding).tenantScopeDigest),
              this.#request.multiCallWorkflowId,
              this.#request.reservationId,
              callback.dispatchIntentId,
              hex(digestStructuredValue(this.#binding)),
              liveJournalJson(this.#binding),
              liveJournalJson(callback),
            ],
          ),
        );
      },
      true,
      true,
    );
  }
  #claim(raw: unknown) {
    return liveJournalClaim(raw, this.#binding);
  }
  async claim(
    raw: ModelInvocationClaimV1,
  ): Promise<ModelInvocationClaimResultV1> {
    const claim = this.#claim(raw);
    return this.#transaction(
      async (tx, callback) => {
        const row = await this.#load(tx, callback);
        liveJournalAssert(row !== null);
        if (
          row["gateway_claim"] !== null &&
          !liveJournalSame(liveJournalRead(row["gateway_claim"]), claim)
        )
          return { kind: "conflict" };
        if (["complete", "failed"].includes(String(row["gateway_state"])))
          return { kind: "duplicate-result-unavailable" };
        if (row["gateway_state"] === "claimed")
          return { kind: "duplicate-in-progress" };
        liveJournalAssert(row["gateway_state"] === "registered");
        await tx.query(
          sql(
            `UPDATE model_live_invocations SET gateway_state='claimed',gateway_claim=$5::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
            [...this.#keys(), liveJournalJson(claim, 1024)],
          ),
        );
        return { kind: "claimed" };
      },
      true,
      true,
    );
  }
  #usage(raw: unknown, callback: ModelCommercialInvocationContextV1) {
    return liveJournalUsage(
      raw,
      this.#binding,
      callback,
      this.#request,
      this.#admission,
    );
  }
  #generation(usage: NormalizedModelUsageV1, failed: boolean) {
    return liveJournalGeneration(
      usage,
      this.#binding,
      this.#request,
      this.#admission,
      failed,
    );
  }
  async record(raw: NormalizedModelUsageV1): Promise<void> {
    await this.#transaction(async (tx, callback) => {
      const row = await this.#load(tx, callback);
      liveJournalAssert(row !== null && row["gateway_claim"] !== null);
      const usage = this.#usage(raw, callback);
      if (row["normalized_usage"] !== null) {
        liveJournalAssert(
          liveJournalSame(liveJournalRead(row["normalized_usage"]), usage),
        );
        return;
      }
      liveJournalAssert(
        ["claimed", "failed"].includes(String(row["gateway_state"])),
      );
      const generation =
        row["gateway_state"] === "failed"
          ? this.#generation(usage, true)
          : null;
      await tx.query(
        sql(
          `UPDATE model_live_invocations SET normalized_usage=$5::jsonb,generation_evidence=$6::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [
            ...this.#keys(),
            liveJournalJson(usage),
            generation === null ? null : liveJournalJson(generation),
          ],
        ),
      );
    });
  }
  async listByInvocationId(
    id: string,
  ): Promise<readonly NormalizedModelUsageV1[]> {
    liveJournalAssert(id === this.#binding.invocationId);
    return this.#transaction(async (tx, callback) => {
      const row = await this.#load(tx, callback);
      return row === null || row["normalized_usage"] === null
        ? []
        : [this.#usage(liveJournalRead(row["normalized_usage"]), callback)];
    });
  }
  async complete(
    rawClaim: ModelInvocationClaimV1,
    raw: ModelGatewayResultV1,
  ): Promise<void> {
    const claim = this.#claim(rawClaim);
    let result: ModelGatewayResultV1;
    try {
      result = parseResult(raw, claim, this.#binding.scope);
    } catch {
      throw new ModelLiveJournalError();
    }
    await this.#transaction(async (tx, callback) => {
      const row = await this.#load(tx, callback);
      liveJournalAssert(
        row !== null &&
          row["gateway_state"] === "claimed" &&
          liveJournalSame(liveJournalRead(row["gateway_claim"]), claim) &&
          liveJournalSame(
            liveJournalRead(row["normalized_usage"]),
            result.usage,
          ) &&
          result.descriptor.promptDigest ===
            this.#admission.promptTemplateDigest &&
          result.descriptor.budgetDecisionId === this.#request.reservationId,
      );
      const usage = this.#usage(result.usage, callback);
      const encoded = liveJournalJson(
        result.response,
        this.#admission.requested.outputBytes,
      );
      await tx.query(
        sql(
          `UPDATE model_live_invocations SET gateway_state='complete',generation_evidence=$5::jsonb,
        output_sha256=$6,output_bytes=$7 WHERE organization_id=$1 AND project_id=$2
        AND principal_id=$3 AND invocation_id=$4`,
          [
            ...this.#keys(),
            liveJournalJson(this.#generation(usage, false)),
            hex(digestStructuredValue(result.response)),
            new TextEncoder().encode(encoded).length,
          ],
        ),
      );
    }, true);
  }
  /** Owns a current, active journal transaction for deterministic host receipts.
   * The result must match the actual completed invocation, normalized usage and
   * canonical generation. This is not a design/compiler/quality validator.
   * Only bounded metadata work belongs in the callback; never invoke providers.
   * Transaction handles expire with the owning issued-plan transaction. */
  async withCompletedOutputMetadata<T>(
    raw: ModelGatewayResultV1,
    work: (context: {
      readonly admission: ModelLiveRuntimeAdmissionRequestV2;
      readonly binding: ModelLiveJournalBindingV2;
      readonly commercialWorkflow: ModelCommercialWorkflowRecordV1;
      readonly plan: ModelLiveEvaluationPlanV2;
      readonly result: ModelGatewayResultV1;
      readonly transaction: SqlExecutor;
    }) => Promise<T>,
  ): Promise<T> {
    let candidate: ModelGatewayResultV1;
    try {
      candidate = structuredClone(raw);
    } catch {
      throw new ModelLiveJournalError();
    }
    return this.#transaction(
      async (tx, callback, _dispatch, workflow, plan) => {
        const row = await this.#load(tx, callback);
        liveJournalAssert(row !== null && row["gateway_state"] === "complete");
        const claim = this.#claim(liveJournalRead(row["gateway_claim"]));
        const result = parseResult(candidate, claim, this.#binding.scope);
        const usage = this.#usage(result.usage, callback);
        const generation = this.#generation(usage, false);
        liveJournalAssert(
          liveJournalSame(liveJournalRead(row["normalized_usage"]), usage) &&
            liveJournalSame(
              liveJournalRead(row["generation_evidence"]),
              generation,
            ) &&
            row["output_sha256"] ===
              hex(digestStructuredValue(result.response)) &&
            row["output_bytes"] ===
              new TextEncoder().encode(
                liveJournalJson(
                  result.response,
                  this.#admission.requested.outputBytes,
                ),
              ).length &&
            result.descriptor.promptDigest ===
              this.#admission.promptTemplateDigest &&
            result.descriptor.budgetDecisionId === this.#request.reservationId,
        );
        const exposed = {
          admission: modelLiveRuntimeAdmissionRequestV2Schema.parse(
            this.#admission,
          ),
          binding: liveJournalBindingSchema.parse(this.#binding),
          commercialWorkflow: structuredClone(workflow),
          plan,
          result,
        };
        const before = digestStructuredValue(exposed);
        const returned = await work({ ...exposed, transaction: tx });
        liveJournalAssert(digestStructuredValue(exposed) === before);
        return returned;
      },
      true,
      true,
    );
  }

  async fail(
    rawClaim: ModelInvocationClaimV1,
    safeCode: string,
  ): Promise<void> {
    // Provider text is not part of persistent metadata.
    void safeCode;
    const claim = this.#claim(rawClaim);
    await this.#transaction(async (tx, callback) => {
      const row = await this.#load(tx, callback);
      liveJournalAssert(
        row !== null &&
          liveJournalSame(liveJournalRead(row["gateway_claim"]), claim),
      );
      if (["complete", "failed"].includes(String(row["gateway_state"]))) return;
      liveJournalAssert(row["gateway_state"] === "claimed");
      const generation =
        row["normalized_usage"] === null
          ? null
          : this.#generation(
              this.#usage(liveJournalRead(row["normalized_usage"]), callback),
              true,
            );
      await tx.query(
        sql(
          `UPDATE model_live_invocations SET gateway_state='failed',generation_evidence=$5::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [
            ...this.#keys(),
            generation === null ? null : liveJournalJson(generation),
          ],
        ),
      );
    });
  }
}
