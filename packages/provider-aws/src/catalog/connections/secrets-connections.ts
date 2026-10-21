import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import {
  secretDocumentation,
  secretReadinessRuleId,
} from "../services/secretsmanager-secret.js";

export const awsSecretConnectionRules = [
  {
    id: "aws.kms.key-encrypts-secret",
    relationship: "aws.kms.encrypts-secret",
    source: "aws.kms.key",
    sourcePort: "aws.kms.key.secret-encryption",
    targetPort: "aws.secretsmanager.secret.encryption-key",
    sourceMaximum: 128,
    targetMaximum: 1,
    label: "Encrypts secret",
    implemented: true,
  },
  {
    id: "aws.iam.policy-statement-authorizes-secret",
    relationship: "aws.iam.authorizes-secret",
    source: "aws.iam.policy-statement",
    sourcePort: "aws.iam.policy-statement.secret-resource",
    targetPort: "aws.secretsmanager.secret.policy-resource",
    sourceMaximum: 1,
    targetMaximum: 128,
    label: "Scopes secret access to",
    implemented: false,
  },
].map((input) =>
  defineProviderConnectionRuleV1({
    id: input.id,
    ruleVersion: "1.0.0",
    relationshipType: input.relationship,
    category: "network-and-security",
    source: { serviceId: input.source, portId: input.sourcePort },
    target: {
      serviceId: "aws.secretsmanager.secret",
      portId: input.targetPort,
    },
    maximumConnectionsPerSource: input.sourceMaximum,
    maximumConnectionsPerTarget: input.targetMaximum,
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
    implementation: input.implemented
      ? {
          status: "implemented",
          interfaceVersion: 1,
          implementationId: "aws.kms.resolve-secret-encryption",
        }
      : {
          status: "not-implemented",
          reason:
            "The structured policy editor applies this explicit user-owned exact scope through Graph Command v1. It never generates a principal or secret retrieval behavior.",
        },
    validationRuleIds: [
      secretReadinessRuleId,
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.iam-policy-safety",
    ],
    education: {
      summary: input.label + " one exact regional secret.",
      guidedExplanation:
        "Choose encryption or access explicitly. A secret starts empty; populate it externally before use. Encryption does not grant permission to retrieve it.",
      professionalExplanation:
        "The exact typed relationship renders a KMS ARN or a secret's full generated ARN. Key-user and secret-access authority remain separate user-reviewed policy intent; no grants, secret values, runtime retrieval or lifecycle changes are inferred.",
      considerations: [
        "Customer-managed mode requires an enabled compatible key and separately reviewed key-policy usage authority.",
        "GetSecretValue and DescribeSecret are explicit independent policy choices. No value is copied into the graph or environment.",
      ],
      documentation: secretDocumentation,
    },
  }),
);
