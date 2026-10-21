import { createHash } from "node:crypto";
import { ApplicationError } from "./application/errors.js";

export type SolutionExportStage =
  | "initialize"
  | "delivery"
  | "inspect"
  | "claim"
  | "hydrate"
  | "execute"
  | "reconcile"
  | "recover"
  | "retry"
  | "audit";
export interface SolutionExportDiagnostic {
  readonly event: "solution-export-worker";
  readonly version: 1;
  readonly stage: SolutionExportStage;
  readonly outcome: "started" | "completed" | "pending" | "failed";
  readonly reference?: string;
  readonly durationMilliseconds?: number;
  readonly reason?: string;
}
export type SolutionExportDiagnostics = (
  event: SolutionExportDiagnostic,
) => void;

/** Emit only fixed vocabulary and one-way correlation. Never serialize an error,
 * queue body, tenant identity, statement, prompt, source or credential. */
export function solutionExportFailureReason(error: unknown): string {
  if (error instanceof ApplicationError) {
    switch (error.code) {
      case "access_denied":
        return "authorization-denied";
      case "not_found":
        return "execution-unavailable";
      case "conflict":
        return "stale-execution";
      case "invalid_request":
        return "invalid-request";
    }
  }
  if (error instanceof Error) {
    switch (error.name) {
      case "AccessDeniedException":
      case "AccessDenied":
        return "dependency-access-denied";
      case "ForbiddenException":
        return "dependency-access-denied";
      case "UnsupportedResultException":
        return "database-result-unsupported";
      case "DatabaseErrorException":
        return "database-error";
      case "DatabaseUnavailableException":
      case "ServiceUnavailableError":
        return "dependency-unavailable";
      case "ThrottlingException":
      case "TooManyRequestsException":
        return "dependency-throttled";
      case "TimeoutError":
      case "AbortError":
        return "dependency-timeout";
      case "ZodError":
      case "SyntaxError":
        return "invalid-input";
    }
  }
  return "unexpected-failure";
}
export function recordSolutionExportDiagnostic(
  sink: SolutionExportDiagnostics | undefined,
  stage: SolutionExportStage,
  outcome: SolutionExportDiagnostic["outcome"],
  reference?: string,
  elapsed?: number,
  error?: unknown,
): void {
  try {
    sink?.({
      event: "solution-export-worker",
      version: 1,
      stage,
      outcome,
      ...(reference === undefined
        ? {}
        : { reference: createHash("sha256").update(reference).digest("hex") }),
      ...(elapsed === undefined
        ? {}
        : { durationMilliseconds: Math.max(0, Math.round(elapsed)) }),
      ...(outcome === "failed"
        ? { reason: solutionExportFailureReason(error) }
        : {}),
    });
  } catch {
    // Diagnostic delivery cannot acknowledge, fail or replay durable work.
  }
}
export async function observeSolutionExportStage<T>(
  sink: SolutionExportDiagnostics | undefined,
  stage: SolutionExportStage,
  reference: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  recordSolutionExportDiagnostic(sink, stage, "started", reference);
  try {
    const result = await work();
    recordSolutionExportDiagnostic(
      sink,
      stage,
      "completed",
      reference,
      performance.now() - started,
    );
    return result;
  } catch (error) {
    recordSolutionExportDiagnostic(
      sink,
      stage,
      "failed",
      reference,
      performance.now() - started,
      error,
    );
    throw error;
  }
}
