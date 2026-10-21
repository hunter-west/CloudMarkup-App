import { defineProviderConnectionRuleV1 } from "@cloudmarkup/provider-sdk";
import {
  cloudfrontBindings,
  cloudfrontDocumentation,
  cloudfrontRuleId,
} from "../services/cloudfront.js";
export const awsCloudfrontConnectionRules = cloudfrontBindings.map(
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
      iamEffects:
        id === "aws.cloudfront.reads-s3-origin"
          ? [
              {
                id: id + ".get-object",
                effect: "allow",
                actions: ["s3:GetObject"],
                resourceScope: "target-node",
                principal: "cloudfront.amazonaws.com",
                explanation:
                  "Generated bucket resource policy allows read-only access to this bucket objects, qualified by exact distribution SourceArn. Existing owner policies cannot be silently merged or adopted.",
              },
            ]
          : [],
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
        cloudfrontRuleId,
        "aws.cloudmarkup.validation.connection-cardinality",
      ],
      education: {
        summary: label,
        guidedExplanation:
          "Bind exact private S3/cache/owned alias dependencies. The private origin connection generates only read-only exact-bucket/distribution-qualified policy.",
        professionalExplanation:
          "Exact versioned empty binding, endpoints and bounded cardinality; native typed references only. Provisioning and external authority remain independent.",
        considerations: [
          "Security: Origin read grants require exact distribution-qualified generated policy; other bindings generate no IAM. No secrets or wildcard principal.",
          "Cost: Provisioning elsewhere creates paid resources; this connection performs no AWS call.",
          "Operations: Verify availability, topology, capacity and deployment authority externally.",
        ],
        documentation: cloudfrontDocumentation,
      },
    }),
);
