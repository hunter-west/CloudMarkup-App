import type {
  CreditNormalizationPolicyVersionV1,
  ModelProviderPricingVersionV1,
} from "@cloudmarkup/domain";
import {
  projectModelCommercialOperationIdentityV1,
  projectModelRuntimeExecutionIdentityV1,
  type ModelCommercialAuthorizationDecisionV1,
  type ModelCommercialAuthorizationPort,
  type ModelCommercialOperationRequestV1,
  type ModelCommercialPricingPort,
  type ModelRuntimeControlExecutionInputV1,
} from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  type ModelInvocationDescriptorV1,
} from "@cloudmarkup/schemas";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import {
  PreviewRequestAuthority,
  type AiIntentPreviewRequestAuthorityV1,
} from "./ai-intent-preview-request-authority.js";
import { readModelCommercialSnapshotInTransaction } from "./model-commercial-snapshot.js";
import {
  modelReadAssert,
  parseModelCommercialReadSelectors,
  parseModelReadRuntimeRow,
  sameModelReadValue,
  type ModelCommercialReadSelectorsV1,
} from "./model-commercial-read-host-codec.js";
import type { SqlDatabase } from "./sql.js";
import {
  readModelCommercialAdmittedRuntime,
  readModelCommercialAdmittedSnapshot,
  type ModelCommercialReadSnapshot,
} from "./model-commercial-admitted-reader.js";

/** Read-only, directly consumed by the real preview factory. This is current
 * commercial authority, NOT promotion/evaluation/provider authority. Every use
 * rechecks original verified session/tab/baseline, the exact admitted runtime,
 * and canonical account/plan/price state. No seed/reserve/dispatch occurs here. */
export class PostgresModelCommercialReadHost
  implements ModelCommercialAuthorizationPort, ModelCommercialPricingPort
{
  readonly #database: SqlDatabase;
  readonly #authority: PreviewRequestAuthority;
  readonly #runtime: ModelRuntimeControlExecutionInputV1;
  readonly #descriptor: ModelInvocationDescriptorV1;
  readonly #selectors: ModelCommercialReadSelectorsV1;
  readonly #identity: ReturnType<typeof projectModelRuntimeExecutionIdentityV1>;
  readonly #scope: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly userId: string;
  };
  constructor(input: {
    readonly database: SqlDatabase;
    readonly requestAuthority: AiIntentPreviewRequestAuthorityV1;
    readonly runtime: ModelRuntimeControlExecutionInputV1;
    readonly descriptor: ModelInvocationDescriptorV1;
    readonly selectors: ModelCommercialReadSelectorsV1;
  }) {
    this.#database = input.database;
    this.#authority = new PreviewRequestAuthority(input.requestAuthority);
    this.#runtime = structuredClone(input.runtime);
    this.#descriptor = modelInvocationDescriptorV1Schema.parse(
      input.descriptor,
    );
    this.#selectors = parseModelCommercialReadSelectors(input.selectors);
    this.#identity = projectModelRuntimeExecutionIdentityV1(this.#runtime);
    const request = this.#runtime.commercialRequest;
    projectModelCommercialOperationIdentityV1(request);
    this.#scope = {
      organizationId: request.organizationId,
      projectId: request.projectId,
      userId: request.userId,
    };
    const { policy, routingDecision: route, admissionRequest } = this.#runtime;
    const selectors = this.#selectors;
    modelReadAssert(
      request.feature === "intent.extract" &&
        request.requestedRoute === "standard" &&
        request.plannedCalls.length === 1 &&
        request.plannedCalls[0]?.kind === "primary",
    );
    modelReadAssert(
      admissionRequest.executionClass === "normal" &&
        this.#runtime.liveEvaluationAuthority === undefined &&
        request.environment === this.#runtime.routingRequest.environment,
    );
    modelReadAssert(
      this.#authority.value.principal.principalId === request.userId &&
        this.#descriptor.scope.organizationId === request.organizationId &&
        this.#descriptor.scope.projectId === request.projectId &&
        this.#descriptor.scope.userId === request.userId &&
        this.#descriptor.scope.jobId === request.jobId &&
        this.#descriptor.feature === request.feature &&
        this.#descriptor.inputDigest === admissionRequest.inputDigest &&
        this.#descriptor.idempotencyKeyDigest ===
          admissionRequest.idempotencyKeyDigest &&
        this.#descriptor.promptTemplateId === request.promptId &&
        this.#descriptor.promptVersion === request.promptVersion,
    );
    modelReadAssert(
      route.outcome === "selected" &&
        route.routeId === selectors.routeId &&
        route.maximumAttempts === 1 &&
        route.feature === request.feature &&
        route.routeDefinitionDigest === selectors.routeDefinitionDigest &&
        route.modelConfigurationReference ===
          selectors.modelConfigurationReference,
    );
    modelReadAssert(
      policy.policyId === selectors.runtimePolicyId &&
        policy.policyVersion === selectors.runtimePolicyVersion &&
        policy.policyDigest === selectors.runtimePolicyDigest &&
        admissionRequest.runtimePolicyDigest === policy.policyDigest,
    );
    modelReadAssert(
      route.pricingVersionReference === selectors.pricingVersionId &&
        admissionRequest.commercialEstimate.pricingVersionReference ===
          selectors.pricingVersionId,
    );
    modelReadAssert(
      route.providerId === this.#descriptor.providerId &&
        route.modelId === this.#descriptor.modelId &&
        route.modelVersion === this.#descriptor.modelVersion &&
        route.inferenceProfileId === this.#descriptor.inferenceProfileId &&
        request.plannedCalls[0].routeId === route.routeId,
    );
  }
  async resolve(
    candidate: ModelCommercialOperationRequestV1,
  ): Promise<ModelCommercialAuthorizationDecisionV1> {
    projectModelCommercialOperationIdentityV1(candidate);
    modelReadAssert(
      sameModelReadValue(candidate, this.#runtime.commercialRequest),
    );
    return (await this.#read()).authorization;
  }
  async listProviderPricingVersions(): Promise<
    readonly ModelProviderPricingVersionV1[]
  > {
    return [(await this.#read()).price];
  }
  async listCreditNormalizationPolicies(): Promise<
    readonly CreditNormalizationPolicyVersionV1[]
  > {
    return [(await this.#read()).normalization];
  }
  async #read(): Promise<ModelCommercialReadSnapshot> {
    try {
      return await this.#database.transaction((tx) =>
        readModelCommercialAdmittedSnapshot({
          tx,
          scope: this.#scope,
          authority: {
            principal: this.#authority.value.principal,
            assertCurrent: this.#authority.assertCurrent.bind(this.#authority),
          },
          runtime: this.#runtime,
          readRuntime: (transaction) =>
            readModelCommercialAdmittedRuntime({
              tx: transaction,
              scope: this.#scope,
              identity: this.#identity,
              runtime: this.#runtime,
              parseRow: parseModelReadRuntimeRow,
            }),
          readCanonical: (transaction) =>
            readModelCommercialSnapshotInTransaction({
              database: this.#database,
              tx: transaction,
              authority: this.#authority,
              scope: this.#scope,
              descriptor: this.#descriptor,
              selectors: this.#selectors,
            }),
          routeExplanation: "Current canonical Standard Intent route.",
        }),
      );
    } catch {
      throw new CommercialPersistenceError(
        "access-denied",
        "Current model commercial authority is unavailable.",
      );
    }
  }
}
