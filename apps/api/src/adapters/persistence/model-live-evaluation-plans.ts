import { randomUUID } from "node:crypto";
import {
  ModelLiveEvaluationPlanError,
  validateModelLiveEvaluationDefinitionV2,
} from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue,
  digestModelLiveEvaluationApprovalV2,
  digestModelLiveEvaluationPlanV2,
  modelLiveEvaluationApprovalV2Schema,
  modelEvaluationDatasetV1Schema,
  modelLiveEvaluationPlanV2Schema,
  modelLiveEvaluationScopeV2Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelLiveEvaluationDefinitionV2,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import {
  requireRecentAuthentication,
  type Principal,
} from "../../application/identity.js";
import {
  sql,
  type SqlDatabase,
  type SqlExecutor,
  type SqlRow,
  type SqlStatement,
} from "./sql.js";

type Scope = ModelLiveEvaluationDefinitionV2["scope"];
export interface ModelLiveEvaluationConfigurationV2 {
  readonly environment: Scope["environment"];
  /** Reviewed platform operators; organization ownership alone cannot approve. */
  resolveOperatorPrincipalIds(): Promise<readonly string[]>;
  /** Host configuration and frozen source, never public request metadata. A
   * changed/removed definition revokes previously issued execution authority. */
  resolveDefinition(definitionId: string): Promise<{
    readonly definition: unknown;
    readonly dataset: unknown;
    readonly policy: unknown;
  } | null>;
}
const MAXIMUM_PLAN_BYTES = 40 * 1024;
const same = (a: unknown, b: unknown) =>
  digestCanonicalValue(a) === digestCanonicalValue(b);
const hex = (digest: string) => sha256DigestSchema.parse(digest).slice(7);
function requireAuthority(value: boolean): asserts value {
  if (!value) throw new ModelLiveEvaluationPlanError();
}
function activePolicy(definition: ModelLiveEvaluationDefinitionV2) {
  const policy = definition.policy;
  const scope = definition.scope;
  return (
    !policy.killSwitches.global.engaged &&
    !policy.killSwitches.capabilitySwitches.some(
      (c) =>
        c.engaged &&
        definition.cases.some(
          (e) => e.authorityBinding.authorityTuple.operation === c.operation,
        ),
    ) &&
    !policy.administrativeSuspensions.some(
      (s) =>
        s.scopeId ===
        (s.scope === "organization" ? scope.organizationId : scope.userId),
    )
  );
}

/** Durable operator approval and revocation only. Principal/scope must originate
 * from the verified host, never request JSON. Production requires verified
 * Cognito authentication plus current database membership. This does not claim
 * runtime capacity, reserve credits, produce an evaluation report or call AI. */
