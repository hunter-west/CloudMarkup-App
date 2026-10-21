import { createHash, randomBytes } from "node:crypto";
import {
  digestStructuredValue,
  intentPreviewCommercialOutcomeV1,
  modelUsageToCommercialAttemptV1,
  parseIntentPreviewGenerationEvidenceV1,
  type IntentPreviewGenerationEvidenceV1,
  type ModelCommercialInvocationContextV1,
  type ModelCommercialInvocationRecoveryPortV1,
  type ModelGatewayResultV1,
  type ModelInvocationClaimResultV1,
  type ModelInvocationClaimV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
} from "@cloudmarkup/model-gateway";
import {
  normalizedModelUsageV1Schema,
  type NormalizedModelUsageV1,
} from "@cloudmarkup/schemas";
import {
  AiIntentPreviewError,
  type AiIntentPreviewBindingV1,
  type AiIntentPreviewDeliveryOutcomeV1,
  type AiIntentPreviewDeliveryProofV1,
  type AiIntentPreviewJournalV1,
} from "../../application/ai-intent-preview-journal.js";
import {
  aiPreviewProofSchema,
  parsePreviewBinding,
  previewAssert,
  previewCallback,
  previewChecked,
  previewGeneration,
  previewJson,
  previewReadJson,
  previewSame,
  previewScope,
} from "./ai-intent-preview-codec.js";
import { parseWorkflowRecord } from "./model-commercial-workflow-codec.js";
import { parseClaim, parseResult } from "./model-runtime-invocation-codec.js";
import {
  PreviewRequestAuthority,
  previewHashMatches,
  type AiIntentPreviewRequestAuthorityV1,
} from "./ai-intent-preview-request-authority.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

const hex = (value: string) => value.slice("sha256:".length);
const proofHash = (value: string) =>
  createHash("sha256").update(value, "ascii").digest("hex");

/** Host-only scoped adapter, not an authentication boundary. Its binding MUST
 * be derived by the verified host, never deserialized as public authority.
 * Request/ACK transports must check current authentication and expiry before
 * calling it; recovery must use its existing verified scope, not mint a user.
 * Transactions additionally recheck current tenant/project/role membership.
 * No method exposes content, grants invocation or mutates either ledger. */
