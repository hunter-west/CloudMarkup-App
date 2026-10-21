import type {
  ProviderTargetReadinessV1,
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { wafServices, wafPorts, WAF_ALB } from "./services/regional-waf.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason: "Current exact regional ACL and user-owned ALB association.",
  },
  configuration: {
    status: "supported",
    reason:
      "Closed bounded rules, actions, priorities, Region and independent visibility controls.",
  },
  validation: {
    status: "supported",
    reason:
      "Pure provider and compiler checks; no live traffic or availability proof.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed current-catalog structured renderer and offline goldens; AWS runtime and traffic qualification remain separate.",
  },
  terraform: {
    status: "pending",
    reason: "No WAF Terraform renderer or provider execution is enabled.",
  },
  generatedCode: {
    status: "not-applicable",
    reason: "WAF infrastructure generates no application code.",
  },
};

const docks = (
  id: string,
): ProviderServiceConnectionPresentationV1Input["docks"] =>
  wafPorts(id).map((p, order) => ({
    id: p.id.replace(/\.([^.]*)$/u, ".dock.$1"),
    category: "networking" as const,
    label: p.displayName,
    description: p.description,
    placement: p.direction === "input" ? ("left" as const) : ("right" as const),
    order: order + 100,
    directionPolicy:
      p.direction === "input"
        ? ("input-only" as const)
        : ("output-only" as const),
    portIds: [p.id],
    cardinality: {
      minimum: p.required ? 1 : 0,
      maximum: p.cardinality === "one" ? 1 : ("many" as const),
      enforcement: "provider-rule" as const,
    },
    allowsMultipleEdges: p.cardinality === "many",
    containsExclusiveRelationships: p.cardinality === "one",
    guidedExplanation:
      "Connect the exact regional WAF association. Count mode observes traffic.",
    professionalExplanation:
      "Stable presentation only; typed endpoints, cardinality and native association retain deployment meaning.",
  }));

export const awsWafServicePresentations = wafServices.map((service) => ({
  serviceId: service.id,
  docks: docks(service.id),
}));
export function extendWafPresentation(
  service: ProviderServiceConnectionPresentationV1Input,
) {
  return service.serviceId === WAF_ALB
    ? { ...service, docks: [...service.docks, ...docks(WAF_ALB)] }
    : service;
}
export const awsWafServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  wafServices.map((service) => ({
    serviceId: service.id,
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  }));
