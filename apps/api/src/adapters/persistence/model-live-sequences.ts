import { recoverRecordedRepairCaseV4 } from "./model-live-repair-case-recovery.js";
import { recoverValidatedRepairResultV4 } from "./model-live-repair-result-recovery.js";
import { unusedFinalRepairStageV4 } from "./model-live-repair-unused-stage-store.js";
import { executeProductionFinalSeedRepairV4 } from "../../production-model-live-repair-successor-dispatch.js";
import { createProductionRepairSuccessorValidationHost } from "../../production-model-live-repair-successor-host.js";
import { prepareFinalRepairCandidateOutcomeV4 } from "./model-live-repair-successor-candidate-codec.js";
import { finalRepairCandidateValidationV4 } from "./model-live-repair-successor-candidate-store.js";
import { readIssuedFinalRepairInputV4 } from "./model-live-repair-successor-usage-store.js";
import { finalRepairUsageObservationV4 } from "./model-live-repair-successor-usage-store.js";
import { readRepairDispatchExpiryV4 } from "./model-live-repair-dispatch-expiry.js";
import { recordFinalRepairDispatchV4 } from "./model-live-repair-successor-dispatch-store.js";
import { prepareModelLiveRepairSuccessorStageInputV4 } from "./model-live-repair-successor-stage-input-codec.js";
import {
  issueModelLiveRepairSuccessorInputV4,
  parseModelLiveRepairSuccessorInputRowV4,
} from "./model-live-repair-successor-input-store.js";
import { prepareProductionRepairSuccessorInput } from "../../production-model-live-repair-successor-input.js";
import {
  executeProductionFirstSeedRepairV4,
  type SeedFirstDispatchTransport,
} from "../../production-model-live-seed-dispatch.js";
import { firstSeedCandidateValidationV4 } from "./model-live-seed-candidate-store.js";
import { prepareFirstSeedCandidateOutcomeV4 } from "./model-live-seed-candidate-codec.js";
import { readSeedDispatchCanonicalV4 } from "./model-live-seed-dispatch-store.js";
import {
  createProductionSeedCandidateValidationHost,
  type ProductionSeedCandidateHostConfiguration,
} from "../../production-model-live-seed-candidate-host.js";
import { firstSeedUsageObservationV4 } from "./model-live-seed-usage-observation-store.js";
import { recordFirstSeedDispatchV4 } from "./model-live-seed-dispatch-store.js";
import {
  modelPlatformReservationInputSchema,
  modelPlatformReservationReceiptSchema,
  type ModelPlatformReservationInput,
  type ModelPlatformReservationReceipt,
} from "../model-platform-spend.js";
import {
  configuredSeedModel,
  prepareSeedInvocation,
  type SeedInvocationHostControls,
} from "./model-live-seed-invocation-preparation.js";
import { PostgresModelCommercialAccountingEngine } from "./model-commercial-accounting-engine.js";
import {
  modelAccountingBindingSchema,
  verifyModelAccountingCommonBinding,
} from "./model-commercial-accounting-codec.js";
import {
  MODEL_SEED_ACCOUNTING_WINDOW_MAPPING,
  MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
  verifyModelSeedSequenceAccountingRuntimeV4,
  modelSeedAccountingBindingSchema,
  verifyModelSeedAccountingRuntime,
  type ModelSeedAccountingBinding,
} from "./model-live-seed-commercial-accounting-codec.js";
import {
  PostgresRuntimeAdmissionEngine,
  type RuntimeAdmissionTransactionPort,
  type RuntimeAdmissionEngineCodec,
} from "./model-runtime-admission-engine.js";
import {
  parseSeedRuntimeRecord,
  parseSeedRuntimeClaim,
  parseSeedRuntimeTerminal,
  parseSeedRuntimeStateRequest,
  parseSeedRuntimeRecordV4,
  type SeedRuntimeAdmissionRecordV3,
  type SeedRuntimeAdmissionRecordV4,
  parseSeedRuntimeClaimV4,
  parseSeedRuntimeTerminalV4,
} from "./model-live-seed-runtime-admission-codec.js";
import {
  bindPreparedSeedRuntime,
  bindPreparedSeedRuntimeV4,
  bindPreparedSeedCapacityV4,
  bindSeedRuntimeStoreClaimV4,
  type SeedRuntimeStoreBindingV4,
  bindPreparedSeedCapacity,
  type SeedRuntimeCapacityBinding,
  bindSeedRuntimeStoreState,
  bindSeedRuntimeStoreClaim,
  type SeedRuntimeStoreBinding,
} from "./model-live-seed-runtime-host-binding.js";
import {
  readModelCommercialAdmittedRuntime,
  readModelCommercialAdmittedSnapshot,
} from "./model-commercial-admitted-reader.js";
import { readModelCommercialSnapshotData } from "./model-commercial-snapshot-reader.js";
import {
  parseModelSeedSequenceReadRuntimeRowV4,
  parseModelLiveSequenceCommercialReadSelectorsV3,
  type ModelLiveSequenceCommercialReadSelectorsV3,
} from "./model-commercial-read-host-codec.js";
import {
  modelLiveBedrockHostConfigurationV2Schema,
  prepareModelLiveSeedStageInputV3,
  type ModelLiveBedrockHostConfigurationV2,
} from "./model-live-runtime-host-evidence-codec.js";
import {
  parseIssuedModelLiveSeedStageInputRow,
  parseModelLiveSeedStageInputRow,
} from "./model-live-seed-stage-input-codec.js";
import { randomUUID } from "node:crypto";
import {
  HOST_REPAIR_SEED_RECIPE_ID,
  HOST_REPAIR_SEED_RECIPE_VERSION,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import {
  createProductionSeedValidationHost,
  type ProductionSeedValidationHostConfiguration,
} from "../../production-model-live-seed-validation-host.js";
import {
  ModelLiveSeedValidationError,
  identifyModelLiveSeedValidationReceipt,
  modelLiveSeedValidationReferenceV1Schema,
  parseModelLiveSeedValidationRow,
  type ModelLiveSeedValidationReceiptV1,
} from "./model-live-seed-validation-codec.js";
import {
  digestModelCommercialVerifiedScopeV1,
  type ModelCommercialAccountingPort,
  type ModelCommercialAuthorizationPort,
  type ModelCommercialPricingPort,
  projectModelCommercialOperationIdentityV1,
  validateModelLiveSequenceDefinitionV3,
  parseModelLiveSeedRuntimeExecutionV3,
  parseModelLiveSeedRuntimeExecutionV4,
  projectModelLiveSeedRuntimeExecutionIdentityV4,
  type ModelLiveSeedRuntimeExecutionInputV4,
  type ModelLiveSeedRuntimeAdmissionStoreV4,
  type ModelLiveSeedRuntimeAdmissionTerminalV4,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialVerifiedScopeV1,
  type ModelCommercialWorkflowRecordV1,
  type ModelLiveSeedRuntimeExecutionInputV3,
  type ModelRuntimeStateSnapshotRequestV1,
  type ModelLiveSeedRuntimeAdmissionStoreV3,
  type ModelLiveSeedRuntimeAdmissionTerminalV3,
  type ModelProviderHostSeedInvocationV3,
  reviewedHostBoundedRepairPromptV4,
  type ModelProviderHostRepairSuccessorInvocationV4,
  type ModelProviderResultV1,
} from "@cloudmarkup/model-gateway";
import {
  digestCanonicalValue,
  modelLiveRepairSuccessorInvocationDescriptorV4Schema,
  normalizedModelUsageV1Schema,
  type NormalizedModelUsageV1,
  modelLiveEvaluationScopeV2Schema,
  modelLiveRepairCaseV3Schema,
  modelHostSeedRepairRequestV2Schema,
  modelLiveSequenceApprovalV3Schema,
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSequenceInputV3Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
  solutionStableIdSchema,
  sha256DigestSchema,
  type ModelLiveSequenceRuntimeAdmissionRequestV3,
  type ModelLiveSequenceRuntimeAdmissionRequestV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV4,
  type ModelLiveSequenceRuntimeAdmissionDecisionV3,
  utcTimestampSchema,
  type ModelLiveSequenceDefinitionV3,
  type ModelLiveSequencePlanV3,
  type ModelLiveSequenceSelectionV3,
} from "@cloudmarkup/schemas";
import {
  requireRecentAuthentication,
  type Principal,
} from "../../application/identity.js";
import {
  ModelLiveSequenceAuthorityError,
  parseIssuedModelLiveSequencePlanRow,
  parseModelLiveSequenceSelectionRow,
  requireSequenceAuthority as requireAuthority,
  sameSequenceMetadata as same,
  sequenceApprovalRequestSchema,
  sequencePlanReferenceSchema,
  sequenceSelectionReferenceSchema,
  type SequencePlanReference,
  type SequenceSelectionReference,
} from "./model-live-sequence-authority-codec.js";
import { sql, type SqlDatabase, type SqlExecutor } from "./sql.js";

type SeedRuntimeRequest =
  | ModelLiveSequenceRuntimeAdmissionRequestV3
  | ModelLiveSequenceRuntimeAdmissionRequestV4;
type SeedRuntimeDecision =
  | ModelLiveSequenceRuntimeAdmissionDecisionV3
  | ModelLiveSequenceRuntimeAdmissionDecisionV4;
type SeedRuntimeTerminal =
  | ModelLiveSeedRuntimeAdmissionTerminalV3
  | ModelLiveSeedRuntimeAdmissionTerminalV4;
type SeedRuntimeBinding<R = SeedRuntimeRequest, D = SeedRuntimeDecision> = Omit<
  SeedRuntimeStoreBinding,
  "request" | "decision"
> & { readonly request: R; readonly decision: D };
type SeedRuntimeCapacity = Omit<SeedRuntimeCapacityBinding, "request"> & {
  readonly request: SeedRuntimeRequest;
};
const seedRuntimeCodecV3 = {
  version: 3 as const,
  parseState: parseSeedRuntimeStateRequest,
  parseClaim: parseSeedRuntimeClaim,
  parseRecord: parseSeedRuntimeRecord,
  parseTerminal: parseSeedRuntimeTerminal,
};
const seedRuntimeCodecV4 = {
  version: 4 as const,
  parseState: parseSeedRuntimeStateRequest,
  parseClaim: parseSeedRuntimeClaimV4,
  parseRecord: parseSeedRuntimeRecordV4,
  parseTerminal: parseSeedRuntimeTerminalV4,
};

type SeedAccountingRuntimeRecord =
  SeedRuntimeAdmissionRecordV3 | SeedRuntimeAdmissionRecordV4;
interface SeedAccountingVersion<R extends SeedAccountingRuntimeRecord> {
  readonly mapping:
    | typeof MODEL_SEED_ACCOUNTING_WINDOW_MAPPING
    | typeof MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING;
  readonly parseRuntime: (
    value: unknown,
    scope: ModelCommercialVerifiedScopeV1,
  ) => R;
  readonly verifyRuntime: (
    workflow: ModelCommercialWorkflowRecordV1,
    runtime: R,
    binding: ModelSeedAccountingBinding,
    plan: ModelLiveSequencePlanV3,
    selection: ModelLiveSequenceSelectionV3,
    input: ReturnType<typeof modelLiveSequenceInputV3Schema.parse>,
  ) => void;
}

type Scope = ModelLiveSequenceDefinitionV3["scope"];
interface SeedDefinitionSnapshot {
  readonly definition: ModelLiveSequenceDefinitionV3;
  readonly receipts: readonly ModelLiveSeedValidationReceiptV1[];
}
export interface ModelLiveSequenceConfigurationV3 {
  readonly environment: Scope["environment"];
  /** Trusted current host configuration, never request metadata or stored rows. */
  resolveOperatorPrincipalIds(): Promise<readonly string[]>;
  /** Optional private host configuration. Absent configuration denies seed methods; historical sequence metadata retains its existing behavior. */
  resolveSeedValidationHost?(): Promise<ProductionSeedValidationHostConfiguration | null>;
  resolveSeedCandidateValidationHost?(): Promise<ProductionSeedCandidateHostConfiguration | null>;
  /** Trusted current reviewed model host configuration; absence denies input issuance. */
  resolveModelHostConfiguration?(): Promise<ModelLiveBedrockHostConfigurationV2 | null>;
  resolveDefinition(definitionId: string): Promise<{
    readonly definition: unknown;
    readonly dataset: unknown;
    readonly policy: unknown;
  } | null>;
}
const hostId = (prefix: string) => prefix + randomUUID().replaceAll("-", "");
function activePolicy(definition: ModelLiveSequenceDefinitionV3) {
  const { policy, scope } = definition;
  return (
    !policy.killSwitches.global.engaged &&
    !policy.killSwitches.capabilitySwitches.some(
      (entry) =>
        entry.engaged &&
        definition.cases.some(
          (c) =>
            c.authorityBinding.authorityTuple.operation === entry.operation,
        ),
    ) &&
    !policy.administrativeSuspensions.some(
      (entry) =>
        entry.scopeId ===
        (entry.scope === "organization" ? scope.organizationId : scope.userId),
    )
  );
}
interface SeedRepairStageRequest {
  readonly reference: SequenceSelectionReference;
  readonly caseId: string;
  readonly invocation: ModelProviderHostSeedInvocationV3;
}
/** Private authenticated seed, runtime and canonical reservation host. No public
 * routes, generic SQL callbacks, normal AI activation or report authority. */
export class PostgresModelLiveSequences {
  readonly #database: SqlDatabase;
  readonly #scope: Scope;
  readonly #principal: Principal;
  readonly #configuration: ModelLiveSequenceConfigurationV3;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly scope: Scope;
    readonly principal: Principal;
    readonly configuration: ModelLiveSequenceConfigurationV3;
  }) {
    try {
      this.#database = input.database;
      this.#scope = modelLiveEvaluationScopeV2Schema.parse(input.scope);
      this.#principal = Object.freeze({ ...input.principal });
      this.#configuration = {
        environment: input.configuration.environment,
        ...(input.configuration.resolveSeedValidationHost === undefined
          ? {}
          : {
              resolveSeedValidationHost:
                input.configuration.resolveSeedValidationHost.bind(
                  input.configuration,
                ),
            }),
        ...(input.configuration.resolveSeedCandidateValidationHost === undefined
          ? {}
          : {
              resolveSeedCandidateValidationHost:
                input.configuration.resolveSeedCandidateValidationHost.bind(
                  input.configuration,
                ),
            }),
        resolveOperatorPrincipalIds:
          input.configuration.resolveOperatorPrincipalIds.bind(
            input.configuration,
          ),
        ...(input.configuration.resolveModelHostConfiguration === undefined
          ? {}
          : {
              resolveModelHostConfiguration:
                input.configuration.resolveModelHostConfiguration.bind(
                  input.configuration,
                ),
            }),
        resolveDefinition: input.configuration.resolveDefinition.bind(
          input.configuration,
        ),
      };
      requireAuthority(
        this.#configuration.environment === this.#scope.environment &&
          this.#principal.authenticationSource === "cognito",
      );
      solutionStableIdSchema.parse(this.#principal.principalId);
      solutionStableIdSchema.parse(this.#principal.sessionId);
      utcTimestampSchema.parse(this.#principal.authenticatedAt);
      utcTimestampSchema.parse(this.#principal.expiresAt);
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }
  async #now(tx: SqlExecutor) {
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
      AND NOT EXISTS(SELECT 1 FROM project_content_write_scopes f WHERE f.organization_id=pr.organization_id AND f.project_id=pr.project_id AND f.closed_at IS NOT NULL)
      FOR SHARE OF m,p,o,r,pr`,
        [scope.organizationId, scope.projectId, userId],
      ),
    );
    requireAuthority(
      result.rowCount === 1 &&
        (!operator || result.rows[0]?.["role_key"] === "owner"),
    );
  }
  async #definition(id: string) {
    const found = await this.#configuration.resolveDefinition(id);
    requireAuthority(found !== null);
    const definition = validateModelLiveSequenceDefinitionV3({
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
  async #loadIssuedPlan(tx: SqlExecutor, id: string) {
    const scope = this.#scope;
    const result = await tx.query(
      sql(
        `SELECT p.*,
      to_char(p.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text,
      to_char(p.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at_text,
      EXISTS(SELECT 1 FROM model_live_sequence_revocations r WHERE r.organization_id=p.organization_id AND r.project_id=p.project_id AND r.principal_id=p.principal_id AND r.plan_sha256=p.plan_sha256) AS revoked
      FROM model_live_sequence_plans p WHERE p.organization_id=$1 AND p.project_id=$2 AND p.principal_id=$3 AND p.definition_id=$4`,
        [scope.organizationId, scope.projectId, scope.userId, id],
      ),
    );
    requireAuthority(result.rowCount <= 1);
    const row = result.rows[0];
    return row === undefined
      ? null
      : parseIssuedModelLiveSequencePlanRow(row, scope);
  }
  async #loadPlan(tx: SqlExecutor, id: string) {
    const issued = await this.#loadIssuedPlan(tx, id);
    if (issued === null) return null;
    requireAuthority(!issued.revoked);
    return issued.plan;
  }
  async #current(tx: SqlExecutor, reference: SequencePlanReference) {
    const plan = await this.#loadPlan(tx, reference.definitionId);
    requireAuthority(plan !== null && plan.planDigest === reference.planDigest);
    const definition = await this.#definition(reference.definitionId);
    requireAuthority(same(definition, plan.definition));
    await this.#operator(plan.approval.operatorUserId);
    await this.#authorize(tx, plan.approval.operatorUserId, true);
    const now = Date.parse(await this.#now(tx));
    requireAuthority(
      now >= Date.parse(plan.issuedAt) && now < Date.parse(plan.expiresAt),
    );
    if (this.#configuration.resolveSeedValidationHost !== undefined) {
      const receipts = await this.#definitionSeedReceipts(tx, definition);
      requireAuthority(
        receipts.every(
          (receipt) =>
            Date.parse(receipt.issuedAt) <=
            Date.parse(plan.approval.approvedAt),
        ),
      );
    }
    return plan;
  }
  async #transaction<T>(
    operator: boolean,
    work: (
      tx: SqlExecutor,
      bindCurrent: (plan: ModelLiveSequencePlanV3) => void,
    ) => Promise<T>,
    verify?: (tx: SqlExecutor) => Promise<void>,
  ): Promise<T> {
    try {
      return await this.#database.transaction(async (tx) => {
        this.#session(await this.#now(tx), operator);
        // The exact proposal triggers acquire these same exclusive keys first.
        for (const key of [
          `runtime-admission:${this.#scope.organizationId}`,
          `live-evaluation-plan:${this.#scope.organizationId}:${this.#scope.projectId}:${this.#scope.userId}`,
        ])
          await tx.query(
            sql("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]),
          );
        const authorize = async () => {
          this.#session(await this.#now(tx), operator);
          await this.#authorize(tx, this.#scope.userId, false);
          if (operator) {
            await this.#operator(this.#principal.principalId);
            await this.#authorize(tx, this.#principal.principalId, true);
          }
        };
        await authorize();
        let expectedPlan: ModelLiveSequencePlanV3 | undefined;
        const result = await work(tx, (plan) => {
          expectedPlan = modelLiveSequencePlanV3Schema.parse(plan);
        });
        await authorize();
        if (expectedPlan) {
          const current = await this.#current(tx, {
            definitionId: expectedPlan.definition.definitionId,
            planDigest: expectedPlan.planDigest,
          });
          requireAuthority(same(current, expectedPlan));
        }
        if (verify) await verify(tx);
        this.#session(await this.#now(tx), operator);
        return result;
      });
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }

  async #definitionSeedReceipts(
    tx: SqlExecutor,
    definition: ModelLiveSequenceDefinitionV3,
  ) {
    const host = await this.#seedHost();
    const receipts: ModelLiveSeedValidationReceiptV1[] = [];
    for (const entry of definition.cases) {
      const receipt = await this.#loadSeed(
        tx,
        entry.caseId,
        host.configurationDigest,
      );
      requireAuthority(
        receipt !== null &&
          receipt.caseId === entry.caseId &&
          receipt.caseDigest === entry.caseDigest &&
          receipt.frozenInputDigest === entry.sourceInputDigest &&
          receipt.datasetDigest ===
            definition.policy.evaluationRequirement.datasetDigest &&
          same(entry.seed, {
            sourceDigest: receipt.bindings.baselineSourceDigest,
            revisionDigest: receipt.bindings.solutionRevisionDigest,
            candidateDigest: receipt.bindings.sourceTreeDigest,
            ownershipDigest: receipt.ownershipDigest,
            validationReceiptDigest: receipt.receiptDigest,
            validatorPolicyDigest: receipt.bindings.policyDigest,
          }),
      );
      await this.#seedAuthority(tx, receipt);
      receipts.push(receipt);
    }
    return receipts;
  }
  async #prepareSequenceRequest<T extends { readonly definitionId: string }>(
    operator: boolean,
    parse: () => T,
  ) {
    try {
      // Schema parsing copies the reference before any await, so callers cannot
      // swap the definition or digest during source admission.
      const request = parse();
      if (this.#configuration.resolveSeedValidationHost === undefined)
        return { request, snapshot: undefined };
      const snapshot = await this.#transaction(operator, async (tx) => {
        const definition = await this.#definition(request.definitionId);
        return {
          definition,
          receipts: await this.#definitionSeedReceipts(tx, definition),
        };
      });
      for (const receipt of snapshot.receipts)
        await this.#restoreSeed(receipt, operator);
      return { request, snapshot };
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }
  async #verifyDefinitionSeeds(
    tx: SqlExecutor,
    snapshot: SeedDefinitionSnapshot | undefined,
  ) {
    if (snapshot === undefined) return;
    const definition = await this.#definition(snapshot.definition.definitionId);
    requireAuthority(same(definition, snapshot.definition));
    const receipts = await this.#definitionSeedReceipts(tx, definition);
    requireAuthority(same(receipts, snapshot.receipts));
  }

  async #seedHost() {
    const config = await this.#configuration.resolveSeedValidationHost?.();
    requireAuthority(config !== undefined && config !== null);
    requireAuthority(
      config.admission.environment.environmentType === this.#scope.environment,
    );
    return createProductionSeedValidationHost(config);
  }
  async #seedCandidateConfiguration() {
    const config =
      await this.#configuration.resolveSeedCandidateValidationHost?.();
    requireAuthority(config !== undefined && config !== null);
    requireAuthority(
      createProductionSeedValidationHost(config.seed).configurationDigest ===
        (await this.#seedHost()).configurationDigest,
    );
    return config;
  }
  async #seedCandidateHost() {
    return createProductionSeedCandidateValidationHost(
      await this.#seedCandidateConfiguration(),
    );
  }
  async #repairSuccessorHost() {
    return createProductionRepairSuccessorValidationHost(
      await this.#seedCandidateConfiguration(),
    );
  }
  async #loadSeed(
    tx: SqlExecutor,
    caseId: string,
    configurationDigest: string,
  ) {
    const scope = this.#scope;
    const result = await tx.query(
      sql(
        `SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text
       FROM model_live_seed_validation_receipts
       WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND case_id=$4 AND configuration_sha256=$5`,
        [
          scope.organizationId,
          scope.projectId,
          scope.userId,
          caseId,
          configurationDigest.slice(7),
        ],
      ),
    );
    requireAuthority(result.rowCount <= 1);
    const row = result.rows[0];
    return row === undefined
      ? null
      : parseModelLiveSeedValidationRow(row, scope);
  }
  async #seedAuthority(
    tx: SqlExecutor,
    receipt: ModelLiveSeedValidationReceiptV1,
  ) {
    const host = await this.#seedHost();
    requireAuthority(host.configurationDigest === receipt.configurationDigest);
    await this.#operator(receipt.operatorUserId);
    await this.#authorize(tx, receipt.operatorUserId, true);
    const stored = await this.#loadSeed(
      tx,
      receipt.caseId,
      receipt.configurationDigest,
    );
    requireAuthority(stored !== null && same(stored, receipt));
    requireAuthority(
      Date.parse(receipt.issuedAt) <= Date.parse(await this.#now(tx)),
    );
    return host;
  }
  async #restoreSeed(
    receipt: ModelLiveSeedValidationReceiptV1,
    operator: boolean,
    signal?: AbortSignal,
  ) {
    const active = () => {
      requireAuthority(!signal?.aborted);
    };
    const host = await this.#transaction(operator, async (tx) => {
      active();
      return this.#seedAuthority(tx, receipt);
    });
    // Reconstruct exact current source/request bindings after RAM admission and
    // outside SQL locks. This verifies stored identity, never fabricates execution.
    const metadata = await host.inspect(
      receipt.caseId,
      receipt.startedAt,
      signal,
    );
    requireAuthority(
      same(receipt.bindings, metadata.bindings) &&
        receipt.caseDigest === metadata.caseBinding.caseDigest &&
        receipt.frozenInputDigest === metadata.caseBinding.frozenInputDigest &&
        receipt.datasetDigest === metadata.caseBinding.dataset.datasetDigest &&
        receipt.bindings.recipeDigest === metadata.caseBinding.recipeDigest &&
        receipt.configurationDigest === metadata.configurationDigest &&
        receipt.ownershipDigest === metadata.ownershipDigest &&
        receipt.profileDigest === metadata.profileDigest &&
        receipt.toolchainDigest === metadata.toolchainDigest &&
        receipt.builderDigest === metadata.builderDigest &&
        receipt.scannerDigest === metadata.scannerDigest,
    );
    return this.#transaction(
      operator,
      async (tx) => {
        active();
        await this.#seedAuthority(tx, receipt);
        return receipt;
      },
      async (tx) => {
        active();
        await this.#seedAuthority(tx, receipt);
      },
    );
  }
  /** Selects only a frozen case. The private adapter owns source construction,
   * actual validation and receipt insertion; there is no arbitrary-result seal. */
  async validateSeed(rawCaseId: unknown, signal?: AbortSignal) {
    try {
      const caseId = modelLiveRepairCaseV3Schema.parse(rawCaseId);
      const active = () => {
        requireAuthority(!signal?.aborted);
      };
      const start = await this.#transaction(true, async (tx) => {
        active();
        const host = await this.#seedHost();
        const receipt = await this.#loadSeed(
          tx,
          caseId,
          host.configurationDigest,
        );
        return { host, receipt, startedAt: await this.#now(tx) };
      });
      if (start.receipt)
        return await this.#restoreSeed(start.receipt, true, signal);
      // Only the fixed native runner executes here; no database transaction is held.
      const observation = await start.host.run(caseId, start.startedAt, signal);
      const receipt = await this.#transaction(
        true,
        async (tx) => {
          active();
          const host = await this.#seedHost();
          requireAuthority(
            host.configurationDigest === start.host.configurationDigest &&
              observation.configurationDigest === host.configurationDigest,
          );
          const existing = await this.#loadSeed(
            tx,
            caseId,
            host.configurationDigest,
          );
          if (existing) {
            await this.#seedAuthority(tx, existing);
            return existing;
          }
          const now = await this.#now(tx);
          const issued = identifyModelLiveSeedValidationReceipt({
            contractVersion: 1,
            recordKind: "model-live-seed-validation-receipt",
            scope: this.#scope,
            operatorUserId: this.#principal.principalId,
            caseId,
            caseDigest: observation.caseBinding.caseDigest,
            frozenInputDigest: observation.caseBinding.frozenInputDigest,
            datasetDigest: observation.caseBinding.dataset.datasetDigest,
            recipeId: HOST_REPAIR_SEED_RECIPE_ID,
            recipeVersion: HOST_REPAIR_SEED_RECIPE_VERSION,
            sourceAuthority: "fixed-host-synthetic",
            variant: "invalid-seed",
            disposition: "invalid-repairable",
            observedDefect: "TS2322",
            cleanup: "verified",
            startedAt: start.startedAt,
            completedAt: now,
            issuedAt: now,
            configurationDigest: observation.configurationDigest,
            ownershipDigest: observation.ownershipDigest,
            profileDigest: observation.profileDigest,
            toolchainDigest: observation.toolchainDigest,
            builderDigest: observation.builderDigest,
            scannerDigest: observation.scannerDigest,
            bindings: observation.bindings,
            reportDigest: observation.reportDigest,
          });
          await tx.query(
            sql(
              `INSERT INTO model_live_seed_validation_receipts
          (organization_id,project_id,principal_id,operator_principal_id,case_id,receipt_id,receipt_sha256,configuration_sha256,receipt_record,issued_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)`,
              [
                this.#scope.organizationId,
                this.#scope.projectId,
                this.#scope.userId,
                issued.operatorUserId,
                issued.caseId,
                issued.receiptId,
                issued.receiptDigest.slice(7),
                issued.configurationDigest.slice(7),
                JSON.stringify(issued),
                now,
              ],
            ),
          );
          await this.#seedAuthority(tx, issued);
          return issued;
        },
        async (tx) => {
          active();
          const current = await this.#seedHost();
          requireAuthority(
            current.configurationDigest === start.host.configurationDigest,
          );
          const stored = await this.#loadSeed(
            tx,
            caseId,
            current.configurationDigest,
          );
          requireAuthority(stored !== null);
          await this.#seedAuthority(tx, stored);
        },
      );
      return await this.#restoreSeed(receipt, true, signal);
    } catch {
      throw new ModelLiveSeedValidationError();
    }
  }
  /** Current scoped restoration; source, result JSON and caller hashes cannot
   * acquire authority merely by matching the private codec. */
  async currentSeedValidation(rawReference: unknown, signal?: AbortSignal) {
    try {
      const reference =
        modelLiveSeedValidationReferenceV1Schema.parse(rawReference);
      const receipt = await this.#transaction(false, async (tx) => {
        requireAuthority(!signal?.aborted);
        const scope = this.#scope;
        const result = await tx.query(
          sql(
            `SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text
          FROM model_live_seed_validation_receipts
          WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND receipt_id=$4 AND receipt_sha256=$5`,
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              reference.receiptId,
              reference.receiptDigest.slice(7),
            ],
          ),
        );
        requireAuthority(result.rowCount === 1 && result.rows[0] !== undefined);
        const found = parseModelLiveSeedValidationRow(result.rows[0], scope);
        await this.#seedAuthority(tx, found);
        return found;
      });
      return await this.#restoreSeed(receipt, false, signal);
    } catch {
      throw new ModelLiveSeedValidationError();
    }
  }

  /** Authenticated RAM-only source preparation. This emits no stage-input
   * receipt and supplies no sequence, commercial or dispatch authority. */
  async prepareSeedRepair(
    rawCaseId: unknown,
    rawRequestedMode: unknown,
    signal?: AbortSignal,
  ) {
    try {
      const caseId = modelLiveRepairCaseV3Schema.parse(rawCaseId);
      const requestedMode =
        modelHostSeedRepairRequestV2Schema.shape.requestedMode.parse(
          rawRequestedMode,
        );
      const active = () => {
        requireAuthority(!signal?.aborted);
      };
      const initial = await this.#transaction(true, async (tx) => {
        active();
        const host = await this.#seedHost();
        const receipt = await this.#loadSeed(
          tx,
          caseId,
          host.configurationDigest,
        );
        requireAuthority(receipt !== null);
        await this.#seedAuthority(tx, receipt);
        return { host, receipt };
      });
      // Source reconstruction and RAM admission cannot run under a SQL lock.
      const prepared = await initial.host.prepareRepairInput(
        initial.receipt,
        requestedMode,
        signal,
      );
      return await this.#transaction(
        true,
        async (tx) => {
          active();
          await this.#seedAuthority(tx, initial.receipt);
          requireAuthority(
            prepared.receiptDigest === initial.receipt.receiptDigest &&
              prepared.configurationDigest ===
                initial.receipt.configurationDigest,
          );
          return prepared;
        },
        async (tx) => {
          active();
          await this.#seedAuthority(tx, initial.receipt);
        },
      );
    } catch {
      throw new ModelLiveSeedValidationError();
    }
  }

  async #seedStageSelection(
    tx: SqlExecutor,
    reference: SequenceSelectionReference,
  ) {
    const plan = await this.#current(tx, reference);
    const selection = await this.#selection(tx, plan);
    requireAuthority(
      selection !== null &&
        selection.selectionId === reference.selectionId &&
        selection.selectionDigest === reference.selectionDigest &&
        this.#principal.principalId === plan.approval.operatorUserId,
    );
    return { plan, selection };
  }

  /** Only a newly issued input returns RAM payload. An idempotent retry restores
   * metadata alone and cannot resurrect an invocation after content was lost. */
  async issueSeedRepairInput(
    input: SeedRepairStageRequest,
    signal?: AbortSignal,
  ) {
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const scope = this.#scope;
        const prior = await tx.query(
          sql(
            "SELECT 1 FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND invocation_id=$4 LIMIT 1",
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              prepared.stage.invocationId,
            ],
          ),
        );
        requireAuthority(prior.rowCount === 0);
        const read = () =>
          tx.query(
            sql(
              "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_sequence_inputs WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
              [
                scope.organizationId,
                scope.projectId,
                scope.userId,
                prepared.stage.stageId,
              ],
            ),
          );
        const found = await read();
        requireAuthority(found.rowCount <= 1);
        if (found.rows[0])
          return {
            kind: "existing" as const,
            record: parseModelLiveSeedStageInputRow(
              found.rows[0],
              prepared,
              now,
            ),
          };
        const body = { ...prepared.fields, issuedAt: now };
        const record = modelLiveSequenceInputV3Schema.parse({
          ...body,
          inputBindingDigest: digestCanonicalValue(body),
        });
        const encoded = JSON.stringify(record);
        requireAuthority(Buffer.byteLength(encoded, "utf8") <= 8192);
        await tx.query(
          sql(
            "INSERT INTO model_live_sequence_inputs (organization_id,project_id,principal_id,operator_principal_id,plan_sha256,selection_id,stage_id,invocation_id,input_sha256,model_configuration_sha256,seed_configuration_sha256,input_record,issued_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz)",
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              this.#principal.principalId,
              record.planDigest.slice(7),
              record.selectionId,
              record.stageId,
              record.invocationId,
              record.inputBindingDigest.slice(7),
              prepared.configurationDigest.slice(7),
              prepared.seedConfigurationDigest.slice(7),
              encoded,
              now,
            ],
          ),
        );
        const row = (await read()).rows[0];
        requireAuthority(row !== undefined);
        const issued = parseModelLiveSeedStageInputRow(
          row,
          prepared,
          await this.#now(tx),
        );
        requireAuthority(same(issued, record));
        return {
          kind: "issued" as const,
          record: issued,
          invocation: prepared.invocation,
          route: prepared.route,
          configurationDigest: prepared.configurationDigest,
        };
      },
    );
  }

  /** Canonical read observation only: no issued input, estimate consent,
   * reservation, runtime admission, provider access or normal AI authority. */
  async readSeedRepairCommercialPreflight(
    input: SeedRepairStageRequest & {
      readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
    },
    signal?: AbortSignal,
  ) {
    try {
      const selectors = parseModelLiveSequenceCommercialReadSelectorsV3(
        input.selectors,
      );
      return await this.#withSeedRepairStage(
        input,
        signal,
        async ({ tx, prepared }) => {
          const { plan, selection, stage, invocation } = prepared;
          const descriptor = invocation.descriptor;
          const policy = plan.definition.policy;
          const scope = {
            organizationId: this.#scope.organizationId,
            projectId: this.#scope.projectId,
            userId: this.#scope.userId,
          };
          const route = descriptor.routing;
          requireAuthority(
            this.#principal.principalId === scope.userId &&
              selectors.routeDefinitionDigest === route.routeDefinitionDigest &&
              selectors.modelConfigurationReference ===
                route.modelConfigurationReference &&
              selectors.pricingVersionId === route.pricingVersionReference &&
              selectors.runtimePolicyId === policy.policyId &&
              selectors.runtimePolicyVersion === policy.policyVersion &&
              selectors.runtimePolicyDigest === policy.policyDigest,
          );
          const data = await this.#readSeedCommercial(
            tx,
            plan,
            selection,
            descriptor,
            selectors,
            signal,
          );
          return {
            ...data,
            contractVersion: 3 as const,
            recordKind: "model-live-sequence-commercial-preflight" as const,
            executionClass: "live-evaluation" as const,
            planDigest: plan.planDigest,
            selectionId: selection.selectionId,
            selectionDigest: selection.selectionDigest,
            stage,
            preparedPayloadDigest: prepared.invocationDigest,
            configurationDigest: prepared.configurationDigest,
            requested: prepared.requested,
            selectors,
          };
        },
      );
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }

  async #readSeedCommercial<
    D extends Parameters<
      typeof readModelCommercialSnapshotData
    >[0]["descriptor"],
  >(
    tx: SqlExecutor,
    plan: ModelLiveSequencePlanV3,
    selection: ModelLiveSequenceSelectionV3,
    descriptor: D,
    selectors: ModelLiveSequenceCommercialReadSelectorsV3,
    signal?: AbortSignal,
  ) {
    const scope = {
      organizationId: this.#scope.organizationId,
      projectId: this.#scope.projectId,
      userId: this.#scope.userId,
    };
    const data = await readModelCommercialSnapshotData({
      database: this.#database,
      tx,
      scope,
      descriptor,
      selectors,
      authority: {
        principal: { ...this.#principal, correlationId: plan.planId },
        assertCurrent: async (transaction, candidateScope) => {
          requireAuthority(
            transaction === tx &&
              same(candidateScope, scope) &&
              !signal?.aborted,
          );
          const current = await this.#seedStageSelection(tx, {
            definitionId: plan.definition.definitionId,
            planDigest: plan.planDigest,
            selectionId: selection.selectionId,
            selectionDigest: selection.selectionDigest,
          });
          requireAuthority(
            same(current.plan, plan) && same(current.selection, selection),
          );
          this.#session(await this.#now(tx), true);
          await this.#authorize(tx, scope.userId, false);
          return {
            expiresAt: new Date(
              Math.min(
                Date.parse(plan.expiresAt),
                Date.parse(this.#principal.expiresAt),
              ),
            ).toISOString(),
          };
        },
      },
    });
    requireAuthority(
      data.entitlement.planKey === plan.definition.scope.plan &&
        data.price.environment === plan.definition.scope.environment,
    );
    return data;
  }

  /** RAM-only production source. Current plan/seed/configuration and canonical
   * entitlement are read inside closed authenticated boundaries. No caller
   * descriptor, source bytes, tenant override or generic SQL callback is accepted. */
  async prepareSeedRepairInvocation(
    input: {
      readonly reference: SequenceSelectionReference;
      readonly caseId: string;
      readonly requestedMode: "guided" | "professional";
      readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
      readonly controls: SeedInvocationHostControls;
    },
    signal?: AbortSignal,
  ) {
    try {
      const request = structuredClone(input);
      const selectors = parseModelLiveSequenceCommercialReadSelectorsV3(
        request.selectors,
      );
      return await this.#withSeedRepairSource(
        request,
        signal,
        async ({ tx, source }) => {
          const { capability, binding } = configuredSeedModel(source);
          const policy = source.plan.definition.policy;
          requireAuthority(
            selectors.routeDefinitionDigest ===
              binding.authorityBinding.authorityTuple.routeDefinitionDigest &&
              selectors.modelConfigurationReference ===
                capability.modelConfigurationReference &&
              selectors.pricingVersionId ===
                capability.pricingVersionReference &&
              selectors.runtimePolicyId === policy.policyId &&
              selectors.runtimePolicyVersion === policy.policyVersion &&
              selectors.runtimePolicyDigest === policy.policyDigest,
          );
          const snapshot = await this.#readSeedCommercial(
            tx,
            source.plan,
            source.selection,
            {
              providerId: capability.providerId,
              modelId:
                modelLiveSeedInvocationDescriptorV3Schema.shape.modelId.parse(
                  capability.modelId,
                ),
              modelVersion: capability.modelVersion,
              inferenceProfileId:
                modelLiveSeedInvocationDescriptorV3Schema.shape.inferenceProfileId
                  .unwrap()
                  .parse(capability.inferenceProfileId),
            },
            selectors,
            signal,
          );
          requireAuthority(snapshot.featureEnabled);
          const prepared = prepareSeedInvocation(
            source,
            request.controls,
            snapshot.entitlement.entitlementSnapshotId,
          );
          return {
            invocation: prepared.invocation,
            configuration: source.configuration,
          };
        },
      );
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }

  async #readSeedRuntimeInput(tx: SqlExecutor, stageId: string) {
    const scope = this.#scope;
    const found = await tx.query(
      sql(
        "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_sequence_inputs WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
        [scope.organizationId, scope.projectId, scope.userId, stageId],
      ),
    );
    requireAuthority(found.rowCount === 1 && found.rows[0] !== undefined);
    return found.rows[0];
  }

  /** Read-only capacity for an actual issued first seed. No provisional decision,
   * commercial reservation, runtime lease or mutation port is created. */
  async inspectSeedRuntimeCapacity(
    input: SeedRepairStageRequest & {
      readonly request: ModelLiveSequenceRuntimeAdmissionRequestV3;
      readonly state: ModelRuntimeStateSnapshotRequestV1;
    },
    signal?: AbortSignal,
  ) {
    const request = structuredClone(input.request);
    return this.#inspectSeedRuntimeCapacity(
      input,
      input.state,
      (prepared, issued, state) =>
        bindPreparedSeedCapacity(request, state, prepared, issued),
      seedRuntimeCodecV3,
      signal,
    );
  }

  async inspectSeedRuntimeCapacityV4(
    input: SeedRepairStageRequest & {
      readonly request: ModelLiveSequenceRuntimeAdmissionRequestV4;
      readonly state: ModelRuntimeStateSnapshotRequestV1;
      readonly commercialRequest: ModelCommercialOperationRequestV1;
    },
    signal?: AbortSignal,
  ) {
    const request = structuredClone(input.request);
    const commercial = structuredClone(input.commercialRequest);
    return this.#inspectSeedRuntimeCapacity(
      input,
      input.state,
      (prepared, issued, state) =>
        bindPreparedSeedCapacityV4(
          request,
          state,
          prepared,
          issued,
          commercial,
        ),
      seedRuntimeCodecV4,
      signal,
    );
  }

  #inspectSeedRuntimeCapacity<
    R extends SeedRuntimeRequest,
    D extends SeedRuntimeDecision,
    T extends SeedRuntimeTerminal,
  >(
    input: SeedRepairStageRequest,
    rawState: ModelRuntimeStateSnapshotRequestV1,
    bind: (
      prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
      issued: ReturnType<typeof modelLiveSequenceInputV3Schema.parse>,
      state: ModelRuntimeStateSnapshotRequestV1,
    ) => SeedRuntimeCapacity,
    codec: RuntimeAdmissionEngineCodec<R, D, T>,
    signal?: AbortSignal,
  ) {
    const state = structuredClone(rawState);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const binding = bind(prepared, issued, state);
        requireAuthority(Date.parse(state.decidedAt) <= Date.parse(now));
        const denyMutation = (): never => {
          throw new ModelLiveSequenceAuthorityError();
        };
        const reader = new PostgresRuntimeAdmissionEngine({
          database: this.#database,
          scope: {
            organizationId: this.#scope.organizationId,
            projectId: this.#scope.projectId,
            userId: this.#scope.userId,
          },
          authorityTransactions: {
            run: async (work) =>
              work(tx, await this.#now(tx), {
                requireCurrent: async () => {
                  await this.#requireSeedRuntimeCurrent(
                    tx,
                    input.reference,
                    binding,
                    prepared,
                    signal,
                  );
                },
                bindState: (candidate) => {
                  bindSeedRuntimeStoreState(binding, candidate);
                },
                bindClaim: denyMutation,
              }),
          },
          codec: {
            ...codec,
            parseClaim: denyMutation,
            parseTerminal: denyMutation,
          },
        });
        return reader.inspect(state);
      },
    );
  }

  /** Fresh store creation compares actual reconstructed RAM against the immutable
   * issued input. The returned store still grants no canonical credits or send. */
  async createSeedRuntimeAdmission(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV3;
    },
    signal?: AbortSignal,
  ): Promise<ModelLiveSeedRuntimeAdmissionStoreV3> {
    const execution = structuredClone(input.execution);
    parseModelLiveSeedRuntimeExecutionV3(execution);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const { execution: checked, identity } = bindPreparedSeedRuntime(
          execution,
          prepared,
          issued,
        );
        return this.#seedRuntimeStore(
          input.reference,
          {
            plan: checked.plan,
            request: checked.admissionRequest,
            decision: checked.admissionDecision,
            liveAuthorityReservation: checked.liveAuthorityReservation,
            ...identity,
          },
          prepared,
          signal,
        );
      },
    );
  }

  /** Fresh store creation compares actual reconstructed RAM against the immutable
   * issued input. The returned store still grants no canonical credits or send. */
  async createSeedRuntimeAdmissionV4(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
    },
    signal?: AbortSignal,
  ): Promise<ModelLiveSeedRuntimeAdmissionStoreV4> {
    const execution = structuredClone(input.execution);
    parseModelLiveSeedRuntimeExecutionV4(execution);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const { execution: checked, identity } = bindPreparedSeedRuntimeV4(
          execution,
          prepared,
          issued,
        );
        return this.#seedRuntimeStoreV4(
          input.reference,
          {
            plan: checked.plan,
            request: checked.admissionRequest,
            decision: checked.admissionDecision,
            liveAuthorityReservation: checked.liveAuthorityReservation,
            ...identity,
          },
          prepared,
          signal,
        );
      },
    );
  }

  /** Opens only an already persisted admission. It never reconstructs source,
   * checks current model configuration, or permits a fresh executable lease. */
  async openSeedRuntimeRecovery(input: {
    readonly reference: SequenceSelectionReference;
    readonly tenantScopeDigest: string;
  }): Promise<ModelLiveSeedRuntimeAdmissionStoreV3> {
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const tenantScopeDigest = sha256DigestSchema.parse(input.tenantScopeDigest);
    return this.#transaction(false, async (tx) =>
      this.#seedRuntimeStore(
        reference,
        await this.#readSeedRuntimeBinding(
          tx,
          reference,
          tenantScopeDigest,
          seedRuntimeCodecV3,
        ),
      ),
    );
  }

  /** Opens only an already persisted admission. It never reconstructs source,
   * checks current model configuration, or permits a fresh executable lease. */
  async openSeedRuntimeRecoveryV4(input: {
    readonly reference: SequenceSelectionReference;
    readonly tenantScopeDigest: string;
  }): Promise<ModelLiveSeedRuntimeAdmissionStoreV4> {
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const tenantScopeDigest = sha256DigestSchema.parse(input.tenantScopeDigest);
    return this.#transaction(false, async (tx) =>
      this.#seedRuntimeStoreV4(
        reference,
        await this.#readSeedRuntimeBinding(
          tx,
          reference,
          tenantScopeDigest,
          seedRuntimeCodecV4,
        ),
      ),
    );
  }

  async #readSeedRuntimeBinding<
    R extends SeedRuntimeRequest,
    D extends SeedRuntimeDecision,
    T extends SeedRuntimeTerminal,
  >(
    tx: SqlExecutor,
    reference: SequenceSelectionReference,
    tenantScopeDigest: string,
    codec: RuntimeAdmissionEngineCodec<R, D, T>,
  ): Promise<SeedRuntimeBinding<R, D>> {
    const issued = await this.#loadIssuedPlan(tx, reference.definitionId);
    requireAuthority(
      issued !== null && issued.plan.planDigest === reference.planDigest,
    );
    const scope = this.#scope;
    const found = await tx.query(
      sql(
        "SELECT snapshot,snapshot_sha256 FROM model_runtime_admissions WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND scope_sha256=$4 FOR UPDATE",
        [
          scope.organizationId,
          scope.projectId,
          scope.userId,
          tenantScopeDigest.slice(7),
        ],
      ),
    );
    requireAuthority(found.rowCount === 1 && found.rows[0] !== undefined);
    const row = found.rows[0];
    const record = codec.parseRecord(row["snapshot"], scope);
    requireAuthority(
      record.tenantScopeDigest === tenantScopeDigest &&
        row["snapshot_sha256"] === digestCanonicalValue(record).slice(7) &&
        record.request.liveEvaluationPlanDigest === issued.plan.planDigest &&
        record.request.selectionId === reference.selectionId &&
        record.request.selectionDigest === reference.selectionDigest,
    );
    requireAuthority(record.liveAuthorityReservation !== undefined);
    const binding = {
      plan: issued.plan,
      request: record.request,
      decision: record.decision,
      liveAuthorityReservation: record.liveAuthorityReservation,
      fingerprint: record.fingerprint,
      tenantScopeDigest,
    };
    await this.#seedRuntimeIssued(tx, reference, binding);
    return binding;
  }

  async #seedRuntimeIssued(
    tx: SqlExecutor,
    reference: SequenceSelectionReference,
    binding: SeedRuntimeCapacity,
  ) {
    const issued = await this.#loadIssuedPlan(tx, reference.definitionId);
    requireAuthority(issued !== null && same(issued.plan, binding.plan));
    const selection = await this.#selection(tx, issued.plan);
    requireAuthority(
      selection !== null &&
        selection.selectionId === reference.selectionId &&
        selection.selectionDigest === reference.selectionDigest,
    );
    const row = await this.#readSeedRuntimeInput(tx, binding.request.stageId);
    const restored = parseIssuedModelLiveSeedStageInputRow(
      row,
      issued.plan,
      selection,
      await this.#now(tx),
    );
    requireAuthority(
      restored.record.inputBindingDigest ===
        binding.request.inputBindingDigest &&
        restored.record.preparedPayloadDigest ===
          binding.request.preparedPayloadDigest &&
        restored.record.invocationId === binding.request.invocationId &&
        binding.request.liveEvaluationAuthorityDigest ===
          issued.plan.approval.approvalDigest &&
        same(
          binding.liveAuthorityReservation.limits,
          issued.plan.definition.limits,
        ),
    );
    return { row, restored, selection };
  }

  async #requireSeedRuntimeCurrent(
    tx: SqlExecutor,
    reference: SequenceSelectionReference,
    binding: SeedRuntimeCapacity,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ) {
    requireAuthority(prepared !== undefined && !signal?.aborted);
    this.#session(await this.#now(tx), true);
    const { plan, selection } = await this.#seedStageSelection(tx, reference);
    requireAuthority(
      same(plan, binding.plan) && same(selection, prepared.selection),
    );
    requireAuthority(
      digestCanonicalValue(
        modelLiveBedrockHostConfigurationV2Schema.parse(
          await this.#configuration.resolveModelHostConfiguration?.(),
        ),
      ) === prepared.configurationDigest &&
        (await this.#seedHost()).configurationDigest ===
          prepared.seedConfigurationDigest,
    );
    parseModelLiveSeedStageInputRow(
      await this.#readSeedRuntimeInput(tx, binding.request.stageId),
      prepared,
      await this.#now(tx),
    );
    requireAuthority(!signal?.aborted);
    return plan;
  }

  #seedRuntimeStore(
    reference: SequenceSelectionReference,
    binding: SeedRuntimeStoreBinding,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ): ModelLiveSeedRuntimeAdmissionStoreV3 {
    return this.#seedRuntimeStoreForVersion(
      reference,
      binding,
      seedRuntimeCodecV3,
      (value) => {
        bindSeedRuntimeStoreClaim(
          binding,
          parseSeedRuntimeClaim(value, this.#scope),
        );
      },
      prepared,
      signal,
    );
  }
  #seedRuntimeStoreV4(
    reference: SequenceSelectionReference,
    binding: SeedRuntimeStoreBindingV4,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ): ModelLiveSeedRuntimeAdmissionStoreV4 {
    return this.#seedRuntimeStoreForVersion(
      reference,
      binding,
      seedRuntimeCodecV4,
      (value) => {
        bindSeedRuntimeStoreClaimV4(
          binding,
          parseSeedRuntimeClaimV4(value, this.#scope),
        );
      },
      prepared,
      signal,
    );
  }

  #seedRuntimeStoreForVersion<
    R extends SeedRuntimeRequest,
    D extends SeedRuntimeDecision,
    T extends SeedRuntimeTerminal,
  >(
    rawReference: SequenceSelectionReference,
    binding: SeedRuntimeBinding<R, D>,
    codec: RuntimeAdmissionEngineCodec<R, D, T>,
    bindClaim: (value: unknown) => void,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ) {
    const reference = sequenceSelectionReferenceSchema.parse(rawReference);
    const authorityTransactions: RuntimeAdmissionTransactionPort<R, D, T> = {
      run: (work) => {
        let finalCurrentCheck: (() => Promise<void>) | undefined;
        return this.#transaction(
          false,
          async (tx, bindCurrent) => {
            await this.#seedRuntimeIssued(tx, reference, binding);
            const requireCurrent = async () => {
              bindCurrent(
                await this.#requireSeedRuntimeCurrent(
                  tx,
                  reference,
                  binding,
                  prepared,
                  signal,
                ),
              );
              finalCurrentCheck = requireCurrent;
              requireAuthority(!signal?.aborted);
            };
            const result = await work(tx, await this.#now(tx), {
              requireCurrent,
              bindState: (state) => {
                bindSeedRuntimeStoreState(binding, state);
              },
              bindClaim,
            });
            return result;
          },
          async () => {
            await finalCurrentCheck?.();
          },
        );
      },
    };
    return new PostgresRuntimeAdmissionEngine({
      database: this.#database,
      scope: {
        organizationId: this.#scope.organizationId,
        projectId: this.#scope.projectId,
        userId: this.#scope.userId,
      },
      authorityTransactions,
      codec: {
        ...codec,
        parseClaim: (value, scope) => {
          const claim = codec.parseClaim(value, scope);
          bindClaim(claim);
          return claim;
        },
        parseRecord: (value, scope) => {
          const record = codec.parseRecord(value, scope);
          requireAuthority(
            same(record.request, binding.request) &&
              record.fingerprint === binding.fingerprint,
          );
          return record;
        },
      },
    });
  }

  /** Current canonical authorization/pricing for an already admitted V4 workflow.
   * The returned ports read no caller-supplied prices or grants and cannot send,
   * reserve, settle or recover a model call. */
  async createSeedCommercialReadPortsV4(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
      readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
    },
    signal?: AbortSignal,
  ): Promise<ModelCommercialAuthorizationPort & ModelCommercialPricingPort> {
    const request = structuredClone(input);
    const selectors = parseModelLiveSequenceCommercialReadSelectorsV3(
      request.selectors,
    );
    return this.#withSeedRepairStage(
      request,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const { execution, identity } = bindPreparedSeedRuntimeV4(
          request.execution,
          prepared,
          issued,
        );
        const route = execution.routingDecision;
        const policy = execution.plan.definition.policy;
        requireAuthority(
          selectors.routeDefinitionDigest === route.routeDefinitionDigest &&
            selectors.modelConfigurationReference ===
              route.modelConfigurationReference &&
            selectors.pricingVersionId === route.pricingVersionReference &&
            selectors.runtimePolicyId === policy.policyId &&
            selectors.runtimePolicyVersion === policy.policyVersion &&
            selectors.runtimePolicyDigest === policy.policyDigest,
        );
        const binding: SeedRuntimeStoreBindingV4 = {
          plan: execution.plan,
          request: execution.admissionRequest,
          decision: execution.admissionDecision,
          liveAuthorityReservation: execution.liveAuthorityReservation,
          ...identity,
        };
        const scope = {
          organizationId: this.#scope.organizationId,
          projectId: this.#scope.projectId,
          userId: this.#scope.userId,
        };
        const runtime = { ...execution, policy };
        const read = () => {
          let finalCurrentCheck: (() => Promise<void>) | undefined;
          return this.#transaction(
            false,
            async (transaction, bindCurrent) => {
              const requireCurrent = async () => {
                bindCurrent(
                  await this.#requireSeedRuntimeCurrent(
                    transaction,
                    request.reference,
                    binding,
                    prepared,
                    signal,
                  ),
                );
              };
              finalCurrentCheck = requireCurrent;
              return readModelCommercialAdmittedSnapshot({
                tx: transaction,
                scope,
                runtime,
                authority: {
                  principal: {
                    ...this.#principal,
                    correlationId: execution.plan.planId,
                  },
                  assertCurrent: async (candidateTx, candidateScope) => {
                    requireAuthority(
                      candidateTx === transaction &&
                        same(candidateScope, scope),
                    );
                    await requireCurrent();
                    return {
                      expiresAt: new Date(
                        Math.min(
                          Date.parse(execution.plan.expiresAt),
                          Date.parse(this.#principal.expiresAt),
                        ),
                      ).toISOString(),
                    };
                  },
                },
                readRuntime: (candidateTx) =>
                  readModelCommercialAdmittedRuntime({
                    tx: candidateTx,
                    scope,
                    identity,
                    runtime,
                    parseRow: parseModelSeedSequenceReadRuntimeRowV4,
                  }),
                readCanonical: (candidateTx) =>
                  this.#readSeedCommercial(
                    candidateTx,
                    execution.plan,
                    execution.selection,
                    prepared.invocation.descriptor,
                    selectors,
                    signal,
                  ),
                routeExplanation:
                  "Current canonical route for the approved two-slot seed repair.",
              });
            },
            async () => {
              await finalCurrentCheck?.();
            },
          );
        };
        return {
          resolve: async (candidate) => {
            projectModelCommercialOperationIdentityV1(candidate);
            requireAuthority(same(candidate, execution.commercialRequest));
            return (await read()).authorization;
          },
          listProviderPricingVersions: async () => [(await read()).price],
          listCreditNormalizationPolicies: async () => [
            (await read()).normalization,
          ],
        };
      },
    );
  }

  /** Reserves only through the canonical algorithm after exact current RAM,
   * issued-input, runtime and coordinator-estimate bindings. */
  async createSeedCommercialReservations(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV3;
      readonly accountingBinding: ModelSeedAccountingBinding;
    },
    signal?: AbortSignal,
  ): Promise<
    Pick<
      ModelCommercialAccountingPort,
      "reserve" | "recoverExistingReservation"
    >
  > {
    const execution = structuredClone(input.execution);
    const accountingBinding = modelSeedAccountingBindingSchema.parse(
      input.accountingBinding,
    );
    parseModelLiveSeedRuntimeExecutionV3(execution);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const checked = bindPreparedSeedRuntime(execution, prepared, issued);
        requireAuthority(
          same(
            accountingBinding.routingDecision,
            checked.execution.routingDecision,
          ) &&
            accountingBinding.workflowId ===
              checked.execution.commercialRequest.multiCallWorkflowId &&
            accountingBinding.workflowFingerprint ===
              digestCanonicalValue(checked.execution.commercialRequest) &&
            accountingBinding.runtimeFingerprint ===
              checked.identity.fingerprint &&
            accountingBinding.runtimeScopeDigest ===
              checked.identity.tenantScopeDigest,
        );
        const engine = this.#seedCommercialStore(
          input.reference,
          {
            plan: checked.execution.plan,
            request: checked.execution.admissionRequest,
            decision: checked.execution.admissionDecision,
            liveAuthorityReservation:
              checked.execution.liveAuthorityReservation,
            ...checked.identity,
          },
          accountingBinding,
          prepared,
          signal,
        );
        return {
          reserve: (request) => engine.reserve(request),
          recoverExistingReservation: (request) =>
            engine.recoverExistingReservation(request),
        };
      },
    );
  }

  /** Historical single-stage entry. Closed sequence execution below retains its
   * journal across both sends; neither entry grants financial settlement. */
  async executeFirstSeedRepairV4(
    input: SeedRepairStageRequest &
      SeedFirstDispatchTransport & {
        readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
        readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
      },
    signal?: AbortSignal,
  ) {
    return executeProductionFirstSeedRepairV4(
      await this.#prepareSeedRepairExecutionV4(input, signal),
    );
  }

  /** Runs at most the two preselected repairs under the original reservation.
   * No route calls this until unused-stage accounting and recovery are complete.
   * Returns actual recorded validation metadata, never a settlement assertion. */
  async executeSeedRepairCaseV4(
    input: SeedRepairStageRequest &
      SeedFirstDispatchTransport & {
        readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
        readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
      },
    signal?: AbortSignal,
  ) {
    const context = await this.#prepareSeedRepairExecutionV4(input, signal);
    requireAuthority(
      same(context.invocation.prompt, reviewedHostBoundedRepairPromptV4),
    );
    const first = await executeProductionFirstSeedRepairV4(context);
    if (first.validation.receipt.disposition !== "invalid-repairable") {
      const unused = await context.journal.recordUnusedFinalStage();
      requireAuthority(unused.kind !== "missing");
      return {
        kind: "validated-attempts" as const,
        accounting: "pending" as const,
        first,
        final: null,
        unused,
      };
    }
    const successor = await context.journal.prepareSuccessorInput();
    await context.journal.issueSuccessorInput(successor.invocation);
    const journal = await context.journal.createSuccessorDispatchJournal(
      successor.invocation,
    );
    const final = await executeProductionFinalSeedRepairV4({
      ...context,
      journal,
    });
    return {
      kind: "validated-attempts" as const,
      accounting: "pending" as const,
      first,
      final,
      unused: null,
    };
  }

  async #prepareSeedRepairExecutionV4(
    input: SeedRepairStageRequest &
      SeedFirstDispatchTransport & {
        readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
        readonly selectors: ModelLiveSequenceCommercialReadSelectorsV3;
      },
    signal?: AbortSignal,
  ): Promise<Parameters<typeof executeProductionFirstSeedRepairV4>[0]> {
    const request = {
      reference: structuredClone(input.reference),
      caseId: input.caseId,
      invocation: structuredClone(input.invocation),
      execution: structuredClone(input.execution),
      selectors: structuredClone(input.selectors),
    };
    const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      await this.#configuration.resolveModelHostConfiguration?.(),
    );
    const candidateConfigurationDigest = (await this.#seedCandidateHost())
      .configurationDigest;
    const journal = await this.createSeedDispatchJournalV4(request, signal);
    const readers = await this.createSeedCommercialReadPortsV4(request, signal);
    return {
      database: this.#database,
      configuration,
      invocation: request.invocation,
      journal,
      pricing: input.pricing,
      httpHandler: input.httpHandler,
      ...(signal === undefined ? {} : { signal }),
      authorizeCommercial: async () => {
        requireAuthority(
          (await this.#seedCandidateHost()).configurationDigest ===
            candidateConfigurationDigest,
        );
        requireAuthority(
          same(
            configuration,
            await this.#configuration.resolveModelHostConfiguration?.(),
          ),
        );
        const authorization = await readers.resolve(
          request.execution.commercialRequest,
        );
        requireAuthority(
          authorization.allowed &&
            authorization.featureEntitled &&
            authorization.commercialState === "active",
        );
      },
    };
  }

  /** Opens the private first-stage dispatch/usage/candidate journal from exact
   * current RAM input. The provider adapter still owns the one-send HTTP fence.
   * Its actual response must reach validateKnownResponse; no caller grade or
   * externally supplied validator report is accepted. */
  async createSeedDispatchJournalV4(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
    },
    signal?: AbortSignal,
  ) {
    const execution = structuredClone(input.execution);
    parseModelLiveSeedRuntimeExecutionV4(execution);
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const checked = bindPreparedSeedRuntimeV4(execution, prepared, issued);
        const binding = {
          plan: checked.execution.plan,
          request: checked.execution.admissionRequest,
          decision: checked.execution.admissionDecision,
          liveAuthorityReservation: checked.execution.liveAuthorityReservation,
          ...checked.identity,
        };
        const accounting = modelSeedAccountingBindingSchema.parse({
          workflowId: execution.commercialRequest.multiCallWorkflowId,
          workflowFingerprint: digestCanonicalValue(
            execution.commercialRequest,
          ),
          runtimeScopeDigest: checked.identity.tenantScopeDigest,
          runtimeFingerprint: checked.identity.fingerprint,
          routingDecision: execution.routingDecision,
        });
        const identities = {
          organizationId: this.#scope.organizationId,
          projectId: this.#scope.projectId,
          userId: this.#scope.userId,
        };
        const scope: ModelCommercialVerifiedScopeV1 = {
          ...identities,
          authority: "verified-principal-scope-v1",
          tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
        };
        let ownedDispatchDigest: string | undefined;
        let successorInput:
          | Parameters<typeof prepareProductionRepairSuccessorInput>[0]
          | undefined;
        const currentValidation = async (transaction: SqlExecutor) => {
          const plan = await this.#requireSeedRuntimeCurrent(
            transaction,
            reference,
            binding,
            prepared,
            signal,
          );
          await readSeedDispatchCanonicalV4({
            tx: transaction,
            scope,
            execution,
            accounting,
            requireActive: true,
          });
          return plan;
        };
        const requireRetainedSuccessor = async (
          transaction: SqlExecutor,
          retained: Parameters<typeof prepareProductionRepairSuccessorInput>[0],
        ) => {
          await this.#seedRuntimeIssued(transaction, reference, binding);
          const plan = await currentValidation(transaction);
          const actual = await firstSeedCandidateValidationV4({
            tx: transaction,
            scope,
            execution,
            accounting,
            now: await this.#now(transaction),
            operation: { kind: "recover" },
          });
          requireAuthority(
            actual.kind !== "missing" &&
              same(actual.receipt, retained.recorded.receipt) &&
              same(actual.outcome, retained.recorded.outcome) &&
              (await this.#seedCandidateHost()).configurationDigest ===
                retained.recorded.receipt.configurationDigest,
          );
          return plan;
        };
        const observeFinalUsage = (
          operation: Parameters<
            typeof finalRepairUsageObservationV4
          >[0]["operation"],
        ) =>
          this.#transaction(false, async (transaction) => {
            await this.#seedRuntimeIssued(transaction, reference, binding);
            return finalRepairUsageObservationV4({
              tx: transaction,
              scope,
              execution,
              accounting,
              now: await this.#now(transaction),
              operation,
            });
          });
        return {
          recordUnusedFinalStage: () =>
            this.#transaction(
              false,
              async (transaction, bindCurrent) => {
                await this.#seedRuntimeIssued(transaction, reference, binding);
                bindCurrent(await currentValidation(transaction));
                return unusedFinalRepairStageV4({
                  tx: transaction,
                  scope,
                  execution,
                  accounting,
                  now: await this.#now(transaction),
                  operation: { kind: "record" },
                });
              },
              async (transaction) => {
                await currentValidation(transaction);
              },
            ),
          recoverFinalCandidateValidation: () =>
            this.#transaction(false, async (transaction) => {
              await this.#seedRuntimeIssued(transaction, reference, binding);
              return finalRepairCandidateValidationV4({
                tx: transaction,
                scope,
                execution,
                accounting,
                now: await this.#now(transaction),
                operation: { kind: "recover" },
              });
            }),
          recordFinalKnownUsage: (usage: NormalizedModelUsageV1) =>
            observeFinalUsage({
              kind: "record",
              usage: normalizedModelUsageV1Schema.parse(usage),
            }),
          recoverFinalKnownUsage: () => observeFinalUsage({ kind: "recover" }),
          assertCurrentDispatch: async () =>
            this.#transaction(
              false,
              async (transaction, bindCurrent) => {
                bindCurrent(
                  await this.#requireSeedRuntimeCurrent(
                    transaction,
                    reference,
                    binding,
                    prepared,
                    signal,
                  ),
                );
                await readSeedDispatchCanonicalV4({
                  tx: transaction,
                  scope,
                  execution,
                  accounting,
                  requireActive: true,
                });
                const rows = await transaction.query(
                  sql(
                    "SELECT dispatch_sha256 FROM model_live_sequence_dispatches WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
                    [
                      scope.organizationId,
                      scope.projectId,
                      scope.userId,
                      prepared.stage.stageId,
                    ],
                  ),
                );
                requireAuthority(
                  ownedDispatchDigest === undefined
                    ? rows.rowCount === 0
                    : rows.rowCount === 1 &&
                        rows.rows[0]?.["dispatch_sha256"] ===
                          ownedDispatchDigest.slice(7),
                );
                requireAuthority(!signal?.aborted);
                return readRepairDispatchExpiryV4({
                  tx: transaction,
                  scope,
                  execution,
                  accounting,
                  principalExpiresAt: this.#principal.expiresAt,
                  now: await this.#now(transaction),
                });
              },
              async (transaction) => {
                await this.#requireSeedRuntimeCurrent(
                  transaction,
                  reference,
                  binding,
                  prepared,
                  signal,
                );
                await readSeedDispatchCanonicalV4({
                  tx: transaction,
                  scope,
                  execution,
                  accounting,
                  requireActive: true,
                });
              },
            ),
          validateKnownResponse: async (rawResult: ModelProviderResultV1) => {
            try {
              const providerResult = structuredClone(rawResult);
              const current = currentValidation;
              const initial = await this.#transaction(
                false,
                async (transaction, bindCurrent) => {
                  await this.#seedRuntimeIssued(
                    transaction,
                    reference,
                    binding,
                  );
                  bindCurrent(await current(transaction));
                  const known = await firstSeedUsageObservationV4({
                    tx: transaction,
                    scope,
                    execution,
                    accounting,
                    now: await this.#now(transaction),
                    operation: { kind: "recover" },
                  });
                  requireAuthority(
                    known.kind !== "missing" &&
                      known.usage.result === "succeeded",
                  );
                  const host = await this.#seedCandidateHost();
                  const seedReceipt = await this.#loadSeed(
                    transaction,
                    prepared.stage.caseId,
                    prepared.seedConfigurationDigest,
                  );
                  requireAuthority(seedReceipt !== null);
                  await this.#seedAuthority(transaction, seedReceipt);
                  const existing = await firstSeedCandidateValidationV4({
                    tx: transaction,
                    scope,
                    execution,
                    accounting,
                    now: await this.#now(transaction),
                    operation: { kind: "recover" },
                  });
                  if (existing.kind !== "missing")
                    requireAuthority(
                      existing.receipt.providerResultDigest ===
                        digestCanonicalValue(providerResult) &&
                        existing.receipt.configurationDigest ===
                          host.configurationDigest,
                    );
                  return { known, host, seedReceipt, existing };
                },
                async (transaction) => {
                  await current(transaction);
                },
              );
              if (initial.existing.kind !== "missing") return initial.existing;
              // Actual native validation runs outside all SQL transactions.
              const observed = await initial.host.run(
                {
                  seedReceipt: initial.seedReceipt,
                  invocation: prepared.invocation,
                  providerResult,
                  usage: initial.known.usage,
                },
                signal,
              );
              const recorded = await this.#transaction(
                false,
                async (transaction, bindCurrent) => {
                  bindCurrent(await current(transaction));
                  requireAuthority(
                    (await this.#seedCandidateHost()).configurationDigest ===
                      initial.host.configurationDigest,
                  );
                  const known = await firstSeedUsageObservationV4({
                    tx: transaction,
                    scope,
                    execution,
                    accounting,
                    now: await this.#now(transaction),
                    operation: { kind: "recover" },
                  });
                  requireAuthority(
                    known.kind !== "missing" &&
                      same(known.observation, initial.known.observation),
                  );
                  const now = await this.#now(transaction);
                  const data = prepareFirstSeedCandidateOutcomeV4({
                    scope: this.#scope,
                    stage: execution.stageInput,
                    usage: known.usage,
                    attemptObservation: known.observation,
                    host: observed,
                    issuedAt: now,
                  });
                  return firstSeedCandidateValidationV4({
                    tx: transaction,
                    scope,
                    execution,
                    accounting,
                    now,
                    operation: { kind: "record", receipt: data.receipt },
                  });
                },
                async (transaction) => {
                  await current(transaction);
                  requireAuthority(
                    (await this.#seedCandidateHost()).configurationDigest ===
                      initial.host.configurationDigest,
                  );
                },
              );
              if (
                recorded.kind === "recorded" &&
                recorded.receipt.disposition === "invalid-repairable"
              ) {
                successorInput = {
                  invocation: prepared.invocation,
                  first: {
                    scope: this.#scope,
                    stage: execution.stageInput,
                    usage: initial.known.usage,
                    attemptObservation: initial.known.observation,
                    host: observed,
                    issuedAt: recorded.receipt.issuedAt,
                  },
                  recorded: {
                    receipt: recorded.receipt,
                    outcome: recorded.outcome,
                  },
                };
              }
              return recorded;
            } catch {
              throw new ModelLiveSequenceAuthorityError();
            }
          },
          prepareSuccessorInput: async () => {
            try {
              const retained = successorInput;
              requireAuthority(retained !== undefined);
              const verifyCurrent = () =>
                this.#transaction(
                  false,
                  async (transaction, bindCurrent) => {
                    bindCurrent(
                      await requireRetainedSuccessor(transaction, retained),
                    );
                  },
                  async (transaction) => {
                    await requireRetainedSuccessor(transaction, retained);
                  },
                );
              await verifyCurrent();
              // Source derivation is bounded RAM work outside every transaction.
              const preparedSuccessor =
                prepareProductionRepairSuccessorInput(retained);
              const finalStage = prepared.selection.stages.find(
                (stage) =>
                  stage.caseId === prepared.stage.caseId &&
                  stage.stageKey === "repair-2",
              );
              const ceiling = execution.commercialRequest.plannedCalls[1];
              requireAuthority(
                finalStage !== undefined && ceiling?.kind === "repair",
              );
              const inputDigest = digestCanonicalValue({
                request: preparedSuccessor.request,
                scope: prepared.scope,
              });
              const invocation: ModelProviderHostRepairSuccessorInvocationV4 = {
                ...structuredClone(prepared.invocation),
                request: preparedSuccessor.request,
                maximumOutputTokens: Math.min(
                  prepared.invocation.maximumOutputTokens,
                  ceiling.maximumUsage.outputUnits,
                ),
                descriptor:
                  modelLiveRepairSuccessorInvocationDescriptorV4Schema.parse({
                    ...prepared.invocation.descriptor,
                    contractVersion: 4,
                    recordKind:
                      "model-live-repair-successor-invocation-descriptor",
                    invocationId: finalStage.invocationId,
                    inputDigest,
                    idempotencyKeyDigest: digestCanonicalValue({
                      kind: "cloudmarkup.final-repair-idempotency",
                      contractVersion: 4,
                      selectionDigest: prepared.selection.selectionDigest,
                      stageId: finalStage.stageId,
                      predecessorOutcomeDigest:
                        preparedSuccessor.predecessorOutcomeDigest,
                      inputDigest,
                    }),
                  }),
              };
              await verifyCurrent();
              return { ...preparedSuccessor, invocation };
            } catch {
              throw new ModelLiveSequenceAuthorityError();
            }
          },
          issueSuccessorInput: async (
            supplied: ModelProviderHostRepairSuccessorInvocationV4,
          ) => {
            try {
              const retained = successorInput;
              requireAuthority(retained !== undefined);
              const invocation = structuredClone(supplied);
              return await this.#withSeedRepairSource(
                {
                  reference,
                  caseId: prepared.stage.caseId,
                  requestedMode: prepared.invocation.request.requestedMode,
                  invocationId: prepared.stage.invocationId,
                },
                signal,
                async ({ tx: transaction, source }) => {
                  await requireRetainedSuccessor(transaction, retained);
                  const successor = prepareModelLiveRepairSuccessorStageInputV4(
                    {
                      first: {
                        ...source,
                        invocation: prepared.invocation,
                        scope: prepared.scope,
                      },
                      predecessor: retained,
                      invocation,
                    },
                  );
                  return issueModelLiveRepairSuccessorInputV4({
                    tx: transaction,
                    prepared: successor,
                    now: source.observedAt,
                  });
                },
                async (transaction) => {
                  await requireRetainedSuccessor(transaction, retained);
                },
              );
            } catch {
              throw new ModelLiveSequenceAuthorityError();
            }
          },
          createSuccessorDispatchJournal: async (
            supplied: ModelProviderHostRepairSuccessorInvocationV4,
          ) => {
            const retained = successorInput;
            requireAuthority(retained !== undefined);
            const invocation = structuredClone(supplied);
            // Restore and bind RAM/configuration before the short platform reservation window.
            const final = await this.#withSeedRepairSource(
              {
                reference,
                caseId: prepared.stage.caseId,
                requestedMode: prepared.invocation.request.requestedMode,
                invocationId: prepared.stage.invocationId,
              },
              signal,
              async ({ tx: transaction, source }) => {
                await requireRetainedSuccessor(transaction, retained);
                const successor = prepareModelLiveRepairSuccessorStageInputV4({
                  first: {
                    ...source,
                    invocation: prepared.invocation,
                    scope: prepared.scope,
                  },
                  predecessor: retained,
                  invocation,
                });
                const row = (
                  await transaction.query(
                    sql(
                      "SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS issued_at_text FROM model_live_repair_successor_inputs_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
                      [
                        scope.organizationId,
                        scope.projectId,
                        scope.userId,
                        successor.stage.stageId,
                      ],
                    ),
                  )
                ).rows[0];
                requireAuthority(row !== undefined);
                parseModelLiveRepairSuccessorInputRowV4(
                  row,
                  successor,
                  source.observedAt,
                );
                return successor;
              },
              async (transaction) => {
                await requireRetainedSuccessor(transaction, retained);
              },
            );
            let ownedFinalDispatchDigest: string | undefined;
            let executionClaimed = false;
            const current = (transaction: SqlExecutor) =>
              requireRetainedSuccessor(transaction, retained);
            const planned = execution.commercialRequest.plannedCalls[1];
            requireAuthority(planned?.kind === "repair");
            const reservedTokenCeiling = Object.freeze({
              input: planned.maximumUsage.inputUnits,
              output: planned.maximumUsage.outputUnits,
            });
            requireAuthority(
              Number.isSafeInteger(reservedTokenCeiling.input) &&
                reservedTokenCeiling.input > 0 &&
                Number.isSafeInteger(reservedTokenCeiling.output) &&
                reservedTokenCeiling.output > 0,
            );
            return {
              validateKnownResponse: async (
                rawResult: ModelProviderResultV1,
              ) => {
                try {
                  const providerResult = structuredClone(rawResult);
                  const initial = await this.#transaction(
                    false,
                    async (transaction, bindCurrent) => {
                      bindCurrent(await current(transaction));
                      const known = await finalRepairUsageObservationV4({
                        tx: transaction,
                        scope,
                        execution,
                        accounting,
                        now: await this.#now(transaction),
                        operation: { kind: "recover" },
                      });
                      requireAuthority(
                        known.kind !== "missing" &&
                          known.usage.result === "succeeded",
                      );
                      const stage = await readIssuedFinalRepairInputV4({
                        tx: transaction,
                        scope,
                        execution,
                      });
                      requireAuthority(stage !== null);
                      const host = await this.#repairSuccessorHost();
                      const seedReceipt = await this.#loadSeed(
                        transaction,
                        prepared.stage.caseId,
                        prepared.seedConfigurationDigest,
                      );
                      requireAuthority(seedReceipt !== null);
                      await this.#seedAuthority(transaction, seedReceipt);
                      const existing = await finalRepairCandidateValidationV4({
                        tx: transaction,
                        scope,
                        execution,
                        accounting,
                        now: await this.#now(transaction),
                        operation: { kind: "recover" },
                      });
                      if (existing.kind !== "missing")
                        requireAuthority(
                          existing.receipt.providerResultDigest ===
                            digestCanonicalValue(providerResult) &&
                            existing.receipt.configurationDigest ===
                              host.configurationDigest,
                        );
                      return { known, stage, host, seedReceipt, existing };
                    },
                    async (transaction) => {
                      await current(transaction);
                    },
                  );
                  if (initial.existing.kind !== "missing")
                    return initial.existing;
                  // Native execution owns bounded RAM and occurs outside SQL transactions.
                  const observed = await initial.host.run(
                    {
                      seedReceipt: initial.seedReceipt,
                      predecessor: retained,
                      invocation: final.invocation,
                      providerResult,
                      usage: initial.known.usage,
                    },
                    signal,
                  );
                  return await this.#transaction(
                    false,
                    async (transaction, bindCurrent) => {
                      bindCurrent(await current(transaction));
                      requireAuthority(
                        (await this.#repairSuccessorHost())
                          .configurationDigest ===
                          initial.host.configurationDigest,
                      );
                      const known = await finalRepairUsageObservationV4({
                        tx: transaction,
                        scope,
                        execution,
                        accounting,
                        now: await this.#now(transaction),
                        operation: { kind: "recover" },
                      });
                      requireAuthority(
                        known.kind !== "missing" &&
                          same(known.observation, initial.known.observation),
                      );
                      const now = await this.#now(transaction);
                      const data = prepareFinalRepairCandidateOutcomeV4({
                        scope: this.#scope,
                        stage: initial.stage,
                        usage: known.usage,
                        attemptObservation: known.observation,
                        predecessor: {
                          stage: retained.first.stage,
                          attemptObservation: retained.first.attemptObservation,
                          receipt: retained.recorded.receipt,
                        },
                        host: observed,
                        issuedAt: now,
                      });
                      return finalRepairCandidateValidationV4({
                        tx: transaction,
                        scope,
                        execution,
                        accounting,
                        now,
                        operation: { kind: "record", receipt: data.receipt },
                      });
                    },
                    async (transaction) => {
                      await current(transaction);
                      requireAuthority(
                        (await this.#repairSuccessorHost())
                          .configurationDigest ===
                          initial.host.configurationDigest,
                      );
                    },
                  );
                } catch {
                  throw new ModelLiveSequenceAuthorityError();
                }
              },
              claimExecution: () => {
                requireAuthority(
                  !executionClaimed && ownedFinalDispatchDigest === undefined,
                );
                executionClaimed = true;
              },
              invocation: final.invocation,
              reservedTokenCeiling,
              recordKnownUsage: (usage: NormalizedModelUsageV1) =>
                observeFinalUsage({
                  kind: "record",
                  usage: normalizedModelUsageV1Schema.parse(usage),
                }),
              recoverKnownUsage: () => observeFinalUsage({ kind: "recover" }),
              assertCurrentDispatch: () =>
                this.#transaction(
                  false,
                  async (transaction, bindCurrent) => {
                    bindCurrent(await current(transaction));
                    const rows = await transaction.query(
                      sql(
                        "SELECT dispatch_sha256 FROM model_live_repair_successor_dispatches_v4 WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND stage_id=$4",
                        [
                          scope.organizationId,
                          scope.projectId,
                          scope.userId,
                          final.stage.stageId,
                        ],
                      ),
                    );
                    requireAuthority(
                      ownedFinalDispatchDigest === undefined
                        ? rows.rowCount === 0
                        : rows.rowCount === 1 &&
                            rows.rows[0]?.["dispatch_sha256"] ===
                              ownedFinalDispatchDigest.slice(7),
                    );
                    requireAuthority(!signal?.aborted);
                    return readRepairDispatchExpiryV4({
                      tx: transaction,
                      scope,
                      execution,
                      accounting,
                      principalExpiresAt: this.#principal.expiresAt,
                      now: await this.#now(transaction),
                    });
                  },
                  async (transaction) => {
                    await current(transaction);
                  },
                ),
              recordFinalDispatch: async (
                claim: ModelPlatformReservationInput,
                receipt: ModelPlatformReservationReceipt,
              ) => {
                const platformClaim =
                  modelPlatformReservationInputSchema.parse(claim);
                const platformReceipt =
                  modelPlatformReservationReceiptSchema.parse(receipt);
                const result = await this.#transaction(
                  false,
                  async (transaction, bindCurrent) => {
                    bindCurrent(await current(transaction));
                    return recordFinalRepairDispatchV4({
                      tx: transaction,
                      scope,
                      execution,
                      accounting,
                      prepared: final,
                      platformClaim,
                      platformReceipt,
                      now: await this.#now(transaction),
                    });
                  },
                  async (transaction) => {
                    await current(transaction);
                  },
                );
                if (result.kind === "recorded")
                  ownedFinalDispatchDigest = result.record.dispatchDigest;
                return result;
              },
            };
          },
          recordKnownUsage: async (usage: NormalizedModelUsageV1) => {
            const parsed = normalizedModelUsageV1Schema.parse(usage);
            return this.#transaction(false, async (transaction) => {
              await this.#seedRuntimeIssued(transaction, reference, binding);
              return firstSeedUsageObservationV4({
                tx: transaction,
                scope,
                execution,
                accounting,
                now: await this.#now(transaction),
                operation: { kind: "record", usage: parsed },
              });
            });
          },
          recoverKnownUsage: () =>
            this.#transaction(false, async (transaction) => {
              await this.#seedRuntimeIssued(transaction, reference, binding);
              return firstSeedUsageObservationV4({
                tx: transaction,
                scope,
                execution,
                accounting,
                now: await this.#now(transaction),
                operation: { kind: "recover" },
              });
            }),
          recordFirstDispatch: async (
            claim: ModelPlatformReservationInput,
            receipt: ModelPlatformReservationReceipt,
          ) => {
            const platformClaim =
              modelPlatformReservationInputSchema.parse(claim);
            const platformReceipt =
              modelPlatformReservationReceiptSchema.parse(receipt);
            const current = async (transaction: SqlExecutor) =>
              this.#requireSeedRuntimeCurrent(
                transaction,
                reference,
                binding,
                prepared,
                signal,
              );
            const result = await this.#transaction(
              false,
              async (transaction, bindCurrent) => {
                await this.#seedRuntimeIssued(transaction, reference, binding);
                bindCurrent(await current(transaction));
                return recordFirstSeedDispatchV4({
                  tx: transaction,
                  scope,
                  execution,
                  accounting,
                  descriptor: prepared.invocation.descriptor,
                  platformClaim,
                  platformReceipt,
                  now: await this.#now(transaction),
                });
              },
              async (transaction) => {
                await current(transaction);
              },
            );
            if (result.kind === "recorded")
              ownedDispatchDigest = result.record.dispatchDigest;
            return result;
          },
        };
      },
    );
  }

  /** Completes only recorded V4 validation through current host authority.
   * The read-only usage recovery port remains unable to settle or send. */
  async completeRecordedSeedRepairV4(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
    },
    signal?: AbortSignal,
  ) {
    const { reference, binding, accounting } =
      this.#recordedRepairAccountingInput(input);
    const engine = await this.#withSeedRepairStage(
      input,
      signal,
      ({ prepared }) =>
        Promise.resolve(
          this.#seedCommercialStoreV4(
            reference,
            binding,
            accounting,
            prepared,
            signal,
          ),
        ),
    );
    return engine.settleRecordedRepairV4();
  }

  /** Metadata-only financial recovery. This cannot count, reserve or dispatch
   * and does not add a write operation to the read-only recovery port. */
  async recoverRecordedSeedRepairAccountingV4(input: {
    readonly reference: SequenceSelectionReference;
    readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  }) {
    const { reference, binding, accounting } =
      this.#recordedRepairAccountingInput(input);
    return this.#seedCommercialStoreV4(
      reference,
      binding,
      accounting,
    ).recoverRecordedRepairV4();
  }

  /** Complete recorded stage metadata only; no accounting write, new send or quality promotion. */
  async readRecordedSeedRepairCaseV4(input: {
    readonly reference: SequenceSelectionReference;
    readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  }) {
    const { execution, reference, binding, accounting } =
      this.#recordedRepairAccountingInput(input);
    const identities = {
      organizationId: this.#scope.organizationId,
      projectId: this.#scope.projectId,
      userId: this.#scope.userId,
    };
    const scope: ModelCommercialVerifiedScopeV1 = {
      ...identities,
      authority: "verified-principal-scope-v1",
      tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
    };
    return this.#transaction(false, async (tx) => {
      await this.#seedRuntimeIssued(tx, reference, binding);
      return recoverRecordedRepairCaseV4({
        tx,
        scope,
        execution,
        accounting,
        now: await this.#now(tx),
      });
    });
  }

  #recordedRepairAccountingInput(input: {
    readonly reference: SequenceSelectionReference;
    readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  }) {
    const execution = structuredClone(input.execution);
    const parsed = parseModelLiveSeedRuntimeExecutionV4(execution);
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const identity = projectModelLiveSeedRuntimeExecutionIdentityV4(execution);
    const binding = {
      plan: parsed.plan,
      request: parsed.admissionRequest,
      decision: parsed.admissionDecision,
      liveAuthorityReservation: parsed.liveAuthorityReservation,
      ...identity,
    };
    const accounting = modelSeedAccountingBindingSchema.parse({
      workflowId: execution.commercialRequest.multiCallWorkflowId,
      workflowFingerprint: digestCanonicalValue(execution.commercialRequest),
      runtimeScopeDigest: identity.tenantScopeDigest,
      runtimeFingerprint: identity.fingerprint,
      routingDecision: execution.routingDecision,
    });
    return { execution, reference, binding, accounting };
  }

  /** Reopens only persisted usage metadata. This cannot recreate source/output,
   * record an unobserved provider response or grant a new dispatch. */
  async openSeedUsageRecoveryV4(input: {
    readonly reference: SequenceSelectionReference;
    readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
  }) {
    const execution = structuredClone(input.execution);
    const parsed = parseModelLiveSeedRuntimeExecutionV4(execution);
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const identity = projectModelLiveSeedRuntimeExecutionIdentityV4(execution);
    const binding = {
      plan: parsed.plan,
      request: parsed.admissionRequest,
      decision: parsed.admissionDecision,
      liveAuthorityReservation: parsed.liveAuthorityReservation,
      ...identity,
    };
    const accounting = modelSeedAccountingBindingSchema.parse({
      workflowId: execution.commercialRequest.multiCallWorkflowId,
      workflowFingerprint: digestCanonicalValue(execution.commercialRequest),
      runtimeScopeDigest: identity.tenantScopeDigest,
      runtimeFingerprint: identity.fingerprint,
      routingDecision: execution.routingDecision,
    });
    const identities = {
      organizationId: this.#scope.organizationId,
      projectId: this.#scope.projectId,
      userId: this.#scope.userId,
    };
    const scope: ModelCommercialVerifiedScopeV1 = {
      ...identities,
      authority: "verified-principal-scope-v1",
      tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
    };
    await this.#transaction(false, async (tx) => {
      await this.#seedRuntimeIssued(tx, reference, binding);
    });
    return {
      recoverValidatedResult: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return recoverValidatedRepairResultV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
          });
        }),
      recoverFinalInput: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return readIssuedFinalRepairInputV4({ tx, scope, execution });
        }),
      recoverFinalKnownUsage: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return finalRepairUsageObservationV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
            operation: { kind: "recover" },
          });
        }),
      recoverFinalCandidateValidation: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return finalRepairCandidateValidationV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
            operation: { kind: "recover" },
          });
        }),
      recoverUnusedFinalStage: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return unusedFinalRepairStageV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
            operation: { kind: "recover" },
          });
        }),
      recoverCandidateValidation: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return firstSeedCandidateValidationV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
            operation: { kind: "recover" },
          });
        }),
      recoverKnownUsage: () =>
        this.#transaction(false, async (tx) => {
          await this.#seedRuntimeIssued(tx, reference, binding);
          return firstSeedUsageObservationV4({
            tx,
            scope,
            execution,
            accounting,
            now: await this.#now(tx),
            operation: { kind: "recover" },
          });
        }),
    };
  }

  /** Reserves only through the canonical algorithm after exact current RAM,
   * issued-input, runtime and coordinator-estimate bindings. */
  async createSeedCommercialReservationsV4(
    input: SeedRepairStageRequest & {
      readonly execution: ModelLiveSeedRuntimeExecutionInputV4;
      readonly accountingBinding: ModelSeedAccountingBinding;
    },
    signal?: AbortSignal,
  ): Promise<
    Pick<
      ModelCommercialAccountingPort,
      "reserve" | "recoverExistingReservation"
    >
  > {
    const execution = structuredClone(input.execution);
    const accountingBinding = modelSeedAccountingBindingSchema.parse(
      input.accountingBinding,
    );
    parseModelLiveSeedRuntimeExecutionV4(execution);
    return this.#withSeedRepairStage(
      input,
      signal,
      async ({ tx, now, prepared }) => {
        const issued = parseModelLiveSeedStageInputRow(
          await this.#readSeedRuntimeInput(tx, prepared.stage.stageId),
          prepared,
          now,
        );
        const checked = bindPreparedSeedRuntimeV4(execution, prepared, issued);
        requireAuthority(
          same(
            accountingBinding.routingDecision,
            checked.execution.routingDecision,
          ) &&
            accountingBinding.workflowId ===
              checked.execution.commercialRequest.multiCallWorkflowId &&
            accountingBinding.workflowFingerprint ===
              digestCanonicalValue(checked.execution.commercialRequest) &&
            accountingBinding.runtimeFingerprint ===
              checked.identity.fingerprint &&
            accountingBinding.runtimeScopeDigest ===
              checked.identity.tenantScopeDigest,
        );
        const engine = this.#seedCommercialStoreV4(
          input.reference,
          {
            plan: checked.execution.plan,
            request: checked.execution.admissionRequest,
            decision: checked.execution.admissionDecision,
            liveAuthorityReservation:
              checked.execution.liveAuthorityReservation,
            ...checked.identity,
          },
          accountingBinding,
          prepared,
          signal,
        );
        return {
          reserve: (request) => engine.reserve(request),
          recoverExistingReservation: (request) =>
            engine.recoverExistingReservation(request),
        };
      },
    );
  }

  /** Recovery opens persisted metadata only and exposes no new-reservation or
   * model-send method. Lost source is never reconstructed. */
  async openSeedCommercialReservationRecovery(input: {
    readonly reference: SequenceSelectionReference;
    readonly accountingBinding: ModelSeedAccountingBinding;
  }): Promise<
    Pick<ModelCommercialAccountingPort, "recoverExistingReservation">
  > {
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const binding = modelSeedAccountingBindingSchema.parse(
      input.accountingBinding,
    );
    return this.#transaction(false, async (tx) => {
      const runtime = await this.#readSeedRuntimeBinding(
        tx,
        reference,
        binding.runtimeScopeDigest,
        seedRuntimeCodecV3,
      );
      requireAuthority(
        binding.runtimeFingerprint === runtime.fingerprint &&
          digestCanonicalValue(binding.routingDecision) ===
            runtime.request.routingDecisionDigest,
      );
      const engine = this.#seedCommercialStore(reference, runtime, binding);
      return {
        recoverExistingReservation: (request) =>
          engine.recoverExistingReservation(request),
      };
    });
  }

  /** Recovery opens persisted metadata only and exposes no new-reservation or
   * model-send method. Lost source is never reconstructed. */
  async openSeedCommercialReservationRecoveryV4(input: {
    readonly reference: SequenceSelectionReference;
    readonly accountingBinding: ModelSeedAccountingBinding;
  }): Promise<
    Pick<ModelCommercialAccountingPort, "recoverExistingReservation">
  > {
    const reference = sequenceSelectionReferenceSchema.parse(input.reference);
    const binding = modelSeedAccountingBindingSchema.parse(
      input.accountingBinding,
    );
    return this.#transaction(false, async (tx) => {
      const runtime = await this.#readSeedRuntimeBinding(
        tx,
        reference,
        binding.runtimeScopeDigest,
        seedRuntimeCodecV4,
      );
      requireAuthority(
        binding.runtimeFingerprint === runtime.fingerprint &&
          digestCanonicalValue(binding.routingDecision) ===
            runtime.request.routingDecisionDigest,
      );
      const engine = this.#seedCommercialStoreV4(reference, runtime, binding);
      return {
        recoverExistingReservation: (request) =>
          engine.recoverExistingReservation(request),
      };
    });
  }

  #seedCommercialStore(
    reference: SequenceSelectionReference,
    runtime: SeedRuntimeStoreBinding,
    binding: ModelSeedAccountingBinding,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ) {
    return this.#seedCommercialStoreForVersion(
      reference,
      runtime,
      binding,
      {
        mapping: MODEL_SEED_ACCOUNTING_WINDOW_MAPPING,
        parseRuntime: parseSeedRuntimeRecord,
        verifyRuntime: verifyModelSeedAccountingRuntime,
      },
      prepared,
      signal,
    );
  }
  #seedCommercialStoreV4(
    reference: SequenceSelectionReference,
    runtime: SeedRuntimeStoreBindingV4,
    binding: ModelSeedAccountingBinding,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ) {
    return this.#seedCommercialStoreForVersion(
      reference,
      runtime,
      binding,
      {
        mapping: MODEL_SEED_SEQUENCE_ACCOUNTING_WINDOW_MAPPING,
        parseRuntime: parseSeedRuntimeRecordV4,
        verifyRuntime: verifyModelSeedSequenceAccountingRuntimeV4,
      },
      prepared,
      signal,
    );
  }

  #seedCommercialStoreForVersion<R extends SeedAccountingRuntimeRecord>(
    rawReference: SequenceSelectionReference,
    runtimeBinding: SeedRuntimeBinding<R["request"], R["decision"]>,
    rawBinding: ModelSeedAccountingBinding,
    version: SeedAccountingVersion<R>,
    prepared?: ReturnType<typeof prepareModelLiveSeedStageInputV3>,
    signal?: AbortSignal,
  ) {
    const reference = sequenceSelectionReferenceSchema.parse(rawReference);
    const binding = modelSeedAccountingBindingSchema.parse(rawBinding);
    const { routingDecision, ...common } = binding;
    void routingDecision;
    const identities = {
      organizationId: this.#scope.organizationId,
      projectId: this.#scope.projectId,
      userId: this.#scope.userId,
    };
    return new PostgresModelCommercialAccountingEngine({
      database: this.#database,
      scope: {
        ...identities,
        authority: "verified-principal-scope-v1",
        tenantScopeDigest: digestModelCommercialVerifiedScopeV1(identities),
      },
      binding: modelAccountingBindingSchema.parse(common),
      seedBinding: binding,
      mapping: version.mapping,
      parseRuntime: (value, scope) => {
        const record = version.parseRuntime(value, scope);
        requireAuthority(
          same(record.request, runtimeBinding.request) &&
            record.fingerprint === runtimeBinding.fingerprint,
        );
        return record;
      },
      verifyRuntime: verifyModelAccountingCommonBinding,
      authorityTransactions: {
        run: (work) => {
          let finalCurrentCheck: (() => Promise<void>) | undefined;
          return this.#transaction(
            false,
            async (tx, bindCurrent) => {
              const issued = await this.#seedRuntimeIssued(
                tx,
                reference,
                runtimeBinding,
              );
              const requireCurrent = async () => {
                bindCurrent(
                  await this.#requireSeedRuntimeCurrent(
                    tx,
                    reference,
                    runtimeBinding,
                    prepared,
                    signal,
                  ),
                );
                finalCurrentCheck = requireCurrent;
              };
              return work(tx, {
                requireCurrent,
                bind: (workflow, runtime) => {
                  version.verifyRuntime(
                    workflow,
                    runtime,
                    binding,
                    runtimeBinding.plan,
                    issued.selection,
                    issued.restored.record,
                  );
                },
              });
            },
            async () => {
              await finalCurrentCheck?.();
            },
          );
        },
      },
    });
  }

  async #withSeedRepairStage<T>(
    input: SeedRepairStageRequest,
    signal: AbortSignal | undefined,
    work: (input: {
      readonly tx: SqlExecutor;
      readonly now: string;
      readonly prepared: ReturnType<typeof prepareModelLiveSeedStageInputV3>;
    }) => Promise<T>,
  ): Promise<T> {
    try {
      const invocation = structuredClone(input.invocation);
      const request = modelHostSeedRepairRequestV2Schema.parse(
        invocation.request,
      );
      const descriptor = modelLiveSeedInvocationDescriptorV3Schema.parse(
        invocation.descriptor,
      );
      return await this.#withSeedRepairSource(
        {
          reference: input.reference,
          caseId: input.caseId,
          requestedMode: request.requestedMode,
          invocationId: descriptor.invocationId,
        },
        signal,
        async ({ tx, source }) => {
          const prepared = prepareModelLiveSeedStageInputV3({
            ...source,
            invocation,
            scope: descriptor.scope,
          });
          return work({ tx, now: source.observedAt, prepared });
        },
      );
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }

  async #withSeedRepairSource<T>(
    input: {
      readonly reference: SequenceSelectionReference;
      readonly caseId: string;
      readonly requestedMode: "guided" | "professional";
      readonly invocationId?: string;
    },
    signal: AbortSignal | undefined,
    work: (input: {
      readonly tx: SqlExecutor;
      readonly source: Omit<
        Parameters<typeof prepareModelLiveSeedStageInputV3>[0],
        "invocation" | "scope"
      >;
    }) => Promise<T>,
    verifyCurrent?: (tx: SqlExecutor) => Promise<void>,
  ): Promise<T> {
    try {
      const reference = sequenceSelectionReferenceSchema.parse(input.reference);
      const caseId = modelLiveRepairCaseV3Schema.parse(input.caseId);
      const requestedMode =
        modelHostSeedRepairRequestV2Schema.shape.requestedMode.parse(
          input.requestedMode,
        );
      const active = () => {
        requireAuthority(!signal?.aborted);
      };
      active();
      const { snapshot } = await this.#prepareSequenceRequest(
        true,
        () => reference,
      );
      requireAuthority(snapshot !== undefined);
      const initial = await this.#transaction(
        true,
        async (tx, bindCurrent) => {
          active();
          const { plan, selection } = await this.#seedStageSelection(
            tx,
            reference,
          );
          bindCurrent(plan);
          const stage = selection.stages.find(
            (entry) => entry.caseId === caseId && entry.stageKey === "repair-1",
          );
          requireAuthority(
            stage !== undefined &&
              (input.invocationId === undefined ||
                stage.invocationId === input.invocationId),
          );
          const receipt = snapshot.receipts.find(
            (entry) => entry.caseId === caseId,
          );
          requireAuthority(receipt !== undefined);
          await this.#seedAuthority(tx, receipt);
          const host = await this.#seedHost();
          const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
            await this.#configuration.resolveModelHostConfiguration?.(),
          );
          return { receipt, host, configuration };
        },
        async (tx) => {
          await this.#verifyDefinitionSeeds(tx, snapshot);
        },
      );
      // Reconstruct outside SQL. The caller then either builds its invocation or
      // compares supplied bytes through the shared strict preparation codec.
      const preparedSeed = await initial.host.prepareRepairInput(
        initial.receipt,
        requestedMode,
        signal,
      );
      active();
      return await this.#transaction(
        true,
        async (tx, bindCurrent) => {
          active();
          const { plan, selection } = await this.#seedStageSelection(
            tx,
            reference,
          );
          bindCurrent(plan);
          await this.#seedAuthority(tx, initial.receipt);
          const configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
            await this.#configuration.resolveModelHostConfiguration?.(),
          );
          requireAuthority(same(configuration, initial.configuration));
          const now = await this.#now(tx);
          return work({
            tx,
            source: {
              caseId,
              configuration,
              observedAt: now,
              plan,
              selection,
              preparedSeed,
              seedReceipt: initial.receipt,
            },
          });
        },
        async (tx) => {
          active();
          await this.#verifyDefinitionSeeds(tx, snapshot);
          await this.#seedAuthority(tx, initial.receipt);
          requireAuthority(
            same(
              modelLiveBedrockHostConfigurationV2Schema.parse(
                await this.#configuration.resolveModelHostConfiguration?.(),
              ),
              initial.configuration,
            ),
          );
          requireAuthority(
            (await this.#seedHost()).configurationDigest ===
              preparedSeed.configurationDigest,
          );
          await verifyCurrent?.(tx);
          active();
        },
      );
    } catch {
      throw new ModelLiveSequenceAuthorityError();
    }
  }

  async approve(input: {
    readonly definitionId: string;
    readonly expectedDefinitionDigest: string;
  }) {
    const { request, snapshot } = await this.#prepareSequenceRequest(true, () =>
      sequenceApprovalRequestSchema.parse(input),
    );
    return this.#transaction(
      true,
      async (tx, bindCurrent) => {
        const definition = await this.#definition(request.definitionId);
        requireAuthority(
          definition.definitionDigest === request.expectedDefinitionDigest,
        );
        const existing = await this.#loadPlan(tx, request.definitionId);
        if (existing) {
          const current = await this.#current(tx, {
            definitionId: request.definitionId,
            planDigest: existing.planDigest,
          });
          bindCurrent(current);
          return current;
        }
        const now = await this.#now(tx);
        const expiresAt = new Date(
          Math.min(
            Date.parse(definition.expiresAt),
            Date.parse(now) + 24 * 60 * 60 * 1000,
          ),
        ).toISOString();
        requireAuthority(Date.parse(expiresAt) > Date.parse(now));
        const approvalBody = {
          contractVersion: 3 as const,
          recordKind: "model-live-sequence-approval" as const,
          approvalId: hostId("live_approval_"),
          definitionDigest: definition.definitionDigest,
          scope: this.#scope,
          operatorUserId: this.#principal.principalId,
          approvedAt: now,
          expiresAt,
        };
        const approval = modelLiveSequenceApprovalV3Schema.parse({
          ...approvalBody,
          approvalDigest: digestCanonicalValue(approvalBody),
        });
        const body = {
          contractVersion: 3 as const,
          recordKind: "model-live-sequence-plan" as const,
          planId: hostId("live_plan_"),
          definition,
          approval,
          issuedAt: now,
          expiresAt,
        };
        const plan = modelLiveSequencePlanV3Schema.parse({
          ...body,
          planDigest: digestCanonicalValue(body),
        });
        const encoded = JSON.stringify(plan);
        requireAuthority(Buffer.byteLength(encoded, "utf8") <= 48 * 1024);
        await tx.query(
          sql(
            `INSERT INTO model_live_sequence_plans
        (organization_id,project_id,principal_id,operator_principal_id,definition_id,definition_sha256,approval_sha256,plan_sha256,plan_id,plan_record,issued_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::timestamptz,$12::timestamptz)`,
            [
              this.#scope.organizationId,
              this.#scope.projectId,
              this.#scope.userId,
              approval.operatorUserId,
              definition.definitionId,
              definition.definitionDigest.slice(7),
              approval.approvalDigest.slice(7),
              plan.planDigest.slice(7),
              plan.planId,
              encoded,
              now,
              expiresAt,
            ],
          ),
        );
        const issued = await this.#current(tx, {
          definitionId: definition.definitionId,
          planDigest: plan.planDigest,
        });
        requireAuthority(same(issued, plan));
        bindCurrent(issued);
        return issued;
      },
      async (tx) => {
        await this.#verifyDefinitionSeeds(tx, snapshot);
      },
    );
  }
  async #selection(tx: SqlExecutor, plan: ModelLiveSequencePlanV3) {
    const scope = this.#scope;
    const result = await tx.query(
      sql(
        `SELECT *,to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at_text
      FROM model_live_sequence_selections WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND plan_sha256=$4`,
        [
          scope.organizationId,
          scope.projectId,
          scope.userId,
          plan.planDigest.slice(7),
        ],
      ),
    );
    requireAuthority(result.rowCount <= 1);
    const row = result.rows[0];
    if (row === undefined) return null;
    const selection = parseModelLiveSequenceSelectionRow(row, plan);
    requireAuthority(
      Date.parse(selection.issuedAt) <= Date.parse(await this.#now(tx)),
    );
    return selection;
  }
  async issueSelection(input: SequencePlanReference) {
    const { request, snapshot } = await this.#prepareSequenceRequest(
      false,
      () => sequencePlanReferenceSchema.parse(input),
    );
    return this.#transaction(
      false,
      async (tx, bindCurrent) => {
        const plan = await this.#current(tx, request);
        bindCurrent(plan);
        const existing = await this.#selection(tx, plan);
        if (existing) return existing;
        const scope = this.#scope;
        const prior = await tx.query(
          sql(
            "SELECT 1 FROM model_live_invocations WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND binding->>'liveEvaluationPlanDigest'=$4 LIMIT 1",
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              plan.planDigest,
            ],
          ),
        );
        requireAuthority(prior.rowCount === 0);
        const body = {
          contractVersion: 3 as const,
          recordKind: "model-live-sequence-selection" as const,
          issuerId: "cloudmarkup.model-live-sequence-selection" as const,
          issuerVersion: "1.0.0" as const,
          selectionId: hostId("live_sequence_"),
          definitionId: plan.definition.definitionId,
          planDigest: plan.planDigest,
          approvalDigest: plan.approval.approvalDigest,
          scope,
          issuedAt: await this.#now(tx),
          stages: plan.definition.cases.flatMap(({ caseId, caseDigest }) =>
            (["repair-1", "repair-2"] as const).map((stageKey) => ({
              caseId,
              caseDigest,
              stageKey,
              stageId: hostId("live_stage_"),
              invocationId: hostId("invocation_"),
            })),
          ),
        };
        const selection = modelLiveSequenceSelectionV3Schema.parse({
          ...body,
          selectionDigest: digestCanonicalValue(body),
        });
        const encoded = JSON.stringify(selection);
        requireAuthority(Buffer.byteLength(encoded, "utf8") <= 32 * 1024);
        await tx.query(
          sql(
            `INSERT INTO model_live_sequence_selections
        (organization_id,project_id,principal_id,plan_sha256,selection_id,selection_sha256,selection_record,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)`,
            [
              scope.organizationId,
              scope.projectId,
              scope.userId,
              plan.planDigest.slice(7),
              selection.selectionId,
              selection.selectionDigest.slice(7),
              encoded,
              selection.issuedAt,
            ],
          ),
        );
        const issued = await this.#selection(tx, plan);
        requireAuthority(issued !== null && same(issued, selection));
        return issued;
      },
      async (tx) => {
        await this.#verifyDefinitionSeeds(tx, snapshot);
      },
    );
  }
  async requireCurrent(input: SequencePlanReference) {
    const { request, snapshot } = await this.#prepareSequenceRequest(
      false,
      () => sequencePlanReferenceSchema.parse(input),
    );
    return this.#transaction(
      false,
      async (tx, bindCurrent) => {
        const plan = await this.#current(tx, request);
        bindCurrent(plan);
        return plan;
      },
      async (tx) => {
        await this.#verifyDefinitionSeeds(tx, snapshot);
      },
    );
  }
  async requireCurrentSelection(input: SequenceSelectionReference) {
    const { request, snapshot } = await this.#prepareSequenceRequest(
      false,
      () => sequenceSelectionReferenceSchema.parse(input),
    );
    return this.#transaction(
      false,
      async (tx, bindCurrent) => {
        const plan = await this.#current(tx, request);
        bindCurrent(plan);
        const selection = await this.#selection(tx, plan);
        requireAuthority(
          selection !== null &&
            selection.selectionId === request.selectionId &&
            selection.selectionDigest === request.selectionDigest,
        );
        return selection;
      },
      async (tx) => {
        await this.#verifyDefinitionSeeds(tx, snapshot);
      },
    );
  }
  async revoke(input: SequencePlanReference): Promise<void> {
    await this.#transaction(true, async (tx) => {
      const request = sequencePlanReferenceSchema.parse(input),
        scope = this.#scope;
      const row = await tx.query(
        sql(
          "SELECT plan_sha256 FROM model_live_sequence_plans WHERE organization_id=$1 AND project_id=$2 AND principal_id=$3 AND definition_id=$4",
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            request.definitionId,
          ],
        ),
      );
      requireAuthority(
        row.rowCount === 1 &&
          row.rows[0]?.["plan_sha256"] === request.planDigest.slice(7),
      );
      await tx.query(
        sql(
          `INSERT INTO model_live_sequence_revocations
        (organization_id,project_id,principal_id,plan_sha256,operator_principal_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [
            scope.organizationId,
            scope.projectId,
            scope.userId,
            request.planDigest.slice(7),
            this.#principal.principalId,
          ],
        ),
      );
    });
  }
}
