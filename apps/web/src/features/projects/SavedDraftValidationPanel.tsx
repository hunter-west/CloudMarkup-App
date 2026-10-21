import {
  ApiClientError,
  createValidationRunV1Schema,
  validationRunV1Schema,
  type CreateValidationRunV1,
  type CurrentPrincipalV1,
  type ProjectV1,
  type ValidationRunV1,
} from "@cloudmarkup/api-contract";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";

interface ValidationAttempt {
  readonly body: CreateValidationRunV1;
  readonly idempotencyKey: string;
}

function bindRun(
  value: unknown,
  projectId: string,
  attempt: ValidationAttempt,
  runId?: string,
): ValidationRunV1 {
  const run = validationRunV1Schema.parse(value);
  const expected = attempt.body.input;
  if (
    run.projectId !== projectId ||
    (runId !== undefined && run.id !== runId) ||
    run.target !== attempt.body.target ||
    run.input.kind !== "draft" ||
    expected.kind !== "draft" ||
    run.input.draftId !== expected.draftId ||
    run.input.draftVersion !== expected.draftVersion ||
    (run.status === "succeeded" && run.summary?.reportId !== run.id)
  ) {
    throw new Error("Validation response did not match the saved draft.");
  }
  return run;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.envelope.error.code) {
      case "precondition_failed":
        return "The saved draft changed before validation started. Reload the project and validate its current version.";
      case "authentication_required":
        return "Your session expired. Sign in again to continue.";
      case "access_denied":
        return "Your account no longer has permission to run validation.";
      case "not_found":
        return "This project or validation is no longer available.";
      case "invalid_request":
        return "This saved draft cannot be validated with the current catalog. Review it in the editor first.";
    }
  }
  return "The validation result could not be confirmed. Retry the same validation to recover its saved result.";
}

