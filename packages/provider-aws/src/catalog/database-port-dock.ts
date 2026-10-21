import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceDefinitionV1Input,
} from "@cloudmarkup/provider-sdk";

export function dock(
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
      "Connect exact modeled database dependencies; verify runtime prerequisites separately.",
    professionalExplanation:
      "Presentation reflects canonical bindings and does not confer provisioning or application authority.",
  };
}
