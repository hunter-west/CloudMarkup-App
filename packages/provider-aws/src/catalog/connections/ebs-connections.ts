import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import { ebsBindings, ebsDocumentation, ebsRuleId } from "../services/ebs.js";
export const awsEbsConnectionRules = ebsBindings.map(
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
        ebsRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
      ],
      education: {
        summary: label,
        guidedExplanation:
          "Bind exact EBS AZ, volume owner, same-AZ EC2 instance and selected KMS key. No IAM or guest preparation is generated.",
        professionalExplanation:
          "Exact versioned empty binding, endpoints and bounded cardinality; native typed references only. Provisioning and external authority remain independent.",
        considerations: [
          "Security: Bindings generate no IAM, key policy, instance data, formatting or mounts.",
          "Cost: Provisioning elsewhere creates paid resources; this connection performs no AWS call.",
          "Operations: Verify availability, topology, capacity and deployment authority externally.",
        ],
        documentation: ebsDocumentation,
      },
    }),
);
