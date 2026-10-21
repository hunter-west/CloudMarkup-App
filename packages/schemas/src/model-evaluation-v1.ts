import { refineModelRuntimeAdmissionDecision } from "./model-runtime-admission-decision-validation.js";
import { z } from "zod";
import { refineModelRuntimeControlCollections } from "./model-runtime-control-collections.js";

import {
  namespacedIdentifierSchema,
  semanticVersionSchema,
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  modelGatewayOperationV1Schema,
  modelGatewayRoleV1Schema,
} from "./model-gateway-v1.js";
import {
  modelCapabilityEnvironmentV1Schema,
  modelPlanKeyV1Schema,
  modelRouteIdV1Schema,
} from "./model-routing-v1.js";
import {
  safeRelativePathSchema,
  solutionStableIdSchema,
} from "./solution-contract-common-v1.js";

const boundedCountSchema = z.number().int().nonnegative().max(1_000_000_000);
const positiveBoundedCountSchema = z
  .number()
  .int()
  .positive()
  .max(1_000_000_000);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const safePackageNameSchema = z
  .string()
  .regex(
    /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u,
  )
  .max(214);
const safeRegistryIdentifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/-]{0,255}$/u)
  .refine(
    (value) => !value.includes("..") && !value.includes("://"),
    "Registry identifiers cannot traverse or contain URLs.",
  );
const safeRequirementTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(32 * 1_024);

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function hasExactSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    duplicateValues(actual).length === 0 &&
    expected.every((value) => actual.includes(value))
  );
}

function digestRecordWithout(
  value: Readonly<Record<string, unknown>>,
  digestKey: string,
) {
  return digestCanonicalValue(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== digestKey),
    ),
  );
}

export const modelEvaluationCaseKindV1Values = [
  "simple-serverless-api",
  "authenticated-notes-application",
  "event-driven-image-processing",
  "private-vpc-application",
  "external-existing-resource",
  "vague-conflicting-requirements",
  "nonexistent-unsupported-services",
  "prompt-injection-and-secrets",
  "excessive-resource-request",
  "direct-deployment-credential-request",
  "novice-language-professional-constraints",
  "deterministic-repository-import",
  "ambiguous-source-code-inference",
  "designed-observed-mismatch",
  "supported-application-generation",
  "ai-assisted-custom-source",
  "terraform-extension",
  "cloudformation-extension",
  "forbidden-dependency-module-provider-provisioner",
  "repair-success",
  "repair-exhaustion",
] as const;

export const modelEvaluationCaseKindV1Schema = z.enum(
  modelEvaluationCaseKindV1Values,
);

export const modelDeterministicScoreDimensionV1Values = [
  "structured-schema-validity",
  "capability-requirement-coverage",
  "unsupported-service-field-rate",
  "graph-workload-external-rule-violations",
  "grounded-repository-evidence-rate",
  "stable-id-user-owned-file-preservation",
  "security-policy-violations",
  "deterministic-compiler-preference",
  "application-generation-build-test-success",
  "terraform-cloudformation-validation-security-success",
  "issue-clarity-correct-severity",
  "unresolved-behavior-honesty",
  "repair-effectiveness-without-rule-weakening",
  "ci-workflow-validity",
  "latency",
  "tokens",
  "credits",
  "estimated-cost",
  "same-ui-semantics-across-assistance-preferences",
] as const;

export const modelDeterministicScoreDimensionV1Schema = z.enum(
  modelDeterministicScoreDimensionV1Values,
);

export const modelEvaluationMandatoryCaseDimensionV1Values = [
  "structured-schema-validity",
  "security-policy-violations",
  "latency",
  "tokens",
  "credits",
  "estimated-cost",
  "same-ui-semantics-across-assistance-preferences",
] as const satisfies readonly (typeof modelDeterministicScoreDimensionV1Values)[number][];

export const modelEvaluationDispositionV1Schema = z.enum([
  "accept-proposal",
  "request-clarification",
  "reject-safely",
  "retain-unresolved",
  "repair-and-revalidate",
  "exhaust-repair-and-stop",
]);

export const modelEvaluationAuthorityRequirementV1Schema = z
  .object({
    operation: modelGatewayOperationV1Schema,
    role: modelGatewayRoleV1Schema,
  })
  .strict();

export type ModelEvaluationAuthorityRequirementV1 = z.output<
  typeof modelEvaluationAuthorityRequirementV1Schema
>;

export function digestModelEvaluationAuthorityRequirementV1(
  value: ModelEvaluationAuthorityRequirementV1,
) {
  return digestCanonicalValue(value);
}
const modelEvaluationRepositoryFixtureV1Schema = z
  .object({
    contentDigest: sha256DigestSchema,
    evidenceId: solutionStableIdSchema,
    path: safeRelativePathSchema,
    sourceMode: z.enum(["deterministic", "ambiguous-model-inference"]),
  })
  .strict();

const modelEvaluationExpectedV1Schema = z
  .object({
    authorityRequirement: modelEvaluationAuthorityRequirementV1Schema,
    authorityRequirementDigest: sha256DigestSchema,
    deterministicCompilerPreferred: z.boolean(),
    disposition: modelEvaluationDispositionV1Schema,
    expectedIssueSeverity: z.enum(["none", "information", "warning", "error"]),
    generationTarget: z.enum([
      "none",
      "deterministic-application",
      "ai-assisted-custom-source",
      "terraform-extension",
      "cloudformation-extension",
    ]),
    mustPreserveStableIds: z.boolean(),
    mustPreserveUserOwnedFiles: z.boolean(),
    requiredEvidenceIds: z.array(solutionStableIdSchema).max(128),
    requiredSafetyOutcomes: z
      .array(
        z.enum([
          "allow-listed-operations-only",
          "bounded-repair",
          "clarification-required",
          "deterministic-path-first",
          "no-arbitrary-dependency",
          "no-arbitrary-module",
          "no-arbitrary-provider",
          "no-arbitrary-provisioner",
          "no-credential-authority",
          "no-deployment-authority",
          "no-repository-write-authority",
          "reject-prompt-injection",
          "reject-unsupported-service",
          "secret-redaction",
          "source-ownership-preserved",
          "unresolved-honestly",
        ]),
      )
      .max(16),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.authorityRequirementDigest !==
      digestModelEvaluationAuthorityRequirementV1(value.authorityRequirement)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Case expectation must bind its exact required operation and role class.",
        path: ["authorityRequirementDigest"],
      });
    }
    if (duplicateValues(value.requiredEvidenceIds).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Required evidence identities must be unique.",
        path: ["requiredEvidenceIds"],
      });
    }
    if (duplicateValues(value.requiredSafetyOutcomes).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Required safety outcomes must be unique.",
        path: ["requiredSafetyOutcomes"],
      });
    }
  });

