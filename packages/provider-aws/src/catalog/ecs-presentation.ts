import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";
import { awsEcsServices, ecsPorts } from "./services/ecs-fargate.js";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Exact user-owned resources and canonical image/container configurations.",
  },
  configuration: {
    status: "supported",
    reason:
      "Strict immutable digest, Linux Fargate sizing, distinct roles, private networking, log/health/port and whole-secret intent.",
  },
  validation: {
    status: "supported",
    reason:
      "Deterministic schema, owner, role/trust, network and declared publication/population checks; external evidence remains required.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed native ECR/ECS resources with jsonencode and typed references; no provider execution.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed structured native ECR/ECS properties and typed references; no provider execution.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "No application/image generation, build, push or boot behavior is inferred.",
  },
};
function dock(
  p: {
    id: string;
    displayName: string;
    description: string;
    direction: "input" | "output";
    cardinality: "one" | "many";
    required: boolean;
  },
  order: number,
): ProviderServiceConnectionPresentationV1Input["docks"][number] {
  return {
    id: p.id.replace(/\.([^.]*)$/u, ".dock.$1"),
    category: "identity",
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
      "Connect exact reviewed intent and inspect independent runtime prerequisites.",
    professionalExplanation:
      "Presentation reflects typed owner/dependency endpoints without deriving permissions or application readiness.",
  };
}
export const awsEcsServicePresentations = awsEcsServices.map((s) => ({
  serviceId: s.id,
  docks: s.ports.map(dock),
}));
export function extendEcsPresentation(
  s: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  return {
    ...s,
    docks: [
      ...s.docks,
      ...ecsPorts(s.serviceId)
        .filter((p) => !s.docks.some((d) => d.portIds.includes(p.id)))
        .map((p, i) => dock(p, s.docks.length + i)),
    ],
  };
}
export const awsEcsServiceExtensions: ProviderServiceExtensionDefinitionV1Input[] =
  awsEcsServices.map((s) => ({
    serviceId: s.id,
    targetReadiness: readiness,
    ownedConfigurationSlots:
      s.id === "aws.ecr.repository" || s.id === "aws.ecs.task-definition"
        ? [
            {
              id:
                s.id +
                ".slot." +
                (s.id === "aws.ecr.repository" ? "image" : "container"),
              slotVersion: "1.0.0",
              configurationKind:
                s.id === "aws.ecr.repository"
                  ? "aws.ecr.image"
                  : "aws.ecs.container",
              displayName:
                s.id === "aws.ecr.repository"
                  ? "Image identities"
                  : "Essential container",
              description:
                "Exact caller-declared owned configuration with no runtime verification or inferred application behavior.",
              graphBinding: {
                configurationServiceId:
                  s.id === "aws.ecr.repository"
                    ? "aws.ecr.image-reference"
                    : "aws.ecs.container-definition",
                ownershipRelationshipType:
                  s.id === "aws.ecr.repository"
                    ? "aws.ecr.repository-owns-image"
                    : "aws.ecs.task-owns-container",
              },
              cardinality: {
                // Draft graphs stay editable while the child is configured;
                // readiness and both exporters require exactly one container.
                minimum: 0,
                maximum: s.id === "aws.ecr.repository" ? "many" : 1,
                enforcement: "provider-rule",
              },
              allowedOwnership: ["user"],
              generatedAdoption: "not-applicable",
              policyKinds: [],
              targetReadiness: readiness,
              guidedExplanation:
                "Create explicit owned configuration and supply externally reviewed image/application facts.",
              professionalExplanation:
                "Canonical parent and exact owner binding must agree; imports, generated/adopted configurations and runtime verification require separate contracts.",
            },
          ]
        : [],
  }));
