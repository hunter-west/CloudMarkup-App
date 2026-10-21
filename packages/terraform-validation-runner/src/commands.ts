import { namespacedIdentifierSchema } from "@cloudmarkup/schemas";

import type {
  TerraformValidationDiagnosticV1,
  TerraformValidationFileV1,
  TerraformValidationReferenceV1,
  TerraformValidationCommandSummaryV1,
  ValidationCommandInvocation,
  ValidationCommandResult,
} from "./contracts.js";
import {
  compareUtf16,
  referencesForPath,
  sanitizeToolText,
} from "./security.js";

export const APPROVED_VALIDATION_COMMANDS = Object.freeze({
  fmt: {
    args: ["fmt", "-check", "-recursive", "-no-color", "."],
    executable: "terraform",
    step: "fmt",
  },
  init: {
    args: [
      "init",
      "-backend=false",
      "-get=false",
      "-input=false",
      "-lockfile=readonly",
      "-no-color",
    ],
    executable: "terraform",
    step: "init",
  },
  scanner: {
    args: [
      "config",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--quiet",
      "--disable-telemetry",
      "--skip-version-check",
      "--skip-check-update",
      ".",
    ],
    executable: "trivy",
    step: "scanner",
  },
  tflint: {
    args: ["--chdir=.", "--format=json", "--no-color", "--force"],
    executable: "tflint",
    step: "tflint",
  },
  validate: {
    args: ["validate", "-json", "-no-color"],
    executable: "terraform",
    step: "validate",
  },
} as const satisfies Readonly<Record<string, ValidationCommandInvocation>>);

const approvedByStep = new Map(
  Object.values(APPROVED_VALIDATION_COMMANDS).map(
    (command) => [command.step, command] as const,
  ),
);

export function isApprovedInvocation(
  invocation: ValidationCommandInvocation,
): boolean {
  const approved = approvedByStep.get(invocation.step);
  return (
    invocation.executable === approved?.executable &&
    invocation.args.length === approved.args.length &&
    invocation.args.every(
      (argument, index) => argument === approved.args[index],
    )
  );
}

function baseReferences(
  solutionRevisionId: string,
): TerraformValidationReferenceV1 {
  return {
    edgeIds: [],
    nodeIds: [],
    ownedPolicyIds: [],
    solutionRevisionId:
      solutionRevisionId as TerraformValidationReferenceV1["solutionRevisionId"],
  };
}

function diagnostic(
  input: {
    readonly code: string;
    readonly detail: string;
    readonly path?: string;
    readonly severity: "error" | "warning" | "info";
    readonly source: TerraformValidationDiagnosticV1["source"];
    readonly summary: string;
  },
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): TerraformValidationDiagnosticV1 {
  const linked = referencesForPath(files, input.path, solutionRevisionId);
  return {
    code: namespacedIdentifierSchema.parse(input.code),
    detail: sanitizeToolText(input.detail),
    ...(linked.path === undefined ? {} : { path: linked.path }),
    references: linked.references,
    severity: input.severity,
    source: input.source,
    summary: sanitizeToolText(input.summary, 500),
  };
}

export function commandSummary(
  invocation: ValidationCommandInvocation,
  result: ValidationCommandResult,
): TerraformValidationCommandSummaryV1 {
  const state =
    result.termination === "completed"
      ? result.exitCode === 0
        ? "passed"
        : "failed"
      : result.termination;
  return {
    executable: invocation.executable,
    outputBytes: result.outputBytes,
    state,
    step: invocation.step,
  };
}

export function terminationDiagnostics(
  invocation: ValidationCommandInvocation,
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  if (result.termination === "completed") return [];
  const severity = result.termination === "unavailable" ? "warning" : "error";
  const detailByTermination = {
    cancelled: "Validation command was cancelled.",
    "output-limit": "Validation command exceeded its output byte limit.",
    timeout: "Validation command exceeded its wall-time limit.",
    unavailable: "Approved optional validation tool is unavailable.",
  } as const;
  const detail = detailByTermination[result.termination];
  return [
    diagnostic(
      {
        code: `terraform.validation.command-${result.termination}`,
        detail,
        severity,
        source:
          invocation.step === "scanner"
            ? "scanner"
            : invocation.step === "tflint"
              ? "tflint"
              : `terraform-${invocation.step}`,
        summary: detail,
      },
      files,
      solutionRevisionId,
    ),
  ];
}

export function parseFmtResult(
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  if (result.termination !== "completed" || result.exitCode === 0) return [];
  const paths = result.stdout
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 256);
  if (paths.length === 0) {
    return [
      diagnostic(
        {
          code: "terraform.validation.fmt-failed",
          detail: "Terraform formatting check failed without a safe file list.",
          severity: "error",
          source: "terraform-fmt",
          summary: "Terraform formatting check failed.",
        },
        files,
        solutionRevisionId,
      ),
    ];
  }
  return paths.map((path) =>
    diagnostic(
      {
        code: "terraform.validation.fmt-required",
        detail: "Terraform source is not in canonical format.",
        path,
        severity: "error",
        source: "terraform-fmt",
        summary: "Terraform source requires formatting.",
      },
      files,
      solutionRevisionId,
    ),
  );
}

export function parseInitResult(
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  if (result.termination !== "completed" || result.exitCode === 0) return [];
  return [
    diagnostic(
      {
        code: "terraform.validation.init-failed",
        detail: sanitizeToolText(result.stderr || result.stdout),
        severity: "error",
        source: "terraform-init",
        summary: "Offline Terraform initialization failed.",
      },
      files,
      solutionRevisionId,
    ),
  ];
}

