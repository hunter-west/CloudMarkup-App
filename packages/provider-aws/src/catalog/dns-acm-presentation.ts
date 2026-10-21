import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
  ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { awsDnsServices } from "./services/dns-acm.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Exact user-owned new public-zone and single-domain certificate identities.",
  },
  configuration: {
    status: "supported",
    reason:
      "Closed canonical domain authority, declared Region/viewer intent, managed DNS validation and protected ownership.",
  },
  validation: {
    status: "supported",
    reason:
      "Closed schemas, DNS suffix/most-specific-zone authority, regional/viewer rules and exact ownership; actual delegation and issuance stay external.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed native typed public-zone/certificate/validation resources; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed structured native zone/certificate resources; no provider execution.",
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
      "Connect exact modeled DNS/certificate dependencies; verify runtime prerequisites separately.",
    professionalExplanation:
      "Presentation reflects canonical bindings and does not confer provisioning or application authority.",
  };
}
export const awsDnsServicePresentations = awsDnsServices.map((s) => ({
  serviceId: s.id,
  docks: s.ports.map(dock),
}));
export const awsDnsServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsDnsServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  }));
