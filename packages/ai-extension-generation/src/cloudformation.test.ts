import { describe, expect, it } from "vitest";

import {
  cloudFormationExtensionValidationPolicyV1Schema,
  cloudFormationExtensionValidationRequestV1Schema,
  validateCloudFormationExtension,
} from "./cloudformation.js";
import { sha256Text } from "./security.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const secondDigest = `sha256:${"b".repeat(64)}` as const;
const timestamp = "2026-08-21T12:00:00.000Z";

function policy(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    allowedConditionReferences: [],
    allowedParameterReferences: ["ExistingTopicArn"],
    allowedPaths: ["iac/extensions/custom/resources.yaml"],
    allowedSecretReferenceIds: ["WebhookSecretReference"],
    contractVersion: 1,
    extensionId: "extension-cfn-1",
    limits: {
      maximumDepth: 32,
      maximumFileBytes: 64 * 1_024,
      maximumFiles: 4,
      maximumNodes: 2_000,
      maximumResources: 8,
      maximumTotalBytes: 256 * 1_024,
    },
    parser: {
      digest,
      id: "cloudmarkup.cloudformation-parser",
      version: "1.0.0",
    },
    policy: {
      allowIamPolicyResources: false,
      allowWildcardIamActions: false,
      allowWildcardIamResources: false,
    },
    protectedLogicalIds: ["CanonicalBucket"],
    resourceAuthorities: [
      {
        catalogResourceType: "aws.s3.bucket",
        providerId: "cloudmarkup.aws",
        properties: [
          {
            allowedIntrinsicFunctions: ["Ref", "Fn::Sub"],
            name: "BucketName",
            required: true,
            secretHandling: "not-secret",
            valueType: "string",
          },
          {
            allowedIntrinsicFunctions: ["Ref"],
            name: "NotificationTopic",
            required: false,
            secretHandling: "not-secret",
            valueType: "string",
          },
          {
            allowedIntrinsicFunctions: [],
            name: "Configuration",
            properties: [
              {
                allowedIntrinsicFunctions: [],
                name: "Endpoint",
                pattern: "^https://[a-z0-9.-]+$",
                required: true,
                secretHandling: "not-secret",
                valueType: "string",
              },
              {
                allowedIntrinsicFunctions: [],
                maximum: 5,
                minimum: 1,
                name: "RetryCount",
                required: true,
                secretHandling: "not-secret",
                valueType: "integer",
              },
              {
                allowedIntrinsicFunctions: [],
                name: "Options",
                properties: [
                  {
                    allowedIntrinsicFunctions: [],
                    name: "Enabled",
                    required: true,
                    secretHandling: "not-secret",
                    valueType: "boolean",
                  },
                ],
                required: false,
                secretHandling: "not-secret",
                valueType: "object",
              },
            ],
            required: false,
            secretHandling: "not-secret",
            valueType: "object",
          },
          {
            allowedIntrinsicFunctions: [],
            name: "PolicyDocument",
            properties: [
              {
                allowedIntrinsicFunctions: ["Fn::Sub"],
                itemType: "string",
                name: "Action",
                required: false,
                secretHandling: "not-secret",
                valueType: "array",
              },
              {
                allowedIntrinsicFunctions: ["Fn::Sub"],
                itemType: "string",
                name: "NotAction",
                required: false,
                secretHandling: "not-secret",
                valueType: "array",
              },
              {
                allowedIntrinsicFunctions: ["Fn::Sub"],
                itemType: "string",
                name: "Resource",
                required: false,
                secretHandling: "not-secret",
                valueType: "array",
              },
              {
                allowedIntrinsicFunctions: ["Fn::Sub"],
                itemType: "string",
                name: "NotResource",
                required: false,
                secretHandling: "not-secret",
                valueType: "array",
              },
            ],
            required: false,
            secretHandling: "not-secret",
            valueType: "object",
          },
          {
            allowedIntrinsicFunctions: [
              "Fn::GetAtt",
              "Fn::Sub",
              "Fn::FindInMap",
              "Fn::ImportValue",
            ],
            name: "ReferenceValue",
            required: false,
            secretHandling: "not-secret",
            valueType: "string",
          },
        ],
        resourceType: "AWS::S3::Bucket",
        schemaDigest: secondDigest,
        schemaId: "cloudmarkup.aws-cloudformation.s3-bucket",
        schemaVersion: "1.0.0",
      },
    ],
    slotId: "cloudmarkup.extension-slot.cloudformation-custom",
    targetReadiness: "supported",
    ...overrides,
  };
}

