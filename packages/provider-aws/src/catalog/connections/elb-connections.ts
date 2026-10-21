import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import { elbBindings, elbDocumentation, elbRuleId } from "../services/elb.js";
export const awsElbConnectionRules = elbBindings.map(
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
      maximumConnectionsPerEndpointPair: 1,
      configuration: {
        schemaId: id + ".connection",
        schemaVersion: "1.0.0",
        jsonSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          $id: "urn:cloudmarkup:configuration:" + id + ".connection:1.0.0",
          type: "object",
          title: label,
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
        status: "implemented",
        interfaceVersion: 1,
        implementationId: id + ".resolve",
      },
      validationRuleIds: [
        elbRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
      ],
      education: {
        summary: label,
        guidedExplanation:
          "Bind exact ALB network/listener/certificate/backend dependencies. No IAM or viewer ingress is generated.",
        professionalExplanation:
          "Exact versioned empty binding, endpoints and bounded cardinality; native typed references only. Provisioning and external authority remain independent.",
        considerations: [
          "Security: Only an explicit canonical backend-access configuration projects exact TCP SG peer rules; bindings generate no IAM or client ingress.",
          "Cost: Provisioning elsewhere creates paid resources; this connection performs no AWS call.",
          "Operations: Verify availability, topology, capacity and deployment authority externally.",
        ],
        documentation: elbDocumentation,
      },
    }),
);