export class PostgresModelLiveEvaluationPlans {
  readonly #database: SqlDatabase;
  readonly #scope: Scope;
  readonly #principal: Principal;
  readonly #configuration: ModelLiveEvaluationConfigurationV2;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: Scope;
    readonly principal: Principal;
    readonly configuration: ModelLiveEvaluationConfigurationV2;
  }) {
    this.#database = input.database;
    this.#scope = modelLiveEvaluationScopeV2Schema.parse(input.scope);
    this.#principal = Object.freeze({ ...input.principal });
    this.#configuration = {
      environment: input.configuration.environment,
      resolveOperatorPrincipalIds:
        input.configuration.resolveOperatorPrincipalIds.bind(
          input.configuration,
        ),
      resolveDefinition: input.configuration.resolveDefinition.bind(
        input.configuration,
      ),
    };
    requireAuthority(
      this.#configuration.environment === this.#scope.environment &&
        this.#principal.authenticationSource === "cognito" &&
        solutionStableIdSchema.safeParse(this.#principal.principalId).success &&
        solutionStableIdSchema.safeParse(this.#principal.sessionId).success &&
        utcTimestampSchema.safeParse(this.#principal.authenticatedAt).success &&
        utcTimestampSchema.safeParse(this.#principal.expiresAt).success,
    );
  }
  async #now(tx: SqlExecutor): Promise<string> {
    const result = await tx.query(
      sql(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
      ),
    );
    return utcTimestampSchema.parse(result.rows[0]?.["now"]);
  }
  #session(now: string, operator: boolean) {
    const observed = Date.parse(now);
    requireAuthority(
      observed < Date.parse(this.#principal.expiresAt) &&
        Date.parse(this.#principal.authenticatedAt) <= observed + 60_000,
    );
    if (operator) requireRecentAuthentication(this.#principal, new Date(now));
    else requireAuthority(this.#principal.principalId === this.#scope.userId);
  }
  async #operator(userId: string) {
    const configured = await this.#configuration.resolveOperatorPrincipalIds();
    requireAuthority(Array.isArray(configured) && configured.length <= 16);
    const ids = configured.map((id) => solutionStableIdSchema.parse(id));
    requireAuthority(new Set(ids).size === ids.length && ids.includes(userId));
  }
  async #authorize(tx: SqlExecutor, userId: string, operator: boolean) {
    const scope = this.#scope;
    const result = await tx.query(
      sql(
        `SELECT r.role_key FROM memberships m
      JOIN principals p ON p.principal_id=m.principal_id AND p.lifecycle_status='active'
      JOIN organizations o ON o.organization_id=m.organization_id AND o.lifecycle_status='active'
      JOIN organization_roles r ON r.organization_id=m.organization_id AND r.role_key=m.role_key
      JOIN projects pr ON pr.organization_id=m.organization_id AND pr.project_id=$2 AND pr.lifecycle_status='active'
      WHERE m.organization_id=$1 AND m.principal_id=$3 AND m.lifecycle_status='active'
      AND r.policy_version='authorization-v2' AND r.capabilities=cloudmarkup_authorization_v2_permissions(r.role_key)
      AND r.capabilities @> ARRAY['projects.mutate','commercial.expensive.use']::text[]
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f
        WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
      FOR SHARE OF m,p,o,r,pr`,
        [scope.organizationId, scope.projectId, userId],
      ),
    );
    requireAuthority(
      result.rowCount === 1 &&
        (!operator || result.rows[0]?.["role_key"] === "owner"),
    );
  }
  async #transaction<T>(
    operator: boolean,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#database.transaction(async (tx) => {
        this.#session(await this.#now(tx), operator);
        await this.#authorize(tx, this.#scope.userId, false);
        if (operator) {
          await this.#operator(this.#principal.principalId);
          await this.#authorize(tx, this.#principal.principalId, true);
        }
        // Match runtime/accounting serialization before locking one plan.
        for (const key of [
          `runtime-admission:${this.#scope.organizationId}`,
          `live-evaluation-plan:${this.#scope.organizationId}:${this.#scope.projectId}:${this.#scope.userId}`,
        ]) {
          await tx.query(
            sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]),
          );
        }
        this.#session(await this.#now(tx), operator);
        if (operator) await this.#operator(this.#principal.principalId);
        const result = await work(tx);
        if (operator) await this.#operator(this.#principal.principalId);
        this.#session(await this.#now(tx), operator);
        return result;
      });
    } catch {
      throw new ModelLiveEvaluationPlanError();
    }
  }
  async #definition(id: string): Promise<ModelLiveEvaluationDefinitionV2> {
    const found = await this.#configuration.resolveDefinition(
      solutionStableIdSchema.parse(id),
    );
    requireAuthority(found !== null);
    const definition = validateModelLiveEvaluationDefinitionV2({
      definition: found.definition,
      dataset: found.dataset,
      expectedPolicy: found.policy,
    });
    requireAuthority(
      definition.definitionId === id &&
        same(definition.scope, this.#scope) &&
        activePolicy(definition),
    );
    return definition;
  }
  #parse(row: SqlRow, mode: "current" | "issued"): ModelLiveEvaluationPlanV2 {
    const value: unknown =
      typeof row["plan_record"] === "string"
        ? JSON.parse(row["plan_record"])
        : row["plan_record"];
    const plan = modelLiveEvaluationPlanV2Schema.parse(value);
    requireAuthority(
      Buffer.byteLength(JSON.stringify(plan), "utf8") <= MAXIMUM_PLAN_BYTES,
    );
    const d = plan.definition;
    requireAuthority(
      same(d.scope, this.#scope) &&
        row["organization_id"] === this.#scope.organizationId &&
        row["project_id"] === this.#scope.projectId &&
        row["principal_id"] === this.#scope.userId &&
        row["operator_principal_id"] === plan.approval.operatorUserId &&
        row["definition_id"] === d.definitionId &&
        row["definition_sha256"] === hex(d.definitionDigest) &&
        row["approval_sha256"] === hex(plan.approval.approvalDigest) &&
        row["plan_sha256"] === hex(plan.planDigest) &&
        row["plan_id"] === plan.planId &&
        typeof row["revoked"] === "boolean" &&
        (mode === "issued" || !row["revoked"]),
    );
    return plan;
  }
  async #load(
    tx: SqlExecutor,
    definitionId: string,
    mode: "current" | "issued" = "current",
  ): Promise<ModelLiveEvaluationPlanV2 | null> {
    const scope = this.#scope;
    const found = await tx.query(
      sql(
        `SELECT p.*, EXISTS(SELECT 1 FROM model_live_evaluation_revocations r
        WHERE r.organization_id=p.organization_id AND r.project_id=p.project_id
        AND r.principal_id=p.principal_id AND r.plan_sha256=p.plan_sha256) AS revoked
      FROM model_live_evaluation_plans p
      WHERE p.organization_id=$1 AND p.project_id=$2 AND p.principal_id=$3 AND p.definition_id=$4`,
        [scope.organizationId, scope.projectId, scope.userId, definitionId],
      ),
    );
    return found.rows[0] === undefined
      ? null
      : this.#parse(found.rows[0], mode);
  }
  async #current(tx: SqlExecutor, plan: ModelLiveEvaluationPlanV2) {
    const current = await this.#definition(plan.definition.definitionId);
    requireAuthority(same(current, plan.definition));
    await this.#operator(plan.approval.operatorUserId);
    await this.#authorize(tx, plan.approval.operatorUserId, true);
    const now = Date.parse(await this.#now(tx));
    requireAuthority(
      now >= Date.parse(plan.issuedAt) && now < Date.parse(plan.expiresAt),
    );
  }
  /** Explicit approval of the exact definition the operator reviewed. Exact
   * retry returns the existing receipt; changed or revoked definitions fail. */
  async approve(input: {
    readonly definitionId: string;
    readonly expectedDefinitionDigest: string;
  }) {
    const id = solutionStableIdSchema.parse(input.definitionId);
    const expected = sha256DigestSchema.parse(input.expectedDefinitionDigest);
    return this.#transaction(true, async (tx) => {
      const definition = await this.#definition(id);
      requireAuthority(definition.definitionDigest === expected);
      const existing = await this.#load(tx, id);
      if (existing !== null) {
        await this.#current(tx, existing);
        return existing;
      }
      const now = utcTimestampSchema.parse(await this.#now(tx));
      const expiresAt = utcTimestampSchema.parse(
        new Date(
          Math.min(
            Date.parse(definition.expiresAt),
            Date.parse(now) + 24 * 60 * 60 * 1000,
          ),
        ).toISOString(),
      );
      requireAuthority(Date.parse(expiresAt) > Date.parse(now));
      const approvalMetadata = {
        contractVersion: 2 as const,
        recordKind: "model-live-evaluation-approval" as const,
        approvalId: "live_approval_" + randomUUID().replaceAll("-", ""),
        definitionDigest: definition.definitionDigest,
        scope: this.#scope,
        operatorUserId: this.#principal.principalId,
        approvedAt: now,
        expiresAt,
      };
      const approval = modelLiveEvaluationApprovalV2Schema.parse({
        ...approvalMetadata,
        approvalDigest: digestModelLiveEvaluationApprovalV2(approvalMetadata),
      });
      const metadata = {
        contractVersion: 2 as const,
        recordKind: "model-live-evaluation-plan" as const,
        planId: "live_plan_" + randomUUID().replaceAll("-", ""),
        definition,
        approval,
        issuedAt: now,
        expiresAt,
      };
      const plan = modelLiveEvaluationPlanV2Schema.parse({
        ...metadata,
        planDigest: digestModelLiveEvaluationPlanV2(metadata),
      });
      const encoded = JSON.stringify(plan);
      requireAuthority(
        Buffer.byteLength(encoded, "utf8") <= MAXIMUM_PLAN_BYTES,
      );
      await tx.query(
        sql(
          `INSERT INTO model_live_evaluation_plans
        (organization_id,project_id,principal_id,operator_principal_id,definition_id,definition_sha256,approval_sha256,plan_sha256,plan_id,plan_record,issued_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12::timestamptz)`,
          [
            this.#scope.organizationId,
            this.#scope.projectId,
            this.#scope.userId,
            approval.operatorUserId,
            definition.definitionId,
            hex(definition.definitionDigest),
            hex(approval.approvalDigest),
            hex(plan.planDigest),
            plan.planId,
            encoded,
            now,
            expiresAt,
          ],
        ),
      );
      await this.#current(tx, plan);
      return plan;
    });
  }
  /** Owns one authenticated SQL transaction for an issued plan's metadata.
   * Historical issuance is sufficient only for recovery bookkeeping. Any new
   * admission/reservation must await requireCurrentApproval before its writes;
   * once requested, that check is mandatory again before the transaction commits,
   * even if the callback catches a failed check. Never invoke a model or perform
   * external side effects inside this callback. No lease or credits are issued. */
  async withIssuedMetadata<T>(
    input: { readonly definitionId: string; readonly planDigest: string },
    work: (context: {
      readonly plan: ModelLiveEvaluationPlanV2;
      readonly principal: Principal;
      readonly transaction: SqlExecutor;
      readonly requireCurrentApproval: () => Promise<void>;
    }) => Promise<T>,
  ): Promise<T> {
    const id = solutionStableIdSchema.parse(input.definitionId);
    const digest = sha256DigestSchema.parse(input.planDigest);
    return this.#transaction(false, async (tx) => {
      const plan = await this.#load(tx, id, "issued");
      requireAuthority(plan !== null && plan.planDigest === digest);
      requireAuthority(
        Date.parse(plan.issuedAt) <= Date.parse(await this.#now(tx)),
      );
      const exposedPlan = modelLiveEvaluationPlanV2Schema.parse(plan);
      let active = true;
      const isActive = () => active;
      const authorityState = { required: false, failed: false, pending: 0 };
      const requireCurrentApproval = async () => {
        requireAuthority(active && !authorityState.failed);
        authorityState.required = true;
        authorityState.pending += 1;
        try {
          requireAuthority(same(exposedPlan, plan));
          this.#session(await this.#now(transaction), false);
          const current = await this.#load(transaction, id);
          requireAuthority(current !== null && same(current, plan));
          await this.#current(transaction, current);
          requireAuthority(isActive() && !authorityState.failed);
        } catch {
          authorityState.failed = true;
          throw new ModelLiveEvaluationPlanError();
        } finally {
          authorityState.pending -= 1;
        }
      };
      const requireSettled = () => {
        requireAuthority(
          !authorityState.failed && authorityState.pending === 0,
        );
      };
      const transaction: SqlExecutor = {
        query<TRow extends SqlRow = SqlRow>(statement: SqlStatement) {
          requireAuthority(active);
          return tx.query<TRow>(statement);
        },
      };
      try {
        const result = await work({
          plan: exposedPlan,
          principal: Object.freeze({ ...this.#principal }),
          transaction,
          requireCurrentApproval,
        });
        requireAuthority(same(exposedPlan, plan));
        requireSettled();
        if (authorityState.required) await requireCurrentApproval();
        requireSettled();
        return result;
      } finally {
        active = false;
      }
    });
  }
  /** Authentication of durable issuance/current approval, not runtime admission.
   * Call again at admission, reservation, dispatch and outcome boundaries. */
  async requireCurrent(input: {
    readonly definitionId: string;
    readonly planDigest: string;
  }) {
    return this.withIssuedMetadata(input, async (context) => {
      await context.requireCurrentApproval();
      return context.plan;
    });
  }
  /** Read the actual configured frozen case under current issued approval.
   * This is RAM-only source data, not validator or settlement authority. */
  async requireCurrentCase(input: {
    readonly definitionId: string;
    readonly planDigest: string;
    readonly caseId: string;
  }) {
    const caseId = solutionStableIdSchema.parse(input.caseId);
    const reference = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    return this.withIssuedMetadata(reference, async (context) => {
      await context.requireCurrentApproval();
      const found = await this.#configuration.resolveDefinition(
        reference.definitionId,
      );
      requireAuthority(found !== null);
      const dataset = modelEvaluationDatasetV1Schema.parse(found.dataset);
      const definition = validateModelLiveEvaluationDefinitionV2({
        definition: found.definition,
        dataset,
        expectedPolicy: found.policy,
      });
      requireAuthority(same(definition, context.plan.definition));
      const evaluationCase = dataset.cases.find(
        (entry) => entry.caseId === caseId,
      );
      requireAuthority(evaluationCase !== undefined);
      return evaluationCase;
    });
  }
  async revoke(input: {
    readonly definitionId: string;
    readonly planDigest: string;
  }): Promise<void> {
    const id = solutionStableIdSchema.parse(input.definitionId);
    const digest = sha256DigestSchema.parse(input.planDigest);
    await this.#transaction(true, async (tx) => {
      const scope = this.#scope;
      // Exact revocation remains available after configuration removal/expiry;
      // it cannot restore or change an approval, and exact retries are no-ops.
      const row = await tx.query(
        sql(
          `SELECT plan_sha256 FROM model_live_evaluation_plans
         WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND definition_id=$4`,
          [scope.organizationId, scope.projectId, scope.userId, id],
        ),
      );
      requireAuthority(
        row.rowCount === 1 && row.rows[0]?.["plan_sha256"] === hex(digest),
      );
      await tx.query(
        sql(
          `INSERT INTO model_live_evaluation_revocations
        (organization_id,project_id,principal_id,plan_sha256,operator_principal_id)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            hex(digest),
            this.#principal.principalId,
          ],
        ),
      );
    });
  }
}