export const modelEvaluationCaseV1Schema = z
  .object({
    caseDigest: sha256DigestSchema,
    caseId: solutionStableIdSchema,
    caseKind: modelEvaluationCaseKindV1Schema,
    contractVersion: z.literal(1),
    expected: modelEvaluationExpectedV1Schema,
    input: z
      .object({
        assistancePreferences: z
          .array(z.enum(["guided", "professional"]))
          .length(2),
        repositoryFixtures: z
          .array(modelEvaluationRepositoryFixtureV1Schema)
          .max(128),
        requirements: safeRequirementTextSchema,
        safety: z
          .object({
            containsCustomerData: z.literal(false),
            containsRealCredentials: z.literal(false),
            secretPlaceholdersOnly: z.literal(true),
            synthetic: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    recordKind: z.literal("model-evaluation-case"),
    targetDimensions: z
      .array(modelDeterministicScoreDimensionV1Schema)
      .min(1)
      .max(modelDeterministicScoreDimensionV1Values.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !hasExactSet(value.input.assistancePreferences, [
        "guided",
        "professional",
      ])
    ) {
      context.addIssue({
        code: "custom",
        message: "Every case must exercise both assistance preferences.",
        path: ["input", "assistancePreferences"],
      });
    }
    if (duplicateValues(value.targetDimensions).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Target score dimensions must be unique.",
        path: ["targetDimensions"],
      });
    }
    const missingMandatoryDimensions =
      modelEvaluationMandatoryCaseDimensionV1Values.filter(
        (dimension) => !value.targetDimensions.includes(dimension),
      );
    if (missingMandatoryDimensions.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "Every evaluation case must target all mandatory schema, security, operational, and shared-UI dimensions.",
        path: ["targetDimensions"],
      });
    }
    const fixtureEvidenceIds = value.input.repositoryFixtures.map(
      ({ evidenceId }) => evidenceId,
    );
    if (duplicateValues(fixtureEvidenceIds).length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "Repository fixture evidence identities must be unique per case.",
        path: ["input", "repositoryFixtures"],
      });
    }
    if (
      duplicateValues(value.input.repositoryFixtures.map(({ path }) => path))
        .length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Repository fixture paths must be unique per case.",
        path: ["input", "repositoryFixtures"],
      });
    }
    const fixtureEvidenceIdSet = new Set(fixtureEvidenceIds);
    for (const [
      index,
      evidenceId,
    ] of value.expected.requiredEvidenceIds.entries()) {
      if (!fixtureEvidenceIdSet.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message:
            "Every required repository evidence identity must resolve to a fixture in the same evaluation case.",
          path: ["expected", "requiredEvidenceIds", index],
        });
      }
    }
    if (value.caseDigest !== digestRecordWithout(value, "caseDigest")) {
      context.addIssue({
        code: "custom",
        message: "Case digest must bind the complete frozen case.",
        path: ["caseDigest"],
      });
    }
  });

export type ModelEvaluationCaseV1 = z.output<
  typeof modelEvaluationCaseV1Schema
>;

export function digestModelEvaluationCaseV1(
  value: Omit<ModelEvaluationCaseV1, "caseDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelEvaluationDatasetV1Schema = z
  .object({
    cases: z
      .array(modelEvaluationCaseV1Schema)
      .length(modelEvaluationCaseKindV1Values.length),
    contractVersion: z.literal(1),
    datasetDigest: sha256DigestSchema,
    datasetId: namespacedIdentifierSchema,
    datasetVersion: semanticVersionSchema,
    frozen: z.literal(true),
    recordKind: z.literal("model-evaluation-dataset"),
    requiredDeterministicDimensions: z
      .array(modelDeterministicScoreDimensionV1Schema)
      .length(modelDeterministicScoreDimensionV1Values.length),
    syntheticOnly: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !hasExactSet(
        value.cases.map((evaluationCase) => evaluationCase.caseKind),
        modelEvaluationCaseKindV1Values,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A frozen dataset must contain every required case kind exactly once.",
        path: ["cases"],
      });
    }
    if (
      duplicateValues(
        value.cases.map((evaluationCase) => evaluationCase.caseId),
      ).length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Evaluation case identities must be unique.",
        path: ["cases"],
      });
    }
    if (
      !hasExactSet(
        value.requiredDeterministicDimensions,
        modelDeterministicScoreDimensionV1Values,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A frozen dataset must require every deterministic score dimension exactly once.",
        path: ["requiredDeterministicDimensions"],
      });
    }
    const targetedDimensions = new Set(
      value.cases.flatMap(({ targetDimensions }) => targetDimensions),
    );
    if (
      value.requiredDeterministicDimensions.some(
        (dimension) => !targetedDimensions.has(dimension),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every required deterministic score dimension must be targeted by at least one frozen case.",
        path: ["cases"],
      });
    }
    if (value.datasetDigest !== digestRecordWithout(value, "datasetDigest")) {
      context.addIssue({
        code: "custom",
        message: "Dataset digest must bind every case and score requirement.",
        path: ["datasetDigest"],
      });
    }
  });

export type ModelEvaluationDatasetV1 = z.output<
  typeof modelEvaluationDatasetV1Schema
>;

export function digestModelEvaluationDatasetV1(
  value: Omit<ModelEvaluationDatasetV1, "datasetDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelDeterministicScoreV1Schema = z
  .object({
    applicable: z.boolean(),
    authority: z.literal("deterministic"),
    basisPoints: basisPointsSchema,
    dimension: modelDeterministicScoreDimensionV1Schema,
    direction: z.enum(["higher-is-better", "lower-is-better"]),
    denominator: boundedCountSchema,
    evidenceDigests: z.array(sha256DigestSchema).max(256),
    numerator: boundedCountSchema,
    passed: z.boolean(),
    thresholdBasisPoints: basisPointsSchema,
    toolId: namespacedIdentifierSchema,
    toolVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (duplicateValues(value.evidenceDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Score evidence digests must be unique.",
        path: ["evidenceDigests"],
      });
    }
    if (!value.applicable) {
      if (
        value.numerator !== 0 ||
        value.denominator !== 0 ||
        value.basisPoints !== 0 ||
        !value.passed ||
        value.evidenceDigests.length !== 0
      ) {
        context.addIssue({
          code: "custom",
          message:
            "A non-applicable deterministic score must be empty and cannot fail the evaluation.",
          path: ["applicable"],
        });
      }
      return;
    }
    if (value.evidenceDigests.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An applicable deterministic score requires exact evidence.",
        path: ["evidenceDigests"],
      });
    }
    if (value.denominator === 0 || value.numerator > value.denominator) {
      context.addIssue({
        code: "custom",
        message:
          "Applicable score counts require 0 <= numerator <= a positive denominator.",
        path: ["denominator"],
      });
      return;
    }
    if (
      value.basisPoints !==
      Math.floor((value.numerator * 10_000) / value.denominator)
    ) {
      context.addIssue({
        code: "custom",
        message: "Score basis points must be derived from its exact counts.",
        path: ["basisPoints"],
      });
    }
    const expectedPassed =
      value.direction === "higher-is-better"
        ? value.basisPoints >= value.thresholdBasisPoints
        : value.basisPoints <= value.thresholdBasisPoints;
    if (value.passed !== expectedPassed) {
      context.addIssue({
        code: "custom",
        message: "Deterministic pass state must match direction and threshold.",
        path: ["passed"],
      });
    }
  });

export const modelJudgeScoreV1Schema = z
  .object({
    authority: z.literal("non-authoritative"),
    basisPoints: basisPointsSchema,
    judgeInvocationDigest: sha256DigestSchema,
    judgeModelConfigurationReference: namespacedIdentifierSchema,
    label: z.enum([
      "clarity",
      "helpfulness",
      "professional-quality",
      "requirement-fit",
    ]),
    noRawPromptOrResponse: z.literal(true),
    rationaleDigest: sha256DigestSchema,
  })
  .strict();

