import type {
  CreateGithubRepositoryImportV1,
  DiscoverGithubRepositoryV1,
  GithubRepositoryDiscoveryV1,
  GithubBranchV1,
  GithubInstallationV1,
  GithubRepositoryImportV1,
  GithubRepositoryV1,
} from "@cloudmarkup/api-contract";
import { Button, Disclosure } from "@cloudmarkup/ui";
import { useMemo, useState, type SyntheticEvent } from "react";

import { GitHubRepositoryFilePicker } from "./GitHubRepositoryFilePicker.js";
import "./github-repository-import.css";

export interface GitHubRepositoryImportSelection {
  readonly branch: string;
  readonly commitSha: string;
  readonly ignoredPaths: readonly string[];
  readonly integrationId: string;
  readonly previousImportId?: string;
  readonly repositoryId: number;
  readonly selectedPaths: readonly string[];
}

function paths(value: string): readonly string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
    ),
  ];
}

function ImportEvidencePanel({
  record,
}: {
  readonly record: GithubRepositoryImportV1;
}) {
  return (
    <section
      aria-label="Repository source and evidence"
      className="github-repository-import__evidence"
    >
      <header>
        <p className="status-label">Pinned evidence</p>
        <h3>Source, issues, and exact changes</h3>
        <p>
          Commit <code>{record.commitSha}</code> · Snapshot{" "}
          <code>{record.snapshotId}</code>
        </p>
      </header>
      {record.branchChangedSinceSelection ? (
        <p role="alert" className="github-repository-import__warning">
          The branch moved after this commit was selected. This snapshot still
          represents only the pinned commit; review actions require a fresh
          stale-state check.
        </p>
      ) : null}
      <div className="github-repository-import__evidence-grid">
        <section aria-labelledby="repository-source-files-title">
          <h4 id="repository-source-files-title">Selected files</h4>
          <ul>
            {record.files.map((file) => (
              <li key={file.path}>
                <strong>{file.path}</strong>
                <small>
                  {String(file.sizeBytes)} bytes · <code>{file.digest}</code>
                </small>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="repository-evidence-title">
          <h4 id="repository-evidence-title">Evidence references</h4>
          <ul>
            {record.sourceEvidence.map((evidence) => (
              <li key={evidence.evidenceId}>
                <strong>{evidence.path}</strong>
                <span>
                  Line {String(evidence.startLine)} · {evidence.confidence}
                </span>
                <small>{evidence.evidenceId}</small>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="repository-active-issues-title">
          <h4 id="repository-active-issues-title">
            Active issues ({String(record.issues.length)})
          </h4>
          {record.issues.length === 0 ? (
            <p>No active repository ambiguity or conformance issues.</p>
          ) : (
            <ul>
              {record.issues.map((issue) => (
                <li key={issue.issueId} data-severity={issue.severity}>
                  <strong>{issue.summary}</strong>
                  <span>{issue.severity}</span>
                  <small>
                    {issue.evidenceIds.join(", ") || "Evidence pending"}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="repository-file-diff-title">
          <h4 id="repository-file-diff-title">File diff</h4>
          <ul>
            {record.fileDifferences.map((difference) => (
              <li key={difference.path} data-change={difference.action}>
                <strong>{difference.path}</strong>
                <span>{difference.action}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {record.inferenceClaims.length > 0 ? (
        <section aria-labelledby="repository-inference-title">
          <h4 id="repository-inference-title">
            Observed-only inferred relationships
          </h4>
          <p>
            These claims are source-grounded proposals, not approved design.
            Acceptance is required before any design change.
          </p>
          <ul>
            {record.inferenceClaims.map((claim) => (
              <li key={claim.claimId} data-observed-only="true">
                <strong>{claim.summary}</strong>
                <span>
                  Confidence {String(claim.confidenceBasisPoints / 100)}%
                </span>
                <small>{claim.evidenceIds.join(", ")}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export function GitHubRepositoryImportPanel({
  assistanceMode,
  disabled = false,
  branches,
  history,
  installations,
  onConfigureWebhookRefresh,
  onDiscover,
  onImport,
  onRepositorySelectionChange,
  repositories,
}: {
  readonly assistanceMode: "guided" | "professional";
  readonly disabled?: boolean;
  readonly branches: readonly GithubBranchV1[];
  readonly history: readonly GithubRepositoryImportV1[];
  readonly installations: readonly GithubInstallationV1[];
  readonly onConfigureWebhookRefresh?: (
    selection: GitHubRepositoryImportSelection & { readonly enabled: boolean },
  ) => Promise<void> | void;
  readonly onDiscover?: (
    input: DiscoverGithubRepositoryV1,
  ) => Promise<GithubRepositoryDiscoveryV1>;
  readonly onImport: (
    input: CreateGithubRepositoryImportV1,
  ) => Promise<void> | void;
  readonly repositories: readonly GithubRepositoryV1[];
  readonly onRepositorySelectionChange?: (selection: {
    readonly integrationId: string;
    readonly repositoryId: number;
  }) => void;
}) {
  const [integrationId, setIntegrationId] = useState(
    installations[0]?.integrationId ?? "",
  );
  const availableRepositories = useMemo(
    () =>
      repositories.filter(
        (repository) => repository.integrationId === integrationId,
      ),
    [integrationId, repositories],
  );
  const [repositoryId, setRepositoryId] = useState(
    availableRepositories[0]?.repositoryId ?? 0,
  );
  const [branch, setBranch] = useState(branches[0]?.name ?? "");
  const selectedBranch = branches.find(
    (candidate) => candidate.name === branch,
  );
  const [commitSha, setCommitSha] = useState(selectedBranch?.sha ?? "");
  const [selectedPaths, setSelectedPaths] = useState(".");
  const [ignoredPaths, setIgnoredPaths] = useState(
    "node_modules\n.terraform\ndist\n.env",
  );
  const [previousImportId, setPreviousImportId] = useState("");
  const [webhookRefresh, setWebhookRefresh] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();

  const latest = [...history]
    .filter((record) => record.repositoryId === repositoryId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  const selection = (): GitHubRepositoryImportSelection => ({
    branch,
    commitSha,
    ignoredPaths: paths(ignoredPaths),
    integrationId,
    ...(previousImportId === "" ? {} : { previousImportId }),
    repositoryId,
    selectedPaths: paths(selectedPaths),
  });

  const handleSubmit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || submitting) return;
    setSubmitted(true);
    setSubmissionError(undefined);
    const value = selection();
    if (
      value.integrationId === "" ||
      value.repositoryId <= 0 ||
      value.branch === "" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value.commitSha) ||
      value.selectedPaths.length === 0 ||
      value.selectedPaths.length > 128 ||
      value.ignoredPaths.length > 128
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await onImport({
        branch: value.branch,
        commitSha: value.commitSha,
        contractVersion: 1,
        ignoredPaths: [...value.ignoredPaths],
        integrationId: value.integrationId,
        ...(value.previousImportId === undefined
          ? {}
          : { previousImportId: value.previousImportId }),
        repositoryId: value.repositoryId,
        requestedMode: assistanceMode,
        selectedPaths: [...value.selectedPaths],
      });
      if (webhookRefresh && onConfigureWebhookRefresh !== undefined) {
        await onConfigureWebhookRefresh({
          ...value,
          enabled: true,
        });
      }
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : "The repository import could not be completed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="GitHub repository import"
      className="github-repository-import"
      data-assistance-mode={assistanceMode}
    >
      <header>
        <p className="status-label">Import infrastructure code</p>
        <h2>Import Terraform or CloudFormation</h2>
        <p>
          Review Terraform or CloudFormation from GitHub alongside your saved
          design. Imports do not automatically become editable canvas resources.
          Unsupported resources and expressions stay in your original code and
          may need manual review. Your code is never executed or overwritten.
        </p>
      </header>
      <p>
        Local file upload is not available. Generated exports are based on your
        saved design; they do not reproduce every file or unsupported construct
        from an imported repository.
      </p>
      <form
        id="repository-import-form"
        tabIndex={-1}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <fieldset
          disabled={submitting}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <legend className="visually-hidden">
            Repository import selection
          </legend>
          <div className="github-repository-import__selection">
            <label>
              GitHub App installation
              <select
                value={integrationId}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setIntegrationId(next);
                  setSelectedPaths(".");
                  const first = repositories.find(
                    (repository) => repository.integrationId === next,
                  );
                  const nextRepositoryId = first?.repositoryId ?? 0;
                  setRepositoryId(nextRepositoryId);
                  setSelectedPaths(".");
                  onRepositorySelectionChange?.({
                    integrationId: next,
                    repositoryId: nextRepositoryId,
                  });
                }}
              >
                {installations.map((installation) => (
                  <option
                    key={installation.integrationId}
                    value={installation.integrationId}
                  >
                    {installation.accountLogin}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repository
              <select
                value={String(repositoryId)}
                onChange={(event) => {
                  const nextRepositoryId = Number(event.currentTarget.value);
                  setRepositoryId(nextRepositoryId);
                  setSelectedPaths(".");
                  onRepositorySelectionChange?.({
                    integrationId,
                    repositoryId: nextRepositoryId,
                  });
                }}
              >
                {availableRepositories.map((repository) => (
                  <option
                    key={repository.repositoryId}
                    value={String(repository.repositoryId)}
                  >
                    {repository.owner}/{repository.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Branch
              <select
                value={branch}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setBranch(name);
                  setSelectedPaths(".");
                  setCommitSha(
                    branches.find((candidate) => candidate.name === name)
                      ?.sha ?? "",
                  );
                }}
              >
                {branches.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pinned commit SHA
              <input
                aria-invalid={
                  submitted &&
                  !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commitSha)
                }
                maxLength={64}
                value={commitSha}
                onChange={(event) => {
                  setCommitSha(event.currentTarget.value);
                  setSelectedPaths(".");
                }}
              />
            </label>
          </div>
          {onDiscover === undefined ? null : (
            <GitHubRepositoryFilePicker
              key={JSON.stringify([
                integrationId,
                repositoryId,
                branch,
                commitSha,
                ignoredPaths,
              ])}
              input={{
                branch,
                commitSha,
                contractVersion: 1,
                ignoredPaths: [...paths(ignoredPaths)],
                integrationId,
                repositoryId,
                selectedPaths: ["."],
              }}
              onDiscover={onDiscover}
              onSelect={(selected) => {
                setSelectedPaths(selected.join("\n"));
              }}
            />
          )}
          <p>
            Import scope:{" "}
            {selectedPaths === "."
              ? "All eligible files"
              : String(paths(selectedPaths).length) +
                (paths(selectedPaths).length === 1
                  ? " selected path"
                  : " selected paths")}
          </p>
          {submitted &&
          (paths(selectedPaths).length === 0 ||
            paths(selectedPaths).length > 128 ||
            paths(ignoredPaths).length > 128) ? (
            <p role="alert">
              Choose between 1 and 128 import paths and no more than 128 ignored
              paths.
            </p>
          ) : null}
          <Disclosure summary="Choose files and import options">
            <div className="github-repository-import__scope">
              <label>
                Import scope (one repository-relative path per line)
                <textarea
                  rows={5}
                  value={selectedPaths}
                  onChange={(event) => {
                    setSelectedPaths(event.currentTarget.value);
                  }}
                />
              </label>
              <label>
                Ignored paths (never retrieved)
                <textarea
                  rows={5}
                  value={ignoredPaths}
                  onChange={(event) => {
                    setIgnoredPaths(event.currentTarget.value);
                  }}
                />
              </label>
            </div>
            <label>
              Compare with previous snapshot
              <select
                value={previousImportId}
                onChange={(event) => {
                  setPreviousImportId(event.currentTarget.value);
                }}
              >
                <option value="">No previous snapshot</option>
                {history
                  .filter(
                    (record) =>
                      record.repositoryId === repositoryId &&
                      record.state === "succeeded",
                  )
                  .map((record) => (
                    <option key={record.importId} value={record.importId}>
                      {record.branch} · {record.commitSha.slice(0, 12)} ·{" "}
                      {record.createdAt}
                    </option>
                  ))}
              </select>
            </label>
            {onConfigureWebhookRefresh === undefined ? (
              <p>
                Automatic refresh is not available here. Import a new commit
                when you want to check for changes.
              </p>
            ) : (
              <label className="github-repository-import__webhook">
                <input
                  checked={webhookRefresh}
                  type="checkbox"
                  onChange={(event) => {
                    setWebhookRefresh(event.currentTarget.checked);
                  }}
                />
                Refresh automatically for verified push events on this exact
                repository and branch
              </label>
            )}
          </Disclosure>
          <div className="github-repository-import__actions">
            <Button disabled={disabled} loading={submitting} type="submit">
              {previousImportId === ""
                ? "Import pinned commit"
                : "Refresh at commit"}
            </Button>
            {selectedBranch !== undefined ? (
              <span>
                Current selected branch head: <code>{selectedBranch.sha}</code>
              </span>
            ) : null}
          </div>
        </fieldset>
      </form>
      {submissionError === undefined ? null : (
        <p className="github-repository-import__warning" role="alert">
          {submissionError}
        </p>
      )}
      <section aria-labelledby="repository-import-history-title">
        <h3 id="repository-import-history-title">
          Snapshot history ({String(history.length)})
        </h3>
        {history.length === 0 ? (
          <p>No repository snapshots have been created.</p>
        ) : (
          <ol className="github-repository-import__history">
            {history.map((record) => (
              <li key={record.importId}>
                <strong>
                  {record.branch} · {record.commitSha.slice(0, 12)}
                </strong>
                <span>{record.state}</span>
                <small>
                  {record.trigger} · {record.createdAt}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
      {latest === undefined ? null : <ImportEvidencePanel record={latest} />}
    </section>
  );
}
