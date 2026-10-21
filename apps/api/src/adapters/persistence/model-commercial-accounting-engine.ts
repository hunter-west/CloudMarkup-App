import {
  digestStructuredValue,
  projectModelCommercialReservationV1,
  projectModelCommercialRecoveredInvocationRecordV1,
  parseModelCommercialVerifiedTerminalV1,
  parseModelLiveCommercialVerifiedTerminalV2,
  type ModelLiveCommercialTerminalRecoveryPortV2,
  type ModelCommercialInvocationResultV1,
  type ModelCommercialTerminalRecoveryPortV1,
  type ModelCommercialTerminalOutcomeV1,
  type ModelCommercialAccountingPort,
  type ModelCommercialDenialReasonV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowRecordV1,
} from "@cloudmarkup/model-gateway";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import { PostgresCommercialPersistenceRepository } from "./commercial-repositories.js";
import { PostgresModelCommercialPersistenceRepository } from "./model-commercial-repository.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { parsePreviewBinding } from "./ai-intent-preview-codec.js";
import {
  terminalProjection,
  modelTerminalIdentity,
  modelTerminalDetail,
} from "./model-commercial-terminal-codec.js";
import {
  accountingAssert,
  accountingFail,
  accountingInstant,
  accountingNumber,
  accountingRead,
  MODEL_ACCOUNTING_FEATURE,
  MODEL_ACCOUNTING_WINDOW_MAPPING,
  modelAccountingBindingSchema,
  modelAccountingPhysicalId,
  verifyModelReservationInput,
  type ModelAccountingBinding,
  type ModelReservationInput,
} from "./model-commercial-accounting-codec.js";
import {
  parseWorkflowRecord,
  parseWorkflowScope,
  workflowJson,
} from "./model-commercial-workflow-codec.js";
import type { RuntimeAdmissionRecord } from "./model-runtime-admission-codec.js";
import type {
  SeedRuntimeAdmissionRecordV3,
  SeedRuntimeAdmissionRecordV4,
} from "./model-live-seed-runtime-admission-codec.js";
import {
  MODEL_SEED_ACCOUNTING_WINDOW_MAPPING,
  MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
  modelSeedAccountingBindingSchema,
  type ModelSeedAccountingBinding,
} from "./model-live-seed-commercial-accounting-codec.js";
import {
  modelLiveAccountingBindingSchema,
  type ModelLiveAccountingBinding,
} from "./model-live-commercial-accounting-codec.js";
import {
  parseLiveRuntimeRecord,
  type LiveRuntimeAdmissionRecord,
} from "./model-live-runtime-admission-codec.js";
import { recoverLiveJournalRow } from "./model-live-invocation-recovery-codec.js";
import { readLiveProposalValidationReceipt } from "./model-live-proposal-validation-reader.js";
import type { ModelLiveProposalValidationReceiptV2 } from "./model-live-proposal-validation-codec.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

type Reservations = Pick<
  ModelCommercialAccountingPort,
  "reserve" | "recoverExistingReservation"
>;
interface TerminalEvidence {
  readonly noDispatchVerified?: boolean;
  readonly record: ModelCommercialWorkflowRecordV1;
  readonly sourceKind:
    | "preview-journal"
    | "workflow-receipt"
    | "live-invocation-journal"
    | "live-repair-journal-v4";
  readonly previewInvocationId: string | null;
  readonly liveInvocationId: string | null;
  readonly liveValidationReceipt: ModelLiveProposalValidationReceiptV2 | null;
}
const hex = (value: string) => value.slice(7);
const usageId = (input: ModelReservationInput) =>
  `model_usage_${hex(
    digestStructuredValue({
      organizationId: input.event.organizationId,
      projectId: input.event.projectId,
      userId: input.event.userId,
      eventId: input.event.eventId,
    }),
  )}`;
type RuntimeAccountingRecord =
  | RuntimeAdmissionRecord
  | LiveRuntimeAdmissionRecord
  | SeedRuntimeAdmissionRecordV3
  | SeedRuntimeAdmissionRecordV4;
interface Loaded<R extends RuntimeAccountingRecord> {
  readonly workflow: ModelCommercialWorkflowRecordV1;
  readonly runtime: R;
  readonly requireCurrent?: () => Promise<void>;
}

export interface ModelAccountingTransactionPort<
  R extends RuntimeAccountingRecord,
> {
  run<T>(
    work: (
      transaction: SqlExecutor,
      authority: {
        readonly requireCurrent: () => Promise<void>;
        readonly bind: (
          workflow: ModelCommercialWorkflowRecordV1,
          runtime: R,
        ) => void | Promise<void>;
      },
    ) => Promise<T>,
  ): Promise<T>;
}
export interface ModelAccountingEngineOptions<
  R extends RuntimeAccountingRecord,
> {
  readonly database: SqlDatabase;
  readonly scope: ModelCommercialVerifiedScopeV1;
  readonly binding: ModelAccountingBinding;
  readonly mapping:
    | "intent-extract-runtime-windows-v1"
    | "live-evaluation-runtime-windows-v2"
    | typeof MODEL_SEED_ACCOUNTING_WINDOW_MAPPING
    | typeof MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING;
  readonly parseRuntime: (
    value: unknown,
    scope: ModelCommercialVerifiedScopeV1,
  ) => R;
  readonly verifyRuntime: (
    workflow: ModelCommercialWorkflowRecordV1,
    runtime: R,
    binding: ModelAccountingBinding,
  ) => void;
  readonly liveBinding?: ModelLiveAccountingBinding;
  readonly seedBinding?: ModelSeedAccountingBinding;
  readonly authorityTransactions?: ModelAccountingTransactionPort<R>;
  readonly deletionTerminalTransactions?: ModelAccountingTransactionPort<R>;
}

/** Shared canonical reservation algorithm. Explicit host adapters choose the
 * metadata version and transaction authority. V2 known failures release through
 * the authenticated journal; successful evaluations await validator evidence. */
export class PostgresModelCommercialAccountingEngine<
  R extends RuntimeAccountingRecord,
