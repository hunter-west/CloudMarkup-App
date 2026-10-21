import { usesBedrockAdaptiveAutoToolChoiceV1 } from "./bedrock-model-registry.js";
import {
  modelCapabilityRecordV1Schema,
  modelCapabilityRegistryV1Schema,
  modelRouteRegistryV1Schema,
  type ModelCapabilityRecordV1,
  type ModelCapabilityRegistryV1,
  type ModelRouteRegistryV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

import type {
  AmazonBedrockCapabilityProfileV1,
  ModelCapabilityV1,
} from "./ports.js";
import type { BedrockRuntimeRouteV1 } from "./bedrock-adapter.js";
import { digestStructuredValue } from "./security.js";

const awsRegionSchema = z
  .string()
  .regex(/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u)
  .max(32);

const reviewedBedrockRouteMetadataSchema = z
  .object({
    approvedModelClass: z.enum(["sonnet", "opus"]),
    capability: modelCapabilityRecordV1Schema,
    effectiveFrom: z.iso.datetime({ offset: true }),
    effectiveUntil: z.iso.datetime({ offset: true }).nullable(),
    retentionPolicy: z.literal("application-content-not-retained"),
    route: z.enum(["standard", "deep"]),
    selectedRegion: awsRegionSchema,
    supportedRegions: z.array(awsRegionSchema).min(1).max(64),
    transport: z.enum(["converse", "converse-stream"]),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedRoles: ModelCapabilityRecordV1["roles"] =
      value.route === "standard"
        ? ["low-cost-extraction-help", "standard-planning-generation"]
        : ["deep-architecture-custom-generation", "repair-escalation"];
    if (
      value.capability.providerFamily !== "amazon-bedrock" ||
      value.capability.providerId !== "cloudmarkup.amazon-bedrock" ||
      value.capability.killSwitch.engaged ||
      value.approvedModelClass !==
        (value.route === "standard" ? "sonnet" : "opus") ||
      expectedRoles.length !== value.capability.roles.length ||
      expectedRoles.some((role) => !value.capability.roles.includes(role))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The reviewed Bedrock route capability is not active or role-correct.",
        path: ["capability"],
      });
    }
    if (!value.supportedRegions.includes(value.selectedRegion)) {
      context.addIssue({
        code: "custom",
        message:
          "The selected Region must be in the reviewed supported Region set.",
        path: ["selectedRegion"],
      });
    }
    if (
      value.effectiveUntil !== null &&
      Date.parse(value.effectiveUntil) <= Date.parse(value.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        message: "The reviewed route effective range must be non-empty.",
        path: ["effectiveUntil"],
      });
    }
    if (
      value.transport === "converse-stream" &&
      !value.capability.streamingSupported
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Streaming transport requires a reviewed streaming capability.",
        path: ["transport"],
      });
    }
  });

const reviewedBedrockRouteV1Schema =
  reviewedBedrockRouteMetadataSchema.superRefine((value, context) => {
    if (
      value.capability.lifecycleState !== "active" ||
      !value.capability.evaluation.passed
    )
      context.addIssue({
        code: "custom",
        message:
          "The reviewed Bedrock route capability is not active or role-correct.",
        path: ["capability"],
      });
  });

const reviewedBedrockLiveEvaluationRouteV2Schema =
  reviewedBedrockRouteMetadataSchema.superRefine((value, context) => {
    if (!["candidate", "active"].includes(value.capability.lifecycleState))
      context.addIssue({
        code: "custom",
        message:
          "Live evaluation requires a reviewed candidate or active capability.",
        path: ["capability"],
      });
  });

export const reviewedBedrockConfigurationV1Schema = z
  .object({
    capabilityRegistryVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    contractVersion: z.literal(1),
    routeRegistryVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    routes: z.array(reviewedBedrockRouteV1Schema).length(2),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = value.routes.map((route) => route.route);
    if (
      new Set(roles).size !== 2 ||
      !roles.includes("standard") ||
      !roles.includes("deep")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Configuration requires exactly one Standard and one Deep route.",
        path: ["routes"],
      });
    }
  });

export type ReviewedBedrockConfigurationV1 = z.output<
  typeof reviewedBedrockConfigurationV1Schema
>;

/** Explicit live-evaluation metadata, never normal activation or operator approval.
 * Evaluation facts remain unchanged, including a failed/not-yet-passed result.
 * The host must authenticate an issued V2 plan before input issuance/dispatch. */
export const reviewedBedrockLiveEvaluationConfigurationV2Schema = z
  .object({
    capabilityRegistryVersion:
      reviewedBedrockConfigurationV1Schema.shape.capabilityRegistryVersion,
    contractVersion: z.literal(2),
    executionClass: z.literal("live-evaluation"),
    recordKind: z.literal("bedrock-live-evaluation-configuration"),
    routeRegistryVersion:
      reviewedBedrockConfigurationV1Schema.shape.routeRegistryVersion,
    routes: z.array(reviewedBedrockLiveEvaluationRouteV2Schema).length(2),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.routes.map((route) => route.route)).size !== 2)
      context.addIssue({
        code: "custom",
        message:
          "Configuration requires exactly one Standard and one Deep route.",
        path: ["routes"],
      });
  });
