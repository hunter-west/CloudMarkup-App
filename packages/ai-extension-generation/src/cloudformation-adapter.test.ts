import {
  modelGenerationContextV1Schema,
  namespacedIdentifierSchema,
  semanticVersionSchema,
} from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { createCloudFormationCandidateValidator } from "./cloudformation-adapter.js";
import {
  cloudFormationExtensionValidationPolicyV1Schema,
  getCloudFormationReviewedSchemaDocument,
} from "./cloudformation.js";
import { sha256Text } from "./security.js";
import type { CandidateTargetValidationInput } from "./validation.js";

const assessedAt = "2026-08-21T12:00:00.000Z";
const candidatePath = "iac/extensions/custom/resources.yaml";
const parserDigest = sha256Text("cloudformation-parser");
const placeholderDigest = sha256Text("placeholder");
const solutionRevisionId = "solution-revision-cfn-adapter-1";
const candidateSource = [
  "Resources:",
  "  CandidateBucket:",
  "    Type: AWS::S3::Bucket",
  "    Properties:",
  "      BucketName: reviewed-candidate-bucket",
  "",
].join("\n");

const authoritySeed = {
  catalogResourceType: namespacedIdentifierSchema.parse("aws.s3.bucket"),
  providerId: namespacedIdentifierSchema.parse("cloudmarkup.aws"),
  properties: [
    {
      allowedIntrinsicFunctions: ["Ref" as const],
      name: "BucketName",
      required: true,
      secretHandling: "not-secret" as const,
      valueType: "string" as const,
    },
  ],
  resourceType: "AWS::S3::Bucket",
  schemaDigest: placeholderDigest,
  schemaId: namespacedIdentifierSchema.parse(
    "cloudmarkup.aws-cloudformation.s3-bucket",
  ),
  schemaVersion: semanticVersionSchema.parse("1.0.0"),
};
const reviewedSchemaDocument =
  getCloudFormationReviewedSchemaDocument(authoritySeed);
const reviewedSchemaDigest = sha256Text(reviewedSchemaDocument);
const authority = {
  ...authoritySeed,
  schemaDigest: reviewedSchemaDigest,
};
const policy = cloudFormationExtensionValidationPolicyV1Schema.parse({
  allowedConditionReferences: [],
  allowedParameterReferences: [],
  allowedPaths: [candidatePath],
  allowedSecretReferenceIds: [],
  contractVersion: 1,
  extensionId: "extension-cfn-adapter-1",
  limits: {
    maximumDepth: 32,
    maximumFileBytes: 64 * 1_024,
    maximumFiles: 4,
    maximumNodes: 2_000,
    maximumResources: 8,
    maximumTotalBytes: 256 * 1_024,
  },
  parser: {
    digest: parserDigest,
    id: "cloudmarkup.cloudformation-parser",
    version: "1.0.0",
  },
  policy: {
    allowIamPolicyResources: false,
    allowWildcardIamActions: false,
    allowWildcardIamResources: false,
  },
  protectedLogicalIds: ["CanonicalBucket"],
  resourceAuthorities: [authority],
  slotId: "cloudmarkup.extension-slot.cloudformation-custom",
  targetReadiness: "supported",
});

const catalogContent = JSON.stringify({
  entries: [{ resourceType: "aws.s3.bucket", serviceType: "aws.s3" }],
});

function generationContext() {
  return modelGenerationContextV1Schema.parse({
    allowedDependencies: [],
    allowedProviders: [
      {
        providerId: "cloudmarkup.aws",
        source: "cloudmarkup/aws",
        versionConstraint: "1.0.0",
      },
    ],
    allowedResources: [
      {
        providerId: "cloudmarkup.aws",
        resourceType: "AWS::S3::Bucket",
      },
    ],
    catalogSlice: {
      catalog: {
        digest: sha256Text("catalog"),
        id: "cloudmarkup.aws-catalog",
        version: "1.0.0",
      },
      content: catalogContent,
      entries: [{ resourceType: "aws.s3.bucket", serviceType: "aws.s3" }],
      sliceDigest: sha256Text(catalogContent),
    },
    existingFiles: [],
    extensionId: policy.extensionId,
    extensionSlotId: policy.slotId,
    kind: "iac-extension",
    language: "language.yaml",
    limits: {
      maximumCandidateFileBytes: policy.limits.maximumFileBytes,
      maximumCandidateFiles: policy.limits.maximumFiles,
      maximumCandidateTotalBytes: policy.limits.maximumTotalBytes,
      maximumDependencyRequests: 0,
      maximumExpectedTests: 0,
      maximumRepairAttempts: 2,
      maximumResourceCount: policy.limits.maximumResources,
    },
    officialSchemas: [
      {
        document: reviewedSchemaDocument,
        schemaDigest: reviewedSchemaDigest,
        schemaId: authority.schemaId,
        schemaVersion: authority.schemaVersion,
      },
    ],
    ownedPaths: [candidatePath],
    ownedResourceAddresses: [],
    protectedPaths: ["iac/generated/canonical.yaml"],
    protectedResourceAddresses: ["CanonicalBucket"],
    requestedBehavior: {
      acceptanceCriteria: ["The extension remains review-only."],
      objective: "Generate one bounded CloudFormation extension.",
      requirements: ["Preserve deterministic resources."],
    },
    runtimeFamily: "runtime.cloudformation",
    sourceReferences: [
      {
        kind: "architecture-node",
        referenceId: "node_bucket",
      },
    ],
    targetFormat: "cloudformation",
    validationExpectations: [
      {
        checkId: "extension.static-analysis",
        kind: "static-analysis",
        required: true,
        successCondition: "must-pass",
        toolProfileId: "cloudmarkup.cloudformation-parser",
      },
    ],
  });
}