>
  implements
    ModelCommercialAccountingPort,
    ModelCommercialTerminalRecoveryPortV1
{
  readonly #database: SqlDatabase;
  readonly #scope: ModelCommercialVerifiedScopeV1;
  readonly #binding: ModelAccountingBinding;
  readonly #mapping: ModelAccountingEngineOptions<R>["mapping"];
  readonly #liveBinding: ModelLiveAccountingBinding | null;
  readonly #seedBinding: ModelSeedAccountingBinding | null;
  readonly #parseRuntime: ModelAccountingEngineOptions<R>["parseRuntime"];
  readonly #verifyRuntime: ModelAccountingEngineOptions<R>["verifyRuntime"];
  readonly #authorityTransactions:
    ModelAccountingTransactionPort<R> | undefined;
  readonly #deletionTerminalTransactions:
    ModelAccountingTransactionPort<R> | undefined;
  constructor(input: ModelAccountingEngineOptions<R>) {
    this.#database = input.database;
    this.#scope = parseWorkflowScope(input.scope);
    const parsed = modelAccountingBindingSchema.safeParse(input.binding);
    if (!parsed.success) accountingFail();
    this.#binding = parsed.data;
    this.#mapping = input.mapping;
    this.#parseRuntime = input.parseRuntime;
    this.#verifyRuntime = input.verifyRuntime;
    this.#authorityTransactions = input.authorityTransactions;
    this.#deletionTerminalTransactions = input.deletionTerminalTransactions;
    accountingAssert(
      new Set<string>([
        MODEL_ACCOUNTING_WINDOW_MAPPING,
        "live-evaluation-runtime-windows-v2",
        MODEL_SEED_ACCOUNTING_WINDOW_MAPPING,
        MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
      ]).has(input.mapping),
    );
    accountingAssert(
      input.mapping === MODEL_ACCOUNTING_WINDOW_MAPPING
        ? input.authorityTransactions === undefined &&
            input.liveBinding === undefined &&
            input.seedBinding === undefined
        : input.mapping === "live-evaluation-runtime-windows-v2"
          ? (input.authorityTransactions !== undefined ||
              input.deletionTerminalTransactions !== undefined) &&
            input.liveBinding !== undefined &&
            input.seedBinding === undefined
          : (input.authorityTransactions !== undefined ||
              input.deletionTerminalTransactions !== undefined) &&
            input.seedBinding !== undefined &&
            input.liveBinding === undefined,
    );
    this.#seedBinding =
      input.seedBinding === undefined
        ? null
        : modelSeedAccountingBindingSchema.parse(input.seedBinding);
    this.#liveBinding =
      input.liveBinding === undefined
        ? null
        : modelLiveAccountingBindingSchema.parse(input.liveBinding);
    const issuedBinding = this.#seedBinding ?? this.#liveBinding;
    if (issuedBinding !== null) {
      const { routingDecision, ...common } = issuedBinding;
      void routingDecision;
      accountingAssert(
        digestStructuredValue(common) === digestStructuredValue(this.#binding),
      );
    }
  }
  #keys() {
    return [
      this.#scope.organizationId,
      hex(this.#scope.tenantScopeDigest),
      this.#binding.workflowId,
    ] as const;
  }
  async #transaction<T>(
    work: (tx: SqlExecutor, loaded: Loaded<R>) => Promise<T>,
    terminalRecovery = false,
  ): Promise<T> {
    if (this.#deletionTerminalTransactions !== undefined && !terminalRecovery)
      return accountingFail();
    try {
      const load = async (
        tx: SqlExecutor,
        authority?: {
          readonly requireCurrent: () => Promise<void>;
          readonly bind: (
            workflow: ModelCommercialWorkflowRecordV1,
            runtime: R,
          ) => void | Promise<void>;
        },
      ) => {
        const scope = this.#scope;
        await tx.query(
          sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `model-commercial:${scope.organizationId}:${scope.tenantScopeDigest}`,
          ]),
        );
        const workflowRow = (
          await tx.query(
            sql(
              `SELECT snapshot,snapshot_sha256 FROM model_commercial_workflows
          WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND project_id=$4 AND principal_id=$5 FOR UPDATE`,
              [...this.#keys(), scope.projectId, scope.userId],
            ),
          )
        ).rows[0];
        const runtimeRow = (
          await tx.query(
            sql(
              `SELECT snapshot,snapshot_sha256 FROM model_runtime_admissions
          WHERE organization_id=$1 AND scope_sha256=$2 AND project_id=$3 AND principal_id=$4 FOR UPDATE`,
              [
                scope.organizationId,
                hex(this.#binding.runtimeScopeDigest),
                scope.projectId,
                scope.userId,
              ],
            ),
          )
        ).rows[0];
        accountingAssert(workflowRow !== undefined && runtimeRow !== undefined);
        const workflow = parseWorkflowRecord(
          accountingRead(workflowRow["snapshot"]),
          scope,
        );
        const runtime = this.#parseRuntime(
          accountingRead(runtimeRow["snapshot"]),
          scope,
        );
        accountingAssert(
          workflowRow["snapshot_sha256"] ===
            hex(digestStructuredValue(workflow)) &&
            runtimeRow["snapshot_sha256"] ===
              hex(digestStructuredValue(runtime)),
        );

        this.#verifyRuntime(workflow, runtime, this.#binding);
        await authority?.bind(workflow, runtime);
        return work(tx, {
          workflow,
          runtime,
          ...(authority === undefined
            ? {}
            : { requireCurrent: authority.requireCurrent }),
        });
      };
      if (this.#deletionTerminalTransactions !== undefined)
        return await this.#deletionTerminalTransactions.run(load);
      if (this.#authorityTransactions !== undefined)
        return await this.#authorityTransactions.run(load);
      return await this.#database.transaction(async (tx) => {
        const scope = this.#scope;
        const authority = await tx.query(
          sql(
            `SELECT 1 FROM memberships m
          JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
          JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
          JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
          JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
          WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
          AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
          AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[] FOR SHARE OF m,p,o,r,pr`,
            [scope.organizationId, scope.projectId, scope.userId],
          ),
        );
        accountingAssert(authority.rowCount === 1);

        await tx.query(
          sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
            `runtime-admission:${scope.organizationId}`,
          ]),
        );
        return load(tx);
      });
    } catch (error) {
      if (error instanceof CommercialPersistenceError) throw error;
      return accountingFail();
    }
  }
  async #current(tx: SqlExecutor, loaded: Loaded<R>): Promise<void> {
    await loaded.requireCurrent?.();
    const windows = loaded.runtime.originalSnapshot.windows;
    const current = await tx.query(
      sql(
        `SELECT 1 FROM model_runtime_admissions r JOIN model_commercial_workflows w
      ON w.organization_id=r.organization_id AND w.scope_sha256=$3 AND w.workflow_id=$4
      WHERE r.organization_id=$1 AND r.scope_sha256=$2 AND r.snapshot->>'fingerprint'=$5
      AND r.lease_expires_at>clock_timestamp() AND w.lease_expires_at>clock_timestamp()
      AND r.snapshot#>>'{decision,outcome}'='allowed' AND r.snapshot#>'{executionLease,recoveryOnly}'='false'::jsonb
      AND r.snapshot->'recoveryRequired'='false'::jsonb AND r.snapshot->'terminal'='null'::jsonb
      AND w.snapshot->'dispatchIntent'='null'::jsonb AND w.snapshot->'reservationReceipt'='null'::jsonb
      AND (r.snapshot->>'commercialExpiresAt')::timestamptz>clock_timestamp()
      AND $6::timestamptz<=clock_timestamp() AND clock_timestamp()<$7::timestamptz
      AND $8::timestamptz<=clock_timestamp() AND clock_timestamp()<$9::timestamptz`,
        [
          this.#scope.organizationId,
          hex(this.#binding.runtimeScopeDigest),
          hex(this.#scope.tenantScopeDigest),
          this.#binding.workflowId,
          this.#binding.runtimeFingerprint,
          windows.organization.windowStartedAt,
          windows.organization.windowEndsAt,
          windows.user.windowStartedAt,
          windows.user.windowEndsAt,
        ],
      ),
    );
    accountingAssert(current.rowCount === 1);
  }
  async #existing(
    tx: SqlExecutor,
    input: ModelReservationInput,
    loaded: Loaded<R>,
  ): ReturnType<Reservations["recoverExistingReservation"]> {
    const row = (
      await tx.query(
        sql(
          `SELECT d.*,r.status AS reservation_status,r.reserved_credit_units,
      r.pricing_authority,r.project_id AS reservation_project,r.acting_principal_id AS reservation_user,
      r.request_sha256,r.feature_key,r.pricing_version_id
      FROM model_commercial_reservation_decisions d LEFT JOIN credit_reservations r
        ON r.organization_id=d.organization_id AND r.reservation_id=d.canonical_reservation_id
      WHERE d.organization_id=$1 AND d.scope_sha256=$2 AND d.workflow_id=$3`,
          this.#keys(),
        ),
      )
    ).rows[0];
    if (row === undefined) return { kind: "not-found" };
    const accepted = row["accepted"];
    accountingAssert(
      typeof accepted === "boolean" &&
        row["intent_id"] === input.intent.intentId &&
        row["input_sha256"] === hex(digestStructuredValue(input)) &&
        row["runtime_scope_sha256"] === hex(this.#binding.runtimeScopeDigest) &&
        row["runtime_fingerprint_sha256"] ===
          hex(this.#binding.runtimeFingerprint) &&
        row["project_id"] === this.#scope.projectId &&
        row["principal_id"] === this.#scope.userId &&
        row["mapping_version"] === this.#mapping,
    );
    const issuedBinding = this.#seedBinding ?? this.#liveBinding;
    if (issuedBinding === null) {
      accountingAssert(
        row["live_binding"] === null && row["live_binding_sha256"] === null,
      );
    } else {
      const persisted = (
        this.#seedBinding === null
          ? modelLiveAccountingBindingSchema
          : modelSeedAccountingBindingSchema
      ).parse(accountingRead(row["live_binding"]));
      accountingAssert(
        digestStructuredValue(persisted) ===
          digestStructuredValue(issuedBinding) &&
          row["live_binding_sha256"] === hex(digestStructuredValue(persisted)),
      );
    }
    let status: "active" | "denied" | "expired" | "released" | "settled" =
      "denied";
    if (accepted) {
      accountingAssert(
        row["canonical_reservation_id"] ===
          modelAccountingPhysicalId("reservation", loaded.workflow) &&
          row["denial_reason"] === null &&
          row["pricing_authority"] === "model-provider-v1" &&
          row["reservation_project"] === this.#scope.projectId &&
          row["reservation_user"] === this.#scope.userId &&
          row["request_sha256"] === hex(loaded.workflow.fingerprint) &&
          row["feature_key"] === MODEL_ACCOUNTING_FEATURE &&
          row["pricing_version_id"] === input.event.pricingVersionId &&
          accountingNumber(row["reserved_credit_units"]) ===
            input.requestedCreditUnits,
      );
      const parsedStatus = row["reservation_status"];
      accountingAssert(
        parsedStatus === "active" ||
          parsedStatus === "expired" ||
          parsedStatus === "released" ||
          parsedStatus === "settled",
      );
      status = parsedStatus;
      const ledger = await tx.query(
        sql(
          `SELECT 1 FROM usage_ledger_entries e JOIN model_usage_event_details m
        ON m.organization_id=e.organization_id AND m.ledger_entry_id=e.ledger_entry_id
        WHERE e.organization_id=$1 AND e.reservation_id=$2 AND e.entry_kind='reservation'
          AND e.pricing_authority='model-provider-v1' AND e.reserved_credit_units=$3
          AND m.model_usage_event_id=$4 AND m.model_usage_idempotency_key_sha256=$5`,
          [
            this.#scope.organizationId,
            modelAccountingPhysicalId("reservation", loaded.workflow),
            input.requestedCreditUnits,
            usageId(input),
            hex(digestStructuredValue(input.event)),
          ],
        ),
      );
      accountingAssert(ledger.rowCount === 1);
    } else
      accountingAssert(
        row["canonical_reservation_id"] === null &&
          typeof row["denial_reason"] === "string",
      );
    return {
      kind: "found",
      accountingStatus: status,
      result: {
        accepted,
        denialReason: accepted
          ? null
          : (row["denial_reason"] as ModelCommercialDenialReasonV1),
        replayed: true,
        reservationId: input.event.reservationId,
      },
    };
  }
  recoverExistingReservation(
    input: ModelReservationInput,
  ): ReturnType<Reservations["recoverExistingReservation"]> {
    return this.#transaction((tx, loaded) =>
      this.#existing(
        tx,
        verifyModelReservationInput(input, loaded.workflow),
        loaded,
      ),
    );
  }
  reserve(input: ModelReservationInput): ReturnType<Reservations["reserve"]> {
    return this.#transaction(async (tx, loaded) => {
      const expected = verifyModelReservationInput(input, loaded.workflow);
      const previous = await this.#existing(tx, expected, loaded);
      if (previous.kind === "found") return previous.result;
      await this.#current(tx, loaded);
      const context = loaded.workflow.resolvedContext;
      accountingAssert(
        context !== null &&
          context.authorization.allowed &&
          context.authorization.featureEntitled &&
          context.authorization.commercialState === "active" &&
          context.authorization.organizationStatus === "active",
      );
      await this.#prices(tx, loaded.workflow);
      const windows = loaded.runtime.originalSnapshot.windows;
      // Billing-account locking below also serializes canonical legacy reservations.
      await tx.query(
        sql(
          "SELECT billing_account_id FROM organization_billing_accounts WHERE organization_id=$1 FOR UPDATE",
          [this.#scope.organizationId],
        ),
      );
      const counts = (
        await tx.query(
          sql(
            `SELECT
        (SELECT count(*) FROM model_commercial_reservation_decisions WHERE organization_id=$1 AND accepted AND created_at >= $2::timestamptz AND created_at < $3::timestamptz) AS feature_count,
        (SELECT count(*) FROM model_commercial_reservation_decisions WHERE organization_id=$1 AND principal_id=$4 AND accepted AND created_at >= $5::timestamptz AND created_at < $6::timestamptz) AS user_count,
        (SELECT count(*) FROM credit_reservations WHERE organization_id=$1 AND status='active') AS active_count`,
            [
              this.#scope.organizationId,
              windows.organization.windowStartedAt,
              windows.organization.windowEndsAt,
              this.#scope.userId,
              windows.user.windowStartedAt,
              windows.user.windowEndsAt,
            ],
          ),
        )
      ).rows[0];
      accountingAssert(counts !== undefined);
      let denial: ModelCommercialDenialReasonV1 | null = null;
      for (const [key, limit, reason] of [
        [
          "user_count",
          expected.capacity.perUserRequests,
          "per-user-request-limit-reached",
        ],
        [
          "active_count",
          expected.capacity.organizationConcurrentReservations,
          "organization-concurrent-reservation-limit-reached",
        ],
        [
          "feature_count",
          expected.capacity.featureRequests,
          "feature-limit-reached",
        ],
      ] as const) {
        if (
          Math.max(accountingNumber(counts[key]), limit.current) >=
          limit.maximum
        ) {
          denial = reason;
          break;
        }
      }
      const canonicalId = modelAccountingPhysicalId(
        "reservation",
        loaded.workflow,
      );
      if (denial === null) {
        await tx.query(sql("SAVEPOINT model_canonical_reserve"));
        try {
          await new PostgresCommercialPersistenceRepository(
            this.#database,
          ).reserveModelCreditsInTransaction(
            tx,
            {
              authority: "internal-accounting",
              actorId: "model-accounting-v1",
              actingPrincipalId: this.#scope.userId,
              organizationId: this.#scope.organizationId,
              correlationId: input.event.requestId,
            },
            {
              chargingPolicyVersion:
                context.authorization.chargingPolicyVersion,
              entitlementPolicyVersion:
                context.authorization.entitlementPolicyVersion,
              expiresAt: expected.expiresAt,
              featureKey: MODEL_ACCOUNTING_FEATURE,
              idempotencyKey: `model_${hex(digestStructuredValue({ scope: this.#scope.tenantScopeDigest, intent: expected.intent.intentId }))}`,
              jobId: expected.event.jobId,
              modelId: expected.event.modelId,
              modelVersion: expected.event.modelVersion,
              planVersionId: context.authorization.planVersionId,
              pricingVersionId: expected.event.pricingVersionId,
              projectId: this.#scope.projectId,
              providerKey: expected.event.providerKey,
              requestId: modelAccountingPhysicalId("request", loaded.workflow),
              requestSha256: hex(loaded.workflow.fingerprint),
              requestedCreditUnits: String(expected.requestedCreditUnits),
              reservationId: canonicalId,
            },
            {
              capturedAt: context.estimateResult.pricingAuthority.capturedAt,
              environment: expected.event.environment,
              inferenceProfileId: expected.event.inferenceProfileId,
              normalizationPolicyVersionId:
                expected.event.normalizationPolicyVersionId,
              perUserMaximum: expected.capacity.perUserRequests.maximum,
              assertCurrent: (transaction) =>
                this.#current(transaction, loaded),
            },
          );
        } catch (error) {
          if (
            !(error instanceof CommercialPersistenceError) ||
            ![
              "insufficient-credits",
              "entitlement-denied",
              "not-found",
            ].includes(error.code)
          )
            throw error;
          await tx.query(sql("ROLLBACK TO SAVEPOINT model_canonical_reserve"));
          denial =
            error.code === "insufficient-credits"
              ? "insufficient-credits"
              : error.code === "not-found"
                ? "commercial-state-unavailable"
                : "plan-not-entitled";
        }
        await tx.query(sql("RELEASE SAVEPOINT model_canonical_reserve"));
      }
      await this.#current(tx, loaded);
      await tx.query(
        sql(
          `INSERT INTO model_commercial_reservation_decisions(organization_id,scope_sha256,workflow_id,project_id,principal_id,intent_id,input_sha256,
        runtime_scope_sha256,runtime_fingerprint_sha256,mapping_version,organization_window_start,organization_window_end,user_window_start,user_window_end,accepted,denial_reason,canonical_reservation_id,live_binding,live_binding_sha256)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13::timestamptz,$14::timestamptz,$15,$16,$17,$18::jsonb,$19)`,
          [
            ...this.#keys(),
            this.#scope.projectId,
            this.#scope.userId,
            expected.intent.intentId,
            hex(digestStructuredValue(expected)),
            hex(this.#binding.runtimeScopeDigest),
            hex(this.#binding.runtimeFingerprint),
            this.#mapping,
            windows.organization.windowStartedAt,
            windows.organization.windowEndsAt,
            windows.user.windowStartedAt,
            windows.user.windowEndsAt,
            denial === null,
            denial,
            denial === null ? canonicalId : null,
            this.#seedBinding === null && this.#liveBinding === null
              ? null
              : JSON.stringify(this.#seedBinding ?? this.#liveBinding),
            this.#seedBinding === null && this.#liveBinding === null
              ? null
              : hex(
                  digestStructuredValue(this.#seedBinding ?? this.#liveBinding),
                ),
          ],
        ),
      );
      if (denial === null)
        await this.#reservedDetail(tx, expected, canonicalId);
      await this.#current(tx, loaded);
      return {
        accepted: denial === null,
        denialReason: denial,
        replayed: false,
        reservationId: expected.event.reservationId,
      };
    });
  }
  async #reservedDetail(
    tx: SqlExecutor,
    input: ModelReservationInput,
    canonicalId: string,
  ) {
    const e = input.event;
    const inserted = await tx.query(
      sql(
        `INSERT INTO model_usage_event_details(organization_id,model_usage_event_id,model_usage_idempotency_key_sha256,ledger_entry_id,
      model_route,model_route_id,inference_profile_id,prompt_id,prompt_version,template_id,template_version,model_pricing_version_id,normalization_policy_version_id,environment,
      input_units,output_units,cache_read_units,cache_write_units,total_units,provider_specific_units,estimated_provider_cost_micros,reserved_credit_units,charged_credit_units,compensated_credit_units,
      occurred_at,latency_milliseconds,lifecycle_status,attempts,multi_call_workflow_id,reconciliation_state)
      SELECT $1::varchar(128),$2,$3,e.ledger_entry_id,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,0,0,'[]'::jsonb,0,$14,0,0,$15::timestamptz,0,'reserved','[]'::jsonb,$16,'not-required'
      FROM usage_ledger_entries e WHERE e.organization_id=$1 AND e.reservation_id=$17 AND e.entry_kind='reservation' AND e.pricing_authority='model-provider-v1'`,
        [
          e.organizationId,
          usageId(input),
          hex(digestStructuredValue(e)),
          e.route,
          e.routeId,
          e.inferenceProfileId,
          e.promptId,
          e.promptVersion,
          e.templateId,
          e.templateVersion,
          e.pricingVersionId,
          e.normalizationPolicyVersionId,
          e.environment,
          e.reservedCreditUnits,
          e.occurredAt,
          e.multiCallWorkflowId,
          canonicalId,
        ],
      ),
    );
    accountingAssert(inserted.rowCount === 1);
  }
  async #prices(tx: SqlExecutor, workflow: ModelCommercialWorkflowRecordV1) {
    const pins =
      workflow.resolvedContext?.estimateResult.pricingAuthority.routePins;
    accountingAssert(pins !== undefined);
    for (const pin of pins) {
      const row = (
        await tx.query(
          sql(
            "SELECT to_jsonb(p) AS price,to_jsonb(n) AS policy FROM model_provider_pricing_versions p JOIN credit_normalization_policy_versions n ON n.normalization_policy_version_id=$2 WHERE p.pricing_version_id=$1",
            [
              pin.pricingVersion.pricingVersionId,
              pin.normalizationPolicy.normalizationPolicyVersionId,
            ],
          ),
        )
      ).rows[0];
      accountingAssert(row !== undefined);
      const price = accountingRead(row["price"]) as SqlRow;
      const policy = accountingRead(row["policy"]) as SqlRow;
      const rates = accountingRead(price["provider_specific_unit_rates"]);
      accountingAssert(Array.isArray(rates));
      const projected = {
        version: 1,
        cacheReadMicrosPerMillionUnits:
          price["cache_read_micros_per_million_units"] === null
            ? null
            : accountingNumber(price["cache_read_micros_per_million_units"]),
        cacheWriteMicrosPerMillionUnits:
          price["cache_write_micros_per_million_units"] === null
            ? null
            : accountingNumber(price["cache_write_micros_per_million_units"]),
        currencyCode: price["cost_currency"],
        effectiveFrom: accountingInstant(price["effective_from"]),
        effectiveUntil:
          price["effective_until"] === null
            ? null
            : accountingInstant(price["effective_until"]),
        environment: price["environment"],
        inferenceProfileId: price["inference_profile_id"],
        inputMicrosPerMillionUnits: accountingNumber(
          price["input_micros_per_million_units"],
        ),
        modelId: price["model_key"],
        modelVersion: price["model_version"],
        outputMicrosPerMillionUnits: accountingNumber(
          price["output_micros_per_million_units"],
        ),
        pricingVersionId: price["pricing_version_id"],
        providerKey: price["provider_key"],
        status: price["pricing_status"],
        providerSpecificUnitRates: rates.map((raw: unknown) => {
          const rate = raw as SqlRow;
          return {
            unitName: rate["unitName"],
            microsPerMillionUnits: accountingNumber(
              rate["microsPerMillionUnits"],
            ),
          };
        }),
      };
      const normalized = {
        version: 1,
        creditUnitMicros: accountingNumber(policy["credit_unit_micros"]),
        currencyCode: policy["cost_currency"],
        effectiveFrom: accountingInstant(policy["effective_from"]),
        effectiveUntil:
          policy["effective_until"] === null
            ? null
            : accountingInstant(policy["effective_until"]),
        normalizationPolicyVersionId: policy["normalization_policy_version_id"],
        operatingBufferBasisPoints: accountingNumber(
          policy["operating_buffer_basis_points"],
        ),
        status: policy["policy_status"],
      };
      accountingAssert(
        digestStructuredValue(projected) === pin.pricingVersionDigest &&
          digestStructuredValue(normalized) === pin.normalizationPolicyDigest,
      );
    }
  }

  settle(input: Parameters<ModelCommercialAccountingPort["settle"]>[0]) {
    return this.#terminal("settlement", input);
  }
  release(input: Parameters<ModelCommercialAccountingPort["release"]>[0]) {
    return this.#terminal("release", input);
  }
  markReconciliationRequired(
    input: Parameters<
      ModelCommercialAccountingPort["markReconciliationRequired"]
    >[0],
  ) {
    return this.#terminal("reconciliation-required", input);
  }
  /** Private V4 completion derives both the receipt and financial event from
   * immutable journals. No caller-supplied amount or success assertion. */
  settleRecordedRepairV4() {
    return this.#completeRecordedRepairV4(false);
  }
  /** Financial recovery only: verified original usage may settle after the
   * execution host disappears. Current tenant authorization still applies. */
  recoverRecordedRepairV4() {
    return this.#completeRecordedRepairV4(true);
  }
  async #completeRecordedRepairV4(recovery: boolean) {
    accountingAssert(
      this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
    );
    return this.#transaction(async (tx, loaded) => {
      const existing = await this.#readTerminal(tx, loaded);
      if (existing !== null)
        return {
          kind:
            existing.kind === "settlement"
              ? ("settled" as const)
              : ("released" as const),
          outcome: existing,
          replayed: true,
        };
      let evidence = await this.#repairTerminalEvidence(tx, loaded);
      if (evidence === null && recovery) {
        await tx.query(
          sql("SELECT cloudmarkup_record_repair_expiry_v4($1,$2,$3,$4,$5,$6)", [
            this.#scope.organizationId,
            this.#scope.projectId,
            this.#scope.userId,
            hex(this.#scope.tenantScopeDigest),
            this.#binding.workflowId,
            loaded.workflow.revision,
          ]),
        );
        evidence = await this.#repairTerminalEvidence(tx, loaded);
      }
      if (evidence === null) return { kind: "pending" as const };
      const { outcome } = terminalProjection(
        evidence.record.invocationReceipt,
        loaded.workflow,
        this.#scope,
        evidence.noDispatchVerified,
      );
      accountingAssert(
        outcome.kind === "settlement" || outcome.kind === "release",
      );
      const persisted = await this.#persistTerminal(
        tx,
        loaded,
        evidence,
        outcome,
        recovery,
      );
      return {
        kind:
          outcome.kind === "settlement"
            ? ("settled" as const)
            : ("released" as const),
        outcome,
        ...persisted,
      };
    }, recovery);
  }
  async #repairTerminalEvidence(
    tx: SqlExecutor,
    loaded: Loaded<R>,
  ): Promise<TerminalEvidence | null> {
    accountingAssert(
      this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING &&
        this.#seedBinding !== null,
    );
    const result = await tx.query(
      sql(
        "SELECT COALESCE(cloudmarkup_recorded_repair_receipt_v4($1,$2,$3,$4,$5,$6),cloudmarkup_failed_repair_receipt_v4($1,$2,$3,$4,$5,$6),cloudmarkup_repair_expiry_receipt_v4($1,$2,$3,$4,$5,$6)) AS receipt",
        [
          this.#scope.organizationId,
          this.#scope.projectId,
          this.#scope.userId,
          hex(this.#scope.tenantScopeDigest),
          this.#binding.workflowId,
          loaded.workflow.revision,
        ],
      ),
    );
    accountingAssert(result.rowCount === 1);
    const receipt = accountingRead(result.rows[0]?.["receipt"]);
    if (receipt === null) return null;
    const { record, outcome } = terminalProjection(
      receipt,
      loaded.workflow,
      this.#scope,
      true,
    );
    accountingAssert(
      outcome.kind === "settlement" || outcome.kind === "release",
    );
    return {
      record,
      sourceKind: "live-repair-journal-v4",
      noDispatchVerified: true,
      previewInvocationId: null,
      liveInvocationId: null,
      liveValidationReceipt: null,
    };
  }
  async #terminalCurrent(
    tx: SqlExecutor,
    loaded: Loaded<R>,
    recovery: boolean,
  ) {
    if (this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING) {
      if (!recovery) {
        accountingAssert(loaded.requireCurrent !== undefined);
        await loaded.requireCurrent();
      }
    }
    const found = await tx.query(
      sql(
        `SELECT 1 FROM model_commercial_workflows w
      JOIN model_runtime_admissions r ON r.organization_id=w.organization_id AND r.scope_sha256=$4
      WHERE w.organization_id=$1 AND w.scope_sha256=$2 AND w.workflow_id=$3
      AND w.snapshot_sha256=$5 AND r.snapshot_sha256=$6
      AND ($7::boolean OR (w.lease_expires_at>clock_timestamp() AND r.lease_expires_at>clock_timestamp()))`,
        [
          ...this.#keys(),
          hex(this.#binding.runtimeScopeDigest),
          hex(digestStructuredValue(loaded.workflow)),
          hex(digestStructuredValue(loaded.runtime)),
          recovery,
        ],
      ),
    );
    accountingAssert(found.rowCount === 1);
  }
  async #recoveredRecord(
    tx: SqlExecutor,
    workflow: ModelCommercialWorkflowRecordV1,
    result: ModelCommercialInvocationResultV1,
    receivedAt?: string,
  ) {
    if (receivedAt !== undefined)
      return projectModelCommercialRecoveredInvocationRecordV1(
        workflow,
        result,
        receivedAt,
      );
    const stamp = (
      await tx.query(
        sql(
          `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS now`,
        ),
      )
    ).rows[0]?.["now"];
    accountingAssert(typeof stamp === "string");
    const original =
      workflow.invocationReceipt === null
        ? null
        : projectModelCommercialRecoveredInvocationRecordV1(
            workflow,
            result,
            workflow.invocationReceipt.receivedAt,
          );
    const same =
      original !== null &&
      digestStructuredValue(workflow.invocationReceipt?.result) ===
        digestStructuredValue(original.invocationReceipt?.result);
    const projected = same
      ? workflow
      : projectModelCommercialRecoveredInvocationRecordV1(
          workflow,
          result,
          stamp,
        );
    return projected;
  }
  async #liveTerminalEvidence(
    tx: SqlExecutor,
    loaded: Loaded<R>,
    receivedAt?: string,
  ): Promise<TerminalEvidence | null> {
    accountingAssert(this.#liveBinding !== null);
    const runtime = parseLiveRuntimeRecord(loaded.runtime, this.#scope);
    const row = (
      await tx.query(
        sql(
          "SELECT * FROM model_live_invocations WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND project_id=$4 AND principal_id=$5 FOR UPDATE",
          [...this.#keys(), this.#scope.projectId, this.#scope.userId],
        ),
      )
    ).rows[0];
    // Only the original coordinator proof can establish no dispatch. Absence
    // alone is insufficient; any registered/claimed journal remains held.
    if (row === undefined) {
      if (loaded.workflow.invocationReceipt?.preDispatchProof == null)
        return null;
      return this.#workflowTerminalEvidence(loaded.workflow);
    }
    const validationReceipt = await readLiveProposalValidationReceipt(
      tx,
      row,
      runtime.request,
    );
    // The canonical deadline is immutable DB state, not a provider timestamp or
    // supplied clock. The journal remains locked across receipt absence and
    // compensation, serializing against actual validator receipt issuance.
    const expired =
      row["gateway_state"] === "complete" && validationReceipt === null
        ? (
            await tx.query(
              sql(
                `SELECT to_char(r.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
          to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
        FROM credit_reservations r JOIN model_commercial_reservation_decisions d
          ON d.organization_id=r.organization_id AND d.canonical_reservation_id=r.reservation_id
        WHERE d.organization_id=$1 AND d.scope_sha256=$2 AND d.workflow_id=$3
          AND r.expires_at<=clock_timestamp()`,
                this.#keys(),
              ),
            )
          ).rows[0]
        : undefined;
    const recoveryDeadline =
      expired === undefined
        ? undefined
        : {
            expiresAt: accountingInstant(expired["expires_at"]),
            observedAt: accountingInstant(expired["observed_at"]),
          };
    const recovered = recoverLiveJournalRow(
      row,
      loaded.workflow,
      runtime.request,
      digestStructuredValue(this.#liveBinding),
      undefined,
      validationReceipt,
      recoveryDeadline,
    );
    if (recovered.kind !== "verified") return null;
    accountingAssert(typeof row["invocation_id"] === "string");
    return {
      record: await this.#recoveredRecord(
        tx,
        loaded.workflow,
        recovered.result,
        receivedAt,
      ),
      sourceKind: "live-invocation-journal",
      previewInvocationId: null,
      liveInvocationId: row["invocation_id"],
      liveValidationReceipt: validationReceipt,
    };
  }
  async #terminalEvidence(
    tx: SqlExecutor,
    loaded: Loaded<R>,
  ): Promise<TerminalEvidence | null> {
    const workflow = loaded.workflow;
    accountingAssert(
      workflow.request.plannedCalls.length === 1 &&
        workflow.request.plannedCalls[0]?.kind === "primary" &&
        workflow.dispatchIntent !== null &&
        workflow.reservationReceipt?.result.accepted === true,
    );
    if (this.#liveBinding !== null)
      return this.#liveTerminalEvidence(tx, loaded);
    const preview = (
      await tx.query(
        sql(
          `SELECT binding,binding_sha256 FROM ai_intent_previews
      WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 FOR UPDATE`,
          this.#keys(),
        ),
      )
    ).rows[0];
    if (preview !== undefined) {
      const binding = parsePreviewBinding(accountingRead(preview["binding"]));
      accountingAssert(
        hex(digestStructuredValue(binding)) === preview["binding_sha256"] &&
          digestStructuredValue(binding.request) === workflow.fingerprint &&
          binding.inputDigest === loaded.runtime.request.inputDigest,
      );
      const recovered = await new PostgresAiIntentPreviewJournal({
        database: this.#database,
        binding,
      }).recoverVerifiedInTransaction(tx, {
        request: workflow.request,
        dispatchIntent: workflow.dispatchIntent,
      });
      if (recovered.kind === "pending") return null;
      if (recovered.kind === "verified") {
        const projected = await this.#recoveredRecord(
          tx,
          workflow,
          recovered.result,
        );
        return {
          record: projected,
          sourceKind: "preview-journal" as const,
          previewInvocationId: binding.invocationId,
          liveInvocationId: null,
          liveValidationReceipt: null,
        };
      }
    }
    return this.#workflowTerminalEvidence(workflow);
  }
  #workflowTerminalEvidence(
    workflow: ModelCommercialWorkflowRecordV1,
  ): TerminalEvidence | null {
    if (workflow.invocationReceipt === null) return null;
    const { outcome } = terminalProjection(
      workflow.invocationReceipt,
      workflow,
      this.#scope,
    );
    // A callback's success flag is never proof of RAM delivery. Only verified
    // journal delivery or the original coordinator no-dispatch proof may settle.
    accountingAssert(
      outcome.kind === "reconciliation-required" ||
        (outcome.kind === "release" &&
          workflow.invocationReceipt.preDispatchProof !== null),
    );
    return {
      record: workflow,
      sourceKind: "workflow-receipt" as const,
      previewInvocationId: null,
      liveInvocationId: null,
      liveValidationReceipt: null,
    };
  }
  async #readTerminal(tx: SqlExecutor, loaded: Loaded<R>) {
    const rows = await tx.query(
      sql(
        `SELECT receipt,outcome,outcome_sha256,source_revision,dispatch_intent_id,
      pricing_authority_sha256,ledger_entry_id,source_kind,live_invocation_id,
      live_validation_receipt_id,live_validation_receipt_sha256 FROM model_commercial_accounting_outcomes
      WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND outcome_kind<>'reconciliation-required'`,
        this.#keys(),
      ),
    );
    const row = rows.rows[0];
    if (row === undefined) return null;
    accountingAssert(rows.rowCount === 1);
    accountingAssert(typeof row["ledger_entry_id"] === "string");
    const repairEvidence =
      this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING
        ? await this.#repairTerminalEvidence(tx, loaded)
        : null;
    const projection = terminalProjection(
      accountingRead(row["receipt"]),
      loaded.workflow,
      this.#scope,
      repairEvidence?.noDispatchVerified,
    );
    accountingAssert(
      hex(digestStructuredValue(projection.outcome)) ===
        row["outcome_sha256"] &&
        digestStructuredValue(accountingRead(row["outcome"])) ===
          digestStructuredValue(projection.outcome) &&
        row["dispatch_intent_id"] ===
          loaded.workflow.dispatchIntent?.dispatchIntentId &&
        row["pricing_authority_sha256"] ===
          hex(
            loaded.workflow.resolvedContext?.estimateResult.pricingAuthority
              .authorityDigest ?? "",
          ),
    );
    const repairSettlement =
      this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING &&
      projection.outcome.kind === "settlement";
    if (this.#mapping === MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING) {
      const evidence = repairEvidence;
      accountingAssert(
        evidence !== null &&
          row["source_kind"] === "live-repair-journal-v4" &&
          row["live_invocation_id"] === null &&
          digestStructuredValue(evidence.record.invocationReceipt) ===
            digestStructuredValue(projection.record.invocationReceipt),
      );
    }
    const liveSettlement =
      this.#liveBinding !== null && projection.outcome.kind === "settlement";
    if (liveSettlement) {
      accountingAssert(projection.record.invocationReceipt !== null);
      const evidence = await this.#liveTerminalEvidence(
        tx,
        loaded,
        projection.record.invocationReceipt.receivedAt,
      );
      accountingAssert(
        evidence?.liveValidationReceipt != null &&
          row["source_kind"] === "live-invocation-journal" &&
          row["live_invocation_id"] === evidence.liveInvocationId &&
          row["live_validation_receipt_id"] ===
            evidence.liveValidationReceipt.receiptId &&
          row["live_validation_receipt_sha256"] ===
            hex(evidence.liveValidationReceipt.receiptDigest) &&
          digestStructuredValue(evidence.record.invocationReceipt) ===
            digestStructuredValue(projection.record.invocationReceipt),
      );
    } else {
      accountingAssert(
        row["live_validation_receipt_id"] === null &&
          row["live_validation_receipt_sha256"] === null,
      );
    }
    const ledger = await tx.query(
      sql(
        `SELECT 1 FROM credit_reservations r JOIN usage_ledger_entries e
      ON e.organization_id=r.organization_id AND e.ledger_entry_id=r.terminal_ledger_entry_id
      JOIN model_usage_event_details d ON d.organization_id=e.organization_id AND d.ledger_entry_id=e.ledger_entry_id
      WHERE r.organization_id=$1 AND r.reservation_id=$2 AND e.ledger_entry_id=$3
      AND r.status=$4 AND e.pricing_authority='model-provider-v1' AND e.settled_credit_units=$5
      AND d.model_usage_idempotency_key_sha256=$6
      AND ($7::text IS NULL OR e.charging_scenario=$7)`,
        [
          this.#scope.organizationId,
          modelAccountingPhysicalId("reservation", loaded.workflow),
          row["ledger_entry_id"],
          projection.outcome.kind === "settlement" ? "settled" : "released",
          projection.outcome.event.chargedCreditUnits,
          hex(digestStructuredValue(projection.outcome.event)),
          projection.outcome.kind === "settlement"
            ? liveSettlement || repairSettlement
              ? "model-evaluation-recorded-v2"
              : "model-preview-delivered-v1"
            : null,
        ],
      ),
    );
    accountingAssert(ledger.rowCount === 1);
    return projection.outcome;
  }
  async #terminal(
    kind: ModelCommercialTerminalOutcomeV1["kind"],
    input: {
      readonly event: ModelCommercialTerminalOutcomeV1["event"];
      readonly actualCreditUnits?: number;
      readonly chargedCreditUnits?: number;
    },
  ) {
    // V3 is reservation-only until its explicit journal and outcome bridge exists.
    accountingAssert(this.#seedBinding === null);
    return this.#transaction(async (tx, loaded) => {
      const existing = await this.#readTerminal(tx, loaded);
      if (existing !== null) {
        this.#verifyTerminalInput(kind, input, existing);
        return { replayed: true };
      }
      const evidence = await this.#terminalEvidence(tx, loaded);
      accountingAssert(evidence !== null);
      // Releasing proven undispatched expiry is financial recovery. It cannot
      // require the execution lease that expired, or grant a fresh dispatch.
      const expiryRecovery =
        this.#liveBinding !== null &&
        evidence.sourceKind === "workflow-receipt" &&
        evidence.record.invocationReceipt?.preDispatchProof != null;
      await this.#terminalCurrent(tx, loaded, expiryRecovery);
      const outcome = terminalProjection(
        evidence.record.invocationReceipt,
        loaded.workflow,
        this.#scope,
      ).outcome;
      this.#verifyTerminalInput(kind, input, outcome);
      return this.#persistTerminal(
        tx,
        loaded,
        evidence,
        outcome,
        expiryRecovery,
      );
    });
  }
  #verifyTerminalInput(
    kind: ModelCommercialTerminalOutcomeV1["kind"],
    input: {
      readonly event: ModelCommercialTerminalOutcomeV1["event"];
      readonly actualCreditUnits?: number;
      readonly chargedCreditUnits?: number;
    },
    outcome: ModelCommercialTerminalOutcomeV1,
  ) {
    workflowJson(input);
    const expected =
      kind === "settlement"
        ? {
            event: outcome.event,
            actualCreditUnits: outcome.actualCreditUnits,
            chargedCreditUnits: outcome.event.chargedCreditUnits,
          }
        : { event: outcome.event };
    accountingAssert(
      kind === outcome.kind &&
        digestStructuredValue(input) === digestStructuredValue(expected),
    );
  }
  async #persistTerminal(
    tx: SqlExecutor,
    loaded: Loaded<R>,
    evidence: TerminalEvidence,
    outcome: ModelCommercialTerminalOutcomeV1,
    recovery: boolean,
  ) {
    const w = loaded.workflow,
      e = outcome.event,
      context = w.resolvedContext;
    accountingAssert(
      context !== null &&
        evidence.record.invocationReceipt !== null &&
        w.dispatchIntent !== null,
    );
    const reservationInput = projectModelCommercialReservationV1(w);
    const reservation = await this.#existing(tx, reservationInput, loaded);
    accountingAssert(
      reservation.kind === "found" &&
        reservation.result.accepted &&
        reservation.accountingStatus === "active",
    );
    await this.#prices(tx, w);
    await this.#terminalCurrent(tx, loaded, recovery);
    const prior = await tx.query(
      sql(
        `SELECT outcome_sha256 FROM model_commercial_accounting_outcomes
      WHERE organization_id=$1 AND scope_sha256=$2 AND workflow_id=$3 AND outcome_kind=$4`,
        [...this.#keys(), outcome.kind],
      ),
    );
    if (prior.rows[0] !== undefined) {
      accountingAssert(
        prior.rows[0]["outcome_sha256"] === hex(digestStructuredValue(outcome)),
      );
      return { replayed: true };
    }
    const canonicalId = modelAccountingPhysicalId("reservation", w);
    let ledgerId = modelTerminalIdentity("terminal", e);
    if (outcome.kind === "reconciliation-required") {
      const ledger = (
        await tx.query(
          sql(
            `SELECT ledger_entry_id FROM usage_ledger_entries WHERE organization_id=$1
        AND reservation_id=$2 AND entry_kind='reservation' AND pricing_authority='model-provider-v1'`,
            [this.#scope.organizationId, canonicalId],
          ),
        )
      ).rows[0];
      accountingAssert(typeof ledger?.["ledger_entry_id"] === "string");
      ledgerId = ledger["ledger_entry_id"];
    }
    await tx.query(
      sql(
        `INSERT INTO model_commercial_accounting_outcomes(organization_id,scope_sha256,workflow_id,
      project_id,principal_id,canonical_reservation_id,source_revision,workflow_fingerprint_sha256,
      dispatch_intent_id,pricing_authority_sha256,outcome_kind,source_kind,preview_invocation_id,
      receipt,outcome,outcome_sha256,ledger_entry_id,live_invocation_id,live_validation_receipt_id,live_validation_receipt_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20)`,
        [
          ...this.#keys(),
          this.#scope.projectId,
          this.#scope.userId,
          canonicalId,
          w.revision,
          hex(w.fingerprint),
          w.dispatchIntent.dispatchIntentId,
          hex(context.estimateResult.pricingAuthority.authorityDigest),
          outcome.kind,
          evidence.sourceKind,
          evidence.previewInvocationId,
          workflowJson(evidence.record.invocationReceipt),
          workflowJson(outcome),
          hex(digestStructuredValue(outcome)),
          ledgerId,
          evidence.liveInvocationId,
          evidence.liveValidationReceipt?.receiptId ?? null,
          evidence.liveValidationReceipt === null
            ? null
            : hex(evidence.liveValidationReceipt.receiptDigest),
        ],
      ),
    );
    const accounting = {
      authority: "internal-accounting" as const,
      actorId: "model-terminal-accounting-v1",
      organizationId: this.#scope.organizationId,
      correlationId: w.request.requestId,
    };
    if (outcome.kind !== "reconciliation-required") {
      const first = e.attempts[0];
      const hasUsage = first !== undefined;
      const pin = context.estimateResult.pricingAuthority.routePins[0];
      accountingAssert(pin !== undefined);
      const base = {
        chargingPolicyVersion: context.authorization.chargingPolicyVersion,
        idempotencyKey: modelTerminalIdentity("terminalkey", e),
        ledgerEntryId: ledgerId,
        requestId: modelAccountingPhysicalId("request", w),
        requestSha256: hex(w.fingerprint),
        reservationId: canonicalId,
        reasonCode:
          outcome.kind === "settlement"
            ? this.#liveBinding === null &&
              this.#mapping !== MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING
              ? "model.preview.delivered"
              : "model.evaluation.recorded"
            : hasUsage
              ? this.#liveBinding === null &&
                this.#mapping !== MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING
                ? "model.preview.no-customer-charge"
                : "model.evaluation.no-customer-charge"
              : "model.reservation.expired-before-dispatch",
        ...(hasUsage
          ? {
              modelId: e.modelId,
              modelVersion: e.modelVersion,
              providerKey: e.providerKey,
              pricingVersionId: e.pricingVersionId,
              providerCostCurrency: pin.pricingVersion.currencyCode,
              estimatedProviderCostMicros: String(
                e.estimatedProviderCostMicros,
              ),
              inputTokenCount: String(e.inputUnits),
              outputTokenCount: String(e.outputUnits),
              cachedInputTokenCount: String(e.cacheReadUnits),
              latencyMilliseconds: String(e.latencyMilliseconds),
              ...(first.providerRequestId === null
                ? {}
                : { providerRequestId: first.providerRequestId }),
            }
          : {}),
      };
      const terminalInput =
        outcome.kind === "settlement"
          ? {
              ...base,
              modelId: e.modelId,
              modelVersion: e.modelVersion,
              providerKey: e.providerKey,
              pricingVersionId: e.pricingVersionId,
              chargingScenario:
                this.#liveBinding === null &&
                this.#mapping !== MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING
                  ? ("model-preview-delivered-v1" as const)
                  : ("model-evaluation-recorded-v2" as const),
              actualNormalizedCreditUnits: String(outcome.actualCreditUnits),
              customerChargeCreditUnits: String(e.chargedCreditUnits),
            }
          : {
              ...base,
              chargingScenario:
                e.status === "provider-failure"
                  ? ("provider-failure-before-useful-output" as const)
                  : ("cloudmarkup-internal-failure" as const),
            };
      await new PostgresCommercialPersistenceRepository(
        this.#database,
      ).terminalModelReservationInTransaction(tx, accounting, terminalInput, {
        actualCreditUnits: String(outcome.actualCreditUnits),
        assertCurrent: (transaction) =>
          this.#terminalCurrent(transaction, loaded, recovery),
      });
    }
    await new PostgresModelCommercialPersistenceRepository(
      this.#database,
    ).appendUsageEventDetailInTransaction(
      tx,
      accounting,
      modelTerminalDetail(e, ledgerId),
      context.estimateResult.pricingAuthority.capturedAt,
    );
    await this.#terminalCurrent(tx, loaded, recovery);
    return { replayed: false };
  }
  recoverVerified(
    input: Parameters<
      ModelCommercialTerminalRecoveryPortV1["recoverVerified"]
    >[0],
  ): ReturnType<ModelCommercialTerminalRecoveryPortV1["recoverVerified"]> {
    accountingAssert(this.#mapping === MODEL_ACCOUNTING_WINDOW_MAPPING);
    return this.#transaction(async (tx, loaded) => {
      accountingAssert(
        input.requestDigest === loaded.workflow.fingerprint &&
          digestStructuredValue(input.request) === loaded.workflow.fingerprint,
      );
      await this.#prices(tx, loaded.workflow);
      let outcome = await this.#readTerminal(tx, loaded);
      if (outcome === null) {
        const evidence = await this.#terminalEvidence(tx, loaded);
        if (evidence === null) return { kind: "unavailable" };
        outcome = terminalProjection(
          evidence.record.invocationReceipt,
          loaded.workflow,
          this.#scope,
        ).outcome;
        if (outcome.kind === "reconciliation-required")
          return { kind: "unavailable" };
        await this.#persistTerminal(tx, loaded, evidence, outcome, true);
      }
      return parseModelCommercialVerifiedTerminalV1(
        {
          kind: "verified",
          authority: "canonical-model-terminal-v1",
          requestDigest: loaded.workflow.fingerprint,
          reservationId: loaded.workflow.request.reservationId,
          dispatchIntentId: loaded.workflow.dispatchIntent?.dispatchIntentId,
          pricingAuthorityDigest:
            loaded.workflow.resolvedContext?.estimateResult.pricingAuthority
              .authorityDigest,
          outcome,
        },
        input.request,
      );
    }, true);
  }
  recoverLiveVerified(
    input: Parameters<
      ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]
    >[0],
  ): ReturnType<ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]> {
    return this.#readLiveVerified(input, true);
  }
  /** Verify an already recorded canonical terminal only. Missing terminal
   * evidence stays unavailable; observation cannot create financial outcomes. */
  readLiveVerified(
    input: Parameters<
      ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]
    >[0],
  ): ReturnType<ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]> {
    return this.#readLiveVerified(input, false);
  }
  #readLiveVerified(
    input: Parameters<
      ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]
    >[0],
    reconcile: boolean,
  ): ReturnType<ModelLiveCommercialTerminalRecoveryPortV2["recoverVerified"]> {
    accountingAssert(this.#liveBinding !== null);
    return this.#transaction(async (tx, loaded) => {
      const runtime = parseLiveRuntimeRecord(loaded.runtime, this.#scope);
      accountingAssert(
        input.requestDigest === loaded.workflow.fingerprint &&
          digestStructuredValue(input.request) ===
            loaded.workflow.fingerprint &&
          digestStructuredValue(input.admissionRequest) ===
            digestStructuredValue(runtime.request),
      );
      await this.#prices(tx, loaded.workflow);
      let outcome = await this.#readTerminal(tx, loaded);
      if (outcome === null) {
        if (!reconcile) return { kind: "unavailable" };
        const evidence = await this.#liveTerminalEvidence(tx, loaded);
        if (evidence === null) return { kind: "unavailable" };
        outcome = terminalProjection(
          evidence.record.invocationReceipt,
          loaded.workflow,
          this.#scope,
        ).outcome;
        // Completed evaluations require an actual immutable validation receipt;
        // negative quality is still a recorded evaluation, never activation.
        accountingAssert(
          (outcome.kind === "release" &&
            outcome.event.chargedCreditUnits === 0 &&
            evidence.liveValidationReceipt === null) ||
            (outcome.kind === "settlement" &&
              evidence.sourceKind === "live-invocation-journal" &&
              evidence.liveValidationReceipt !== null),
        );
        await this.#persistTerminal(tx, loaded, evidence, outcome, true);
      }
      const a = runtime.request;
      return parseModelLiveCommercialVerifiedTerminalV2(
        {
          kind: "verified",
          authority: "canonical-model-live-terminal-v2",
          requestDigest: loaded.workflow.fingerprint,
          reservationId: loaded.workflow.request.reservationId,
          dispatchIntentId: loaded.workflow.dispatchIntent?.dispatchIntentId,
          pricingAuthorityDigest:
            loaded.workflow.resolvedContext?.estimateResult.pricingAuthority
              .authorityDigest,
          evaluation: {
            runtimeRequestDigest: a.requestDigest,
            liveEvaluationPlanDigest: a.liveEvaluationPlanDigest,
            liveEvaluationAuthorityDigest: a.liveEvaluationAuthorityDigest,
            evaluationCaseId: a.evaluationCaseId,
            evaluationCaseDigest: a.evaluationCaseDigest,
          },
          outcome,
        },
        input.request,
        runtime.request,
      );
    }, true);
  }
}
