import type { EvidenceRecordV1 } from "@cloudmarkup/schemas";

import {
  solutionExportWorkflowEvidenceSemanticsV1Schema,
  type SolutionExportWorkflowEvidenceSemanticsV1,
} from "./contracts.js";

const APPLICATION_BUILD_CHECKS = [
  {
    checkId: "cloudmarkup.evidence.application-build-and-tests",
    generationCoverageRequirement: "application-build-and-tests",
  },
  {
    checkId: "cloudmarkup.evidence.application-security-checks",
    generationCoverageRequirement: "application-security-checks",
  },
] as const;
const INFRASTRUCTURE_COMPILATION_CHECK =
  "cloudmarkup.evidence.deterministic-infrastructure-compilation";
const CLOUDFORMATION_VALIDATION_CHECK =
  "cloudmarkup.evidence.cloudformation-local-structural-validation";
const TERRAFORM_VALIDATION_CHECK =
  "cloudmarkup.evidence.terraform-static-validation";

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function publicStatus(
  checks: EvidenceRecordV1["checks"],
): SolutionExportWorkflowEvidenceSemanticsV1["status"] {
  if (checks.some(({ status }) => status === "failed" || status === "error")) {
    return "failed";
  }
  return checks.every(({ status }) => status === "passed")
    ? "passed"
    : "incomplete";
}
function exactStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const sortedActual = [...actual].sort(compareUtf16);
  const sortedExpected = [...expected].sort(compareUtf16);
  return (
    sortedActual.length === sortedExpected.length &&
    sortedActual.every((value, index) => value === sortedExpected[index])
  );
}

function hasAdmissibleApplicationBuildChecks(
  record: EvidenceRecordV1,
): boolean {
  const artifactDigests = record.artifacts.map(({ digest }) => String(digest));
  if (
    record.checks.length === 0 ||
    record.checks.length > APPLICATION_BUILD_CHECKS.length ||
    !record.checks.some(
      ({ checkId }) => String(checkId) === APPLICATION_BUILD_CHECKS[0].checkId,
    )
  ) {
    return false;
  }
  return record.checks.every((check) => {
    const descriptor = APPLICATION_BUILD_CHECKS.find(
      ({ checkId }) => checkId === String(check.checkId),
    );
    return (
      descriptor !== undefined &&
      check.generationCoverageRequirement ===
        descriptor.generationCoverageRequirement &&
      exactStringSet(check.artifactDigests.map(String), artifactDigests) &&
      (check.status !== "passed" || check.issueIds.length === 0)
    );
  });
}

function hasCompleteApplicationBuildChecks(record: EvidenceRecordV1): boolean {
  return (
    hasAdmissibleApplicationBuildChecks(record) &&
    exactStringSet(
      record.checks.map(({ checkId }) => String(checkId)),
      APPLICATION_BUILD_CHECKS.map(({ checkId }) => checkId),
    )
  );
}

function applicationBuildStatus(
  record: EvidenceRecordV1,
): SolutionExportWorkflowEvidenceSemanticsV1["status"] {
  const status = publicStatus(record.checks);
  return status !== "passed" || hasCompleteApplicationBuildChecks(record)
    ? status
    : "incomplete";
}

/** Derive immutable public semantics only from exact reviewed Evidence checks. */
export function solutionExportWorkflowEvidenceSemantics(
  record: EvidenceRecordV1,
): SolutionExportWorkflowEvidenceSemanticsV1 {
  const checkIds = record.checks
    .map(({ checkId }) => String(checkId))
    .sort(compareUtf16);
  const kind = hasAdmissibleApplicationBuildChecks(record)
    ? ("application-build" as const)
    : checkIds.length === 1 && checkIds[0] === INFRASTRUCTURE_COMPILATION_CHECK
      ? ("infrastructure-compilation" as const)
      : checkIds.length === 1 && checkIds[0] === CLOUDFORMATION_VALIDATION_CHECK
        ? ("cloudformation-validation" as const)
        : checkIds.length === 1 && checkIds[0] === TERRAFORM_VALIDATION_CHECK
          ? ("terraform-validation" as const)
          : undefined;
  if (kind === undefined) {
    throw new TypeError(
      "Evidence does not carry one exact approved workflow check family.",
    );
  }
  return solutionExportWorkflowEvidenceSemanticsV1Schema.parse({
    evidenceId: record.id,
    kind,
    status:
      kind === "application-build"
        ? applicationBuildStatus(record)
        : publicStatus(record.checks),
  });
}

export function sortSolutionExportWorkflowEvidenceSemantics(
  values: readonly SolutionExportWorkflowEvidenceSemanticsV1[],
): SolutionExportWorkflowEvidenceSemanticsV1[] {
  const byId = new Map(
    values.map((value) => [value.evidenceId, value] as const),
  );
  if (byId.size !== values.length) {
    throw new TypeError("Workflow Evidence semantics IDs must be unique.");
  }
  return [...byId.values()].sort((left, right) =>
    compareUtf16(left.evidenceId, right.evidenceId),
  );
}
