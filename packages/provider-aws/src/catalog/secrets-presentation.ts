import type {
  ProviderServiceConnectionPresentationV1Input,
  ProviderServiceExtensionDefinitionV1Input,
  ProviderTargetReadinessV1,
} from "@cloudmarkup/provider-sdk";
const readiness: ProviderTargetReadinessV1 = {
  modeling: {
    status: "supported",
    reason:
      "Typed regional secret metadata with explicit KMS and role-policy scope.",
  },
  configuration: {
    status: "supported",
    reason:
      "Strict metadata and retention fields; value population remains external.",
  },
  validation: {
    status: "supported",
    reason:
      "Deterministic name, mode, retention, key association and exact role-policy scope findings.",
  },
  terraform: {
    status: "supported",
    reason:
      "Reviewed retained aws_secretsmanager_secret metadata and exact ARN/KMS references with negative and reproducible golden evidence.",
  },
  cloudformation: {
    status: "supported",
    reason:
      "Reviewed native retained AWS::SecretsManager::Secret metadata and exact Ref/KMS references with negative and reproducible golden evidence.",
  },
  generatedCode: {
    status: "not-applicable",
    reason:
      "This metadata variant does not generate secret retrieval, credential population or application behavior.",
  },
};
export const awsSecretServiceExtension: ProviderServiceExtensionDefinitionV1Input =
  {
    serviceId: "aws.secretsmanager.secret",
    targetReadiness: readiness,
    ownedConfigurationSlots: [],
  };
function dock(
  port: string,
  label: string,
  input: boolean,
  maximum: 1 | "many",
  order: number,
): ProviderServiceConnectionPresentationV1Input["docks"][number] {
  return {
    id: port + ".dock",
    category: "identity",
    label,
    description:
      "Explicit encryption or exact identity-policy scope; no secret contents.",
    placement: input ? "left" : "right",
    order,
    directionPolicy: input ? "input-only" : "output-only",
    portIds: [port],
    cardinality: { minimum: 0, maximum, enforcement: "provider-rule" },
    allowsMultipleEdges: maximum === "many",
    containsExclusiveRelationships: maximum === 1,
    guidedExplanation:
      "Review the selected encryption key or scoped role permission before export.",
    professionalExplanation:
      "Exact typed identities preserve encryption and IAM meaning independently of diagram layout.",
  };
}
export const awsSecretServicePresentation: ProviderServiceConnectionPresentationV1Input =
  {
    serviceId: "aws.secretsmanager.secret",
    docks: [
      dock(
        "aws.secretsmanager.secret.encryption-key",
        "Encryption key",
        true,
        1,
        0,
      ),
      dock(
        "aws.secretsmanager.secret.policy-resource",
        "Secret scope",
        true,
        "many",
        1,
      ),
    ],
  };
export function extendSecretPresentation(
  service: ProviderServiceConnectionPresentationV1Input,
): ProviderServiceConnectionPresentationV1Input {
  const key = service.serviceId === "aws.kms.key";
  if (!key && service.serviceId !== "aws.iam.policy-statement") return service;
  return {
    ...service,
    docks: [
      ...service.docks,
      dock(
        key
          ? "aws.kms.key.secret-encryption"
          : "aws.iam.policy-statement.secret-resource",
        key ? "Secret encryption" : "Secret scope",
        false,
        key ? "many" : 1,
        service.docks.length,
      ),
    ],
  };
}
