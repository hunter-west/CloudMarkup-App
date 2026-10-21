import type {
  ApiResponseV1,
  ContinuousConformanceResponseV1,
  CurrentPrincipalV1,
  ProjectV1,
  SolutionRevisionSummaryV1,
} from "@cloudmarkup/api-contract";
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import {
  mapApiError,
  useOptionalCloudMarkupQueryRuntime,
} from "../../../api/index.js";
import { ContinuousConformanceWorkspace } from "./ContinuousConformanceWorkspace.js";
import {
  projectConformanceReportV1,
  type ApprovedConformanceTopologyV1,
} from "./adapter.js";
import type {
  ContinuousConformanceDiagramExportIntent,
  ContinuousConformanceReadModel,
  ContinuousConformanceReviewAction,
} from "./model.js";

const unavailableConformanceQueryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { retry: false },
  },
});

type DiagramResult =
  ApiResponseV1<"continuous-conformance.export-diagram">["data"];
type ReviewResult =
  ApiResponseV1<"continuous-conformance.review-action">["data"];

class ContinuousConformanceOperationBindingError extends Error {
  public constructor() {
    super("Continuous conformance operation binding failed.");
    this.name = "ContinuousConformanceOperationBindingError";
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function reviewIdempotencyKey(
  action: ContinuousConformanceReviewAction,
  report: ContinuousConformanceReadModel,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      actionKey: action.actionKey,
      contractVersion: 1,
      differenceId: action.differenceId,
      kind: action.kind,
      reportDigest: report.reportDigest,
      reportId: report.reportId,
    }),
  );
  return `conformance-review:${(await sha256Bytes(bytes)).slice(7)}`;
}

function actionIsAvailable(
  report: ContinuousConformanceReadModel,
  action: ContinuousConformanceReviewAction,
): boolean {
  return report.differences.some(
    (difference) =>
      difference.differenceId === action.differenceId &&
      difference.reviewActions.some(
        (available) =>
          available.actionKey === action.actionKey &&
          available.differenceId === action.differenceId &&
          available.kind === action.kind,
      ),
  );
}

async function assertDiagramResultBinding(
  result: DiagramResult,
  intent: ContinuousConformanceDiagramExportIntent,
): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(result.svg);
  if (
    !Object.is(result.contractVersion, intent.contractVersion) ||
    result.reportDigest !== intent.reportDigest ||
    result.reportId !== intent.reportId ||
    result.showDifferences !== intent.showDifferences ||
    result.state !== intent.state ||
    !Object.is(result.artifact.mediaType, "image/svg+xml") ||
    result.artifact.sizeBytes !== bytes.byteLength ||
    result.artifact.checksum !== (await sha256Bytes(bytes))
  ) {
    throw new ContinuousConformanceOperationBindingError();
  }
  return bytes;
}

function assertReviewResultBinding(
  result: ReviewResult,
  action: ContinuousConformanceReviewAction,
  report: ContinuousConformanceReadModel,
): void {
  if (
    !Object.is(result.contractVersion, 1) ||
    result.actionKey !== action.actionKey ||
    result.differenceId !== action.differenceId ||
    result.kind !== action.kind ||
    result.reportDigest !== report.reportDigest ||
    result.reportId !== report.reportId ||
    !Object.is(result.receipt.mergeAuthority, "none") ||
    !Object.is(result.receipt.remediation, "none")
  ) {
    throw new ContinuousConformanceOperationBindingError();
  }
}

function saveSvgDiagram(
  bytes: Uint8Array,
  artifactId: string,
  state: ContinuousConformanceDiagramExportIntent["state"],
): void {
  const safeArtifactId = artifactId
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .slice(0, 64);
  const objectUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes).buffer], { type: "image/svg+xml" }),
  );
  const anchor = document.createElement("a");
  anchor.download = `cloudmarkup-conformance-${state}-${safeArtifactId}.svg`;
  anchor.href = objectUrl;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export interface ContinuousConformanceQueryBinding {
  readonly approvedTopology: ApprovedConformanceTopologyV1;
  readonly organizationId: string;
  readonly principalId: CurrentPrincipalV1["id"];
  readonly projectId: ProjectV1["id"];
  readonly solutionRevisionId: SolutionRevisionSummaryV1["solutionRevisionId"];
}

interface ContinuousConformanceOperationFeedback {
  readonly message: string;
  readonly tone: "error" | "status";
}

interface ContinuousConformanceWorkspaceState {
  readonly environmentId: string;
  readonly operationFeedback:
    ContinuousConformanceOperationFeedback | undefined;
  readonly solutionRevisionId: string | undefined;
}