export type ReviewedBedrockLiveEvaluationConfigurationV2 = z.output<
  typeof reviewedBedrockLiveEvaluationConfigurationV2Schema
>;

export type BedrockProviderModeV1 = "fake" | "bedrock";

export interface BedrockEnvironmentConfigurationV1 {
  readonly mode: BedrockProviderModeV1;
  readonly reviewedConfiguration?: ReviewedBedrockConfigurationV1;
}

export class BedrockEnvironmentConfigurationError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super("The Bedrock environment configuration is unavailable or invalid.");
    this.name = "BedrockEnvironmentConfigurationError";
    this.code = code;
  }
}

export function parseBedrockEnvironmentConfigurationV1(
  environment: Readonly<Record<string, string | undefined>>,
): BedrockEnvironmentConfigurationV1 {
  const mode = environment["CLOUDMARKUP_MODEL_PROVIDER_MODE"] ?? "fake";
  if (mode === "fake") return Object.freeze({ mode });
  if (mode !== "bedrock")
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-mode-invalid",
    );
  const serialized =
    environment["CLOUDMARKUP_BEDROCK_ROUTE_CONFIGURATION_JSON"];
  if (serialized === undefined)
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-missing",
    );
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-json-invalid",
    );
  }
  const parsed = reviewedBedrockConfigurationV1Schema.safeParse(raw);
  if (!parsed.success)
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-invalid",
    );
  return Object.freeze({ mode, reviewedConfiguration: parsed.data });
}

function capabilityV1(
  record: ModelCapabilityRecordV1,
  registry: ModelCapabilityRegistryV1,
): ModelCapabilityV1 {
  return Object.freeze({
    acceptedEffortLevels: record.acceptedEffortLevels,
    capabilityDigest: digestStructuredValue(record),
    capabilityRegistryDigest: digestStructuredValue(registry),
    capabilityRegistryId: registry.registryId,
    capabilityRegistryVersion: registry.registryVersion,
    capabilityVersion: record.capabilityVersion,
    contextLimitTokens: record.contextLimitTokens,
    costTier: record.costTier,
    dataResidencyBoundary: record.residency.geographyPolicy,
    evaluation: {
      evaluationPolicyId: record.evaluation.evaluationPolicyId,
      evaluationPolicyVersion: record.evaluation.evaluationPolicyVersion,
      passed: record.evaluation.passed,
      resultDigest: digestStructuredValue(record.evaluation),
      resultVersion: record.evaluation.resultVersion,
      scoreBasisPoints: record.evaluation.scoreBasisPoints,
    },
    inferenceProfileId: record.inferenceProfileId,
    maximumAttempts: record.maximumAttempts,
    maximumInputBytes: record.maximumInputBytes,
    maximumOutputBytes: record.maximumOutputBytes,
    maximumOutputTokens: record.maximumOutputTokens,
    modelConfigurationReference: record.modelConfigurationReference,
    modelFamily: record.modelFamily,
    modelId: record.modelId,
    modelVersion: record.modelVersion,
    operations: record.enabledFeatureClasses,
    pricingVersionReference: record.pricingVersionReference,
    promptCache: {
      maximumCheckpoints: record.promptCache.maximumCheckpoints,
      minimumCheckpointTokens: record.promptCache.minimumCheckpointTokens,
      supported: record.promptCache.supported,
    },
    roles: record.roles,
    streamingSupported: record.streamingSupported,
    structuredOutput: record.nativeStructuredOutputSupported
      ? "native-json-schema"
      : "tool-schema",
    supportedModes: record.supportedModes,
    timeoutMilliseconds: record.timeoutMilliseconds,
    usageFieldsExpected: record.usageFieldsExpected,
  });
}

export interface CreatedBedrockRoutingConfigurationV1 {
  readonly capabilityRegistry: ModelCapabilityRegistryV1;
  readonly profile: AmazonBedrockCapabilityProfileV1;
  readonly routeRegistry: ModelRouteRegistryV1;
  readonly runtimeRoutes: readonly BedrockRuntimeRouteV1[];
}

export function createBedrockRoutingConfigurationV1(input: {
  readonly asOf: string;
  readonly configuration: ReviewedBedrockConfigurationV1;
}): CreatedBedrockRoutingConfigurationV1 {
  const configuration = reviewedBedrockConfigurationV1Schema.parse(
    input.configuration,
  );
  return buildReviewedBedrockConfiguration(configuration, input.asOf);
}

/** Pure candidate transport/registry preparation only. Ordinary environment
 * parsing and routing still require their existing normal activation checks.
 * No token counter, provider, journal, approval or network port is available. */
export function prepareBedrockLiveEvaluationConfigurationV2(input: {
  readonly asOf: string;
  readonly configuration: ReviewedBedrockLiveEvaluationConfigurationV2;
}): CreatedBedrockRoutingConfigurationV1 & {
  readonly contractVersion: 2;
  readonly executionClass: "live-evaluation";
} {
  const configuration =
    reviewedBedrockLiveEvaluationConfigurationV2Schema.parse(
      input.configuration,
    );
  return Object.freeze({
    ...buildReviewedBedrockConfiguration(configuration, input.asOf),
    contractVersion: 2,
    executionClass: "live-evaluation",
  });
}

