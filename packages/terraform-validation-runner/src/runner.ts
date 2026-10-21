import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
  type EvidenceRecordV1,
} from "@cloudmarkup/schemas";

import {
  APPROVED_VALIDATION_COMMANDS,
  commandSummary,
  parseFmtResult,
  parseInitResult,
  parseScannerResult,
  parseTflintResult,
  parseValidateResult,
  runnerDiagnostic,
  sortDiagnostics,
  terminationDiagnostics,
} from "./commands.js";
import {
  terraformValidationPolicyV1Schema,
  terraformValidationDiagnosticV1Schema,
  terraformValidationRequestV1Schema,
  terraformValidationResultV1Schema,
  type OrganizationPolicyEvaluator,
  type TerraformValidationCommandSummaryV1,
  type TerraformValidationDiagnosticV1,
  type TerraformValidationFileV1,
  type TerraformValidationPolicyV1,
  type TerraformValidationRequestV1,
  type TerraformValidationResultV1,
  type TerraformValidationRunner,
  type ValidationCommandInvocation,
  type ValidationCommandResult,
  type ValidationToolPinV1,
  type ValidationWorkspaceExecutor,
  type ValidationWorkspaceSession,
} from "./contracts.js";
import {
  canonicalDigest,
  compareUtf16,
  sha256,
  validateTerraformAiExtensionInput,
  validateInputFiles,
} from "./security.js";

export interface TerraformValidationRunnerDependencies {
  readonly executor: ValidationWorkspaceExecutor;
  readonly organizationPolicy?: OrganizationPolicyEvaluator;
  readonly policy: TerraformValidationPolicyV1;
}

