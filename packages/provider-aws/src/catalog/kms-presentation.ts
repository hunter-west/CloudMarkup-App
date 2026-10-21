import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";

const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "One typed regional symmetric KMS key with exact user-owned policy bindings.",
  },
  configuration: {
    status: "supported",
    reason:
      "Strict key, rotation and retained-lifecycle fields; no secret material or raw policies.",
  },
  validation: {
    status: "supported",
    reason:
      "Deterministic key bounds, exact policy ownership, self-scope and administrator findings.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed inline aws_kms_key policy renderer with focused negative, parsed golden, public compile and byte-reproducibility evidence.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed native AWS::KMS::Key renderer with inline policy, Retain lifecycle, focused negative, parsed golden, public compile and byte-reproducibility evidence.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "This key foundation does not generate application cryptographic behavior.",
  },
};
export const kmsKeyPolicySlot = {
  id: "aws.kms.key.slot.resource-policy",
  slotVersion: "1.0.0",
  configurationKind: "aws.iam.policy.kms-resource",
  displayName: "Key policy",
  description:
    "One explicit user-owned canonical policy attached inline to its regional key.",
  graphBinding: {
    configurationServiceId: "aws.iam.policy-document",
    ownershipRelationshipType: "aws.kms.key-owns-resource-policy",
  },
  cardinality: { minimum: 1, maximum: 1, enforcement: "provider-rule" },
  allowedOwnership: ["user"],
  generatedAdoption: "not-applicable",
  policyKinds: ["resource"],
  targetReadiness: readiness,
  guidedExplanation:
    "Choose an explicit key administrator and review separate key-user permissions. No administrator is assumed.",
  professionalExplanation:
    "Exactly one user-owned canonical resource document supplies the inline KeyPolicy. Typed self-scope renders KMS owner-local Resource only after exact owner validation; lockout bypass remains false.",
} satisfies ProviderServiceExtensionDefinitionV1Input["ownedConfigurationSlots"][number];

export const awsKmsServiceExtension: ProviderServiceExtensionDefinitionV1Input =
  {
    serviceId: "aws.kms.key",
    targetReadiness: readiness,
    ownedConfigurationSlots: [kmsKeyPolicySlot],
  };
function dock(
  portId: string,
  label: string,
  input: boolean,
  maximum: 1 | "many",
  required = false,
): ProviderServiceConnectionPresentationV1Input["docks"][number] {
  return {
    id: portId + ".dock",
    category: "identity",
    label,
    description: "Explicit reviewed key policy ownership and graph scope.",
    placement: input ? "left" : "right",
    order: 0,
    directionPolicy: input ? "input-only" : "output-only",
    portIds: [portId],
    cardinality: {
      minimum: required ? 1 : 0,
      maximum,
      enforcement: "provider-rule",
    },
    allowsMultipleEdges: maximum === "many",
    containsExclusiveRelationships: maximum === 1,
    guidedExplanation: "Review the policy and its exact key before exporting.",
    professionalExplanation:
      "This visual dock preserves exact canonical policy ownership and typed resource scope.",
  };
}
export const awsKmsServicePresentation: ProviderServiceConnectionPresentationV1Input =
  {
    serviceId: "aws.kms.key",
    docks: [
      dock("aws.kms.key.resource-policy", "Key policy", true, 1, true),
      {
        ...dock("aws.kms.key.policy-resource", "Key scope", true, "many"),
        order: 1,
      },
    ],
  };
export function extendKmsPresentation(
  service: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  const port =
    service.serviceId === "aws.iam.policy-document"
      ? "aws.iam.policy-document.kms-key-resource-policy"
      : service.serviceId === "aws.iam.policy-statement"
        ? "aws.iam.policy-statement.kms-resource"
        : undefined;
  return port
    ? {
        ...service,
        docks: [
          ...service.docks,
          { ...dock(port, "KMS key", false, 1), order: service.docks.length },
        ],
      }
    : service;
}