export const modelEvaluationCaseResultV1Schema = z
  .object({
    authorityRequirement: modelEvaluationAuthorityRequirementV1Schema,
    authorityRequirementDigest: sha256DigestSchema,
    authorityTupleDigest: sha256DigestSchema,
    caseDigest: sha256DigestSchema,
    caseId: solutionStableIdSchema,
    contractVersion: z.literal(1),
    deterministicPassed: z.boolean(),
    evidenceDigests: z.array(sha256DigestSchema).max(512),
    judgeScores: z.array(modelJudgeScoreV1Schema).max(16),
    outputDigest: sha256DigestSchema,
    recordKind: z.literal("model-evaluation-case-result"),
    resultDigest: sha256DigestSchema,
    safeErrorCodes: z.array(namespacedIdentifierSchema).max(64),
    scores: z
      .array(modelDeterministicScoreV1Schema)
      .length(modelDeterministicScoreDimensionV1Values.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.authorityRequirementDigest !==
      digestModelEvaluationAuthorityRequirementV1(value.authorityRequirement)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Case result must bind its exact required operation and role class.",
        path: ["authorityRequirementDigest"],
      });
    }
    if (
      !hasExactSet(
        value.scores.map((score) => score.dimension),
        modelDeterministicScoreDimensionV1Values,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Every case result must score every deterministic dimension exactly once.",
        path: ["scores"],
      });
    }
    if (
      value.deterministicPassed !== value.scores.every((score) => score.passed)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Case pass state is derived only from deterministic scores; judge scores cannot change it.",
        path: ["deterministicPassed"],
      });
    }
    const scoreEvidenceDigests = [
      ...new Set(
        value.scores
          .filter((score) => score.applicable)
          .flatMap((score) => score.evidenceDigests),
      ),
    ];
    if (!hasExactSet(value.evidenceDigests, scoreEvidenceDigests)) {
      context.addIssue({
        code: "custom",
        message:
          "Case-result evidence must equal the unique union of its applicable deterministic-score evidence.",
        path: ["evidenceDigests"],
      });
    }
    for (const [path, values] of [
      ["evidenceDigests", value.evidenceDigests],
      ["safeErrorCodes", value.safeErrorCodes],
    ] as const) {
      if (duplicateValues(values).length > 0) {
        context.addIssue({
          code: "custom",
          message: `${path} must not contain duplicates.`,
          path: [path],
        });
      }
    }
    if (value.resultDigest !== digestRecordWithout(value, "resultDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Case-result digest must bind deterministic and optional judge evidence.",
        path: ["resultDigest"],
      });
    }
  });

export type ModelEvaluationCaseResultV1 = z.output<
  typeof modelEvaluationCaseResultV1Schema
>;

export function digestModelEvaluationCaseResultV1(
  value: Omit<ModelEvaluationCaseResultV1, "resultDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelEvaluationAuthorityTupleV1Schema = z
  .object({
    capabilityRegistryDigest: sha256DigestSchema,
    catalogDigest: sha256DigestSchema,
    inferenceProfileId: namespacedIdentifierSchema.optional(),
    modelConfigurationReference: namespacedIdentifierSchema,
    operation: modelGatewayOperationV1Schema,
    promptTemplateDigest: sha256DigestSchema,
    promptTemplateId: namespacedIdentifierSchema,
    promptTemplateVersion: semanticVersionSchema,
    responseSchemaDigest: sha256DigestSchema,
    role: modelGatewayRoleV1Schema,
    routeDefinitionDigest: sha256DigestSchema,
    routeRegistryDigest: sha256DigestSchema,
  })
  .strict();

export type ModelEvaluationAuthorityTupleV1 = z.output<
  typeof modelEvaluationAuthorityTupleV1Schema
>;

export function digestModelEvaluationAuthorityTupleV1(
  value: ModelEvaluationAuthorityTupleV1,
) {
  return digestCanonicalValue(value);
}
export const modelEvaluationAuthorityBindingV1Schema = z
  .object({
    authorityTuple: modelEvaluationAuthorityTupleV1Schema,
    authorityTupleDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.authorityTupleDigest !==
      digestModelEvaluationAuthorityTupleV1(value.authorityTuple)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Evaluation authority binding must digest the exact capability, route, model, prompt, schema, and catalog tuple.",
        path: ["authorityTupleDigest"],
      });
    }
  });

export type ModelEvaluationAuthorityBindingV1 = z.output<
  typeof modelEvaluationAuthorityBindingV1Schema
>;
const modelRuntimeSizeLimitsV1Schema = z
  .object({
    maximumEdges: positiveBoundedCountSchema,
    maximumFiles: positiveBoundedCountSchema,
    maximumNodes: positiveBoundedCountSchema,
    maximumOutputBytes: positiveBoundedCountSchema,
    maximumOutputTokens: positiveBoundedCountSchema,
    maximumPromptBytes: positiveBoundedCountSchema,
    maximumRepairAttempts: z.number().int().min(0).max(2),
    maximumRepositoryBytes: positiveBoundedCountSchema,
    maximumRepositoryFiles: positiveBoundedCountSchema,
  })
  .strict();

const modelRuntimeRequestWindowV1Schema = z
  .object({
    maximumConcurrentJobs: z.number().int().positive().max(10_000),
    maximumRequests: z.number().int().positive().max(1_000_000),
    windowSeconds: z
      .number()
      .int()
      .positive()
      .max(31 * 24 * 60 * 60),
  })
  .strict();

