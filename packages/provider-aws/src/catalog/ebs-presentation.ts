import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
  ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { awsEbsServices, ebsPorts } from "./services/ebs.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Exact user-owned AZ-placed volume and canonical deployable attachment child.",
  },
  configuration: {
    status: "supported",
    reason:
      "Closed encrypted empty gp3 capacity, encryption mode, API device and external guest preparation.",
  },
  validation: {
    status: "supported",
    reason:
      "Closed schemas, exact AZ/owner/EC2/KMS bindings, unique devices and attachment bounds; guest state and authority remain external.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed native EBS volume/attachment and exact key/instance references; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed structured EBS volume/attachment and retention; no provider execution.",
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
      "Connect exact modeled EBS dependencies; verify runtime prerequisites separately.",
    professionalExplanation:
      "Presentation reflects canonical bindings and does not confer provisioning or application authority.",
  };
}
export const awsEbsServicePresentations = awsEbsServices.map((s) => ({
  serviceId: s.id,
  docks: s.ports.map(dock),
}));
export function extendEbsPresentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return {
    ...s,
    docks: [
      ...s.docks,
      ...ebsPorts(s.serviceId)
        .filter((p) => !s.docks.some((d) => d.portIds.includes(p.id)))
        .map((p, i) => dock(p, s.docks.length + i)),
    ],
  };
}
export const awsEbsServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsEbsServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  }));
