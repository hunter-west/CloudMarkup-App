import {
  terraformValidationRequestV1Schema,
  terraformValidationResultV1Schema,
  type TerraformValidationRequestV1,
  type TerraformValidationResultV1,
  type TerraformValidationRunner,
} from "@cloudmarkup/terraform-validation-runner";
import {
  serializeCanonicalJson,
  solutionRevisionManifestV1Schema,
} from "@cloudmarkup/schemas";
import { sha256Digest } from "@cloudmarkup/solution-export";

import {
  solutionExportWorkflowFailureV1Schema,
  solutionExportWorkflowRequestV1Schema,
  solutionExportWorkflowStageDescriptorsV1Schema,
  type SolutionExportWorkflowStageDescriptorsV1,
} from "./contracts.js";
import {
  canonicalEqual,
  resolvedJsonMatchesReference,
} from "./canonical-json.js";
import { SolutionExportWorkflowFailureError } from "./orchestrator.js";
import type { SolutionExportTerraformValidationPort } from "./ports.js";

export interface SolutionExportTerraformValidationPortDependencies {
  readonly approvedSettings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"];
  readonly runner: TerraformValidationRunner;
}

function failure(
  code: string,
  publicMessage:
    | "export-input-invalid"
    | "export-validation-failed" = "export-input-invalid",
): SolutionExportWorkflowFailureError {
  return new SolutionExportWorkflowFailureError(
    solutionExportWorkflowFailureV1Schema.parse({
      classification: "permanent",
      code,
      publicMessage,
      stage: "validate-infrastructure",
    }),
  );
}

function abortError(): Error {
  const error = new Error("Terraform validation was canceled.");
  error.name = "AbortError";
  return error;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
}

function totalFileBytes(files: TerraformValidationRequestV1["files"]): number {
  const encoder = new TextEncoder();
  return files.reduce(
    (sum, file) => sum + encoder.encode(file.content).byteLength,
    0,
  );
}

function reportBytes(result: TerraformValidationResultV1): Uint8Array {
  return new TextEncoder().encode(
    serializeCanonicalJson({
      commandSummaries: result.commandSummaries,
      diagnostics: result.diagnostics,
    }),
  );
}

function evidenceCommonBindsRequest(
  record: TerraformValidationResultV1["evidenceRecords"][number],
  request: TerraformValidationRequestV1,
): boolean {
  return (
    record.ciIdentity === undefined &&
    canonicalEqual(record.environment, request.environment) &&
    record.layer === "generated" &&
    canonicalEqual(record.level, {
      kind: "deterministic-target-compilation",
      rank: 3,
    }) &&
    record.models.length === 0 &&
    record.solutionRevisionId === request.solutionRevisionId &&
    canonicalEqual(record.staleness, {
      assessedAt: request.assessedAt,
      state: "current",
    }) &&
    record.provenance.createdAt === request.assessedAt
  );
}

function deterministicActorMatches(
  record: TerraformValidationResultV1["evidenceRecords"][number],
  tool: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"]["adapter"],
): boolean {
  return (
    record.provenance.actor.kind === "deterministic-tool" &&
    canonicalEqual(record.provenance.actor.tool, tool)
  );
}

function compilationEvidenceBindsRequest(
  record: TerraformValidationResultV1["evidenceRecords"][number],
  request: TerraformValidationRequestV1,
): boolean {
  return (
    evidenceCommonBindsRequest(record, request) &&
    record.id ===
      `evidence_iac_compilation_${request.artifactDigest.slice(7, 31)}` &&
    deterministicActorMatches(record, request.compiler) &&
    canonicalEqual(record.artifacts, [
      {
        digest: request.artifactDigest,
        mediaType: "application/vnd.cloudmarkup.terraform-artifact+json",
        sizeBytes: totalFileBytes(request.files),
      },
    ]) &&
    canonicalEqual(record.checks, [
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
    ]) &&
    canonicalEqual(record.provenance.inputDigests, [
      request.solutionRevisionDigest,
      request.artifactDigest,
    ]) &&
    canonicalEqual(record.tools, [request.compiler])
  );
}

