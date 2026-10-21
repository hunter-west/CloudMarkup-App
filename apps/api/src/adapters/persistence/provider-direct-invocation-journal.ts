import type { RetainedProviderDirectDispatchFence } from "../../self-host/retained-provider-dispatch.js";
import { randomUUID } from "node:crypto";
import {
  digestCanonicalValue,
  normalizedModelUsageV1Schema,
  serializeCanonicalJson,
  solutionStableIdSchema,
} from "@cloudmarkup/schemas";
import type {
  ServerByokInvocationBindingV1,
  ServerByokInvocationClaimV1,
  ServerByokInvocationLeaseV1,
  ServerByokInvocationOutcomeV1,
  ServerByokUsageObservationV1,
  ServerByokUncertainReasonV1,
} from "@cloudmarkup/model-gateway/server-byok";
import { z } from "zod";
import {
  ProviderDirectJournalErrorV1,
  requireProviderDirectBindingV1,
  requireProviderDirectJobAuthorityV1,
  providerDirectRoleAuthorityV1,
  type ProviderDirectJobAuthorityV1,
} from "../../self-host/provider-direct-invocation-policy.js";
import { sql, type SqlDatabase, type SqlExecutor, type SqlRow } from "./sql.js";

export const providerDirectQuotaV1Schema = z
  .object({
    windowId: solutionStableIdSchema,
    startsAt: normalizedModelUsageV1Schema.shape.startedAt,
    expiresAt: normalizedModelUsageV1Schema.shape.completedAt,
    maximumRequests: z.number().int().min(1).max(1000000),
    maximumOutputTokenUnits: z.string().regex(/^[1-9][0-9]{0,37}$/),
    maximumConcurrent: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.startsAt));
export type ProviderDirectQuotaV1 = Readonly<
  z.output<typeof providerDirectQuotaV1Schema>
>;

const columns =
  "binding_metadata,binding_sha256,authority_sha256,lease_token,state,usage_metadata,usage_sha256,outcome_metadata,outcome_sha256,revision";
const hex = (digest: string) => digest.slice(7);
const same = (a: unknown, b: unknown) =>
  digestCanonicalValue(a) === digestCanonicalValue(b);
const json = (value: unknown) => serializeCanonicalJson(value);
function read(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}
function fail(): never {
  throw new ProviderDirectJournalErrorV1();
}

/** Borrows an already guarded ordinary purpose handle. Never owns/closes the
 * five-pool persistence runtime. SQL/permission source must first be registered
 * by the database owner; this constructor does not create/arm tables or grants. */