function toolEqual(
  left: ValidationToolPinV1,
  right: ValidationToolPinV1,
): boolean {
  return (
    left.id === right.id &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

function boundedDiagnostics(
  diagnostics: readonly TerraformValidationDiagnosticV1[],
  solutionRevisionId: string,
): TerraformValidationDiagnosticV1[] {
  const sorted = sortDiagnostics(diagnostics);
  if (sorted.length <= 1_000) return sorted;
  return sortDiagnostics([
    ...sorted.slice(0, 999),
    runnerDiagnostic(
      "terraform.validation.diagnostics-overflow",
      "Validation produced more diagnostics than the bounded report permits.",
      solutionRevisionId,
    ),
  ]);
}

function emptyResult(
  diagnostics: readonly TerraformValidationDiagnosticV1[],
): TerraformValidationResultV1 {
  const sorted = sortDiagnostics(diagnostics);
  return terraformValidationResultV1Schema.parse({
    commandSummaries: [],
    contractVersion: 1,
    diagnostics: sorted,
    evidenceRecords: [],
    reportDigest: canonicalDigest({
      commandSummaries: [],
      diagnostics: sorted,
    }),
    state: "error",
  });
}

function commandStateIsTerminal(result: ValidationCommandResult): boolean {
  return (
    result.termination === "cancelled" ||
    result.termination === "output-limit" ||
    result.termination === "timeout"
  );
}

function commandFailureState(
  summaries: readonly TerraformValidationCommandSummaryV1[],
  diagnostics: readonly TerraformValidationDiagnosticV1[],
): TerraformValidationResultV1["state"] {
  if (summaries.some(({ state }) => state === "cancelled")) return "cancelled";
  if (
    summaries.some(
      ({ state }) => state === "timeout" || state === "output-limit",
    ) ||
    summaries.some(
      ({ state, step }) =>
        state === "failed" && (step === "tflint" || step === "scanner"),
    ) ||
    diagnostics.some(
      ({ code }) =>
        code === "terraform.validation.analyzer-failed" ||
        code === "terraform.validation.diagnostics-malformed" ||
        code === "terraform.validation.organization-policy-error" ||
        code === "terraform.validation.required-tool-unavailable" ||
        code === "terraform.validation.runner-error" ||
        code === "terraform.validation.cleanup-error" ||
        code === "terraform.validation.diagnostics-overflow",
    )
  ) {
    return "error";
  }
  return diagnostics.some(({ severity }) => severity === "error")
    ? "failed"
    : "passed";
}

function evidenceId(prefix: string, digest: string): string {
  return `evidence_${prefix}_${digest.slice(7, 31)}`;
}

function totalFileBytes(files: readonly TerraformValidationFileV1[]): number {
  const encoder = new TextEncoder();
  return files.reduce(
    (sum, file) => sum + encoder.encode(file.content).byteLength,
    0,
  );
}

function evidenceRecords(
  request: TerraformValidationRequestV1,
  policy: TerraformValidationPolicyV1,
  reportDigest: TerraformValidationResultV1["reportDigest"],
  diagnostics: readonly TerraformValidationDiagnosticV1[],
  reportSizeBytes: number,
  state: TerraformValidationResultV1["state"],
): readonly EvidenceRecordV1[] {
  if (request.extensionContext !== undefined) {
    const context = request.extensionContext;
    const validationPassed = state === "passed";
    const candidatePathKeys = new Set(
      context.candidateOwnedPaths.map((path) =>
        path.normalize("NFC").toLowerCase(),
      ),
    );
    const candidateFiles = request.files.filter((file) =>
      candidatePathKeys.has(file.path.normalize("NFC").toLowerCase()),
    );
    const issueIds = Array.from(
      new Set(
        diagnostics
          .filter(({ severity }) => severity !== "info")
          .map(({ code }) => code),
      ),
    ).sort(compareUtf16);
    const toolPins = [
      policy.runner,
      policy.terraform,
      ...(policy.tflint === undefined ? [] : [policy.tflint.tool]),
      ...(policy.scanner === undefined ? [] : [policy.scanner.tool]),
      ...(policy.organizationPolicy === undefined
        ? []
        : [policy.organizationPolicy.tool]),
    ].sort((left, right) => compareUtf16(left.id, right.id));
    const inputDigests = Array.from(
      new Set([
        request.artifactDigest,
        context.candidateArtifactDigest,
        request.solutionRevisionDigest,
        context.baseline.artifactDigest,
        context.baseline.compiler.digest,
        context.baseline.solutionRevisionDigest,
        context.candidateDigest,
        canonicalDigest(context.modelDescriptor),
        context.modelOutputDigest,
        ...context.officialSchemaAuthorities.map(
          ({ schemaDigest }) => schemaDigest,
        ),
        policy.container.digest,
        policy.providerLock.checksum,
        ...policy.providers.map(
          ({ mirrorPackageDigest }) => mirrorPackageDigest,
        ),
        ...policy.modules.map(({ digest }) => digest),
        ...(policy.tflint === undefined ? [] : [policy.tflint.configDigest]),
        ...(policy.scanner === undefined ? [] : [policy.scanner.configDigest]),
        ...(policy.organizationPolicy === undefined
          ? []
          : [policy.organizationPolicy.configDigest]),
        canonicalDigest(context),
        canonicalDigest(request),
        canonicalDigest(policy),
      ]),
    ).sort(compareUtf16);
    const extensionEvidence = evidenceRecordV1Schema.parse({
      artifacts: [
        {
          digest: context.candidateArtifactDigest,
          mediaType:
            "application/vnd.cloudmarkup.ai-extension-candidate.v1+json",
          sizeBytes: totalFileBytes(candidateFiles),
        },
        {
          digest: context.candidateDigest,
          mediaType:
            "application/vnd.cloudmarkup.ai-authored-terraform-extension+json",
          sizeBytes: totalFileBytes(candidateFiles),
        },
        {
          digest: reportDigest,
          mediaType: "application/json",
          sizeBytes: reportSizeBytes,
        },
      ],
      checks: [
        {
          artifactDigests: [
            context.candidateArtifactDigest,
            request.artifactDigest,
            context.baseline.artifactDigest,
            context.candidateDigest,
            reportDigest,
          ],
          checkId:
            "cloudmarkup.evidence.ai-extension-terraform-parse-static-validity",
          generationCoverageRequirement: "ai-extension-parse-static-validity",
          issueIds,
          ...(validationPassed
            ? {}
            : {
                redactedFailure:
                  state === "cancelled"
                    ? "AI-extension validation was cancelled."
                    : "One or more bounded AI-extension checks did not pass.",
              }),
          status: validationPassed
            ? ("passed" as const)
            : state === "error" || state === "cancelled"
              ? ("error" as const)
              : ("failed" as const),
          summary: validationPassed
            ? "The detached AI-authored Terraform extension passed bounded parse and static validation."
            : "The detached AI-authored Terraform extension did not pass bounded parse and static validation.",
        },
      ],
      contractVersion: 1,
      environment: request.environment,
      id: evidenceId(
        "ai_extension_terraform",
        canonicalDigest({
          candidateArtifactDigest: context.candidateArtifactDigest,
          reportDigest,
        }),
      ),
      layer: "generated",
      level: {
        kind: "ai-extension-parse-static-validity",
        rank: 4,
      },
      models: [
        {
          modelId: context.modelDescriptor.modelId,
          modelVersion: context.modelDescriptor.modelVersion,
          promptVersion: context.modelDescriptor.promptVersion,
          providerId: context.modelDescriptor.providerId,
        },
      ],
      provenance: {
        actor: { kind: "deterministic-tool", tool: policy.runner },
        createdAt: request.assessedAt,
        inputDigests,
      },
      solutionRevisionId: request.solutionRevisionId,
      staleness: { assessedAt: request.assessedAt, state: "current" },
      tools: toolPins,
    });
    return [extensionEvidence];
  }
  const compilationCheck = {
    artifactDigests: [request.artifactDigest],
    checkId: "cloudmarkup.evidence.deterministic-infrastructure-compilation",
    generationCoverageRequirement: "deterministic-infrastructure-compilation",
    issueIds: [],
    status: "passed" as const,
    summary:
      "The exact Terraform artifact is bound to the approved deterministic compiler output.",
  };
  const validationPassed = state === "passed";
  const staticCheck = {
    artifactDigests: [request.artifactDigest, reportDigest],
    checkId: "cloudmarkup.evidence.terraform-static-validation",
    issueIds: Array.from(
      new Set(
        diagnostics
          .filter(({ severity }) => severity !== "info")
          .map(({ code }) => code),
      ),
    ).sort(compareUtf16),
    ...(validationPassed
      ? {}
      : {
          redactedFailure:
            state === "cancelled"
              ? "Static validation was cancelled."
              : "One or more bounded static validation checks did not pass.",
        }),
    status: validationPassed
      ? ("passed" as const)
      : state === "error" || state === "cancelled"
        ? ("error" as const)
        : ("failed" as const),
    summary: validationPassed
      ? "Offline Terraform formatting, initialization, validation, and approved policy checks passed."
      : "Offline Terraform static validation did not pass.",
  };
  const toolPins = [
    policy.runner,
    policy.terraform,
    ...(policy.tflint === undefined ? [] : [policy.tflint.tool]),
    ...(policy.scanner === undefined ? [] : [policy.scanner.tool]),
    ...(policy.organizationPolicy === undefined
      ? []
      : [policy.organizationPolicy.tool]),
  ].sort((left, right) => compareUtf16(left.id, right.id));
  const policyInputDigests = Array.from(
    new Set([
      policy.container.digest,
      policy.providerLock.checksum,
      ...policy.providers.map(({ mirrorPackageDigest }) => mirrorPackageDigest),
      ...policy.modules.map(({ digest }) => digest),
      ...(policy.tflint === undefined ? [] : [policy.tflint.configDigest]),
      ...(policy.scanner === undefined ? [] : [policy.scanner.configDigest]),
      ...(policy.organizationPolicy === undefined
        ? []
        : [policy.organizationPolicy.configDigest]),
    ]),
  ).sort(compareUtf16);
  const staticInputDigests = Array.from(
    new Set([
      request.solutionRevisionDigest,
      request.artifactDigest,
      ...policyInputDigests,
      canonicalDigest(request),
      canonicalDigest(policy),
    ]),
  ).sort(compareUtf16);
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
        sizeBytes: totalFileBytes(request.files),
      },
    ],
    checks: [compilationCheck],
    id: evidenceId("iac_compilation", request.artifactDigest),
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
        sizeBytes: reportSizeBytes,
      },
    ],
    checks: [staticCheck],
    id: evidenceId("terraform_static", reportDigest),
    provenance: {
      actor: { kind: "deterministic-tool", tool: policy.runner },
      createdAt: request.assessedAt,
      inputDigests: staticInputDigests,
    },
    tools: toolPins,
  });
  return [compilation, staticValidation];
}

