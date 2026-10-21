import {
  digestStructuredValue,
  projectModelCommercialOperationIdentityV1,
  projectModelLiveRuntimeExecutionIdentityV2,
  type ModelCommercialAuthorizationPort,
  type ModelCommercialPricingPort,
  type ModelCommercialOperationRequestV1,
  type ModelLiveRuntimeControlExecutionInputV2,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  type ModelInvocationDescriptorV1,
  type ModelLiveEvaluationPlanV2,
} from "@cloudmarkup/schemas";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import {
  modelReadAssert,
  sameModelReadValue,
  modelReadNumber,
  parseModelLiveCommercialReadSelectors,
  parseModelLiveReadRuntimeRow,
  type ModelLiveCommercialReadSelectorsV2,
} from "./model-commercial-read-host-codec.js";
import {
  readModelCommercialSnapshotData,
  type ModelCommercialSnapshotData,
  type ModelCommercialSnapshotScope,
  type ModelCommercialSnapshotReadAuthority,
} from "./model-commercial-snapshot-reader.js";
import {
  readModelCommercialAdmittedRuntime,
  readModelCommercialAdmittedSnapshot,
} from "./model-commercial-admitted-reader.js";
import type { SqlDatabase, SqlExecutor } from "./sql.js";

export interface ModelLiveCommercialPreflightSnapshotV2 extends ModelCommercialSnapshotData {
  readonly contractVersion: 2;
  readonly executionClass: "live-evaluation";
  readonly planDigest: string;
  readonly caseId: string;
  readonly selectors: ModelLiveCommercialReadSelectorsV2;
}
interface LiveReadInput {
  readonly database: SqlDatabase;
  readonly plans: PostgresModelLiveEvaluationPlans;
  readonly definitionId: string;
  readonly planDigest: string;
  readonly caseId: string;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly selectors: ModelLiveCommercialReadSelectorsV2;
}
/** Private closed host boundary. Every read authenticates the actual issued
 * plan, current operator configuration and execution membership/session within
 * its owned transaction, and repeats current approval before commit. */
class LiveCommercialScopeReader {
  readonly #database: SqlDatabase;
  readonly #plans: PostgresModelLiveEvaluationPlans;
  readonly #reference: {
    readonly definitionId: string;
    readonly planDigest: string;
  };
  readonly caseId: string;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly selectors: ModelLiveCommercialReadSelectorsV2;
  readonly scope: ModelCommercialSnapshotScope;
  constructor(input: LiveReadInput) {
    this.#database = input.database;
    this.#plans = input.plans;
    this.#reference = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    this.caseId = solutionStableIdSchema.parse(input.caseId);
    this.descriptor = modelInvocationDescriptorV1Schema.parse(input.descriptor);
    this.selectors = parseModelLiveCommercialReadSelectors(input.selectors);
    const d = this.descriptor;
    modelReadAssert(
      d.scope.projectId !== undefined &&
        d.scope.jobId !== undefined &&
        d.providerFamily !== "deterministic-fake" &&
        d.routing?.routeId === this.selectors.routeId,
    );
    this.scope = {
      organizationId: d.scope.organizationId,
      projectId: d.scope.projectId,
      userId: d.scope.userId,
    };
  }
  async read<T>(
    work: (context: {
      readonly tx: SqlExecutor;
      readonly plan: ModelLiveEvaluationPlanV2;
      readonly authority: ModelCommercialSnapshotReadAuthority;
      readonly readSnapshot: (
        tx: SqlExecutor,
      ) => Promise<ModelLiveCommercialPreflightSnapshotV2>;
    }) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#plans.withIssuedMetadata(
        this.#reference,
        async ({ plan, principal, transaction, requireCurrentApproval }) => {
          const scope = this.scope,
            d = this.descriptor,
            selectors = this.selectors;
          const binding = plan.definition.cases.find(
            (c) => c.caseId === this.caseId,
          );
          modelReadAssert(
            binding !== undefined &&
              principal.principalId === scope.userId &&
              plan.definition.scope.organizationId === scope.organizationId &&
              plan.definition.scope.projectId === scope.projectId &&
              plan.definition.scope.userId === scope.userId,
          );
          const tuple = binding.authorityBinding.authorityTuple,
            policy = plan.definition.policy;
          modelReadAssert(
            binding.invocationInputDigest === d.inputDigest &&
              binding.routeId === selectors.routeId &&
              tuple.operation === d.feature &&
              tuple.role === d.role &&
              tuple.inferenceProfileId === d.inferenceProfileId &&
              tuple.promptTemplateId === d.promptTemplateId &&
              tuple.promptTemplateVersion === d.promptVersion &&
              tuple.promptTemplateDigest === d.promptDigest &&
              tuple.routeDefinitionDigest === selectors.routeDefinitionDigest &&
              tuple.modelConfigurationReference ===
                selectors.modelConfigurationReference &&
              policy.policyId === selectors.runtimePolicyId &&
              policy.policyVersion === selectors.runtimePolicyVersion &&
              policy.policyDigest === selectors.runtimePolicyDigest &&
              d.routing?.routeDefinitionDigest ===
                selectors.routeDefinitionDigest &&
              d.routing.modelConfigurationReference ===
                selectors.modelConfigurationReference &&
              d.routing.capabilityRegistryDigest ===
                tuple.capabilityRegistryDigest &&
              d.routing.routeRegistryDigest === tuple.routeRegistryDigest &&
              d.routing.pricingVersionReference ===
                selectors.pricingVersionId &&
              d.evaluationPolicyId ===
                policy.evaluationRequirement.evaluationPolicyId &&
              d.evaluationPolicyVersion ===
                policy.evaluationRequirement.evaluationPolicyVersion,
          );
          const authority: ModelCommercialSnapshotReadAuthority = {
            principal: { ...principal, correlationId: plan.planId },
            assertCurrent: async (tx, candidateScope) => {
              modelReadAssert(
                tx === transaction && sameModelReadValue(candidateScope, scope),
              );
              await requireCurrentApproval();
              return {
                expiresAt: new Date(
                  Math.min(
                    Date.parse(plan.expiresAt),
                    Date.parse(principal.expiresAt),
                  ),
                ).toISOString(),
              };
            },
          };
          await authority.assertCurrent(transaction, scope);
          const readSnapshot = async (
            tx: SqlExecutor,
          ): Promise<ModelLiveCommercialPreflightSnapshotV2> => {
            modelReadAssert(tx === transaction);
            const data = await readModelCommercialSnapshotData({
              database: this.#database,
              tx,
              authority,
              scope,
              descriptor: d,
              selectors,
            });
            modelReadAssert(
              data.entitlement.planKey === plan.definition.scope.plan &&
                data.price.environment === plan.definition.scope.environment,
            );
            return {
              ...data,
              contractVersion: 2,
              executionClass: "live-evaluation",
              planDigest: plan.planDigest,
              caseId: this.caseId,
              selectors: structuredClone(selectors),
            };
          };
          return work({ tx: transaction, plan, authority, readSnapshot });
        },
      );
    } catch {
      throw new CommercialPersistenceError(
        "access-denied",
        "Current model commercial authority is unavailable.",
      );
    }
  }
}
/** Real canonical observation before runtime admission. This grants no credits,
 * estimate consent, runtime capacity, provider access or normal promotion. */
