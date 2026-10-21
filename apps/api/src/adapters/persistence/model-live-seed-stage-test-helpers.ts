import {
  getModelHostSeedPatchResponseToolV2,
  digestStructuredValue as digest,
  sha256Text,
  createBedrockRoutingConfigurationV1,
  prepareBedrockLiveEvaluationConfigurationV2,
  reviewedHostSeedPatchRepairPromptV3,
  type ModelProviderHostSeedInvocationV3,
  type ReviewedPromptTemplateV1,
} from "@cloudmarkup/model-gateway";
import { projectModelLiveRoutingConfiguration } from "./model-live-routing-configuration.js";
import { syntheticSequenceFixtureV3 } from "@cloudmarkup/model-gateway/testing";
import {
  modelLiveSequencePlanV3Schema,
  modelLiveSequenceSelectionV3Schema,
  modelLiveSeedInvocationDescriptorV3Schema,
} from "@cloudmarkup/schemas";
import { seedValidationHostFixture } from "../../production-model-live-seed-validation-test-helpers.js";
import { syntheticSeedValidationBody } from "./model-live-seed-validation-test-helpers.js";
import { identifyModelLiveSeedValidationReceipt } from "./model-live-seed-validation-codec.js";
import { liveHostInputFixture } from "./model-live-runtime-host-evidence-test-helpers.js";
const hash = <T extends object>(value: T, key: string): T => ({
  ...value,
  [key]: digest(
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)),
  ),
});

async function syntheticPreparedSeed() {
  const host = seedValidationHostFixture();
  const body = syntheticSeedValidationBody();
  const observation = await host.host.run(body.caseId, body.startedAt);
  const seedReceipt = identifyModelLiveSeedValidationReceipt({
    ...body,
    configurationDigest: observation.configurationDigest,
    ownershipDigest: observation.ownershipDigest,
    profileDigest: observation.profileDigest,
    toolchainDigest: observation.toolchainDigest,
    builderDigest: observation.builderDigest,
    scannerDigest: observation.scannerDigest,
    bindings: observation.bindings,
    reportDigest: observation.reportDigest,
  });
  const preparedSeed = await host.host.prepareRepairInput(
    seedReceipt,
    "guided",
  );
  return { seedReceipt, preparedSeed };
}

/** Shared synthetic model binding; never issues plans or receipt authority. */
export async function syntheticSeedStageInput(
  input?: Awaited<ReturnType<typeof syntheticPreparedSeed>> & {
    readonly now: string;
  },
  prompt: ReviewedPromptTemplateV1 = reviewedHostSeedPatchRepairPromptV3,
) {
  const { seedReceipt, preparedSeed } =
    input ?? (await syntheticPreparedSeed());
  const body = { scope: seedReceipt.scope, caseId: seedReceipt.caseId };
  const sequence = syntheticSequenceFixtureV3({
    ...body.scope,
    now: input?.now ?? "2026-09-14T12:01:00.000Z",
  });
  const base = liveHostInputFixture(
    "candidate.repair",
    sequence.v2,
    "job_seed_stage_synthetic",
    "candidate",
  );
  const responseTool = getModelHostSeedPatchResponseToolV2();
  const stage = sequence.selection.stages.find(
    (entry) => entry.caseId === body.caseId && entry.stageKey === "repair-1",
  );
  const original = base.plan.definition.cases.find(
    (entry) => entry.caseId === body.caseId,
  );
  if (!stage || !original) throw Error("Missing synthetic stage");
  const tuple = {
    ...original.authorityBinding.authorityTuple,
    responseSchemaDigest: digest(responseTool.inputSchema),
    promptTemplateDigest: prompt.digest,
    promptTemplateId: prompt.templateId,
    promptTemplateVersion: prompt.version,
  };
  const policy = hash(
    {
      ...base.plan.definition.policy,
      evaluationRequirement: {
        ...base.plan.definition.policy.evaluationRequirement,
        datasetCaseDigests: sequence.definition.cases.map(
          (entry) => entry.caseDigest,
        ),
      },
    },
    "policyDigest",
  );
  const definition = hash(
    {
      ...sequence.definition,
      policy,
      cases: sequence.definition.cases.map((entry) =>
        entry.caseId !== body.caseId
          ? entry
          : {
              ...entry,
              routeId: original.routeId,
              authorityBinding: {
                authorityTuple: tuple,
                authorityTupleDigest: digest(tuple),
              },
              seed: {
                sourceDigest: seedReceipt.bindings.baselineSourceDigest,
                revisionDigest: seedReceipt.bindings.solutionRevisionDigest,
                candidateDigest: seedReceipt.bindings.sourceTreeDigest,
                ownershipDigest: seedReceipt.ownershipDigest,
                validationReceiptDigest: seedReceipt.receiptDigest,
                validatorPolicyDigest: seedReceipt.bindings.policyDigest,
              },
            },
      ),
    },
    "definitionDigest",
  );
  const approval = hash(
    {
      ...sequence.plan.approval,
      definitionDigest: definition.definitionDigest,
    },
    "approvalDigest",
  );
  const plan = modelLiveSequencePlanV3Schema.parse(
    hash({ ...sequence.plan, definition, approval }, "planDigest"),
  );
  const selection = modelLiveSequenceSelectionV3Schema.parse(
    hash(
      {
        ...sequence.selection,
        planDigest: plan.planDigest,
        approvalDigest: approval.approvalDigest,
      },
      "selectionDigest",
    ),
  );
  const configured =
    base.configuration.contractVersion === 1
      ? createBedrockRoutingConfigurationV1({
          configuration: base.configuration,
          asOf: base.observedAt,
        })
      : prepareBedrockLiveEvaluationConfigurationV2({
          configuration: base.configuration,
          asOf: base.observedAt,
        });
  const legacyRouting = base.invocation.descriptor.routing;
  if (!legacyRouting) throw Error("Missing synthetic routing");
  const {
    routingDecisionDigest,
    acceptedMaximumCreditUnits,
    evaluationResultDigest,
    evaluationResultVersion,
    ...staticRouting
  } = legacyRouting;
  void routingDecisionDigest;
  void acceptedMaximumCreditUnits;
  void evaluationResultDigest;
  void evaluationResultVersion;
  const { promptCacheKey, ...payload } = base.invocation;
  void promptCacheKey;
  const invocation: ModelProviderHostSeedInvocationV3 = {
    ...payload,
    promptCachePolicy: {
      enabled: false,
      cacheKeyRequired: false,
      maximumCheckpoints: 0,
      minimumCheckpointTokens: 0,
    },
    request: preparedSeed.request,
    prompt,
    responseTool,
    descriptor: modelLiveSeedInvocationDescriptorV3Schema.parse({
      ...base.invocation.descriptor,
      contractVersion: 3,
      recordKind: "model-live-seed-invocation-descriptor",
      routing: {
        ...staticRouting,
        effort: "high",
        routingConfigurationDigest: digest(
          projectModelLiveRoutingConfiguration(configured),
        ),
      },
      invocationId: stage.invocationId,
      idempotencyKeyDigest: sha256Text("synthetic_seed_stage_idempotency"),
      inputDigest: digest({ request: preparedSeed.request, scope: base.scope }),
      promptDigest: prompt.digest,
      promptTemplateId: prompt.templateId,
      promptVersion: prompt.version,
    }),
  };
  return { ...base, plan, selection, invocation, preparedSeed, seedReceipt };
}