export function useContinuousConformanceQueryWorkspace({
  binding,
  mode,
}: {
  readonly binding?: ContinuousConformanceQueryBinding;
  readonly mode: "guided" | "professional";
}): {
  readonly content?: ReactNode;
  readonly report?: ContinuousConformanceReadModel;
} {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const solutionRevisionId = binding?.solutionRevisionId;
  const [workspaceState, setWorkspaceState] =
    useState<ContinuousConformanceWorkspaceState>({
      environmentId: "",
      operationFeedback: undefined,
      solutionRevisionId,
    });
  if (workspaceState.solutionRevisionId !== solutionRevisionId) {
    setWorkspaceState({
      environmentId: "",
      operationFeedback: undefined,
      solutionRevisionId,
    });
  }
  const environmentId = workspaceState.environmentId;
  const setOperationFeedback = (
    operationFeedback: ContinuousConformanceOperationFeedback | undefined,
  ): void => {
    setWorkspaceState((current) => ({
      environmentId:
        current.solutionRevisionId === solutionRevisionId
          ? current.environmentId
          : "",
      operationFeedback,
      solutionRevisionId,
    }));
  };
  const environments = useQuery(
    {
      enabled: runtime !== null && binding !== undefined,
      queryKey: [
        "cloudmarkup",
        "api",
        "v1",
        "principal",
        binding?.principalId,
        "organization",
        binding?.organizationId,
        "project",
        binding?.projectId,
        "conformance-environments",
      ],
      queryFn: async () => {
        if (runtime === null || binding === undefined) {
          throw new TypeError(
            "Authorized conformance query context is unavailable.",
          );
        }
        const response = await runtime.client.request("environments.list", {
          path: { projectId: binding.projectId },
          query: { "page[limit]": "100", sort: "name" },
        });
        if (
          response.data.some(({ projectId }) => projectId !== binding.projectId)
        ) {
          throw new TypeError(
            "Environment response project binding is invalid.",
          );
        }
        return response.data.filter(
          ({ lifecycleStatus }) => lifecycleStatus !== "deleted",
        );
      },
    },
    runtime?.queryClient ?? unavailableConformanceQueryClient,
  );
  const selectedEnvironment = environments.data?.find(
    ({ id }) => id === environmentId,
  );
  const conformanceQueryKey = [
    "cloudmarkup",
    "api",
    "v1",
    "principal",
    binding?.principalId,
    "organization",
    binding?.organizationId,
    "project",
    binding?.projectId,
    "revision",
    binding?.solutionRevisionId,
    "environment",
    selectedEnvironment?.id,
    "continuous-conformance",
  ] as const;
  const conformance = useQuery(
    {
      enabled:
        runtime !== null &&
        binding !== undefined &&
        selectedEnvironment !== undefined,
      queryKey: conformanceQueryKey,
      queryFn: async () => {
        if (
          runtime === null ||
          binding === undefined ||
          selectedEnvironment === undefined
        ) {
          throw new TypeError(
            "Exact conformance query binding is unavailable.",
          );
        }
        const response: ContinuousConformanceResponseV1 =
          await runtime.client.request("continuous-conformance.get", {
            path: {
              environmentId: selectedEnvironment.id,
              projectId: binding.projectId,
              solutionRevisionId: binding.solutionRevisionId,
            },
          });
        return projectConformanceReportV1(
          response.data.report,
          {
            approvedTopology: binding.approvedTopology,
            environmentId: selectedEnvironment.id,
            projectId: binding.projectId,
            solutionRevisionId: binding.solutionRevisionId,
          },
          response.data.availableReviewActions,
        );
      },
    },
    runtime?.queryClient ?? unavailableConformanceQueryClient,
  );

  const exportDiagram = useMutation(
    {
      mutationFn: async (intent: ContinuousConformanceDiagramExportIntent) => {
        const report = conformance.data;
        if (
          runtime === null ||
          binding === undefined ||
          selectedEnvironment === undefined ||
          report === undefined ||
          intent.environmentId !== selectedEnvironment.id ||
          intent.solutionRevisionId !== binding.solutionRevisionId ||
          intent.reportDigest !== report.reportDigest ||
          intent.reportId !== report.reportId
        ) {
          throw new ContinuousConformanceOperationBindingError();
        }
        const response = await runtime.client.request(
          "continuous-conformance.export-diagram",
          {
            body: {
              contractVersion: intent.contractVersion,
              reportDigest: intent.reportDigest,
              reportId: intent.reportId,
              showDifferences: intent.showDifferences,
              state: intent.state,
            },
            path: {
              environmentId: selectedEnvironment.id,
              projectId: binding.projectId,
              solutionRevisionId: binding.solutionRevisionId,
            },
          },
        );
        const bytes = await assertDiagramResultBinding(response.data, intent);
        saveSvgDiagram(bytes, response.data.artifact.artifactId, intent.state);
        return response.data;
      },
      onError: (error) => {
        const mapped = mapApiError(error);
        if (mapped.sessionExpired) runtime?.expireSession();
        setOperationFeedback({
          message:
            error instanceof ContinuousConformanceOperationBindingError
              ? "Evidence diagram export failed exact report or artifact integrity validation."
              : mapped.message,
          tone: "error",
        });
      },
      onMutate: () => {
        setOperationFeedback(undefined);
      },
      onSuccess: () => {
        setOperationFeedback({
          message:
            "The server-reconstructed evidence diagram was verified and downloaded.",
          tone: "status",
        });
      },
    },
    runtime?.queryClient ?? unavailableConformanceQueryClient,
  );
  const reviewAction = useMutation(
    {
      mutationFn: async (action: ContinuousConformanceReviewAction) => {
        const report = conformance.data;
        if (
          runtime === null ||
          binding === undefined ||
          selectedEnvironment === undefined ||
          report === undefined ||
          !actionIsAvailable(report, action)
        ) {
          throw new ContinuousConformanceOperationBindingError();
        }
        const body = {
          actionKey: action.actionKey,
          contractVersion: 1 as const,
          differenceId: action.differenceId,
          kind: action.kind,
          reportDigest: report.reportDigest,
          reportId: report.reportId,
        };
        const response = await runtime.client.request(
          "continuous-conformance.review-action",
          {
            body,
            headers: {
              "idempotency-key": await reviewIdempotencyKey(action, report),
            },
            path: {
              environmentId: selectedEnvironment.id,
              projectId: binding.projectId,
              solutionRevisionId: binding.solutionRevisionId,
            },
          },
        );
        assertReviewResultBinding(response.data, action, report);
        await runtime.queryClient.invalidateQueries({
          exact: true,
          queryKey: conformanceQueryKey,
        });
        return response.data;
      },
      onError: (error) => {
        const mapped = mapApiError(error);
        if (mapped.sessionExpired) runtime?.expireSession();
        setOperationFeedback({
          message:
            error instanceof ContinuousConformanceOperationBindingError
              ? "The reviewed action failed exact report, difference, or action binding validation."
              : mapped.message,
          tone: "error",
        });
      },
      onMutate: () => {
        setOperationFeedback(undefined);
      },
      onSuccess: (result) => {
        setOperationFeedback({
          message:
            result.kind === "github-issue"
              ? "The server-known GitHub issue action was recorded for review."
              : "The server-known reconciliation PR request was recorded for review; it was not merged or applied.",
          tone: "status",
        });
      },
    },
    runtime?.queryClient ?? unavailableConformanceQueryClient,
  );

  if (binding === undefined) return {};
  const selector = (
    <section
      className="continuous-conformance__query"
      aria-label="Conformance evidence selection"
    >
      <p className="status-label">Exact evidence binding</p>
      <p>
        Solution Revision <code>{binding.solutionRevisionId}</code>. Choose an
        environment explicitly; CloudMarkup does not guess or preselect one.
      </p>
      <label>
        <span>Project environment</span>
        <select
          aria-label="Project environment"
          disabled={
            runtime === null ||
            environments.isPending ||
            environments.isError ||
            exportDiagram.isPending ||
            reviewAction.isPending
          }
          onChange={(event) => {
            setWorkspaceState({
              environmentId: event.currentTarget.value,
              operationFeedback: undefined,
              solutionRevisionId,
            });
          }}
          value={environmentId}
        >
          <option value="">Choose an environment</option>
          {(environments.data ?? []).map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name} · {environment.environmentType}
            </option>
          ))}
        </select>
      </label>
      {runtime === null ? (
        <p role="alert">
          Authorized conformance evidence and operations are unavailable because
          the API runtime is not configured.
        </p>
      ) : null}
      {runtime !== null && environments.isPending ? (
        <p role="status">Loading authorized environments…</p>
      ) : null}
      {environments.isError ? (
        <p role="alert">Authorized environments are unavailable.</p>
      ) : null}
      {environmentId === "" && environments.isSuccess && runtime !== null ? (
        <p role="status">
          Select one environment to request revision-bound evidence.
        </p>
      ) : null}
      {conformance.isPending && environmentId !== "" ? (
        <p role="status">Loading continuous conformance evidence…</p>
      ) : null}
      {conformance.isError ? (
        <p role="alert">
          Conformance evidence is unavailable or failed exact binding
          validation.
        </p>
      ) : null}
    </section>
  );
  return {
    content: (
      <>
        {selector}
        {conformance.data === undefined ? null : (
          <ContinuousConformanceWorkspace
            exportPending={exportDiagram.isPending}
            mode={mode}
            onExportDiagram={(intent) => {
              exportDiagram.mutate(intent);
            }}
            onReviewAction={(action) => {
              reviewAction.mutate(action);
            }}
            {...(workspaceState.operationFeedback === undefined
              ? {}
              : { operationFeedback: workspaceState.operationFeedback })}
            {...(reviewAction.variables?.actionKey === undefined ||
            !reviewAction.isPending
              ? {}
              : { pendingReviewActionKey: reviewAction.variables.actionKey })}
            report={conformance.data}
          />
        )}
      </>
    ),
    ...(conformance.data === undefined ? {} : { report: conformance.data }),
  };
}
