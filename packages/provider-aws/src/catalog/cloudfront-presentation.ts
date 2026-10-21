import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
  ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import {
  awsCloudfrontServices,
  cloudfrontPorts,
} from "./services/cloudfront.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Exact user-owned distribution/cache policy and canonical owned alias.",
  },
  configuration: {
    status: "supported",
    reason:
      "Closed static-cache/public-content/private-origin and exact certificate/alias/ownership intent.",
  },
  validation: {
    status: "supported",
    reason:
      "Closed schemas, TTL order, exact origin read policy, alias/certificate/zone ownership; actual content, delegation and serving health stay external.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed native distribution, static cache policy, always-signed OAC, exact bucket policy and optional protected DNS aliases; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed structured native distribution/cache/OAC, exact bucket policy and owned A/AAAA alias records; no provider execution.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "No clients, queries, schema/data, migrations or business behavior are generated.",
  },
};
function dock(
  p: ProviderServiceDefinitionV1Input["ports"][number],
  order: number,
): ProviderServiceConnectionPresentationV1Input["docks"][number] {
  return {
    id: p.id.replace(/\.([^.]*)$/u, ".dock.$1"),
    category: "networking",
    label: p.displayName,
    description: p.description,
    placement: p.direction === "input" ? "left" : "right",
    order,
    directionPolicy: p.direction === "input" ? "input-only" : "output-only",
    portIds: [p.id],
    cardinality: {
      minimum: p.required ? 1 : 0,
      maximum: p.cardinality === "one" ? 1 : "many",
      enforcement: "provider-rule",
    },
    allowsMultipleEdges: p.cardinality !== "one",
    containsExclusiveRelationships: p.cardinality === "one",
    guidedExplanation:
      "Connect exact modeled CloudFront dependencies; verify runtime prerequisites separately.",
    professionalExplanation:
      "Presentation reflects canonical bindings and does not confer provisioning or application authority.",
  };
}
export const awsCloudfrontServicePresentations = awsCloudfrontServices.map(
  (s) => ({
    serviceId: s.id,
    docks: s.ports.map(dock),
  }),
);
export function extendCloudfrontPresentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return {
    ...s,
    docks: [
      ...s.docks,
      ...cloudfrontPorts(s.serviceId)
        .filter((p) => !s.docks.some((d) => d.portIds.includes(p.id)))
        .map((p, i) => dock(p, s.docks.length + i)),
    ],
  };
}
export const awsCloudfrontServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsCloudfrontServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots:
      s.id === "aws.cloudfront.distribution"
        ? [
            {
              id: s.id + ".slot.alias",
              slotVersion: "1.0.0",
              configurationKind: "aws.cloudfront.alias",
              displayName: "Custom viewer alias",
              description:
                "One explicit user-owned exact-domain alias and protected A/AAAA projections; no live DNS change.",
              graphBinding: {
                configurationServiceId: "aws.cloudfront.alias-configuration",
                ownershipRelationshipType:
                  "aws.cloudfront.distribution-owns-alias",
              },
              cardinality: {
                minimum: 0,
                maximum: 1,
                enforcement: "provider-rule",
              },
              allowedOwnership: ["user"],
              generatedAdoption: "not-applicable",
              policyKinds: [],
              targetReadiness: readiness,
              guidedExplanation:
                "Add one exact viewer alias with a us-east-1 certificate and its caller-attested public zone.",
              professionalExplanation:
                "Canonical parent and owner edge must agree. Native DNS record projections remain owned by this alias; existing/external aliases and cross-region stacks are unsupported.",
            },
          ]
        : [],
  }));
