import type { ValidationFinding } from "@cloudmarkup/domain";

import type { EditorOwnedConfigurationSlot } from "../model/editor-catalog.js";

export type PolicyKind = EditorOwnedConfigurationSlot["policyKinds"][number];

const policyKindOrder: Readonly<Record<PolicyKind, number>> = {
  "generated-permission": 2,
  "identity-inline": 0,
  trust: 1,
  "managed-policy-attachment": 3,
  "permissions-boundary": 4,
  resource: 5,
  "service-grant": 6,
};

export function ownedConfigurationSectionTitle(
  slot: EditorOwnedConfigurationSlot,
): string {
  const kind = slot.policyKinds[0];
  return kind === "managed-policy-attachment"
    ? "Managed attachments"
    : slot.displayName;
}

export function ownedConfigurationSectionExplanation(
  slot: EditorOwnedConfigurationSlot,
): string {
  switch (slot.policyKinds[0]) {
    case "generated-permission":
      return "These were created because this role or function is connected to other services.";
    case "identity-inline":
      return "You explicitly added these permissions to this role.";
    case "trust":
      return "This controls who or what may use this role.";
    case "permissions-boundary":
      return "This limits the maximum permissions the role can receive.";
    case "managed-policy-attachment":
      return "These reviewed managed-policy references grant their policy permissions and remain separate from inline policies.";
    case "resource":
      return "This policy controls access to the resource that owns it.";
    case "service-grant":
      return "These grants are created when a supported caller needs permission to use this service.";
    default:
      return slot.description;
  }
}

export function orderOwnedConfigurationSlots(
  slots: readonly EditorOwnedConfigurationSlot[],
): readonly EditorOwnedConfigurationSlot[] {
  return [...slots].sort((left, right) => {
    const leftOrder = policyKindOrder[left.policyKinds[0] ?? "resource"];
    const rightOrder = policyKindOrder[right.policyKinds[0] ?? "resource"];
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
}

export function policyKindPermitsPrincipals(kind: PolicyKind): boolean {
  return kind === "trust" || kind === "resource" || kind === "service-grant";
}

export function statementPrincipalConstraint(
  kind: PolicyKind,
): Readonly<Record<string, string>> {
  return policyKindPermitsPrincipals(kind)
    ? {}
    : { principalKind: "none", principals: "" };
}

export function statementPrincipalHiddenProperties(
  kind: PolicyKind,
): readonly string[] {
  return Object.keys(statementPrincipalConstraint(kind));
}

export function generatedAdoptionMessage(
  adoption: EditorOwnedConfigurationSlot["generatedAdoption"],
): string {
  if (adoption !== "allowed") {
    return adoption === "forbidden"
      ? "The provider does not permit adoption for this generated configuration."
      : "Adoption does not apply to this generated configuration.";
  }
  return "The reviewed adoption workflow is not available in this editor yet. This generated configuration remains read-only.";
}

export function policyValidationSeverityTone(
  severity: ValidationFinding["severity"],
) {
  switch (severity) {
    case "error":
    case "security-error":
      return "error" as const;
    case "warning":
    case "cost-warning":
      return "warning" as const;
    case "recommendation":
      return "info" as const;
    case "educational-note":
      return "neutral" as const;
  }
}
