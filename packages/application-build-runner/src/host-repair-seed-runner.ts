import {
  inspectApplicationHostRepairSuccessorRequestV2,
  inspectApplicationHostRepairSuccessorResultV2,
  type ApplicationHostRepairSuccessorAdmissionConfig,
} from "./host-repair-successor-admission.js";
import {
  applicationHostRepairSuccessorBuildResultV2Schema,
  type ApplicationHostRepairSuccessorBuildResultV2,
} from "./host-repair-successor-contracts.js";
import {
  inspectApplicationHostRepairCandidateRequestV1,
  inspectApplicationHostRepairCandidateResultV1,
  type ApplicationHostRepairCandidateAdmissionConfig,
} from "./host-repair-candidate-admission.js";
import {
  applicationHostRepairCandidateBuildResultV1Schema,
  type ApplicationHostRepairCandidateBuildResultV1,
} from "./host-repair-candidate-contracts.js";
import { performance } from "node:perf_hooks";
import {
  APPROVED_APPLICATION_BUILD_COMMANDS,
  commandSummary,
} from "./commands.js";
import type {
  ApplicationBuildCommandResult,
  ApplicationBuildDiagnosticV1,
  ApplicationBuildFindingV1,
  ApplicationBuildStepSummaryV1,
  ApplicationBuildTestSummaryV1,
  ApplicationBuildWorkspaceExecutor,
  ApplicationBuildWorkspaceSession,
} from "./contracts.js";
import {
  inspectApplicationHostRepairSeedRequestV1,
  inspectApplicationHostRepairSeedResultV1,
  type ApplicationHostRepairSeedAdmissionConfig,
} from "./host-repair-seed-admission.js";
import {
  applicationHostRepairSeedBuildResultV1Schema,
  type ApplicationHostRepairSeedBuildResultV1,
} from "./host-repair-seed-contracts.js";
import {
  createAdmittedHostRepairArtifacts,
  packageHostRepairSeedOutput,
  type AdmittedHostRepairSource,
} from "./host-repair-seed-artifacts.js";
import { inspectHostRepairSeedTypeFailure } from "./host-repair-seed-diagnostic.js";
import {
  canonicalJson,
  contentSecurityIssue,
  diagnostic,
  sha256Digest,
  sourcePathIssue,
} from "./security.js";
import { parseTestSummary, parseTrivyFindings } from "./tool-observations.js";

export interface ApplicationHostRepairSeedRunner {
  run(
    raw: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationHostRepairSeedBuildResultV1>;
}
type State = ApplicationHostRepairSeedBuildResultV1["state"];
interface SessionObservation {
  state: State;
  steps: ApplicationBuildStepSummaryV1[];
  tests: ApplicationBuildTestSummaryV1[];
  findings: ApplicationBuildFindingV1[];
  diagnostics: ApplicationBuildDiagnosticV1[];
  cleanup: "verified" | "not-established";
  packed?: ReturnType<typeof packageHostRepairSeedOutput>;
}
function note(
  admitted: AdmittedHostRepairSource,
  code: string,
  source: ApplicationBuildDiagnosticV1["source"],
  detail: string,
  fixedPath = false,
) {
  const file = fixedPath
    ? admitted.request.source.files.find(
        (item) => item.path === admitted.request.source.extensionPath,
      )
    : undefined;
  return diagnostic({
    code: `application.host-repair-seed.${code}`,
    source,
    summary: detail,
    detail,
    solutionRevisionId: admitted.request.solutionRevision.solutionRevisionId,
    workloadId: admitted.originalBuildContract.contract.workloadId,
    ...(file === undefined ? {} : { file }),
  });
}
function complete(result: ApplicationBuildCommandResult): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}
function boundedResult(
  result: ApplicationBuildCommandResult,
  max: number,
): boolean {
  const bytes =
    Buffer.byteLength(result.stdout, "utf8") +
    Buffer.byteLength(result.stderr, "utf8");
  return (
    Number.isSafeInteger(result.outputBytes) &&
    result.outputBytes >= 0 &&
    bytes <= max &&
    result.outputBytes <= max &&
    result.outputBytes === bytes
  );
}
function exactTestCounts(stdout: string): boolean {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return false;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return false;
  const value = raw as Record<string, unknown>;
  return ["numPassedTests", "numFailedTests", "numPendingTests"].every(
    (key) => {
      const count = value[key];
      return (
        typeof count === "number" && Number.isSafeInteger(count) && count >= 0
      );
    },
  );
}
function emptyObservation(): SessionObservation {
  return {
    state: "error",
    steps: [],
    tests: [],
    findings: [],
    diagnostics: [],
    cleanup: "not-established",
  };
}