function requestFor(
  content: string,
  policyOverrides: Record<string, unknown> = {},
) {
  return cloudFormationExtensionValidationRequestV1Schema.parse({
    assessedAt: timestamp,
    candidateArtifactDigest: digest,
    contractVersion: 1,
    files: [
      {
        content,
        digest: sha256Text(content),
        path: "iac/extensions/custom/resources.yaml",
      },
    ],
    model: {
      modelId: "model.fixture",
      modelVersion: "fixture-1",
      promptVersion: "1.0.0",
      providerId: "provider.fixture",
    },
    policy: policy(policyOverrides),
    solutionRevisionDigest: secondDigest,
    solutionRevisionId: "solution-revision-1",
  });
}

const validSource = [
  "Resources:",
  "  CandidateBucket:",
  "    Type: AWS::S3::Bucket",
  "    Properties:",
  "      BucketName: reviewed-candidate-bucket",
  "      NotificationTopic:",
  "        Ref: ExistingTopicArn",
  "",
].join("\n");

describe("bounded CloudFormation extension validation", () => {
  it("parses and validates an exact reviewed resource fragment reproducibly", () => {
    const first = validateCloudFormationExtension(requestFor(validSource));
    const second = validateCloudFormationExtension(requestFor(validSource));

    expect(first.state).toBe("passed");
    expect(first.resources).toEqual([
      {
        logicalId: "CandidateBucket",
        path: "iac/extensions/custom/resources.yaml",
        propertyNames: ["BucketName", "NotificationTopic"],
        references: ["ExistingTopicArn"],
        resourceType: "AWS::S3::Bucket",
      },
    ]);
    expect(first.evidence.level).toEqual({
      kind: "ai-extension-parse-static-validity",
      rank: 4,
    });
    expect(first.evidence.level.rank).not.toBe(3);
    expect(first.reportDigest).toBe(second.reportDigest);
    expect(first.evidence.id).toBe(second.evidence.id);
  });

  it.each([
    {
      code: "cloudmarkup.ai-extension.cloudformation-reference-unresolved",
      name: "array-form Sub with an ungrounded template reference",
      source: validSource.replace(
        "      BucketName: reviewed-candidate-bucket",
        "      BucketName:\n        Fn::Sub:\n          - '${UngroundedTopic}-${LocalName}'\n          - LocalName: reviewed",
      ),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-condition-reference-invalid",
      name: "unapproved resource condition",
      source: validSource.replace(
        "    Type: AWS::S3::Bucket",
        "    Type: AWS::S3::Bucket\n    Condition: NotReviewed",
      ),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-resource-field-unknown",
      name: "unapproved lifecycle field",
      source: validSource.replace(
        "    Type: AWS::S3::Bucket",
        "    Type: AWS::S3::Bucket\n    DeletionPolicy: Retain",
      ),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-resource-type-not-approved",
      name: "unknown resource",
      source: validSource.replace("AWS::S3::Bucket", "AWS::Lambda::Function"),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-property-unknown",
      name: "unknown property",
      source: validSource.replace(
        "      NotificationTopic:",
        "      UnknownProperty: true\n      NotificationTopic:",
      ),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-reference-unresolved",
      name: "unresolved reference",
      source: validSource.replace("ExistingTopicArn", "UngroundedTopic"),
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-yaml-alias-denied",
      name: "YAML alias",
      source:
        "Resources:\n  CandidateBucket: &bucket\n    Type: AWS::S3::Bucket\n    Properties:\n      BucketName: reviewed\n  Other: *bucket\n",
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-parse-failed",
      name: "duplicate key",
      source:
        "Resources:\n  CandidateBucket:\n    Type: AWS::S3::Bucket\n    Type: AWS::S3::Bucket\n    Properties:\n      BucketName: reviewed\n",
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-top-level-denied",
      name: "transform",
      source: `Transform: AWS::Serverless-2016-10-31\n${validSource}`,
    },
  ])("rejects $name", ({ code, source }) => {
    const result = validateCloudFormationExtension(requestFor(source));
    expect(result.state).toBe("failed");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
  });

  it("blocks pending target readiness and deterministic logical-ID shadowing", () => {
    const source = validSource.replace("CandidateBucket", "CanonicalBucket");
    const result = validateCloudFormationExtension(
      requestFor(source, { targetReadiness: "pending" }),
    );

    expect(result.state).toBe("failed");
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "cloudmarkup.ai-extension.cloudformation-target-not-supported",
        "cloudmarkup.ai-extension.cloudformation-logical-id-collision",
      ]),
    );
  });

  it("rejects secret values and custom execution resources before acceptance", () => {
    const secretSource = validSource.replace(
      "reviewed-candidate-bucket",
      "password=not-a-reference",
    );
    expect(
      validateCloudFormationExtension(requestFor(secretSource)).diagnostics.map(
        ({ code }) => code,
      ),
    ).toContain("cloudmarkup.ai-extension.cloudformation-content-unsafe");

    const customSource = validSource.replace(
      "AWS::S3::Bucket",
      "Custom::ExecuteAnything",
    );
    expect(
      validateCloudFormationExtension(requestFor(customSource)).diagnostics.map(
        ({ code }) => code,
      ),
    ).toContain(
      "cloudmarkup.ai-extension.cloudformation-custom-resource-denied",
    );
  });

  it.each([
    {
      detail: "unknown property",
      mutate: (source: string) =>
        source.replace(
          "          Enabled: true",
          "          Enabled: true\n          Surprise: denied",
        ),
    },
    {
      detail: "missing required property",
      mutate: (source: string) =>
        source.replace("        Endpoint: https://api.example.com\n", ""),
    },
    {
      detail: "exact reviewed type",
      mutate: (source: string) =>
        source.replace("RetryCount: 3", "RetryCount: many"),
    },
    {
      detail: "reviewed pattern",
      mutate: (source: string) =>
        source.replace("https://api.example.com", "http://api.example.com"),
    },
    {
      detail: "reviewed maximum",
      mutate: (source: string) =>
        source.replace("RetryCount: 3", "RetryCount: 9"),
    },
  ])("recursively rejects a nested $detail violation", ({ detail, mutate }) => {
    const nestedSource = validSource.replace(
      "      NotificationTopic:",
      [
        "      Configuration:",
        "        Endpoint: https://api.example.com",
        "        RetryCount: 3",
        "        Options:",
        "          Enabled: true",
        "      NotificationTopic:",
      ].join("\n"),
    );
    const result = validateCloudFormationExtension(
      requestFor(mutate(nestedSource)),
    );

    expect(result.state).toBe("failed");
    expect(
      result.diagnostics.some(
        (entry) =>
          entry.code ===
            "cloudmarkup.ai-extension.cloudformation-property-invalid" &&
          entry.technicalDetail.includes(detail),
      ),
    ).toBe(true);
  });

  it.each([
    {
      code: "cloudmarkup.ai-extension.cloudformation-wildcard-action-denied",
      field: "Action",
      value: "        - s3:*",
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-wildcard-action-denied",
      field: "NotAction",
      value: "        - Fn::Sub: 's3:*'",
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-wildcard-resource-denied",
      field: "Resource",
      value: "        - arn:aws:s3:::reviewed/*",
    },
    {
      code: "cloudmarkup.ai-extension.cloudformation-wildcard-resource-denied",
      field: "NotResource",
      value: "        - Fn::Sub: 'arn:aws:s3:::reviewed/*'",
    },
  ])(
    "detects recursive IAM wildcard strings under $field",
    ({ code, field, value }) => {
      const source = validSource.replace(
        "      NotificationTopic:",
        [
          "      PolicyDocument:",
          "        " + field + ":",
          value,
          "      NotificationTopic:",
        ].join("\n"),
      );
      const result = validateCloudFormationExtension(requestFor(source));

      expect(result.state).toBe("failed");
      expect(result.diagnostics.map((entry) => entry.code)).toContain(code);
    },
  );

  it("accepts exact Sub pseudo-parameter references", () => {
    const source = validSource.replace(
      "      BucketName: reviewed-candidate-bucket",
      "      BucketName:\n        Fn::Sub: 'reviewed-${AWS::Region}'",
    );
    const result = validateCloudFormationExtension(requestFor(source));

    expect(result.state).toBe("passed");
    expect(result.resources[0]?.references).toContain("AWS::Region");
  });

  it.each([
    {
      name: "GetAtt without an attribute",
      value: ["        Fn::GetAtt: CandidateBucket"],
    },
    {
      name: "Sub with an invalid placeholder",
      value: ["        Fn::Sub: '${Bad-Reference}'"],
    },
    {
      name: "Sub with an arbitrary variable-map object",
      value: [
        "        Fn::Sub:",
        "          - '${Name}'",
        "          - Name:",
        "              Arbitrary: denied",
      ],
    },
    {
      name: "FindInMap without admitted mappings",
      value: [
        "        Fn::FindInMap:",
        "          - Map",
        "          - Key",
        "          - Value",
      ],
    },
    {
      name: "ImportValue without export authority",
      value: ["        Fn::ImportValue: ExternalExport"],
    },
  ])("rejects $name", ({ value }) => {
    const source = validSource.replace(
      "      NotificationTopic:",
      ["      ReferenceValue:", ...value, "      NotificationTopic:"].join(
        "\n",
      ),
    );
    const result = validateCloudFormationExtension(requestFor(source));

    expect(result.state).toBe("failed");
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "cloudmarkup.ai-extension.cloudformation-property-invalid",
    );
  });

  it("denies explicit YAML tags structurally but permits quoted exclamation text", () => {
    const tagged = validSource.replace(
      "reviewed-candidate-bucket",
      "!!str reviewed-candidate-bucket",
    );
    const taggedResult = validateCloudFormationExtension(requestFor(tagged));
    expect(taggedResult.diagnostics.map((entry) => entry.code)).toContain(
      "cloudmarkup.ai-extension.cloudformation-yaml-tag-denied",
    );

    const quoted = validSource.replace(
      "reviewed-candidate-bucket",
      "'!reviewed-candidate-bucket'",
    );
    expect(validateCloudFormationExtension(requestFor(quoted)).state).toBe(
      "passed",
    );
  });

  it("counts invalid declarations against the resource maximum and records admission Evidence", () => {
    const source = validSource.concat(
      [
        "  InvalidButCounted:",
        "    Type: AWS::Lambda::Function",
        "    Properties: {}",
        "",
      ].join("\n"),
    );
    const result = validateCloudFormationExtension(
      requestFor(source, {
        limits: {
          maximumDepth: 32,
          maximumFileBytes: 64 * 1_024,
          maximumFiles: 4,
          maximumNodes: 2_000,
          maximumResources: 1,
          maximumTotalBytes: 256 * 1_024,
        },
      }),
    );

    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      "cloudmarkup.ai-extension.cloudformation-resource-count-exceeded",
    );
    expect(
      result.evidence.checks.find(
        ({ checkId }) =>
          checkId === "cloudmarkup.ai-extension.cloudformation-admission",
      )?.status,
    ).toBe("failed");
  });

  it("records ownership failures in Evidence", () => {
    const request = requestFor(validSource);
    const file = request.files[0];
    if (file === undefined) {
      throw new Error("The validated request fixture requires one file.");
    }
    const result = validateCloudFormationExtension({
      ...request,
      files: [{ ...file, path: "iac/extensions/custom/not-owned.yaml" }],
    });

    expect(
      result.evidence.checks.find(
        ({ checkId }) =>
          checkId === "cloudmarkup.ai-extension.cloudformation-ownership",
      )?.status,
    ).toBe("failed");
  });

  it("rejects duplicate resource types across providers and shallow object authorities", () => {
    const base = policy();
    const authority = (
      base["resourceAuthorities"] as Record<string, unknown>[]
    )[0];
    if (authority === undefined) {
      throw new Error("The policy fixture requires one resource authority.");
    }
    expect(
      cloudFormationExtensionValidationPolicyV1Schema.safeParse({
        ...base,
        resourceAuthorities: [
          authority,
          {
            ...authority,
            catalogResourceType: "aws.s3.other",
            providerId: "cloudmarkup.other",
            schemaId: "cloudmarkup.other-cloudformation.s3-bucket",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      cloudFormationExtensionValidationPolicyV1Schema.safeParse({
        ...base,
        resourceAuthorities: [
          {
            ...authority,
            properties: [
              {
                allowedIntrinsicFunctions: [],
                name: "Unmodeled",
                required: false,
                secretHandling: "not-secret",
                valueType: "object",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