export const modelRuntimeControlPolicyV1Schema = z
  .object({
    administrativeSuspensions: z
      .array(
        z
          .object({
            reasonCode: namespacedIdentifierSchema,
            scope: z.enum(["organization", "user"]),
            scopeId: solutionStableIdSchema,
          })
          .strict(),
      )
      .max(10_000),
    allowlists: z
      .object({
        dependencies: z.array(safePackageNameSchema).max(512),
        modelConfigurationReferences: z
          .array(namespacedIdentifierSchema)
          .min(1)
          .max(256),
        modules: z.array(safeRegistryIdentifierSchema).max(256),
        providers: z.array(safeRegistryIdentifierSchema).max(64),
        roles: z.array(modelGatewayRoleV1Schema).min(1).max(5),
        routes: z.array(modelRouteIdV1Schema).min(1).max(3),
      })
      .strict(),
    cacheKeyAuthority: z
      .object({
        dataResidencyBoundary: namespacedIdentifierSchema,
        organizationSafePolicyScope: namespacedIdentifierSchema,
      })
      .strict(),
    canonicalCommercialAuthority: z.literal("canonical-commercial-v1"),
    contractVersion: z.literal(1),
    evaluationGate: z
      .object({
        authorityTuple: modelEvaluationAuthorityTupleV1Schema,
        authorityTupleDigest: sha256DigestSchema,
        capabilityRegistryDigest: sha256DigestSchema,
        deterministicPassed: z.literal(true),
        deterministicQualityBasisPoints: basisPointsSchema,
        datasetCaseDigests: z
          .array(sha256DigestSchema)
          .length(modelEvaluationCaseKindV1Values.length),
        datasetDigest: sha256DigestSchema,
        evaluationPolicyDigest: sha256DigestSchema,
        evaluationPolicyId: namespacedIdentifierSchema,
        evaluationPolicyVersion: semanticVersionSchema,
        evaluationReportDigest: sha256DigestSchema,
        evaluationReportId: solutionStableIdSchema,
        evaluationResultSetDigest: sha256DigestSchema,
        minimumDeterministicQualityBasisPoints: basisPointsSchema,
        routeRegistryDigest: sha256DigestSchema,
      })
      .strict(),
    featureEntitlements: z
      .array(
        z
          .object({
            features: z.array(modelGatewayOperationV1Schema).min(1).max(64),
            plan: modelPlanKeyV1Schema,
          })
          .strict(),
      )
      .min(1)
      .max(2),
    killSwitches: z
      .object({
        capabilitySwitches: z
          .array(
            z
              .object({
                engaged: z.boolean(),
                operation: modelGatewayOperationV1Schema,
                reasonCode: namespacedIdentifierSchema.optional(),
              })
              .strict(),
          )
          .max(64),
        global: z
          .object({
            engaged: z.boolean(),
            reasonCode: namespacedIdentifierSchema.optional(),
          })
          .strict(),
      })
      .strict(),
    limits: modelRuntimeSizeLimitsV1Schema,
    liveEvaluation: z
      .object({
        enabledByDefault: z.literal(false),
        excludedFromNormalCi: z.literal(true),
        killSwitchEngagedByDefault: z.literal(true),
        permittedEnvironments: z
          .array(z.enum(["development", "staging"]))
          .max(2),
      })
      .strict(),
    policyDigest: sha256DigestSchema,
    policyId: namespacedIdentifierSchema,
    policyVersion: semanticVersionSchema,
    recordKind: z.literal("model-runtime-control-policy"),
    runtimeControlConfigurationDigest: sha256DigestSchema,
    requestWindows: z
      .object({
        organization: modelRuntimeRequestWindowV1Schema,
        user: modelRuntimeRequestWindowV1Schema,
      })
      .strict(),
    safety: z
      .object({
        arbitraryPackageAuthority: z.literal(false),
        arbitraryShellAuthority: z.literal(false),
        arbitraryToolAuthority: z.literal(false),
        arbitraryUrlAuthority: z.literal(false),
        credentialAuthority: z.literal(false),
        deploymentAuthority: z.literal(false),
        rawSensitiveLogsPermitted: z.literal(false),
        repositoryWriteAuthority: z.literal(false),
        resultSanitizationRequired: z.literal(true),
        secretRedactionRequired: z.literal(true),
        structuredOutputsRequired: z.literal(true),
        tenantSafeCacheAndPromptKeysRequired: z.literal(true),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.evaluationGate.authorityTupleDigest !==
        digestModelEvaluationAuthorityTupleV1(
          value.evaluationGate.authorityTuple,
        ) ||
      value.evaluationGate.capabilityRegistryDigest !==
        value.evaluationGate.authorityTuple.capabilityRegistryDigest ||
      value.evaluationGate.routeRegistryDigest !==
        value.evaluationGate.authorityTuple.routeRegistryDigest
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The evaluation gate must bind the exact evaluated capability, route, model, prompt, schema, and catalog tuple.",
        path: ["evaluationGate", "authorityTuple"],
      });
    }
    if (duplicateValues(value.evaluationGate.datasetCaseDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "Evaluation-gate dataset case digests must be unique and retain canonical order.",
        path: ["evaluationGate", "datasetCaseDigests"],
      });
    }
    if (
      value.evaluationGate.deterministicQualityBasisPoints <
      value.evaluationGate.minimumDeterministicQualityBasisPoints
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The evaluated deterministic quality must satisfy the configured minimum.",
        path: ["evaluationGate", "deterministicQualityBasisPoints"],
      });
    }
    refineModelRuntimeControlCollections(value, context);
    if (
      value.runtimeControlConfigurationDigest !==
      digestModelRuntimeControlConfigurationV1(value)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime-control configuration digest must bind every report-independent control and evaluation requirement.",
        path: ["runtimeControlConfigurationDigest"],
      });
    }
    if (value.policyDigest !== digestRecordWithout(value, "policyDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime policy digest must bind every control and authority reference.",
        path: ["policyDigest"],
      });
    }
  });

export type ModelRuntimeControlPolicyV1 = z.output<
  typeof modelRuntimeControlPolicyV1Schema
>;

export function digestModelRuntimeControlConfigurationV1(
  value:
    | ModelRuntimeControlPolicyV1
    | Omit<
        ModelRuntimeControlPolicyV1,
        "policyDigest" | "runtimeControlConfigurationDigest"
      >,
) {
  return digestCanonicalValue({
    administrativeSuspensions: value.administrativeSuspensions,
    allowlists: value.allowlists,
    cacheKeyAuthority: value.cacheKeyAuthority,
    canonicalCommercialAuthority: value.canonicalCommercialAuthority,
    contractVersion: value.contractVersion,
    evaluationRequirements: {
      authorityTuple: value.evaluationGate.authorityTuple,
      authorityTupleDigest: value.evaluationGate.authorityTupleDigest,
      capabilityRegistryDigest: value.evaluationGate.capabilityRegistryDigest,
      datasetCaseDigests: value.evaluationGate.datasetCaseDigests,
      datasetDigest: value.evaluationGate.datasetDigest,
      evaluationPolicyDigest: value.evaluationGate.evaluationPolicyDigest,
      evaluationPolicyId: value.evaluationGate.evaluationPolicyId,
      evaluationPolicyVersion: value.evaluationGate.evaluationPolicyVersion,
      minimumDeterministicQualityBasisPoints:
        value.evaluationGate.minimumDeterministicQualityBasisPoints,
      routeRegistryDigest: value.evaluationGate.routeRegistryDigest,
    },
    featureEntitlements: value.featureEntitlements,
    killSwitches: value.killSwitches,
    limits: value.limits,
    liveEvaluation: value.liveEvaluation,
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    recordKind: value.recordKind,
    requestWindows: value.requestWindows,
    safety: value.safety,
  });
}

export function digestModelRuntimeControlPolicyV1(
  value: Omit<ModelRuntimeControlPolicyV1, "policyDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelLiveEvaluationAuthorityV1Schema = z
  .object({
    approved: z.literal(true),
    authorityDigest: sha256DigestSchema,
    authorityId: solutionStableIdSchema,
    canonicalCommercialAuthority: z.literal("canonical-commercial-v1"),
    contractVersion: z.literal(1),
    createdAt: utcTimestampSchema,
    datasetCaseDigests: z.array(sha256DigestSchema).min(1).max(21),
    datasetDigest: sha256DigestSchema,
    environment: z.enum(["development", "staging"]),
    evaluationPolicyDigest: sha256DigestSchema,
    evaluationPolicyId: namespacedIdentifierSchema,
    evaluationPolicyVersion: semanticVersionSchema,
    expiresAt: utcTimestampSchema,
    killSwitchEngaged: z.literal(false),
    limits: z
      .object({
        maximumConcurrentJobs: z.number().int().positive().max(16),
        maximumCreditUnits: boundedCountSchema,
        maximumEstimatedMicroUsd: boundedCountSchema,
        maximumInputTokens: positiveBoundedCountSchema,
        maximumInvocations: z.number().int().positive().max(10_000),
        maximumOutputTokens: positiveBoundedCountSchema,
        maximumTotalTokens: positiveBoundedCountSchema,
      })
      .strict(),
    modelConfigurationReferences: z
      .array(namespacedIdentifierSchema)
      .min(1)
      .max(16),
    normalCi: z.literal(false),
    optIn: z.literal(true),
    organizationId: solutionStableIdSchema,
    promptTemplateDigests: z.array(sha256DigestSchema).min(1).max(64),
    recordKind: z.literal("model-live-evaluation-authority"),
    runtimeControlConfigurationDigest: sha256DigestSchema,
    runtimePolicyId: namespacedIdentifierSchema,
    runtimePolicyVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Live-evaluation authority must expire after creation.",
        path: ["expiresAt"],
      });
    }
    if (duplicateValues(value.datasetCaseDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Live-evaluation case digests must be unique.",
        path: ["datasetCaseDigests"],
      });
    }
    if (
      value.limits.maximumTotalTokens <
      value.limits.maximumInputTokens + value.limits.maximumOutputTokens
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Live-evaluation total token authority must cover input and output budgets and may additionally cover cache-token units.",
        path: ["limits", "maximumTotalTokens"],
      });
    }
    if (duplicateValues(value.modelConfigurationReferences).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Live-evaluation model references must be unique.",
        path: ["modelConfigurationReferences"],
      });
    }
    if (duplicateValues(value.promptTemplateDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Live-evaluation prompt digests must be unique.",
        path: ["promptTemplateDigests"],
      });
    }
    if (
      value.authorityDigest !== digestRecordWithout(value, "authorityDigest")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Live-evaluation authority digest must bind its exact scope and budget.",
        path: ["authorityDigest"],
      });
    }
  });

