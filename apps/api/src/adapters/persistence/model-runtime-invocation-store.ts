import {
  digestStructuredValue,
  type ModelGatewayResultV1,
  type ModelInvocationClaimV1,
  type ModelInvocationClaimResultV1,
  type ModelInvocationStore,
} from "@cloudmarkup/model-gateway";

import {
  MODEL_RESULT_MAXIMUM_BYTES,
  bytesOf,
  decodeJson,
  digestBytes,
  hex,
  parseClaim,
  parseResult,
  parseScope,
  persistenceFailure,
  resultObjectSchema,
  same,
  validEscalation,
  type ModelInvocationScope,
  type ModelResultObjectReference,
} from "./model-runtime-invocation-codec.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlValue,
} from "./sql.js";

/** Explicit reviewed restricted-content publication seam. No default retention
 * implementation is selected. put must publish exact immutable report metadata
 * in stored_objects before returning. Bodies are never SQL or log payloads. */
export interface ModelRuntimeResultObjectPort {
  put(input: {
    readonly bytes: Uint8Array;
    readonly digest: ModelResultObjectReference["digest"];
    readonly scope: ModelInvocationScope;
  }): Promise<ModelResultObjectReference>;
  get(
    input: ModelResultObjectReference & {
      readonly scope: ModelInvocationScope;
    },
  ): Promise<Uint8Array>;
}

interface LoadedInvocation {
  readonly claim: ModelInvocationClaimV1;
  readonly row: SqlRow;
}

/** One host-authorized exact scope; never construct from an HTTP payload.
 * This is claim/result persistence, not authentication, runtime lease admission,
 * quota reservation, commercial settlement, or permission to invoke a model. */
