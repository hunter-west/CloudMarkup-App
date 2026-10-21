import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";
import { awsFsxServices } from "./services/fsx.js";
import { awsFsxConnectionRules } from "./connections/fsx-connections.js";
type Dock = ProviderServiceConnectionPresentationV1Input["docks"][number];
function dock(
  serviceId: string,
  id: string,
  label: string,
  direction: "input" | "output",
  order: number,
  required = false,
  single = false,
): Dock {
  return {
    id: serviceId + ".dock." + id,
    category: "networking",
    label,
    description: label + " selected from explicit graph relationships.",
    placement: direction === "input" ? "left" : "right",
    order,
    directionPolicy: direction === "input" ? "input-only" : "output-only",
    portIds: [serviceId + "." + id],
    cardinality: {
      minimum: required ? 1 : 0,
      maximum: single ? 1 : "many",
      enforcement: "provider-rule",
    },
    allowsMultipleEdges: !single,
    containsExclusiveRelationships: true,
    guidedExplanation:
      "Choose the exact network, storage or data resource using Add connection.",
    professionalExplanation:
      "The dock presents typed association ports; it grants no permissions and changes no deployment meaning.",
  };
}
export const awsFsxServicePresentations: ProviderServiceConnectionPresentationV1Input[] =
  awsFsxServices.map((s) => ({
    serviceId: s.id,
    docks: s.ports.map((p, i) =>
      dock(
        s.id,
        p.id.slice(s.id.length + 1),
        p.displayName,
        p.direction === "input" ? "input" : "output",
        i,
        p.required,
        p.cardinality === "one",
      ),
    ),
  }));
export function extendFsxPresentation(
  p: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return ["aws.ec2.subnet", "aws.ec2.security-group"].includes(p.serviceId)
    ? {
        ...p,
        docks: [
          ...p.docks,
          dock(p.serviceId, "fsx", "FSx file systems", "input", p.docks.length),
        ],
      }
    : p;
}
export const awsFsxRelationshipLabels = awsFsxConnectionRules.map((r) => ({
  ruleId: r.id,
  label: r.education.summary,
}));
export const awsFsxServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsFsxServices.map((s) => ({
    serviceId: s.id,
    ownedConfigurationSlots: [],
    targetReadiness: {
      modeling: {
        status: "supported",
        reason: "Typed FSx family and exact network/storage relationships.",
      },
      configuration: {
        status: "supported",
        reason: "Strict family-specific configuration; no inline credentials.",
      },
      validation: {
        status: "supported",
        reason:
          "Deterministic FSx topology, bounds and access-readiness validation.",
      },
      terraform: {
        status: "supported",
        reason: "Version-bound FSx renderer with exact resource bindings.",
      },
      cloudformation: {
        status: "supported",
        reason: "Version-bound native FSx resources and properties.",
      },
      generatedCode: {
        status: "not-applicable",
        reason:
          "File-system infrastructure is configured independently of workload source.",
      },
    },
  }));
