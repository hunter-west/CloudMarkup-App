import {
  repositoryRelativePathSchema,
  exportDiagnosticRecoveryReferencesV1Schema,
  serializeCanonicalJson,
  type ExportDiagnosticReferenceV1,
} from "@cloudmarkup/schemas";

import {
  solutionExportWorkflowDiagnosticKey,
  solutionExportWorkflowDiagnosticV1Schema,
  type SolutionExportWorkflowDiagnosticV1,
  type SolutionExportWorkflowStageIdV1,
} from "./contracts.js";

const referenceIdSchema =
  solutionExportWorkflowDiagnosticV1Schema.shape.nodeId.unwrap();

export interface SolutionExportWorkflowDiagnosticInputV1 {
  readonly references?: readonly ExportDiagnosticReferenceV1[] | undefined;
  readonly code: string;
  readonly edgeId?: string | undefined;
  readonly edgeIds?: readonly string[] | undefined;
  readonly nodeId?: string | undefined;
  readonly nodeIds?: readonly string[] | undefined;
  readonly ownedPolicyId?: string | undefined;
  readonly ownedPolicyIds?: readonly string[] | undefined;
  readonly path?: string | undefined;
  readonly severity: "error" | "warning" | "info";
  readonly workloadId?: string | undefined;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function canonicalReference(
  singular: string | undefined,
  plural: readonly string[] | undefined,
):
  | { readonly valid: true; readonly value?: string }
  | { readonly valid: false } {
  const values = [
    ...(singular === undefined ? [] : [singular]),
    ...(plural ?? []),
  ];
  const parsed = values.map((value) => referenceIdSchema.safeParse(value));
  if (parsed.some((entry) => !entry.success)) return { valid: false };
  const unique = Array.from(
    new Set(parsed.map((entry) => (entry.success ? entry.data : ""))),
  ).sort(compareUtf16);
  return unique[0] === undefined
    ? { valid: true }
    : { valid: true, value: unique[0] };
}

function normalizedDiagnostic(
  stage: SolutionExportWorkflowStageIdV1,
  origin: SolutionExportWorkflowDiagnosticV1["origin"],
  value: SolutionExportWorkflowDiagnosticInputV1,
): SolutionExportWorkflowDiagnosticV1 {
  const edgeId = canonicalReference(value.edgeId, value.edgeIds);
  const nodeId = canonicalReference(value.nodeId, value.nodeIds);
  const ownedPolicyId = canonicalReference(
    value.ownedPolicyId,
    value.ownedPolicyIds,
  );
  const workloadId = canonicalReference(value.workloadId, undefined);
  const path =
    value.path === undefined
      ? { success: true as const, data: undefined }
      : repositoryRelativePathSchema.safeParse(value.path);
  const references: unknown[] = [...(value.references ?? [])];
  for (const [kind, singular, plural] of [
    ["node", value.nodeId, value.nodeIds],
    ["edge", value.edgeId, value.edgeIds],
    ["owned-policy", value.ownedPolicyId, value.ownedPolicyIds],
    ["workload", value.workloadId, undefined],
  ] as const) {
    for (const id of [
      ...(singular === undefined ? [] : [singular]),
      ...(plural ?? []),
    ]) {
      references.push({ kind, id });
    }
  }
  if (value.path !== undefined)
    references.push({ kind: "repository", path: value.path });
  const uniqueReferences = new Map(
    references.map((reference) => [
      serializeCanonicalJson(reference),
      reference,
    ]),
  );
  const recoveryReferences =
    references.length === 0
      ? undefined
      : exportDiagnosticRecoveryReferencesV1Schema.safeParse({
          contractVersion: 1,
          locations: [...uniqueReferences.entries()]
            .sort(([left], [right]) => compareUtf16(left, right))
            .map(([, reference]) => reference),
        });
  if (
    !edgeId.valid ||
    !nodeId.valid ||
    !ownedPolicyId.valid ||
    !workloadId.valid ||
    !path.success ||
    recoveryReferences?.success === false
  ) {
    return solutionExportWorkflowDiagnosticV1Schema.parse({
      code: "cloudmarkup.export.diagnostic-invalid",
      origin: "workflow",
      severity: value.severity,
      stage,
    });
  }

  const parsed = solutionExportWorkflowDiagnosticV1Schema.safeParse({
    code: value.code,
    ...(recoveryReferences?.success
      ? { recoveryReferences: recoveryReferences.data }
      : {}),
    ...(edgeId.value === undefined ? {} : { edgeId: edgeId.value }),
    ...(nodeId.value === undefined ? {} : { nodeId: nodeId.value }),
    origin,
    ...(ownedPolicyId.value === undefined
      ? {}
      : { ownedPolicyId: ownedPolicyId.value }),
    ...(path.data === undefined ? {} : { path: path.data }),
    severity: value.severity,
    stage,
    ...(workloadId.value === undefined ? {} : { workloadId: workloadId.value }),
  });
  return parsed.success
    ? parsed.data
    : solutionExportWorkflowDiagnosticV1Schema.parse({
        code: "cloudmarkup.export.diagnostic-invalid",
        origin: "workflow",
        severity: value.severity,
        stage,
      });
}

/** Convert only known architecture configuration paths into bounded field data. */
export function diagnosticSourceReferences(source: {
  readonly document: string;
  readonly nodeId?: string | undefined;
  readonly edgeId?: string | undefined;
  readonly workloadId?: string | undefined;
  readonly path?: string | undefined;
}): ExportDiagnosticReferenceV1[] {
  const match =
    source.document === "architecture"
      ? source.path?.match(
          /^\$(?:\.(nodes|edges)\[(?:0|[1-9][0-9]{0,5})\])?\.semantic\.configuration\.values((?:\.[A-Za-z_][A-Za-z0-9_-]{0,63}|\[(?:0|[1-9][0-9]{0,3})\])+)$/u,
        )
      : null;
  const fieldPath =
    match?.[2] === undefined
      ? undefined
      : [
          ...match[2].matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)|\[([0-9]+)\]/gu),
        ].map((part) => part[1] ?? Number(part[2]));
  const references: ExportDiagnosticReferenceV1[] = [];
  const fieldOwner =
    match?.[1] ??
    (source.nodeId !== undefined && source.edgeId === undefined
      ? "nodes"
      : source.edgeId !== undefined && source.nodeId === undefined
        ? "edges"
        : undefined);
  if (source.nodeId !== undefined)
    references.push({
      kind: "node",
      id: source.nodeId,
      ...(fieldOwner === "nodes" && fieldPath !== undefined
        ? { fieldPath }
        : {}),
    });
  if (source.edgeId !== undefined)
    references.push({
      kind: "edge",
      id: source.edgeId,
      ...(fieldOwner === "edges" && fieldPath !== undefined
        ? { fieldPath }
        : {}),
    });
  if (source.workloadId !== undefined)
    references.push({ kind: "workload", id: source.workloadId });
  if (source.document === "repository" && source.path !== undefined) {
    // Validation occurs with the complete bounded reference set below.
    references.push({
      kind: "repository",
      path: source.path as Extract<
        ExportDiagnosticReferenceV1,
        { kind: "repository" }
      >["path"],
    });
  }
  return references;
}

/**
 * Retains only provenance that satisfies the public portable-path and opaque-ID
 * contracts. Invalid references collapse to one generic diagnostic rather than
 * leaking an unsafe value or silently presenting an unlinked source finding.
 */
export function mergeSanitizedWorkflowDiagnostics(
  target: SolutionExportWorkflowDiagnosticV1[],
  stage: SolutionExportWorkflowStageIdV1,
  origin: SolutionExportWorkflowDiagnosticV1["origin"],
  values: readonly SolutionExportWorkflowDiagnosticInputV1[],
): void {
  for (const value of values) {
    target.push(normalizedDiagnostic(stage, origin, value));
  }
  const unique = new Map(
    target.map(
      (diagnostic) =>
        [solutionExportWorkflowDiagnosticKey(diagnostic), diagnostic] as const,
    ),
  );
  target.splice(
    0,
    target.length,
    ...[...unique.values()]
      .sort((left, right) =>
        compareUtf16(
          solutionExportWorkflowDiagnosticKey(left),
          solutionExportWorkflowDiagnosticKey(right),
        ),
      )
      .slice(0, 256),
  );
}
