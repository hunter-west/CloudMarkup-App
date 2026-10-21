import type {
  ArchitectureDocument,
  ValidationAffectedLocation,
  ValidationFinding,
  ValidationReport,
  ValidationSeverity,
} from "@cloudmarkup/domain";

import type { EditorCatalog } from "../model/editor-catalog.js";
import type { EditorValidationSnapshot } from "./editor-validation.js";

export const VALIDATION_FILTERS = Object.freeze([
  { id: "error", label: "Errors", severities: ["error"] },
  {
    id: "security",
    label: "Security",
    severities: ["security-error"],
  },
  { id: "warning", label: "Warnings", severities: ["warning"] },
  { id: "cost", label: "Cost", severities: ["cost-warning"] },
  {
    id: "recommendation",
    label: "Recommendations",
    severities: ["recommendation"],
  },
  {
    id: "educational",
    label: "Educational",
    severities: ["educational-note"],
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly severities: readonly ValidationSeverity[];
}[]);

export type ValidationFilterId = (typeof VALIDATION_FILTERS)[number]["id"];

export const VALIDATION_SEVERITY_PRESENTATION: Readonly<
  Record<
    ValidationSeverity,
    {
      readonly label: string;
      readonly order: number;
    }
  >
> = Object.freeze({
  error: { label: "Error", order: 0 },
  "security-error": { label: "Security error", order: 1 },
  warning: { label: "Warning", order: 2 },
  "cost-warning": { label: "Cost warning", order: 3 },
  recommendation: { label: "Recommendation", order: 4 },
  "educational-note": { label: "Educational note", order: 5 },
});

function locationResourceId(location: ValidationAffectedLocation): string {
  switch (location.kind) {
    case "document":
      return "document";
    case "node":
      return `node:${location.nodeId}`;
    case "edge":
    case "port":
      return `edge:${location.edgeId}`;
    case "configuration":
      return location.owner.kind === "node"
        ? `node:${location.owner.nodeId}`
        : `edge:${location.owner.edgeId}`;
  }
}

function locationResourceLabel(
  document: ArchitectureDocument,
  location: ValidationAffectedLocation,
): string {
  if (location.kind === "document") {
    return "Project";
  }
  if (location.kind === "node") {
    return (
      document.nodes.find((node) => node.id === location.nodeId)?.presentation
        .label ?? "Unavailable resource"
    );
  }
  if (location.kind === "edge" || location.kind === "port") {
    const edge = document.edges.find(
      (candidate) => candidate.id === location.edgeId,
    );
    if (edge === undefined) return "Unavailable connection";
    const source = document.nodes.find(
      (node) => node.id === edge.semantic.source.nodeId,
    );
    const target = document.nodes.find(
      (node) => node.id === edge.semantic.target.nodeId,
    );
    return `${source?.presentation.label ?? "Unavailable resource"} to ${target?.presentation.label ?? "Unavailable resource"}`;
  }
  if (location.owner.kind === "node") {
    const nodeId = location.owner.nodeId;
    return (
      document.nodes.find((node) => node.id === nodeId)?.presentation.label ??
      "Unavailable resource"
    );
  }
  const edgeId = location.owner.edgeId;
  const edge = document.edges.find((candidate) => candidate.id === edgeId);
  if (edge === undefined) return "Unavailable connection";
  const source = document.nodes.find(
    (node) => node.id === edge.semantic.source.nodeId,
  );
  const target = document.nodes.find(
    (node) => node.id === edge.semantic.target.nodeId,
  );
  return `${source?.presentation.label ?? "Unavailable resource"} to ${target?.presentation.label ?? "Unavailable resource"}`;
}

/** Display labels only; canonical locations remain the navigation authority. */
export function validationLocationPresentation(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  location: ValidationAffectedLocation,
): { readonly label: string; readonly actionLabel: string } {
  const resource = locationResourceLabel(document, location);
  if (location.kind === "document")
    return { label: resource, actionLabel: "Go to project" };
  if (location.kind !== "configuration")
    return { label: resource, actionLabel: `Go to ${resource}` };
  const owner = location.owner;
  const node =
    owner.kind === "node"
      ? document.nodes.find((item) => item.id === owner.nodeId)
      : undefined;
  const edge =
    owner.kind === "edge"
      ? document.edges.find((item) => item.id === owner.edgeId)
      : undefined;
  const configuration =
    node === undefined
      ? catalog.relationships?.find(
          (item) => item.id === edge?.semantic.relationshipType,
        )?.configuration
      : catalog.services.find(
          (item) =>
            item.serviceType === node.semantic.serviceType &&
            item.resourceType === node.semantic.resourceType,
        )?.configuration;
  const field = configuration?.fields.find(
    (item) => item.property === location.key,
  );
  const label = `${resource} · ${field?.label ?? "Settings"}`;
  return { label, actionLabel: `Go to ${label}` };
}

export function validationRecoveryInstruction(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
  finding: ValidationFinding,
): string {
  const location =
    finding.affected.find((item) => item.kind === "configuration") ??
    finding.affected[0];
  const label =
    location === undefined
      ? "the project"
      : validationLocationPresentation(document, catalog, location).label;
  switch (finding.code) {
    case "aws.validation.lambda-execution-role-missing":
      return `Select ${label}, then use Connect to choose one compatible IAM role in the diagram. Review its trust policy and permissions before export.`;
    case "aws.validation.lambda-trigger-binding-missing":
      return `Open connection controls for ${label} and review the supported trigger binding.`;
    case "aws.validation.subnet-route-table-association-invalid":
      return `Review the subnet and its route table association. Choose one compatible route table for the subnet.`;
    case "aws.validation.iam-resource-missing":
      return `Review the permission source for ${label} and choose the required resource scope. Generated permissions must be reviewed through their owning connection.`;
    case "aws.validation.region-availability-unknown":
      return "Check official provider guidance for service availability in the selected Region before export. Adding another Region boundary will not resolve this finding.";
    default:
      return location?.kind === "configuration"
        ? `Review ${label} and correct the setting described above. Use the provider guidance below if needed.`
        : `Review ${label === "Project" ? "the project" : label} settings and connections, then correct the problem described above.`;
  }
}

interface ValidationResourceGroup {
  readonly id: string;
  readonly label: string;
  readonly findings: readonly ValidationFinding[];
}

interface ValidationSeverityGroup {
  readonly severity: ValidationSeverity;
  readonly label: string;
  readonly resources: readonly ValidationResourceGroup[];
}

export function groupValidationFindings(
  report: ValidationReport,
  document: ArchitectureDocument,
  enabledFilters: ReadonlySet<ValidationFilterId>,
): readonly ValidationSeverityGroup[] {
  const enabledSeverities = new Set(
    VALIDATION_FILTERS.filter((filter) =>
      enabledFilters.has(filter.id),
    ).flatMap((filter) => filter.severities),
  );
  const groups = new Map<
    ValidationSeverity,
    Map<string, { readonly label: string; findings: ValidationFinding[] }>
  >();

  report.findings.forEach((finding) => {
    if (!enabledSeverities.has(finding.severity)) {
      return;
    }
    // Catalog-wide availability evidence is one project concern, even when
    // its exact finding retains every affected node for technical review.
    const locations: readonly (ValidationAffectedLocation | undefined)[] =
      finding.code === "aws.validation.region-availability-unknown" ||
      finding.affected.length === 0
        ? [undefined]
        : finding.affected;
    const seenResourceIds = new Set<string>();
    locations.forEach((location) => {
      const resourceId =
        location === undefined ? "document" : locationResourceId(location);
      if (seenResourceIds.has(resourceId)) {
        return;
      }
      seenResourceIds.add(resourceId);
      const resourceLabel =
        location === undefined
          ? "Project"
          : locationResourceLabel(document, location);
      const byResource =
        groups.get(finding.severity) ??
        new Map<
          string,
          { readonly label: string; findings: ValidationFinding[] }
        >();
      const resource = byResource.get(resourceId) ?? {
        findings: [],
        label: resourceLabel,
      };
      resource.findings.push(finding);
      byResource.set(resourceId, resource);
      groups.set(finding.severity, byResource);
    });
  });

  return [...groups.entries()]
    .sort(
      ([left], [right]) =>
        VALIDATION_SEVERITY_PRESENTATION[left].order -
        VALIDATION_SEVERITY_PRESENTATION[right].order,
    )
    .map(([severity, resources]) => ({
      label: VALIDATION_SEVERITY_PRESENTATION[severity].label,
      resources: [...resources.entries()]
        .sort(([, left], [, right]) =>
          left.label.localeCompare(right.label, "en"),
        )
        .map(([id, resource]) => ({
          findings: resource.findings,
          id,
          label: resource.label,
        })),
      severity,
    }));
}

interface EditorTargetReadiness {
  readonly label: string;
  readonly ready: boolean;
  readonly reason: string;
  readonly target: string;
}

interface EditorReadinessSummary {
  readonly diagramValid: boolean;
  readonly draftHasConsequentialFindings: boolean;
  readonly localReviewedWarningCount: number;
  readonly reviewableWarningCount: number;
  readonly targets: readonly EditorTargetReadiness[];
}

function targetsForDocument(
  document: ArchitectureDocument,
  catalog: EditorCatalog,
): readonly string[] {
  const serviceTypes = new Set<string>(
    document.nodes.map((node) => node.semantic.serviceType),
  );
  return [
    ...new Set(
      catalog.services
        .filter((service) => serviceTypes.has(service.serviceType))
        .flatMap((service) =>
          service.mappings.map((mapping) => mapping.target),
        ),
    ),
  ].sort();
}

export function projectEditorReadiness({
  reviewedFindingIds,
  catalog,
  document,
  snapshot,
}: {
  readonly reviewedFindingIds: ReadonlySet<string>;
  readonly catalog: EditorCatalog;
  readonly document: ArchitectureDocument;
  readonly snapshot: EditorValidationSnapshot;
}): EditorReadinessSummary {
  const report = snapshot.draftReport;
  const reviewable = report.findings.filter((finding) =>
    ["warning", "cost-warning"].includes(finding.severity),
  );

  return {
    diagramValid:
      report.evaluationStatus === "complete" && report.summary.error === 0,
    draftHasConsequentialFindings:
      report.summary.error + report.summary["security-error"] > 0,
    localReviewedWarningCount: reviewable.filter((finding) =>
      reviewedFindingIds.has(finding.findingId),
    ).length,
    reviewableWarningCount: reviewable.length,
    targets: targetsForDocument(document, catalog).map((target) => ({
      label: target.replaceAll("-", " "),
      ready: false,
      reason:
        "Not ready: no immutable revision or target-specific compiler result is connected. Review the canonical compilation findings for mapping blockers.",
      target,
    })),
  };
}