function validationInput(
  context: unknown = generationContext(),
): CandidateTargetValidationInput {
  const fileDigest = sha256Text(candidateSource);
  return {
    artifact: {
      artifactDigest: sha256Text("artifact"),
      artifactId: "artifact-cfn-adapter-1",
      bundleDigest: sha256Text("bundle"),
      classification: "restricted-ai-authored-candidate",
      contractVersion: 1,
      extensionId: policy.extensionId,
      files: [
        {
          digest: fileDigest,
          path: candidatePath,
          sizeBytes: candidateSource.length,
        },
      ],
      scope: {
        organizationId: "organization-test",
        projectId: "project-test",
      },
      solutionRevisionId,
      storedAt: assessedAt,
    } as CandidateTargetValidationInput["artifact"],
    assessedAt,
    bundle: {} as CandidateTargetValidationInput["bundle"],
    descriptor: {
      modelId: "model.fixture",
      modelVersion: "fixture-1",
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
    } as CandidateTargetValidationInput["descriptor"],
    files: [
      {
        content: candidateSource,
        digest: fileDigest,
        ownership: "ai-authored-candidate",
        path: candidatePath,
        sizeBytes: candidateSource.length,
        sourceKind: "file",
      },
    ],
    generationContext:
      context as CandidateTargetValidationInput["generationContext"],
    solutionRevision: {
      solutionRevisionId,
    } as CandidateTargetValidationInput["solutionRevision"],
  };
}

describe("CloudFormation candidate validator authority binding", () => {
  it("admits exact policy authority and returns passing rank-4 Evidence", async () => {
    const validator = createCloudFormationCandidateValidator({ policy });
    const result = await validator.validate(validationInput());

    expect(result.state).toBe("passed");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.level).toEqual({
      kind: "ai-extension-parse-static-validity",
      rank: 4,
    });
    expect(
      result.evidence[0]?.checks
        .filter(({ checkId }) =>
          [
            "cloudmarkup.ai-extension.cloudformation-admission",
            "cloudmarkup.ai-extension.cloudformation-ownership",
          ].includes(checkId),
        )
        .map(({ status }) => status),
    ).toEqual(["passed", "passed"]);
  });

  it.each([
    {
      name: "protected logical IDs",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        protectedResourceAddresses: [],
      }),
    },
    {
      name: "resource maximum",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        limits: { ...context.limits, maximumResourceCount: 7 },
      }),
    },
    {
      name: "file maximum",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        limits: { ...context.limits, maximumCandidateFiles: 3 },
      }),
    },
    {
      name: "per-file byte maximum",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        limits: { ...context.limits, maximumCandidateFileBytes: 63 * 1_024 },
      }),
    },
    {
      name: "total byte maximum",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        limits: {
          ...context.limits,
          maximumCandidateTotalBytes: 255 * 1_024,
        },
      }),
    },
  ])(
    "rejects policy authority beyond generation-context $name",
    ({ mutate }) => {
      const validator = createCloudFormationCandidateValidator({ policy });
      expect(() =>
        validator.validate(validationInput(mutate(generationContext()))),
      ).toThrow("does not match exact generation authority");
    },
  );

  it.each([
    {
      name: "provider",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        allowedProviders: [
          ...context.allowedProviders,
          {
            providerId: "cloudmarkup.other",
            source: "cloudmarkup/other",
            versionConstraint: "1.0.0",
          },
        ],
      }),
    },
    {
      name: "resource",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        allowedResources: [
          ...context.allowedResources,
          {
            providerId: "cloudmarkup.aws",
            resourceType: "AWS::SQS::Queue",
          },
        ],
      }),
    },
    {
      name: "official schema",
      mutate: (context: ReturnType<typeof generationContext>) => ({
        ...context,
        officialSchemas: [
          ...context.officialSchemas,
          {
            document: "{}",
            schemaDigest: sha256Text("{}"),
            schemaId: "cloudmarkup.aws-cloudformation.extra",
            schemaVersion: "1.0.0",
          },
        ],
      }),
    },
  ])("rejects extra generation-context $name authority", ({ mutate }) => {
    const validator = createCloudFormationCandidateValidator({ policy });
    expect(() =>
      validator.validate(validationInput(mutate(generationContext()))),
    ).toThrow("does not match exact generation authority");
  });

  it("rejects unnormalized schema documents and ungrounded catalog resources", () => {
    const validator = createCloudFormationCandidateValidator({ policy });
    const context = generationContext();
    const officialSchema = context.officialSchemas[0];
    if (officialSchema === undefined) {
      throw new Error("The adapter fixture requires one official schema.");
    }
    expect(() =>
      validator.validate(
        validationInput({
          ...context,
          officialSchemas: [
            {
              ...officialSchema,
              document: reviewedSchemaDocument + " ",
            },
          ],
        }),
      ),
    ).toThrow("does not match exact generation authority");
    expect(() =>
      validator.validate(
        validationInput({
          ...context,
          catalogSlice: {
            ...context.catalogSlice,
            entries: [
              { resourceType: "aws.sqs.queue", serviceType: "aws.sqs" },
            ],
          },
        }),
      ),
    ).toThrow("does not match exact generation authority");
  });
});