interface TerraformValidateDiagnostic {
  readonly detail?: unknown;
  readonly range?: { readonly filename?: unknown };
  readonly severity?: unknown;
  readonly summary?: unknown;
}

export function parseValidateResult(
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  if (result.termination !== "completed") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { readonly diagnostics?: unknown }).diagnostics)
  ) {
    return [
      diagnostic(
        {
          code: "terraform.validation.diagnostics-malformed",
          detail: "Terraform validate returned malformed JSON diagnostics.",
          severity: "error",
          source: "terraform-validate",
          summary: "Terraform validate diagnostics are malformed.",
        },
        files,
        solutionRevisionId,
      ),
    ];
  }
  const rawDiagnostics = (
    parsed as { readonly diagnostics: readonly TerraformValidateDiagnostic[] }
  ).diagnostics;
  const diagnostics = rawDiagnostics.slice(0, 1_000).map((entry) => {
    const severity = entry.severity === "warning" ? "warning" : "error";
    const summary =
      typeof entry.summary === "string"
        ? entry.summary
        : "Terraform validation failed.";
    const detail = typeof entry.detail === "string" ? entry.detail : summary;
    const path =
      typeof entry.range?.filename === "string"
        ? entry.range.filename
        : undefined;
    return diagnostic(
      {
        code: "terraform.validation.validate-diagnostic",
        detail,
        ...(path === undefined ? {} : { path }),
        severity,
        source: "terraform-validate",
        summary,
      },
      files,
      solutionRevisionId,
    );
  });
  if (result.exitCode !== 0 && diagnostics.length === 0) {
    diagnostics.push(
      diagnostic(
        {
          code: "terraform.validation.validate-failed",
          detail: "Terraform validation failed without a bounded diagnostic.",
          severity: "error",
          source: "terraform-validate",
          summary: "Terraform validation failed.",
        },
        files,
        solutionRevisionId,
      ),
    );
  }
  return diagnostics;
}

function parseJsonAnalyzer(
  source: "tflint" | "scanner",
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  if (result.termination !== "completed") return [];
  if (result.exitCode !== 0) {
    return [
      diagnostic(
        {
          code: "terraform.validation.analyzer-failed",
          detail:
            source +
            " exited nonzero despite its fixed finding-only success configuration.",
          severity: "error",
          source,
          summary: source + " failed before completing static analysis.",
        },
        files,
        solutionRevisionId,
      ),
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [
      diagnostic(
        {
          code: "terraform.validation.diagnostics-malformed",
          detail: `${source} returned malformed JSON diagnostics.`,
          severity: "error",
          source,
          summary: `${source} diagnostics are malformed.`,
        },
        files,
        solutionRevisionId,
      ),
    ];
  }
  const candidates =
    source === "tflint"
      ? (parsed as { readonly issues?: unknown }).issues
      : (parsed as { readonly Results?: unknown }).Results;
  if (!Array.isArray(candidates)) {
    return [
      diagnostic(
        {
          code: "terraform.validation.diagnostics-malformed",
          detail: `${source} returned an invalid diagnostic collection.`,
          severity: "error",
          source,
          summary: `${source} diagnostics are malformed.`,
        },
        files,
        solutionRevisionId,
      ),
    ];
  }
  const findings = Array.isArray(candidates) ? candidates.slice(0, 1_000) : [];
  return findings.map((candidate) => {
    const record =
      typeof candidate === "object" && candidate !== null
        ? (candidate as Record<string, unknown>)
        : {};
    const message =
      typeof record["message"] === "string"
        ? record["message"]
        : typeof record["Message"] === "string"
          ? record["Message"]
          : `${source} reported a policy finding.`;
    const range =
      typeof record["range"] === "object" && record["range"] !== null
        ? (record["range"] as Record<string, unknown>)
        : {};
    const path =
      typeof range["filename"] === "string"
        ? range["filename"]
        : typeof record["Target"] === "string"
          ? record["Target"]
          : undefined;
    return diagnostic(
      {
        code: `terraform.validation.${source}-finding`,
        detail: message,
        ...(path === undefined ? {} : { path }),
        severity: "warning",
        source,
        summary: `${source} reported a static-analysis finding.`,
      },
      files,
      solutionRevisionId,
    );
  });
}

export function parseTflintResult(
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  return parseJsonAnalyzer("tflint", result, files, solutionRevisionId);
}

export function parseScannerResult(
  result: ValidationCommandResult,
  files: readonly TerraformValidationFileV1[],
  solutionRevisionId: string,
): readonly TerraformValidationDiagnosticV1[] {
  return parseJsonAnalyzer("scanner", result, files, solutionRevisionId);
}

export function sortDiagnostics(
  diagnostics: readonly TerraformValidationDiagnosticV1[],
): TerraformValidationDiagnosticV1[] {
  return [...diagnostics].sort((left, right) => {
    for (const pair of [
      [left.severity, right.severity],
      [left.source, right.source],
      [left.path ?? "", right.path ?? ""],
      [left.code, right.code],
      [left.summary, right.summary],
    ] as const) {
      const compared = compareUtf16(pair[0], pair[1]);
      if (compared !== 0) return compared;
    }
    return 0;
  });
}

export function runnerDiagnostic(
  code: string,
  summary: string,
  solutionRevisionId: string,
  severity: "error" | "warning" | "info" = "error",
): TerraformValidationDiagnosticV1 {
  return {
    code: namespacedIdentifierSchema.parse(code),
    detail: summary,
    references: baseReferences(solutionRevisionId),
    severity,
    source: "runner",
    summary,
  };
}