interface HostRepairExecutionBody {
  readonly state: State;
  readonly bindings: AdmittedHostRepairSource["bindings"];
  readonly steps: ApplicationBuildStepSummaryV1[];
  readonly tests: ApplicationBuildTestSummaryV1[];
  readonly diagnostics: ApplicationBuildDiagnosticV1[];
  readonly findings: ApplicationBuildFindingV1[];
  readonly artifacts: ReturnType<typeof createAdmittedHostRepairArtifacts>;
  readonly cleanup: "verified" | "not-established";
  readonly reproducibility: ApplicationHostRepairSeedBuildResultV1["reproducibility"];
}
/** One fixed command/cleanup/reproduction algorithm, after distinct byte admission. */
async function executeHostRepair<T extends { readonly state: State }>(
  admitted: AdmittedHostRepairSource,
  executor: ApplicationBuildWorkspaceExecutor,
  started: number,
  finish: (body: HostRepairExecutionBody) => T,
  options?: { readonly signal?: AbortSignal },
): Promise<T> {
  const expires = started + admitted.request.limits.wallTimeMilliseconds;
  const timeout = new AbortController();
  const signal =
    options?.signal === undefined
      ? timeout.signal
      : AbortSignal.any([timeout.signal, options.signal]);
  const remaining = () => expires - performance.now();
  const outOfTime = () => timeout.signal.aborted || remaining() <= 0;
  const unavailableState = (): State =>
    outOfTime() ? "error" : signal.aborted ? "cancelled" : "error";
  const current = () => !signal.aborted && remaining() > 0;
  const timer = setTimeout(
    () => {
      timeout.abort();
    },
    Math.max(0, remaining()),
  );
  let first = emptyObservation();
  let second: SessionObservation | undefined;
  let artifacts: ReturnType<typeof createAdmittedHostRepairArtifacts> = [];
  let reproducibility: ApplicationHostRepairSeedBuildResultV1["reproducibility"] =
    { state: "not-established" };

  const observe = async (): Promise<SessionObservation> => {
    const observed = emptyObservation();
    let session: ApplicationBuildWorkspaceSession | undefined;
    let opening = false;
    try {
      if (!current()) {
        observed.state = unavailableState();
        observed.cleanup = "verified";
        observed.diagnostics.push(
          note(
            admitted,
            "cancelled-before-open",
            "runner",
            "The run ended before opening a workspace.",
          ),
        );
        return observed;
      }
      opening = true;
      session = await executor.open({
        files: admitted.request.source.files,
        limits: admitted.request.limits,
        lock: admitted.request.dependencyLock,
        signal,
      });
      observed.state = "passed";
      for (const command of Object.values(
        APPROVED_APPLICATION_BUILD_COMMANDS,
      )) {
        if (!current()) {
          observed.state = unavailableState();
          break;
        }
        const result = await session.execute(command, signal);
        if (!boundedResult(result, admitted.request.limits.maxOutputBytes)) {
          observed.state = "error";
          observed.diagnostics.push(
            note(
              admitted,
              "tool-output-invalid",
              command.step,
              "The tool returned invalid or over-budget output metadata.",
            ),
          );
          break;
        }
        observed.steps.push(commandSummary(command, result));
        if (!complete(result)) {
          observed.state =
            result.termination === "cancelled"
              ? unavailableState()
              : result.termination === "completed"
                ? "failed"
                : "error";
          const fixed = admitted.request.source.files.find(
            (file) => file.path === admitted.request.source.extensionPath,
          );
          const intended =
            (admitted.request.source.variant === "invalid-seed" ||
              admitted.request.source.variant === "model-repair") &&
            command.step === "typecheck" &&
            fixed !== undefined &&
            current()
              ? inspectHostRepairSeedTypeFailure(result, fixed)
              : undefined;
          observed.diagnostics.push(
            note(
              admitted,
              intended === undefined
                ? "command-failed"
                : admitted.request.source.variant === "model-repair"
                  ? "observed-repair-ts2322"
                  : "observed-ts2322",
              command.step,
              intended === undefined
                ? "The approved command failed; no intended defect observation is established."
                : "The exact fixed TS2322 defect was observed.",
              intended !== undefined,
            ),
          );
          break;
        }
        if (
          command.step === "unit-tests" ||
          command.step === "contract-tests"
        ) {
          const summary = parseTestSummary(
            command.step === "unit-tests" ? "unit" : "contract",
            result,
          );
          observed.tests.push(summary);
          if (
            !exactTestCounts(result.stdout) ||
            summary.state !== "passed" ||
            summary.passed < 1 ||
            summary.failed !== 0 ||
            summary.skipped !== 0
          ) {
            observed.state = "error";
            observed.diagnostics.push(
              note(
                admitted,
                "test-summary-invalid",
                command.step,
                "Actual nonempty passing test results are required.",
              ),
            );
            break;
          }
        }
        if (
          command.step === "dependency-scan" ||
          command.step === "secret-scan"
        ) {
          const findings = parseTrivyFindings(
            command.step === "dependency-scan" ? "dependency" : "secret",
            result.stdout,
          );
          if (
            findings === undefined ||
            observed.findings.length + findings.length > 128
          ) {
            observed.state = "error";
            observed.diagnostics.push(
              note(
                admitted,
                "scan-invalid",
                command.step,
                "A valid actual scanner response is required.",
              ),
            );
            break;
          }
          observed.findings.push(...findings);
          if (
            findings.some(
              (finding) =>
                finding.source === "secret" ||
                ["critical", "high", "unknown"].includes(finding.severity),
            )
          ) {
            observed.state = "failed";
            observed.diagnostics.push(
              note(
                admitted,
                "scan-failed",
                command.step,
                "Actual scanner findings block host validation.",
              ),
            );
            break;
          }
        }
      }
      if (!current()) {
        observed.state = unavailableState();
        observed.diagnostics.push(
          note(
            admitted,
            "execution-ended",
            "runner",
            "The execution deadline or cancellation ended the run.",
          ),
        );
      }
      if (
        observed.state === "passed" &&
        admitted.request.source.variant === "invalid-seed"
      ) {
        observed.state = "error";
        observed.diagnostics.push(
          note(
            admitted,
            "expected-defect-absent",
            "typecheck",
            "The fixed invalid seed did not produce its required observed defect.",
          ),
        );
      }
      if (observed.state === "passed") {
        const produced = await session.readProducedFiles();
        if (!current())
          throw new Error("Execution ended before output admission.");
        observed.packed = packageHostRepairSeedOutput(admitted, produced);
      }
    } catch {
      observed.state = unavailableState();
      observed.diagnostics.push(
        note(
          admitted,
          "workspace-unavailable",
          "runner",
          "The bounded workspace or its output admission failed.",
        ),
      );
      // open() owns cleanup if initialization rejects. A rejection does not
      // prove successful cleanup, so keep it explicitly unestablished.
      if (!opening) observed.cleanup = "verified";
    } finally {
      if (session !== undefined) {
        try {
          await session.dispose();
          observed.cleanup = "verified";
        } catch {
          observed.state = "error";
          observed.cleanup = "not-established";
          observed.diagnostics.push(
            note(
              admitted,
              "cleanup-failed",
              "runner",
              "Owned workspace cleanup could not be verified.",
            ),
          );
        }
      }
      // Cleanup is never abandoned on abort. Its executor operations retain
      // the bounded cleanup grace, but overdue cleanup cannot yield pass.
      if (!current()) {
        observed.state = unavailableState();
        delete observed.packed;
      }
    }
    return observed;
  };
  try {
    if (
      admitted.request.source.files.some(
        (file) =>
          sourcePathIssue(file.path) !== undefined ||
          contentSecurityIssue(file.content) !== undefined,
      )
    ) {
      first.state = "blocked";
      first.cleanup = "verified";
      first.diagnostics.push(
        note(
          admitted,
          "source-not-admitted",
          "admission",
          "The fixed source failed pre-execution security admission.",
        ),
      );
    } else {
      first = await observe();
      if (first.state === "passed" && first.packed !== undefined && current()) {
        second = await observe();
        if (
          second.state !== "passed" ||
          second.packed === undefined ||
          second.cleanup !== "verified" ||
          !current()
        ) {
          first.state = second.state === "passed" ? "error" : second.state;
          first.diagnostics.push(
            note(
              admitted,
              "reproduction-failed",
              "reproducibility",
              "The independent second execution or its cleanup did not pass.",
            ),
          );
        } else if (
          !Buffer.from(first.packed.archive).equals(
            Buffer.from(second.packed.archive),
          )
        ) {
          first.state = "failed";
          first.diagnostics.push(
            note(
              admitted,
              "reproduction-different",
              "reproducibility",
              "Independent complete executions produced different ZIP bytes.",
            ),
          );
        } else {
          artifacts = createAdmittedHostRepairArtifacts(admitted, first.packed);
          reproducibility = {
            state: "verified",
            firstArchiveChecksum: sha256Digest(first.packed.archive),
            secondArchiveChecksum: sha256Digest(second.packed.archive),
          };
        }
      }
    }
  } catch {
    first.state = unavailableState();
    first.diagnostics.push(
      note(
        admitted,
        "artifact-unavailable",
        "package",
        "The exact host artifact could not be assembled.",
      ),
    );
  } finally {
    clearTimeout(timer);
  }
  if (!current()) {
    first.state = unavailableState();
    first.diagnostics.push(
      note(
        admitted,
        "deadline-or-cancellation",
        "runner",
        "The complete run did not finish within its one execution deadline.",
      ),
    );
  }
  const cleanup =
    first.cleanup === "verified" &&
    (second === undefined || second.cleanup === "verified")
      ? "verified"
      : "not-established";
  if (cleanup !== "verified") first.state = "error";
  if (first.state !== "passed") {
    artifacts = [];
    reproducibility = { state: "not-established" };
  }

  const body: HostRepairExecutionBody = {
    state: first.state,
    bindings: admitted.bindings,
    steps: first.steps,
    tests: first.tests,
    diagnostics: [...first.diagnostics, ...(second?.diagnostics ?? [])],
    findings: [...first.findings, ...(second?.findings ?? [])],
    artifacts,
    cleanup,
    reproducibility,
  };
  const observation = finish(body);
  if (observation.state === "passed" && !current()) {
    return finish({
      ...body,
      state: unavailableState(),
      artifacts: [],
      reproducibility: { state: "not-established" },
      diagnostics: [
        ...body.diagnostics,
        note(
          admitted,
          "final-admission-overdue",
          "runner",
          "Final host admission did not finish within the execution deadline.",
        ),
      ],
    });
  }
  return observation;
}