export class PostgresProviderDirectInvocationJournalV1 {
  readonly #database: SqlDatabase;
  readonly #dispatchFence: RetainedProviderDirectDispatchFence;
  readonly #purpose: "proposal" | "export";
  readonly #quota: ProviderDirectQuotaV1;
  readonly #timeout: number;
  readonly #operations = new Set<Promise<unknown>>();
  #acceptClaims = true;
  #closed = false;
  #closing: Promise<void> | undefined;
  constructor(options: {
    readonly database: SqlDatabase;
    readonly dispatchFence: RetainedProviderDirectDispatchFence;
    readonly purpose: "proposal" | "export";
    readonly quota: unknown;
    readonly statementTimeoutMilliseconds: number;
  }) {
    try {
      this.#database = options.database;
      this.#dispatchFence = options.dispatchFence;
      this.#purpose = z.enum(["proposal", "export"]).parse(options.purpose);
      this.#quota = Object.freeze(
        providerDirectQuotaV1Schema.parse(structuredClone(options.quota)),
      );
      this.#timeout = z
        .number()
        .int()
        .min(1)
        .max(30000)
        .parse(options.statementTimeoutMilliseconds);
    } catch {
      throw new ProviderDirectJournalErrorV1();
    }
  }
  stopClaims(): void {
    this.#acceptClaims = false;
  }
  #claimsUnavailable(signal: AbortSignal): boolean {
    return signal.aborted || this.#closed || !this.#acceptClaims;
  }
  /** D first drains model work (including independent recovery), then closes
   * this journal, then disposes its borrowed persistence runtime exactly once. */
  close(): Promise<void> {
    this.stopClaims();
    this.#closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          (async () => {
            while (this.#operations.size > 0)
              await Promise.allSettled([...this.#operations]);
          })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new ProviderDirectJournalErrorV1());
            }, this.#timeout);
          }),
        ]);
      } finally {
        this.#closed = true;
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
    return this.#closing;
  }
  async #transaction<T>(
    binding: ServerByokInvocationBindingV1,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) return fail();
    const task = this.#database.transaction(async (tx) => {
      await tx.query(
        sql(
          "SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$1,true)",
          [String(this.#timeout)],
        ),
      );
      const identity = await tx.query(
        sql(
          "SELECT session_user::text AS login,current_user::text AS effective_role,current_setting('transaction_isolation') AS isolation",
        ),
      );
      const login = "cloudmarkup_beta_" + this.#purpose + "_runtime";
      if (
        identity.rowCount !== 1 ||
        identity.rows[0]?.["login"] !== login ||
        identity.rows[0]["effective_role"] !== login ||
        identity.rows[0]["isolation"] !== "read committed"
      )
        return fail();
      await tx.query(
        sql(
          "SELECT set_config('cloudmarkup.organization_id',$1,true),set_config('cloudmarkup.principal_id',$2,true)",
          [binding.scope.organizationId, binding.scope.userId],
        ),
      );
      // A single organization lock serializes every window and principal, so
      // unresolved reservations also count against future windows/concurrency.
      await tx.query(
        sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "provider-direct:" + binding.scope.organizationId,
        ]),
      );
      if (this.#closed) return fail();
      return work(tx);
    });
    this.#operations.add(task);
    try {
      return await task;
    } catch {
      throw new ProviderDirectJournalErrorV1();
    } finally {
      this.#operations.delete(task);
    }
  }
  #keys(binding: ServerByokInvocationBindingV1) {
    return [
      binding.scope.organizationId,
      binding.scope.projectId ?? null,
      binding.scope.userId,
      binding.invocationId,
    ];
  }
  async #load(
    tx: SqlExecutor,
    binding: ServerByokInvocationBindingV1,
  ): Promise<SqlRow | undefined> {
    const result = await tx.query(
      sql(
        `SELECT ${columns} FROM provider_direct_invocations_v1 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 FOR UPDATE`,
        this.#keys(binding),
      ),
    );
    if (result.rowCount > 1 || result.rowCount !== result.rows.length)
      return fail();
    return result.rows[0];
  }
  async #current(
    tx: SqlExecutor,
    binding: ServerByokInvocationBindingV1,
    authority: ProviderDirectJobAuthorityV1,
    signal: AbortSignal,
  ) {
    if (this.#claimsUnavailable(signal)) return fail();
    const rule = providerDirectRoleAuthorityV1(binding);
    const result = await tx.query(
      sql(
        "SELECT public.cloudmarkup_provider_direct_assert_authority_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS allowed",
        [
          binding.scope.organizationId,
          binding.scope.projectId ?? null,
          binding.scope.userId,
          binding.scope.jobId ?? null,
          authority.attemptId,
          binding.attemptNumber,
          authority.workerReference,
          hex(authority.jobInputDigest),
          authority.correlationId,
          rule.family,
        ],
      ),
    );
    if (
      result.rowCount !== 1 ||
      result.rows[0]?.["allowed"] !== true ||
      this.#claimsUnavailable(signal)
    )
      return fail();
  }
  #requireRow(
    row: SqlRow | undefined,
    binding: ServerByokInvocationBindingV1,
    authority: ProviderDirectJobAuthorityV1,
    token: string,
  ): SqlRow {
    if (
      row?.["binding_sha256"] !== hex(digestCanonicalValue(binding)) ||
      row["authority_sha256"] !== hex(digestCanonicalValue(authority)) ||
      row["lease_token"] !== token ||
      !same(read(row["binding_metadata"]), binding)
    )
      return fail();
    return row;
  }
  async #update(
    tx: SqlExecutor,
    binding: ServerByokInvocationBindingV1,
    row: SqlRow,
    state: string,
    observation: ServerByokUsageObservationV1 | null,
    outcome: ServerByokInvocationOutcomeV1 | null,
    reason: ServerByokUncertainReasonV1 | null,
  ) {
    if (this.#closed || (state === "dispatched" && !this.#acceptClaims))
      return fail();
    const result = await tx.query(
      sql(
        `UPDATE provider_direct_invocations_v1 SET state=$5,
      usage_metadata=COALESCE($6::jsonb,usage_metadata),usage_sha256=COALESCE($7,usage_sha256),
      outcome_metadata=COALESCE($8::jsonb,outcome_metadata),outcome_sha256=COALESCE($9,outcome_sha256),
      uncertain_reason=$10,revision=revision+1,updated_at=clock_timestamp()
      WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 AND lease_token=$11 AND state=$12 AND revision=$13`,
        [
          ...this.#keys(binding),
          state,
          observation === null ? null : json(observation),
          observation === null ? null : hex(digestCanonicalValue(observation)),
          outcome === null ? null : json(outcome),
          outcome === null ? null : hex(digestCanonicalValue(outcome)),
          reason,
          String(row["lease_token"]),
          String(row["state"]),
          String(row["revision"]),
        ],
      ),
    );
    if (result.rowCount !== 1) return fail();
  }
  async claim(
    raw: ServerByokInvocationBindingV1,
    rawAuthority: ProviderDirectJobAuthorityV1,
    signal: AbortSignal,
  ): Promise<ServerByokInvocationClaimV1> {
    const binding = requireProviderDirectBindingV1(raw),
      authority = requireProviderDirectJobAuthorityV1(rawAuthority);
    if (!this.#acceptClaims || signal.aborted)
      return { disposition: "refused" };
    const token = randomUUID();
    const disposition = await this.#transaction(binding, async (tx) => {
      if (!this.#acceptClaims || signal.aborted) return "refused" as const;
      const existing = await this.#load(tx, binding);
      if (existing !== undefined) {
        if (
          !same(read(existing["binding_metadata"]), binding) ||
          existing["binding_sha256"] !== hex(digestCanonicalValue(binding))
        )
          return "refused" as const;
        return ["finished", "not-dispatched"].includes(
          String(existing["state"]),
        )
          ? ("recorded" as const)
          : ("uncertain" as const);
      }
      await this.#current(tx, binding, authority, signal);
      const conflict = await tx.query(
        sql(
          `SELECT invocation_id FROM provider_direct_invocations_v1 WHERE organization_id=$1 AND
        (idempotency_key_sha256=$2 OR usage_record_id=$3 OR (job_id=$4 AND feature=$5 AND model_role=$6))`,
          [
            binding.scope.organizationId,
            hex(binding.idempotencyKeyDigest),
            binding.usageRecordId,
            binding.scope.jobId ?? null,
            binding.feature,
            binding.role,
          ],
        ),
      );
      if (conflict.rowCount > 0) return "refused" as const;
      const quota = await tx.query(
        sql(
          `SELECT count(*) FILTER (WHERE quota_window_id=$2 AND state<>'not-dispatched' OR quota_window_id<>$2 AND state IN ('claimed','dispatched','observed','uncertain'))::text AS requests,
        COALESCE(sum(CASE WHEN usage_metadata IS NOT NULL THEN (usage_metadata->>'outputUnits')::numeric WHEN state='not-dispatched' THEN 0 ELSE reserved_output_units END)
          FILTER (WHERE quota_window_id=$2 OR state IN ('claimed','dispatched','observed','uncertain')),0)::text AS output_units,
        count(*) FILTER (WHERE state IN ('claimed','dispatched','observed','uncertain'))::text AS concurrent,
        bool_and(quota_sha256=$3) FILTER (WHERE quota_window_id=$2) AS configuration_matches,
        clock_timestamp()>=$4::timestamptz AND clock_timestamp()<$5::timestamptz AS window_current
        FROM provider_direct_invocations_v1 WHERE organization_id=$1`,
          [
            binding.scope.organizationId,
            this.#quota.windowId,
            hex(digestCanonicalValue(this.#quota)),
            this.#quota.startsAt,
            this.#quota.expiresAt,
          ],
        ),
      );
      const counters = quota.rows[0];
      if (
        quota.rowCount !== 1 ||
        counters?.["window_current"] !== true ||
        counters["configuration_matches"] === false ||
        BigInt(String(counters["requests"])) >=
          BigInt(this.#quota.maximumRequests) ||
        BigInt(String(counters["concurrent"])) >=
          BigInt(this.#quota.maximumConcurrent) ||
        BigInt(String(counters["output_units"])) +
          BigInt(binding.maximumOutputTokens) >
          BigInt(this.#quota.maximumOutputTokenUnits)
      )
        return "refused" as const;
      const inserted = await tx.query(
        sql(
          `INSERT INTO provider_direct_invocations_v1
        (organization_id,project_id,principal_id,invocation_id,job_id,attempt_number,feature,model_role,idempotency_key_sha256,usage_record_id,
         binding_metadata,binding_sha256,authority_metadata,authority_sha256,lease_token,quota_window_id,quota_metadata,quota_sha256,reserved_output_units,state)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17::jsonb,$18,$19,'claimed')`,
          [
            ...this.#keys(binding),
            binding.scope.jobId ?? null,
            binding.attemptNumber,
            binding.feature,
            binding.role,
            hex(binding.idempotencyKeyDigest),
            binding.usageRecordId,
            json(binding),
            hex(digestCanonicalValue(binding)),
            json(authority),
            hex(digestCanonicalValue(authority)),
            token,
            this.#quota.windowId,
            json(this.#quota),
            hex(digestCanonicalValue(this.#quota)),
            String(binding.maximumOutputTokens),
          ],
        ),
      );
      if (inserted.rowCount !== 1 || this.#claimsUnavailable(signal))
        return fail();
      return "dispatch" as const;
    });
    if (disposition !== "dispatch") return { disposition };
    const mutate = (work: (tx: SqlExecutor, row: SqlRow) => Promise<void>) =>
      this.#transaction(binding, async (tx) => {
        const row = this.#requireRow(
          await this.#load(tx, binding),
          binding,
          authority,
          token,
        );
        await work(tx, row);
      });
    const lease: ServerByokInvocationLeaseV1 = Object.freeze({
      fundingSource: "provider-direct" as const,
      bindingDigest: digestCanonicalValue(binding),
      assertCurrent: () =>
        mutate(async (tx, row) => {
          if (row["state"] !== "claimed") return fail();
          await this.#current(tx, binding, authority, signal);
        }),
      markDispatched: () =>
        mutate(async (tx, row) => {
          if (row["state"] !== "claimed") return fail();
          await this.#current(tx, binding, authority, signal);
          // Commit the independently retained fence before the SQL transition.
          // A crash/rollback/old SQL restore cannot authorize another request.
          await this.#dispatchFence.admit(binding);
          await this.#current(tx, binding, authority, signal);
          await this.#update(tx, binding, row, "dispatched", null, null, null);
          if (signal.aborted || !this.#acceptClaims || this.#closed)
            return fail();
        }),
      observeKnownUsage: (rawObservation: ServerByokUsageObservationV1) =>
        mutate(async (tx, row) => {
          if (row["state"] !== "dispatched") return fail();
          // Validate using the canonical final schema without persisting a guessed
          // result. Only actual observation counters and metadata are stored here.
          const { result, ...observation } = normalizedModelUsageV1Schema.parse(
            { ...rawObservation, result: "invalid-output" },
          );
          void result;
          const expected = {
            attemptNumber: binding.attemptNumber,
            contractVersion: 1,
            feature: binding.feature,
            idempotencyKeyDigest: binding.idempotencyKeyDigest,
            invocationId: binding.invocationId,
            usageRecordId: binding.usageRecordId,
            scope: binding.scope,
            inputDigest: binding.inputDigest,
            modelId: binding.modelId,
            modelVersion: binding.modelVersion,
            providerId: binding.providerId,
            promptTemplateId: binding.promptTemplateId,
            promptVersion: binding.promptVersion,
          };
          const actual = Object.fromEntries(
            Object.keys(expected).map((key) => [
              key,
              observation[key as keyof typeof observation],
            ]),
          );
          if (!same(actual, expected)) return fail();
          await this.#update(
            tx,
            binding,
            row,
            "observed",
            observation,
            null,
            null,
          );
        }),
      finish: (rawOutcome: ServerByokInvocationOutcomeV1) =>
        mutate(async (tx, row) => {
          const outcome = structuredClone(rawOutcome);
          if (outcome.state === "not-dispatched") {
            if (row["state"] !== "claimed" || Object.keys(outcome).length !== 1)
              return fail();
            await this.#update(
              tx,
              binding,
              row,
              "not-dispatched",
              null,
              outcome,
              null,
            );
            return;
          }
          if (row["state"] !== "observed" || Object.keys(outcome).length !== 2)
            return fail();
          const value = normalizedModelUsageV1Schema.parse(outcome.usage);
          const { result, ...observation } = value;
          if (
            result !== outcome.state ||
            !same(observation, read(row["usage_metadata"])) ||
            row["usage_sha256"] !== hex(digestCanonicalValue(observation))
          )
            return fail();
          await this.#update(
            tx,
            binding,
            row,
            "finished",
            null,
            { state: result, usage: value },
            null,
          );
        }),
      markUncertain: (reason: ServerByokUncertainReasonV1) =>
        mutate(async (tx, row) => {
          const safe = z
            .enum([
              "dispatch-fence-failed",
              "transport",
              "body",
              "canceled",
              "usage-unavailable",
              "usage-journal-failed",
              "outcome-journal-failed",
            ])
            .parse(reason);
          if (
            !["claimed", "dispatched", "observed"].includes(
              String(row["state"]),
            )
          )
            return fail();
          await this.#update(tx, binding, row, "uncertain", null, null, safe);
        }),
    });
    return { disposition: "dispatch", lease };
  }
}
