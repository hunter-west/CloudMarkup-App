import {
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  prepareModelLiveRoutingDecisionV2,
  modelRoutingConfigurationV1Schema,
  digestStructuredValue,
  validateModelLiveEvaluationRequestV2,
  type ModelGatewayInvocationContextV1,
  type ModelLiveGatewayAuthorityV2,
  type ModelLiveRuntimeAuthorityResolverV2,
  type ModelLiveRoutingPreparationInputV2,
  type ModelProviderInvocationV1,
  type ModelRoutingConfigurationV1,
} from "@cloudmarkup/model-gateway";
import {
  modelRuntimeInputEvidenceV1Schema,
  modelRoutingDecisionV1Schema,
  modelRoutingRequestV1Schema,
  sha256DigestSchema,
  solutionStableIdSchema,
  utcTimestampSchema,
  type ModelRuntimeInputEvidenceV1,
} from "@cloudmarkup/schemas";
import { same } from "./model-runtime-invocation-codec.js";
import { sql } from "./sql.js";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import type { PostgresModelLiveRuntimeHostEvidence } from "./model-live-runtime-host-evidence.js";
import {
  modelLiveBedrockHostConfigurationV2Schema,
  prepareModelLiveRuntimeInputV2,
  type ModelLiveBedrockHostConfigurationV2,
} from "./model-live-runtime-host-evidence-codec.js";

export class ModelLiveRoutingAuthorityError extends Error {
  readonly code = "model-runtime.live-routing-authority-unavailable";
  constructor() {
    super("Current exact live evaluation routing authority is unavailable.");
    this.name = "ModelLiveRoutingAuthorityError";
  }
}
function requireAuthority(condition: boolean): asserts condition {
  if (!condition) throw new ModelLiveRoutingAuthorityError();
}

/** Concrete host authority for one prepared frozen case. All constructor data
 * comes from authenticated host composition, never public request metadata.
 * Prompt/request bodies remain in this short-lived instance's RAM only.
 * Historical recovery authenticates actual issuance and grants no new work.
 * This resolver does not reserve capacity/credits, invoke a provider, settle,
 * validate quality, or activate a normal route. Final HTTP dispatch separately
 * requires the live runtime's current lease and canonical commercial guard. */
