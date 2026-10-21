import {
  defineProviderConnectionRuleV1,
  type ProviderConnectionRuleDescriptorV1,
} from "@cloudmarkup/provider-sdk";

import { emptyConfiguration } from "./empty-configuration.js";

const lifecycle = {
  provenance: "connection-rule",
  deletion: "release-generated-resources",
  adoption: "required-before-customization",
  sharedResource: "retain-while-referenced",
} as const;

function ownedConfigurationRule(input: {
  readonly id: string;
  readonly relationshipType: string;
  readonly sourceServiceId: string;
  readonly sourcePortId: string;
  readonly targetServiceId: string;
  readonly targetPortId: string;
  readonly maximumPerTarget: number;
  readonly schemaId: string;
  readonly title: string;
  readonly summary: string;
  readonly guidedExplanation: string;
  readonly professionalExplanation: string;
}): ProviderConnectionRuleDescriptorV1 {
  return defineProviderConnectionRuleV1({
    id: input.id,
    ruleVersion: "1.0.0",
    relationshipType: input.relationshipType,
    category: "network-and-security",
    source: {
      serviceId: input.sourceServiceId,
      portId: input.sourcePortId,
    },
    target: {
      serviceId: input.targetServiceId,
      portId: input.targetPortId,
    },
    maximumConnectionsPerSource: 1,
    maximumConnectionsPerTarget: input.maximumPerTarget,
    maximumConnectionsPerEndpointPair: 1,
    configuration: emptyConfiguration(
      input.schemaId,
      input.title,
      "The exact graph endpoints, owner slot, and lifecycle carry this configuration relationship; no transient attachment state is stored.",
    ),
    questions: [],
    supportingChanges: [],
    iamEffects: [],
    missingInformationFindings: [],
    lifecycle,
    implementation: {
      status: "not-implemented",
      reason:
        "The structured policy editor applies this relationship through Graph Command v1; it is not a free-form canvas connection recipe.",
    },
    validationRuleIds: [
      "aws.cloudmarkup.validation.connection-cardinality",
      "aws.cloudmarkup.validation.iam-policy-safety",
    ],
    education: {
      summary: input.summary,
      guidedExplanation: input.guidedExplanation,
      professionalExplanation: input.professionalExplanation,
      considerations: [
        "The owning service slot controls cardinality and allowed policy kinds.",
        "Lifecycle ownership determines whether later connection cleanup may remove generated configuration.",
      ],
      documentation: [
        {
          kind: "official",
          id: "aws.iam.documentation.policy-elements",
          title: "IAM JSON policy elements reference",
          publisher: "Amazon Web Services",
          url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements.html",
        },
      ],
    },
  });
}

export const roleOwnsTrustPolicy = ownedConfigurationRule({
  id: "aws.iam.role-owns-trust-policy",
  relationshipType: "aws.iam.role-owns-trust-policy",
  sourceServiceId: "aws.iam.policy-document",
  sourcePortId: "aws.iam.policy-document.role-trust-policy",
  targetServiceId: "aws.iam.role",
  targetPortId: "aws.iam.role.trust-policy",
  maximumPerTarget: 1,
  schemaId: "aws.iam.role-trust-policy.attachment",
  title: "Role trust-policy ownership",
  summary: "Controls who or what may assume one IAM role.",
  guidedExplanation:
    "This trust policy controls who or what may use the role; it does not grant the role application permissions.",
  professionalExplanation:
    "Exactly one trust document is owner-bound to the role and requires principals in its canonical statements.",
});

export const roleOwnsCustomInlinePolicy = ownedConfigurationRule({
  id: "aws.iam.role-owns-inline-policy",
  relationshipType: "aws.iam.role-owns-inline-policy",
  sourceServiceId: "aws.iam.policy-document",
  sourcePortId: "aws.iam.policy-document.role-inline-policy",
  targetServiceId: "aws.iam.role",
  targetPortId: "aws.iam.role.custom-inline-policy",
  maximumPerTarget: 32,
  schemaId: "aws.iam.role-inline-policy.attachment",
  title: "Role custom inline-policy ownership",
  summary: "Adds an explicit user-authored policy to one role.",
  guidedExplanation:
    "You explicitly added these permissions to this role. Removing an unrelated service connection will not delete them.",
  professionalExplanation:
    "The user-owned identity-inline document remains distinct from provider-generated permission documents and cleanup authority.",
});

export const roleOwnsGeneratedPermission = ownedConfigurationRule({
  id: "aws.iam.role-owns-generated-permission",
  relationshipType: "aws.iam.role-owns-generated-permission",
  sourceServiceId: "aws.iam.policy-document",
  sourcePortId: "aws.iam.policy-document.role-generated-permission",
  targetServiceId: "aws.iam.role",
  targetPortId: "aws.iam.role.generated-permission",
  maximumPerTarget: 64,
  schemaId: "aws.iam.role-generated-permission.attachment",
  title: "Role generated-permission ownership",
  summary: "Attaches a connection-generated permission to one role.",
  guidedExplanation:
    "CloudMarkup created these permissions because the role or function is connected to another service.",
  professionalExplanation:
    "Generated ownership and provenance keep release authority tied to the exact connection edges that still require the policy.",
});

