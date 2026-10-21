import { betaInfrastructureSelectedIssueV1Schema } from "@cloudmarkup/schemas";

import type {
  ArchitectureDocument,
  ValidationFinding,
} from "@cloudmarkup/domain";
import type { EditorCatalog } from "@cloudmarkup/graph-preparation/editor-catalog";

export { betaInfrastructureIssueIdentity } from "@cloudmarkup/graph-preparation/validation-finding-identity";

export function unsupportedBetaInfrastructureIssueRepair(
  document: ArchitectureDocument,
  finding: ValidationFinding,
): string | null {
  const configurationLocations = finding.affected.filter(
    (location) => location.kind === "configuration",
  );
  if (
    finding.affected.some((location) => {
      const owner =
        location.kind === "configuration" ? location.owner : location;
      if (!("nodeId" in owner)) return false;
      const nodeId = owner.nodeId;
      return document.nodes.some(
        (node) =>
          node.id === nodeId &&
          [
            "aws.iam.policy-document",
            "aws.iam.policy-statement",
            "aws.iam.policy-condition",
            "aws.iam.managed-policy-attachment",
          ].includes(node.semantic.serviceType),
      );
    })
  )
    return "This issue requires the dedicated permissions editor. AI proposals cannot edit existing policies or conditions.";
  if (
    configurationLocations.length > 0 &&
    configurationLocations.every((location) => location.owner.kind === "edge")
  )
    return "This issue requires editing an existing connection. Use the connection editor; AI proposals can add connections but cannot change existing connection settings.";
  return null;
}

/** Advisory presentation only; the server still proves applicability before credit admission. */
export function betaInfrastructureIssueRepairAvailability(
  finding: ValidationFinding,
  context: {
    readonly document: ArchitectureDocument;
    readonly catalog: EditorCatalog;
    readonly current: boolean;
    readonly editingAvailable: boolean;
    readonly sessionExpired: boolean;
    readonly aiState: "loading" | "error" | "unavailable" | "ready";
    readonly proposalAvailable: boolean;
  },
): { readonly available: boolean; readonly reason?: string } {
  if (!context.current)
    return {
      available: false,
      reason:
        "Run current, complete validation before asking AI to review this issue. Your work is kept.",
    };
  if (context.sessionExpired)
    return {
      available: false,
      reason:
        "Sign in again before reviewing a fix with AI. Your work is kept.",
    };
  if (!context.editingAvailable)
    return {
      available: false,
      reason:
        "Editing is paused or unavailable. Check project access and editing status; AI cannot change access.",
    };
  if (context.aiState === "loading")
    return {
      available: false,
      reason:
        "Checking AI availability. You can continue using the manual controls.",
    };
  if (context.aiState === "error")
    return {
      available: false,
      reason:
        "AI availability could not be checked. Check availability again or use the manual controls.",
    };
  if (context.aiState !== "ready" || !context.proposalAvailable)
    return {
      available: false,
      reason:
        "AI review is unavailable in this workspace. Use the manual configuration controls.",
    };
  const unsupported = unsupportedBetaInfrastructureIssueRepair(
    context.document,
    finding,
  );
  if (unsupported) return { available: false, reason: unsupported };
  try {
    betaInfrastructureSelectedIssue(finding);
  } catch {
    return {
      available: false,
      reason:
        "This issue needs manual review or a smaller repair scope. AI review supports up to 20 resource or connection locations.",
    };
  }
  if (
    context.catalog.identity.id !== context.document.catalog.id ||
    context.catalog.identity.version !== context.document.catalog.version ||
    context.catalog.identity.digest !== context.document.catalog.digest
  )
    return {
      available: false,
      reason:
        "The service definitions for this design are unavailable. Review this issue manually before requesting AI changes.",
    };
  for (const location of finding.affected) {
    const owner = location.kind === "configuration" ? location.owner : location;
    if (!("nodeId" in owner)) continue;
    const node = context.document.nodes.find(
      (item) => item.id === owner.nodeId,
    );
    const service = context.catalog.services.find(
      (item) => item.serviceType === node?.semantic.serviceType,
    );
    if (!node || service?.supportState !== "available")
      return {
        available: false,
        reason:
          "This resource is unavailable or unsupported. Review it manually; AI cannot make an unavailable service usable.",
      };
    if (node.semantic.lifecycle.ownership === "generated")
      return {
        available: false,
        reason:
          "This generated resource needs a manual ownership and configuration review. AI cannot customize it silently.",
      };
    if (location.kind === "configuration") {
      const key =
        location.key ?? location.path.slice(location.path.lastIndexOf(".") + 1);
      const field = service.configuration.fields.find(
        (item) => item.property === key,
      );
      const value = Object.entries(node.semantic.configuration.values).find(
        ([property]) => property === key,
      )?.[1];
      if (
        field?.valueSource !== "literal" ||
        ["node-reference", "variable-reference", "secret-reference"].includes(
          value?.kind ?? "",
        )
      )
        return {
          available: false,
          reason:
            "Use the configuration editor for this setting. AI review cannot safely update an unknown setting or a link to another value.",
        };
    }
  }
  if (
    finding.affected.every(
      (location) => location.kind === "edge" || location.kind === "port",
    )
  )
    return {
      available: false,
      reason:
        "Use the connection editor to review this existing connection. AI review cannot change its existing settings.",
    };
  return { available: true };
}

/** Stable identities only: client prose/severity are never repair authority. */
export function betaInfrastructureSelectedIssue(finding: ValidationFinding) {
  const affected = finding.affected.map((location) => {
    const owner = location.kind === "configuration" ? location.owner : location;
    return {
      ...("edgeId" in owner
        ? { edgeId: owner.edgeId }
        : "nodeId" in owner
          ? { nodeId: owner.nodeId }
          : {}),
      fieldPath: location.path.replace(/^\$\.(?:nodes|edges)\[\d+\]/u, ""),
    };
  });
  const parsed = betaInfrastructureSelectedIssueV1Schema.safeParse({
    code: finding.code,
    affected,
  });
  if (!parsed.success)
    throw new Error(
      "This issue needs manual review or a smaller repair scope. AI repairs support up to 20 resource or connection locations.",
    );
  return parsed.data;
}
