import type { ModelRuntimeControlExecutionInputV1 } from "@cloudmarkup/model-gateway";
import {
  modelInvocationDescriptorV1Schema,
  type ModelInvocationDescriptorV1,
} from "@cloudmarkup/schemas";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import {
  PreviewRequestAuthority,
  type AiIntentPreviewRequestAuthorityV1,
} from "./ai-intent-preview-request-authority.js";
import {
  modelReadAssert,
  modelReadNumber,
  parseModelCommercialReadSelectors,
  type ModelCommercialReadSelectorsV1,
} from "./model-commercial-read-host-codec.js";
import {
  readModelCommercialSnapshotData,
  type ModelCommercialSnapshotData,
  type ModelCommercialSnapshotScope,
} from "./model-commercial-snapshot-reader.js";
import type { SqlDatabase, SqlExecutor } from "./sql.js";

/** Normal V1 observation, retaining its original closed preview authority. */
export interface ModelCommercialPreflightSnapshotV1 extends ModelCommercialSnapshotData {
  readonly contractVersion: 1;
  readonly selectors: ModelCommercialReadSelectorsV1;
}

/** Same canonical reader for preflight and the admitted normal preview. */
export async function readModelCommercialSnapshotInTransaction(input: {
  readonly database: SqlDatabase;
  readonly tx: SqlExecutor;
  readonly authority: PreviewRequestAuthority;
  readonly scope: ModelCommercialSnapshotScope;
  readonly descriptor: ModelInvocationDescriptorV1;
  readonly selectors: ModelCommercialReadSelectorsV1;
}): Promise<ModelCommercialPreflightSnapshotV1> {
  const data = await readModelCommercialSnapshotData({
    ...input,
    authority: {
      principal: input.authority.value.principal,
      assertCurrent: input.authority.assertCurrent.bind(input.authority),
    },
  });
  return structuredClone({
    ...data,
    contractVersion: 1,
    selectors: input.selectors,
  });
}
/** Factory-owned real SQL reader. Construction captures exact comparison
 * metadata and original verified credentials; it does not issue new authority. */
export class PostgresModelCommercialPreflight {
  readonly #database: SqlDatabase;
  readonly #authority: PreviewRequestAuthority;
  readonly #descriptor: ModelInvocationDescriptorV1;
  readonly #selectors: ModelCommercialReadSelectorsV1;
  readonly #scope: ModelCommercialSnapshotScope;
  constructor(input: {
    readonly database: SqlDatabase;
    readonly requestAuthority: AiIntentPreviewRequestAuthorityV1;
    readonly descriptor: ModelInvocationDescriptorV1;
    readonly selectors: ModelCommercialReadSelectorsV1;
  }) {
    this.#database = input.database;
    this.#authority = new PreviewRequestAuthority(input.requestAuthority);
    this.#descriptor = modelInvocationDescriptorV1Schema.parse(
      input.descriptor,
    );
    this.#selectors = parseModelCommercialReadSelectors(input.selectors);
    const { scope, feature } = this.#descriptor;
    modelReadAssert(
      feature === "intent.extract" &&
        scope.projectId !== undefined &&
        scope.jobId !== undefined &&
        this.#authority.value.principal.principalId === scope.userId,
    );
    this.#scope = {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
    };
  }
  async read(): Promise<ModelCommercialPreflightSnapshotV1> {
    try {
      return await this.#database.transaction((tx) =>
        readModelCommercialSnapshotInTransaction({
          database: this.#database,
          tx,
          authority: this.#authority,
          scope: this.#scope,
          descriptor: this.#descriptor,
          selectors: this.#selectors,
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

/** Compare the canonical observation to the resolved candidate. This cannot
 * authorize its evaluation/policy, invent usage maxima or accept an estimate.
 * Runtime and post-admission reads independently recheck all current state. */
export function assertModelCommercialPreflightBinding(
  snapshot: ModelCommercialPreflightSnapshotV1,
  runtime: ModelRuntimeControlExecutionInputV1,
): void {
  const request = runtime.commercialRequest;
  const route = runtime.routingDecision;
  const selectors = snapshot.selectors;
  modelReadAssert(
    snapshot.featureEnabled &&
      request.organizationId === snapshot.descriptor.scope.organizationId &&
      request.projectId === snapshot.descriptor.scope.projectId &&
      request.userId === snapshot.descriptor.scope.userId &&
      request.jobId === snapshot.descriptor.scope.jobId &&
      request.feature === "intent.extract" &&
      request.environment === snapshot.price.environment &&
      runtime.admissionRequest.plan === snapshot.entitlement.planKey &&
      runtime.routingRequest.plan.key === snapshot.entitlement.planKey &&
      runtime.routingRequest.plan.versionId ===
        snapshot.entitlement.planVersionId &&
      route.entitlement.planVersionId === snapshot.entitlement.planVersionId &&
      runtime.routingRequest.creditAuthorization.availableCreditUnits ===
        modelReadNumber(snapshot.balance.availableCreditUnits) &&
      runtime.admissionRequest.inputDigest ===
        snapshot.descriptor.inputDigest &&
      runtime.admissionRequest.idempotencyKeyDigest ===
        snapshot.descriptor.idempotencyKeyDigest,
  );
  modelReadAssert(
    runtime.policy.policyId === selectors.runtimePolicyId &&
      runtime.policy.policyVersion === selectors.runtimePolicyVersion &&
      runtime.policy.policyDigest === selectors.runtimePolicyDigest &&
      route.routeId === selectors.routeId &&
      route.routeDefinitionDigest === selectors.routeDefinitionDigest &&
      route.modelConfigurationReference ===
        selectors.modelConfigurationReference &&
      route.pricingVersionReference === snapshot.price.pricingVersionId &&
      runtime.admissionRequest.commercialEstimate.pricingVersionReference ===
        snapshot.price.pricingVersionId,
  );
  modelReadAssert(
    route.providerId === snapshot.price.providerKey &&
      route.modelId === snapshot.price.modelId &&
      route.modelVersion === snapshot.price.modelVersion &&
      route.inferenceProfileId === snapshot.price.inferenceProfileId,
  );
}