/** Historical fixed controls retain their exact admission and output contract. */
export function createApplicationHostRepairSeedRunner(input: {
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly config: ApplicationHostRepairSeedAdmissionConfig;
}): ApplicationHostRepairSeedRunner {
  const config = structuredClone(input.config);
  const executor = input.executor;
  return {
    async run(raw, options) {
      const started = performance.now();
      const admitted = inspectApplicationHostRepairSeedRequestV1(raw, config);
      return executeHostRepair(
        admitted,
        executor,
        started,
        (observation) => {
          const body = {
            ...observation,
            kind: "cloudmarkup.host-repair-seed-build.result",
            contractVersion: 1,
            origin: "fixed-host-synthetic",
            authority: "tool-observation-only",
          };
          return inspectApplicationHostRepairSeedResultV1(
            applicationHostRepairSeedBuildResultV1Schema.parse({
              ...body,
              reportDigest: sha256Digest(canonicalJson(body)),
            }),
            admitted.request,
            config,
          );
        },
        options,
      );
    },
  };
}
export interface ApplicationHostRepairCandidateRunner {
  run(
    raw: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationHostRepairCandidateBuildResultV1>;
}
/** Only the explicit bound-extension profile can reach candidate execution. */
export function createApplicationHostRepairCandidateRunner(input: {
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly config: ApplicationHostRepairCandidateAdmissionConfig;
}): ApplicationHostRepairCandidateRunner {
  const config = structuredClone(input.config);
  const executor = input.executor;
  return {
    async run(raw, options) {
      const started = performance.now();
      const admitted = inspectApplicationHostRepairCandidateRequestV1(
        raw,
        config,
      );
      return executeHostRepair(
        admitted,
        executor,
        started,
        (observation) => {
          const body = {
            ...observation,
            kind: "cloudmarkup.host-repair-candidate-build.result",
            contractVersion: 1,
            origin: "model-repair-of-fixed-host-seed",
            authority: "tool-observation-only",
          };
          return inspectApplicationHostRepairCandidateResultV1(
            applicationHostRepairCandidateBuildResultV1Schema.parse({
              ...body,
              reportDigest: sha256Digest(canonicalJson(body)),
            }),
            admitted.request,
            config,
          );
        },
        options,
      );
    },
  };
}

export interface ApplicationHostRepairSuccessorRunner {
  run(
    raw: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApplicationHostRepairSuccessorBuildResultV2>;
}
/** Only the explicit bound-extension profile can reach candidate execution. */
export function createApplicationHostRepairSuccessorRunner(input: {
  readonly executor: ApplicationBuildWorkspaceExecutor;
  readonly config: ApplicationHostRepairSuccessorAdmissionConfig;
}): ApplicationHostRepairSuccessorRunner {
  const config = structuredClone(input.config);
  const executor = input.executor;
  return {
    async run(raw, options) {
      const started = performance.now();
      const admitted = inspectApplicationHostRepairSuccessorRequestV2(
        raw,
        config,
      );
      return executeHostRepair(
        admitted,
        executor,
        started,
        (observation) => {
          const body = {
            ...observation,
            kind: "cloudmarkup.host-repair-candidate-build.result",
            contractVersion: 2,
            origin: "model-successor-of-host-repair",
            authority: "tool-observation-only",
          };
          return inspectApplicationHostRepairSuccessorResultV2(
            applicationHostRepairSuccessorBuildResultV2Schema.parse({
              ...body,
              reportDigest: sha256Digest(canonicalJson(body)),
            }),
            admitted.request,
            config,
          );
        },
        options,
      );
    },
  };
}
