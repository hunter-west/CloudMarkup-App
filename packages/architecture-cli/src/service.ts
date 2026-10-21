import { verifyRepositoryImport } from "@cloudmarkup/repository-importer";
import {
  SOLUTION_EXPORT_MANIFEST_PATH,
  localSolutionExportService,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export";

import {
  ARCHITECTURE_CLI_EXIT_CODES,
  architectureCliCommandResultV1Schema,
  architectureCliDiagnosticV1Schema,
  type ArchitectureCliCommandResultV1,
  type ArchitectureCliFileChangeV1,
  type ArchitectureCliSemanticChangeV1,
  type ArchitectureCliCommandV1,
  type ArchitectureCliDiagnosticV1,
  type ArchitectureCliEvidenceSummaryV1,
  type ArchitectureCliSemanticSnapshotV1,
} from "./contracts.js";
import {
  verifyArchitectureCliConformanceV1,
  type ArchitectureCliConformancePortV1,
} from "./conformance.js";
import {
  applyArchitectureRepositoryUpdate,
  fileChangesForArtifact,
  loadArchitectureRepository,
  planArchitectureRepositoryUpdate,
  repositorySourceInputs,
  withIsolatedArtifactTree,
  type LoadedArchitectureRepository,
} from "./repository.js";
import { diffArchitectureCliSemanticSnapshots } from "./semantic-diff.js";
import type { ArchitectureCliRepositoryImportPortV1 } from "./repository-import.js";

export interface ArchitectureCliPipelineResultV1 {
  readonly artifact?: SolutionExportArtifactV1;
  readonly diagnostics: readonly ArchitectureCliDiagnosticV1[];
  readonly evidence: ArchitectureCliEvidenceSummaryV1;
  readonly semanticSnapshot: ArchitectureCliSemanticSnapshotV1;
  readonly state: "ready" | "failed";
}

export interface ArchitectureCliPipelineV1 {
  inspect(input: {
    readonly repository: ReturnType<typeof repositorySourceInputs>;
    readonly signal: AbortSignal;
  }): Promise<ArchitectureCliPipelineResultV1>;
  run(input: {
    readonly command: Extract<
      ArchitectureCliCommandV1,
      "validate" | "generate" | "render" | "test"
    >;
    readonly repository: ReturnType<typeof repositorySourceInputs>;
    readonly signal: AbortSignal;
  }): Promise<ArchitectureCliPipelineResultV1>;
}

export interface ArchitectureCliServiceV1 {
  execute(input: {
    readonly command: ArchitectureCliCommandV1;
    readonly environmentId?: string;
    readonly root: string;
    readonly signal?: AbortSignal;
  }): Promise<ArchitectureCliCommandResultV1>;
}

function compareUtf16(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function diagnostic(
  code: string,
  message: string,
  severity: ArchitectureCliDiagnosticV1["severity"] = "error",
): ArchitectureCliDiagnosticV1 {
  return architectureCliDiagnosticV1Schema.parse({ code, message, severity });
}

function stableDiagnostics(
  diagnostics: readonly ArchitectureCliDiagnosticV1[],
): ArchitectureCliDiagnosticV1[] {
  return [...diagnostics]
    .map((entry) => architectureCliDiagnosticV1Schema.parse(entry))
    .sort((left, right) =>
      compareUtf16(
        `${left.severity}\u0000${left.code}\u0000${left.path ?? ""}`,
        `${right.severity}\u0000${right.code}\u0000${right.path ?? ""}`,
      ),
    );
}

type ArchitectureCliCommandResultInputV1 = Omit<
  ArchitectureCliCommandResultV1,
  "diagnostics" | "fileChanges" | "semanticChanges"
> & {
  readonly diagnostics: readonly ArchitectureCliDiagnosticV1[];
  readonly fileChanges: readonly ArchitectureCliFileChangeV1[];
  readonly semanticChanges: readonly ArchitectureCliSemanticChangeV1[];
};

function result(
  value: ArchitectureCliCommandResultInputV1,
): ArchitectureCliCommandResultV1 {
  return architectureCliCommandResultV1Schema.parse({
    ...value,
    diagnostics: stableDiagnostics(value.diagnostics),
    fileChanges: [...value.fileChanges].sort((left, right) =>
      compareUtf16(left.path, right.path),
    ),
    semanticChanges: [...value.semanticChanges].sort((left, right) =>
      compareUtf16(
        `${left.kind}\u0000${left.factId}`,
        `${right.kind}\u0000${right.factId}`,
      ),
    ),
  });
}

function repositoryFailure(
  command: ArchitectureCliCommandV1,
): ArchitectureCliCommandResultV1 {
  return result({
    command,
    contractVersion: 1,
    diagnostics: [
      diagnostic(
        "cloudmarkup.cli.repository-invalid",
        "The repository profile, lock, manifest, ownership, or file inventory is invalid.",
      ),
    ],
    exitCode: ARCHITECTURE_CLI_EXIT_CODES.validation,
    fileChanges: [],
    semanticChanges: [],
    state: "failed",
  });
}

function pipelineFailure(
  command: ArchitectureCliCommandV1,
  repository: LoadedArchitectureRepository,
  diagnostics: readonly ArchitectureCliDiagnosticV1[],
  evidence?: ArchitectureCliEvidenceSummaryV1,
): ArchitectureCliCommandResultV1 {
  return result({
    command,
    contractVersion: 1,
    diagnostics:
      diagnostics.length === 0
        ? [
            diagnostic(
              "cloudmarkup.cli.pipeline-failed",
              "The approved local verification pipeline did not complete.",
            ),
          ]
        : diagnostics,
    ...(evidence === undefined ? {} : { evidence }),
    exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
    fileChanges: [],
    semanticChanges: [],
    solutionRevision: {
      digest: repository.lock.solutionRevision.digest,
      id: repository.solutionRevision.solutionRevisionId,
    },
    state: "failed",
  });
}

function requireArtifact(
  command: ArchitectureCliCommandV1,
  repository: LoadedArchitectureRepository,
  pipelineResult: ArchitectureCliPipelineResultV1,
): SolutionExportArtifactV1 | ArchitectureCliCommandResultV1 {
  if (
    pipelineResult.state !== "ready" ||
    pipelineResult.artifact === undefined
  ) {
    return pipelineFailure(
      command,
      repository,
      pipelineResult.diagnostics,
      pipelineResult.evidence,
    );
  }
  if (
    localSolutionExportService
      .verify(pipelineResult.artifact)
      .some(({ severity }) => severity === "error")
  ) {
    return pipelineFailure(command, repository, [
      diagnostic(
        "cloudmarkup.cli.pipeline-artifact-invalid",
        "Generated output failed independent manifest, checksum, path, or archive verification.",
      ),
    ]);
  }
  if (
    pipelineResult.artifact.manifest.solutionRevision.digest !==
      repository.lock.solutionRevision.digest ||
    pipelineResult.artifact.manifest.solutionRevision.id !==
      repository.lock.solutionRevision.id
  ) {
    return pipelineFailure(command, repository, [
      diagnostic(
        "cloudmarkup.cli.pipeline-revision-mismatch",
        "Generated output does not bind the locked immutable Solution Revision.",
      ),
    ]);
  }
  return pipelineResult.artifact;
}

async function compareGenerated(
  repository: LoadedArchitectureRepository,
  pipeline: ArchitectureCliPipelineV1,
  signal: AbortSignal,
) {
  const source = repositorySourceInputs(repository);
  const [before, generated] = await Promise.all([
    pipeline.inspect({ repository: source, signal }),
    pipeline.run({ command: "generate", repository: source, signal }),
  ]);
  return { before, generated };
}

export function createArchitectureCliService(
  pipeline: ArchitectureCliPipelineV1,
  repositoryImporter?: ArchitectureCliRepositoryImportPortV1,
  conformance?: ArchitectureCliConformancePortV1,
): ArchitectureCliServiceV1 {
  return {
    async execute(input) {
      const signal = input.signal ?? new AbortController().signal;
      let repository: LoadedArchitectureRepository;
      try {
        repository = await loadArchitectureRepository(input.root);
      } catch {
        return repositoryFailure(input.command);
      }
      const revision = {
        digest: repository.lock.solutionRevision.digest,
        id: repository.solutionRevision.solutionRevisionId,
      };
      try {
        if (input.command === "conformance") {
          if (input.environmentId === undefined) {
            return pipelineFailure(input.command, repository, [
              diagnostic(
                "cloudmarkup.cli.conformance-environment-required",
                "Conformance requires one explicit environment identifier.",
              ),
            ]);
          }
          if (conformance === undefined) {
            return pipelineFailure(input.command, repository, [
              diagnostic(
                "cloudmarkup.cli.conformance-source-unavailable",
                "No approved read-only conformance evidence source is registered.",
              ),
            ]);
          }
          const untrustedReport = await conformance.read({
            environmentId: input.environmentId,
            root: input.root,
            signal,
            solutionRevision: revision,
          });
          if (untrustedReport === null) {
            return pipelineFailure(input.command, repository, [
              diagnostic(
                "cloudmarkup.cli.conformance-evidence-unavailable",
                "Continuous conformance Evidence is unavailable for the locked Solution Revision.",
              ),
            ]);
          }
          const verification = verifyArchitectureCliConformanceV1({
            environmentId: input.environmentId,
            report: untrustedReport,
            solutionRevision: revision,
          });
          if (!verification.ok) {
            return pipelineFailure(input.command, repository, [
              diagnostic(
                verification.code,
                verification.code.endsWith("environment-mismatch")
                  ? "Conformance Evidence does not bind the selected environment."
                  : verification.code.endsWith("revision-mismatch")
                    ? "Conformance Evidence does not bind the locked Solution Revision."
                    : "Conformance Evidence failed schema or digest verification.",
              ),
            ]);
          }
          const drift = verification.projection.drift;
          return result({
            command: input.command,
            conformance: verification.projection.summary,
            contractVersion: 1,
            diagnostics: drift
              ? [
                  diagnostic(
                    "cloudmarkup.cli.conformance-drift",
                    "The validated conformance report contains review-required differences.",
                    "warning",
                  ),
                ]
              : [],
            evidence: verification.projection.evidence,
            exitCode: drift
              ? ARCHITECTURE_CLI_EXIT_CODES.drift
              : ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges: [],
            semanticChanges: [],
            solutionRevision: revision,
            state: drift ? "drift" : "succeeded",
          });
        }
        if (
          input.command === "import" ||
          input.command === "inspect-repository" ||
          input.command === "compare" ||
          input.command === "verify-repository"
        ) {
          if (repositoryImporter === undefined) {
            return pipelineFailure(input.command, repository, [
              diagnostic(
                "cloudmarkup.cli.repository-importer-unavailable",
                "No approved local repository importer is registered.",
              ),
            ]);
          }
          const imported = await repositoryImporter.run({
            root: input.root,
            repository,
            signal,
          });
          const verificationResult = verifyRepositoryImport(imported);
          const integrityErrors = verificationResult.errors.filter(
            ({ code }) =>
              code === "cloudmarkup.import.result-integrity-invalid",
          );
          if (integrityErrors.length > 0) {
            return pipelineFailure(
              input.command,
              repository,
              integrityErrors.map((entry) =>
                diagnostic(
                  entry.code.replace(
                    "cloudmarkup.import.",
                    "cloudmarkup.cli.import-",
                  ),
                  entry.summary,
                ),
              ),
            );
          }
          const blocking =
            imported.diagnostics.some(({ severity }) => severity === "error") ||
            imported.differences.some(
              ({ kind, severity }) =>
                kind !== "matches" && severity === "error",
            );
          const drift = imported.differences.some(
            ({ kind }) => kind !== "matches",
          );
          const verification = input.command === "verify-repository";
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: imported.diagnostics.map((entry) =>
              architectureCliDiagnosticV1Schema.parse({
                code: entry.code.replace(
                  "cloudmarkup.import.",
                  "cloudmarkup.cli.import-",
                ),
                message: entry.summary,
                severity:
                  entry.severity === "information" ? "info" : entry.severity,
                ...(entry.path === undefined ? {} : { path: entry.path }),
              }),
            ),
            evidence: {
              current: imported.evidence.staleness.state === "current" ? 1 : 0,
              stale: imported.evidence.staleness.state === "stale" ? 1 : 0,
              failed: imported.evidence.checks.some(
                ({ status }) => status !== "passed",
              )
                ? 1
                : 0,
              unavailableLevels: [6, 7, 9],
            },
            exitCode: blocking
              ? ARCHITECTURE_CLI_EXIT_CODES.validation
              : verification && drift
                ? ARCHITECTURE_CLI_EXIT_CODES.drift
                : ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges: [],
            repositoryImport: imported,
            semanticChanges: [],
            solutionRevision: revision,
            state: blocking
              ? "failed"
              : verification && drift
                ? "drift"
                : "succeeded",
          });
        }
        if (input.command === "validate" || input.command === "test") {
          const pipelineResult = await pipeline.run({
            command: input.command,
            repository: repositorySourceInputs(repository),
            signal,
          });
          if (pipelineResult.state !== "ready") {
            return pipelineFailure(
              input.command,
              repository,
              pipelineResult.diagnostics,
              pipelineResult.evidence,
            );
          }
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: pipelineResult.diagnostics,
            evidence: pipelineResult.evidence,
            exitCode: ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges: [],
            semanticChanges: [],
            solutionRevision: revision,
            state: "succeeded",
          });
        }

        if (input.command === "evidence") {
          const inspected = await pipeline.inspect({
            repository: repositorySourceInputs(repository),
            signal,
          });
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: inspected.diagnostics,
            evidence: inspected.evidence,
            exitCode:
              inspected.state === "ready"
                ? ARCHITECTURE_CLI_EXIT_CODES.success
                : ARCHITECTURE_CLI_EXIT_CODES.pipeline,
            fileChanges: [],
            semanticChanges: [],
            solutionRevision: revision,
            state: inspected.state === "ready" ? "succeeded" : "failed",
          });
        }

        if (input.command === "render") {
          const rendered = await pipeline.run({
            command: "render",
            repository: repositorySourceInputs(repository),
            signal,
          });
          const artifact = requireArtifact(input.command, repository, rendered);
          if (!("zipBytes" in artifact)) return artifact;
          const allChanges = fileChangesForArtifact(repository, artifact);
          const unrelated = allChanges.filter(
            ({ path }) =>
              !path.startsWith("diagram/") &&
              path !== SOLUTION_EXPORT_MANIFEST_PATH,
          );
          if (unrelated.length > 0) {
            return result({
              command: input.command,
              contractVersion: 1,
              diagnostics: [
                diagnostic(
                  "cloudmarkup.cli.render-output-mismatch",
                  "Diagram rendering also changed non-diagram output; run the full generate command.",
                ),
              ],
              evidence: rendered.evidence,
              exitCode: ARCHITECTURE_CLI_EXIT_CODES.conflict,
              fileChanges: allChanges,
              semanticChanges: [],
              solutionRevision: revision,
              state: "conflict",
            });
          }
          try {
            await applyArchitectureRepositoryUpdate(repository, artifact);
          } catch {
            return result({
              command: input.command,
              contractVersion: 1,
              diagnostics: [
                diagnostic(
                  "cloudmarkup.cli.ownership-conflict",
                  "Diagram output conflicts with reviewed repository ownership or baseline metadata.",
                ),
              ],
              evidence: rendered.evidence,
              exitCode: ARCHITECTURE_CLI_EXIT_CODES.conflict,
              fileChanges: allChanges,
              semanticChanges: [],
              solutionRevision: revision,
              state: "conflict",
            });
          }
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: rendered.diagnostics,
            evidence: rendered.evidence,
            exitCode: ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges: allChanges,
            semanticChanges: [],
            solutionRevision: revision,
            state: "succeeded",
          });
        }

        const { before, generated } = await compareGenerated(
          repository,
          pipeline,
          signal,
        );
        if (before.state !== "ready") {
          return pipelineFailure(
            input.command,
            repository,
            before.diagnostics,
            before.evidence,
          );
        }
        const artifact = requireArtifact(input.command, repository, generated);
        if (!("zipBytes" in artifact)) return artifact;
        const fileChanges = fileChangesForArtifact(repository, artifact);
        const semanticChanges = diffArchitectureCliSemanticSnapshots(
          before.semanticSnapshot,
          generated.semanticSnapshot,
        );

        if (input.command === "diff") {
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: generated.diagnostics,
            evidence: generated.evidence,
            exitCode: ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges,
            semanticChanges,
            solutionRevision: revision,
            state: "succeeded",
          });
        }

        if (input.command === "verify") {
          await withIsolatedArtifactTree(artifact, async () =>
            Promise.resolve(),
          );
          const drift = fileChanges.length > 0 || semanticChanges.length > 0;
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: generated.diagnostics,
            evidence: generated.evidence,
            exitCode: drift
              ? ARCHITECTURE_CLI_EXIT_CODES.drift
              : ARCHITECTURE_CLI_EXIT_CODES.success,
            fileChanges,
            semanticChanges,
            solutionRevision: revision,
            state: drift ? "drift" : "succeeded",
          });
        }

        try {
          planArchitectureRepositoryUpdate(repository, artifact);
          await applyArchitectureRepositoryUpdate(repository, artifact);
        } catch {
          return result({
            command: input.command,
            contractVersion: 1,
            diagnostics: [
              diagnostic(
                "cloudmarkup.cli.ownership-conflict",
                "Generated output conflicts with reviewed repository ownership or baseline metadata.",
              ),
            ],
            evidence: generated.evidence,
            exitCode: ARCHITECTURE_CLI_EXIT_CODES.conflict,
            fileChanges,
            semanticChanges,
            solutionRevision: revision,
            state: "conflict",
          });
        }
        return result({
          command: input.command,
          contractVersion: 1,
          diagnostics: generated.diagnostics,
          evidence: generated.evidence,
          exitCode: ARCHITECTURE_CLI_EXIT_CODES.success,
          fileChanges,
          semanticChanges,
          solutionRevision: revision,
          state: "succeeded",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return pipelineFailure(input.command, repository, [
            diagnostic(
              "cloudmarkup.cli.cancelled",
              "The local command was cancelled.",
            ),
          ]);
        }
        return pipelineFailure(input.command, repository, []);
      }
    },
  };
}
