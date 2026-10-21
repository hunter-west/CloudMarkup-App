import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import { kmsDocumentation, kmsReadinessRuleId } from "../services/kms-key.js";

export const awsKmsConnectionRules = [
  {
    id: "aws.kms.key-owns-resource-policy",
    sourceService: "aws.iam.policy-document",
    sourcePort: "aws.iam.policy-document.kms-key-resource-policy",
    targetPort: "aws.kms.key.resource-policy",
    maximum: 1,
    label: "Owns key policy",
  },
  {
    id: "aws.iam.policy-statement-authorizes-kms-key",
    relationship: "aws.iam.authorizes-kms-key",
    sourceService: "aws.iam.policy-statement",
    sourcePort: "aws.iam.policy-statement.kms-resource",
    targetPort: "aws.kms.key.policy-resource",
    maximum: 128,
    label: "Scopes key policy to",
  },
].map((input) =>
  defineProviderConnectionRuleV1({
    id: input.id,
    ruleVersion: "1.0.0",
    relationshipType: input.relationship ?? input.id,
    category: "network-and-security",
    source: { serviceId: input.sourceService, portId: input.sourcePort },
    target: { serviceId: "aws.kms.key", portId: input.targetPort },
    maximumConnectionsPerSource: 1,
    maximumConnectionsPerTarget: input.maximum,
    maximumConnectionsPerEndpointPair: 1,
    configuration: {
      schemaId: input.id + ".connection",
      schemaVersion: "1.0.0",
      jsonSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: "urn:cloudmarkup:configuration:" + input.id + ".connection:1.0.0",
        type: "object",
        title: input.label,
        additionalProperties: false,
        properties: {},
        required: [],
      },
      uiHints: [],
    },
    questions: [],
    supportingChanges: [],
    iamEffects: [],
    missingInformationFindings: [],
    lifecycle: {
      provenance: "connection-rule",
      deletion: "release-generated-resources",
      adoption: "required-before-customization",
      sharedResource: "retain-while-referenced",
    },
    implementation: {
      status: "not-implemented",
      reason:
        "The structured policy editor applies this explicit user-owned relationship through Graph Command v1; no free-form canvas recipe or generated principal is supplied.",
    },
    validationRuleIds: [
      kmsReadinessRuleId,
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.iam-policy-safety",
    ],
    education: {
      summary: input.label + " one exact regional KMS key.",
      guidedExplanation:
        "Select the key explicitly and review each administrator or user statement before export.",
      professionalExplanation:
        "Exact canonical owner and resource bindings carry graph identity, user ownership and policy scope. Only the owning key policy may render owner-local KMS resource scope.",
      considerations: [
        "No principal or permission is inferred.",
        "The deployment caller must remain able to update the key policy; live authority requires separate verification.",
      ],
      documentation: kmsDocumentation,
    },
  }),
);