export function SavedDraftValidationPanel({
  organizationId,
  principal,
  project,
  onReloadProject,
}: {
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly project: ProjectV1;
  readonly onReloadProject: () => Promise<void>;
}) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const [environment, setEnvironment] =
    useState<CreateValidationRunV1["environment"]>("unknown");
  const [result, setResult] = useState<ValidationRunV1 | null>(null);
  const attempt = useRef<ValidationAttempt | null>(null);
  const [savedAttempt, setSavedAttempt] = useState<ValidationAttempt | null>(
    null,
  );
  const allowed =
    runtime !== null &&
    !runtime.sessionExpired &&
    project.organizationId === organizationId &&
    project.lifecycleStatus === "active" &&
    principal.organizationContexts.some(
      (context) =>
        context.organizationId === organizationId &&
        context.capabilities.includes("projects.read") &&
        context.capabilities.includes("validation.run"),
    );

  const runValidation = useMutation({
    mutationFn: async (input: ValidationAttempt) => {
      if (!allowed) throw new Error("Validation is unavailable.");
      const response = await runtime.client.request("validation-runs.create", {
        body: input.body,
        headers: { "idempotency-key": input.idempotencyKey },
        path: { projectId: project.id },
      });
      return bindRun(response.data, project.id, input);
    },
    onSuccess: setResult,
    retry: false,
  });
  const refreshValidation = useMutation({
    mutationFn: async () => {
      if (!allowed || result === null || attempt.current === null)
        throw new Error("Validation is unavailable.");
      const response = await runtime.client.request("validation-runs.get", {
        path: { projectId: project.id, validationRunId: result.id },
      });
      return bindRun(response.data, project.id, attempt.current, result.id);
    },
    onSuccess: setResult,
    retry: false,
  });
  const reloadProject = useMutation({
    mutationFn: onReloadProject,
    onSuccess: () => {
      attempt.current = null;
      setSavedAttempt(null);
      setResult(null);
      runValidation.reset();
      refreshValidation.reset();
    },
    retry: false,
  });

  if (!allowed) return null;
  const busy =
    runValidation.isPending ||
    refreshValidation.isPending ||
    reloadProject.isPending;
  const completed =
    result !== null &&
    ["succeeded", "failed", "canceled"].includes(result.status);
  const error =
    runValidation.error ?? refreshValidation.error ?? reloadProject.error;
  const source = savedAttempt?.body.input;
  const sourceChanged =
    source?.kind === "draft" &&
    (source.draftId !== project.currentDraft.id ||
      source.draftVersion !== project.currentDraft.version);
  const needsReload =
    runValidation.error instanceof ApiClientError &&
    runValidation.error.envelope.error.code === "precondition_failed";

  function startValidation() {
    if (!allowed || busy) return;
    if (attempt.current === null || completed) {
      attempt.current = {
        body: createValidationRunV1Schema.parse({
          contractVersion: 1,
          environment,
          input: {
            kind: "draft",
            draftId: project.currentDraft.id,
            draftVersion: project.currentDraft.version,
          },
          target: "draft",
        }),
        idempotencyKey: `validation:${globalThis.crypto.randomUUID()}`,
      };
      setResult(null);
      setSavedAttempt(attempt.current);
    }
    refreshValidation.reset();
    runValidation.mutate(attempt.current);
  }

  return (
    <section
      className="feature-card"
      aria-labelledby="saved-draft-validation-title"
    >
      <p className="status-label">Server validation</p>
      <h2 id="saved-draft-validation-title">Validate the saved draft</h2>
      <p>
        Check saved version {project.currentDraft.version} against the reviewed
        AWS rules. Unsaved canvas changes are excluded.
      </p>
      <details>
        <summary>Validation context</summary>
        <label className="field">
          <span>Environment for checks</span>
          <select
            value={environment}
            disabled={busy || (savedAttempt !== null && !completed)}
            onChange={(event) => {
              setEnvironment(
                createValidationRunV1Schema.shape.environment.parse(
                  event.currentTarget.value,
                ),
              );
            }}
          >
            <option value="unknown">Not specified</option>
            <option value="development">Development</option>
            <option value="test">Test</option>
            <option value="staging">Staging</option>
            <option value="production">Production</option>
            <option value="disaster-recovery">Disaster recovery</option>
            <option value="multi-environment">Multiple environments</option>
          </select>
        </label>
        <p className="fine-print">
          This sets the context for rule severity. It does not change the
          architecture or create an environment.
        </p>
      </details>
      {error === null ? null : <p role="alert">{messageFor(error)}</p>}
      {sourceChanged ? (
        <p role="status">
          This validation is bound to saved version {source.draftVersion}. The
          current saved draft is version {project.currentDraft.version}.
        </p>
      ) : null}
      <div className="form-actions">
        {needsReload ? (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              reloadProject.mutate();
            }}
          >
            Reload project
          </button>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={startValidation}
          >
            {runValidation.isPending
              ? "Validating saved draft…"
              : savedAttempt !== null && !completed
                ? "Retry same validation"
                : "Validate saved draft"}
          </button>
        )}
        {result === null ? null : (
          <button
            className="button button--quiet"
            type="button"
            disabled={busy}
            onClick={() => {
              refreshValidation.mutate();
            }}
          >
            Refresh validation status
          </button>
        )}
      </div>
      {result === null ? null : (
        <div className="section-stack" aria-live="polite">
          <p className="fine-print">
            Saved version{" "}
            {source?.kind === "draft" ? source.draftVersion : "unknown"} ·
            Validation context: {savedAttempt?.body.environment ?? "unknown"}
          </p>
          <p role="status">
            {result.status === "succeeded"
              ? result.summary?.complete === true
                ? "Validation completed."
                : "Validation completed with incomplete evidence. Do not treat this as a clean result."
              : `Validation status: ${result.status}.`}
          </p>
          {result.summary === undefined ? null : (
            <>
              <p>
                {result.summary.findingCounts.error +
                  result.summary.findingCounts.securityError}{" "}
                errors ·{" "}
                {result.summary.findingCounts.warning +
                  result.summary.findingCounts.costWarning}{" "}
                warnings ·{" "}
                {result.summary.findingCounts.recommendation +
                  result.summary.findingCounts.educationalNote}{" "}
                notes
              </p>
              <details>
                <summary>
                  Review findings ({result.summary.findings.length})
                </summary>
                {result.summary.findings.length === 0 ? (
                  <p>No findings were returned for this saved draft.</p>
                ) : (
                  <ul>
                    {result.summary.findings.map((finding) => (
                      <li key={finding.id}>
                        <strong>{finding.title}</strong> — {finding.severity}
                        <details>
                          <summary>Affected resources</summary>
                          <ul>
                            {finding.affectedPaths.map((path) => (
                              <li key={path}>
                                <code>{path}</code>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
