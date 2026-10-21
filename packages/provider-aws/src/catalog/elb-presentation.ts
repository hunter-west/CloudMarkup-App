import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
  ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { awsElbServices, elbPorts } from "./services/elb.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Exact user-owned ALB/target-group and canonical listener/backend-access children.",
  },
  configuration: {
    status: "supported",
    reason:
      "Closed ALB scheme/network, HTTP health/backend and regional HTTPS/ownership intent.",
  },
  validation: {
    status: "supported",
    reason:
      "Closed schemas, exact network/route/SG/backend/health and regional certificate ownership; live health/authority remain external.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed native ALB/target/listener, EC2 or native ECS target binding and exact owned TCP SG peer rules; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed structured ALB/target/listener and exact backend TCP SG peer rules; no provider execution.",
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
      "Connect exact modeled ALB dependencies; verify runtime prerequisites separately.",
    professionalExplanation:
      "Presentation reflects canonical bindings and does not confer provisioning or application authority.",
  };
}
export const awsElbServicePresentations = awsElbServices.map((s) => ({
  serviceId: s.id,
  docks: s.ports.map(dock),
}));
export function extendElbPresentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return {
    ...s,
    docks: [
      ...s.docks,
      ...elbPorts(s.serviceId)
        .filter((p) => !s.docks.some((d) => d.portIds.includes(p.id)))
        .map((p, i) => dock(p, s.docks.length + i)),
    ],
  };
}
export const awsElbServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsElbServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots:
      s.id === "aws.elb.target-group"
        ? [
            {
              id: s.id + ".slot.backend-access",
              slotVersion: "1.0.0",
              configurationKind: "aws.elb.backend-access",
              displayName: "Backend access",
              description:
                "One required canonical user-owned exact backend peer access.",
              graphBinding: {
                configurationServiceId: "aws.elb.backend-access-configuration",
                ownershipRelationshipType:
                  "aws.elb.target-group-owns-backend-access",
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
                "Add the owned backend group access and connect its exact groups explicitly.",
              professionalExplanation:
                "Canonical parent/edge agree. HTTPS listener is a native resource created with the existing parent-required setup flow; no generic command engine change.",
            },
          ]
        : [],
  }));