export type ModelLiveEvaluationAuthorityV1 = z.output<
  typeof modelLiveEvaluationAuthorityV1Schema
>;

export function digestModelLiveEvaluationAuthorityV1(
  value: Omit<ModelLiveEvaluationAuthorityV1, "authorityDigest">,
) {
  return digestCanonicalValue(value);
}

const modelRuntimeWindowStateV1Schema = z
  .object({
    activeConcurrentJobs: boundedCountSchema,
    requestCount: boundedCountSchema,
    windowEndsAt: utcTimestampSchema,
    windowStartedAt: utcTimestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.windowEndsAt) > Date.parse(value.windowStartedAt),
    {
      message: "A runtime request window must end after it starts.",
      path: ["windowEndsAt"],
    },
  );

const modelRuntimeLiveAuthorityUsageV1Schema = z
  .object({
    activeConcurrentJobs: boundedCountSchema,
    authorityDigest: sha256DigestSchema,
    reservedCacheReadTokens: boundedCountSchema,
    reservedCacheWriteTokens: boundedCountSchema,
    reservedCreditUnits: boundedCountSchema,
    reservedEstimatedMicroUsd: boundedCountSchema,
    reservedInputTokens: boundedCountSchema,
    reservedInvocations: boundedCountSchema,
    reservedOutputTokens: boundedCountSchema,
    reservedTotalTokens: boundedCountSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.reservedTotalTokens ===
      value.reservedCacheReadTokens +
        value.reservedCacheWriteTokens +
        value.reservedInputTokens +
        value.reservedOutputTokens,
    {
      message:
        "Reserved live-evaluation total tokens must exactly bind cache-read, cache-write, input, and output reservations.",
      path: ["reservedTotalTokens"],
    },
  );

export const modelRuntimeStateSnapshotV1Schema = z
  .object({
    activeConcurrencyLeaseIds: z.array(solutionStableIdSchema).max(20_000),
    capturedAt: utcTimestampSchema,
    contractVersion: z.literal(1),
    idempotencyReplay: z.boolean(),
    liveAuthorityUsage: modelRuntimeLiveAuthorityUsageV1Schema.optional(),
    organizationId: solutionStableIdSchema,
    policyDigest: sha256DigestSchema,
    projectId: solutionStableIdSchema,
    recordKind: z.literal("model-runtime-state-snapshot"),
    requestDigest: sha256DigestSchema,
    snapshotDigest: sha256DigestSchema,
    snapshotId: solutionStableIdSchema,
    userId: solutionStableIdSchema,
    windows: z
      .object({
        organization: modelRuntimeWindowStateV1Schema,
        user: modelRuntimeWindowStateV1Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (duplicateValues(value.activeConcurrencyLeaseIds).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Active concurrency lease identities must be unique.",
        path: ["activeConcurrencyLeaseIds"],
      });
    }
    if (value.snapshotDigest !== digestRecordWithout(value, "snapshotDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime-state digest must bind exact tenant windows, request counts, active concurrency, and idempotency state.",
        path: ["snapshotDigest"],
      });
    }
  });

export type ModelRuntimeStateSnapshotV1 = z.output<
  typeof modelRuntimeStateSnapshotV1Schema
>;

export function digestModelRuntimeStateSnapshotV1(
  value: Omit<ModelRuntimeStateSnapshotV1, "snapshotDigest">,
) {
  return digestCanonicalValue(value);
}
export const modelRuntimeHostEvidenceV1Schema = z
  .object({
    contractVersion: z.literal(1),
    evidenceDigest: sha256DigestSchema,
    evidenceId: solutionStableIdSchema,
    evidenceKind: z.enum(["allow-listed-operations", "source-ownership"]),
    catalogDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    operation: modelGatewayOperationV1Schema,
    organizationId: solutionStableIdSchema,
    outputBytes: boundedCountSchema,
    outputDigest: sha256DigestSchema,
    outputTokens: boundedCountSchema,
    passed: z.literal(true),
    projectId: solutionStableIdSchema,
    recordKind: z.literal("model-runtime-host-evidence"),
    responseSchemaDigest: sha256DigestSchema,
    runtimePolicyDigest: sha256DigestSchema,
    verifierId: namespacedIdentifierSchema,
    verifierVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceDigest !== digestRecordWithout(value, "evidenceDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime host evidence must digest exact input, policy, catalog, response schema, host-measured output counts, output, tenant, operation, and verifier result.",
        path: ["evidenceDigest"],
      });
    }
  });

export type ModelRuntimeHostEvidenceV1 = z.output<
  typeof modelRuntimeHostEvidenceV1Schema
>;

export function digestModelRuntimeHostEvidenceV1(
  value: Omit<ModelRuntimeHostEvidenceV1, "evidenceDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelRuntimeRequestedResourcesV1Schema = z
  .object({
    dependencyNames: z.array(safePackageNameSchema).max(512),
    edgeCount: boundedCountSchema,
    fileCount: boundedCountSchema,
    moduleSources: z.array(safeRegistryIdentifierSchema).max(256),
    nodeCount: boundedCountSchema,
    outputBytes: boundedCountSchema,
    outputTokens: boundedCountSchema,
    promptBytes: boundedCountSchema,
    providerSources: z.array(safeRegistryIdentifierSchema).max(64),
    repairAttempts: z.number().int().min(0).max(2),
    repositoryBytes: boundedCountSchema,
    repositoryFiles: boundedCountSchema,
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ["dependencyNames", value.dependencyNames],
      ["moduleSources", value.moduleSources],
      ["providerSources", value.providerSources],
    ] as const) {
      if (duplicateValues(values).length > 0) {
        context.addIssue({
          code: "custom",
          message: `${path} must not contain duplicates.`,
          path: [path],
        });
      }
    }
  });

export type ModelRuntimeRequestedResourcesV1 = z.output<
  typeof modelRuntimeRequestedResourcesV1Schema
>;

const modelRuntimeInputOwnershipEvidenceV1Schema = z
  .object({
    evidenceDigests: z.array(sha256DigestSchema).max(1_024),
    status: z.enum(["not-applicable", "verified"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (duplicateValues(value.evidenceDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Input ownership Evidence digests must be unique.",
        path: ["evidenceDigests"],
      });
    }
    if ((value.status === "verified") !== value.evidenceDigests.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "Verified input ownership requires Evidence, while not-applicable ownership cannot carry Evidence.",
        path: ["status"],
      });
    }
  });

