import { coverageLabel } from "./generation-coverage-label.js";
import { describeBetaInfrastructureCredits } from "../generation/beta-infrastructure-client.js";
import { AiWorkflowProgress } from "../generation/AiProposalReview.js";
import {
  ApiClientError,
  ApiGatewayError,
  type ApiResponseV1,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import {
  Button,
  CodeBlock,
  Dialog,
  Disclosure,
  LoadingState,
  StatePanel,
  StatusBadge,
  Tabs,
  type StatusTone,
  type TabItem,
} from "@cloudmarkup/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

import {
  cloudMarkupQueryKeys,
  useExportCapabilities,
  useAiCapabilities,
  useOptionalCloudMarkupQueryRuntime,
  type AuthenticatedBinaryDownload,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { useModePreference } from "../../preferences/mode-preference-context.js";
import {
  AppLink,
  encodeRouteSelector,
  useNavigate,
} from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";

import "./solution-export.css";
import {
  diagnosticReferenceLabel,
  exportDiagnosticSearch,
} from "./diagnostic-recovery.js";

type SolutionExportJob = ApiResponseV1<"solution-export-jobs.get">["data"];
type SolutionExportArtifact =
  ApiResponseV1<"solution-export-artifacts.get">["data"];
type SolutionExportFile = SolutionExportArtifact["files"][number];
type SolutionExportFilePreview =
  ApiResponseV1<"solution-export-artifacts.file-preview">["data"];
type SolutionExportDiff =
  ApiResponseV1<"solution-export-artifacts.diff">["data"];
type SolutionExportDownloadGrant =
  ApiResponseV1<"solution-export-download-grants.create">["data"];

type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];
type EnvironmentType = "development" | "test" | "staging" | "production";
type DiagramOptions = SolutionExportJob["target"]["diagram"];
type DiagramProfile = DiagramOptions["profile"];

type IaCTarget = "cloudformation" | "terraform";
const TARGET_PROFILE_IDS = Object.freeze({
  cloudformation: "cloudmarkup.export.cloudformation-nodejs24-v1",
  terraform: "cloudmarkup.export.terraform-nodejs24-v1",
} as const) satisfies Readonly<Record<IaCTarget, string>>;
const TERMINAL_JOB_STATES: ReadonlySet<SolutionExportJob["state"]> = new Set([
  "succeeded",
  "failed",
  "canceled",
]);
const WITHHELD_PATH = "Reference withheld";

interface VerifiedExportContext {
  readonly organization: OrganizationContext;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

export interface SolutionExportCreatePanelProps {
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionName: string;
}

export interface SolutionExportPageProps {
  readonly exportJobId: string;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
  readonly projectId: string;
}

class SolutionExportResponseBindingError extends Error {
  public constructor() {
    super("The export response did not match the requested project scope.");
    this.name = "SolutionExportResponseBindingError";
  }
}

function createMutationKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function projectPath(organizationId: string, projectId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}/projects/${encodeRouteSelector(projectId)}`;
}

function defaultExportName(revisionName: string): string {
  const slug = revisionName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72)
    .replace(/-+$/gu, "");
  return `${slug.length === 0 ? "solution" : slug}-export`;
}

function verifiedContext(
  props: SolutionExportPageProps,
  runtime: CloudMarkupQueryRuntime | null,
): VerifiedExportContext | "denied" | "unavailable" | null {
  const usesBackend =
    props.principal !== undefined || props.organizationId !== undefined;
  if (!usesBackend) return null;
  if (
    runtime === null ||
    props.principal === undefined ||
    props.organizationId === undefined
  ) {
    return "unavailable";
  }
  const organization = props.principal.organizationContexts.find(
    (candidate) => candidate.organizationId === props.organizationId,
  );
  if (organization?.capabilities.includes("projects.read") !== true) {
    return "denied";
  }
  return {
    organization,
    organizationId: props.organizationId,
    principal: props.principal,
    runtime,
  };
}

function assertJobBinding(
  job: SolutionExportJob,
  projectId: string,
  jobId: string,
  revisionId?: string,
): void {
  if (
    job.projectId !== projectId ||
    job.id !== jobId ||
    (revisionId !== undefined &&
      job.solutionRevision.solutionRevisionId !== revisionId)
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function assertArtifactBinding(
  artifact: SolutionExportArtifact,
  job: SolutionExportJob,
): void {
  if (
    job.artifact === undefined ||
    artifact.projectId !== job.projectId ||
    artifact.jobId !== job.id ||
    artifact.id !== job.artifact.artifactId ||
    artifact.solutionRevisionId !== job.solutionRevision.solutionRevisionId ||
    artifact.digest !== job.artifact.digest ||
    artifact.manifestDigest !== job.artifact.manifestDigest
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function assertPreviewBinding(
  preview: SolutionExportFilePreview,
  artifact: SolutionExportArtifact,
  file: SolutionExportFile,
): void {
  if (
    preview.artifactId !== artifact.id ||
    preview.fileId !== file.id ||
    preview.path !== file.path ||
    preview.checksum !== file.checksum
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function assertDiffBinding(
  diff: SolutionExportDiff,
  artifact: SolutionExportArtifact,
): void {
  if (
    diff.artifactId !== artifact.id ||
    (diff.previousArtifactId !== undefined &&
      diff.previousArtifactId !== artifact.previousArtifactId)
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function assertGrantBinding(
  grant: SolutionExportDownloadGrant,
  artifact: SolutionExportArtifact,
): void {
  if (
    grant.artifactId !== artifact.id ||
    grant.digest !== artifact.digest ||
    grant.fileName !== artifact.archiveFileName ||
    grant.sizeBytes !== artifact.sizeBytes ||
    !isSafeRelativeDownloadUrl(grant.url)
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function assertDownloadedBinaryBinding(
  download: AuthenticatedBinaryDownload,
  artifact: SolutionExportArtifact,
  grant: SolutionExportDownloadGrant,
): void {
  if (
    download.digest !== artifact.digest ||
    download.digest !== grant.digest ||
    download.fileName !== artifact.archiveFileName ||
    download.fileName !== grant.fileName ||
    !sameRuntimeString(download.mediaType, grant.mediaType) ||
    download.sizeBytes !== artifact.sizeBytes ||
    download.sizeBytes !== grant.sizeBytes ||
    download.bytes.byteLength !== grant.sizeBytes
  ) {
    throw new SolutionExportResponseBindingError();
  }
}

function saveAuthenticatedBinary(download: AuthenticatedBinaryDownload): void {
  const objectUrl = URL.createObjectURL(
    new Blob([download.bytes], { type: download.mediaType }),
  );
  const anchor = document.createElement("a");
  anchor.download = download.fileName;
  anchor.href = objectUrl;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

function retryExportQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof SolutionExportResponseBindingError) return false;
  if (
    error instanceof ApiClientError &&
    [
      "authentication_required",
      "access_denied",
      "not_found",
      "invalid_request",
    ].includes(error.envelope.error.code)
  ) {
    return false;
  }
  return failureCount < 1;
}

function exportErrorMessage(error: unknown, action: string): string {
  if (error instanceof SolutionExportResponseBindingError) {
    return `CloudMarkup rejected a mismatched ${action} response.`;
  }
  if (!(error instanceof ApiClientError)) {
    return `CloudMarkup could not ${action}.`;
  }
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session expired. Sign in again to continue.";
    case "access_denied":
      if (
        error.status === 403 &&
        error.envelope.error.fieldIssues?.some(
          (issue) =>
            issue.code === "solution-export.staff-credits-ai-only.v1" &&
            issue.path.length === 1 &&
            issue.path[0] === "targetProfileId",
        ) === true
      )
        return "Complimentary credits fund AI workflows, not exports. Exports require an eligible paid plan or trial.";
      return `You do not have permission to ${action}.`;
    case "not_found":
      return "The requested export is unavailable or has expired.";
    case "conflict":
    case "idempotency_key_reused":
      return "The request conflicts with the existing export attempt. Reload before trying again.";
    case "rate_limited":
      return "The export service is temporarily busy. Try again shortly.";
    case "service_unavailable":
      if (
        error.status === 503 &&
        error.envelope.error.fieldIssues?.some(
          (issue) =>
            issue.code ===
              "solution-export.inactive-subscription-policy-unavailable.v1" &&
            issue.path.length === 1 &&
            issue.path[0] === "targetProfileId",
        ) === true
      )
        return "Your subscription is inactive and export access after subscription changes is not configured. Review Billing or contact support before trying again.";
      return "The export service is temporarily unavailable.";
    default:
      return `CloudMarkup could not ${action}.`;
  }
}

function requiresNewExportRevision(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 422 &&
    error.envelope.error.code === "unsupported_version" &&
    error.envelope.error.fieldIssues?.some(
      (issue) =>
        issue.code === "solution-export.revision-tools-unavailable.v1" &&
        issue.path.length === 1 &&
        issue.path[0] === "solutionRevisionId",
    ) === true
  );
}

function requiresStreamingDownload(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.envelope.error.code === "service_unavailable" &&
    error.envelope.error.fieldIssues?.some(
      (issue) =>
        issue.code === "solution-export.download-streaming-required.v1" &&
        issue.path.length === 2 &&
        issue.path[0] === "artifact" &&
        issue.path[1] === "download",
    ) === true
  );
}

function isSafeRelativeDownloadUrl(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\r\n\0]/u.test(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value, window.location.origin);
    return (
      parsed.origin === window.location.origin &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function safeReference(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.includes("\\") ||
    value.split("/").includes("..")
  ) {
    return WITHHELD_PATH;
  }
  return value;
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${String(value)} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

function words(value: string): string {
  return value.replaceAll("-", " ");
}

function sameRuntimeString(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" && typeof right === "string" && left === right
  );
}

function sameDiagramOptions(
  left: DiagramOptions,
  right: DiagramOptions,
): boolean {
  return (
    left.background === right.background &&
    left.includeStableDeploymentIdentifiers ===
      right.includeStableDeploymentIdentifiers &&
    left.maxHeight === right.maxHeight &&
    left.maxWidth === right.maxWidth &&
    left.profile === right.profile &&
    left.scale === right.scale
  );
}

export function SolutionExportCreatePanel({
  organizationId,
  principal,
  projectId,
  revisionId,
  revisionName,
}: SolutionExportCreatePanelProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const navigate = useNavigate();
  const { mode } = useModePreference();
  const availability = useExportCapabilities();
  const aiAvailability = useAiCapabilities();
  const [environmentType, setEnvironmentType] =
    useState<EnvironmentType>("development");
  const [iacTarget, setIaCTarget] = useState<IaCTarget>(() =>
    runtime?.loadExportCapabilities === undefined
      ? "terraform"
      : "cloudformation",
  );
  const targetAvailable =
    availability.state === "fixture" ||
    (availability.state === "available" && iacTarget === "cloudformation");
  const [includeApplicationSource, setIncludeApplicationSource] =
    useState(false);
  const [exportName, setExportName] = useState(() =>
    defaultExportName(revisionName),
  );
  const idempotencyKey = useRef<string | undefined>(undefined);
  const requestScope = JSON.stringify({
    principalId: principal.id,
    organizationId,
    projectId,
    revisionId,
  });
  const activeScope = useRef<string | null>(requestScope);
  useEffect(() => {
    activeScope.current = requestScope;
    return () => {
      activeScope.current = null;
    };
  }, [requestScope]);
  const [diagramProfile, setDiagramProfile] =
    useState<DiagramProfile>("presentation");
  const [diagramBackground, setDiagramBackground] =
    useState<DiagramOptions["background"]>("opaque-light");
  const [diagramScale, setDiagramScale] = useState(2);
  const [diagramMaxWidth, setDiagramMaxWidth] = useState(4_096);
  const [diagramMaxHeight, setDiagramMaxHeight] = useState(4_096);
  const [includeStableIdentifiers, setIncludeStableIdentifiers] =
    useState(false);
  const organization = principal.organizationContexts.find(
    (candidate) => candidate.organizationId === organizationId,
  );
  const canExport = organization?.capabilities.includes("exports.run") === true;
  const createExport = useMutation({
    mutationFn: async (input: {
      readonly scope: string;
      readonly organizationId: string;
      readonly projectId: string;
      readonly revisionId: string;
      readonly environmentType: EnvironmentType;
      readonly exportName: string;
      readonly idempotencyKey: string;
      readonly applicationSource?: "ai-source-draft-v3";
      readonly diagram: DiagramOptions;
      readonly targetProfileId: (typeof TARGET_PROFILE_IDS)[IaCTarget];
    }) => {
      if (
        runtime === null ||
        !targetAvailable ||
        activeScope.current !== input.scope
      ) {
        throw new Error("This export format is currently unavailable.");
      }
      if (input.applicationSource !== undefined) {
        const support = await runtime.loadAiCapabilities?.(
          new AbortController().signal,
        );
        if (support?.applicationSources[0] !== input.applicationSource)
          throw new Error(
            "Reviewed application-source AI is unavailable on this server. Check availability again before retrying.",
          );
      }
      if (activeScope.current !== input.scope)
        throw new Error(
          "The export context changed. Open the current revision and try again.",
        );
      const response = await runtime.client.request(
        "solution-export-jobs.create",
        {
          body: {
            contractVersion: 1,
            environment: { environmentType: input.environmentType },
            exportName: input.exportName,
            diagram: input.diagram,
            ...(input.applicationSource === undefined
              ? {}
              : { applicationSource: input.applicationSource }),
            solutionRevisionId: input.revisionId,
            targetProfileId: input.targetProfileId,
          },
          headers: { "idempotency-key": input.idempotencyKey },
          path: { projectId: input.projectId },
        },
      );
      assertJobBinding(
        response.data,
        input.projectId,
        response.data.id,
        input.revisionId,
      );
      if (
        response.data.target.environment.environmentType !==
          input.environmentType ||
        response.data.target.exportName !== input.exportName ||
        !sameRuntimeString(
          response.data.target.profileId,
          input.targetProfileId,
        ) ||
        response.data.target.applicationSource !== input.applicationSource ||
        !sameDiagramOptions(response.data.target.diagram, input.diagram)
      ) {
        throw new SolutionExportResponseBindingError();
      }
      return response.data;
    },
    // Retry only unstructured upstream failures; application denials and
    // response-binding failures remain immediate. Variables and key stay exact.
    retry: (failures, error) =>
      activeScope.current === requestScope &&
      error instanceof ApiGatewayError &&
      failures < (error.status === 504 ? 1 : 2),
    retryDelay: (attempt) => 1000 * (attempt + 1),
    onSuccess: (job, input) => {
      if (activeScope.current !== input.scope) return;
      idempotencyKey.current = undefined;
      navigate(
        `${projectPath(input.organizationId, input.projectId)}/exports/${encodeRouteSelector(job.id)}`,
      );
    },
  });

  const needsNewRevision = requiresNewExportRevision(createExport.error);
  const creationTimedOut =
    createExport.error instanceof ApiGatewayError &&
    createExport.error.status === 504;

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canExport ||
      runtime === null ||
      !targetAvailable ||
      createExport.isPending ||
      (includeApplicationSource && !aiAvailability.sourceAvailable)
    )
      return;
    idempotencyKey.current ??= createMutationKey("solution-export");
    createExport.mutate({
      scope: requestScope,
      organizationId,
      projectId,
      revisionId,
      environmentType,
      exportName: exportName.trim(),
      idempotencyKey: idempotencyKey.current,
      diagram: {
        background: diagramBackground,
        includeStableDeploymentIdentifiers: includeStableIdentifiers,
        maxHeight: diagramMaxHeight,
        maxWidth: diagramMaxWidth,
        profile: diagramProfile,
        scale: diagramScale,
      },
      ...(includeApplicationSource
        ? { applicationSource: "ai-source-draft-v3" as const }
        : {}),
      targetProfileId: TARGET_PROFILE_IDS[iacTarget],
    });
  }

  return (
    <section
      className="feature-card solution-export-create"
      aria-labelledby="solution-export-create-title"
    >
      <p className="status-label">Infrastructure export</p>
      <h2 id="solution-export-create-title">
        Generate from this exact revision
      </h2>
      <p className="solution-export__assistance" data-assistance-mode={mode}>
        {mode === "guided"
          ? "Choose your format and environment. Your saved revision stays unchanged while the export service prepares a package for you to review."
          : "Start idempotent orchestration bound to this immutable Solution Revision and the selected deterministic IaC/Node.js target profile."}
      </p>
      {availability.state !== "fixture" ? (
        <p role="status" aria-label="Export availability">
          {availability.message}
        </p>
      ) : null}
      {availability.state === "error" ? (
        <Button onClick={availability.retry} type="button" variant="secondary">
          Check again
        </Button>
      ) : null}
      {createExport.isError ? (
        <StatePanel
          kind={needsNewRevision ? "unsupported" : "error"}
          live="assertive"
          title={
            needsNewRevision
              ? "Save a new revision to export"
              : creationTimedOut
                ? "Export request timed out"
                : "Export job was not created"
          }
          description={
            needsNewRevision
              ? "This revision needs the current export setup. Open the canvas and choose Create revision. Export the new revision when you're ready. This saved revision stays unchanged."
              : creationTimedOut
                ? "The server may have accepted this export. Retry the exact request to recover its status without creating a duplicate job."
                : exportErrorMessage(
                    createExport.error,
                    "create the export job",
                  )
          }
          actions={
            needsNewRevision ? (
              <AppLink
                className="button button--secondary"
                to={projectPath(organizationId, projectId) + "/editor"}
              >
                Open canvas to save a new revision
              </AppLink>
            ) : creationTimedOut ? (
              <Button
                onClick={() => {
                  const original = createExport.variables;
                  if (activeScope.current === original.scope)
                    createExport.mutate(original);
                }}
                type="button"
                variant="secondary"
              >
                Retry original export request
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {!canExport ? (
        <StatePanel
          kind="permission-denied"
          title="Export permission required"
          description="The verified organization context cannot run exports. No job was created."
        />
      ) : (
        <form className="solution-export-create__form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Environment type</span>
            <select
              disabled={createExport.isPending}
              value={environmentType}
              onChange={(event) => {
                setEnvironmentType(
                  event.currentTarget.value as EnvironmentType,
                );
                if (!createExport.isPending) idempotencyKey.current = undefined;
              }}
            >
              <option value="development">Development</option>
              <option value="test">Test</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </label>
          <label className="field">
            <span>Infrastructure target</span>
            <select
              aria-label="Infrastructure target"
              disabled={createExport.isPending}
              value={iacTarget}
              onChange={(event) => {
                setIaCTarget(event.currentTarget.value as IaCTarget);
                if (!createExport.isPending) idempotencyKey.current = undefined;
              }}
            >
              <option
                value="terraform"
                disabled={availability.state !== "fixture"}
              >
                Terraform
              </option>
              <option
                value="cloudformation"
                disabled={
                  availability.state !== "fixture" &&
                  availability.state !== "available"
                }
              >
                CloudFormation
              </option>
            </select>
            <small>
              {availability.state === "fixture"
                ? "Choose Terraform or CloudFormation for your own deployment workflow. Any unsupported resources are reported for review."
                : "Terraform exports are not available in this beta yet. CloudFormation exports include infrastructure and diagrams, with optional AI application source."}
            </small>
          </label>
          <label className="field">
            <span>Export name</span>
            <input
              disabled={createExport.isPending}
              required
              maxLength={96}
              value={exportName}
              onChange={(event) => {
                setExportName(event.currentTarget.value);
                if (!createExport.isPending) idempotencyKey.current = undefined;
              }}
            />
          </label>
          <Disclosure summary="Diagram options (optional)">
            <fieldset
              className="solution-export-create__diagram"
              disabled={createExport.isPending}
            >
              <legend>Architecture diagram</legend>
              <p>
                SVG and high-resolution PNG are rendered from this immutable
                Solution Revision, not from the current editor viewport.
              </p>
              <label className="field">
                <span>Diagram profile</span>
                <select
                  disabled={createExport.isPending}
                  value={diagramProfile}
                  onChange={(event) => {
                    const profile = event.currentTarget.value as DiagramProfile;
                    setDiagramProfile(profile);
                    if (profile === "presentation") {
                      setIncludeStableIdentifiers(false);
                    }
                    idempotencyKey.current = undefined;
                  }}
                >
                  <option value="presentation">Presentation</option>
                  <option value="technical">Technical</option>
                </select>
              </label>
              <label className="field">
                <span>Diagram background</span>
                <select
                  disabled={createExport.isPending}
                  value={diagramBackground}
                  onChange={(event) => {
                    setDiagramBackground(
                      event.currentTarget.value as DiagramOptions["background"],
                    );
                    idempotencyKey.current = undefined;
                  }}
                >
                  <option value="opaque-light">Opaque light</option>
                  <option value="canvas-light">Canvas light</option>
                  <option value="transparent">Transparent</option>
                </select>
              </label>
              <label className="field">
                <span>PNG scale</span>
                <select
                  disabled={createExport.isPending}
                  value={diagramScale}
                  onChange={(event) => {
                    setDiagramScale(Number(event.currentTarget.value));
                    idempotencyKey.current = undefined;
                  }}
                >
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={3}>3×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              <label className="field">
                <span>Maximum diagram width</span>
                <input
                  disabled={createExport.isPending}
                  max={8_192}
                  min={480}
                  step={32}
                  type="number"
                  value={diagramMaxWidth}
                  onChange={(event) => {
                    setDiagramMaxWidth(Number(event.currentTarget.value));
                    idempotencyKey.current = undefined;
                  }}
                />
              </label>
              <label className="field">
                <span>Maximum diagram height</span>
                <input
                  disabled={createExport.isPending}
                  max={8_192}
                  min={320}
                  step={32}
                  type="number"
                  value={diagramMaxHeight}
                  onChange={(event) => {
                    setDiagramMaxHeight(Number(event.currentTarget.value));
                    idempotencyKey.current = undefined;
                  }}
                />
              </label>
              <label className="solution-export-create__checkbox">
                <input
                  checked={includeStableIdentifiers}
                  disabled={
                    createExport.isPending || diagramProfile !== "technical"
                  }
                  type="checkbox"
                  onChange={(event) => {
                    setIncludeStableIdentifiers(event.currentTarget.checked);
                    idempotencyKey.current = undefined;
                  }}
                />
                <span>Include stable deployment identifiers</span>
              </label>
              <small>
                Large diagrams fit to content within the approved pixel budget.
                Any detail reduction or minimum-scale condition remains visible
                as an export warning.
              </small>
            </fieldset>
          </Disclosure>
          <h3>Package contents</h3>
          {includeApplicationSource ? (
            <AiWorkflowProgress
              stage={createExport.isPending ? "generating" : "context"}
            />
          ) : null}
          <p className="solution-export__assistance">
            Infrastructure code and architecture diagrams are included. AI
            application source is optional.
          </p>
          <label className="solution-export-create__checkbox">
            <input
              type="checkbox"
              checked={includeApplicationSource}
              disabled={
                createExport.isPending ||
                (!aiAvailability.sourceAvailable && !includeApplicationSource)
              }
              onChange={(event) => {
                setIncludeApplicationSource(event.currentTarget.checked);
                idempotencyKey.current = undefined;
              }}
            />
            <span>Generate application source with AI</span>
          </label>
          <p className="solution-export__assistance">
            Optional Node.js 24 Lambda source uses this saved revision&apos;s
            reviewed configurations, references, connections, permissions and
            complete workload contracts. Secret values and locators are
            excluded. Configure operations and behavior contracts, then save a
            revision. Missing or oversized context stops generation. Supports
            one to eight Lambda workloads. AI source and generated tests remain
            unexecuted: review, build and test the downloaded source before
            deployment. This draft does not create a Lambda deployment artifact
            or automatically bind source into infrastructure. AI source
            generation temporarily reserves up to 100 credits and charges only
            the actual model token use after the draft is stored. The exact
            charge appears on this export job and in the organization’s Usage
            totals.
          </p>
          <p role="status">
            {aiAvailability.checked ? "AI availability checked. " : ""}
            {aiAvailability.state === "loading"
              ? "Checking application-source AI availability."
              : aiAvailability.state === "error"
                ? "Application-source AI availability could not be checked."
                : aiAvailability.sourceAvailable
                  ? "Selecting AI application source consents to sending the reviewed revision context and using credits."
                  : "Reviewed application-source AI is unavailable on this server. Infrastructure exports remain available."}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={aiAvailability.retry}
            disabled={
              createExport.isPending || aiAvailability.state === "loading"
            }
          >
            Check AI availability
          </Button>
          <Disclosure summary="Revision and export details">
            <dl className="solution-export__metadata">
              <div>
                <dt>Solution Revision</dt>
                <dd>
                  <code>{revisionId}</code>
                </dd>
              </div>
              <div>
                <dt>Approved target profile</dt>
                <dd>
                  <code>{TARGET_PROFILE_IDS[iacTarget]}</code>
                </dd>
              </div>
            </dl>
          </Disclosure>
          {createExport.isPending ? (
            <progress aria-label="Preparing export" />
          ) : null}
          <Button
            disabled={
              runtime === null ||
              !targetAvailable ||
              (includeApplicationSource && !aiAvailability.sourceAvailable) ||
              exportName.trim().length === 0
            }
            loading={createExport.isPending}
            loadingLabel="Creating export job"
            type="submit"
            variant="primary"
          >
            Generate export
          </Button>
        </form>
      )}
    </section>
  );
}

export function SolutionExportPage(props: SolutionExportPageProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const context = verifiedContext(props, runtime);
  if (context === null || context === "unavailable") {
    return <ExportUnavailablePage denied={false} />;
  }
  if (context === "denied") return <ExportUnavailablePage denied />;
  return <AuthenticatedSolutionExportPage context={context} {...props} />;
}

function ExportUnavailablePage({ denied }: { readonly denied: boolean }) {
  return (
    <RoutePage
      title="Export unavailable"
      eyebrow={denied ? "Permission denied" : "Backend unavailable"}
      description="No export details are disclosed from route selectors or local state."
      routeKey={`solution-export-${denied ? "denied" : "unavailable"}`}
    >
      <StatePanel
        kind={denied ? "permission-denied" : "error"}
        live="assertive"
        title="Export access unavailable"
        description={
          denied
            ? "The verified session cannot read this project export."
            : "An authenticated export service is required."
        }
      />
    </RoutePage>
  );
}

function AuthenticatedSolutionExportPage({
  context,
  exportJobId,
  projectId,
}: SolutionExportPageProps & { readonly context: VerifiedExportContext }) {
  const jobKey = cloudMarkupQueryKeys.solutionExportJob(
    context.principal.id,
    context.organizationId,
    projectId,
    exportJobId,
  );
  const job = useQuery({
    queryKey: jobKey,
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-export-jobs.get",
        { path: { projectId, solutionExportJobId: exportJobId } },
      );
      assertJobBinding(response.data, projectId, exportJobId);
      return response.data;
    },
    refetchInterval: (query) => {
      const current = query.state.data;
      if (current === undefined || TERMINAL_JOB_STATES.has(current.state)) {
        return false;
      }
      return current.pollAfterMilliseconds ?? false;
    },
    refetchIntervalInBackground: false,
    retry: retryExportQuery,
  });
  const artifact = useQuery({
    enabled: job.data?.artifact !== undefined,
    queryKey:
      job.data?.artifact === undefined
        ? [...jobKey, "artifact", "pending"]
        : cloudMarkupQueryKeys.solutionExportArtifact(
            context.principal.id,
            context.organizationId,
            projectId,
            job.data.artifact.artifactId,
          ),
    queryFn: async () => {
      const currentJob = job.data;
      if (currentJob?.artifact === undefined) {
        throw new SolutionExportResponseBindingError();
      }
      const response = await context.runtime.client.request(
        "solution-export-artifacts.get",
        {
          path: {
            projectId,
            solutionExportArtifactId: currentJob.artifact.artifactId,
          },
        },
      );
      assertArtifactBinding(response.data, currentJob);
      return response.data;
    },
    retry: retryExportQuery,
  });
  const path = projectPath(context.organizationId, projectId);

  return (
    <RoutePage
      title="Solution export"
      eyebrow="Saved revision export"
      description="Generate, check, and download your infrastructure and application files."
      routeKey={`solution-export-${projectId}-${exportJobId}`}
      actions={
        <AppLink className="button button--secondary" to={`${path}/revisions`}>
          Revision history
        </AppLink>
      }
    >
      {job.isPending ? (
        <LoadingState
          live="polite"
          title="Loading export job"
          description="Resolving the authorized job bound to this project."
        />
      ) : job.isError ? (
        <StatePanel
          actions={
            <Button onClick={() => void job.refetch()}>Try again</Button>
          }
          kind="error"
          live="assertive"
          title="Export job unavailable"
          description={exportErrorMessage(job.error, "load the export job")}
        />
      ) : (
        <SolutionExportJobView
          artifact={artifact}
          context={context}
          job={job.data}
          jobKey={jobKey}
          projectId={projectId}
        />
      )}
    </RoutePage>
  );
}

interface JobViewProps {
  readonly artifact: UseQueryResult<SolutionExportArtifact, unknown>;
  readonly context: VerifiedExportContext;
  readonly job: SolutionExportJob;
  readonly jobKey: ReturnType<typeof cloudMarkupQueryKeys.solutionExportJob>;
  readonly projectId: string;
}

function SolutionExportJobView({
  artifact,
  context,
  job,
  jobKey,
  projectId,
}: JobViewProps) {
  const { mode } = useModePreference();
  const credits = useQuery({
    queryKey: [...jobKey, "ai-credits"],
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-export-jobs.credits.get",
        { path: { projectId, solutionExportJobId: job.id } },
      );
      if (response.data.jobId !== job.id)
        throw new SolutionExportResponseBindingError();
      return response.data;
    },
    refetchInterval: (query) =>
      !TERMINAL_JOB_STATES.has(job.state) ||
      ["reserved", "dispatched", "usage-recorded"].includes(
        query.state.data?.state ?? "",
      )
        ? 5_000
        : false,
    refetchIntervalInBackground: false,
    retry: retryExportQuery,
  });
  useEffect(() => {
    if (credits.data?.state === "settled" || credits.data?.state === "released")
      void context.runtime.queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("editor-credit-balance"),
      });
  }, [credits.data?.state, context.runtime.queryClient]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cancelIdempotencyKey = useRef<string | undefined>(undefined);
  const canCancel =
    context.organization.capabilities.includes("exports.run") &&
    (job.state === "queued" || job.state === "running");
  const cancel = useMutation({
    mutationFn: async () => {
      if (!canCancel) throw new Error("Export cancellation is unavailable.");
      cancelIdempotencyKey.current ??= createMutationKey(
        "solution-export-cancel",
      );
      const response = await context.runtime.client.request(
        "solution-export-jobs.cancel",
        {
          body: { contractVersion: 1 },
          headers: { "idempotency-key": cancelIdempotencyKey.current },
          path: { projectId, solutionExportJobId: job.id },
        },
      );
      assertJobBinding(response.data, projectId, job.id);
      return response.data;
    },
    onSuccess: (updatedJob) => {
      cancelIdempotencyKey.current = undefined;
      context.runtime.queryClient.setQueryData(jobKey, updatedJob);
      setCancelOpen(false);
    },
  });
  const progress =
    (job.progress.completedStages / job.progress.totalStages) * 100;

  return (
    <div className="solution-export" data-assistance-mode={mode}>
      <JobStatus
        canCancel={canCancel}
        job={job}
        onCancel={() => {
          setCancelOpen(true);
        }}
        progress={progress}
        cancelButtonRef={cancelButtonRef}
      />
      {job.target.applicationSource &&
      ["queued", "running", "succeeded"].includes(job.state) ? (
        <AiWorkflowProgress
          stage={
            job.state === "succeeded"
              ? "review"
              : job.state === "queued"
                ? "context"
                : "generating"
          }
        />
      ) : null}
      {credits.data && credits.data.state !== "not-metered" ? (
        <p role="status">{describeBetaInfrastructureCredits(credits.data)}</p>
      ) : null}
      <WarningDiagnosticEvidence
        job={job}
        context={context}
        projectId={projectId}
      />
      {artifact.isPending && job.artifact !== undefined ? (
        <LoadingState
          live="polite"
          title="Loading verified artifact"
          description="Resolving the immutable file manifest and download policy."
        />
      ) : artifact.isError ? (
        <StatePanel
          actions={
            <Button onClick={() => void artifact.refetch()}>Try again</Button>
          }
          kind="error"
          live="assertive"
          title="Artifact review unavailable"
          description={exportErrorMessage(
            artifact.error,
            "load the export artifact",
          )}
        />
      ) : artifact.data === undefined ? null : (
        <ArtifactReview
          artifact={artifact.data}
          context={context}
          job={job}
          projectId={projectId}
        />
      )}
      {cancel.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Cancellation was not requested"
          description={exportErrorMessage(
            cancel.error,
            "cancel the export job",
          )}
        />
      ) : null}
      {job.state === "succeeded" ? (
        <Disclosure summary="Completed export checks">
          <StageProgress job={job} />
        </Disclosure>
      ) : (
        <StageProgress job={job} />
      )}
      <Disclosure summary="Application coverage and build details">
        <CoverageSummary job={job} />
        <ApplicationVerificationSummary job={job} />
      </Disclosure>
      <Disclosure summary="Revision and technical details">
        <ExactBindingSummary job={job} />
      </Disclosure>
      {job.state === "failed" || job.state === "canceled" ? (
        <StatePanel
          kind={job.state === "failed" ? "error" : "stale"}
          live={job.state === "failed" ? "assertive" : "polite"}
          title={
            job.state === "failed" ? "Download blocked" : "Export canceled"
          }
          description={
            job.state === "failed"
              ? "We couldn't finish this export. Review the failed checks above, make any needed changes, and try again. No download was created."
              : "The cancellation remains recorded against this exact revision. No downloadable artifact was published."
          }
        />
      ) : null}
      <Dialog
        description="CloudMarkup will stop remaining work when the worker acknowledges the request. Completed evidence stays visible."
        footer={
          <div className="solution-export__dialog-actions">
            <Button
              onClick={() => {
                setCancelOpen(false);
              }}
            >
              Keep running
            </Button>
            <Button
              disabled={!canCancel}
              loading={cancel.isPending}
              loadingLabel="Requesting cancellation"
              onClick={() => {
                cancel.mutate();
              }}
              variant="danger"
            >
              Request cancellation
            </Button>
          </div>
        }
        onClose={() => {
          setCancelOpen(false);
        }}
        open={cancelOpen && canCancel}
        returnFocusRef={cancelButtonRef}
        title="Cancel this export job?"
      >
        <p>
          This does not switch revisions, delete evidence, deploy, or revoke an
          already downloaded file.
        </p>
      </Dialog>
    </div>
  );
}

function JobStatus({
  canCancel,
  cancelButtonRef,
  job,
  onCancel,
  progress,
}: {
  readonly canCancel: boolean;
  readonly cancelButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly job: SolutionExportJob;
  readonly onCancel: () => void;
  readonly progress: number;
}) {
  if (!TERMINAL_JOB_STATES.has(job.state)) {
    return (
      <LoadingState
        {...(canCancel
          ? {
              actions: (
                <button
                  className="button button--danger"
                  onClick={onCancel}
                  ref={cancelButtonRef}
                  type="button"
                >
                  Cancel export
                </button>
              ),
            }
          : {})}
        live="polite"
        {...(job.state === "running" ? { progress } : {})}
        progressLabel="Export stage progress"
        title={
          job.state === "cancellation-requested"
            ? "Cancellation requested"
            : job.state === "queued"
              ? "Waiting to start export"
              : "Export checks in progress"
        }
        description={
          job.state === "queued"
            ? "Your export is saved and waiting for a worker. This page checks automatically. You can return to this export or cancel it below."
            : job.progress.message
        }
      />
    );
  }
  if (job.state === "succeeded") {
    return (
      <div className="solution-export__complete" role="status">
        <StatusBadge label="Ready" tone="success" />
        <h2>Export checks passed</h2>
      </div>
    );
  }
  return (
    <StatePanel
      kind={job.state === "failed" ? "error" : "stale"}
      live={job.state === "failed" ? "assertive" : "polite"}
      title={
        job.state === "failed" ? "Export checks failed" : "Export canceled"
      }
      description={job.progress.message}
    />
  );
}

function ExactBindingSummary({ job }: { readonly job: SolutionExportJob }) {
  return (
    <section
      className="feature-card"
      aria-labelledby="solution-export-binding-title"
    >
      <p className="status-label">Immutable input</p>
      <h2 id="solution-export-binding-title">
        Exact revision and target binding
      </h2>
      <dl className="solution-export__metadata">
        <div>
          <dt>Job</dt>
          <dd>
            <code>{job.id}</code>
          </dd>
        </div>
        <div>
          <dt>Export run</dt>
          <dd>Run {job.runSequence}</dd>
        </div>
        {job.rerunOfJobId === undefined ? null : (
          <div>
            <dt>Rerun of</dt>
            <dd>
              <code>{job.rerunOfJobId}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>Solution Revision</dt>
          <dd>
            <code>{job.solutionRevision.solutionRevisionId}</code>
          </dd>
        </div>
        <div>
          <dt>Revision manifest</dt>
          <dd>
            <code>{job.solutionRevision.manifestDigest}</code>
          </dd>
        </div>
        <div>
          <dt>Request digest</dt>
          <dd>
            <code>{job.requestDigest}</code>
          </dd>
        </div>
        <div>
          <dt>Target profile</dt>
          <dd>
            <code>{job.target.profileId}</code>
          </dd>
        </div>
        <div>
          <dt>Target settings digest</dt>
          <dd>
            <code>{job.target.settingsDigest}</code>
          </dd>
        </div>
        <div>
          <dt>Diagram profile</dt>
          <dd>{words(job.target.diagram.profile)}</dd>
        </div>
        <div>
          <dt>Diagram background</dt>
          <dd>{words(job.target.diagram.background)}</dd>
        </div>
        <div>
          <dt>Diagram PNG scale</dt>
          <dd>{job.target.diagram.scale}×</dd>
        </div>
        <div>
          <dt>Diagram bounds</dt>
          <dd>
            {job.target.diagram.maxWidth} × {job.target.diagram.maxHeight}
          </dd>
        </div>
        <div>
          <dt>Stable deployment identifiers</dt>
          <dd>
            {job.target.diagram.includeStableDeploymentIdentifiers
              ? "Included"
              : "Not included"}
          </dd>
        </div>
        <div>
          <dt>Environment</dt>
          <dd>{words(job.target.environment.environmentType)}</dd>
        </div>
      </dl>
    </section>
  );
}

function StageProgress({ job }: { readonly job: SolutionExportJob }) {
  return (
    <section
      className="feature-card"
      aria-labelledby="solution-export-stages-title"
    >
      <p className="status-label">Progress</p>
      <h2 id="solution-export-stages-title">Validation and packaging stages</h2>
      <progress
        aria-label="Completed export stages"
        max={Math.max(1, job.stages.length)}
        value={
          job.stages.filter(
            (stage) =>
              stage.status === "succeeded" || stage.status === "skipped",
          ).length
        }
      />
      <ol className="solution-export__stages" aria-label="Export stages">
        {job.stages.map((stage) => (
          <li
            key={stage.stage}
            aria-current={stage.status === "running" ? "step" : undefined}
          >
            <StatusBadge
              label={`${words(stage.stage)} — ${words(stage.status)}`}
              tone={stageTone(stage.status)}
            />
            {stage.completedAt === undefined ? null : (
              <time dateTime={stage.completedAt}>
                {formatTimestamp(stage.completedAt)}
              </time>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function stageTone(
  status: SolutionExportJob["stages"][number]["status"],
): StatusTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    case "running":
      return "info";
    case "canceled":
      return "warning";
    case "skipped":
      return "unsupported";
    case "pending":
      return "neutral";
  }
}

function CoverageSummary({ job }: { readonly job: SolutionExportJob }) {
  const coverage = job.generationCoverage;
  return (
    <section
      className="feature-card"
      aria-labelledby="solution-export-coverage-title"
    >
      <p className="status-label">Exact revision assessment</p>
      <h2 id="solution-export-coverage-title">
        {coverageLabel(coverage.state)}
      </h2>
      {coverage.state === "infrastructure-only" ? (
        <p>
          <strong>Application code is required.</strong>{" "}
          {job.state === "succeeded"
            ? "This package’s verified coverage is infrastructure only. Any optional AI source is a draft; no Lambda build is claimed."
            : "This revision assessment covers infrastructure only; no successful package, application source, or Lambda build is claimed."}
        </p>
      ) : null}
      <p>
        This immutable generation assessment comes from the selected Solution
        Revision. Application build verification is reported separately and
        cannot replace it.
      </p>
      {coverage.workloads.length === 0 ? (
        <p>No application workloads are in scope.</p>
      ) : (
        <ul className="solution-export__coverage-list">
          {coverage.workloads.map((workload) => (
            <li key={workload.workloadId}>
              <code>{workload.workloadId}</code>
              <span>{coverageLabel(workload.state)}</span>
              <p>Missing workload requirements</p>
              {workload.missingRequirements.length === 0 ? (
                <p>None.</p>
              ) : (
                <ul>
                  {workload.missingRequirements.map((requirement) => (
                    <li key={requirement}>
                      <code>{requirement}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p>Unresolved behavior references</p>
              {workload.unresolvedRequirementIds.length === 0 ? (
                <p>None.</p>
              ) : (
                <ul>
                  {workload.unresolvedRequirementIds.map((requirementId) => (
                    <li key={requirementId}>
                      <code>{requirementId}</code>
                    </li>
                  ))}
                </ul>
              )}
              <p>Workload coverage Evidence</p>
              {workload.evidence.length === 0 ? (
                <p>None.</p>
              ) : (
                <ul>
                  {workload.evidence.map((evidence) => (
                    <li key={`${evidence.requirement}:${evidence.evidenceId}`}>
                      <code>{evidence.requirement}</code>
                      {" — "}
                      <code>{evidence.evidenceId}</code>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>Missing solution requirements</h3>
      {coverage.missingRequirements.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {coverage.missingRequirements.map((requirement) => (
            <li key={requirement}>
              <code>{requirement}</code>
            </li>
          ))}
        </ul>
      )}
      <h3>Solution coverage Evidence</h3>
      {coverage.evidence.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {coverage.evidence.map((evidence) => (
            <li key={`${evidence.requirement}:${evidence.evidenceId}`}>
              <code>{evidence.requirement}</code>
              {" — "}
              <code>{evidence.evidenceId}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationVerificationSummary({
  job,
}: {
  readonly job: SolutionExportJob;
}) {
  const verifications =
    job.applicationVerifications ??
    (job.applicationVerification === undefined
      ? []
      : [job.applicationVerification]);
  const firstVerification = verifications[0];
  const title =
    firstVerification === undefined
      ? "No application verification recorded"
      : verifications.length === 1
        ? firstVerification.confirmedState === "custom-implementation-required"
          ? coverageLabel(firstVerification.confirmedState)
          : `${coverageLabel(firstVerification.confirmedState)} confirmed`
        : verifications.some(
              ({ confirmedState }) =>
                confirmedState === "custom-implementation-required",
            )
          ? "Application verification incomplete"
          : `${String(verifications.length)} application builds confirmed`;
  const noVerificationMessage =
    job.generationCoverage.state === "infrastructure-only"
      ? "No application build verification applies to this infrastructure-only revision assessment."
      : TERMINAL_JOB_STATES.has(job.state)
        ? "No isolated application build applies or was run for this coverage mode. Readiness remains the immutable revision assessment."
        : "No application build verification has been recorded for this job yet.";
  return (
    <section
      className="feature-card"
      aria-labelledby="solution-export-application-verification-title"
    >
      <p className="status-label">Application build verification</p>
      <h2 id="solution-export-application-verification-title">{title}</h2>
      {verifications.length === 0 ? (
        <p>{noVerificationMessage}</p>
      ) : (
        <div className="solution-export__record-grid">
          {verifications.map((verification) => (
            <article
              className="solution-export__verification"
              key={verification.workloadId}
            >
              <p>
                This build result is bound to the exact revision, generated
                source, workload, and build request. It does not rewrite the
                immutable revision assessment above.
              </p>
              <dl className="solution-export__metadata">
                <div>
                  <dt>Revision assessment input</dt>
                  <dd>{coverageLabel(verification.inputState)}</dd>
                </div>
                <div>
                  <dt>Confirmed after build</dt>
                  <dd>{coverageLabel(verification.confirmedState)}</dd>
                </div>
                <div>
                  <dt>Workload</dt>
                  <dd>
                    <code>{verification.workloadId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Solution Revision</dt>
                  <dd>
                    <code>{verification.solutionRevisionId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Solution Revision digest</dt>
                  <dd>
                    <code>{verification.solutionRevisionDigest}</code>
                  </dd>
                </div>
                <div>
                  <dt>Build request digest</dt>
                  <dd>
                    <code>{verification.buildRequestDigest}</code>
                  </dd>
                </div>
                {verification.generationArtifactDigest === undefined ? null : (
                  <div>
                    <dt>Generated application digest</dt>
                    <dd>
                      <code>{verification.generationArtifactDigest}</code>
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Evidence linkage</dt>
                  <dd>
                    {verification.evidenceId === undefined ? (
                      "No passing build Evidence"
                    ) : (
                      <code>{verification.evidenceId}</code>
                    )}
                  </dd>
                </div>
              </dl>
              {verification.downgradeReason === undefined ? null : (
                <p>
                  <strong>Downgrade reason:</strong>{" "}
                  {verification.downgradeReason}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function WarningDiagnosticEvidence({
  job,
  context,
  projectId,
}: {
  readonly job: SolutionExportJob;
  readonly context: VerifiedExportContext;
  readonly projectId: string;
}) {
  return (
    <div className="solution-export__record-grid">
      {job.warnings.length > 0 ? (
        <section
          className="feature-card"
          aria-labelledby="solution-export-warnings-title"
        >
          <p className="status-label">Warnings</p>
          <h2 id="solution-export-warnings-title">
            Readiness and unresolved behavior
          </h2>
          {job.warnings.length === 0 ? (
            <p>No export warnings were recorded.</p>
          ) : (
            <ul>
              {job.warnings.map((warning, index) => (
                <li key={`${warning.code}-${String(index)}`}>
                  <code>{warning.code}</code>: {warning.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {job.diagnostics.length > 0 ? (
        <section
          className="feature-card"
          aria-labelledby="solution-export-diagnostics-title"
        >
          <p className="status-label">Sanitized diagnostics</p>
          <h2 id="solution-export-diagnostics-title">
            Compiler and runner findings
          </h2>
          {job.diagnostics.length === 0 ? (
            <p>No diagnostics were recorded.</p>
          ) : (
            <ul className="solution-export__diagnostics">
              {job.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.stage}-${diagnostic.code}-${String(index)}`}
                >
                  <StatusBadge
                    label={diagnostic.severity}
                    tone={
                      diagnostic.severity === "error"
                        ? "error"
                        : diagnostic.severity === "warning"
                          ? "warning"
                          : "info"
                    }
                  />
                  <span>
                    {diagnostic.code ===
                    "TARGET_GENERATED_POLICY_COVERAGE_MISSING"
                      ? "A connection is missing its required permission. Review it in Connect and save a new revision after correcting it. If the error persists, this connection type needs a provider fix."
                      : diagnostic.message}
                  </span>
                  {diagnostic.recoveryReferences ? (
                    <>
                      <p>
                        These items belong to this saved export revision. The
                        canvas will check its current version before focusing.
                      </p>
                      <ul aria-label="Affected export items">
                        {diagnostic.recoveryReferences.locations.map(
                          (reference) => (
                            <li key={JSON.stringify(reference)}>
                              {reference.kind === "node" ||
                              reference.kind === "edge" ? (
                                <AppLink
                                  to={`${projectPath(context.organizationId, projectId)}/editor?${exportDiagnosticSearch({ contractVersion: 1, jobId: job.id, solutionRevisionId: job.solutionRevision.solutionRevisionId, manifestDigest: job.solutionRevision.manifestDigest, code: diagnostic.code, reference })}`}
                                >
                                  Review {diagnosticReferenceLabel(reference)}
                                </AppLink>
                              ) : (
                                <span>
                                  {diagnosticReferenceLabel(reference)}. Review
                                  its dedicated editor or recorded checks.
                                </span>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </>
                  ) : (
                    <p>
                      Exact canvas navigation is unavailable for this older
                      finding. Review its recorded references and saved
                      revision.
                    </p>
                  )}
                  <Disclosure summary="Diagnostic details">
                    <code>{diagnostic.code}</code>
                    <DiagnosticReferences diagnostic={diagnostic} />
                  </Disclosure>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <Disclosure
        summary="Recorded validation evidence"
        open={job.state === "failed" ? true : undefined}
      >
        <section
          className="feature-card"
          aria-labelledby="solution-export-evidence-title"
        >
          <p className="status-label">Evidence</p>
          <h2 id="solution-export-evidence-title">
            Recorded validation evidence
          </h2>
          {job.evidence.length === 0 ? (
            <p>No evidence records are available yet.</p>
          ) : (
            <ul className="solution-export__evidence">
              {job.evidence.map((evidence) => (
                <li key={evidence.evidenceId}>
                  <StatusBadge
                    label={`${words(evidence.kind)} — ${evidence.status}`}
                    tone={
                      evidence.status === "passed"
                        ? "success"
                        : evidence.status === "failed"
                          ? "error"
                          : "incomplete"
                    }
                  />
                  <code>{evidence.digest}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Disclosure>
    </div>
  );
}

function DiagnosticReferences({
  diagnostic,
}: {
  readonly diagnostic: SolutionExportJob["diagnostics"][number];
}) {
  const references = [
    ["path", safeReference(diagnostic.path)],
    ["node", diagnostic.nodeId],
    ["edge", diagnostic.edgeId],
    ["workload", diagnostic.workloadId],
    ["owned policy", diagnostic.ownedPolicyId],
  ].filter((entry): entry is [string, string] => entry[1] !== undefined);
  return references.length === 0 ? null : (
    <span className="solution-export__references">
      {references.map(([label, value]) => (
        <span key={label}>
          {label}: <code>{value}</code>
        </span>
      ))}
    </span>
  );
}

function ArtifactReview({
  artifact,
  context,
  job,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly job: SolutionExportJob;
  readonly projectId: string;
}) {
  const [tab, setTab] = useState("sources");
  const allFiles = useMemo(
    () =>
      [...artifact.files].sort((left, right) =>
        left.path.localeCompare(right.path, "en"),
      ),
    [artifact.files],
  );
  const sourceFiles = allFiles.filter(
    (file) =>
      file.path.startsWith("cloudmarkup/") && !isManifestPath(file.path),
  );
  const diagramFiles = allFiles.filter((file) =>
    file.path.startsWith("diagram/"),
  );
  const infrastructureFiles = allFiles.filter((file) =>
    file.path.startsWith("infrastructure/"),
  );
  const buildFiles = allFiles.filter(
    (file) =>
      file.path.startsWith("application/artifacts/") ||
      file.ownership === "generated-build-artifact",
  );
  const testFiles = allFiles.filter((file) => isTestPath(file.path));
  const applicationFiles = allFiles.filter(
    (file) =>
      file.path.startsWith("application/") &&
      !buildFiles.includes(file) &&
      !testFiles.includes(file) &&
      !file.path.startsWith("application/evidence/"),
  );
  const items: readonly TabItem[] = [
    {
      id: "sources",
      label: "Sources",
      panel: (
        <ArtifactFilePanel
          artifact={artifact}
          context={context}
          emptyMessage="No architecture-as-code source files were published."
          files={sourceFiles}
          projectId={projectId}
          title="Architecture, workload, and contract source"
        />
      ),
    },
    {
      id: "diagram",
      label: "Diagram",
      panel: (
        <DiagramArtifactPanel
          artifact={artifact}
          context={context}
          files={diagramFiles}
          job={job}
          projectId={projectId}
        />
      ),
    },
    {
      id: "iac",
      label: "IaC",
      panel: (
        <ArtifactFilePanel
          artifact={artifact}
          context={context}
          emptyMessage="No generated infrastructure files were published."
          files={infrastructureFiles}
          projectId={projectId}
          title="Generated infrastructure"
        />
      ),
    },
    {
      id: "application",
      label: "Application",
      panel: (
        <ArtifactFilePanel
          artifact={artifact}
          context={context}
          emptyMessage="Application source is not included for this coverage state."
          files={applicationFiles}
          projectId={projectId}
          title="Generated and user-owned application source"
        />
      ),
    },
    {
      id: "build",
      label: "Built artifacts",
      panel: (
        <ArtifactFilePanel
          artifact={artifact}
          context={context}
          emptyMessage="No application build artifact is included."
          files={buildFiles}
          projectId={projectId}
          title="Verified workload artifacts"
        />
      ),
    },
    {
      id: "tests",
      label: "Tests",
      panel: (
        <TestArtifactPanel
          artifact={artifact}
          context={context}
          files={testFiles}
          job={job}
          projectId={projectId}
        />
      ),
    },
    {
      id: "diff",
      label: "Diff",
      panel: (
        <ArtifactDiffPanel
          artifact={artifact}
          context={context}
          projectId={projectId}
        />
      ),
    },
    {
      id: "manifest",
      label: "Manifest",
      panel: (
        <ManifestPanel
          artifact={artifact}
          context={context}
          files={allFiles}
          job={job}
          projectId={projectId}
        />
      ),
    },
  ];
  return (
    <section
      className="feature-card solution-export__artifact"
      aria-labelledby="solution-export-artifact-title"
    >
      <h2 className="visually-hidden" id="solution-export-artifact-title">
        Artifact review and download
      </h2>
      <ArtifactDownload
        key={JSON.stringify([
          context.principal.id,
          context.organizationId,
          projectId,
          artifact.id,
          artifact.digest,
        ])}
        artifact={artifact}
        context={context}
        projectId={projectId}
      />
      {context.organization.capabilities.includes("exports.run") &&
      context.organization.capabilities.includes("integrations.read") ? (
        <nav
          aria-label="Repository export destinations"
          className="solution-export__dialog-actions"
        >
          <AppLink
            className="button button--secondary"
            to={
              "/organizations/" +
              encodeRouteSelector(context.organizationId) +
              "/projects/" +
              encodeRouteSelector(projectId) +
              "/artifacts/" +
              encodeRouteSelector(artifact.id) +
              "/export/github"
            }
          >
            Export to GitHub
          </AppLink>
        </nav>
      ) : null}
      <Tabs
        ariaLabel="Solution export artifact"
        items={items}
        onValueChange={setTab}
        value={tab}
      />
    </section>
  );
}

function isTestPath(path: string): boolean {
  return /(^|\/)(?:__tests__|tests?|contract-tests?)(?:\/|$)|\.(?:test|spec)\.[^/]+$/u.test(
    path,
  );
}

function isManifestPath(path: string): boolean {
  return (
    path === "README.md" ||
    path.includes("manifest") ||
    path.endsWith(".sha256")
  );
}

function DiagramArtifactPanel({
  artifact,
  context,
  files,
  job,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly files: readonly SolutionExportFile[];
  readonly job: SolutionExportJob;
  readonly projectId: string;
}) {
  const [format, setFormat] = useState<"svg" | "png">("svg");
  const svgFile = files.find(
    (file) => file.path === "diagram/architecture.svg",
  );
  const pngFile = files.find(
    (file) => file.path === "diagram/architecture.png",
  );
  const preview = useQuery({
    enabled: svgFile?.previewAvailable === true,
    queryKey:
      svgFile === undefined
        ? [
            ...cloudMarkupQueryKeys.solutionExportArtifact(
              context.principal.id,
              context.organizationId,
              projectId,
              artifact.id,
            ),
            "diagram",
            "none",
          ]
        : cloudMarkupQueryKeys.solutionExportArtifactFile(
            context.principal.id,
            context.organizationId,
            projectId,
            artifact.id,
            svgFile.id,
          ),
    queryFn: async () => {
      if (svgFile === undefined) throw new SolutionExportResponseBindingError();
      const response = await context.runtime.client.request(
        "solution-export-artifacts.file-preview",
        {
          path: {
            projectId,
            solutionExportArtifactFileId: svgFile.id,
            solutionExportArtifactId: artifact.id,
          },
        },
      );
      assertPreviewBinding(response.data, artifact, svgFile);
      return response.data;
    },
    retry: retryExportQuery,
  });
  const previewFile = format === "svg" ? svgFile : pngFile;
  return (
    <div className="solution-export__diagram-panel">
      <p>
        This preview is rendered from the same immutable Architecture Document
        and Solution Revision used by generation. Editor selection, panels,
        viewport, zoom, scroll, hover, and minimap state are excluded.
      </p>
      <div
        aria-label="Diagram preview format"
        className="solution-export__diagram-formats"
      >
        <Button
          aria-pressed={format === "svg"}
          onClick={() => {
            setFormat("svg");
          }}
          variant="secondary"
        >
          SVG preview
        </Button>
        <Button
          aria-pressed={format === "png"}
          onClick={() => {
            setFormat("png");
          }}
          variant="secondary"
        >
          PNG preview
        </Button>
      </div>
      {preview.isPending ? (
        <LoadingState live="polite" title="Loading immutable diagram preview" />
      ) : preview.isError ||
        svgFile === undefined ||
        previewFile === undefined ? (
        <StatePanel
          kind="error"
          title="Diagram preview unavailable"
          description="The diagram remains unavailable unless its verified SVG and PNG files are both present."
        />
      ) : (
        <figure
          className="solution-export__diagram-preview"
          data-preview-format={format}
        >
          <img
            alt={`${format.toUpperCase()} architecture diagram for ${job.target.exportName}`}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.data.content)}`}
          />
          <figcaption>
            {format === "svg"
              ? "Canonical scalable-vector preview."
              : `High-resolution PNG framing at ${String(job.target.diagram.scale)}×; the exported PNG bytes remain bound by the checksum below.`}{" "}
            <code>{previewFile.checksum}</code>
          </figcaption>
        </figure>
      )}
      <ArtifactFilePanel
        artifact={artifact}
        context={context}
        emptyMessage="No verified architecture diagram files were published."
        files={files}
        projectId={projectId}
        title="Diagram SVG, PNG, and documentation"
      />
    </div>
  );
}

function ArtifactFilePanel({
  artifact,
  context,
  emptyMessage,
  files,
  projectId,
  title,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly emptyMessage: string;
  readonly files: readonly SolutionExportFile[];
  readonly projectId: string;
  readonly title: string;
}) {
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const selectedFile =
    files.find((file) => file.id === selectedFileId) ?? files[0];
  const preview = useQuery({
    enabled: selectedFile?.previewAvailable === true,
    queryKey:
      selectedFile === undefined
        ? [
            ...cloudMarkupQueryKeys.solutionExportArtifact(
              context.principal.id,
              context.organizationId,
              projectId,
              artifact.id,
            ),
            "file",
            "none",
          ]
        : cloudMarkupQueryKeys.solutionExportArtifactFile(
            context.principal.id,
            context.organizationId,
            projectId,
            artifact.id,
            selectedFile.id,
          ),
    queryFn: async () => {
      if (selectedFile === undefined)
        throw new SolutionExportResponseBindingError();
      const response = await context.runtime.client.request(
        "solution-export-artifacts.file-preview",
        {
          path: {
            projectId,
            solutionExportArtifactFileId: selectedFile.id,
            solutionExportArtifactId: artifact.id,
          },
        },
      );
      assertPreviewBinding(response.data, artifact, selectedFile);
      return response.data;
    },
    retry: retryExportQuery,
  });
  if (selectedFile === undefined)
    return <StatePanel kind="empty" title={title} description={emptyMessage} />;
  return (
    <div className="solution-export__file-review">
      <nav aria-label={`${title} files`} className="solution-export__file-list">
        <h3>{title}</h3>
        <ul>
          {files.map((file) => (
            <li key={file.id}>
              <button
                aria-current={file.id === selectedFile.id ? "true" : undefined}
                onClick={() => {
                  setSelectedFileId(file.id);
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
        className="solution-export__preview"
        aria-label="Selected file preview"
      >
        <h3>{selectedFile.path}</h3>
        <dl className="solution-export__file-metadata">
          <div>
            <dt>Ownership</dt>
            <dd>{words(selectedFile.ownership)}</dd>
          </div>
          <div>
            <dt>Media type</dt>
            <dd>{selectedFile.mediaType}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(selectedFile.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Checksum</dt>
            <dd>
              <code>{selectedFile.checksum}</code>
            </dd>
          </div>
          <div>
            <dt>Semantic checksum</dt>
            <dd>
              <code>{selectedFile.semanticChecksum}</code>
            </dd>
          </div>
        </dl>
        {!selectedFile.previewAvailable ? (
          <StatePanel
            kind="unsupported"
            title="Preview unavailable"
            description="Binary and non-previewable files remain identified by media type, ownership, size, and complete checksums."
          />
        ) : preview.isPending ? (
          <LoadingState live="polite" title="Loading bounded preview" />
        ) : preview.isError ? (
          <StatePanel
            actions={
              <Button onClick={() => void preview.refetch()}>Try again</Button>
            }
            kind="error"
            live="assertive"
            title="File preview unavailable"
            description={exportErrorMessage(
              preview.error,
              "load the bounded file preview",
            )}
          />
        ) : (
          <>
            <CodeBlock
              code={preview.data.content}
              label={`Preview of ${preview.data.path}`}
              language={previewLanguage(
                preview.data.mediaType,
                preview.data.path,
              )}
            />
            {preview.data.truncated ? (
              <p className="solution-export__truncated" role="status">
                Preview truncated at the server-defined safe limit.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function previewLanguage(mediaType: string, path: string): string {
  if (mediaType.includes("json")) return "json";
  if (mediaType.includes("terraform") || path.endsWith(".tf")) return "hcl";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".md")) return "markdown";
  return "text";
}

function TestArtifactPanel({
  artifact,
  context,
  files,
  job,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly files: readonly SolutionExportFile[];
  readonly job: SolutionExportJob;
  readonly projectId: string;
}) {
  const testEvidence = job.evidence.filter(
    (evidence) =>
      evidence.kind === "application-build" ||
      evidence.kind === "application-test",
  );
  return (
    <div className="section-stack">
      <section aria-labelledby="solution-export-test-evidence-title">
        <h3 id="solution-export-test-evidence-title">
          Application build/test Evidence
        </h3>
        {testEvidence.length === 0 ? (
          <p>
            No application build/test Evidence applies to this coverage state.
          </p>
        ) : (
          <ul>
            {testEvidence.map((evidence) => (
              <li key={evidence.evidenceId}>
                <StatusBadge
                  label={evidence.status}
                  tone={
                    evidence.status === "passed"
                      ? "success"
                      : evidence.status === "failed"
                        ? "error"
                        : "incomplete"
                  }
                />{" "}
                <span>{words(evidence.kind)}: </span>
                <code>{evidence.evidenceId}</code>{" "}
                <code>{evidence.digest}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ArtifactFilePanel
        artifact={artifact}
        context={context}
        emptyMessage="No test source files are included in this artifact."
        files={files}
        projectId={projectId}
        title="Application and contract tests"
      />
    </div>
  );
}

function ArtifactDiffPanel({
  artifact,
  context,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly projectId: string;
}) {
  const diff = useQuery({
    queryKey: cloudMarkupQueryKeys.solutionExportArtifactDiff(
      context.principal.id,
      context.organizationId,
      projectId,
      artifact.id,
    ),
    queryFn: async () => {
      const response = await context.runtime.client.request(
        "solution-export-artifacts.diff",
        { path: { projectId, solutionExportArtifactId: artifact.id } },
      );
      assertDiffBinding(response.data, artifact);
      return response.data;
    },
    retry: retryExportQuery,
  });
  if (diff.isPending)
    return <LoadingState live="polite" title="Loading previous-export diff" />;
  if (diff.isError)
    return (
      <StatePanel
        actions={<Button onClick={() => void diff.refetch()}>Try again</Button>}
        kind="error"
        live="assertive"
        title="Previous-export diff unavailable"
        description={exportErrorMessage(
          diff.error,
          "load the previous-export diff",
        )}
      />
    );
  if (diff.data.state === "unavailable")
    return (
      <StatePanel
        kind="empty"
        title="No previous export"
        description="This artifact has no authorized previous-export baseline. No comparison was inferred in the browser."
      />
    );
  return (
    <section aria-labelledby="solution-export-diff-title">
      <h3 id="solution-export-diff-title">Semantic and file changes</h3>
      <p>
        Compared with <code>{diff.data.previousArtifactId}</code>.
      </p>
      <ul className="solution-export__diff">
        {diff.data.files.map((file) => (
          <li key={file.path}>
            <StatusBadge
              label={file.change}
              tone={
                file.change === "removed"
                  ? "warning"
                  : file.change === "unchanged"
                    ? "neutral"
                    : "info"
              }
            />
            <code>{file.path}</code>
            <span>Semantic: {words(file.semanticChange)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ManifestPanel({
  artifact,
  context,
  files,
  job,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly files: readonly SolutionExportFile[];
  readonly job: SolutionExportJob;
  readonly projectId: string;
}) {
  return (
    <div className="section-stack">
      <section aria-labelledby="solution-export-manifest-title">
        <h3 id="solution-export-manifest-title">Package identity</h3>
        <dl className="solution-export__metadata">
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
            <dt>Revision manifest digest</dt>
            <dd>
              <code>{job.solutionRevision.manifestDigest}</code>
            </dd>
          </div>
          <div>
            <dt>Files</dt>
            <dd>{artifact.fileCount}</dd>
          </div>
          <div>
            <dt>Archive size</dt>
            <dd>{formatBytes(artifact.sizeBytes)}</dd>
          </div>
        </dl>
      </section>
      <ArtifactFilePanel
        artifact={artifact}
        context={context}
        emptyMessage="No files are present in the immutable manifest."
        files={files}
        projectId={projectId}
        title="Complete file tree"
      />
    </div>
  );
}

function ArtifactDownload({
  artifact,
  context,
  projectId,
}: {
  readonly artifact: SolutionExportArtifact;
  readonly context: VerifiedExportContext;
  readonly projectId: string;
}) {
  const [grant, setGrant] = useState<SolutionExportDownloadGrant>();
  const idempotencyKey = useRef<string | undefined>(undefined);
  const [downloaded, setDownloaded] = useState(false);
  const grantDownload = useMutation({
    mutationFn: async () => {
      idempotencyKey.current ??= createMutationKey("solution-export-download");
      const response = await context.runtime.client.request(
        "solution-export-download-grants.create",
        {
          body: { contractVersion: 1 },
          headers: { "idempotency-key": idempotencyKey.current },
          path: { projectId, solutionExportArtifactId: artifact.id },
        },
      );
      assertGrantBinding(response.data, artifact);
      return response.data;
    },
    onSuccess: (createdGrant) => {
      idempotencyKey.current = undefined;
      setGrant(createdGrant);
      downloadArtifact.mutate(createdGrant);
    },
  });
  const downloadArtifact = useMutation({
    mutationFn: async (downloadGrant: SolutionExportDownloadGrant) => {
      if (Date.parse(downloadGrant.expiresAt) <= Date.now())
        throw new SolutionExportResponseBindingError();
      const download = await context.runtime.downloadBinary(downloadGrant.url);
      assertDownloadedBinaryBinding(download, artifact, downloadGrant);
      return download;
    },
    onSuccess: (download) => {
      saveAuthenticatedBinary(download);
      setDownloaded(true);
    },
  });
  useEffect(() => {
    if (grant === undefined) return undefined;
    const remaining = Date.parse(grant.expiresAt) - Date.now();
    const timeout = window.setTimeout(
      () => {
        setGrant(undefined);
      },
      Math.max(0, Math.min(remaining + 50, 2_147_000_000)),
    );
    return () => {
      window.clearTimeout(timeout);
    };
  }, [grant]);
  if (artifact.downloadAvailability.state === "expired") {
    return (
      <StatePanel
        kind="stale"
        title="Artifact download expired"
        description={
          <>
            Review metadata remains visible. The artifact expired{" "}
            <time dateTime={artifact.downloadAvailability.expiredAt}>
              {formatTimestamp(artifact.downloadAvailability.expiredAt)}
            </time>
            ; no download grant can be minted.
          </>
        }
      />
    );
  }
  if (
    requiresStreamingDownload(grantDownload.error) ||
    requiresStreamingDownload(downloadArtifact.error)
  ) {
    return (
      <StatePanel
        kind="read-only"
        live="polite"
        title="Archive requires streaming"
        description="This archive exceeds the current download limit and needs streaming, which is not available yet. File previews and metadata remain available. Retrying or creating a new link will not resolve this limit."
      />
    );
  }
  return (
    <section
      className="solution-export__download"
      aria-labelledby="solution-export-download-title"
    >
      <div>
        <h3 id="solution-export-download-title">Verified ZIP</h3>
        <p>
          <code>{artifact.archiveFileName}</code> ·{" "}
          {formatBytes(artifact.sizeBytes)} · available until{" "}
          <time dateTime={artifact.downloadAvailability.expiresAt}>
            {formatTimestamp(artifact.downloadAvailability.expiresAt)}
          </time>
        </p>
      </div>
      {grantDownload.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Download authorization failed"
          description={exportErrorMessage(
            grantDownload.error,
            "authorize the download",
          )}
        />
      ) : null}
      {downloadArtifact.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Verified download failed"
          description={exportErrorMessage(
            downloadArtifact.error,
            "download the verified artifact",
          )}
        />
      ) : null}
      <Button
        loading={grantDownload.isPending || downloadArtifact.isPending}
        loadingLabel="Downloading and verifying ZIP"
        onClick={() => {
          if (grant === undefined) grantDownload.mutate();
          else downloadArtifact.mutate(grant);
        }}
        variant="primary"
      >
        Download ZIP
      </Button>
      {downloaded ? <p role="status">Verified ZIP download started.</p> : null}
    </section>
  );
}
