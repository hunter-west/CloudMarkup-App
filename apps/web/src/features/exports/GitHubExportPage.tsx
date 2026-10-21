import { coverageLabel } from "./generation-coverage-label.js";
import {
  ApiClientError,
  type ApiResponseV1,
  type CompleteGithubAppInstallationLinkV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import {
  Button,
  CodeBlock,
  LoadingState,
  StatePanel,
  StatusBadge,
  Tabs,
  type StatusTone,
  type TabItem,
} from "@cloudmarkup/ui";
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useModePreference } from "../../preferences/mode-preference-context.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { readAndRemoveGitHubInstallationLinkCallback } from "./github-installation-link-callback.js";
import { subscribeToGitHubInstallationLinkCallback } from "./github-installation-link-relay.js";

import "./github-export.css";
import "./solution-export.css";

type GitHubInstallation =
  ApiResponseV1<"github-installations.list">["data"][number];
type GitHubInstallationLinkIntent =
  ApiResponseV1<"github-installation-link-intents.create">["data"];
type GitHubInstallationLinkCompletionStatus =
  "idle" | "pending" | "succeeded" | "failed";
type GitHubPreview = ApiResponseV1<"github-export-previews.create">["data"];
type GitHubReceipt = ApiResponseV1<"github-exports.create">["data"];
type RepositoryWorkflows = NonNullable<GitHubPreview["repositoryWorkflows"]>;
type SolutionArtifact = ApiResponseV1<"solution-export-artifacts.get">["data"];
type SolutionArtifactFile = SolutionArtifact["files"][number];
type SolutionJob = ApiResponseV1<"solution-export-jobs.get">["data"];
type SolutionFilePreview =
  ApiResponseV1<"solution-export-artifacts.file-preview">["data"];
type SolutionDiff = ApiResponseV1<"solution-export-artifacts.diff">["data"];
type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];

interface VerifiedGitHubExportContext {
  readonly organization: OrganizationContext;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

interface GitHubInstallationLinkCallbackScope {
  readonly artifactId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly projectId: string;
}

interface PendingGitHubInstallationLinkCallback {
  readonly callback: CompleteGithubAppInstallationLinkV1;
  readonly scope: GitHubInstallationLinkCallbackScope;
}

let pendingGitHubInstallationLinkCallback:
  PendingGitHubInstallationLinkCallback | undefined;

function sameGitHubInstallationLinkCallbackScope(
  left: GitHubInstallationLinkCallbackScope,
  right: GitHubInstallationLinkCallbackScope,
): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.organizationId === right.organizationId &&
    left.principalId === right.principalId &&
    left.projectId === right.projectId
  );
}

function captureGitHubInstallationLinkCallback(
  scope: GitHubInstallationLinkCallbackScope | undefined,
): void {
  const captured = readAndRemoveGitHubInstallationLinkCallback();
  if (!captured.present) return;
  pendingGitHubInstallationLinkCallback =
    captured.callback === undefined || scope === undefined
      ? undefined
      : { callback: captured.callback, scope };
}

function claimGitHubInstallationLinkCallback(
  scope: GitHubInstallationLinkCallbackScope,
): CompleteGithubAppInstallationLinkV1 | undefined {
  const pending = pendingGitHubInstallationLinkCallback;
  pendingGitHubInstallationLinkCallback = undefined;
  if (
    pending === undefined ||
    !sameGitHubInstallationLinkCallbackScope(pending.scope, scope)
  ) {
    return undefined;
  }
  return pending.callback;
}

export interface GitHubExportPageProps {
  readonly artifactId: string;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
  readonly projectId: string;
}

type PackageCategory =
  | "cloudmarkup"
  | "application"
  | "infrastructure"
  | "diagrams"
  | "contracts"
  | "manifest"
  | "evidence"
  | "workflows";

const PACKAGE_CATEGORIES: readonly {
  readonly id: PackageCategory;
  readonly label: string;
  readonly empty: string;
}[] = [
  {
    id: "cloudmarkup",
    label: "CloudMarkup source",
    empty: "No architecture-as-code source is present.",
  },
  {
    id: "application",
    label: "Application",
    empty: "No supported application source or tests are present.",
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    empty: "No generated infrastructure source is present.",
  },
  {
    id: "diagrams",
    label: "Diagrams",
    empty: "No revision-bound SVG or PNG diagram is present.",
  },
  {
    id: "contracts",
    label: "Contracts",
    empty: "No Workload or application contracts are present.",
  },
  {
    id: "manifest",
    label: "Manifest & lock",
    empty: "No manifest or lock file is present.",
  },
  {
    id: "evidence",
    label: "Validation & Evidence",
    empty: "No validation or Evidence artifact is present.",
  },
  {
    id: "workflows",
    label: "CI workflows",
    empty: "No approved pull-request workflow is present.",
  },
];

class GitHubExportBindingError extends Error {
  public constructor() {
    super("The GitHub export response did not match the requested scope.");
    this.name = "GitHubExportBindingError";
  }
}

