import {
  architectureDocumentV2Schema,
  architectureDocumentV3Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import {
  sha256Digest,
  solutionExportSupplementalFileV1Schema,
  type SolutionExportSupplementalFileV1,
} from "@cloudmarkup/solution-export";
import type { SolutionExportCompilerPort } from "./ports.js";

/** Eligibility describes the immutable source; it never changes workload intent. */
export function supportsInfrastructureOnlyDelivery(document: unknown): boolean {
  const current = architectureDocumentV3Schema.safeParse(document);
  const parsed = current.success
    ? current
    : architectureDocumentV2Schema.safeParse(document);
  return (
    parsed.success &&
    parsed.data.workloadBehavior.workloads.every(
      (workload) =>
        workload.implementation.mode === "infrastructure-only" ||
        workload.implementation.mode === "complete-supported-pattern",
    )
  );
}

/** Recheck resolved bytes independently of the API's verified admission metadata. */
export function infrastructureOnlyDeliveryInputsMatch(
  input: Parameters<SolutionExportCompilerPort["compile"]>[0],
): boolean {
  if (
    input.request.applicationDelivery !== "infrastructure-only-v1" ||
    input.request.applicationSource !== undefined ||
    input.request.targetProfileId !==
      "cloudmarkup.export.cloudformation-nodejs24-v1" ||
    input.request.targetSettings.target !== "cloudformation" ||
    input.request.sources.applicationBuildInputs !== undefined ||
    input.sources.applicationBuildInputs !== undefined ||
    !supportsInfrastructureOnlyDelivery(input.sources.architectureDocument)
  )
    return false;
  const current = architectureDocumentV3Schema.safeParse(
    input.sources.architectureDocument,
  );
  const parsed = current.success
    ? current
    : architectureDocumentV2Schema.safeParse(
        input.sources.architectureDocument,
      );
  if (!parsed.success) return false;
  try {
    return (
      serializeCanonicalJson(parsed.data.workloadBehavior) ===
      serializeCanonicalJson(input.sources.workloadBehavior)
    );
  } catch {
    return false;
  }
}

/** Digest-bound package evidence states omitted stages without claiming deployable code. */
export function infrastructureOnlyDeliveryFiles(
  input: Parameters<SolutionExportCompilerPort["compile"]>[0],
): readonly SolutionExportSupplementalFileV1[] {
  const content =
    "# Infrastructure export\n\n" +
    "Delivery selection: `infrastructure-only-v1`.\n\n" +
    "The saved architecture, workload modes, application contracts, and Solution Revision are preserved. " +
    "Application source generation, AI source generation, and application builds were not run. " +
    "Lambda application code is still required: provide and upload the reviewed application ZIP, " +
    "then supply its bucket, key, object version, and SHA-256 parameters before deploying the template. " +
    "This package does not deploy infrastructure or claim a complete application.\n\n" +
    `Solution Revision: \`${input.request.subject.solutionRevisionId}\`.\n\n` +
    `Workflow request: \`${sha256Digest(serializeCanonicalJson(input.request))}\`.\n`;
  return [
    solutionExportSupplementalFileV1Schema.parse({
      path: "cloudmarkup/INFRASTRUCTURE_EXPORT.md",
      content: { encoding: "utf8", value: content },
      checksum: sha256Digest(content),
      semanticChecksum: sha256Digest(content),
      kind: "regular-file",
      mediaType: "text/markdown",
      ownership: "evidence-artifact",
      provenance: {
        producer: {
          id: "cloudmarkup.infrastructure-delivery",
          version: "1.0.0",
          digest: sha256Digest("cloudmarkup.infrastructure-delivery.v1"),
        },
        solutionRevisionId: input.request.subject.solutionRevisionId,
        sourceReferences: [
          {
            id: input.request.subject.solutionRevisionId,
            kind: "solution-revision",
          },
        ],
      },
    }),
  ];
}
