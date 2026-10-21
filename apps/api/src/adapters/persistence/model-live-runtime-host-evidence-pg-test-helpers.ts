import { PostgresModelLiveInvocationSets } from "./model-live-invocation-sets.js";
import type { ModelLiveInvocationSetV2 } from "./model-live-invocation-set-codec.js";
import {
  digestStructuredValue,
  sha256Text,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  prepareModelLiveRoutingDecisionV2,
  modelRoutingConfigurationV1Schema,
  projectModelLiveRuntimeExecutionIdentityV2,
  type ModelGatewayInvocationContextV1,
  type ModelRoutingConfigurationV1,
  type ModelGatewayResultV1,
  type ModelLiveRuntimeControlExecutionInputV2,
} from "@cloudmarkup/model-gateway";
import {
  modelLiveEvaluationDefinitionV2Schema,
  modelInvocationDescriptorV1Schema,
  modelRoutingDecisionV1Schema,
  normalizedModelUsageV1Schema,
  modelGatewayResponseV1Schema,
  type ModelGatewayRequestV1,
  type ModelLiveEvaluationPlanV2,
  type ModelLiveRuntimeControlPolicyV2,
} from "@cloudmarkup/schemas";
import {
  modelTestContext,
  deterministicFakeResponseV1,
  modelTestRoutingRequest,
} from "@cloudmarkup/model-gateway/testing";
import { PostgresModelLiveRoutingAuthority } from "./model-live-routing-authority.js";
import { liveHostInputFixture } from "./model-live-runtime-host-evidence-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { createLiveAccountingPgSeed } from "./model-live-commercial-accounting-pg-test-helpers.js";
import type { ModelCommercialVerifiedScopeV1 } from "@cloudmarkup/model-gateway";
import type { PostgresModelLiveEvaluationPlans } from "./model-live-evaluation-plans.js";
import { PostgresModelLiveRuntimeHostEvidence } from "./model-live-runtime-host-evidence.js";
import { sql } from "./sql.js";
/** Synthetic provider data over actual SQL issuance, input evidence, admission,
 * reservation and journal machinery. No model invocation or genuine validation. */
async function createLiveHostEvidencePgBase<
  T extends {
    scope: ModelCommercialVerifiedScopeV1;
    plans: PostgresModelLiveEvaluationPlans;
  },
