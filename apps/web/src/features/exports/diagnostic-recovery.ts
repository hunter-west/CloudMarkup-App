import {
  draftArchitectureDocumentV1Schema,
  solutionExportJobV1Schema,
  solutionRevisionV1Schema,
  type CloudMarkupClient,
} from "@cloudmarkup/api-contract";
import {
  getArchitectureDocumentContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentVisualHash,
} from "@cloudmarkup/domain";
import {
  digestCanonicalValue,
  exportDiagnosticRecoveryRequestV1Schema,
  type ArchitectureDocumentV3,
  type ExportDiagnosticReferenceV1,
  type ExportDiagnosticRecoveryRequestV1,
} from "@cloudmarkup/schemas";

export const EXPORT_DIAGNOSTIC_QUERY = "exportDiagnostic";
export function readExportDiagnosticRequest(
  search: string,
): ExportDiagnosticRecoveryRequestV1 | null {
  const raw = new URLSearchParams(search).get(EXPORT_DIAGNOSTIC_QUERY);
  if (raw === null || raw.length > 4096) return null;
  try {
    return exportDiagnosticRecoveryRequestV1Schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
export function exportDiagnosticSearch(request: unknown): string {
  const valid = exportDiagnosticRecoveryRequestV1Schema.parse(request);
  return new URLSearchParams({
    [EXPORT_DIAGNOSTIC_QUERY]: JSON.stringify(valid),
  }).toString();
}
export function diagnosticReferenceLabel(
  reference: ExportDiagnosticReferenceV1,
  document?: ArchitectureDocumentV3,
): string {
  if (reference.kind === "repository") return `File ${reference.path}`;
  const field = "fieldPath" in reference ? reference.fieldPath : undefined;
  const name =
    reference.kind === "node"
      ? document?.nodes.find((node) => node.id === reference.id)?.presentation
          .label
      : undefined;
  const resource =
    name ??
    `${reference.kind === "node" ? "Resource" : reference.kind === "edge" ? "Connection" : reference.kind === "owned-policy" ? "Permission" : "Workload"} ${reference.id}`;
  return `${resource}${
    field
      ? ` > ${field
          .map((segment) =>
            String(segment)
              .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
              .toLowerCase(),
          )
          .join(" > ")}`
      : ""
  }`;
}

export type ExportDiagnosticRecoveryResult =
  | {
      state: "current";
      reference: ExportDiagnosticReferenceV1;
      documentDigest: string;
      message: string;
    }
  | { state: "stale" | "unavailable"; message: string };
const unavailable = (): ExportDiagnosticRecoveryResult => ({
  state: "unavailable",
  message:
    "This export finding is unavailable here. Review the saved export and its recorded checks; your canvas is unchanged.",
});
const stale = (): ExportDiagnosticRecoveryResult => ({
  state: "stale",
  message:
    "This export finding refers to an older saved revision. Your current canvas is kept. Review the saved revision before changing the current design.",
});

/** Only authorized reads. A URL cannot apply commands, download or admit work. */
export async function resolveExportDiagnosticRecovery({
  client,
  projectId,
  request,
  currentDocument,
}: {
  client: CloudMarkupClient;
  projectId: string;
  request: ExportDiagnosticRecoveryRequestV1;
  currentDocument: () => ArchitectureDocumentV3 | null;
}): Promise<ExportDiagnosticRecoveryResult> {
  try {
    const parsed = exportDiagnosticRecoveryRequestV1Schema.parse(request);
    const job = solutionExportJobV1Schema.parse(
      (
        await client.request("solution-export-jobs.get", {
          path: { projectId, solutionExportJobId: parsed.jobId },
        })
      ).data,
    );
    if (
      job.projectId !== projectId ||
      job.id !== parsed.jobId ||
      job.solutionRevision.solutionRevisionId !== parsed.solutionRevisionId ||
      job.solutionRevision.manifestDigest !== parsed.manifestDigest
    )
      return unavailable();
    const recorded = job.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === parsed.code &&
        diagnostic.recoveryReferences?.locations.some(
          (reference) =>
            digestCanonicalValue(reference) ===
            digestCanonicalValue(parsed.reference),
        ),
    );
    if (!recorded) return unavailable();
    const [revisionResponse, draftResponse] = await Promise.all([
      client.request("solution-revisions.get", {
        path: { projectId, solutionRevisionId: parsed.solutionRevisionId },
      }),
      client.request("drafts.get", { path: { projectId } }),
    ]);
    const revision = solutionRevisionV1Schema.parse(revisionResponse.data);
    const draft = draftArchitectureDocumentV1Schema.parse(draftResponse.data);
    if (
      revision.summary.projectId !== projectId ||
      revision.summary.solutionRevisionId !== parsed.solutionRevisionId ||
      draft.projectId !== projectId ||
      digestCanonicalValue(revision.manifest) !== parsed.manifestDigest
    )
      return unavailable();
    const document = currentDocument();
    if (document === null) return unavailable();
    const expected = revision.summary.documentDigest;
    if (
      draft.storageStatus === "publication-pending" ||
      draft.id !== revision.summary.sourceDraftId ||
      draft.version !== revision.summary.sourceDraftVersion ||
      getArchitectureDocumentCanonicalHash(document) !== expected ||
      getArchitectureDocumentCanonicalHash(draft.architectureDocument) !==
        expected ||
      getArchitectureDocumentCanonicalHash(
        revision.revision.architectureDocument,
      ) !== expected ||
      getArchitectureDocumentContentHash(document) !==
        revision.summary.contentDigest ||
      getArchitectureDocumentVisualHash(document) !==
        revision.summary.visualDigest ||
      (draft.documentDigest !== undefined && draft.documentDigest !== expected)
    )
      return stale();
    const ref = parsed.reference;
    if (ref.kind !== "node" && ref.kind !== "edge")
      return {
        state: "unavailable",
        message: `${diagnosticReferenceLabel(ref)} is recorded for this revision. Use its dedicated editor or recorded file checks; exact canvas focus is unavailable.`,
      };
    const exists =
      ref.kind === "node"
        ? document.nodes.some((node) => node.id === ref.id)
        : document.edges.some((edge) => edge.id === ref.id);
    if (!exists) return unavailable();
    return {
      state: "current",
      reference: ref,
      documentDigest: expected,
      message: `The saved export and current canvas match. Review ${diagnosticReferenceLabel(ref, document)}.`,
    };
  } catch {
    return unavailable();
  }
}

export function exportDiagnosticTargetId(
  reference: ExportDiagnosticReferenceV1,
): string | null {
  if (reference.kind !== "node" && reference.kind !== "edge") return null;
  return reference.fieldPath
    ? `inspector-configuration-${reference.kind}-${reference.id}-${reference.fieldPath.join(".")}`
    : `validation-architecture-${reference.kind}-${reference.id}`;
}