async function runCommand(
  session: ValidationWorkspaceSession,
  invocation: ValidationCommandInvocation,
  request: TerraformValidationRequestV1,
  signal: AbortSignal | undefined,
): Promise<{
  readonly diagnostics: readonly TerraformValidationDiagnosticV1[];
  readonly result: ValidationCommandResult;
  readonly summary: TerraformValidationCommandSummaryV1;
}> {
  const result = await session.execute(invocation, signal);
  return {
    diagnostics: terminationDiagnostics(
      invocation,
      result,
      request.files,
      request.solutionRevisionId,
    ),
    result,
    summary: commandSummary(invocation, result),
  };
}

function requiredToolUnavailable(
  invocation: ValidationCommandInvocation,
  result: ValidationCommandResult,
  policy: TerraformValidationPolicyV1,
): boolean {
  if (result.termination !== "unavailable") return false;
  if (invocation.step === "tflint") return policy.tflint?.required === true;
  if (invocation.step === "scanner") return policy.scanner?.required === true;
  return true;
}

export function createTerraformValidationRunner(
  dependencies: TerraformValidationRunnerDependencies,
): TerraformValidationRunner {
  const policy = terraformValidationPolicyV1Schema.parse(dependencies.policy);
  return {
    async run(input, options = {}) {
      const parsed = terraformValidationRequestV1Schema.safeParse(input);
      if (!parsed.success) {
        return emptyResult([
          runnerDiagnostic(
            "terraform.validation.request-invalid",
            "Terraform validation request does not satisfy the strict version-1 contract.",
            "unknown-revision",
          ),
        ]);
      }
      const request = parsed.data;
      if (!toolEqual(request.compiler, policy.compiler)) {
        return emptyResult([
          runnerDiagnostic(
            "terraform.validation.compiler-unapproved",
            "Terraform artifact compiler pin is not approved by runner policy.",
            request.solutionRevisionId,
          ),
        ]);
      }
      const admission = [
        ...validateInputFiles(
          request.files,
          policy.limits,
          policy,
          request.solutionRevisionId,
        ),
        ...(request.extensionContext === undefined
          ? []
          : validateTerraformAiExtensionInput(
              {
                artifactDigest: request.artifactDigest,
                compiler: request.compiler,
                context: request.extensionContext,
                files: request.files,
                solutionRevisionDigest: request.solutionRevisionDigest,
                solutionRevisionId: request.solutionRevisionId,
              },
              policy,
            )),
      ];
      if (admission.some(({ severity }) => severity === "error")) {
        const boundedAdmission = boundedDiagnostics(
          admission,
          request.solutionRevisionId,
        );
        const reportDigest = canonicalDigest({
          commandSummaries: [],
          diagnostics: boundedAdmission,
        });
        const reportSize = new TextEncoder().encode(
          serializeCanonicalJson({
            commandSummaries: [],
            diagnostics: boundedAdmission,
          }),
        ).byteLength;
        return terraformValidationResultV1Schema.parse({
          commandSummaries: [],
          contractVersion: 1,
          diagnostics: boundedAdmission,
          evidenceRecords: evidenceRecords(
            request,
            policy,
            reportDigest,
            boundedAdmission,
            reportSize,
            "failed",
          ),
          reportDigest,
          state: "failed",
        });
      }

      const commandSummaries: TerraformValidationCommandSummaryV1[] = [];
      const diagnostics: TerraformValidationDiagnosticV1[] = [...admission];
      let session: ValidationWorkspaceSession | undefined;
      try {
        session = await dependencies.executor.open({
          files: request.files,
          limits: policy.limits,
          providerLock: policy.providerLock,
        });
        for (const invocation of [
          APPROVED_VALIDATION_COMMANDS.fmt,
          APPROVED_VALIDATION_COMMANDS.init,
          APPROVED_VALIDATION_COMMANDS.validate,
        ]) {
          const outcome = await runCommand(
            session,
            invocation,
            request,
            options.signal,
          );
          commandSummaries.push(outcome.summary);
          diagnostics.push(...outcome.diagnostics);
          if (outcome.result.termination === "completed") {
            if (invocation.step === "fmt")
              diagnostics.push(
                ...parseFmtResult(
                  outcome.result,
                  request.files,
                  request.solutionRevisionId,
                ),
              );
            if (invocation.step === "init")
              diagnostics.push(
                ...parseInitResult(
                  outcome.result,
                  request.files,
                  request.solutionRevisionId,
                ),
              );
            if (invocation.step === "validate")
              diagnostics.push(
                ...parseValidateResult(
                  outcome.result,
                  request.files,
                  request.solutionRevisionId,
                ),
              );
          }
          if (
            commandStateIsTerminal(outcome.result) ||
            (invocation.step === "init" && outcome.result.exitCode !== 0)
          )
            break;
        }
        if (
          !commandSummaries.some(
            ({ state }) =>
              state === "timeout" ||
              state === "cancelled" ||
              state === "output-limit",
          )
        ) {
          for (const optional of [
            ...(policy.tflint === undefined
              ? []
              : [
                  {
                    invocation: APPROVED_VALIDATION_COMMANDS.tflint,
                    parser: parseTflintResult,
                  },
                ]),
            ...(policy.scanner === undefined
              ? []
              : [
                  {
                    invocation: APPROVED_VALIDATION_COMMANDS.scanner,
                    parser: parseScannerResult,
                  },
                ]),
          ]) {
            const outcome = await runCommand(
              session,
              optional.invocation,
              request,
              options.signal,
            );
            commandSummaries.push(outcome.summary);
            diagnostics.push(...outcome.diagnostics);
            if (
              requiredToolUnavailable(
                optional.invocation,
                outcome.result,
                policy,
              )
            ) {
              diagnostics.push(
                runnerDiagnostic(
                  "terraform.validation.required-tool-unavailable",
                  "A required approved validation tool is unavailable.",
                  request.solutionRevisionId,
                ),
              );
            }
            diagnostics.push(
              ...optional.parser(
                outcome.result,
                request.files,
                request.solutionRevisionId,
              ),
            );
            if (commandStateIsTerminal(outcome.result)) break;
          }
        }
        if (
          policy.organizationPolicy !== undefined &&
          dependencies.organizationPolicy === undefined &&
          !commandSummaries.some(
            ({ state }) =>
              state === "timeout" ||
              state === "cancelled" ||
              state === "output-limit",
          )
        ) {
          diagnostics.push(
            runnerDiagnostic(
              policy.organizationPolicy.required
                ? "terraform.validation.required-tool-unavailable"
                : "terraform.validation.optional-tool-unavailable",
              policy.organizationPolicy.required
                ? "A required approved validation tool is unavailable."
                : "An approved optional validation tool is unavailable.",
              request.solutionRevisionId,
              policy.organizationPolicy.required ? "error" : "warning",
            ),
          );
        }
        if (
          dependencies.organizationPolicy !== undefined &&
          policy.organizationPolicy !== undefined &&
          !commandSummaries.some(
            ({ state }) =>
              state === "timeout" ||
              state === "cancelled" ||
              state === "output-limit",
          )
        ) {
          try {
            const policyFindings =
              await dependencies.organizationPolicy.evaluate({
                artifactDigest: request.artifactDigest,
                diagnostics: boundedDiagnostics(
                  diagnostics,
                  request.solutionRevisionId,
                ),
                files: request.files,
                solutionRevisionId: request.solutionRevisionId,
              });
            for (const finding of policyFindings) {
              const parsedFinding =
                terraformValidationDiagnosticV1Schema.safeParse(finding);
              if (!parsedFinding.success) {
                throw new TypeError("Organization-policy finding is invalid.");
              }
              diagnostics.push(parsedFinding.data);
            }
          } catch {
            diagnostics.push(
              runnerDiagnostic(
                "terraform.validation.organization-policy-error",
                "Approved organization-policy evaluation failed safely.",
                request.solutionRevisionId,
              ),
            );
          }
        }
      } catch {
        diagnostics.push(
          runnerDiagnostic(
            "terraform.validation.runner-error",
            "Validation workspace failed without exposing internal details.",
            request.solutionRevisionId,
          ),
        );
      } finally {
        if (session !== undefined) {
          try {
            await session.dispose();
          } catch {
            diagnostics.push(
              runnerDiagnostic(
                "terraform.validation.cleanup-error",
                "Validation workspace cleanup failed and requires operator review.",
                request.solutionRevisionId,
              ),
            );
          }
        }
      }
      const sortedDiagnostics = boundedDiagnostics(
        diagnostics,
        request.solutionRevisionId,
      );
      const state = commandFailureState(commandSummaries, sortedDiagnostics);
      const report = { commandSummaries, diagnostics: sortedDiagnostics };
      const reportBytes = new TextEncoder().encode(
        serializeCanonicalJson(report),
      );
      const reportDigest = sha256(reportBytes);
      return terraformValidationResultV1Schema.parse({
        commandSummaries,
        contractVersion: 1,
        diagnostics: sortedDiagnostics,
        evidenceRecords: evidenceRecords(
          request,
          policy,
          reportDigest,
          sortedDiagnostics,
          reportBytes.byteLength,
          state,
        ),
        reportDigest,
        state,
      });
    },
  };
}