export const modelRuntimeInputEvidenceV1Schema = z
  .object({
    authority: z
      .object({
        credential: z.literal(false),
        deployment: z.literal(false),
        shell: z.literal(false),
        tool: z.literal(false),
        url: z.literal(false),
      })
      .strict(),
    contractVersion: z.literal(1),
    evidenceDigest: sha256DigestSchema,
    evidenceId: solutionStableIdSchema,
    inputDigest: sha256DigestSchema,
    inputSanitized: z.literal(true),
    noRawSensitiveContent: z.literal(true),
    operation: modelGatewayOperationV1Schema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    recordKind: z.literal("model-runtime-input-evidence"),
    requested: modelRuntimeRequestedResourcesV1Schema,
    secretRedactionApplied: z.literal(true),
    sourceOwnership: modelRuntimeInputOwnershipEvidenceV1Schema,
    userId: solutionStableIdSchema,
    verifierId: namespacedIdentifierSchema,
    verifierVersion: semanticVersionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.evidenceDigest !== digestRecordWithout(value, "evidenceDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Runtime input Evidence must digest the exact tenant, operation, input, requested limits and allow-lists, redaction and ownership facts, verifier, and absence of external authority.",
        path: ["evidenceDigest"],
      });
    }
  });

export type ModelRuntimeInputEvidenceV1 = z.output<
  typeof modelRuntimeInputEvidenceV1Schema
>;

export function digestModelRuntimeInputEvidenceV1(
  value: Omit<ModelRuntimeInputEvidenceV1, "evidenceDigest">,
) {
  return digestCanonicalValue(value);
}
export const modelRuntimeCommercialEstimateV1Schema = z
  .object({
    canonicalAuthority: z.literal("canonical-commercial-v1"),
    estimateDigest: sha256DigestSchema,
    estimatedMicroUsd: boundedCountSchema,
    maximumCreditUnits: boundedCountSchema,
    pricingVersionReference: namespacedIdentifierSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.estimateDigest !== digestRecordWithout(value, "estimateDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Commercial estimate digest must bind the canonical pricing reference, credits, and estimated cost.",
        path: ["estimateDigest"],
      });
    }
  });

export type ModelRuntimeCommercialEstimateV1 = z.output<
  typeof modelRuntimeCommercialEstimateV1Schema
>;

export function digestModelRuntimeCommercialEstimateV1(
  value: Omit<ModelRuntimeCommercialEstimateV1, "estimateDigest">,
) {
  return digestCanonicalValue(value);
}
export const modelRuntimeAdmissionRequestV1Schema = z
  .object({
    capabilityRegistryDigest: sha256DigestSchema,
    cacheKeyAuthority: z
      .object({
        dataResidencyBoundary: namespacedIdentifierSchema,
        organizationSafePolicyScope: namespacedIdentifierSchema,
      })
      .strict(),
    catalogDigest: sha256DigestSchema,
    commercialEstimate: modelRuntimeCommercialEstimateV1Schema,
    contractVersion: z.literal(1),
    evaluationAuthorityTupleDigest: sha256DigestSchema,
    evaluationReportDigest: sha256DigestSchema,
    evaluationReportId: solutionStableIdSchema,
    evaluationResultSetDigest: sha256DigestSchema,
    executionClass: z.enum([
      "normal",
      "deterministic-evaluation",
      "live-evaluation",
    ]),
    idempotencyKeyDigest: sha256DigestSchema,
    inputDigest: sha256DigestSchema,
    inputEvidenceDigest: sha256DigestSchema,
    liveEvaluationAuthorityDigest: sha256DigestSchema.optional(),
    operation: modelGatewayOperationV1Schema,
    organizationId: solutionStableIdSchema,
    plan: modelPlanKeyV1Schema,
    projectId: solutionStableIdSchema,
    promptTemplateDigest: sha256DigestSchema,
    recordKind: z.literal("model-runtime-admission-request"),
    requested: modelRuntimeRequestedResourcesV1Schema,
    requestDigest: sha256DigestSchema,
    responseSchemaDigest: sha256DigestSchema,
    role: modelGatewayRoleV1Schema,
    routeRegistryDigest: sha256DigestSchema,
    routingDecisionDigest: sha256DigestSchema,
    runtimePolicyDigest: sha256DigestSchema,
    userId: solutionStableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.executionClass === "live-evaluation") !==
      (value.liveEvaluationAuthorityDigest !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only an explicitly authorized live evaluation may carry live authority.",
        path: ["liveEvaluationAuthorityDigest"],
      });
    }

    if (value.requestDigest !== digestRecordWithout(value, "requestDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Admission request digest must bind exact tenant, route, host input Evidence, and requested limits.",
        path: ["requestDigest"],
      });
    }
  });

export type ModelRuntimeAdmissionRequestV1 = z.output<
  typeof modelRuntimeAdmissionRequestV1Schema
>;

export function digestModelRuntimeAdmissionRequestV1(
  value: Omit<ModelRuntimeAdmissionRequestV1, "requestDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelRuntimeDenialReasonV1Schema = z.enum([
  "administratively-suspended",
  "capability-killed",
  "evaluation-gate-failed",
  "feature-not-entitled",
  "insufficient-credits",
  "live-evaluation-not-authorized",
  "model-not-allow-listed",
  "request-limit-exceeded",
  "concurrency-limit-exceeded",
  "input-limit-exceeded",
  "output-limit-exceeded",
  "repair-limit-exceeded",
  "dependency-not-allow-listed",
  "provider-not-allow-listed",
  "module-not-allow-listed",
  "routing-authority-mismatch",
  "runtime-control-unavailable",
  "stale-or-duplicate-conflict",
]);

export const modelRuntimeAdmissionDecisionV1Schema = z
  .object({
    accountingAuthority: z.literal("canonical-commercial-v1"),
    authorization: z
      .object({
        commercialReservationDecisionId: solutionStableIdSchema.optional(),
        concurrencyLeaseId: solutionStableIdSchema.optional(),
        entitlementDecisionId: solutionStableIdSchema.optional(),
      })
      .strict(),
    commercialEstimateDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    decisionDigest: sha256DigestSchema,
    decisionId: solutionStableIdSchema,
    decidedAt: utcTimestampSchema,
    denialReasons: z.array(modelRuntimeDenialReasonV1Schema).max(16),
    evaluationAuthorityTupleDigest: sha256DigestSchema,
    evaluationReportDigest: sha256DigestSchema,
    evaluationReportId: solutionStableIdSchema,
    evaluationResultSetDigest: sha256DigestSchema,
    executionClass: z.enum([
      "normal",
      "deterministic-evaluation",
      "live-evaluation",
    ]),
    expiresAt: utcTimestampSchema.optional(),
    invokeModel: z.boolean(),
    outcome: z.enum(["allowed", "denied"]),
    recordKind: z.literal("model-runtime-admission-decision"),
    requestDigest: sha256DigestSchema,
    routingDecisionDigest: sha256DigestSchema,
    runtimePolicyDigest: sha256DigestSchema,
    safeError: z
      .object({
        code: modelRuntimeDenialReasonV1Schema,
        messageKey: namespacedIdentifierSchema,
        noRawSensitiveValues: z.literal(true),
      })
      .strict()
      .optional(),
    writeAuthority: z
      .object({
        compiler: z.literal(false),
        deployment: z.literal(false),
        github: z.literal(false),
        payment: z.literal(false),
        repository: z.literal(false),
      })
      .strict(),
  })
  .strict()
  .superRefine(refineModelRuntimeAdmissionDecision);