>(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  activation: "normal" | "candidate",
  exactRouting: boolean,
  fullRuntime: boolean,
  mode: "standard" | "deep",
  initialize: (
    host: NonNullable<Parameters<typeof createLiveJournalPgFixture>[2]>,
  ) => Promise<T>,
  proposalSource?: {
    readonly request: ModelGatewayRequestV1;
    readonly caseId: string;
    readonly evaluationPolicy?: Pick<
      ModelLiveRuntimeControlPolicyV2["evaluationRequirement"],
      | "evaluationPolicyId"
      | "evaluationPolicyVersion"
      | "evaluationPolicyDigest"
    >;
    readonly fullBeta?: boolean;
  },
  selectInvocationSet = false,
) {
  let invocationId = "invocation-1";
  let selectedInvocationSet: ModelLiveInvocationSetV2 | undefined;
  let executionInput: ModelLiveRuntimeControlExecutionInputV2 | undefined;
  let liveRouting:
    | {
        context: ModelGatewayInvocationContextV1;
        routing: ModelRoutingConfigurationV1;
      }
    | undefined;
  let input: ReturnType<typeof liveHostInputFixture> | undefined;
  let plans: PostgresModelLiveEvaluationPlans | undefined;
  let issuer: PostgresModelLiveRuntimeHostEvidence | undefined;
  let inputEvidence:
    | Awaited<ReturnType<PostgresModelLiveRuntimeHostEvidence["issueInput"]>>
    | undefined;
  const f = await initialize({
    ...(selectInvocationSet
      ? {
          async afterPlanIssued(plan: ModelLiveEvaluationPlanV2) {
            if (
              input === undefined ||
              plans === undefined ||
              activation !== "candidate" ||
              !exactRouting ||
              !fullRuntime
            )
              throw Error(
                "Selected synthetic production preparation requires the actual issued candidate plan.",
              );
            selectedInvocationSet = await new PostgresModelLiveInvocationSets(
              plans,
            ).issue({
              definitionId: plan.definition.definitionId,
              planDigest: plan.planDigest,
            });
            const entry = selectedInvocationSet.entries.find(
              (c) => c.caseId === input?.caseId,
            );
            if (entry === undefined)
              throw Error("The issued set lacks the synthetic selected case.");
            invocationId = entry.invocationId;
            input = {
              ...input,
              invocation: {
                ...input.invocation,
                descriptor: modelInvocationDescriptorV1Schema.parse({
                  ...input.invocation.descriptor,
                  invocationId,
                }),
              },
            };
          },
        }
      : {}),
    ...(proposalSource?.fullBeta === true
      ? { fullBetaEvaluationSource: true }
      : {}),
    ...(fullRuntime
      ? {
          bindRuntimeIdentity(
            metadata: Omit<
              ModelLiveRuntimeControlExecutionInputV2,
              "routingRequest" | "promptCacheKey"
            >,
          ) {
            const routingRequest = liveRouting?.context.routingRequest;
            if (routingRequest === undefined)
              throw Error("Missing exact synthetic request.");
            executionInput = { ...metadata, routingRequest };
            return projectModelLiveRuntimeExecutionIdentityV2(executionInput);
          },
        }
      : {}),
    selectPricingVersionId() {
      return mode === "deep"
        ? "pricing.synthetic.preview.deep"
        : "pricing.synthetic.preview";
    },
    selectCaseId() {
      if (input === undefined) throw Error("Missing exact case.");
      return input.caseId;
    },
    prepareDefinition(_definition, source) {
      input = liveHostInputFixture(
        proposalSource?.request.operation ??
          (mode === "deep"
            ? "application-source.generate"
            : "architecture.propose"),
        source,
        "job_workflow",
        activation,
        mode,
        proposalSource,
      );
      const definition = input.plan.definition;
      if (proposalSource !== undefined) {
        // This isolated fixture admits a full installed-catalog prompt. It does
        // not alter any production request policy, commercial limit or credit.
        const { policyDigest, ...body } = definition.policy;
        void policyDigest;
        const policyBody = {
          ...body,
          limits: { ...body.limits, maximumPromptBytes: 1_000_000 },
        };
        const { definitionDigest, ...definitionBody } = definition;
        void definitionDigest;
        const updated = {
          ...definitionBody,
          policy: {
            ...policyBody,
            policyDigest: digestStructuredValue(policyBody),
          },
        };
        return modelLiveEvaluationDefinitionV2Schema.parse({
          ...updated,
          definitionDigest: digestStructuredValue(updated),
        });
      }
      return modelLiveEvaluationDefinitionV2Schema.parse(definition);
    },
    selectRoute() {
      if (input === undefined) throw Error("Missing synthetic host input.");
      const d = input.invocation.descriptor;
      return {
        explanation:
          "Synthetic 4.6 transport metadata; no provider invocation.",
        inferenceProfileId: d.inferenceProfileId ?? null,
        label: mode === "deep" ? "Deep Design" : "Standard Design",
        modelId: d.modelId,
        modelVersion: d.modelVersion,
        providerKey: d.providerId,
        route: mode,
        routeId: mode === "deep" ? "deep-design" : "standard-design",
      };
    },
    setPlans(store) {
      plans = store;
    },
    bindRouting(base, authority) {
      if (exactRouting) {
        if (input === undefined) throw Error("Missing exact synthetic host.");
        const configured =
          input.configuration.contractVersion === 1
            ? createBedrockRoutingConfigurationV1({
                configuration: input.configuration,
                asOf: authority.plan.issuedAt,
              })
            : prepareBedrockLiveEvaluationConfigurationV2({
                configuration: input.configuration,
                asOf: authority.plan.issuedAt,
              });
        const routing = modelRoutingConfigurationV1Schema.parse({
          allowFallback: false,
          configurationId: configured.routeRegistry.routeRegistryId,
          configurationVersion: configured.routeRegistry.routeRegistryVersion,
          routes: configured.capabilityRegistry.capabilities.flatMap((c) =>
            c.roles.map((role) => ({
              role,
              candidates: [
                {
                  providerId: c.providerId,
                  modelId: c.modelId,
                  inferenceProfileId: c.inferenceProfileId,
                  priority: 0,
                },
              ],
            })),
          ),
        });
        const defaults = modelTestContext(invocationId);
        const context: ModelGatewayInvocationContextV1 = {
          ...defaults,
          scope: input.scope,
          requestedMode: input.invocation.request.requestedMode,
          evaluationPolicyId: base.evaluationPolicyId,
          evaluationPolicyVersion: base.evaluationPolicyVersion,
          idempotencyKeyDigest: sha256Text(
            authority.workflow.request.idempotencyKey,
          ),
          entitlement: {
            ...defaults.entitlement,
            decisionId: input.invocation.descriptor.entitlementDecisionId,
            planKey: base.entitlement.planKey,
            planVersionId: base.entitlement.planVersionId,
          },
          budget: {
            ...defaults.budget,
            decisionId: authority.workflow.request.reservationId,
            acceptedEstimateMaximumCreditUnits:
              base.customerCharge.acceptedMaximumCreditUnits,
          },
        };
        const request = modelTestRoutingRequest(
          input.invocation.request,
          context,
          {
            environment: authority.plan.definition.scope.environment,
            ...(mode === "deep" ? { selectedPreference: "deep-design" } : {}),
          },
        );
        const decision = prepareModelLiveRoutingDecisionV2({
          capabilityRegistry: configured.capabilityRegistry,
          routeRegistry: configured.routeRegistry,
          request,
          routingConfigurationDigest: digestStructuredValue(routing),
          plan: authority.plan,
          caseId: input.caseId,
          observedAt: authority.plan.issuedAt,
          maximumOutputTokens:
            authority.workflow.request.requestedMaximumOutputUnits,
          timeoutMilliseconds: input.invocation.timeoutMilliseconds,
        });
        liveRouting = {
          context: {
            ...context,
            routingRequest: request,
            routingDecision: decision,
          },
          routing,
        };
        if (input.invocation.descriptor.routing === undefined)
          throw Error("Missing descriptor.");
        input.invocation.descriptor.routing.routingConfigurationDigest =
          digestStructuredValue(routing);
        return decision;
      }
      if (input?.invocation.descriptor.routing === undefined)
        throw Error("Missing synthetic routing.");
      const d = input.invocation.descriptor,
        r = input.invocation.descriptor.routing;
      return modelRoutingDecisionV1Schema.parse({
        ...base,
        capabilityRegistryId: r.capabilityRegistryId,
        capabilityRegistryVersion: r.capabilityRegistryVersion,
        modelCapabilityDigest: r.modelCapabilityDigest,
        modelCapabilityVersion: r.capabilityVersion,
        modelFamily: r.modelFamily,
        providerFamily: d.providerFamily,
        evaluationResultDigest: r.evaluationResultDigest,
        evaluationResultVersion: r.evaluationResultVersion,
        routeRegistryId: r.routeRegistryId,
        routeRegistryVersion: r.routeRegistryVersion,
        routingConfigurationDigest: r.routingConfigurationDigest,
        effort: r.effort,
        timeoutMilliseconds: input.invocation.timeoutMilliseconds,
      });
    },
    async issueInput({ plan, workflow, routingDecision }) {
      if (input === undefined || plans === undefined)
        throw Error("Missing actual issued plan.");
      const descriptor = modelInvocationDescriptorV1Schema.parse({
        ...input.invocation.descriptor,
        invocationId,
        budgetDecisionId: workflow.request.reservationId,
        idempotencyKeyDigest: sha256Text(workflow.request.idempotencyKey),
        routing: {
          ...input.invocation.descriptor.routing,
          effort: routingDecision.effort,
          acceptedMaximumCreditUnits:
            routingDecision.customerCharge.acceptedMaximumCreditUnits,
          routingDecisionDigest: digestStructuredValue(routingDecision),
        },
      });
      input = {
        ...input,
        plan,
        invocation: {
          ...input.invocation,
          descriptor,
          maximumOutputTokens: workflow.request.requestedMaximumOutputUnits,
        },
      };
      issuer = new PostgresModelLiveRuntimeHostEvidence({
        plans,
        scope: input.scope,
        configuration: input.configuration,
        definitionId: plan.definition.definitionId,
        planDigest: plan.planDigest,
        caseId: input.caseId,
      });
      inputEvidence = await issuer.issueInput(input.invocation);
      return inputEvidence;
    },
    bindScope() {
      if (input === undefined) throw Error("Missing exact synthetic scope.");
      return input.invocation.descriptor.scope;
    },
    bindResult(base): ModelGatewayResultV1 {
      if (input === undefined)
        throw Error("Missing exact synthetic invocation.");
      const descriptor = input.invocation.descriptor;
      const response =
        base.response.operation === descriptor.feature
          ? base.response
          : deterministicFakeResponseV1(input.invocation);
      const fields = {
        feature: descriptor.feature,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        providerId: descriptor.providerId,
        inferenceProfileId: descriptor.inferenceProfileId,
        inputDigest: descriptor.inputDigest,
        idempotencyKeyDigest: descriptor.idempotencyKeyDigest,
        promptTemplateId: descriptor.promptTemplateId,
        promptVersion: descriptor.promptVersion,
        routing: descriptor.routing,
      };
      return {
        ...base,
        descriptor,
        usage: normalizedModelUsageV1Schema.parse({
          ...base.usage,
          ...fields,
        }),
        response: modelGatewayResponseV1Schema.parse({
          ...response,
          provenance: {
            ...response.provenance,
            ...Object.fromEntries(
              Object.entries(fields).filter(
                ([k]) =>
                  !["feature", "idempotencyKeyDigest", "routing"].includes(k),
              ),
            ),
            promptDigest: descriptor.promptDigest,
          },
        }),
      };
    },
  });
  if (
    input === undefined ||
    issuer === undefined ||
    inputEvidence === undefined
  )
    throw Error("Missing issued synthetic evidence.");
  const rows = () =>
    harness.database.query(
      sql(
        "SELECT * FROM model_live_runtime_host_evidence WHERE organization_id=$1 ORDER BY evidence_kind",
        [f.scope.organizationId],
      ),
    );
  let routeConfiguration: typeof input.configuration | null =
    input.configuration;
  const liveAuthority =
    liveRouting === undefined
      ? undefined
      : new PostgresModelLiveRoutingAuthority({
          plans: f.plans,
          evidence: issuer,
          configuration: input.configuration,
          resolveCurrentConfiguration: () =>
            Promise.resolve(routeConfiguration),
          context: liveRouting.context,
          routing: liveRouting.routing,
          invocation: input.invocation,
          inputEvidence,
          caseId: input.caseId,
          definitionId: input.plan.definition.definitionId,
          planDigest: input.plan.planDigest,
        });
  return {
    ...f,
    hostInput: input,
    selectedInvocationSet,
    issuer,
    inputEvidence,
    rows,
    liveAuthority,
    liveRouting,
    executionInput,
    setRouteConfiguration(value: typeof routeConfiguration) {
      routeConfiguration = value;
    },
  };
}

