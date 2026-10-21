import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import {
  ecsBindings,
  ecsDocumentation,
  ecsRuleId,
} from "../services/ecs-fargate.js";
export const awsEcsConnectionRules = ecsBindings.map(
  ([id, source, sourcePort, target, targetPort, sourceMax, targetMax, label]) =>
    defineProviderConnectionRuleV1({
      id,
      ruleVersion: "1.0.0",
      relationshipType: id,
      category: "network-and-security",
      source: { serviceId: source, portId: source + "." + sourcePort },
      target: { serviceId: target, portId: target + "." + targetPort },
      maximumConnectionsPerSource: sourceMax,
      maximumConnectionsPerTarget: targetMax,
      maximumConnectionsPerEndpointPair:
        id === "aws.ecs.container-uses-secret" ? 8 : 1,
      configuration: {
        schemaId: id + ".connection",
        schemaVersion: "1.0.0",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "urn:cloudmarkup:configuration:" + id + ".connection:1.0.0",
          type: "object",
          title: label,
          additionalProperties: false,
          properties:
            id === "aws.ecs.container-uses-secret"
              ? {
                  environmentName: {
                    type: "string",
                    pattern: "^[A-Z][A-Z0-9_]{0,63}$",
                  },
                  populationStatus: {
                    type: "string",
                    enum: [
                      "external-population-required",
                      "externally-confirmed",
                    ],
                    default: "external-population-required",
                  },
                }
              : {},
          required:
            id === "aws.ecs.container-uses-secret"
              ? ["environmentName", "populationStatus"]
              : [],
        },
        uiHints:
          id === "aws.ecs.container-uses-secret"
            ? [
                {
                  property: "environmentName",
                  control: "text",
                  label: "Container environment name",
                  helpText:
                    "Whole-secret injection by reference only. Credential/control environment names are forbidden; secret values never enter the graph.",
                  order: 0,
                  advanced: false,
                  valueSource: "literal",
                  securityImpact: "security-sensitive",
                  costImpact: "none",
                },
                {
                  property: "populationStatus",
                  control: "select",
                  label: "External population status",
                  helpText:
                    "Confirm only after external evidence that the secret has a usable value. Positive task counts require confirmation. This declaration is not live verification.",
                  order: 1,
                  advanced: false,
                  valueSource: "literal",
                  securityImpact: "security-sensitive",
                  costImpact: "none",
                },
              ]
            : [],
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
        status: "implemented",
        interfaceVersion: 1,
        implementationId: id + ".resolve",
      },
      validationRuleIds: [
        ecsRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
      ],
      education: {
        summary: label + " through explicit immutable configuration.",
        guidedExplanation:
          "Connect reviewed user-owned resources. This binding creates no permissions, topology, image or running application.",
        professionalExplanation:
          "Canonical versioned endpoints preserve exact native references and ownership. Secret bindings declare only an environment name and external population status; execution-role read authority remains an independent explicit policy.",
        considerations: [
          "Security: No permissions are inferred; image/log/network/secret bindings require independently reviewed execution authority.",
          "Operations: Offline declarations do not prove publication, population, health, capacity or application behavior; review runtime evidence externally.",
        ],
        documentation: ecsDocumentation,
      },
    }),
);