export class PostgresAiIntentPreviewJournal implements AiIntentPreviewJournalV1 {
  readonly #database: SqlDatabase;
  readonly #binding: AiIntentPreviewBindingV1;
  readonly #requestAuthority: PreviewRequestAuthority | undefined;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly binding: AiIntentPreviewBindingV1;
    /** Required by the production factory; omitted only by historical internal
     * metadata journals, never a public request authentication fallback. */
    readonly requestAuthority?: AiIntentPreviewRequestAuthorityV1;
  }) {
    this.#database = input.database;
    try {
      this.#binding = parsePreviewBinding(input.binding);
      this.#requestAuthority =
        input.requestAuthority === undefined
          ? undefined
          : new PreviewRequestAuthority(input.requestAuthority);
    } catch {
      throw new AiIntentPreviewError();
    }
  }
  get binding(): AiIntentPreviewBindingV1 {
    return structuredClone(this.#binding);
  }
  #values() {
    return [
      this.#binding.scope.organizationId,
      this.#binding.scope.projectId ?? null,
      this.#binding.scope.userId,
      this.#binding.invocationId,
    ];
  }
  async #transaction<T>(
    work: (tx: SqlExecutor) => Promise<T>,
    requestMode?: "issue" | "require",
  ): Promise<T> {
    try {
      return await this.#database.transaction(async (tx) => {
        const scope = this.#binding.scope;
        // Editing authority locks project -> lease -> draft before the existing
        // workflow -> preview order. Do not require live editing for post-call
        // usage recording or conservative accounting recovery.
        if (requestMode !== undefined && this.#requestAuthority !== undefined)
          await this.#requestAuthority.assertCurrent(
            tx,
            scope,
            requestMode === "require" ? this.#binding : undefined,
          );
        const authority = await tx.query(
          sql(
            `SELECT 1 AS authorized FROM memberships m
          JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
            AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
            AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
          FOR SHARE OF m,p,o,r,pr`,
            [scope.organizationId, scope.projectId ?? null, scope.userId],
          ),
        );
        previewAssert(authority.rowCount === 1);
        // Match terminal accounting's workflow -> preview order. Public ACK
        // and recovery never acquire a preview row first and then wait for a
        // workflow held by settlement. This is a lock, not a lease grant.
        const workflowScope = previewScope(this.#binding);
        await tx.query(
          sql(
            `SELECT 1 FROM model_commercial_workflows
            WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
              AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE`,
            [
              scope.organizationId,
              scope.projectId ?? null,
              scope.userId,
              this.#binding.request.multiCallWorkflowId,
              hex(workflowScope.tenantScopeDigest),
            ],
          ),
        );
        const result = await work(tx);
        if (requestMode !== undefined && this.#requestAuthority !== undefined) {
          if (requestMode === "issue")
            await this.#requestAuthority.issue(tx, this.#binding);
          else
            await this.#requestAuthority.assertCurrent(
              tx,
              scope,
              this.#binding,
            );
        }
        return result;
      });
    } catch {
      throw new AiIntentPreviewError();
    }
  }
  async #load(tx: SqlExecutor): Promise<SqlRow | null> {
    const rows = await tx.query(
      sql(
        `SELECT *,
      to_char(delivery_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso
      FROM ai_intent_previews WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 FOR UPDATE`,
        this.#values(),
      ),
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    previewAssert(
      previewSame(previewReadJson(row["binding"]), this.#binding) &&
        row["binding_sha256"] === hex(digestStructuredValue(this.#binding)),
    );
    return row;
  }
  async #canonical(
    tx: SqlExecutor,
    dispatchIntentId: string,
    requireActive: boolean,
  ) {
    const request = this.#binding.request;
    const scope = previewScope(this.#binding);
    const rows = await tx.query(
      sql(
        `SELECT snapshot,lease_expires_at>clock_timestamp() AS lease_active
      FROM model_commercial_workflows WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3
        AND workflow_id=$4 AND scope_sha256=$5 FOR SHARE`,
        [
          scope.organizationId,
          scope.projectId,
          scope.userId,
          request.multiCallWorkflowId,
          hex(scope.tenantScopeDigest),
        ],
      ),
    );
    const row = rows.rows[0];
    previewAssert(
      row !== undefined && (!requireActive || row["lease_active"] === true),
    );
    const record = parseWorkflowRecord(previewReadJson(row["snapshot"]), scope);
    previewAssert(
      previewSame(record.request, request) &&
        record.dispatchIntent?.dispatchIntentId === dispatchIntentId &&
        record.reservationReceipt?.result.accepted === true &&
        record.reservationReceipt.result.reservationId ===
          request.reservationId,
    );
    return record;
  }
  async prepare(raw: ModelCommercialInvocationContextV1): Promise<void> {
    const callback = previewChecked(() => previewCallback(raw));
    await this.#transaction(async (tx) => {
      const canonical = await this.#canonical(
        tx,
        callback.dispatchIntentId,
        true,
      );
      const resolved = canonical.resolvedContext;
      previewAssert(
        resolved !== null &&
          previewSame(callback.route, resolved.selectedRoute) &&
          callback.multiCallWorkflowId ===
            this.#binding.request.multiCallWorkflowId &&
          callback.reservationId === this.#binding.request.reservationId &&
          callback.acceptedMaximumCreditUnits ===
            resolved.estimateResult.estimate.maximumCreditUnits &&
          callback.acceptedMaximumEstimatedProviderCostMicros ===
            resolved.estimateResult.maximumEstimatedProviderCostMicros &&
          callback.pricingAuthorityDigest ===
            resolved.estimateResult.pricingAuthority.authorityDigest &&
          callback.pricingCatalogDigest ===
            resolved.estimateResult.pricingAuthority.pricingCatalogDigest &&
          callback.normalizationPolicyCatalogDigest ===
            resolved.estimateResult.pricingAuthority
              .normalizationPolicyCatalogDigest &&
          callback.pricingVersionReference ===
            resolved.estimateResult.primaryPricingVersionId &&
          callback.normalizationPolicyVersionReference ===
            resolved.estimateResult.normalizationPolicyVersionId,
      );
      const existing = await this.#load(tx);
      if (existing !== null) {
        previewAssert(
          previewSame(previewReadJson(existing["callback_metadata"]), callback),
        );
        return;
      }
      await tx.query(
        sql(
          `INSERT INTO ai_intent_previews
        (organization_id,project_id,principal_id,invocation_id,scope_sha256,workflow_id,reservation_id,dispatch_intent_id,
        idempotency_sha256,binding_sha256,binding,callback_metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
          [
            ...this.#values(),
            hex(previewScope(this.#binding).tenantScopeDigest),
            this.#binding.request.multiCallWorkflowId,
            this.#binding.request.reservationId,
            callback.dispatchIntentId,
            hex(this.#binding.idempotencyKeyDigest),
            hex(digestStructuredValue(this.#binding)),
            previewJson(this.#binding),
            previewJson(callback, 4096),
          ],
        ),
      );
    }, "issue");
  }
  #claim(raw: ModelInvocationClaimV1) {
    const claim = previewChecked(() => parseClaim(raw));
    previewAssert(
      claim.escalation === undefined &&
        claim.invocationId === this.#binding.invocationId &&
        claim.inputDigest === this.#binding.inputDigest &&
        claim.idempotencyKeyDigest === this.#binding.idempotencyKeyDigest,
    );
    previewJson(claim, 1024);
    return claim;
  }
  async claim(
    raw: ModelInvocationClaimV1,
  ): Promise<ModelInvocationClaimResultV1> {
    const claim = this.#claim(raw);
    return this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(row !== null);
      if (
        row["gateway_claim"] !== null &&
        !previewSame(previewReadJson(row["gateway_claim"]), claim)
      )
        return { kind: "conflict" };
      if (
        row["gateway_state"] === "complete" ||
        row["gateway_state"] === "failed"
      )
        return { kind: "duplicate-result-unavailable" };
      if (row["gateway_state"] === "claimed")
        return { kind: "duplicate-in-progress" };
      previewAssert(row["gateway_state"] === "registered");
      await this.#canonical(tx, String(row["dispatch_intent_id"]), true);
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET gateway_state='claimed',gateway_claim=$5::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [...this.#values(), previewJson(claim, 1024)],
        ),
      );
      return { kind: "claimed" };
    }, "require");
  }
  #usage(
    raw: unknown,
    callback: ModelCommercialInvocationContextV1,
  ): NormalizedModelUsageV1 {
    const usage = normalizedModelUsageV1Schema.parse(raw);
    previewAssert(
      usage.attemptNumber === 1 &&
        usage.feature === "intent.extract" &&
        usage.invocationId === this.#binding.invocationId &&
        usage.inputDigest === this.#binding.inputDigest &&
        usage.idempotencyKeyDigest === this.#binding.idempotencyKeyDigest &&
        previewSame(usage.scope, this.#binding.scope) &&
        usage.routing?.routeId === "standard-design" &&
        usage.modelId === callback.route.modelId &&
        usage.modelVersion === callback.route.modelVersion &&
        usage.providerId === callback.route.providerKey &&
        (usage.inferenceProfileId ?? null) ===
          callback.route.inferenceProfileId &&
        usage.promptTemplateId === this.#binding.request.promptId &&
        usage.promptVersion === this.#binding.request.promptVersion,
    );
    previewJson(usage, 4096);
    this.#generation(
      usage,
      usage.result === "succeeded" ? null : "model-gateway.invalid-output",
    );
    return usage;
  }
  #generation(
    usage: NormalizedModelUsageV1,
    failureCode: string | null,
  ): IntentPreviewGenerationEvidenceV1 {
    return parseIntentPreviewGenerationEvidenceV1(
      {
        attempts: [modelUsageToCommercialAttemptV1(usage)],
        completedAt: usage.completedAt,
        failureCategory: failureCode,
        resultId: `result_${hex(
          digestStructuredValue({
            invocationId: this.#binding.invocationId,
            multiCallWorkflowId: this.#binding.request.multiCallWorkflowId,
          }),
        ).slice(0, 48)}`,
        status: failureCode === null ? "completed" : "internal-failure",
      },
      this.#binding.request,
    );
  }
  async record(raw: NormalizedModelUsageV1): Promise<void> {
    await this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(row !== null && row["gateway_claim"] !== null);
      const usage = this.#usage(
        raw,
        previewCallback(
          previewReadJson(
            row["callback_metadata"],
          ) as ModelCommercialInvocationContextV1,
        ),
      );
      if (row["normalized_usage"] !== null) {
        previewAssert(
          previewSame(previewReadJson(row["normalized_usage"]), usage),
        );
        return;
      }
      previewAssert(row["gateway_state"] === "claimed");
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET normalized_usage=$5::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [...this.#values(), previewJson(usage, 4096)],
        ),
      );
    });
  }
  async listByInvocationId(
    invocationId: string,
  ): Promise<readonly NormalizedModelUsageV1[]> {
    previewAssert(invocationId === this.#binding.invocationId);
    return this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      if (row === null || row["normalized_usage"] === null) return [];
      return [
        this.#usage(
          previewReadJson(row["normalized_usage"]),
          previewCallback(
            previewReadJson(
              row["callback_metadata"],
            ) as ModelCommercialInvocationContextV1,
          ),
        ),
      ];
    });
  }
  async complete(
    rawClaim: ModelInvocationClaimV1,
    raw: ModelGatewayResultV1,
  ): Promise<void> {
    const claim = this.#claim(rawClaim);
    const result = previewChecked(() =>
      parseResult(raw, claim, this.#binding.scope),
    );
    previewAssert(
      result.response.operation === "intent.extract" &&
        result.descriptor.routing?.routeId === "standard-design",
    );
    await this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(
        row !== null &&
          row["gateway_state"] === "claimed" &&
          previewSame(previewReadJson(row["gateway_claim"]), claim) &&
          previewSame(previewReadJson(row["normalized_usage"]), result.usage),
      );
      const usage = this.#usage(
        result.usage,
        previewCallback(
          previewReadJson(
            row["callback_metadata"],
          ) as ModelCommercialInvocationContextV1,
        ),
      );
      const generation = this.#generation(usage, null);
      const outputBytes = new TextEncoder().encode(
        previewJson(result.response, 16777216),
      ).length;
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET gateway_state='complete',generation_evidence=$5::jsonb,output_sha256=$6,output_bytes=$7
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [
            ...this.#values(),
            previewJson(generation, 4096),
            hex(digestStructuredValue(result.response)),
            outputBytes,
          ],
        ),
      );
    });
  }
  async fail(
    rawClaim: ModelInvocationClaimV1,
    safeCode: string,
  ): Promise<void> {
    // Deliberately ignore arbitrary caller/provider text; persist only a closed code.
    void safeCode;
    const claim = this.#claim(rawClaim);
    await this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(
        row !== null &&
          previewSame(previewReadJson(row["gateway_claim"]), claim),
      );
      if (
        row["gateway_state"] === "complete" ||
        row["gateway_state"] === "failed"
      )
        return;
      previewAssert(row["gateway_state"] === "claimed");
      const generation =
        row["normalized_usage"] === null
          ? null
          : this.#generation(
              this.#usage(
                previewReadJson(row["normalized_usage"]),
                previewCallback(
                  previewReadJson(
                    row["callback_metadata"],
                  ) as ModelCommercialInvocationContextV1,
                ),
              ),
              "model-gateway.internal-error",
            );
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET gateway_state='failed',generation_evidence=$5::jsonb
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          [
            ...this.#values(),
            generation === null ? null : previewJson(generation, 4096),
          ],
        ),
      );
    });
  }
  async prepareDelivery(
    evidence: ModelRuntimeSanitizedOutputEvidenceV1,
  ): Promise<AiIntentPreviewDeliveryProofV1> {
    return this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(
        row !== null &&
          row["gateway_state"] === "complete" &&
          row["delivery_state"] === "none",
      );
      previewAssert(
        evidence.outputDigest === `sha256:${String(row["output_sha256"])}` &&
          evidence.outputBytes === Number(row["output_bytes"]),
      );
      await this.#canonical(tx, String(row["dispatch_intent_id"]), true);
      for (const record of [
        evidence.allowListedOperationsEvidence,
        evidence.sourceOwnershipEvidence,
      ]) {
        previewAssert(
          record.organizationId === this.#binding.scope.organizationId &&
            record.projectId === this.#binding.scope.projectId &&
            record.inputDigest === this.#binding.inputDigest &&
            record.outputDigest === evidence.outputDigest &&
            record.operation === "intent.extract",
        );
        const issued = await tx.query(
          sql(
            `SELECT 1 AS issued FROM model_runtime_host_evidence
          WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND evidence_sha256=$4 AND evidence_record=$5::jsonb`,
            [
              ...this.#values().slice(0, 3),
              hex(record.evidenceDigest),
              previewJson(record),
            ],
          ),
        );
        previewAssert(issued.rowCount === 1);
      }
      const token = randomBytes(32).toString("base64url");
      const opened = await tx.query(
        sql(
          `WITH stamp AS MATERIALIZED (SELECT date_trunc('milliseconds',clock_timestamp()) AS now)
        UPDATE ai_intent_previews SET delivery_state='pending',delivery_proof_sha256=$5,
        output_evidence_sha256=$6,delivery_opened_at=stamp.now,
        delivery_expires_at=stamp.now+INTERVAL '30 seconds' FROM stamp
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4
        RETURNING to_char(delivery_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expiry_iso`,
          [
            ...this.#values(),
            proofHash(token),
            hex(digestStructuredValue(evidence)),
          ],
        ),
      );
      // Both SQL timestamps use one database clock projection. The real SQL test
      // verifies the exact30-second protocol window, not an application clock.
      return aiPreviewProofSchema.parse({
        contractVersion: 1,
        invocationId: this.#binding.invocationId,
        outputDigest: evidence.outputDigest,
        token,
        expiresAt: opened.rows[0]?.["expiry_iso"],
      });
    }, "require");
  }
  async acknowledge(raw: AiIntentPreviewDeliveryProofV1): Promise<void> {
    const proof = previewChecked(() => aiPreviewProofSchema.parse(raw));
    await this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(
        row !== null &&
          proof.invocationId === this.#binding.invocationId &&
          previewHashMatches(
            row["delivery_proof_sha256"],
            proofHash(proof.token),
          ) &&
          proof.outputDigest === `sha256:${String(row["output_sha256"])}` &&
          proof.expiresAt === row["expiry_iso"],
      );
      if (row["delivery_state"] === "acknowledged") return;
      previewAssert(row["delivery_state"] === "pending");
      const changed = await tx.query(
        sql(
          `UPDATE ai_intent_previews SET delivery_state='acknowledged',acknowledged_at=clock_timestamp()
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 AND delivery_expires_at>clock_timestamp()`,
          this.#values(),
        ),
      );
      previewAssert(changed.rowCount === 1);
    }, "require");
  }
  async #outcome(
    tx: SqlExecutor,
    row: SqlRow,
  ): Promise<AiIntentPreviewDeliveryOutcomeV1> {
    if (row["generation_evidence"] === null) return { kind: "unavailable" };
    if (row["delivery_state"] === "pending") {
      const expired = await tx.query(
        sql(
          `UPDATE ai_intent_previews SET delivery_state='unconfirmed'
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 AND delivery_expires_at<=clock_timestamp()`,
          this.#values(),
        ),
      );
      if (expired.rowCount === 0) return { kind: "pending" };
    } else if (row["delivery_state"] === "none") {
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET delivery_state='unconfirmed'
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          this.#values(),
        ),
      );
    }
    const acknowledged = row["delivery_state"] === "acknowledged";
    return {
      kind: "terminal",
      acknowledged,
      commercial: intentPreviewCommercialOutcomeV1({
        generation: previewGeneration(
          row["generation_evidence"],
          this.#binding.request,
        ),
        request: this.#binding.request,
        delivery: acknowledged ? "acknowledged" : "unconfirmed",
      }),
    };
  }
  async closeDelivery(): Promise<void> {
    await this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      previewAssert(row !== null);
      if (
        row["delivery_state"] === "acknowledged" ||
        row["delivery_state"] === "unconfirmed" ||
        row["generation_evidence"] === null
      )
        return;
      await tx.query(
        sql(
          `UPDATE ai_intent_previews SET delivery_state='unconfirmed'
        WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4`,
          this.#values(),
        ),
      );
    });
  }
  async deliveryOutcome(): Promise<AiIntentPreviewDeliveryOutcomeV1> {
    return this.#transaction(async (tx) => {
      const row = await this.#load(tx);
      return row === null
        ? { kind: "unavailable" }
        : await this.#outcome(tx, row);
    });
  }
  async recoverVerified(
    input: Parameters<
      ModelCommercialInvocationRecoveryPortV1["recoverVerified"]
    >[0],
  ): ReturnType<ModelCommercialInvocationRecoveryPortV1["recoverVerified"]> {
    return this.#transaction((tx) =>
      this.recoverVerifiedInTransaction(tx, input),
    );
  }
  /** Internal accounting join only. Caller holds the same current tenant
   * authorization and canonical workflow locks in this real transaction. */
  async recoverVerifiedInTransaction(
    tx: SqlExecutor,
    input: Parameters<
      ModelCommercialInvocationRecoveryPortV1["recoverVerified"]
    >[0],
  ): ReturnType<ModelCommercialInvocationRecoveryPortV1["recoverVerified"]> {
    previewAssert(previewSame(input.request, this.#binding.request));
    const row = await this.#load(tx);
    if (row === null) return { kind: "unavailable" };
    previewAssert(
      row["dispatch_intent_id"] === input.dispatchIntent.dispatchIntentId,
    );
    const canonical = await this.#canonical(
      tx,
      input.dispatchIntent.dispatchIntentId,
      false,
    );
    previewAssert(previewSame(canonical.dispatchIntent, input.dispatchIntent));
    const outcome = await this.#outcome(tx, row);
    return outcome.kind === "terminal"
      ? {
          kind: "verified",
          authority: "intent-preview-delivery-v1",
          requestDigest: digestStructuredValue(input.request),
          dispatchIntentId: input.dispatchIntent.dispatchIntentId,
          result: outcome.commercial,
        }
      : outcome;
  }
}
