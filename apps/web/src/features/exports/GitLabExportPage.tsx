import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  solutionExportArtifactV1Schema,
  gitlabConnectionListResponseV1Schema,
  gitlabProjectDiscoveryResponseV1Schema,
  gitlabProjectSelectionListResponseV1Schema,
  gitlabExportPreviewV1Schema,
  gitlabExportV1Schema,
  gitlabExportReviewIdV1Schema,
  type CurrentPrincipalV1,
  type GitlabExportPreviewV1,
  type GitlabExportV1,
} from "@cloudmarkup/api-contract";
import { Button, LoadingState, StatePanel } from "@cloudmarkup/ui";
import {
  cloudMarkupQueryKeys,
  mapApiError,
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import "./gitlab-export.css";

interface Props {
  readonly artifactId: string;
  readonly projectId: string;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
}
interface Context {
  readonly artifactId: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly runtime: CloudMarkupQueryRuntime;
}
class ExportBindingError extends Error {}
function message(error: unknown): string {
  if (mapApiError(error).code === "service_unavailable")
    return "GitLab export is unavailable or could not finish this step. Check its current status before continuing.";
  if (
    ["access_denied", "authentication_required"].includes(
      mapApiError(error).code,
    )
  )
    return "Check your sign-in, workspace permissions and plan before continuing.";
  return "This step could not be confirmed. Reload the export status before continuing; an uncertain write will not be repeated.";
}
function bind(context: Context, value: GitlabExportV1): GitlabExportV1 {
  const record = gitlabExportV1Schema.parse(value);
  if (
    record.principalId !== context.principalId ||
    record.organizationId !== context.organizationId ||
    record.projectId !== context.projectId ||
    record.artifactId !== context.artifactId
  )
    throw new ExportBindingError();
  return record;
}
function artifactRoute(context: Context): string {
  return `/organizations/${encodeRouteSelector(context.organizationId)}/projects/${encodeRouteSelector(context.projectId)}/artifacts/${encodeRouteSelector(context.artifactId)}`;
}
function initialReview(): string | undefined {
  const values = new URLSearchParams(window.location.search).getAll("review");
  if (values.length === 0) return undefined;
  if (
    values.length !== 1 ||
    !gitlabExportReviewIdV1Schema.safeParse(values[0]).success
  )
    return "invalid";
  return values[0];
}
export function GitLabExportPage(props: Props) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const organization = props.principal?.organizationContexts.find(
    (value) => value.organizationId === props.organizationId,
  );
  const allowed =
    organization?.capabilities.includes("exports.run") &&
    organization.capabilities.includes("integrations.read");
  return (
    <RoutePage
      title="GitLab export"
      eyebrow="Reviewed repository export"
      description="Send this generated package to a new branch and draft merge request."
      routeKey={`gitlab-export-${props.projectId}-${props.artifactId}`}
    >
      {runtime === null ||
      props.principal === undefined ||
      props.organizationId === undefined ||
      !allowed ? (
        <StatePanel
          kind="read-only"
          title="GitLab export unavailable"
          description="Sign in to an authorized workspace with repository export access."
        />
      ) : (
        <GitLabExportWorkspace
          key={JSON.stringify([
            props.principal.id,
            props.organizationId,
            props.projectId,
            props.artifactId,
          ])}
          context={{
            runtime,
            principalId: props.principal.id,
            organizationId: props.organizationId,
            projectId: props.projectId,
            artifactId: props.artifactId,
          }}
        />
      )}
    </RoutePage>
  );
}
function GitLabExportWorkspace({ context }: { readonly context: Context }) {
  const [reviewId, setReviewId] = useState<string | undefined>(initialReview);
  const artifact = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.organization(
        context.principalId,
        context.organizationId,
      ),
      "gitlab-export-artifact",
      context.projectId,
      context.artifactId,
    ],
    retry: false,
    queryFn: async () => {
      const value = solutionExportArtifactV1Schema.parse(
        (
          await context.runtime.client.request(
            "solution-export-artifacts.get",
            {
              path: {
                projectId: context.projectId,
                solutionExportArtifactId: context.artifactId,
              },
            },
          )
        ).data,
      );
      if (
        value.projectId !== context.projectId ||
        value.id !== context.artifactId
      )
        throw new ExportBindingError();
      return value;
    },
  });
  const [preview, setPreview] = useState<GitlabExportPreviewV1>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function remember(id?: string) {
    if (!mounted.current) return;
    if (
      window.location.pathname ===
      artifactRoute(context) + "/export/gitlab"
    ) {
      const url = new URL(window.location.href);
      if (id === undefined) url.searchParams.delete("review");
      else url.searchParams.set("review", id);
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    setReviewId(id);
  }
  return (
    <div className="gitlab-export">
      <nav
        aria-label="GitLab export resources"
        className="gitlab-export__actions"
      >
        {artifact.data ? (
          <AppLink
            to={
              "/organizations/" +
              encodeRouteSelector(context.organizationId) +
              "/projects/" +
              encodeRouteSelector(context.projectId) +
              "/exports/" +
              encodeRouteSelector(artifact.data.jobId)
            }
          >
            Review package
          </AppLink>
        ) : null}
        <AppLink
          to={`/organizations/${encodeRouteSelector(context.organizationId)}/settings/integrations`}
        >
          Manage GitLab connections
        </AppLink>
      </nav>
      <p>
        The package keeps its generated Terraform or CloudFormation format. To
        change the format, create a new export from the revision.
      </p>
      {reviewId === "invalid" ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Invalid export link"
          description="Open the package and create a new GitLab review."
        />
      ) : reviewId !== undefined ? (
        <GitLabExportProgress
          key={reviewId}
          context={context}
          reviewId={reviewId}
          preview={preview}
          onStartAgain={() => {
            setPreview(undefined);
            remember();
          }}
        />
      ) : artifact.isPending ? (
        <LoadingState title="Loading the approved package" />
      ) : artifact.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Package unavailable"
          description="Return to revision history and open a completed export."
        />
      ) : (
        <GitLabDestination
          context={context}
          onPreview={(value) => {
            if (!mounted.current) return;
            if (
              value.export.artifactZipDigest !== artifact.data.digest ||
              value.export.artifactManifestDigest !==
                artifact.data.manifestDigest
            )
              throw new ExportBindingError();
            setPreview(value);
            remember(value.export.reviewId);
          }}
        />
      )}
    </div>
  );
}
function GitLabDestination({
  context,
  onPreview,
}: {
  readonly context: Context;
  readonly onPreview: (value: GitlabExportPreviewV1) => void;
}) {
  const [connectionId, setConnectionId] = useState("");
  const key = [
    ...cloudMarkupQueryKeys.organization(
      context.principalId,
      context.organizationId,
    ),
    "gitlab-export-connections",
  ];
  const connections = useInfiniteQuery({
    queryKey: key,
    retry: false,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const value = gitlabConnectionListResponseV1Schema.parse(
        await context.runtime.client.request("gitlab-connections.list", {
          path: { organizationId: context.organizationId },
          query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        }),
      );
      if (
        value.data.some(
          (item) =>
            item.organizationId !== context.organizationId ||
            item.principalId !== context.principalId,
        ) ||
        (value.page.hasMore &&
          (!value.page.nextCursor || value.page.nextCursor === pageParam))
      )
        throw new ExportBindingError();
      return value;
    },
    getNextPageParam: (page) => page.page.nextCursor,
  });
  const accounts =
    connections.data?.pages
      .flatMap((page) => page.data)
      .filter((value) => value.status === "active") ?? [];
  return (
    <section
      className="feature-card gitlab-export__form"
      aria-labelledby="gitlab-destination-title"
    >
      <h2 id="gitlab-destination-title">Choose a destination</h2>
      {connections.isPending ? (
        <LoadingState title="Loading GitLab connections" />
      ) : null}
      {connections.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Connections unavailable"
          description={message(connections.error)}
        />
      ) : null}
      {!connections.isPending &&
      !connections.isError &&
      accounts.length === 0 ? (
        <p>
          Connect GitLab and select a project in your account integration
          settings.
        </p>
      ) : null}
      <label>
        GitLab account
        <select
          value={connectionId}
          onChange={(event) => {
            setConnectionId(event.target.value);
          }}
          disabled={connections.isError || accounts.length === 0}
        >
          <option value="">Choose a connected account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.providerUsername}
            </option>
          ))}
        </select>
      </label>
      {connections.hasNextPage ? (
        <Button
          disabled={connections.isFetchingNextPage}
          onClick={() => {
            void connections.fetchNextPage();
          }}
        >
          Load more accounts
        </Button>
      ) : null}
      {accounts.some((value) => value.id === connectionId) &&
      !connections.isError ? (
        <GitLabProjectDestination
          key={connectionId}
          context={context}
          connectionId={connectionId}
          onPreview={onPreview}
        />
      ) : null}
    </section>
  );
}
function GitLabProjectDestination({
  context,
  connectionId,
  onPreview,
}: {
  readonly context: Context;
  readonly connectionId: string;
  readonly onPreview: (value: GitlabExportPreviewV1) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [folder, setFolder] = useState("cloudmarkup/export");
  const key = [
    ...cloudMarkupQueryKeys.organization(
      context.principalId,
      context.organizationId,
    ),
    "gitlab-export-projects",
    connectionId,
  ];
  const path = { organizationId: context.organizationId, connectionId };
  function owner(value: {
    organizationId: string;
    principalId: string;
    connectionId: string;
  }) {
    if (
      value.organizationId !== context.organizationId ||
      value.principalId !== context.principalId ||
      value.connectionId !== connectionId
    )
      throw new ExportBindingError();
  }
  const selections = useInfiniteQuery({
    queryKey: [...key, "selected"],
    retry: false,
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const value = gitlabProjectSelectionListResponseV1Schema.parse(
        await context.runtime.client.request("gitlab-project-selections.list", {
          path,
          query: { limit: 100, ...(pageParam ? { cursor: pageParam } : {}) },
        }),
      );
      value.data.forEach(owner);
      if (
        value.data.some(
          (item, index) =>
            item.projectId <=
            (value.data[index - 1]?.projectId ?? Number(pageParam || 0)),
        ) ||
        (value.page.hasMore &&
          (!value.page.nextCursor ||
            value.page.nextCursor !== String(value.data.at(-1)?.projectId)))
      )
        throw new ExportBindingError();
      return value;
    },
    getNextPageParam: (page) => page.page.nextCursor,
  });
  const projects = useInfiniteQuery({
    queryKey: [...key, "available"],
    retry: false,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const value = gitlabProjectDiscoveryResponseV1Schema.parse(
        await context.runtime.client.request("gitlab-projects.discover", {
          path,
          query: { page: pageParam },
        }),
      );
      owner(value.data);
      if (value.data.nextPage !== null && value.data.nextPage !== pageParam + 1)
        throw new ExportBindingError();
      return value.data;
    },
    getNextPageParam: (page) => page.nextPage ?? undefined,
  });
  const selected =
    selections.data?.pages
      .flatMap((page) => page.data)
      .filter((item) => item.enabled) ?? [];
  const choices =
    projects.data?.pages
      .flatMap((page) => page.projects)
      .filter(
        (item) =>
          item.eligibility === "eligible" &&
          selected.some((value) => value.projectId === item.projectId),
      ) ?? [];
  const selection = selected.find(
    (item) => String(item.projectId) === projectId,
  );
  const failed = selections.isError || projects.isError;
  const review = useMutation({
    retry: false,
    mutationFn: async () => {
      if (
        !selection ||
        failed ||
        !choices.some((item) => item.projectId === selection.projectId)
      )
        throw new ExportBindingError();
      const result = gitlabExportPreviewV1Schema.parse(
        (
          await context.runtime.client.request("gitlab-export-reviews.create", {
            path: { projectId: context.projectId },
            body: {
              contractVersion: 1,
              connectionId,
              providerProjectId: selection.projectId,
              selectionVersion: selection.version,
              artifactId: context.artifactId,
              destinationFolder: folder,
            },
          })
        ).data,
      );
      const value = bind(context, result.export);
      if (
        value.connectionId !== connectionId ||
        value.providerProjectId !== selection.projectId ||
        value.selectionVersion !== selection.version ||
        value.destinationFolder !== folder
      )
        throw new ExportBindingError();
      return result;
    },
    onSuccess: onPreview,
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review.isPending) review.mutate();
  }
  return (
    <form className="gitlab-export__form" onSubmit={submit}>
      {selections.isPending || projects.isPending ? (
        <LoadingState title="Loading selected GitLab projects" />
      ) : null}
      {failed ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Projects unavailable"
          description="Reload your connection and project selections before creating an export."
        />
      ) : null}
      <label>
        GitLab project
        <select
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
          }}
          disabled={failed || review.isPending}
        >
          <option value="">Choose a selected project</option>
          {choices.map((item) => (
            <option key={item.projectId} value={String(item.projectId)}>
              {item.pathWithNamespace}
            </option>
          ))}
        </select>
      </label>
      {selections.hasNextPage ? (
        <Button
          disabled={selections.isFetchingNextPage}
          onClick={() => {
            void selections.fetchNextPage();
          }}
        >
          Load more selections
        </Button>
      ) : null}
      {projects.hasNextPage ? (
        <Button
          disabled={projects.isFetchingNextPage}
          onClick={() => {
            void projects.fetchNextPage();
          }}
        >
          Load more projects
        </Button>
      ) : null}
      {!failed &&
      !projects.isPending &&
      !selections.isPending &&
      choices.length === 0 ? (
        <p>
          Select a project in integration settings, or load more projects and
          selections.
        </p>
      ) : null}
      <label>
        New folder in the repository
        <input
          value={folder}
          onChange={(event) => {
            setFolder(event.target.value);
          }}
          required
          maxLength={512}
          disabled={review.isPending}
          aria-describedby="gitlab-folder-help"
        />
      </label>
      <p id="gitlab-folder-help">
        Choose a new folder. Existing repository files are preserved.
      </p>
      {review.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Review unavailable"
          description={message(review.error)}
        />
      ) : null}
      <Button
        type="submit"
        variant="primary"
        disabled={!selection || failed || !folder || review.isPending}
        loading={review.isPending}
        loadingLabel="Preparing review"
      >
        Review export
      </Button>
    </form>
  );
}
const progressLabels: Record<GitlabExportV1["state"], string> = {
  prepared: "Ready for your approval",
  "commit-dispatched": "Checking the export branch",
  verifying: "Verifying exported files",
  verified: "Files verified",
  "merge-request-dispatched": "Checking the draft merge request",
  succeeded: "Export confirmed",
};
function GitLabExportProgress({
  context,
  reviewId,
  preview,
  onStartAgain,
}: {
  readonly context: Context;
  readonly reviewId: string;
  readonly preview: GitlabExportPreviewV1 | undefined;
  readonly onStartAgain: () => void;
}) {
  const [record, setRecord] = useState<GitlabExportV1 | undefined>(
    preview?.export,
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState(false);
  const [paused, setPaused] = useState(false);
  const mounted = useRef(true),
    continuing = useRef(false);
  const isMounted = () => mounted.current;
  const shouldContinue = () => continuing.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      continuing.current = false;
    };
  }, []);
  const status = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.organization(
        context.principalId,
        context.organizationId,
      ),
      "gitlab-export",
      context.projectId,
      reviewId,
    ],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const value = bind(
        context,
        (
          await context.runtime.client.request("gitlab-exports.get", {
            path: { projectId: context.projectId, reviewId },
          })
        ).data,
      );
      if (
        value.reviewId !== reviewId ||
        (preview && value.approvalDigest !== preview.export.approvalDigest)
      )
        throw new ExportBindingError();
      return value;
    },
  });
  const current =
    status.data &&
    (!record || status.data.recordVersion >= record.recordVersion)
      ? status.data
      : record;
  const advance = useMutation({
    retry: false,
    mutationFn: async (initial: GitlabExportV1) => {
      let value = initial;
      continuing.current = true;
      setPaused(false);
      setPendingReceipt(false);
      for (
        let step = 0;
        step < 40 &&
        isMounted() &&
        shouldContinue() &&
        value.state !== "succeeded";
        step++
      ) {
        const next = bind(
          context,
          (
            await context.runtime.client.request("gitlab-exports.advance", {
              path: { projectId: context.projectId, reviewId },
              body: {
                contractVersion: 1,
                expectedVersion: value.recordVersion,
                approvalDigest: value.approvalDigest,
                ...(value.state === "prepared"
                  ? { acknowledgedAutomation: acknowledged }
                  : {}),
              },
            })
          ).data,
        );
        if (
          next.reviewId !== reviewId ||
          next.approvalDigest !== value.approvalDigest ||
          next.recordVersion < value.recordVersion ||
          next.recordVersion > value.recordVersion + 1
        )
          throw new ExportBindingError();
        if (!isMounted()) return;
        setRecord(next);
        if (next.recordVersion === value.recordVersion) {
          setPendingReceipt(true);
          return;
        }
        value = next;
      }
    },
    onError: () => {
      continuing.current = false;
      if (mounted.current) void status.refetch();
    },
  });
  return (
    <section
      className="feature-card gitlab-export__review"
      aria-labelledby="gitlab-review-title"
    >
      <h2 id="gitlab-review-title">
        {current ? progressLabels[current.state] : "Loading export status"}
      </h2>
      {status.isPending && !current ? (
        <LoadingState title="Loading export status" />
      ) : null}
      {status.isError ? (
        <StatePanel
          kind="error"
          live="assertive"
          title="Status unavailable"
          description={message(status.error)}
        />
      ) : null}
      {current ? (
        <>
          <dl className="gitlab-export__metadata">
            <div>
              <dt>Repository project</dt>
              <dd>GitLab #{current.providerProjectId}</dd>
            </div>
            <div>
              <dt>Folder</dt>
              <dd>
                <code>{current.destinationFolder}</code>
              </dd>
            </div>
            <div>
              <dt>Base branch</dt>
              <dd>
                <code>{current.baseBranch}</code> at{" "}
                <code>{current.baseCommitSha.slice(0, 12)}</code>
              </dd>
            </div>
            <div>
              <dt>New branch</dt>
              <dd>
                <code>{current.branch}</code>
              </dd>
            </div>
          </dl>
          {preview && current.state === "prepared" ? (
            <details open>
              <summary>Files to add ({preview.files.length})</summary>
              <ul className="gitlab-export__files">
                {preview.files.map((file) => (
                  <li key={file.path}>
                    <code>{file.path}</code>
                    <span>{file.sizeBytes.toLocaleString()} bytes</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {current.state === "verifying" || current.state === "verified" ? (
            <p role="status">
              Verified {current.verifiedFiles} of {current.fileCount} files.
            </p>
          ) : null}
          {current.expired && current.state !== "succeeded" ? (
            <p role="status">
              This approval expired. Existing writes can still be checked, but a
              new merge request requires a new review.
            </p>
          ) : null}
          {current.state === "prepared" && preview ? (
            <>
              <p>
                A new branch and draft merge request will be created. Repository
                hooks or automation may run when files are added.
              </p>
              <label className="gitlab-export__acknowledgement">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                  }}
                  disabled={advance.isPending}
                />
                I approve these files and understand that repository automation
                may run.
              </label>
            </>
          ) : null}
          {current.state === "prepared" && !preview ? (
            <p>
              This review has not been approved. Start a new review to inspect
              its files before approving.
            </p>
          ) : null}
          {current.state === "succeeded" && current.mergeRequest ? (
            <p role="status">
              Export confirmed.{" "}
              <a
                href={current.mergeRequest.url}
                target="_blank"
                rel="noreferrer"
              >
                Open{" "}
                {current.mergeRequest.state === "opened" &&
                current.mergeRequest.draft
                  ? "draft merge request"
                  : "merge request"}{" "}
                #{current.mergeRequest.number}
              </a>{" "}
              ({current.mergeRequest.state}).
            </p>
          ) : null}
          {pendingReceipt ? (
            <p role="status">
              The provider has not confirmed the earlier write. Reload status or
              resume the check later; this export will not repeat that write.
            </p>
          ) : null}
          {paused ? (
            <p role="status">Paused. You can resume from this saved link.</p>
          ) : null}
          {advance.isError ? (
            <StatePanel
              kind="error"
              live="assertive"
              title="Export needs attention"
              description={message(advance.error)}
            />
          ) : null}
          <div className="gitlab-export__actions">
            {current.state !== "succeeded" ? (
              <Button
                variant="primary"
                disabled={
                  status.isError ||
                  status.isPending ||
                  advance.isPending ||
                  ((current.state === "prepared" ||
                    current.state === "verified") &&
                    current.expired) ||
                  (current.state === "prepared" && (!preview || !acknowledged))
                }
                loading={advance.isPending}
                loadingLabel="Continuing export"
                onClick={() => {
                  advance.mutate(current);
                }}
              >
                {current.state === "prepared"
                  ? "Approve and export"
                  : "Resume export"}
              </Button>
            ) : null}
            {advance.isPending ? (
              <Button
                onClick={() => {
                  continuing.current = false;
                  setPaused(true);
                }}
              >
                Pause after this step
              </Button>
            ) : (
              <Button
                disabled={status.isFetching}
                onClick={() => {
                  void status.refetch();
                }}
              >
                Reload status
              </Button>
            )}
            {!advance.isPending ? (
              <Button onClick={onStartAgain}>Start a new review</Button>
            ) : null}
          </div>
        </>
      ) : (
        <Button
          disabled={status.isFetching}
          onClick={() => {
            void status.refetch();
          }}
        >
          Reload status
        </Button>
      )}
    </section>
  );
}