function staticValidationEvidenceBindsRequest(
  record: TerraformValidationResultV1["evidenceRecords"][number],
  request: TerraformValidationRequestV1,
  result: TerraformValidationResultV1,
  settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
  exactReportBytes: Uint8Array,
): boolean {
  const validationPassed = result.state === "passed";
  const inputDigests = record.provenance.inputDigests;
  const tools = record.tools;
  const expectedInputDigests = [
    request.solutionRevisionDigest,
    request.artifactDigest,
    sha256Digest(serializeCanonicalJson(request)),
    settings.policyDigest,
  ];
  const issueIds = uniqueSorted(
    result.diagnostics
      .filter(({ severity }) => severity !== "info")
      .map(({ code }) => code),
  );
  const expectedCheck = {
    artifactDigests: [request.artifactDigest, result.reportDigest],
    checkId: "cloudmarkup.evidence.terraform-static-validation",
    issueIds,
    ...(validationPassed
      ? {}
      : {
          redactedFailure:
            result.state === "cancelled"
              ? "Static validation was cancelled."
              : "One or more bounded static validation checks did not pass.",
        }),
    status: validationPassed
      ? ("passed" as const)
      : result.state === "error" || result.state === "cancelled"
        ? ("error" as const)
        : ("failed" as const),
    summary: validationPassed
      ? "Offline Terraform formatting, initialization, validation, and approved policy checks passed."
      : "Offline Terraform static validation did not pass.",
  };
  return (
    evidenceCommonBindsRequest(record, request) &&
    record.id ===
      `evidence_terraform_static_${result.reportDigest.slice(7, 31)}` &&
    deterministicActorMatches(record, settings.adapter) &&
    canonicalEqual(record.artifacts, [
      {
        digest: result.reportDigest,
        mediaType: "application/json",
        sizeBytes: exactReportBytes.byteLength,
      },
    ]) &&
    canonicalEqual(record.checks, [expectedCheck]) &&
    canonicalEqual(inputDigests, uniqueSorted(inputDigests)) &&
    expectedInputDigests.every((digest) => inputDigests.includes(digest)) &&
    tools.length > 0 &&
    tools.every(({ digest }) => digest !== undefined) &&
    canonicalEqual(
      tools,
      [...tools].sort((left, right) =>
        left.id === right.id ? 0 : left.id < right.id ? -1 : 1,
      ),
    ) &&
    new Set(tools.map((tool) => serializeCanonicalJson(tool))).size ===
      tools.length &&
    tools.some((tool) => canonicalEqual(tool, settings.adapter))
  );
}

function validationResultBindsRequest(
  result: TerraformValidationResultV1,
  request: TerraformValidationRequestV1,
  settings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
): boolean {
  const exactReportBytes = reportBytes(result);
  const [compilationEvidence, staticValidationEvidence] =
    result.evidenceRecords;
  return (
    sha256Digest(exactReportBytes) === result.reportDigest &&
    result.evidenceRecords.length === 2 &&
    compilationEvidence !== undefined &&
    staticValidationEvidence !== undefined &&
    compilationEvidenceBindsRequest(compilationEvidence, request) &&
    staticValidationEvidenceBindsRequest(
      staticValidationEvidence,
      request,
      result,
      settings,
      exactReportBytes,
    )
  );
}