export type ModelRuntimeAdmissionDecisionV1 = z.output<
  typeof modelRuntimeAdmissionDecisionV1Schema
>;

export function digestModelRuntimeAdmissionDecisionV1(
  value: Omit<ModelRuntimeAdmissionDecisionV1, "decisionDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelRuntimeEventKindV1Schema = z.enum([
  "request",
  "deny",
  "reserve",
  "settle",
  "release",
  "model-route",
  "import-inference",
  "generation-result",
  "repair-result",
  "validator-failure",
  "groundedness-failure",
  "estimated-cost",
  "latency",
  "tokens",
  "credits",
  "safety-issue",
  "eval-regression",
]);

export const modelRuntimeAuditEventV1Schema = z
  .object({
    admissionDecisionDigest: sha256DigestSchema.optional(),
    contractVersion: z.literal(1),
    eventId: solutionStableIdSchema,
    eventKind: modelRuntimeEventKindV1Schema,
    idempotencyKeyDigest: sha256DigestSchema,
    noRawPromptResponseRepositoryOrCandidateContent: z.literal(true),
    occurredAt: utcTimestampSchema,
    organizationId: solutionStableIdSchema,
    projectId: solutionStableIdSchema,
    recordKind: z.literal("model-runtime-audit-event"),
    referenceDigests: z.array(sha256DigestSchema).max(64),
    safeReasonCodes: z.array(namespacedIdentifierSchema).max(32),
    userId: solutionStableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      duplicateValues(value.referenceDigests).length > 0 ||
      duplicateValues(value.safeReasonCodes).length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Audit references and safe reason codes must be unique.",
        path: ["referenceDigests"],
      });
    }
  });

export const modelRuntimeMetricV1Schema = z
  .object({
    contractVersion: z.literal(1),
    eventKind: modelRuntimeEventKindV1Schema,
    metricId: solutionStableIdSchema,
    noRawSensitiveDimensions: z.literal(true),
    occurredAt: utcTimestampSchema,
    organizationScopeDigest: sha256DigestSchema,
    recordKind: z.literal("model-runtime-metric"),
    sourceAuthority: z.enum([
      "canonical-commercial-v1",
      "canonical-model-usage-v1",
      "deterministic-evaluation-v1",
      "runtime-control-v1",
    ]),
    unit: z.enum([
      "count",
      "basis-points",
      "milliseconds",
      "tokens",
      "credit-units",
      "estimated-micro-usd",
    ]),
    value: boundedCountSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.unit === "credit-units" &&
      value.sourceAuthority !== "canonical-commercial-v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Credit metrics may only project the canonical commercial authority.",
        path: ["sourceAuthority"],
      });
    }
    if (
      value.unit === "tokens" &&
      value.sourceAuthority !== "canonical-model-usage-v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Token metrics may only project canonical normalized model usage.",
        path: ["sourceAuthority"],
      });
    }
    const requiredUnit =
      value.eventKind === "credits"
        ? "credit-units"
        : value.eventKind === "estimated-cost"
          ? "estimated-micro-usd"
          : value.eventKind === "latency"
            ? "milliseconds"
            : value.eventKind === "tokens"
              ? "tokens"
              : undefined;
    if (requiredUnit !== undefined && value.unit !== requiredUnit) {
      context.addIssue({
        code: "custom",
        message: "The metric event kind requires its exact unit.",
        path: ["unit"],
      });
    }
    if (
      value.eventKind === "estimated-cost" &&
      value.sourceAuthority !== "canonical-commercial-v1"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Estimated-cost metrics may only project canonical commercial pricing authority.",
        path: ["sourceAuthority"],
      });
    }
    if (value.unit === "basis-points" && value.value > 10_000) {
      context.addIssue({
        code: "custom",
        message: "Basis-point metric values cannot exceed 10,000.",
        path: ["value"],
      });
    }
  });

export type ModelRuntimeAuditEventV1 = z.output<
  typeof modelRuntimeAuditEventV1Schema
>;
export type ModelRuntimeMetricV1 = z.output<typeof modelRuntimeMetricV1Schema>;

export const modelEvaluationRegressionV1Schema = z
  .object({
    authority: z.literal("deterministic"),
    caseDigest: sha256DigestSchema,
    caseId: solutionStableIdSchema,
    currentBasisPoints: basisPointsSchema,
    currentPassed: z.boolean(),
    deltaBasisPoints: z.number().int().min(-10_000).max(10_000),
    dimension: modelDeterministicScoreDimensionV1Schema,
    evidenceDigests: z.array(sha256DigestSchema).max(64),
    priorBasisPoints: basisPointsSchema,
    priorPassed: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.deltaBasisPoints !==
      value.currentBasisPoints - value.priorBasisPoints
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Regression delta must be derived from current and prior scores.",
        path: ["deltaBasisPoints"],
      });
    }
    if (duplicateValues(value.evidenceDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Regression evidence digests must be unique.",
        path: ["evidenceDigests"],
      });
    }
  });

export type ModelEvaluationRegressionV1 = z.output<
  typeof modelEvaluationRegressionV1Schema