function buildReviewedBedrockConfiguration(
  configuration:
    | ReviewedBedrockConfigurationV1
    | ReviewedBedrockLiveEvaluationConfigurationV2,
  observedAt: string,
): CreatedBedrockRoutingConfigurationV1 {
  const asOf = Date.parse(observedAt);
  if (!Number.isFinite(asOf))
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-as-of-invalid",
    );
  for (const route of configuration.routes) {
    if (
      asOf < Date.parse(route.effectiveFrom) ||
      (route.effectiveUntil !== null &&
        asOf >= Date.parse(route.effectiveUntil))
    ) {
      throw new BedrockEnvironmentConfigurationError(
        "model-provider.configuration-not-effective",
      );
    }
  }
  const standard = configuration.routes.find(
    (route) => route.route === "standard",
  );
  const deep = configuration.routes.find((route) => route.route === "deep");
  if (standard === undefined || deep === undefined)
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-invalid",
    );
  if (standard.selectedRegion !== deep.selectedRegion)
    throw new BedrockEnvironmentConfigurationError(
      "model-provider.configuration-region-mismatch",
    );
  const capabilityRegistry = modelCapabilityRegistryV1Schema.parse({
    capabilities: configuration.routes.map((route) => route.capability),
    contractVersion: 1,
    registryId: "cloudmarkup.model-capabilities.amazon-bedrock",
    registryVersion: configuration.capabilityRegistryVersion,
  });
  const routeRegistry = modelRouteRegistryV1Schema.parse({
    capabilityRegistryDigest: digestStructuredValue(capabilityRegistry),
    capabilityRegistryId: capabilityRegistry.registryId,
    capabilityRegistryVersion: capabilityRegistry.registryVersion,
    contractVersion: 1,
    routeRegistryId: "cloudmarkup.model-routes.amazon-bedrock",
    routeRegistryVersion: configuration.routeRegistryVersion,
    routes: [
      {
        allowedEffortLevels: ["medium", "high"],
        allowedRoles: [
          "low-cost-extraction-help",
          "standard-planning-generation",
        ],
        automaticEscalationRouteId: "internal-escalation",
        customerSelectablePlans: ["starter", "pro"],
        customerServiceLevel: "standard-design",
        customerVisible: true,
        defaultEffort: "medium",
        displayName: "Standard Design",
        enabled: true,
        maximumAttempts: 2,
        modelConfigurationReference:
          standard.capability.modelConfigurationReference,
        promptCacheEnabled: standard.capability.promptCache.supported,
        routeId: "standard-design",
      },
      {
        allowedEffortLevels: ["high", "xhigh"],
        allowedRoles: ["deep-architecture-custom-generation"],
        customerSelectablePlans: ["pro"],
        customerServiceLevel: "deep-design",
        customerVisible: true,
        defaultEffort: "high",
        displayName: "Deep Design",
        enabled: true,
        maximumAttempts: 2,
        modelConfigurationReference:
          deep.capability.modelConfigurationReference,
        promptCacheEnabled: deep.capability.promptCache.supported,
        routeId: "deep-design",
      },
      {
        allowedEffortLevels: ["high", "xhigh"],
        allowedRoles: ["repair-escalation"],
        customerSelectablePlans: [],
        customerVisible: false,
        defaultEffort: "high",
        displayName: "Internal escalation",
        enabled: true,
        maximumAttempts: 1,
        modelConfigurationReference:
          deep.capability.modelConfigurationReference,
        promptCacheEnabled: deep.capability.promptCache.supported,
        routeId: "internal-escalation",
      },
    ],
  });
  const runtimeRoutes = configuration.routes.map((route) =>
    Object.freeze({
      ...(route.capability.adaptiveThinking.supported
        ? { thinkingMode: "adaptive" as const }
        : {}),
      ...(route.capability.adaptiveThinking.supported &&
      !route.capability.nativeStructuredOutputSupported &&
      usesBedrockAdaptiveAutoToolChoiceV1(route.capability.modelId)
        ? { toolChoiceMode: "auto" as const }
        : {}),
      enabled: true,
      invocationTarget:
        route.capability.inferenceProfileId || route.capability.modelId,
      modelConfigurationReference: route.capability.modelConfigurationReference,
      nativeStructuredOutputSupported:
        route.capability.nativeStructuredOutputSupported,
      region: route.selectedRegion,
      supportedRegions: route.supportedRegions,
      transport: route.transport,
    }),
  );
  return Object.freeze({
    capabilityRegistry,
    profile: Object.freeze({
      capabilities: capabilityRegistry.capabilities.map((record) =>
        capabilityV1(record, capabilityRegistry),
      ),
      enabled: true,
      profileVersion: capabilityRegistry.registryVersion,
      providerFamily: "amazon-bedrock",
      providerId: "cloudmarkup.amazon-bedrock",
    }),
    routeRegistry,
    runtimeRoutes,
  });
}
