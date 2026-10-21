import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDiagramIconSetV1 } from "@cloudmarkup/diagram-export";
import { createAwsDiagramIconRegistryTestInput } from "@cloudmarkup/provider-aws/testing/diagram-icon-registry";
import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";
import type {
  terraformValidationRequestFromWorkflowInput,
  SolutionExportWorkflowStageDescriptorsV1,
} from "@cloudmarkup/solution-export-workflow";
import { canonicalBytes } from "@cloudmarkup/solution-export-workflow/testing";
import type { TerraformValidationResultV1 } from "@cloudmarkup/terraform-validation-runner";

// Synthetic results exercise adapter bindings only; no actual Terraform process is claimed.
export const exportTerminalIconRegistry =
  createAwsDiagramIconRegistryTestInput();
export const exportTerminalIconSet = createDiagramIconSetV1({
  assetsByFile: Object.fromEntries(
    Object.entries(exportTerminalIconRegistry.assetSpecifiersByFile).map(
      ([file, specifier]) => [
        file,
        readFileSync(fileURLToPath(import.meta.resolve(specifier)), "utf8"),
      ],
    ),
  ),
  catalog: exportTerminalIconRegistry.catalog,
  manifest: exportTerminalIconRegistry.manifest,
});
export function syntheticBoundValidationResult(
  request: ReturnType<typeof terraformValidationRequestFromWorkflowInput>,
  settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
): TerraformValidationResultV1 {
  const reportBytes = canonicalBytes({
    commandSummaries: [],
    diagnostics: [],
  });
  const reportDigest = sha256Digest(reportBytes);
  const common = {
    contractVersion: 1 as const,
    environment: request.environment,
    layer: "generated" as const,
    level: {
      kind: "deterministic-target-compilation" as const,
      rank: 3 as const,
    },
    models: [],
    solutionRevisionId: request.solutionRevisionId,
    staleness: { assessedAt: request.assessedAt, state: "current" as const },
  };
  const compilation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: request.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.terraform-artifact+json",
        sizeBytes: request.files.reduce(
          (sum, file) =>
            sum + new TextEncoder().encode(file.content).byteLength,
          0,
        ),
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest],
        checkId:
          "cloudmarkup.evidence.deterministic-infrastructure-compilation",
        generationCoverageRequirement:
          "deterministic-infrastructure-compilation",
        issueIds: [],
        status: "passed",
        summary:
          "The exact Terraform artifact is bound to the approved deterministic compiler output.",
      },
    ],
    id: `evidence_iac_compilation_${request.artifactDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: request.compiler },
      createdAt: request.assessedAt,
      inputDigests: [request.solutionRevisionDigest, request.artifactDigest],
    },
    tools: [request.compiler],
  });
  const staticValidation = evidenceRecordV1Schema.parse({
    ...common,
    artifacts: [
      {
        digest: reportDigest,
        mediaType: "application/json",
        sizeBytes: reportBytes.byteLength,
      },
    ],
    checks: [
      {
        artifactDigests: [request.artifactDigest, reportDigest],
        checkId: "cloudmarkup.evidence.terraform-static-validation",
        issueIds: [],
        status: "passed",
        summary:
          "Offline Terraform formatting, initialization, validation, and approved policy checks passed.",
      },
    ],
    id: `evidence_terraform_static_${reportDigest.slice(7, 31)}`,
    provenance: {
      actor: { kind: "deterministic-tool", tool: settings.adapter },
      createdAt: request.assessedAt,
      inputDigests: [
        request.solutionRevisionDigest,
        request.artifactDigest,
        sha256Digest(serializeCanonicalJson(request)),
        settings.policyDigest,
      ].sort(),
    },
    tools: [settings.adapter],
  });
  return {
    commandSummaries: [],
    contractVersion: 1 as const,
    diagnostics: [],
    evidenceRecords: [compilation, staticValidation],
    reportDigest,
    state: "passed" as const,
  };
}