function projectPath(organizationId: string, projectId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects/${encodeRouteSelector(projectId)}`;
}

function contextFor(
  props: GitHubExportPageProps,
  runtime: CloudMarkupQueryRuntime | null,
): VerifiedGitHubExportContext | "unavailable" | null {
  if (props.organizationId === undefined && props.principal === undefined) {
    return null;
  }
  if (
    props.organizationId === undefined ||
    props.principal === undefined ||
    runtime === null
  ) {
    return "unavailable";
  }
  const organization = props.principal.organizationContexts.find(
    (candidate) => candidate.organizationId === props.organizationId,
  );
  if (organization === undefined) return "unavailable";
  return {
    organization,
    organizationId: props.organizationId,
    principal: props.principal,
    runtime,
  };
}

function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof GitHubExportBindingError) return false;
  if (
    error instanceof ApiClientError &&
    [
      "authentication_required",
      "access_denied",
      "invalid_request",
      "not_found",
    ].includes(error.envelope.error.code)
  ) {
    return false;
  }
  return failureCount < 1;
}

function errorMessage(error: unknown, action: string): string {
  if (error instanceof GitHubExportBindingError) {
    return `CloudMarkup rejected a mismatched ${action} response.`;
  }
  if (!(error instanceof ApiClientError)) {
    return `CloudMarkup could not ${action}.`;
  }
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session expired. Sign in again to continue.";
    case "access_denied":
      return "Your role, organization policy, or current plan does not allow this GitHub export action.";
    case "not_found":
      return "The installation, repository, artifact, or preview is no longer available.";
    case "conflict":
    case "idempotency_key_reused":
      return "Repository state or approval changed. Review a fresh preview before continuing.";
    case "rate_limited":
      return "GitHub is rate limiting this installation. Retry safely after the suggested delay.";
    case "service_unavailable":
      return "GitHub export is temporarily unavailable. A safe retry will reuse the same request identity.";
    default:
      return `CloudMarkup could not ${action}.`;
  }
}

function assertArtifact(
  artifact: SolutionArtifact,
  projectId: string,
  artifactId: string,
): void {
  if (artifact.projectId !== projectId || artifact.id !== artifactId) {
    throw new GitHubExportBindingError();
  }
}

function assertJob(job: SolutionJob, artifact: SolutionArtifact): void {
  if (
    job.projectId !== artifact.projectId ||
    job.id !== artifact.jobId ||
    job.artifact?.artifactId !== artifact.id ||
    job.artifact.digest !== artifact.digest ||
    job.solutionRevision.solutionRevisionId !== artifact.solutionRevisionId
  ) {
    throw new GitHubExportBindingError();
  }
}

function assertFilePreview(
  preview: SolutionFilePreview,
  artifact: SolutionArtifact,
  file: SolutionArtifactFile,
): void {
  if (
    preview.artifactId !== artifact.id ||
    preview.fileId !== file.id ||
    preview.path !== file.path ||
    preview.checksum !== file.checksum
  ) {
    throw new GitHubExportBindingError();
  }
}

function assertSolutionDiff(
  diff: SolutionDiff,
  artifact: SolutionArtifact,
): void {
  if (
    diff.artifactId !== artifact.id ||
    (diff.previousArtifactId !== undefined &&
      diff.previousArtifactId !== artifact.previousArtifactId)
  ) {
    throw new GitHubExportBindingError();
  }
}

function assertPreview(
  preview: GitHubPreview,
  input: {
    readonly artifactId: string;
    readonly integrationId: string;
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId: number;
  },
): void {
  if (
    preview.artifactId !== input.artifactId ||
    preview.integrationId !== input.integrationId ||
    preview.organizationId !== input.organizationId ||
    preview.projectId !== input.projectId ||
    preview.repositoryId !== input.repositoryId
  ) {
    throw new GitHubExportBindingError();
  }
}

function assertReceipt(receipt: GitHubReceipt, preview: GitHubPreview): void {
  if (
    receipt.organizationId !== preview.organizationId ||
    receipt.projectId !== preview.projectId ||
    receipt.repositoryId !== preview.repositoryId ||
    receipt.previewDigest !== preview.previewDigest ||
    receipt.branch !== preview.featureBranch
  ) {
    throw new GitHubExportBindingError();
  }
}

function safeSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 72)
    .replace(/[.-]+$/gu, "");
  return slug.length === 0 ? "solution" : slug;
}

function defaultDestination(artifact: SolutionArtifact): string {
  return `cloudmarkup/${safeSlug(artifact.solutionRevisionId)}`;
}

function defaultFeatureBranch(artifact: SolutionArtifact): string {
  return `cloudmarkup/${safeSlug(artifact.solutionRevisionId)}`;
}

function words(value: string): string {
  return value.replaceAll("-", " ");
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${String(value)} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function packageCategory(path: string): PackageCategory {
  if (path.startsWith(".github/workflows/")) return "workflows";
  if (path.startsWith("diagram/")) return "diagrams";
  if (path.startsWith("infrastructure/")) return "infrastructure";
  if (path.startsWith("application/")) return "application";
  if (
    path.includes("contract") ||
    path.includes("workload") ||
    path.includes("external-resource")
  ) {
    return "contracts";
  }
  if (
    path.includes("evidence") ||
    path.includes("validation") ||
    path.includes("coverage")
  ) {
    return "evidence";
  }
  if (
    path === "README.md" ||
    path.includes("manifest") ||
    path.includes("lock") ||
    path.endsWith(".sha256")
  ) {
    return "manifest";
  }
  return "cloudmarkup";
}

function previewLanguage(path: string, mediaType: string): string {
  if (mediaType.includes("json")) return "json";
  if (mediaType.includes("yaml") || /\.ya?ml$/u.test(path)) return "yaml";
  if (mediaType.includes("terraform") || path.endsWith(".tf")) return "hcl";
  if (/\.tsx?$/u.test(path)) return "typescript";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".svg")) return "xml";
  return "text";
}

function toneForAction(
  action: GitHubPreview["changes"][number]["action"],
): StatusTone {
  switch (action) {
    case "add":
      return "success";
    case "modify":
      return "info";
    case "delete":
      return "warning";
    case "preserve":
      return "incomplete";
    case "unchanged":
      return "neutral";
  }
}

function iacTargetLabel(profileId: string): string {
  if (profileId.includes("terraform")) return "Terraform";
  if (profileId.includes("cloudformation")) return "CloudFormation";
  return profileId;
}

function GitHubUnavailable({
  artifactId,
  projectId,
}: {
  readonly artifactId: string;
  readonly projectId: string;
}) {
  return (
    <RoutePage
      title="GitHub export"
      eyebrow="Authenticated backend required"
      description="GitHub repository authority is unavailable in this presentation runtime."
      routeKey={`github-export-unavailable-${projectId}-${artifactId}`}
    >
      <StatePanel
        kind="unsupported"
        title="GitHub export is not connected"
        description="No installation, token, repository, branch, commit, pull request, workflow, or deployment action is available."
      />
    </RoutePage>
  );
}

export function GitHubExportPage(props: GitHubExportPageProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const context = contextFor(props, runtime);
  captureGitHubInstallationLinkCallback(
    context === null || context === "unavailable"
      ? undefined
      : {
          artifactId: props.artifactId,
          organizationId: context.organizationId,
          principalId: context.principal.id,
          projectId: props.projectId,
        },
  );
  if (context === null || context === "unavailable") {
    return (
      <GitHubUnavailable
        artifactId={props.artifactId}
        projectId={props.projectId}
      />
    );
  }
  return (
    <AuthenticatedGitHubExportPage
      artifactId={props.artifactId}
      context={context}
      projectId={props.projectId}
    />
  );
}

function AuthenticatedGitHubExportPage({
  artifactId,
  context,
  projectId,
}: {
  readonly artifactId: string;
  readonly context: VerifiedGitHubExportContext;
  readonly projectId: string;
}) {
  const { mode } = useModePreference();
  const canExport = context.organization.capabilities.includes("exports.run");
  const canReadIntegrations =
    context.organization.capabilities.includes("integrations.read");
  const canManageIntegrations = context.organization.capabilities.includes(
    "integrations.manage",
  );
  const installationsQueryKey = cloudMarkupQueryKeys.githubInstallations(
    context.principal.id,
    context.organizationId,
  );
  const installations = useQuery({
    enabled: canExport && canReadIntegrations,
    queryKey: installationsQueryKey,
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "github-installations.list",
        { path: { organizationId: context.organizationId } },
      );
      if (
        response.data.some(
          (item) => item.organizationId !== context.organizationId,
        )
      ) {
        throw new GitHubExportBindingError();
      }
      return response.data;
    },
    retry: retryQuery,
  });
  const installationLinkCompletionStatusKey = [
    ...installationsQueryKey,
    "link-completion-status",
  ] as const;
  const installationLinkCompletionStatus =
    useQuery<GitHubInstallationLinkCompletionStatus>({
      enabled: false,
      initialData: "idle",
      queryFn: () => Promise.resolve("idle"),
      queryKey: installationLinkCompletionStatusKey,
    });
  const installationLinkCompletionAttempted = useRef(false);
  const completeInstallationLink = useMutation({
    mutationFn: async (callback: CompleteGithubAppInstallationLinkV1) => {
      context.runtime.queryClient.setQueryData<GitHubInstallationLinkCompletionStatus>(
        installationLinkCompletionStatusKey,
        "pending",
      );
      try {
        const response = await context.runtime.client.request(
          "github-installation-link-completions.create",
          {
            body: callback,
            path: { organizationId: context.organizationId },
          },
        );
        if (response.data.organizationId !== context.organizationId) {
          throw new GitHubExportBindingError();
        }
        await context.runtime.queryClient.cancelQueries({
          exact: true,
          queryKey: installationsQueryKey,
        });
        await context.runtime.queryClient.refetchQueries({
          exact: true,
          queryKey: installationsQueryKey,
          type: "all",
        });
        context.runtime.queryClient.setQueryData<GitHubInstallationLinkCompletionStatus>(
          installationLinkCompletionStatusKey,
          "succeeded",
        );
        return response.data;
      } catch (error) {
        context.runtime.queryClient.setQueryData<GitHubInstallationLinkCompletionStatus>(
          installationLinkCompletionStatusKey,
          "failed",
        );
        throw error;
      }
    },
  });
  const completeInstallationLinkMutate = completeInstallationLink.mutate;
  useEffect(() => {
    const callback = claimGitHubInstallationLinkCallback({
      artifactId,
      organizationId: context.organizationId,
      principalId: context.principal.id,
      projectId,
    });
    if (callback === undefined || !canManageIntegrations) return;
    if (installationLinkCompletionAttempted.current) return;
    installationLinkCompletionAttempted.current = true;
    completeInstallationLinkMutate(callback);
  }, [
    artifactId,
    canManageIntegrations,
    completeInstallationLinkMutate,
    context.organizationId,
    context.principal.id,
    projectId,
  ]);
  const artifact = useQuery({
    queryKey: cloudMarkupQueryKeys.solutionExportArtifact(
      context.principal.id,
      context.organizationId,
      projectId,
      artifactId,
    ),
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-export-artifacts.get",
        { path: { projectId, solutionExportArtifactId: artifactId } },
      );
      assertArtifact(response.data, projectId, artifactId);
      return response.data;
    },
    retry: retryQuery,
  });
  const job = useQuery({
    enabled: artifact.data !== undefined,
    queryKey: [
      ...cloudMarkupQueryKeys.solutionExportArtifact(
        context.principal.id,
        context.organizationId,
        projectId,
        artifactId,
      ),
      "job",
      artifact.data?.jobId ?? "unavailable",
    ] as const,
    queryFn: async () => {
      if (artifact.data === undefined) throw new GitHubExportBindingError();
      const response = await context.runtime.client.request(
        "solution-export-jobs.get",
        {
          path: {
            projectId,
            solutionExportJobId: artifact.data.jobId,
          },
        },
      );
      assertJob(response.data, artifact.data);
      return response.data;
    },
    retry: retryQuery,
  });

  if (artifact.isPending || job.isPending) {
    return (
      <RoutePage
        title="GitHub export"
        eyebrow="Loading approved package"
        description="Reading the immutable artifact before any repository action is offered."
        routeKey={`github-export-${projectId}-${artifactId}`}
      >
        <LoadingState live="polite" title="Loading approved Solution package" />
      </RoutePage>
    );
  }
  if (artifact.isError || job.isError) {
    return (
      <RoutePage
        title="GitHub export"
        eyebrow="Artifact unavailable"
        description="No repository operation was performed."
        routeKey={`github-export-${projectId}-${artifactId}`}
      >
        <StatePanel
          actions={
            <Button
              onClick={() => {
                void artifact.refetch();
                void job.refetch();
              }}
            >
              Try again
            </Button>
          }
          kind="error"
          live="assertive"
          title="Approved package could not be loaded"
          description={errorMessage(
            artifact.error ?? job.error,
            "load the approved package",
          )}
        />
      </RoutePage>
    );
  }

  return (
    <RoutePage
      title="Export to GitHub"
      eyebrow="Reviewed feature branch and pull request"
      description="Review the exact immutable package and complete repository diff before authorizing one idempotent pull request."
      routeKey={`github-export-${projectId}-${artifactId}`}
    >
      <div className="github-export" data-assistance-mode={mode}>
        <p className="github-export__assistance">
          {mode === "guided"
            ? "A feature branch keeps these files separate from the repository's default branch. A pull request lets your team review them; CloudMarkup cannot merge or deploy it."
            : "Publication is bound to the selected base SHA, artifact digest, preview digest, create-only head ref, and idempotency key."}
        </p>
        <PackageReadiness artifact={artifact.data} job={job.data} mode={mode} />
        <PackageReview
          artifact={artifact.data}
          context={context}
          job={job.data}
          projectId={projectId}
        />
        {!canExport ? (
          <StatePanel
            kind="permission-denied"
            title="Export permission required"
            description="Viewers can review the approved package but cannot inspect GitHub installations or create repository previews, branches, commits, or pull requests."
          />
        ) : !canReadIntegrations ? (
          <StatePanel
            kind="permission-denied"
            title="GitHub installation access required"
            description="Your organization role can run exports but cannot read an authorized GitHub App installation. Ask an administrator to review organization access."
          />
        ) : (
          <GitHubWorkflow
            artifact={artifact.data}
            canManageIntegrations={canManageIntegrations}
            completeInstallationLink={completeInstallationLink}
            context={context}
            installationLinkCompletionStatus={
              installationLinkCompletionStatus.data
            }
            installations={installations}
            job={job.data}
            projectId={projectId}
          />
        )}
      </div>
    </RoutePage>
  );
}

function PackageReadiness({
  artifact,
  job,
  mode,
}: {
  readonly artifact: SolutionArtifact;
  readonly job: SolutionJob;
  readonly mode: "guided" | "professional";
}) {
  const passedEvidence = job.evidence.filter(
    (entry) => entry.status === "passed",
  ).length;
  const failedEvidence = job.evidence.filter(
    (entry) => entry.status === "failed",
  ).length;
  return (
    <section
      className="feature-card github-export__readiness"
      aria-labelledby="github-export-readiness-title"
    >
      <p className="status-label">Exact approved package</p>
      <h2 id="github-export-readiness-title">
        Generation and validation status
      </h2>
      <div className="github-export__summary-grid">
        <div>
          <span>IaC target</span>
          <strong>{iacTargetLabel(job.target.profileId)}</strong>
        </div>
        <div>
          <span>Diagram profile</span>
          <strong>{words(job.target.diagram.profile)}</strong>
        </div>
        <div>
          <span>Generation coverage</span>
          <strong>{coverageLabel(job.generationCoverage.state)}</strong>
        </div>
        <div>
          <span>Validation / Evidence</span>
          <strong>
            {String(passedEvidence)} passed · {String(failedEvidence)} failed
          </strong>
        </div>
      </div>
      <p>
        {mode === "guided"
          ? "Generated files can be replaced only when their recorded baseline still matches. User-owned files stay yours and block silent replacement."
          : "Target and diagram selections are immutable artifact inputs. Select another Solution Export to change either before GitHub publication."}
      </p>
      {job.warnings.length > 0 || artifact.warnings.length > 0 ? (
        <ul className="github-export__issues" aria-label="Package warnings">
          {[...job.warnings, ...artifact.warnings].map((warning, index) => (
            <li key={`${warning.code}-${String(index)}`}>
              <StatusBadge label="warning" tone="warning" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">
          The immutable package has no recorded export warning.
        </p>
      )}
      <details>
        <summary>Technical details</summary>
        <dl className="github-export__technical-grid">
          <div>
            <dt>Artifact ID</dt>
            <dd>
              <code>{artifact.id}</code>
            </dd>
          </div>
          <div>
            <dt>Artifact digest</dt>
            <dd>
              <code>{artifact.digest}</code>
            </dd>
          </div>
          <div>
            <dt>Manifest digest</dt>
            <dd>
              <code>{artifact.manifestDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Solution Revision</dt>
            <dd>
              <code>{artifact.solutionRevisionId}</code>
            </dd>
          </div>
          <div>
            <dt>Target profile</dt>
            <dd>
              <code>{job.target.profileId}</code>
            </dd>
          </div>
          <div>
            <dt>Target settings</dt>
            <dd>
              <code>{job.target.settingsDigest}</code>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function PackageReview({
  artifact,
  context,
  job,
  projectId,
}: {
  readonly artifact: SolutionArtifact;
  readonly context: VerifiedGitHubExportContext;
  readonly job: SolutionJob;
  readonly projectId: string;
}) {
  const [category, setCategory] = useState<PackageCategory>("cloudmarkup");
  const filesByCategory = useMemo(() => {
    const result = new Map<PackageCategory, SolutionArtifactFile[]>();
    for (const item of PACKAGE_CATEGORIES) result.set(item.id, []);
    for (const file of artifact.files) {
      result.get(packageCategory(file.path))?.push(file);
    }
    for (const files of result.values()) {
      files.sort((left, right) => left.path.localeCompare(right.path, "en"));
    }
    return result;
  }, [artifact.files]);
  const items: readonly TabItem[] = PACKAGE_CATEGORIES.map((item) => ({
    id: item.id,
    label: item.label,
    panel: (
      <PackageFilePanel
        artifact={artifact}
        context={context}
        empty={item.empty}
        files={filesByCategory.get(item.id) ?? []}
        projectId={projectId}
        title={item.label}
      />
    ),
  }));
  return (
    <section
      className="feature-card github-export__package"
      aria-labelledby="github-export-package-title"
    >
      <p className="status-label">Package preview</p>
      <h2 id="github-export-package-title">Everything proposed for GitHub</h2>
      <p>
        Review the infrastructure files, diagrams, and any source or tests
        included in this exact package. Its manifest lists the included files
        and evidence. GitHub export does not regenerate or rebuild them.
      </p>
      <Tabs
        ariaLabel="GitHub export package tree"
        items={items}
        onValueChange={(value) => {
          setCategory(value as PackageCategory);
        }}
        value={category}
      />
      <details>
        <summary>Generation coverage and Evidence details</summary>
        <p>
          {coverageLabel(job.generationCoverage.state)} across{" "}
          {String(job.generationCoverage.workloads.length)} application workload
          {job.generationCoverage.workloads.length === 1 ? "" : "s"};{" "}
          {String(job.generationCoverage.missingRequirements.length)} solution
          requirement
          {job.generationCoverage.missingRequirements.length === 1
            ? ""
            : "s"}{" "}
          remain unresolved.
        </p>
        <ul className="github-export__evidence-list">
          {job.evidence.map((entry) => (
            <li key={entry.evidenceId}>
              <StatusBadge
                label={entry.status}
                tone={
                  entry.status === "passed"
                    ? "success"
                    : entry.status === "failed"
                      ? "error"
                      : "incomplete"
                }
              />
              <span>{words(entry.kind)}</span>
              <code>{entry.evidenceId}</code>
              <code>{entry.digest}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function PackageFilePanel({
  artifact,
  context,
  empty,
  files,
  projectId,
  title,
}: {
  readonly artifact: SolutionArtifact;
  readonly context: VerifiedGitHubExportContext;
  readonly empty: string;
  readonly files: readonly SolutionArtifactFile[];
  readonly projectId: string;
  readonly title: string;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = files.find((file) => file.id === selectedId) ?? files[0];
  const preview = useQuery({
    enabled: selected?.previewAvailable === true,
    queryKey: [
      ...cloudMarkupQueryKeys.solutionExportArtifact(
        context.principal.id,
        context.organizationId,
        projectId,
        artifact.id,
      ),
      "github-preview-file",
      selected?.id ?? "none",
    ] as const,
    queryFn: async () => {
      if (selected === undefined) throw new GitHubExportBindingError();
      const response = await context.runtime.client.request(
        "solution-export-artifacts.file-preview",
        {
          path: {
            projectId,
            solutionExportArtifactFileId: selected.id,
            solutionExportArtifactId: artifact.id,
          },
        },
      );
      assertFilePreview(response.data, artifact, selected);
      return response.data;
    },
    retry: retryQuery,
  });
  if (selected === undefined) {
    return <StatePanel kind="empty" title={title} description={empty} />;
  }
  return (
    <div className="github-export__file-review">
      <nav aria-label={`${title} files`} className="github-export__tree">
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              <button
                aria-current={file.id === selected.id ? "true" : undefined}
                onClick={() => {
                  setSelectedId(file.id);
                }}
                type="button"
              >
                <span>{file.path}</span>
                <small>{words(file.ownership)}</small>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section
        aria-label="Selected package file preview"
        className="github-export__file-preview"
      >
        <h3>{selected.path}</h3>
        <p>
          {words(selected.ownership)} · {formatBytes(selected.sizeBytes)}
        </p>
        {!selected.previewAvailable ? (
          <StatePanel
            kind="unsupported"
            title="Binary or bounded preview unavailable"
            description="The exact path, ownership, size, media type, and checksum remain visible. No binary content is executed."
          />
        ) : preview.isPending ? (
          <LoadingState live="polite" title="Loading bounded file preview" />
        ) : preview.isError ? (
          <StatePanel
            actions={
              <Button onClick={() => void preview.refetch()}>Try again</Button>
            }
            kind="error"
            title="File preview unavailable"
            description={errorMessage(preview.error, "load the file preview")}
          />
        ) : (
          <>
            {selected.path.endsWith(".svg") ? (
              <figure className="github-export__diagram">
                <img
                  alt="Immutable architecture diagram proposed for GitHub"
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.data.content)}`}
                />
                <figcaption>
                  Relative package path: <code>{selected.path}</code>
                </figcaption>
              </figure>
            ) : (
              <CodeBlock
                code={preview.data.content}
                label={`Preview of ${selected.path}`}
                language={previewLanguage(selected.path, selected.mediaType)}
              />
            )}
            {preview.data.truncated ? (
              <p role="status">
                Preview truncated at the server-defined safe limit.
              </p>
            ) : null}
          </>
        )}
        <details>
          <summary>Technical details</summary>
          <dl className="github-export__technical-grid">
            <div>
              <dt>Path</dt>
              <dd>
                <code>{selected.path}</code>
              </dd>
            </div>
            <div>
              <dt>Checksum</dt>
              <dd>
                <code>{selected.checksum}</code>
              </dd>
            </div>
            <div>
              <dt>Semantic checksum</dt>
              <dd>
                <code>{selected.semanticChecksum}</code>
              </dd>
            </div>
            <div>
              <dt>Media type</dt>
              <dd>
                <code>{selected.mediaType}</code>
              </dd>
            </div>
          </dl>
        </details>
      </section>
    </div>
  );
}