export class PostgresModelLiveCommercialPreflight {
  readonly #reader: LiveCommercialScopeReader;
  constructor(input: LiveReadInput) {
    this.#reader = new LiveCommercialScopeReader(input);
  }
  read(): Promise<ModelLiveCommercialPreflightSnapshotV2> {
    return this.#reader.read(({ tx, readSnapshot }) => readSnapshot(tx));
  }
}
/** Actual V2 admitted reader, retaining exact primary Standard/Deep bindings.
 * The shared calculation reads canonical balances/prices/counts, not values
 * asserted by model output, a public request or an evaluation report. */
export class PostgresModelLiveCommercialReadHost
  implements ModelCommercialAuthorizationPort, ModelCommercialPricingPort
{
  readonly #reader: LiveCommercialScopeReader;
  readonly #runtime: ModelLiveRuntimeControlExecutionInputV2;
  readonly #identity: ReturnType<
    typeof projectModelLiveRuntimeExecutionIdentityV2
  >;
  constructor(
    input: LiveReadInput & {
      readonly runtime: ModelLiveRuntimeControlExecutionInputV2;
    },
  ) {
    this.#reader = new LiveCommercialScopeReader(input);
    this.#runtime = structuredClone(input.runtime);
    this.#identity = projectModelLiveRuntimeExecutionIdentityV2(this.#runtime);
    const r = this.#runtime,
      d = this.#reader.descriptor,
      selectors = this.#reader.selectors;
    const request = r.commercialRequest,
      route = r.routingDecision;
    modelReadAssert(
      r.plan.planDigest === input.planDigest &&
        r.plan.definition.definitionId === input.definitionId &&
        r.admissionRequest.evaluationCaseId === this.#reader.caseId &&
        sameModelReadValue(this.#reader.scope, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          userId: request.userId,
        }) &&
        request.jobId === d.scope.jobId &&
        request.feature === d.feature &&
        request.promptId === d.promptTemplateId &&
        request.promptVersion === d.promptVersion &&
        r.admissionRequest.inputDigest === d.inputDigest &&
        r.admissionRequest.idempotencyKeyDigest === d.idempotencyKeyDigest &&
        route.outcome === "selected" &&
        route.maximumAttempts === 1 &&
        route.routeId === selectors.routeId &&
        route.routeDefinitionDigest === selectors.routeDefinitionDigest &&
        route.modelConfigurationReference ===
          selectors.modelConfigurationReference &&
        route.providerId === d.providerId &&
        route.modelId === d.modelId &&
        route.modelVersion === d.modelVersion &&
        route.inferenceProfileId === d.inferenceProfileId &&
        route.pricingVersionReference === selectors.pricingVersionId &&
        d.routing?.routingDecisionDigest === digestStructuredValue(route),
    );
  }
  async resolve(candidate: ModelCommercialOperationRequestV1) {
    projectModelCommercialOperationIdentityV1(candidate);
    modelReadAssert(
      sameModelReadValue(candidate, this.#runtime.commercialRequest),
    );
    return (await this.#read()).authorization;
  }
  async listProviderPricingVersions() {
    return [(await this.#read()).price];
  }
  async listCreditNormalizationPolicies() {
    return [(await this.#read()).normalization];
  }
  #read() {
    return this.#reader.read(({ tx, plan, authority, readSnapshot }) => {
      modelReadAssert(sameModelReadValue(plan, this.#runtime.plan));
      const runtime = { ...this.#runtime, policy: plan.definition.policy };
      return readModelCommercialAdmittedSnapshot({
        tx,
        scope: this.#reader.scope,
        authority,
        runtime,
        readRuntime: (transaction) =>
          readModelCommercialAdmittedRuntime({
            tx: transaction,
            scope: this.#reader.scope,
            identity: this.#identity,
            runtime,
            parseRow: parseModelLiveReadRuntimeRow,
          }),
        readCanonical: readSnapshot,
        routeExplanation:
          "Current canonical route for the approved live evaluation case.",
      });
    });
  }
}
const isLiveSnapshot = (value: {
  readonly contractVersion: unknown;
  readonly executionClass: unknown;
}) => value.contractVersion === 2 && value.executionClass === "live-evaluation";
export function assertModelLiveCommercialPreflightBinding(
  snapshot: ModelLiveCommercialPreflightSnapshotV2,
  runtime: ModelLiveRuntimeControlExecutionInputV2,
): void {
  projectModelLiveRuntimeExecutionIdentityV2(runtime);
  const request = runtime.commercialRequest,
    d = snapshot.descriptor,
    route = runtime.routingDecision,
    selectors = snapshot.selectors;
  modelReadAssert(
    isLiveSnapshot(snapshot) &&
      snapshot.planDigest === runtime.plan.planDigest &&
      snapshot.caseId === runtime.admissionRequest.evaluationCaseId &&
      snapshot.featureEnabled &&
      request.organizationId === d.scope.organizationId &&
      request.projectId === d.scope.projectId &&
      request.userId === d.scope.userId &&
      request.jobId === d.scope.jobId &&
      request.feature === d.feature &&
      runtime.admissionRequest.inputDigest === d.inputDigest &&
      runtime.admissionRequest.idempotencyKeyDigest ===
        d.idempotencyKeyDigest &&
      request.environment === snapshot.price.environment &&
      runtime.admissionRequest.plan === snapshot.entitlement.planKey &&
      runtime.routingRequest.plan.key === snapshot.entitlement.planKey &&
      runtime.routingRequest.plan.versionId ===
        snapshot.entitlement.planVersionId &&
      route.entitlement.planVersionId === snapshot.entitlement.planVersionId &&
      runtime.routingRequest.creditAuthorization.availableCreditUnits ===
        modelReadNumber(snapshot.balance.availableCreditUnits),
  );
  modelReadAssert(
    runtime.plan.definition.policy.policyId === selectors.runtimePolicyId &&
      runtime.plan.definition.policy.policyVersion ===
        selectors.runtimePolicyVersion &&
      runtime.plan.definition.policy.policyDigest ===
        selectors.runtimePolicyDigest &&
      route.routeId === selectors.routeId &&
      route.routeDefinitionDigest === selectors.routeDefinitionDigest &&
      route.modelConfigurationReference ===
        selectors.modelConfigurationReference &&
      route.pricingVersionReference === snapshot.price.pricingVersionId &&
      runtime.admissionRequest.commercialEstimate.pricingVersionReference ===
        snapshot.price.pricingVersionId &&
      route.providerId === snapshot.price.providerKey &&
      route.modelId === snapshot.price.modelId &&
      route.modelVersion === snapshot.price.modelVersion &&
      route.inferenceProfileId === snapshot.price.inferenceProfileId &&
      digestStructuredValue(snapshot.price) ===
        selectors.pricingVersionDigest &&
      digestStructuredValue(snapshot.normalization) ===
        selectors.normalizationPolicyDigest,
  );
}
