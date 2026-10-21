import { defineProviderServiceV1 } from "@cloudmarkup/provider-sdk";

/** A typed child configuration; it is hidden from the architecture canvas. */
export const iamPolicyCondition = defineProviderServiceV1({
  id: "aws.iam.policy-condition",
  definitionVersion: "1.0.0",
  supportLevel: "production-oriented",
  displayName: "IAM policy condition",
  description:
    "One structured IAM condition entry owned by a canonical policy statement.",
  nodeKind: {
    kind: "resource",
    resourceType: "aws.iam.policy-condition",
    deployable: false,
  },
  iconId: null,
  placement: {
    rootPlacement: "forbidden",
    allowedParentTypes: [
      {
        serviceId: "aws.iam.policy-statement",
        relationshipType: "aws.iam.statement-owns-condition",
      },
    ],
    maximumDepth: 4,
    regionConstraint: "not-applicable",
  },
  configuration: {
    schemaId: "aws.iam.policy-condition.configuration",
    schemaVersion: "1.0.0",
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "urn:cloudmarkup:configuration:aws.iam.policy-condition.configuration:1.0.0",
      type: "object",
      title: "IAM policy condition configuration",
      description:
        "A bounded operator, condition key, and one or more literal values.",
      additionalProperties: false,
      properties: {
        operator: {
          type: "string",
          enum: [
            "ArnEquals",
            "ArnLike",
            "Bool",
            "IpAddress",
            "NumericEquals",
            "StringEquals",
            "StringLike",
          ],
        },
        key: {
          type: "string",
          minLength: 3,
          maxLength: 256,
          pattern: "^[A-Za-z0-9:/._-]+$",
        },
        values: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 32,
          uniqueItems: true,
        },
      },
      required: ["operator", "key", "values"],
    },
    uiHints: [
      {
        property: "operator",
        control: "select",
        label: "Condition operator",
        order: 0,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "key",
        control: "text",
        label: "Condition key",
        order: 1,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
      {
        property: "values",
        control: "multi-select",
        label: "Condition values",
        helpText:
          "Use reviewed literal values; secrets and account identifiers require an explicit supported reference.",
        order: 2,
        advanced: true,
        valueSource: "literal",
        securityImpact: "security-sensitive",
        costImpact: "none",
      },
    ],
  },
  ports: [
    {
      id: "aws.iam.policy-condition.statement-condition",
      displayName: "Statement condition",
      description: "Attaches this condition to exactly one policy statement.",
      direction: "output",
      capability: "aws.iam.policy.condition",
      category: "network-and-security",
      cardinality: "one",
      required: true,
    },
  ],
  validationRuleIds: [
    "aws.cloudmarkup.validation.connection-cardinality",
    "aws.cloudmarkup.validation.compiler-readiness",
    "aws.cloudmarkup.validation.iam-policy-safety",
  ],
  education: {
    summary:
      "Narrows when one policy statement applies by testing a typed request condition.",
    guidedExplanation:
      "A condition adds a precise requirement to its parent statement, such as matching a source ARN or request attribute. It is an advanced security control: choose a key, operator, and values only from reviewed provider guidance.",
    professionalExplanation:
      "This nondeployable child concept normalizes one bounded IAM operator, condition key, and unique literal value set under exactly one statement. Unsupported operators, secret values, and raw JSON remain outside the contract.",
    considerations: [
      "Connections: Every condition belongs to exactly one policy statement and has no independent deployment identity.",
      "Security: Verify the key's meaning, value format, and operator behavior; condition values must never contain secrets.",
      "Cost: A condition does not estimate charges for the provider actions or resources controlled by its parent statement.",
      "Operations: An invalid, unsupported, or misplaced condition blocks target readiness rather than being ignored.",
    ],
    documentation: [
      {
        kind: "official",
        id: "aws.iam.documentation.condition",
        title: "IAM JSON policy Condition element",
        publisher: "Amazon Web Services",
        url: "https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html",
      },
    ],
  },
  unsupportedCapabilities: [
    {
      id: "aws.iam.policy-condition.unsupported.operators",
      title: "Unreviewed condition operators",
      explanation:
        "The structured editor exposes only the bounded operator set declared by this configuration schema.",
    },
  ],
  mappings: [],
  regionAvailability: {
    state: "unknown",
    reason:
      "IAM policy conditions have global semantics and no regional availability behavior.",
  },
});

/** Absolute graph depth includes Region, VPC and endpoint owner ancestry.
 * Historical service objects above remain byte-reproducible. */
export const iamPolicyCondition0_16_0 = defineProviderServiceV1({
  ...iamPolicyCondition,
  definitionVersion: "1.1.0",
  placement: { ...iamPolicyCondition.placement, maximumDepth: 6 },
});