function GitHubWorkflow({
  artifact,
  canManageIntegrations,
  completeInstallationLink,
  context,
  installations,
  installationLinkCompletionStatus,
  job,
  projectId,
}: {
  readonly artifact: SolutionArtifact;
  readonly canManageIntegrations: boolean;
  readonly completeInstallationLink: UseMutationResult<
    GitHubInstallation,
    Error,
    CompleteGithubAppInstallationLinkV1
  >;
  readonly context: VerifiedGitHubExportContext;
  readonly installationLinkCompletionStatus: GitHubInstallationLinkCompletionStatus;
  readonly installations: UseQueryResult<
    readonly GitHubInstallation[],
    unknown
  >;
  readonly job: SolutionJob;
  readonly projectId: string;
}) {
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [destinationFolder, setDestinationFolder] = useState(() =>
    defaultDestination(artifact),
  );
  const [featureBranch, setFeatureBranch] = useState(() =>
    defaultFeatureBranch(artifact),
  );
  const [includeWorkflows, setIncludeWorkflows] = useState(false);
  const [installationLinkIntent, setInstallationLinkIntent] =
    useState<GitHubInstallationLinkIntent>();
  const [installationLinkExpired, setInstallationLinkExpired] = useState(false);
  const completeInstallationLinkAsync = completeInstallationLink.mutateAsync;
  useEffect(() => {
    if (
      installationLinkIntent === undefined ||
      installationLinkExpired ||
      !canManageIntegrations
    )
      return;
    return subscribeToGitHubInstallationLinkCallback({
      intentId: installationLinkIntent.intentId,
      expiresAt: installationLinkIntent.expiresAt,
      onCallback: async (callback) => {
        await completeInstallationLinkAsync(callback);
      },
    });
  }, [
    installationLinkIntent,
    installationLinkExpired,
    canManageIntegrations,
    completeInstallationLinkAsync,
    context.organizationId,
    context.principal.id,
  ]);
  const [preview, setPreview] = useState<GitHubPreview>();
  const [receipt, setReceipt] = useState<GitHubReceipt>();
  const [confirmedPreview, setConfirmedPreview] = useState(false);
  const [previewExpired, setPreviewExpired] = useState(false);
  const [confirmedWorkflowKeys, setConfirmedWorkflowKeys] = useState<
    ReadonlySet<string>
  >(new Set());
  const executeIdempotencyKey = useRef<string | undefined>(undefined);
  const { mode } = useModePreference();

  const firstConnectedInstallation = installations.data?.find(
    (item) => item.status === "connected",
  );
  const effectiveIntegrationId =
    selectedIntegrationId !== ""
      ? selectedIntegrationId
      : (firstConnectedInstallation?.integrationId ?? "");
  const selectedInstallation = installations.data?.find(
    (item) => item.integrationId === effectiveIntegrationId,
  );
  const repositories = useQuery({
    enabled: selectedInstallation?.status === "connected",
    queryKey: cloudMarkupQueryKeys.githubRepositories(
      context.principal.id,
      context.organizationId,
      effectiveIntegrationId === "" ? "unselected" : effectiveIntegrationId,
    ),
    queryFn: async () => {
      if (selectedInstallation === undefined)
        throw new GitHubExportBindingError();
      const response = await context.runtime.client.request(
        "github-repositories.list",
        {
          path: {
            integrationId: selectedInstallation.integrationId,
            organizationId: context.organizationId,
          },
        },
      );
      if (
        response.data.some(
          (item) =>
            item.organizationId !== context.organizationId ||
            item.integrationId !== selectedInstallation.integrationId,
        )
      ) {
        throw new GitHubExportBindingError();
      }
      return response.data;
    },
    retry: retryQuery,
  });
  const effectiveRepositoryId =
    selectedRepositoryId ||
    String(
      repositories.data?.find((item) => !item.archived && !item.disabled)
        ?.repositoryId ?? "",
    );
  const selectedRepository = repositories.data?.find(
    (item) => String(item.repositoryId) === effectiveRepositoryId,
  );
  const effectiveBaseBranch =
    baseBranch !== "" ? baseBranch : (selectedRepository?.defaultBranch ?? "");
  const branches = useQuery({
    enabled: selectedRepository !== undefined,
    queryKey: cloudMarkupQueryKeys.githubRepositoryBranches(
      context.principal.id,
      context.organizationId,
      effectiveIntegrationId === "" ? "unselected" : effectiveIntegrationId,
      selectedRepository?.repositoryId ?? 1,
    ),
    queryFn: async () => {
      if (
        selectedInstallation === undefined ||
        selectedRepository === undefined
      ) {
        throw new GitHubExportBindingError();
      }
      const response = await context.runtime.client.request(
        "github-repository-branches.list",
        {
          path: {
            integrationId: selectedInstallation.integrationId,
            organizationId: context.organizationId,
            repositoryId: selectedRepository.repositoryId,
          },
        },
      );
      return response.data;
    },
    retry: retryQuery,
  });
  const previousDiff = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.solutionExportArtifactDiff(
        context.principal.id,
        context.organizationId,
        projectId,
        artifact.id,
      ),
      "github-export",
    ] as const,
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-export-artifacts.diff",
        { path: { projectId, solutionExportArtifactId: artifact.id } },
      );
      assertSolutionDiff(response.data, artifact);
      return response.data;
    },
    retry: retryQuery,
  });

  function resetApproval(): void {
    setPreview(undefined);
    setReceipt(undefined);
    setConfirmedPreview(false);
    setPreviewExpired(false);
    setConfirmedWorkflowKeys(new Set());
    executeIdempotencyKey.current = undefined;
  }

  const createInstallationLinkIntent = useMutation({
    mutationFn: async () => {
      const response = await context.runtime.client.request(
        "github-installation-link-intents.create",
        {
          body: { contractVersion: 1 },
          path: { organizationId: context.organizationId },
        },
      );
      return response.data;
    },
    onSuccess: (intent) => {
      setInstallationLinkIntent(intent);
      setInstallationLinkExpired(
        Date.parse(intent.expiresAt) <= new Date().getTime(),
      );
    },
  });
  const createPreview = useMutation({
    mutationFn: async () => {
      if (
        selectedInstallation === undefined ||
        selectedRepository === undefined
      ) {
        throw new TypeError("Select an installation and repository.");
      }
      const response = await context.runtime.client.request(
        "github-export-previews.create",
        {
          body: {
            artifactId: artifact.id,
            baseBranch: effectiveBaseBranch,
            contractVersion: 1,
            destinationFolder,
            featureBranch,
            includeWorkflows,
            integrationId: selectedInstallation.integrationId,
            repositoryId: selectedRepository.repositoryId,
          },
          path: { projectId },
        },
      );
      assertPreview(response.data, {
        artifactId: artifact.id,
        integrationId: selectedInstallation.integrationId,
        organizationId: context.organizationId,
        projectId,
        repositoryId: selectedRepository.repositoryId,
      });
      return response.data;
    },
    onSuccess: (next) => {
      setPreview(next);
      setReceipt(undefined);
      setConfirmedPreview(false);
      setPreviewExpired(Date.parse(next.expiresAt) <= new Date().getTime());
      setConfirmedWorkflowKeys(new Set());
      executeIdempotencyKey.current = undefined;
    },
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (preview === undefined) throw new GitHubExportBindingError();
      executeIdempotencyKey.current ??= `github-export:${globalThis.crypto.randomUUID()}`;
      const confirmedWorkflowFiles = preview.workflowFiles.filter((file) =>
        confirmedWorkflowKeys.has(`${file.path}:${file.digest}`),
      );
      const response = await context.runtime.client.request(
        "github-exports.create",
        {
          body: {
            confirmedWorkflowFiles,
            contractVersion: 1,
            previewDigest: preview.previewDigest,
            previewId: preview.previewId,
          },
          headers: { "idempotency-key": executeIdempotencyKey.current },
          path: { projectId },
        },
      );
      assertReceipt(response.data, preview);
      return response.data;
    },
    onSuccess: setReceipt,
  });

  const allWorkflowsConfirmed =
    preview?.workflowFiles.every((file) =>
      confirmedWorkflowKeys.has(`${file.path}:${file.digest}`),
    ) ?? false;
  const executionReady =
    preview?.ready === true &&
    !previewExpired &&
    confirmedPreview &&
    (!preview.includeWorkflows || allWorkflowsConfirmed);

  function handlePreview(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    createPreview.mutate();
  }

  return (
    <section
      className="feature-card github-export__workflow"
      aria-labelledby="github-export-workflow-title"
    >
      <p className="status-label">GitHub App publication</p>
      <h2 id="github-export-workflow-title">
        Repository, diff, and confirmation
      </h2>
      <p>
        {mode === "guided"
          ? "Choose where the package should live. Previewing reads repository metadata and files but does not change anything."
          : "Preview binds installation, repository ID, base SHA, affected-scope snapshot, destination, feature ref, artifact digest, and workflow selection."}
      </p>
      {installations.isPending ? (
        <LoadingState
          live="polite"
          title="Loading linked GitHub App installations"
        />
      ) : installations.isError ? (
        <StatePanel
          actions={
            <Button onClick={() => void installations.refetch()}>
              Try again
            </Button>
          }
          kind="error"
          title="GitHub installations unavailable"
          description={errorMessage(
            installations.error,
            "load linked installations",
          )}
        />
      ) : (
        <>
          <div className="github-export__installation-row">
            <label className="field">
              <span>GitHub App installation</span>
              <select
                value={effectiveIntegrationId}
                onChange={(event) => {
                  setSelectedIntegrationId(event.currentTarget.value);
                  setSelectedRepositoryId("");
                  setBaseBranch("");
                  resetApproval();
                }}
              >
                <option value="">Select an installation</option>
                {installations.data.map((installation) => (
                  <option
                    key={installation.integrationId}
                    value={installation.integrationId}
                  >
                    {installation.accountLogin} · {words(installation.status)}
                  </option>
                ))}
              </select>
            </label>
            {canManageIntegrations ? (
              <div className="github-export__connect">
                <Button
                  loading={createInstallationLinkIntent.isPending}
                  loadingLabel="Preparing GitHub connection"
                  onClick={() => {
                    createInstallationLinkIntent.mutate();
                  }}
                >
                  {installationLinkIntent === undefined
                    ? "Connect GitHub App"
                    : "Create another installation link"}
                </Button>
                {installationLinkIntent === undefined ? (
                  <p className="github-export__field-help">
                    CloudMarkup creates a short-lived, one-time link. GitHub
                    opens only after you choose to continue.
                  </p>
                ) : (
                  <div>
                    <p role="status">
                      Installation link ready. It expires{" "}
                      <time dateTime={installationLinkIntent.expiresAt}>
                        {formatTimestamp(installationLinkIntent.expiresAt)}
                      </time>
                      .
                    </p>
                    {installationLinkExpired ? (
                      <p role="alert">
                        This installation link expired. Create another link to
                        continue.
                      </p>
                    ) : (
                      <a
                        className="cm-button"
                        data-size="default"
                        data-variant="primary"
                        href={installationLinkIntent.installationUrl}
                        rel="noreferrer noopener"
                        target="_blank"
                      >
                        Continue on GitHub
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {createInstallationLinkIntent.isError ? (
            <StatePanel
              kind="error"
              title="Installation link was not created"
              description={errorMessage(
                createInstallationLinkIntent.error,
                "create the GitHub App installation link",
              )}
            />
          ) : null}
          {completeInstallationLink.isPending ||
          installationLinkCompletionStatus === "pending" ? (
            <LoadingState
              live="polite"
              title="Verifying the GitHub App connection"
            />
          ) : completeInstallationLink.isError ||
            installationLinkCompletionStatus === "failed" ? (
            <StatePanel
              kind="error"
              title="GitHub App connection was not completed"
              description={errorMessage(
                completeInstallationLink.error,
                "verify the GitHub App connection",
              )}
            />
          ) : completeInstallationLink.isSuccess ||
            installationLinkCompletionStatus === "succeeded" ? (
            <p role="status">
              GitHub App connection verified. Linked installations were
              refreshed.
            </p>
          ) : null}
        </>
      )}

      {selectedInstallation !== undefined ? (
        <InstallationPermissions
          installation={selectedInstallation}
          includeWorkflows={includeWorkflows}
          mode={mode}
        />
      ) : null}

      <form className="github-export__destination" onSubmit={handlePreview}>
        <label className="field">
          <span>Repository</span>
          <select
            disabled={
              repositories.isPending || selectedInstallation === undefined
            }
            required
            value={effectiveRepositoryId}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const repository = repositories.data?.find(
                (item) => String(item.repositoryId) === value,
              );
              setSelectedRepositoryId(value);
              setBaseBranch(repository?.defaultBranch ?? "");
              resetApproval();
            }}
          >
            <option value="">Select a repository</option>
            {repositories.data?.map((repository) => (
              <option
                key={repository.repositoryId}
                disabled={repository.archived || repository.disabled}
                value={repository.repositoryId}
              >
                {repository.owner}/{repository.name}
                {repository.private ? " · private" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Base branch</span>
          <select
            disabled={branches.isPending || selectedRepository === undefined}
            required
            value={effectiveBaseBranch}
            onChange={(event) => {
              setBaseBranch(event.currentTarget.value);
              resetApproval();
            }}
          >
            <option value="">Select a base branch</option>
            {branches.data?.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
                {branch.protected ? " · protected" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Destination folder</span>
          <input
            maxLength={240}
            placeholder="cloudmarkup/solution"
            value={destinationFolder}
            onChange={(event) => {
              setDestinationFolder(event.currentTarget.value);
              resetApproval();
            }}
          />
        </label>
        <label className="field">
          <span>Feature branch</span>
          <input
            maxLength={255}
            required
            value={featureBranch}
            onChange={(event) => {
              setFeatureBranch(event.currentTarget.value);
              resetApproval();
            }}
          />
        </label>
        <label className="field">
          <span>IaC target in approved package</span>
          <select disabled value={job.target.profileId}>
            <option value={job.target.profileId}>
              {iacTargetLabel(job.target.profileId)}
            </option>
          </select>
        </label>
        <label className="field">
          <span>Diagram profile in approved package</span>
          <select disabled value={job.target.diagram.profile}>
            <option value={job.target.diagram.profile}>
              {words(job.target.diagram.profile)}
            </option>
          </select>
        </label>
        <label className="github-export__workflow-choice">
          <input
            checked={includeWorkflows}
            disabled={selectedInstallation?.permissions.workflows !== "write"}
            onChange={(event) => {
              setIncludeWorkflows(event.currentTarget.checked);
              resetApproval();
            }}
            type="checkbox"
          />
          <span>Include approved pull-request validation workflow files</span>
        </label>
        <p className="github-export__field-help">
          {selectedInstallation?.permissions.workflows === "write"
            ? "Every workflow path and digest still requires separate confirmation after preview."
            : "This App lacks Workflows write permission. Export can continue without workflow files and will show a precise readiness warning."}
        </p>
        <Button
          disabled={
            selectedRepository === undefined ||
            effectiveBaseBranch === "" ||
            createPreview.isPending
          }
          loading={createPreview.isPending}
          loadingLabel="Calculating complete repository diff"
          type="submit"
          variant="primary"
        >
          Preview repository changes
        </Button>
      </form>

      {repositories.isError || branches.isError || createPreview.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Repository preview unavailable"
          description={errorMessage(
            repositories.error ?? branches.error ?? createPreview.error,
            "calculate the repository preview",
          )}
        />
      ) : null}

      {preview !== undefined ? (
        <RepositoryPreview
          artifact={artifact}
          confirmedPreview={confirmedPreview}
          confirmedWorkflowKeys={confirmedWorkflowKeys}
          onConfirmedPreviewChange={setConfirmedPreview}
          onWorkflowConfirmationChange={setConfirmedWorkflowKeys}
          previousDiff={previousDiff}
          preview={preview}
        />
      ) : null}

      {preview !== undefined ? (
        <ExportProgress execute={execute} preview={preview} receipt={receipt} />
      ) : null}

      {execute.isError ? (
        <StatePanel
          actions={
            <Button
              disabled={!executionReady}
              onClick={() => {
                execute.mutate();
              }}
            >
              Retry export safely
            </Button>
          }
          kind="error"
          live="assertive"
          title="GitHub export did not complete"
          description={errorMessage(
            execute.error,
            "complete the GitHub export",
          )}
        />
      ) : null}

      {preview !== undefined && receipt === undefined ? (
        <div className="github-export__confirm-actions">
          <Button
            disabled={!executionReady || execute.isPending}
            loading={execute.isPending}
            loadingLabel="Creating feature branch and pull request"
            onClick={() => {
              execute.mutate();
            }}
            variant="primary"
          >
            Confirm export
          </Button>
          {previewExpired ? (
            <p role="alert">
              This preview expired. Calculate a fresh repository diff.
            </p>
          ) : null}
        </div>
      ) : null}

      {receipt !== undefined ? (
        <section
          className="github-export__receipt"
          aria-labelledby="github-export-receipt-title"
        >
          <StatusBadge label="Pull request created" tone="success" />
          <h3 id="github-export-receipt-title">
            Feature branch export complete
          </h3>
          <p>
            Branch <code>{receipt.branch}</code> and pull request #
            {String(receipt.pullRequestNumber)} were created. Nothing was merged
            or deployed.
          </p>
          <a
            className="button button--primary"
            href={receipt.pullRequestUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open pull request
          </a>
          <details>
            <summary>Technical details</summary>
            <dl className="github-export__technical-grid">
              <div>
                <dt>Execution ID</dt>
                <dd>
                  <code>{receipt.executionId}</code>
                </dd>
              </div>
              <div>
                <dt>Commit SHA</dt>
                <dd>
                  <code>{receipt.commitSha}</code>
                </dd>
              </div>
              <div>
                <dt>Preview digest</dt>
                <dd>
                  <code>{receipt.previewDigest}</code>
                </dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>
                  <time dateTime={receipt.completedAt}>
                    {formatTimestamp(receipt.completedAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </details>
        </section>
      ) : null}

      <AppLink
        className="button button--quiet"
        to={`${projectPath(context.organizationId, projectId)}/artifacts/${encodeRouteSelector(artifact.id)}/review`}
      >
        Return to artifact review
      </AppLink>
    </section>
  );
}

function InstallationPermissions({
  includeWorkflows,
  installation,
  mode,
}: {
  readonly includeWorkflows: boolean;
  readonly installation: GitHubInstallation;
  readonly mode: "guided" | "professional";
}) {
  const required = [
    ["Metadata", "read", installation.permissions.metadata],
    ["Contents", "write", installation.permissions.contents],
    ["Pull requests", "write", installation.permissions.pullRequests],
    ...(includeWorkflows
      ? [["Workflows", "write", installation.permissions.workflows] as const]
      : []),
  ] as const;
  return (
    <section
      className="github-export__permissions"
      aria-labelledby="github-export-permissions-title"
    >
      <h3 id="github-export-permissions-title">
        Required GitHub App permissions
      </h3>
      <p>
        {mode === "guided"
          ? "Metadata identifies the repository. Contents creates the reviewed branch and commit. Pull requests opens the review. Workflows is needed only when you choose workflow files."
          : "Installation tokens are repository-scoped and request only the permission levels shown below."}
      </p>
      <ul>
        {required.map(([name, needed, actual]) => (
          <li key={name}>
            <StatusBadge
              label={actual === needed ? "available" : "required"}
              tone={actual === needed ? "success" : "warning"}
            />
            <span>
              {name}: {needed}
            </span>
            <small>Current: {actual}</small>
          </li>
        ))}
      </ul>
      <details>
        <summary>Technical details</summary>
        <p>
          Integration <code>{installation.integrationId}</code> · installation{" "}
          <code>{String(installation.installationId)}</code> · account{" "}
          <code>{installation.accountLogin}</code>.
        </p>
      </details>
    </section>
  );
}

function RepositoryWorkflowReview({
  workflows,
}: {
  readonly workflows: RepositoryWorkflows;
}) {
  const review = workflows.review;
  const workflowPurposeByPath = new Map(
    review.workflows.map((workflow) => [workflow.path, workflow.purpose]),
  );
  const repository = workflows.repository;

  return (
    <section
      className="github-export__workflow-review"
      aria-labelledby="github-export-workflow-review-title"
    >
      <div className="github-export__preview-heading">
        <div>
          <p className="status-label">Customer-reviewed automation</p>
          <h4 id="github-export-workflow-review-title">
            Reviewed workflow access and safeguards
          </h4>
        </div>
        <StatusBadge label="Review required" tone="warning" />
      </div>
      <p>
        These workflow files remain customer-controlled. Review their
        protections, identity boundaries, and required settings before
        confirming any file.
      </p>

      <div className="github-export__workflow-review-grid">
        <section aria-labelledby="github-export-environment-review-title">
          <h5 id="github-export-environment-review-title">
            Environment protection
          </h5>
          {review.environments.length === 0 ? (
            <p>No protected GitHub environment is declared.</p>
          ) : (
            <ul>
              {review.environments.map((environment) => (
                <li key={environment.id}>
                  <p>
                    <strong>{environment.githubEnvironment}</strong>{" "}
                    {environment.protected
                      ? "is protected and requires " +
                        String(environment.requiredApprovals) +
                        " approval" +
                        (environment.requiredApprovals === 1 ? "" : "s") +
                        "."
                      : "is not marked as protected."}
                  </p>
                  <span>
                    Workspace <code>{environment.workspace}</code>
                  </span>
                  <span>
                    Approved refs:{" "}
                    {environment.approvedRefs.length === 0
                      ? "none declared"
                      : environment.approvedRefs.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-role-review-title">
          <h5 id="github-export-role-review-title">OIDC role boundaries</h5>
          {review.roles.length === 0 ? (
            <p>No cloud role is requested.</p>
          ) : (
            <ul>
              {review.roles.map((role) => (
                <li
                  key={[
                    role.environment,
                    role.purpose,
                    role.reference,
                    role.subject,
                  ].join(":")}
                >
                  <p>
                    <strong>{words(role.purpose)}</strong> for{" "}
                    <code>{role.environment}</code>
                  </p>
                  <dl>
                    <div>
                      <dt>Role reference</dt>
                      <dd>
                        <code>{role.reference}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Subject</dt>
                      <dd>
                        <code>{role.subject}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Audience</dt>
                      <dd>
                        <code>{role.audience}</code>
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-permission-review-title">
          <h5 id="github-export-permission-review-title">
            Repository permissions
          </h5>
          {review.permissions.length === 0 ? (
            <p>No repository permission is requested.</p>
          ) : (
            <ul>
              {review.permissions.map((permission) => (
                <li
                  key={[
                    permission.workflowPath,
                    permission.scope,
                    permission.access,
                  ].join(":")}
                >
                  <p>
                    <strong>{permission.scope}</strong>:{" "}
                    <code>{permission.access}</code>
                  </p>
                  <span>{permission.explanation}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-trigger-review-title">
          <h5 id="github-export-trigger-review-title">Triggers</h5>
          {review.triggers.length === 0 ? (
            <p>No automatic or manual trigger is declared.</p>
          ) : (
            <ul>
              {review.triggers.map((trigger) => (
                <li key={trigger.workflowPath}>
                  <p>
                    <strong>
                      {workflowPurposeByPath.get(trigger.workflowPath) ??
                        "Reviewed workflow"}
                    </strong>
                  </p>
                  <span>Runs for {trigger.events.join(", ")}.</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-variable-review-title">
          <h5 id="github-export-variable-review-title">Variables</h5>
          {review.variables.length === 0 ? (
            <p>No repository variable is required.</p>
          ) : (
            <ul>
              {review.variables.map((variable) => (
                <li key={variable.name}>
                  <code>{variable.name}</code>
                  <span>{variable.purpose}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-secret-review-title">
          <h5 id="github-export-secret-review-title">Secrets</h5>
          <p>Only secret names are shown. Secret values are never returned.</p>
          {review.secrets.length === 0 ? (
            <p>No repository secret is required.</p>
          ) : (
            <ul>
              {review.secrets.map((secret) => (
                <li key={secret.name}>
                  <code>{secret.name}</code>
                  <span>{secret.purpose}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="github-export-workflow-purpose-title">
          <h5 id="github-export-workflow-purpose-title">Workflow purpose</h5>
          <ul>
            {review.workflows.map((workflow) => (
              <li key={workflow.path}>
                <strong>{workflow.purpose}</strong>
                <span>
                  {workflow.environmentScoped
                    ? "Uses a reviewed GitHub environment."
                    : "Does not use a GitHub environment."}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="github-export-workflow-warning-title">
          <h5 id="github-export-workflow-warning-title">Warnings</h5>
          {review.warnings.length === 0 ? (
            <p>No workflow warning is recorded.</p>
          ) : (
            <ul>
              {review.warnings.map((warning) => (
                <li key={warning.code}>
                  <StatusBadge label="Warning" tone="warning" />
                  <span>{warning.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <details>
        <summary>Workflow technical details</summary>
        <dl className="github-export__technical-grid">
          <div>
            <dt>Workflow contract</dt>
            <dd>
              <code>{workflows.kind}</code> v
              <code>{String(workflows.contractVersion)}</code>
            </dd>
          </div>
          <div>
            <dt>Inclusion policy</dt>
            <dd>
              <code>{workflows.inclusionPolicy}</code>
            </dd>
          </div>
          <div>
            <dt>Generator pin</dt>
            <dd>
              <code>
                {workflows.generator.id}@{workflows.generator.version}
              </code>
              <br />
              <code>{workflows.generator.digest}</code>
            </dd>
          </div>
          <div>
            <dt>Validator pin</dt>
            <dd>
              <code>
                {workflows.validator.id}@{workflows.validator.version}
              </code>
              <br />
              <code>{workflows.validator.digest}</code>
            </dd>
          </div>
          <div>
            <dt>Configuration digest</dt>
            <dd>
              <code>{workflows.configDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Result digest</dt>
            <dd>
              <code>{workflows.resultDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Policy digest</dt>
            <dd>
              <code>{workflows.policyDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Action pin registry digest</dt>
            <dd>
              <code>{workflows.pinRegistryDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Repository binding</dt>
            <dd>
              {repository.state === "bound" ? (
                <>
                  <code>
                    {repository.owner}/{repository.name}
                  </code>
                  <br />
                  Branch <code>{repository.defaultBranch}</code>; destination{" "}
                  <code>{repository.destinationFolder || "."}</code>
                </>
              ) : (
                <code>portable-unbound</code>
              )}
            </dd>
          </div>
          <div>
            <dt>Solution Revision binding</dt>
            <dd>
              <code>{workflows.solutionRevision.id}</code>
              <br />
              <code>{workflows.solutionRevision.digest}</code>
            </dd>
          </div>
        </dl>

        <h5>Exact workflow files</h5>
        <ul className="github-export__technical-list">
          {workflows.files.map((file) => (
            <li key={file.path}>
              <code>{file.path}</code>
              <span>
                Checksum <code>{file.checksum}</code>
              </span>
              <span>
                Semantic checksum <code>{file.semanticChecksum}</code>
              </span>
              <span>{formatBytes(file.sizeBytes)}</span>
              <span>
                Provenance{" "}
                <code>
                  {file.provenance.producer.id}@
                  {file.provenance.producer.version}
                </code>{" "}
                for <code>{file.provenance.solutionRevisionId}</code>
              </span>
            </li>
          ))}
        </ul>

        <h5>Dependency lock bindings</h5>
        <ul className="github-export__technical-list">
          {workflows.dependencyLockDigests.map((binding) => (
            <li key={binding.id}>
              <code>{binding.id}</code>
              <code>{binding.digest}</code>
            </li>
          ))}
        </ul>

        <h5>Required package trees</h5>
        {workflows.requiredPackageTrees.length === 0 ? (
          <p>No package tree binding is recorded.</p>
        ) : (
          <ul className="github-export__technical-list">
            {workflows.requiredPackageTrees.map((tree) => (
              <li key={tree.root}>
                Root <code>{tree.root}</code>
                <ul>
                  {tree.files.map((file) => (
                    <li key={file.path}>
                      <code>{file.path}</code> <code>{file.checksum}</code>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function RepositoryPreview({
  artifact,
  confirmedPreview,
  confirmedWorkflowKeys,
  onConfirmedPreviewChange,
  onWorkflowConfirmationChange,
  previousDiff,
  preview,
}: {
  readonly artifact: SolutionArtifact;
  readonly confirmedPreview: boolean;
  readonly confirmedWorkflowKeys: ReadonlySet<string>;
  readonly onConfirmedPreviewChange: (value: boolean) => void;
  readonly onWorkflowConfirmationChange: (value: ReadonlySet<string>) => void;
  readonly previousDiff: UseQueryResult<SolutionDiff, unknown>;
  readonly preview: GitHubPreview;
}) {
  const changes = preview.changes.filter(
    (change) => change.action !== "unchanged",
  );
  const semanticEntries = Object.entries(preview.semanticDiff).filter(
    ([, changed]) => changed,
  );
  return (
    <section
      className="github-export__preview"
      aria-labelledby="github-export-preview-title"
    >
      <div className="github-export__preview-heading">
        <div>
          <p className="status-label">Complete affected-scope preview</p>
          <h3 id="github-export-preview-title">
            {preview.repositoryOwner}/{preview.repositoryName}
          </h3>
        </div>
        <StatusBadge
          label={preview.ready ? "Ready for confirmation" : "Blocked"}
          tone={preview.ready ? "success" : "error"}
        />
      </div>
      <p>
        {String(changes.length)} additions, modifications, deletions, or
        preserved conflicts are proposed. The default branch is never a write
        target.
      </p>
      {preview.issues.length > 0 ? (
        <ul
          className="github-export__issues"
          aria-label="Repository preview issues"
        >
          {preview.issues.map((issue, index) => (
            <li
              key={`${issue.code}-${issue.path ?? "global"}-${String(index)}`}
            >
              <StatusBadge
                label={issue.severity}
                tone={
                  issue.severity === "error"
                    ? "error"
                    : issue.severity === "warning"
                      ? "warning"
                      : "info"
                }
              />
              <span>{issue.message}</span>
              {issue.path === undefined ? null : <code>{issue.path}</code>}
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">
          No repository conflict or readiness warning was found.
        </p>
      )}
      {preview.repositoryWorkflows === undefined ? null : (
        <RepositoryWorkflowReview workflows={preview.repositoryWorkflows} />
      )}
      <div className="github-export__diff-grid">
        <section aria-labelledby="github-export-file-diff-title">
          <h4 id="github-export-file-diff-title">Repository file diff</h4>
          <div
            className="github-export__change-table"
            role="table"
            aria-label="Every repository file change"
          >
            <div role="row" className="github-export__change-header">
              <span role="columnheader">Change</span>
              <span role="columnheader">Path and ownership</span>
              <span role="columnheader">Size</span>
            </div>
            {preview.changes.map((change) => (
              <div role="row" key={change.path}>
                <span role="cell">
                  <StatusBadge
                    label={change.action}
                    tone={toneForAction(change.action)}
                  />
                </span>
                <span role="cell">
                  <code>{change.path}</code>
                  <small>
                    {words(change.ownership)} · {change.reason}
                  </small>
                </span>
                <span role="cell">
                  {formatBytes(change.sizeBytes)}
                  {change.binary ? " · binary" : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="github-export-semantic-diff-title">
          <h4 id="github-export-semantic-diff-title">Semantic diff</h4>
          {semanticEntries.length === 0 ? (
            <p>No semantic package area changed.</p>
          ) : (
            <ul>
              {semanticEntries.map(([key]) => (
                <li key={key}>{words(key.replace(/Changed$/u, ""))}</li>
              ))}
            </ul>
          )}
          <h4>Previous-export diff</h4>
          {previousDiff.isPending ? (
            <LoadingState
              live="polite"
              title="Loading previous-export comparison"
            />
          ) : previousDiff.isError ? (
            <StatePanel
              kind="error"
              title="Previous-export comparison unavailable"
              description={errorMessage(
                previousDiff.error,
                "load the previous-export comparison",
              )}
            />
          ) : previousDiff.data.state === "unavailable" ? (
            <p>No authorized previous-export baseline exists.</p>
          ) : (
            <ul>
              {previousDiff.data.files.map((file) => (
                <li key={file.path}>
                  <StatusBadge label={file.change} tone="info" />{" "}
                  <code>{file.path}</code> · semantic{" "}
                  {words(file.semanticChange)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {preview.workflowFiles.length > 0 ? (
        <fieldset className="github-export__workflow-confirmations">
          <legend>Confirm every workflow file</legend>
          <p>
            Workflow files can run repository code after the customer enables
            GitHub Actions. Confirm each exact path and digest separately.
          </p>
          {preview.workflowFiles.map((file) => {
            const key = `${file.path}:${file.digest}`;
            return (
              <div className="github-export__workflow-confirmation" key={key}>
                <input
                  aria-label={`Confirm workflow ${file.path} digest ${file.digest}`}
                  checked={confirmedWorkflowKeys.has(key)}
                  onChange={(event) => {
                    const next = new Set(confirmedWorkflowKeys);
                    if (event.currentTarget.checked) next.add(key);
                    else next.delete(key);
                    onWorkflowConfirmationChange(next);
                  }}
                  type="checkbox"
                />
                <span>
                  <code>{file.path}</code>
                  <small>
                    <code>{file.digest}</code>
                  </small>
                </span>
              </div>
            );
          })}
        </fieldset>
      ) : null}
      <label className="github-export__final-confirmation">
        <input
          checked={confirmedPreview}
          disabled={!preview.ready}
          onChange={(event) => {
            onConfirmedPreviewChange(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        <span>
          I reviewed the complete file and semantic diff and authorize only this
          feature-branch pull request.
        </span>
      </label>
      <details>
        <summary>Technical details</summary>
        <dl className="github-export__technical-grid">
          <div>
            <dt>Preview ID</dt>
            <dd>
              <code>{preview.previewId}</code>
            </dd>
          </div>
          <div>
            <dt>Preview digest</dt>
            <dd>
              <code>{preview.previewDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Repository ID</dt>
            <dd>
              <code>{String(preview.repositoryId)}</code>
            </dd>
          </div>
          <div>
            <dt>Base SHA</dt>
            <dd>
              <code>{preview.baseCommitSha}</code>
            </dd>
          </div>
          <div>
            <dt>Snapshot digest</dt>
            <dd>
              <code>{preview.snapshotDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Artifact digest</dt>
            <dd>
              <code>{artifact.digest}</code>
            </dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>
              <code>{preview.destinationFolder || "."}</code>
            </dd>
          </div>
          <div>
            <dt>Feature branch</dt>
            <dd>
              <code>{preview.featureBranch}</code>
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}

function ExportProgress({
  execute,
  preview,
  receipt,
}: {
  readonly execute: UseMutationResult<GitHubReceipt, Error, void>;
  readonly preview: GitHubPreview;
  readonly receipt: GitHubReceipt | undefined;
}) {
  const state =
    receipt !== undefined
      ? "complete"
      : execute.isPending
        ? "running"
        : execute.isError
          ? "failed"
          : "ready";
  return (
    <section
      className="github-export__progress"
      aria-labelledby="github-export-progress-title"
      aria-live="polite"
    >
      <h3 id="github-export-progress-title">Export progress</h3>
      <ol>
        <li data-state="complete">
          <span>1</span>
          <div>
            <strong>Preview calculated</strong>
            <small>Exact base, files, and approvals bound.</small>
          </div>
        </li>
        <li data-state={state === "ready" ? "pending" : state}>
          <span>2</span>
          <div>
            <strong>Revalidate repository</strong>
            <small>
              {execute.isPending
                ? "Checking installation, permissions, base, files, artifact, and approval."
                : "Runs again before mutation."}
            </small>
          </div>
        </li>
        <li data-state={receipt === undefined ? "pending" : "complete"}>
          <span>3</span>
          <div>
            <strong>Create feature branch and commit</strong>
            <small>Never writes the default branch or force-pushes.</small>
          </div>
        </li>
        <li data-state={receipt === undefined ? "pending" : "complete"}>
          <span>4</span>
          <div>
            <strong>Open pull request</strong>
            <small>
              {receipt === undefined
                ? "No merge or workflow run authority."
                : `Pull request #${String(receipt.pullRequestNumber)} is ready for customer review.`}
            </small>
          </div>
        </li>
      </ol>
      <p>
        <small>
          Preview expires{" "}
          <time dateTime={preview.expiresAt}>
            {formatTimestamp(preview.expiresAt)}
          </time>
          .
        </small>
      </p>
    </section>
  );
}