/** Build the strict Terraform validation request only from verified compiler output. */
export function terraformValidationRequestFromWorkflowInput(
  input: Parameters<SolutionExportTerraformValidationPort["validate"]>[0],
  approvedSettings: SolutionExportWorkflowStageDescriptorsV1["terraformValidation"],
): TerraformValidationRequestV1 {
  const parsedWorkflowRequest = solutionExportWorkflowRequestV1Schema.safeParse(
    input.request,
  );
  const parsedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.terraformValidation.safeParse(
      input.settings,
    );
  const parsedApprovedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.terraformValidation.safeParse(
      approvedSettings,
    );
  const parsedSolutionRevision = solutionRevisionManifestV1Schema.safeParse(
    input.sources.solutionRevision,
  );
  if (
    !parsedWorkflowRequest.success ||
    !parsedSettings.success ||
    !parsedApprovedSettings.success ||
    !parsedSolutionRevision.success
  ) {
    throw failure("cloudmarkup.export.validation-input-invalid");
  }

  const workflowRequest = parsedWorkflowRequest.data;
  const settings = parsedSettings.data;
  const stageDescriptors = workflowRequest.targetSettings.stageDescriptors;
  if (!("terraformValidation" in stageDescriptors)) {
    throw failure("cloudmarkup.export.validation-input-binding-invalid");
  }

  const solutionRevision = parsedSolutionRevision.data;
  if (
    !resolvedJsonMatchesReference(
      solutionRevision,
      workflowRequest.sources.solutionRevision,
    ) ||
    !canonicalEqual(settings, parsedApprovedSettings.data) ||
    !canonicalEqual(settings, stageDescriptors.terraformValidation) ||
    solutionRevision.solutionRevisionId !==
      workflowRequest.subject.solutionRevisionId ||
    input.infrastructure.solutionRevisionId !==
      solutionRevision.solutionRevisionId
  ) {
    throw failure("cloudmarkup.export.validation-input-binding-invalid");
  }

  const files = input.infrastructure.files
    .filter(
      ({ mediaType, path }) =>
        mediaType === "application/vnd.hashicorp.terraform" &&
        path.startsWith("infrastructure/") &&
        path.endsWith(".tf"),
    )
    .map((file) => ({
      checksum: file.checksum,
      content: file.content,
      path: file.path,
      references: {
        edgeIds: uniqueSorted(
          file.provenance.sourceReferences
            .filter(({ kind }) => kind === "edge")
            .map(({ id }) => id),
        ),
        nodeIds: uniqueSorted(
          file.provenance.sourceReferences
            .filter(({ kind }) => kind === "resource")
            .map(({ id }) => id),
        ),
        ownedPolicyIds: uniqueSorted(
          file.provenance.sourceReferences
            .filter(({ kind }) => kind === "policy")
            .map(({ id }) => id),
        ),
        solutionRevisionId: solutionRevision.solutionRevisionId,
      },
    }));
  const parsed = terraformValidationRequestV1Schema.safeParse({
    artifactDigest: input.infrastructure.artifactDigest,
    assessedAt: solutionRevision.createdAt,
    compiler: input.infrastructure.compiler,
    contractVersion: 1,
    environment: workflowRequest.environment,
    files,
    solutionRevisionDigest: sha256Digest(
      serializeCanonicalJson(solutionRevision),
    ),
    solutionRevisionId: solutionRevision.solutionRevisionId,
  });
  if (!parsed.success) {
    throw failure("cloudmarkup.export.validation-input-invalid");
  }
  return parsed.data;
}

/** Connect the workflow to one preconfigured offline Terraform runner. */
export function createSolutionExportTerraformValidationPort(
  dependencies: SolutionExportTerraformValidationPortDependencies,
): SolutionExportTerraformValidationPort & {
  validate(
    input: Parameters<SolutionExportTerraformValidationPort["validate"]>[0],
  ): Promise<TerraformValidationResultV1>;
} {
  const approvedSettings =
    solutionExportWorkflowStageDescriptorsV1Schema.shape.terraformValidation.parse(
      dependencies.approvedSettings,
    );
  return {
    async validate(input) {
      if (input.signal.aborted) throw abortError();
      const request = terraformValidationRequestFromWorkflowInput(
        input,
        approvedSettings,
      );
      const rawResult = await dependencies.runner.run(request, {
        signal: input.signal,
      });
      const parsed = terraformValidationResultV1Schema.safeParse(rawResult);
      if (!parsed.success) {
        throw failure(
          "cloudmarkup.export.validation-result-invalid",
          "export-validation-failed",
        );
      }
      if (!validationResultBindsRequest(parsed.data, request, input.settings)) {
        throw failure(
          "cloudmarkup.export.validation-result-binding-invalid",
          "export-validation-failed",
        );
      }
      return parsed.data;
    },
  };
}