export class PostgresModelLiveRoutingAuthority
  implements ModelLiveGatewayAuthorityV2, ModelLiveRuntimeAuthorityResolverV2
{
  readonly #plans: PostgresModelLiveEvaluationPlans;
  readonly #evidence: PostgresModelLiveRuntimeHostEvidence;
  readonly #configuration: ModelLiveBedrockHostConfigurationV2;
  readonly #currentConfiguration: () => Promise<ModelLiveBedrockHostConfigurationV2 | null>;
  readonly #context: ModelGatewayInvocationContextV1;
  readonly #invocation: ModelProviderInvocationV1;
  readonly #routing: ModelRoutingConfigurationV1;
  readonly #inputEvidence: ModelRuntimeInputEvidenceV1;
  readonly #caseId: string;
  readonly #reference: {
    readonly definitionId: string;
    readonly planDigest: string;
  };

  constructor(input: {
    readonly plans: PostgresModelLiveEvaluationPlans;
    readonly evidence: PostgresModelLiveRuntimeHostEvidence;
    readonly configuration: ModelLiveBedrockHostConfigurationV2;
    readonly resolveCurrentConfiguration: () => Promise<ModelLiveBedrockHostConfigurationV2 | null>;
    readonly context: ModelGatewayInvocationContextV1;
    readonly invocation: ModelProviderInvocationV1;
    readonly routing: ModelRoutingConfigurationV1;
    readonly inputEvidence: ModelRuntimeInputEvidenceV1;
    readonly caseId: string;
    readonly definitionId: string;
    readonly planDigest: string;
  }) {
    this.#plans = input.plans;
    this.#evidence = input.evidence;
    this.#configuration = modelLiveBedrockHostConfigurationV2Schema.parse(
      input.configuration,
    );
    this.#currentConfiguration = input.resolveCurrentConfiguration.bind(input);
    this.#context = structuredClone(input.context);
    this.#invocation = structuredClone(input.invocation);
    this.#routing = modelRoutingConfigurationV1Schema.parse(input.routing);
    this.#inputEvidence = modelRuntimeInputEvidenceV1Schema.parse(
      input.inputEvidence,
    );
    this.#caseId = solutionStableIdSchema.parse(input.caseId);
    this.#reference = {
      definitionId: solutionStableIdSchema.parse(input.definitionId),
      planDigest: sha256DigestSchema.parse(input.planDigest),
    };
    const d = this.#invocation.descriptor,
      c = this.#context;
    requireAuthority(
      !this.#routing.allowFallback &&
        c.routingRequest !== undefined &&
        c.routingDecision !== undefined &&
        c.scope.jobId !== undefined &&
        c.scope.projectId !== undefined &&
        same(d.scope, c.scope) &&
        d.invocationId === c.invocationId &&
        d.idempotencyKeyDigest === c.idempotencyKeyDigest &&
        d.requestedMode === c.requestedMode &&
        d.complexity === c.complexity &&
        d.budgetDecisionId === c.budget.decisionId &&
        d.entitlementDecisionId === c.entitlement.decisionId &&
        d.evaluationPolicyId === c.evaluationPolicyId &&
        d.evaluationPolicyVersion === c.evaluationPolicyVersion &&
        d.routing?.routingDecisionDigest ===
          digestStructuredValue(c.routingDecision) &&
        d.routing.routingConfigurationDigest ===
          digestStructuredValue(this.#routing) &&
        d.inputDigest === this.#inputEvidence.inputDigest,
    );
  }

  async #authenticate(historical: boolean) {
    requireAuthority(
      await this.#evidence.verifyInputEvidence({
        evidence: structuredClone(this.#inputEvidence),
      }),
    );
    return this.#plans.withIssuedMetadata(
      this.#reference,
      async ({ plan, transaction, requireCurrentApproval }) => {
        if (!historical) {
          await requireCurrentApproval();
          const current = modelLiveBedrockHostConfigurationV2Schema.parse(
            await this.#currentConfiguration(),
          );
          requireAuthority(same(current, this.#configuration));
        }
        const clock = await transaction.query(
          sql(
            "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS now",
          ),
        );
        const observedAt = historical
          ? plan.issuedAt
          : utcTimestampSchema.parse(clock.rows[0]?.["now"]);
        const preparedInput = prepareModelLiveRuntimeInputV2({
          configuration: this.#configuration,
          plan,
          observedAt,
          caseId: this.#caseId,
          scope: this.#context.scope,
          invocation: this.#invocation,
        });
        requireAuthority(
          same(preparedInput.inputEvidence, this.#inputEvidence),
        );
        const configured =
          this.#configuration.contractVersion === 1
            ? createBedrockRoutingConfigurationV1({
                configuration: this.#configuration,
                asOf: observedAt,
              })
            : prepareBedrockLiveEvaluationConfigurationV2({
                configuration: this.#configuration,
                asOf: observedAt,
              });
        const preparation: ModelLiveRoutingPreparationInputV2 = {
          capabilityRegistry: configured.capabilityRegistry,
          routeRegistry: configured.routeRegistry,
          request: modelRoutingRequestV1Schema.parse(
            this.#context.routingRequest,
          ),
          routingConfigurationDigest: digestStructuredValue(this.#routing),
          plan,
          caseId: this.#caseId,
          observedAt,
          maximumOutputTokens: this.#invocation.maximumOutputTokens,
          timeoutMilliseconds: this.#invocation.timeoutMilliseconds,
        };
        const routingDecision = prepareModelLiveRoutingDecisionV2(preparation);
        requireAuthority(
          routingDecision.outcome === "selected" &&
            same(
              routingDecision,
              modelRoutingDecisionV1Schema.parse(this.#context.routingDecision),
            ),
        );
        return {
          preparation,
          bundle: {
            plan,
            routingDecision,
            routingRequest: preparation.request,
          },
        };
      },
    );
  }

  async authorize(
    raw: Parameters<ModelLiveGatewayAuthorityV2["authorize"]>[0],
  ) {
    try {
      const input = structuredClone(raw);
      requireAuthority(
        ["invoke", "dispatch"].includes(input.phase) &&
          same(input.context, this.#context) &&
          same(input.request, this.#invocation.request) &&
          input.routingConfigurationDigest ===
            digestStructuredValue(this.#routing) &&
          (input.phase !== "dispatch" ||
            same(input.invocation, this.#invocation)),
      );
      return (await this.#authenticate(false)).preparation;
    } catch {
      throw new ModelLiveRoutingAuthorityError();
    }
  }

  async resolve(
    raw: Parameters<ModelLiveRuntimeAuthorityResolverV2["resolve"]>[0],
  ) {
    try {
      const input = structuredClone(raw);
      requireAuthority(
        ["execution", "dispatch", "output", "recovery"].includes(
          input.purpose,
        ) &&
          same(input.inputEvidence, this.#inputEvidence) &&
          input.request.evaluationCaseId === this.#caseId,
      );
      const { preparation, bundle } = await this.#authenticate(
        input.purpose === "recovery",
      );
      validateModelLiveEvaluationRequestV2({
        request: input.request,
        plan: bundle.plan,
        inputEvidence: this.#inputEvidence,
        observedAt: preparation.observedAt,
      });
      requireAuthority(
        same(input.candidate, bundle) &&
          input.request.routingDecisionDigest ===
            digestStructuredValue(bundle.routingDecision),
      );
      return bundle;
    } catch {
      throw new ModelLiveRoutingAuthorityError();
    }
  }
}