export const roleOwnsManagedPolicyAttachment = ownedConfigurationRule({
  id: "aws.iam.role-owns-managed-policy-attachment",
  relationshipType: "aws.iam.role-owns-managed-policy-attachment",
  sourceServiceId: "aws.iam.managed-policy-attachment",
  sourcePortId: "aws.iam.managed-policy-attachment.role-managed-policy",
  targetServiceId: "aws.iam.role",
  targetPortId: "aws.iam.role.managed-policy",
  maximumPerTarget: 32,
  schemaId: "aws.iam.role-managed-policy.attachment",
  title: "Role managed-policy ownership",
  summary: "Attaches one reviewed managed-policy reference to a role.",
  guidedExplanation:
    "This managed policy grants its permissions to the role and remains separate from custom inline policies.",
  professionalExplanation:
    "The graph-backed reference preserves exact attachment identity without accepting pasted account-specific ARNs.",
});

export const roleOwnsPermissionsBoundary = ownedConfigurationRule({
  id: "aws.iam.role-owns-permissions-boundary",
  relationshipType: "aws.iam.role-owns-permissions-boundary",
  sourceServiceId: "aws.iam.managed-policy-attachment",
  sourcePortId: "aws.iam.managed-policy-attachment.role-permissions-boundary",
  targetServiceId: "aws.iam.role",
  targetPortId: "aws.iam.role.permissions-boundary",
  maximumPerTarget: 1,
  schemaId: "aws.iam.role-permissions-boundary.attachment",
  title: "Role permissions-boundary ownership",
  summary: "Limits the maximum permissions one role can receive.",
  guidedExplanation:
    "This boundary limits the maximum permissions the role can receive; it does not grant permissions by itself.",
  professionalExplanation:
    "The provider rule enforces zero-or-one boundary cardinality independently from managed-policy attachments.",
});

export const lambdaOwnsInvocationPermission = ownedConfigurationRule({
  id: "aws.lambda.owns-invocation-permission",
  relationshipType: "aws.lambda.owns-invocation-permission",
  sourceServiceId: "aws.iam.policy-document",
  sourcePortId: "aws.iam.policy-document.lambda-service-grant",
  targetServiceId: "aws.lambda.function",
  targetPortId: "aws.lambda.function.invocation-permission",
  maximumPerTarget: 64,
  schemaId: "aws.lambda.invocation-permission.attachment",
  title: "Lambda invocation-permission ownership",
  summary:
    "Grants one typed service principal permission to invoke a function.",
  guidedExplanation:
    "A supported trigger may need a separate permission allowing that AWS service to invoke this function.",
  professionalExplanation:
    "Service-grant documents model resource-side Lambda permissions separately from execution-role identity policies.",
});

export const policyDocumentContainsStatement = ownedConfigurationRule({
  id: "aws.iam.policy-contains-statement",
  relationshipType: "aws.iam.policy-contains-statement",
  sourceServiceId: "aws.iam.policy-statement",
  sourcePortId: "aws.iam.policy-statement.policy-document",
  targetServiceId: "aws.iam.policy-document",
  targetPortId: "aws.iam.policy-document.statement",
  maximumPerTarget: 256,
  schemaId: "aws.iam.policy-membership.connection",
  title: "IAM policy statement membership",
  summary: "Adds one canonical statement to a policy document.",
  guidedExplanation:
    "Each statement describes one clear permission purpose inside the policy.",
  professionalExplanation:
    "Stable statement node IDs and deterministic ordering preserve exact selection, duplication, and removal semantics.",
});

export const policyStatementOwnsCondition = ownedConfigurationRule({
  id: "aws.iam.statement-owns-condition",
  relationshipType: "aws.iam.statement-owns-condition",
  sourceServiceId: "aws.iam.policy-condition",
  sourcePortId: "aws.iam.policy-condition.statement-condition",
  targetServiceId: "aws.iam.policy-statement",
  targetPortId: "aws.iam.policy-statement.condition",
  maximumPerTarget: 128,
  schemaId: "aws.iam.condition-membership.connection",
  title: "IAM statement condition membership",
  summary: "Narrows when one IAM policy statement applies.",
  guidedExplanation:
    "This advanced condition belongs to one statement and limits when that statement applies.",
  professionalExplanation:
    "Typed child-node conditions avoid raw JSON and retain stable identifiers and deterministic ordering.",
});

export const awsOwnedConfigurationConnectionRulesV1 = [
  roleOwnsTrustPolicy,
  roleOwnsCustomInlinePolicy,
  roleOwnsGeneratedPermission,
  roleOwnsManagedPolicyAttachment,
  roleOwnsPermissionsBoundary,
  lambdaOwnsInvocationPermission,
  policyDocumentContainsStatement,
  policyStatementOwnsCondition,
];