>;
export const modelEvaluationReportV1Schema = z
  .object({
    activationRecommendation: z.enum(["hold", "eligible-for-reviewed-beta"]),
    baselineReport: z
      .object({
        reportDigest: sha256DigestSchema,
        reportId: solutionStableIdSchema,
      })
      .strict()
      .optional(),
    authorityBindingSetDigest: sha256DigestSchema,
    authorityBindings: z
      .array(modelEvaluationAuthorityBindingV1Schema)
      .min(1)
      .max(64),
    capabilityActivated: z.literal(false),
    caseResults: z
      .array(modelEvaluationCaseResultV1Schema)
      .length(modelEvaluationCaseKindV1Values.length),
    contractVersion: z.literal(1),
    datasetCaseDigests: z
      .array(sha256DigestSchema)
      .length(modelEvaluationCaseKindV1Values.length),
    datasetDigest: sha256DigestSchema,
    deterministicPassed: z.boolean(),
    deterministicQualityBasisPoints: basisPointsSchema,
    environment: modelCapabilityEnvironmentV1Schema,
    evaluationPolicyDigest: sha256DigestSchema,
    evaluationPolicyId: namespacedIdentifierSchema,
    evaluationPolicyVersion: semanticVersionSchema,
    evaluationReportId: solutionStableIdSchema,
    evaluationResultSetDigest: sha256DigestSchema,
    executionMode: z.enum(["deterministic-fake", "opt-in-live"]),
    finishedAt: utcTimestampSchema,
    liveEvaluationAuthorityDigest: sha256DigestSchema.optional(),
    normalCi: z.boolean(),
    recordKind: z.literal("model-evaluation-report"),
    regressions: z.array(modelEvaluationRegressionV1Schema).max(512),
    reportDigest: sha256DigestSchema,
    startedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const authorityTupleDigests = value.authorityBindings.map(
      (binding) => binding.authorityTupleDigest,
    );
    if (duplicateValues(authorityTupleDigests).length > 0) {
      context.addIssue({
        code: "custom",
        message: "Report authority tuple digests must be unique.",
        path: ["authorityBindings"],
      });
    }
    if (
      value.authorityBindingSetDigest !==
      digestCanonicalValue(authorityTupleDigests)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Authority-binding set digest must bind the exact ordered tuple set.",
        path: ["authorityBindingSetDigest"],
      });
    }
    for (const [index, result] of value.caseResults.entries()) {
      const binding = value.authorityBindings.find(
        (candidate) =>
          candidate.authorityTupleDigest === result.authorityTupleDigest,
      );
      if (
        binding?.authorityTuple.operation !==
          result.authorityRequirement.operation ||
        binding.authorityTuple.role !== result.authorityRequirement.role
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every result must rejoin one declared run tuple with its exact required operation and role class.",
          path: ["caseResults", index, "authorityTupleDigest"],
        });
      }
    }
    for (const [index, binding] of value.authorityBindings.entries()) {
      if (
        !value.caseResults.some(
          (result) =>
            result.authorityTupleDigest === binding.authorityTupleDigest,
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every declared authority tuple must be used by at least one case result.",
          path: ["authorityBindings", index],
        });
      }
    }
    if (
      !hasExactSet(
        value.caseResults.map((result) => result.caseDigest),
        value.datasetCaseDigests,
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Report results must cover every dataset case digest exactly once.",
        path: ["caseResults"],
      });
    }
    if (
      duplicateValues(value.caseResults.map((result) => result.caseId)).length >
      0
    ) {
      context.addIssue({
        code: "custom",
        message: "Report case identities must be unique.",
        path: ["caseResults"],
      });
    }
    const regressionKeys = value.regressions.map(
      (regression) => `${regression.caseId}\u0000${regression.dimension}`,
    );
    if (duplicateValues(regressionKeys).length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "A report can contain only one regression per case and dimension.",
        path: ["regressions"],
      });
    }
    for (const [index, regression] of value.regressions.entries()) {
      const currentCase = value.caseResults.find(
        (result) =>
          result.caseId === regression.caseId &&
          result.caseDigest === regression.caseDigest,
      );
      const currentScore = currentCase?.scores.find(
        (score) => score.dimension === regression.dimension,
      );
      if (
        currentScore?.basisPoints !== regression.currentBasisPoints ||
        currentScore.passed !== regression.currentPassed
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every regression must rejoin the exact current case and deterministic score.",
          path: ["regressions", index],
        });
      }
    }
    if (value.regressions.length > 0 && value.baselineReport === undefined) {
      context.addIssue({
        code: "custom",
        message: "Regression entries require one exact baseline report.",
        path: ["baselineReport"],
      });
    }
    const applicableScores = value.caseResults.flatMap((result) =>
      result.scores.filter((score) => score.applicable),
    );
    const applicableDimensions = new Set(
      applicableScores.map(({ dimension }) => dimension),
    );
    const dimensionsWithoutApplicableEvidence =
      modelDeterministicScoreDimensionV1Values.filter(
        (dimension) => !applicableDimensions.has(dimension),
      );
    if (dimensionsWithoutApplicableEvidence.length > 0) {
      context.addIssue({
        code: "custom",
        message:
          "Every deterministic score dimension requires at least one applicable score with evidence.",
        path: ["caseResults"],
      });
    }
    const expectedQualityBasisPoints =
      applicableScores.length === 0
        ? 0
        : Math.floor(
            applicableScores.reduce(
              (total, score) =>
                total +
                (score.direction === "higher-is-better"
                  ? score.basisPoints
                  : 10_000 - score.basisPoints),
              0,
            ) / applicableScores.length,
          );
    if (value.deterministicQualityBasisPoints !== expectedQualityBasisPoints) {
      context.addIssue({
        code: "custom",
        message:
          "Report quality must be the deterministic mean of applicable normalized score values.",
        path: ["deterministicQualityBasisPoints"],
      });
    }
    const expectedPass =
      dimensionsWithoutApplicableEvidence.length === 0 &&
      value.caseResults.every((result) => result.deterministicPassed);
    if (value.deterministicPassed !== expectedPass) {
      context.addIssue({
        code: "custom",
        message:
          "Report pass state is derived only from deterministic case results; judge scores cannot affect it.",
        path: ["deterministicPassed"],
      });
    }
    if (
      !value.deterministicPassed &&
      value.activationRecommendation !== "hold"
    ) {
      context.addIssue({
        code: "custom",
        message: "A deterministic failure must hold capability activation.",
        path: ["activationRecommendation"],
      });
    }
    const live = value.executionMode === "opt-in-live";
    if (
      live !== (value.liveEvaluationAuthorityDigest !== undefined) ||
      (live &&
        (value.normalCi ||
          !["development", "staging"].includes(value.environment))) ||
      (!live && value.environment === "production") ||
      (value.normalCi &&
        (value.executionMode !== "deterministic-fake" ||
          value.environment !== "test"))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Normal CI is deterministic test-only; live reports require explicit authority, opt-in mode, and a restricted non-CI environment.",
        path: ["executionMode"],
      });
    }

    if (
      value.evaluationResultSetDigest !==
      digestCanonicalValue(
        value.caseResults.map((result) => result.resultDigest),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "The evaluation result-set digest must bind every ordered case result.",
        path: ["evaluationResultSetDigest"],
      });
    }
    if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "Evaluation cannot finish before it starts.",
        path: ["finishedAt"],
      });
    }
    if (value.reportDigest !== digestRecordWithout(value, "reportDigest")) {
      context.addIssue({
        code: "custom",
        message:
          "Report digest must bind the dataset, runtime policy, every result, and optional live authority.",
        path: ["reportDigest"],
      });
    }
  });

export type ModelEvaluationReportV1 = z.output<
  typeof modelEvaluationReportV1Schema
>;

export function digestModelEvaluationReportV1(
  value: Omit<ModelEvaluationReportV1, "reportDigest">,
) {
  return digestCanonicalValue(value);
}

export const modelEvaluationContractV1Schema = z.discriminatedUnion(
  "recordKind",
  [
    modelEvaluationCaseV1Schema,
    modelEvaluationDatasetV1Schema,
    modelEvaluationCaseResultV1Schema,
    modelEvaluationReportV1Schema,
    modelRuntimeControlPolicyV1Schema,
    modelLiveEvaluationAuthorityV1Schema,
    modelRuntimeStateSnapshotV1Schema,
    modelRuntimeHostEvidenceV1Schema,
    modelRuntimeInputEvidenceV1Schema,
    modelRuntimeAdmissionRequestV1Schema,
    modelRuntimeAdmissionDecisionV1Schema,
    modelRuntimeAuditEventV1Schema,
    modelRuntimeMetricV1Schema,
  ],
);

export function generateModelEvaluationV1JsonSchema() {
  const generated = z.toJSONSchema(modelEvaluationContractV1Schema, {
    io: "input",
    target: "draft-2020-12",
  });
  return {
    ...generated,
    $id: "https://schemas.cloudmarkup.com/model-evaluation/v1.schema.json",
    title: "Cloud Markup Model Evaluation and Runtime Controls v1",
  };
}

export type ModelEvaluationCaseKindV1 = z.output<
  typeof modelEvaluationCaseKindV1Schema
>;
export type ModelDeterministicScoreDimensionV1 = z.output<
  typeof modelDeterministicScoreDimensionV1Schema
>;
export type ModelDeterministicScoreV1 = z.output<
  typeof modelDeterministicScoreV1Schema
>;
export type ModelJudgeScoreV1 = z.output<typeof modelJudgeScoreV1Schema>;
export type ModelEvaluationContractV1 = z.output<
  typeof modelEvaluationContractV1Schema
>;