export class PostgresModelInvocationStore implements ModelInvocationStore {
  readonly #database: SqlDatabase;
  readonly #objects: ModelRuntimeResultObjectPort;
  readonly #scope: ModelInvocationScope;
  readonly #scopeHex: string;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly objects: ModelRuntimeResultObjectPort;
    readonly scope: ModelInvocationScope;
  }) {
    this.#database = input.database;
    this.#objects = input.objects;
    this.#scope = parseScope(input.scope);
    this.#scopeHex = hex(digestStructuredValue(this.#scope));
  }
  #scopeValues(): readonly SqlValue[] {
    return [
      this.#scope.organizationId,
      this.#scopeHex,
      this.#scope.projectId ?? null,
      this.#scope.userId,
    ];
  }
  async #lock(tx: SqlExecutor): Promise<void> {
    // A scope-local transaction fence also serializes distinct invocation IDs
    // competing for one escalation lineage or idempotency identity.
    await tx.query(
      sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `model-invocation:${this.#scope.organizationId}:${this.#scopeHex}`,
      ]),
    );
  }
  async #load(
    executor: SqlExecutor,
    invocationId: string,
  ): Promise<LoadedInvocation | null> {
    const result = await executor.query(
      sql(
        "SELECT * FROM model_runtime_invocations WHERE organization_id=$1 AND scope_sha256=$2 AND project_id IS NOT DISTINCT FROM $3 AND principal_id=$4 AND invocation_id=$5",
        [...this.#scopeValues(), invocationId],
      ),
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    let metadata = row["claim_metadata"];
    if (typeof metadata === "string")
      metadata = decodeJson(new TextEncoder().encode(metadata));
    const claim = parseClaim(metadata);
    if (
      claim.invocationId !== invocationId ||
      row["claim_sha256"] !== hex(digestStructuredValue(claim)) ||
      row["idempotency_key_sha256"] !== hex(claim.idempotencyKeyDigest) ||
      row["escalation_lineage_sha256"] !==
        (claim.escalation === undefined
          ? null
          : hex(claim.escalation.lineageDigest)) ||
      row["original_invocation_id"] !==
        (claim.escalation?.originalInvocationId ?? null) ||
      !["in-progress", "complete", "failed"].includes(String(row["state"]))
    )
      persistenceFailure();
    return { claim, row };
  }
  async #result(
    executor: SqlExecutor,
    stored: LoadedInvocation,
  ): Promise<ModelGatewayResultV1 | null> {
    if (stored.row["state"] !== "complete") return null;
    const reference = resultObjectSchema.safeParse({
      objectId: stored.row["result_object_id"],
      digest: `sha256:${String(stored.row["result_sha256"])}`,
      sizeBytes: Number(stored.row["result_size_bytes"]),
    });
    if (!reference.success) return persistenceFailure();
    await this.#verifyObject(executor, reference.data);
    const bytes = await this.#objects.get({
      ...reference.data,
      scope: this.#scope,
    });
    if (
      bytes.byteLength !== reference.data.sizeBytes ||
      digestBytes(bytes) !== reference.data.digest
    )
      return persistenceFailure();
    return parseResult(decodeJson(bytes), stored.claim, this.#scope);
  }
  async #verifyObject(
    executor: SqlExecutor,
    reference: ModelResultObjectReference,
  ): Promise<void> {
    const found = await executor.query(
      sql(
        "SELECT object_id FROM stored_objects WHERE organization_id=$1 AND project_id IS NOT DISTINCT FROM $2 AND object_id=$3 AND content_sha256=$4 AND size_bytes=$5 AND media_type='application/json' AND object_purpose='report' AND lifecycle_state='published'",
        [
          this.#scope.organizationId,
          this.#scope.projectId ?? null,
          reference.objectId,
          hex(reference.digest),
          reference.sizeBytes,
        ],
      ),
    );
    if (found.rowCount !== 1) persistenceFailure();
  }
  async claim(
    raw: ModelInvocationClaimV1,
  ): Promise<ModelInvocationClaimResultV1> {
    const claim = parseClaim(raw);
    // Result objects are read outside database transactions. Terminal rows are
    // immutable; a short SQL transaction rechecks their state before fencing.
    const originalResult =
      claim.escalation === undefined
        ? null
        : await this.loadCompleted(claim.escalation.originalInvocationId);
    const outcome = await this.#database.transaction<
      | ModelInvocationClaimResultV1
      | { kind: "load-complete"; stored: LoadedInvocation }
    >(async (tx) => {
      await this.#lock(tx);
      const existing = await this.#load(tx, claim.invocationId);
      if (existing !== null) {
        if (!same(existing.claim, claim)) return { kind: "conflict" };
        if (existing.row["state"] === "in-progress")
          return { kind: "duplicate-in-progress" };
        return existing.row["state"] === "complete"
          ? { kind: "load-complete", stored: existing }
          : { kind: "conflict" };
      }
      const reserved = await tx.query(
        sql(
          "SELECT invocation_id FROM model_runtime_invocations WHERE organization_id=$1 AND scope_sha256=$2 AND (idempotency_key_sha256=$3 OR escalation_lineage_sha256=$4)",
          [
            this.#scope.organizationId,
            this.#scopeHex,
            hex(claim.idempotencyKeyDigest),
            claim.escalation === undefined
              ? null
              : hex(claim.escalation.lineageDigest),
          ],
        ),
      );
      if (reserved.rowCount !== 0) return { kind: "conflict" };
      if (claim.escalation !== undefined) {
        const original = await this.#load(
          tx,
          claim.escalation.originalInvocationId,
        );
        if (
          original?.row["state"] !== "complete" ||
          !validEscalation(claim, originalResult)
        )
          return { kind: "conflict" };
      }
      await tx.query(
        sql(
          `INSERT INTO model_runtime_invocations
          (organization_id,scope_sha256,project_id,principal_id,invocation_id,claim_sha256,claim_metadata,idempotency_key_sha256,escalation_lineage_sha256,original_invocation_id,state)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'in-progress')`,
          [
            ...this.#scopeValues(),
            claim.invocationId,
            hex(digestStructuredValue(claim)),
            new TextDecoder().decode(bytesOf(claim)),
            hex(claim.idempotencyKeyDigest),
            claim.escalation === undefined
              ? null
              : hex(claim.escalation.lineageDigest),
            claim.escalation?.originalInvocationId ?? null,
          ],
        ),
      );
      return { kind: "claimed" };
    });
    if (outcome.kind !== "load-complete") return outcome;
    const result = await this.#result(this.#database, outcome.stored);
    if (result === null) return persistenceFailure();
    return { kind: "duplicate-complete", result };
  }
  async complete(
    raw: ModelInvocationClaimV1,
    rawResult: ModelGatewayResultV1,
  ): Promise<void> {
    const claim = parseClaim(raw);
    const result = parseResult(rawResult, claim, this.#scope);
    const bytes = bytesOf(result);
    if (bytes.byteLength > MODEL_RESULT_MAXIMUM_BYTES) persistenceFailure();
    const prior = await this.#load(this.#database, claim.invocationId);
    if (prior === null || !same(prior.claim, claim)) persistenceFailure();
    if (prior.row["state"] === "complete") {
      if (!same(await this.#result(this.#database, prior), result))
        persistenceFailure();
      return;
    }
    if (prior.row["state"] !== "in-progress") persistenceFailure();
    // Publish before the short metadata transition. A competing terminal
    // transition can leave an unreferenced object for publication reconciliation;
    // it cannot replace a result, repeat dispatch, or strand the SQL pool.
    const expectedDigest = digestBytes(bytes);
    const reference = resultObjectSchema.safeParse(
      await this.#objects.put({
        bytes,
        digest: expectedDigest,
        scope: this.#scope,
      }),
    );
    if (
      !reference.success ||
      reference.data.digest !== expectedDigest ||
      reference.data.sizeBytes !== bytes.byteLength
    )
      persistenceFailure();
    await this.#database.transaction(async (tx) => {
      await this.#lock(tx);
      const existing = await this.#load(tx, claim.invocationId);
      if (existing === null || !same(existing.claim, claim))
        persistenceFailure();
      if (existing.row["state"] === "complete") {
        if (
          existing.row["result_sha256"] !== hex(expectedDigest) ||
          Number(existing.row["result_size_bytes"]) !== bytes.byteLength
        )
          persistenceFailure();
        return;
      }
      if (existing.row["state"] !== "in-progress") persistenceFailure();
      await this.#verifyObject(tx, reference.data);
      const updated = await tx.query(
        sql(
          "UPDATE model_runtime_invocations SET state='complete',result_object_id=$6,result_sha256=$7,result_size_bytes=$8 WHERE organization_id=$1 AND scope_sha256=$2 AND project_id IS NOT DISTINCT FROM $3 AND principal_id=$4 AND invocation_id=$5 AND state='in-progress'",
          [
            ...this.#scopeValues(),
            claim.invocationId,
            reference.data.objectId,
            hex(reference.data.digest),
            reference.data.sizeBytes,
          ],
        ),
      );
      if (updated.rowCount !== 1) persistenceFailure();
    });
  }
  async fail(raw: ModelInvocationClaimV1, safeCode: string): Promise<void> {
    const claim = parseClaim(raw);
    if (
      !/^model-[a-z-]+\.[a-z][a-z0-9-]{0,95}$/u.test(safeCode) ||
      safeCode.length > 128
    )
      persistenceFailure();
    await this.#database.transaction(async (tx) => {
      await this.#lock(tx);
      const existing = await this.#load(tx, claim.invocationId);
      if (existing === null || !same(existing.claim, claim))
        persistenceFailure();
      if (
        existing.row["state"] === "failed" &&
        existing.row["failure_code"] === safeCode
      )
        return;
      if (existing.row["state"] !== "in-progress") persistenceFailure();
      const updated = await tx.query(
        sql(
          "UPDATE model_runtime_invocations SET state='failed',failure_code=$6 WHERE organization_id=$1 AND scope_sha256=$2 AND project_id IS NOT DISTINCT FROM $3 AND principal_id=$4 AND invocation_id=$5 AND state='in-progress'",
          [...this.#scopeValues(), claim.invocationId, safeCode],
        ),
      );
      if (updated.rowCount !== 1) persistenceFailure();
    });
  }
  async loadCompleted(
    invocationId: string,
  ): Promise<ModelGatewayResultV1 | null> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(invocationId))
      persistenceFailure();
    const stored = await this.#load(this.#database, invocationId);
    return stored === null ? null : this.#result(this.#database, stored);
  }
}