export async function createLiveHostEvidencePgFixture(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  activation: "normal" | "candidate" = "normal",
  exactRouting = false,
  fullRuntime = false,
  mode: "standard" | "deep" = "standard",
  proposalSource?: {
    readonly request: ModelGatewayRequestV1;
    readonly caseId: string;
    readonly evaluationPolicy?: Pick<
      ModelLiveRuntimeControlPolicyV2["evaluationRequirement"],
      | "evaluationPolicyId"
      | "evaluationPolicyVersion"
      | "evaluationPolicyDigest"
    >;
    readonly fullBeta?: boolean;
  },
) {
  const f = await createLiveHostEvidencePgBase(
    harness,
    activation,
    exactRouting,
    fullRuntime,
    mode,
    (host) => createLiveJournalPgFixture(harness, mode, host),
    proposalSource,
  );
  const complete = async () => {
    await f.journal.prepare(f.callback);
    if ((await f.journal.claim(f.claim)).kind !== "claimed")
      throw Error("Synthetic journal claim unavailable.");
    await f.journal.record(f.usage);
    await f.journal.complete(f.claim, f.gatewayResult);
  };

  return { ...f, complete };
}
/** Actual issued plan, input and canonical price setup only. No durable runtime,
 * workflow, credit reservation, dispatch or invocation is seeded. */
export function createLiveHostEvidencePgSeed(
  harness: ReturnType<typeof createModelAccountingPgTestHarness>,
  mode: "standard" | "deep" = "standard",
  proposalSource?: {
    readonly request: ModelGatewayRequestV1;
    readonly caseId: string;
    readonly evaluationPolicy?: Pick<
      ModelLiveRuntimeControlPolicyV2["evaluationRequirement"],
      | "evaluationPolicyId"
      | "evaluationPolicyVersion"
      | "evaluationPolicyDigest"
    >;
    readonly fullBeta?: boolean;
  },
  selectInvocationSet = false,
) {
  return createLiveHostEvidencePgBase(
    harness,
    "candidate",
    true,
    true,
    mode,
    (host) => createLiveAccountingPgSeed(harness, "100", mode, host),
    proposalSource,
    selectInvocationSet,
  );
}
