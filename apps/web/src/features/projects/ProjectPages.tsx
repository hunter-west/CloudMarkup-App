import { AiWorkflowProgress } from "../generation/AiProposalReview.js";
import { parseArchitectureDocument } from "@cloudmarkup/domain";
import {
  betaInfrastructureProposalSchema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import {
  BetaInfrastructureAccessDeniedError,
  BetaInfrastructureRequestError,
  describeBetaInfrastructureCredits,
  requestBetaInfrastructureProposal,
} from "../generation/beta-infrastructure-client.js";
import { rememberProjectCreationProposal } from "../generation/project-creation-proposal.js";
import { getCognitoAccessToken } from "../auth/cognito-browser-auth.js";
import {
  ApiClientError,
  type BetaInfrastructureJobCreditsV1,
  type CreateProjectV1,
  type CurrentPrincipalV1,
  type ProjectV1,
} from "@cloudmarkup/api-contract";
import { Disclosure } from "@cloudmarkup/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  LayoutTemplate,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
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
  useOptionalCloudMarkupQueryRuntime,
  type CloudMarkupQueryRuntime,
} from "../../api/index.js";
import {
  hasLocalMockCapability,
  localMockIdentity,
  localMockProjects,
  type LocalMockIdentity,
} from "../../mock/local-mock-context.js";
import {
  isProjectStartChoice,
  useExperiencePreference,
  type ProjectStartChoice,
} from "../../preferences/index.js";
import {
  AppLink,
  encodeRouteSelector,
  useAppLocation,
  useNavigate,
} from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { signInPathForReturn } from "../auth/sign-in-return-path.js";
import { FirstUseExperience } from "../onboarding/FirstUseExperience.js";
import type { readReviewedProjectTemplate } from "../templates/reviewed-project-template.js";
import { ProjectIntentWorkspace } from "./ProjectIntentWorkspace.js";
import { ProjectStartLinks } from "./ProjectStartLinks.js";
import { SavedDraftValidationPanel } from "./SavedDraftValidationPanel.js";
import "./projects.css";
import "./project-setup.css";

export type VerifiedPrincipal = CurrentPrincipalV1;
type OrganizationContext = CurrentPrincipalV1["organizationContexts"][number];

export interface PermissionAwareProjectPageProps {
  /** Compatibility-only fixture identity for direct presentation tests. */
  readonly identity?: LocalMockIdentity;
  readonly organizationId?: string;
  readonly principal?: CurrentPrincipalV1;
}

export interface ProjectRoutePageProps extends PermissionAwareProjectPageProps {
  readonly projectId: string;
}

interface VerifiedOrganizationContext {
  readonly organization: OrganizationContext;
  readonly organizationId: string;
  readonly principal: CurrentPrincipalV1;
  readonly runtime: CloudMarkupQueryRuntime;
}

const PROJECT_RESPONSE_BINDING_ERROR =
  "The project response did not match the requested organization and project scope.";

class ProjectResponseBindingError extends Error {
  public constructor() {
    super(PROJECT_RESPONSE_BINDING_ERROR);
    this.name = "ProjectResponseBindingError";
  }
}

function assertProjectResponseBinding(
  project: Pick<ProjectV1, "id" | "organizationId">,
  organizationId: string,
  projectId?: string,
): void {
  if (
    project.organizationId !== organizationId ||
    (projectId !== undefined && project.id !== projectId)
  ) {
    throw new ProjectResponseBindingError();
  }
}

function createMutationKey(prefix: string): string {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function organizationRoot(organizationId: string): string {
  return `/organizations/${encodeRouteSelector(organizationId)}`;
}

function hasCapability(
  organization: OrganizationContext,
  capability: string,
): boolean {
  return organization.capabilities.includes(capability);
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  switch (error.envelope.error.code) {
    case "authentication_required":
      return "Your session has expired. Sign in again to continue.";
    case "access_denied":
      return "You do not have permission to perform this action.";
    case "not_found":
      return "The requested project is unavailable.";
    case "precondition_failed":
      return "The project changed on the server. Reload before trying again.";
    case "idempotency_key_reused":
    case "conflict":
      return "The request conflicts with newer server state. Reload before trying again.";
    case "service_unavailable":
      return "The project service is temporarily unavailable.";
    default:
      return fallback;
  }
}

function retryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ProjectResponseBindingError) return false;
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

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatProjectLifecycle(value: ProjectV1["lifecycleStatus"]): string {
  return value
    .split("-")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function BackendUnavailablePage({ title }: { readonly title: string }) {
  return (
    <RoutePage
      title={title}
      eyebrow="Backend unavailable"
      description="Your projects could not be loaded. Sign in again to retry."
      routeKey={`backend-unavailable-${title}`}
    >
      <section className="state-card state-card--error" role="alert">
        <p className="status-label">Service unavailable</p>
        <h2>The authenticated project service is not configured</h2>
        <p>
          Local recovery data is not treated as server project state. Start the
          documented local API and sign in again.
        </p>
      </section>
    </RoutePage>
  );
}

function OrganizationPermissionPage({
  organizationId,
  title,
}: {
  readonly organizationId: string;
  readonly title: string;
}) {
  return (
    <RoutePage
      title="Access unavailable"
      eyebrow="Permission denied"
      description="You do not have access to this organization."
      routeKey={`organization-denied-${title}`}
    >
      <section className="state-card state-card--permission" role="alert">
        <p className="status-label">Permission required</p>
        <h2>{title}</h2>
        <p>
          Ask an organization owner for access, or choose another organization.
        </p>
        <AppLink
          className="button button--secondary"
          to={`${organizationRoot(organizationId)}/projects`}
        >
          Return to projects
        </AppLink>
      </section>
    </RoutePage>
  );
}

function useVerifiedOrganizationContext(
  props: PermissionAwareProjectPageProps,
):
  | VerifiedOrganizationContext
  | "backend-unavailable"
  | "organization-denied"
  | null {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const usesBackend =
    props.principal !== undefined || props.organizationId !== undefined;
  if (!usesBackend) return null;
  if (
    runtime === null ||
    props.principal === undefined ||
    props.organizationId === undefined
  ) {
    return "backend-unavailable";
  }
  const organization = props.principal.organizationContexts.find(
    (candidate) => candidate.organizationId === props.organizationId,
  );
  if (organization?.capabilities.includes("projects.read") !== true) {
    return "organization-denied";
  }
  return {
    organization,
    organizationId: props.organizationId,
    principal: props.principal,
    runtime,
  };
}

export function ProjectsPage(props: PermissionAwareProjectPageProps) {
  const context = useVerifiedOrganizationContext(props);
  if (context === null) {
    return (
      <LegacyProjectsPage identity={props.identity ?? localMockIdentity} />
    );
  }
  if (context === "backend-unavailable") {
    return <BackendUnavailablePage title="Projects unavailable" />;
  }
  if (context === "organization-denied") {
    return (
      <OrganizationPermissionPage
        organizationId={props.organizationId ?? "organization_unavailable"}
        title="Projects are not available for this organization"
      />
    );
  }
  return <AuthenticatedProjectsPage context={context} />;
}

function AuthenticatedProjectsPage({
  context,
}: {
  readonly context: VerifiedOrganizationContext;
}) {
  const [query, setQuery] = useState("");
  const projectQuery = useQuery({
    queryKey: cloudMarkupQueryKeys.projects(
      context.principal.id,
      context.organizationId,
    ),
    queryFn: async () => {
      const response = await context.runtime.client.request("projects.list", {
        path: { organizationId: context.organizationId },
        query: { "page[limit]": "100", sort: "-updatedAt" },
      });
      for (const project of response.data) {
        assertProjectResponseBinding(project, context.organizationId);
      }
      return response.data;
    },
    retry: retryQuery,
  });
  const visibleProjects = useMemo(() => {
    const projects = (projectQuery.data ?? []).filter(
      (project) =>
        !["deleted", "deletion-pending"].includes(project.lifecycleStatus),
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery === ""
      ? projects
      : projects.filter((project) =>
          project.name.toLocaleLowerCase().includes(normalizedQuery),
        );
  }, [projectQuery.data, query]);
  const root = organizationRoot(context.organizationId);

  return (
    <RoutePage
      title="Projects"
      eyebrow={`Organization workspace · ${context.organization.role}`}
      description="Your ideas, connected. Pick up a project or start something new."
      routeKey={`projects-${context.organizationId}`}
      actions={
        hasCapability(context.organization, "projects.create") ? (
          <AppLink
            className="button button--primary"
            to={`${root}/projects/new`}
          >
            New project
          </AppLink>
        ) : null
      }
    >
      <div className="projects-index-content">
        {hasCapability(context.organization, "projects.create") ? (
          <ProjectStartLinks root={root} />
        ) : null}
        {projectQuery.isPending ? (
          <section className="state-card" role="status" aria-live="polite">
            <p className="status-label">Loading</p>
            <h2>Loading your projects</h2>
          </section>
        ) : projectQuery.isError ? (
          <section className="state-card state-card--error" role="alert">
            <p className="status-label">Could not load projects</p>
            <h2>Project list unavailable</h2>
            <p>
              {apiErrorMessage(
                projectQuery.error,
                "CloudMarkup could not load projects from the server.",
              )}
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void projectQuery.refetch()}
            >
              Try again
            </button>
          </section>
        ) : (
          <section
            className="section-stack"
            aria-labelledby="project-list-title"
          >
            <div className="section-heading">
              <div>
                <p className="status-label">Architecture workspaces</p>
                <h2 id="project-list-title">Your projects</h2>
                <p className="projects-index-content__summary" role="status">
                  {query.trim() === ""
                    ? `${String(visibleProjects.length)} ${visibleProjects.length === 1 ? "project" : "projects"}`
                    : `${String(visibleProjects.length)} of ${String(projectQuery.data.length)} projects`}
                </p>
              </div>
              <label className="search-field">
                <span>Search projects</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                  }}
                />
              </label>
            </div>
            {visibleProjects.length === 0 ? (
              <div className="state-card" role="status">
                <p className="status-label">
                  {query.trim() === "" ? "No projects" : "No search results"}
                </p>
                <h3>
                  {query.trim() === ""
                    ? "This organization has no projects yet"
                    : `No project matches “${query}”`}
                </h3>
                {query.trim() === "" ? (
                  <p>
                    {hasCapability(context.organization, "projects.create")
                      ? "Choose a starting point above. We'll help you find your way around the canvas."
                      : "You can view projects here, but only members with project creation access can add one."}
                  </p>
                ) : (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => {
                      setQuery("");
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <ul className="card-grid" aria-label="Your projects">
                {visibleProjects.map((project) => (
                  <li key={project.id} className="project-card">
                    <div className="project-card__heading">
                      <span aria-hidden="true" className="project-card__mark">
                        {project.name.slice(0, 1).toLocaleUpperCase()}
                      </span>
                      <div>
                        <h3>{project.name}</h3>
                        <p>
                          Updated{" "}
                          <time dateTime={project.updatedAt}>
                            {formatTimestamp(project.updatedAt)}
                          </time>
                        </p>
                      </div>
                    </div>
                    <div className="project-card__status">
                      <span className="text-badge">
                        {formatProjectLifecycle(project.lifecycleStatus)}
                      </span>
                      <span className="text-badge text-badge--neutral">
                        Draft v{project.currentDraft.version}
                      </span>
                      {project.latestRevisionId === undefined ? null : (
                        <span className="text-badge text-badge--neutral">
                          Revision available
                        </span>
                      )}
                    </div>
                    <div className="project-card__footer">
                      <AppLink
                        className="text-link"
                        to={`${root}/projects/${encodeRouteSelector(project.id)}`}
                      >
                        Open project <ArrowRight aria-hidden="true" size={14} />
                      </AppLink>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </RoutePage>
  );
}
export function NewProjectPage(props: PermissionAwareProjectPageProps) {
  const location = useAppLocation();
  const context = useVerifiedOrganizationContext(props);
  if (context === null) {
    return (
      <LegacyNewProjectPage identity={props.identity ?? localMockIdentity} />
    );
  }
  if (context === "backend-unavailable") {
    return <BackendUnavailablePage title="Project creation unavailable" />;
  }
  if (context === "organization-denied") {
    return (
      <OrganizationPermissionPage
        organizationId={props.organizationId ?? "organization_unavailable"}
        title="No project can be created for this organization"
      />
    );
  }
  if (!hasCapability(context.organization, "projects.create")) {
    return (
      <OrganizationPermissionPage
        organizationId={context.organizationId}
        title="No project can be created"
      />
    );
  }
  return (
    <PreparedNewProjectPage
      context={context}
      key={`${context.principal.id}:${context.organizationId}:${location.search}`}
      search={location.search}
    />
  );
}

function PreparedNewProjectPage({
  context,
  search,
}: {
  readonly context: VerifiedOrganizationContext;
  readonly search: string;
}) {
  const hasTemplate = new URLSearchParams(search).has("template");
  const templateQuery = useQuery(
    {
      queryKey: ["reviewed-project-template", search],
      enabled: hasTemplate,
      retry: false,
      gcTime: 0,
      queryFn: async () =>
        (
          await import("../templates/reviewed-project-template.js")
        ).readReviewedProjectTemplate(search),
    },
    context.runtime.queryClient,
  );
  if (hasTemplate && templateQuery.isPending) {
    return (
      <RoutePage title="Loading template" routeKey="project-template-loading">
        <p role="status">Preparing your starting architecture…</p>
      </RoutePage>
    );
  }
  const template = hasTemplate ? (templateQuery.data ?? "unavailable") : null;
  if (template === "unavailable") {
    return (
      <RoutePage
        title="Template unavailable"
        eyebrow="Project creation"
        routeKey="project-template-unavailable"
      >
        <section className="state-card state-card--warning" role="alert">
          <h2>Choose a reviewed template</h2>
          <p>
            The selected template could not be loaded. No project was created.
          </p>
          <AppLink
            className="button button--secondary"
            to={`${organizationRoot(context.organizationId)}/templates`}
          >
            Return to templates
          </AppLink>
        </section>
      </RoutePage>
    );
  }
  return <AuthenticatedNewProjectPage context={context} template={template} />;
}

function AuthenticatedNewProjectPage({
  context,
  template,
}: {
  readonly context: VerifiedOrganizationContext;
  readonly template: ReturnType<typeof readReviewedProjectTemplate>;
}) {
  const navigate = useNavigate();
  const experience = useExperiencePreference();
  const [showTour, setShowTour] = useState(true);
  const location = useAppLocation();
  const canImport = hasCapability(context.organization, "integrations.read");
  const [startingPoint, setStartingPoint] = useState<
    "blank" | "import" | "assistant"
  >(
    template === null &&
      canImport &&
      new URLSearchParams(location.search).get("start") === "import"
      ? "import"
      : template === null &&
          ["prompt", "assistant"].includes(
            new URLSearchParams(location.search).get("start") ?? "",
          )
        ? "assistant"
        : "blank",
  );
  const [aiPrompt, setAiPrompt] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState("");
  const [aiCreditMessage, setAiCreditMessage] = useState("");
  const [generationCanceled, setGenerationCanceled] = useState(false);
  const generationController = useRef<AbortController | null>(null);
  const creationActive = useRef(true);
  useEffect(() => {
    creationActive.current = true;
    return () => {
      creationActive.current = false;
      generationController.current?.abort();
    };
  }, []);
  const generateDiagram = useMutation({
    mutationFn: async ({
      projectId,
      prompt,
    }: {
      projectId: string;
      prompt: string;
    }) => {
      const controller = new AbortController();
      generationController.current = controller;
      setGenerationCanceled(false);
      setAiProgress("Preparing your project…");
      setAiCreditMessage("");
      let credits: BetaInfrastructureJobCreditsV1 | null = null;
      let support;
      try {
        support = await context.runtime.loadAiCapabilities?.(controller.signal);
      } catch {
        // A failed availability read never authorizes a paid legacy fallback.
      }
      controller.signal.throwIfAborted();
      if (support?.proposalVersions[0] !== 6)
        throw new BetaInfrastructureRequestError("ai.unavailable");
      const response = await context.runtime.client.requestWithMetadata(
        "drafts.get",
        { path: { projectId } },
      );
      if (response.data.data.projectId !== projectId)
        throw new Error("The draft did not match this project.");
      if (response.data.data.storageStatus === "publication-pending")
        throw new BetaInfrastructureRequestError("ai.saved-source-changed");
      const architectureDocument = parseArchitectureDocument(
        response.data.data.architectureDocument,
      );
      const result = await requestBetaInfrastructureProposal({
        projectId,
        etag: response.metadata.etag,
        signal: controller.signal,
        accessToken: getCognitoAccessToken,
        onProgress: setAiProgress,
        onCredits: (receipt) => {
          credits = receipt;
          setAiCreditMessage(describeBetaInfrastructureCredits(receipt));
        },
        request: {
          contractVersion: 1,
          proposalVersion: 6,
          requirements: prompt,
          architectureDocument,
        },
      });
      controller.signal.throwIfAborted();
      if (
        result.architectureDigest !== digestCanonicalValue(architectureDocument)
      )
        throw new Error("The proposal did not match the project draft.");
      rememberProjectCreationProposal(projectId, {
        architectureDigest: result.architectureDigest,
        proposal: betaInfrastructureProposalSchema.parse(result.proposal),
        ...(result.applicability
          ? { applicability: result.applicability }
          : {}),
        credits,
      });
      return projectId;
    },
    onSuccess: (projectId) => {
      if (!creationActive.current) return;
      navigate(
        organizationRoot(context.organizationId) +
          "/projects/" +
          encodeRouteSelector(projectId) +
          "/editor",
      );
    },
  });
  const [name, setName] = useState(template?.definition.title ?? "");
  const [description, setDescription] = useState("");
  const idempotencyKey = useRef<string | undefined>(undefined);
  const createProject = useMutation({
    mutationFn: async (input: {
      readonly body: CreateProjectV1;
      readonly idempotencyKey: string;
    }) => {
      const response = await context.runtime.client.request("projects.create", {
        body: input.body,
        headers: { "idempotency-key": input.idempotencyKey },
        path: { organizationId: context.organizationId },
      });
      assertProjectResponseBinding(
        response.data.project,
        context.organizationId,
      );
      return response;
    },
    onSuccess: async (response) => {
      idempotencyKey.current = undefined;
      experience.setContextualTeachingEnabled(showTour);
      if (showTour) experience.restartWalkthrough();
      await context.runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.projects(
          context.principal.id,
          context.organizationId,
        ),
      });
      if (!creationActive.current) return;
      if (startingPoint === "assistant") {
        setCreatedProjectId(response.data.project.id);
        generateDiagram.mutate({
          projectId: response.data.project.id,
          prompt: aiPrompt.trim(),
        });
      } else
        navigate(
          organizationRoot(context.organizationId) +
            "/projects/" +
            encodeRouteSelector(response.data.project.id) +
            "/editor" +
            (startingPoint === "import" ? "?tool=import" : ""),
        );
    },
  });

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      createProject.isPending ||
      createdProjectId !== null ||
      name.trim() === "" ||
      (startingPoint === "assistant" && aiPrompt.trim().length < 5)
    )
      return;
    const normalizedDescription = description.trim();
    idempotencyKey.current ??= createMutationKey("project-create");
    createProject.mutate({
      body: {
        ...(template === null
          ? { creationMode: "blank" as const }
          : {
              architectureDocument: template.architectureDocument,
              creationMode: "draft-copy" as const,
            }),
        ...(normalizedDescription === ""
          ? {}
          : { description: normalizedDescription }),
        name: name.trim(),
      },
      idempotencyKey: idempotencyKey.current,
    });
  }

  const root = organizationRoot(context.organizationId);
  return (
    <RoutePage
      title="Create a project"
      eyebrow={template === null ? "New project" : "Create from template"}
      description="Give your idea a name. You can shape the details on the canvas."
      routeKey={`project-new-${context.organizationId}`}
    >
      {createProject.isError ? (
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Creation not confirmed</p>
          <h2>The project could not be opened</h2>
          <p>
            {apiErrorMessage(
              createProject.error,
              "Retry to confirm this same request. Your project details are preserved to avoid creating a duplicate.",
            )}
          </p>
          <p>
            The server may already have saved this project. Retry this same
            request to confirm the result before starting another project.
            Leaving this page does not cancel a submitted request.
          </p>
        </section>
      ) : null}
      {createdProjectId === null ? (
        <form className="form-card project-setup" onSubmit={handleSubmit}>
          {template === null ? (
            <fieldset
              className="project-setup__choices"
              disabled={createProject.isPending || createProject.isError}
            >
              <legend>How would you like to begin?</legend>
              <label className="project-setup__choice">
                <Plus aria-hidden="true" size={22} />
                <span>
                  <strong>Blank canvas</strong>
                  <small>Add services and connect them at your own pace.</small>
                </span>
                <input
                  type="radio"
                  name="starting-point"
                  value="blank"
                  checked={startingPoint === "blank"}
                  onChange={() => {
                    setStartingPoint("blank");
                  }}
                />
              </label>
              <AppLink
                className="project-setup__choice"
                to={`${root}/templates`}
              >
                <LayoutTemplate aria-hidden="true" size={22} />
                <span>
                  <strong>Start from a template</strong>
                  <small>
                    Explore a reviewed pattern, then make it your own.
                  </small>
                </span>
                <ArrowRight aria-hidden="true" size={16} />
              </AppLink>
              <label className="project-setup__choice">
                <Upload aria-hidden="true" size={22} />
                <span>
                  <strong>Import existing code</strong>
                  <small>
                    {canImport
                      ? "Review Terraform or CloudFormation from GitHub."
                      : "Ask an organization owner for GitHub integration access."}
                  </small>
                </span>
                <input
                  type="radio"
                  name="starting-point"
                  value="import"
                  disabled={!canImport}
                  checked={startingPoint === "import"}
                  onChange={() => {
                    setStartingPoint("import");
                  }}
                />
              </label>
              <label className="project-setup__choice">
                <Sparkles aria-hidden="true" size={22} />
                <span>
                  <strong>Describe with AI</strong>
                  <small>
                    Describe your application here. Review the generated diagram
                    before adding it.
                  </small>
                </span>
                <input
                  type="radio"
                  name="starting-point"
                  value="assistant"
                  checked={startingPoint === "assistant"}
                  onChange={() => {
                    setStartingPoint("assistant");
                  }}
                />
              </label>
            </fieldset>
          ) : null}
          <label className="field">
            <span id="project-name-label">Project name</span>
            <input
              aria-labelledby="project-name-label"
              aria-describedby="project-name-help"
              readOnly={createProject.isPending || createProject.isError}
              required
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                if (!createProject.isPending)
                  idempotencyKey.current = undefined;
              }}
            />
            <small id="project-name-help">
              Something you’ll recognize, like “Customer support API”.
            </small>
          </label>
          <label className="field">
            <span>Description (optional)</span>
            <textarea
              readOnly={createProject.isPending || createProject.isError}
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                if (!createProject.isPending)
                  idempotencyKey.current = undefined;
              }}
            />
          </label>
          {template !== null || startingPoint === "import" ? (
            <section className="project-setup__starting-point">
              <p className="status-label">Starting point</p>
              <h2>
                {template?.definition.title ??
                  "A workspace for your existing code"}
              </h2>
              <p>
                {template?.definition.summary ??
                  "Create your project and first save a revision. In Code, connect GitHub, choose the repository, branch and pinned commit, then review supported Terraform or CloudFormation observations and any proposed changes."}
              </p>
              {template !== null ? (
                <Disclosure summary="What the template includes">
                  <p>
                    Includes the reviewed resources, connections, and workload
                    contracts. You can edit the saved project before generating
                    any artifacts.
                  </p>
                </Disclosure>
              ) : (
                <p className="fine-print">
                  Save a first revision, then review code from GitHub alongside
                  your design. Local file upload and automatic conversion into
                  editable canvas resources are not available. Your original
                  code stays unchanged.
                </p>
              )}
            </section>
          ) : null}
          {startingPoint === "assistant" ? (
            <>
              <AiWorkflowProgress stage="context" />
              <label className="field">
                <span id="project-ai-prompt-label">
                  What would you like to build?
                </span>
                <textarea
                  aria-labelledby="project-ai-prompt-label"
                  required
                  minLength={5}
                  maxLength={8000}
                  rows={5}
                  value={aiPrompt}
                  readOnly={createProject.isPending || createProject.isError}
                  onChange={(event) => {
                    setAiPrompt(event.currentTarget.value);
                  }}
                  placeholder="Describe your application, what happens to its data, and any services or requirements you already know."
                />
                <small>
                  AI will prepare a diagram for your review. Keep credentials
                  and private data out of your description. An estimate appears
                  while generating; up to 100 credits may be temporarily
                  reserved and only actual model use is charged.
                </small>
              </label>
              <div className="ai-prompt-starters" aria-label="Idea starters">
                {[
                  [
                    "Web application",
                    "A sign-in protected web API with a database. Describe the user journey, data rules, expected traffic and reliability requirements.",
                  ],
                  [
                    "Event workflow",
                    "An event-driven workflow that receives files, validates their content and stores processed results. Ask me about missing business rules.",
                  ],
                  [
                    "Start from requirements",
                    "Help plan my application. Ask about its users, data, integrations, traffic, budget and availability before proposing consequential choices.",
                  ],
                ].map(([label, prompt]) => (
                  <button
                    className="button button--secondary"
                    type="button"
                    key={label}
                    disabled={createProject.isPending}
                    onClick={() => {
                      setAiPrompt(prompt ?? "");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <label className="first-use-teaching">
            <input
              type="checkbox"
              checked={showTour}
              disabled={createProject.isPending}
              onChange={(event) => {
                setShowTour(event.currentTarget.checked);
              }}
            />
            <span>Show me around the editor</span>
          </label>
          <div className="form-actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={
                createProject.isPending ||
                name.trim() === "" ||
                (startingPoint === "assistant" && aiPrompt.trim().length < 5)
              }
            >
              {createProject.isPending
                ? "Creating project…"
                : createProject.isError
                  ? "Confirm original request"
                  : "Create project"}
            </button>
            {createProject.isPending ? (
              <button className="button button--quiet" type="button" disabled>
                Cancel
              </button>
            ) : (
              <AppLink className="button button--quiet" to={`${root}/projects`}>
                {createProject.isError ? "Return to projects" : "Cancel"}
              </AppLink>
            )}
          </div>
          {createProject.isPending ? (
            <p role="status">
              Saving your project. Wait for confirmation; leaving this page does
              not cancel the request.
            </p>
          ) : null}
        </form>
      ) : (
        <section
          className="form-card project-ai-progress"
          aria-label="Preparing your diagram"
        >
          <h2>
            {generateDiagram.isError
              ? "Your project is saved"
              : "Designing your diagram"}
          </h2>
          <AiWorkflowProgress
            stage={generateDiagram.isPending ? "generating" : "context"}
          />
          <p role={generateDiagram.isError ? "alert" : "status"}>
            {generateDiagram.isError
              ? generateDiagram.error instanceof BetaInfrastructureRequestError
                ? generateDiagram.error.safeMessage
                : generationCanceled
                  ? "Diagram generation was canceled. Your project is saved; open it to continue manually or retry in this same project."
                  : apiErrorMessage(
                      generateDiagram.error,
                      "The diagram could not be prepared. Retry in this same project.",
                    )
              : aiProgress}
          </p>
          {generateDiagram.error instanceof
          BetaInfrastructureAccessDeniedError ? (
            <div className="form-actions">
              {hasCapability(
                context.organization,
                "commercial.summary.read",
              ) ? (
                <AppLink className="button" to={`${root}/usage`}>
                  View usage
                </AppLink>
              ) : null}
              <AppLink className="button" to={`${root}/billing`}>
                View billing
              </AppLink>
              <p>
                An owner or administrator can review the plan. You can continue
                editing the saved project manually.
              </p>
            </div>
          ) : null}
          {aiCreditMessage ? <p aria-live="polite">{aiCreditMessage}</p> : null}
          {generateDiagram.isPending ? (
            <>
              <progress aria-label="Generating project diagram" />
              <button
                type="button"
                className="button"
                onClick={() => {
                  setGenerationCanceled(true);
                  generationController.current?.abort();
                }}
              >
                Cancel generation
              </button>
            </>
          ) : (
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  generateDiagram.mutate({
                    projectId: createdProjectId,
                    prompt: aiPrompt.trim(),
                  });
                }}
              >
                Retry diagram
              </button>
              <AppLink
                className="button"
                to={
                  root +
                  "/projects/" +
                  encodeRouteSelector(createdProjectId) +
                  "/editor"
                }
              >
                Open saved project
              </AppLink>
            </div>
          )}
        </section>
      )}
    </RoutePage>
  );
}

export function ProjectOverviewPage(props: ProjectRoutePageProps) {
  const context = useVerifiedOrganizationContext(props);
  if (context === null)
    return <LegacyProjectOverviewPage projectId={props.projectId} />;
  if (context === "backend-unavailable")
    return <BackendUnavailablePage title="Project unavailable" />;
  if (context === "organization-denied") {
    return (
      <OrganizationPermissionPage
        organizationId={props.organizationId ?? "organization_unavailable"}
        title="This project is not available"
      />
    );
  }
  return (
    <AuthenticatedProjectOverviewPage
      key={`${context.principal.id}:${context.organizationId}:${props.projectId}`}
      context={context}
      projectId={props.projectId}
    />
  );
}
function AuthenticatedProjectOverviewPage({
  context,
  projectId,
}: {
  readonly context: VerifiedOrganizationContext;
  readonly projectId: string;
}) {
  const exportAvailability = useExportCapabilities();
  const activeScope = useRef(false);
  useEffect(() => {
    activeScope.current = true;
    return () => {
      activeScope.current = false;
    };
  }, []);
  const projectQueryKey = cloudMarkupQueryKeys.project(
    context.principal.id,
    context.organizationId,
    projectId,
  );
  const projectQuery = useQuery({
    queryKey: projectQueryKey,
    queryFn: async ({ signal }) => {
      const response = await context.runtime.client.requestWithMetadata(
        "projects.get",
        {
          path: { projectId },
        },
      );
      assertProjectResponseBinding(
        response.data.data,
        context.organizationId,
        projectId,
      );
      if (signal.aborted) throw new Error("The project read was superseded.");
      return { etag: response.metadata.etag, project: response.data.data };
    },
    retry: retryQuery,
  });
  const updateCachedProject = async (result: {
    readonly data: { readonly data: ProjectV1 };
    readonly metadata: { readonly etag: string };
  }) => {
    assertProjectResponseBinding(
      result.data.data,
      context.organizationId,
      projectId,
    );
    // A lifecycle response supersedes older project/draft reads. Do not let an
    // in-flight query restore an editable snapshot after the project closes.
    await context.runtime.queryClient.cancelQueries({
      queryKey: projectQueryKey,
    });
    context.runtime.queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey.length > projectQueryKey.length &&
        projectQueryKey.every((part, index) => query.queryKey[index] === part),
    });
    if (!activeScope.current) {
      context.runtime.queryClient.removeQueries({ queryKey: projectQueryKey });
      await context.runtime.queryClient.invalidateQueries({
        queryKey: cloudMarkupQueryKeys.projects(
          context.principal.id,
          context.organizationId,
        ),
      });
      return;
    }
    context.runtime.queryClient.setQueryData(projectQueryKey, {
      etag: result.metadata.etag,
      project: result.data.data,
    });
    await context.runtime.queryClient.invalidateQueries({
      queryKey: cloudMarkupQueryKeys.projects(
        context.principal.id,
        context.organizationId,
      ),
    });
  };
  const archiveProject = useMutation({
    mutationFn: async (input: {
      readonly etag: string;
      readonly idempotencyKey: string;
    }) =>
      context.runtime.client.requestWithMetadata("projects.archive", {
        body: { contractVersion: 1 },
        headers: {
          "idempotency-key": input.idempotencyKey,
          "if-match": input.etag,
        },
        path: { projectId },
      }),
    onSuccess: updateCachedProject,
  });
  const deleteProject = useMutation({
    mutationFn: async (input: {
      readonly etag: string;
      readonly idempotencyKey: string;
    }) =>
      context.runtime.client.requestWithMetadata("projects.delete", {
        headers: {
          "idempotency-key": input.idempotencyKey,
          "if-match": input.etag,
        },
        path: { projectId },
      }),
    onSuccess: updateCachedProject,
  });

  if (projectQuery.isPending) {
    return (
      <RoutePage
        title="Loading project"
        eyebrow="Project"
        description="Loading your project details."
        routeKey={`project-loading-${projectId}`}
      >
        <section className="state-card" role="status" aria-live="polite">
          <p className="status-label">Loading</p>
          <h2>Loading project overview</h2>
        </section>
      </RoutePage>
    );
  }
  if (projectQuery.isError) {
    return (
      <RoutePage
        title="Project unavailable"
        eyebrow="Project"
        description="The project could not be loaded."
        routeKey={`project-error-${projectId}`}
      >
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Could not load project</p>
          <h2>Project overview unavailable</h2>
          <p>
            {apiErrorMessage(
              projectQuery.error,
              "CloudMarkup could not load this project from the server.",
            )}
          </p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void projectQuery.refetch()}
          >
            Try again
          </button>
        </section>
      </RoutePage>
    );
  }

  const project = projectQuery.data.project;
  if (project.organizationId !== context.organizationId) {
    return (
      <OrganizationPermissionPage
        organizationId={context.organizationId}
        title="This project is not available"
      />
    );
  }
  const projectPath = `${organizationRoot(context.organizationId)}/projects/${encodeRouteSelector(projectId)}`;
  const lifecycleError = archiveProject.error ?? deleteProject.error;
  const lifecyclePending = archiveProject.isPending || deleteProject.isPending;

  if (["deleted", "deletion-pending"].includes(project.lifecycleStatus)) {
    return (
      <RoutePage
        title={project.name}
        eyebrow="Project closed"
        description="This project is no longer available for editing."
        routeKey={`project-closed-${projectId}`}
      >
        <section className="state-card" role="status">
          <h2>
            {project.lifecycleStatus === "deleted"
              ? "Project deleted"
              : "Deletion requested"}
          </h2>
          <p>
            {project.lifecycleStatus === "deletion-pending"
              ? "The project is closed. Scheduled cleanup permanently removes retained project content. Its deletion record remains available."
              : "The project is closed. Its deletion record remains available."}
          </p>
          <dl aria-label="Project lifecycle summary">
            <dt>Status</dt>
            <dd>{project.lifecycleStatus}</dd>
          </dl>
          <AppLink
            className="button button--secondary"
            to={`${organizationRoot(context.organizationId)}/projects`}
          >
            Return to projects
          </AppLink>
        </section>
      </RoutePage>
    );
  }

  return (
    <RoutePage
      title={project.name}
      eyebrow={`Project · ${formatProjectLifecycle(project.lifecycleStatus)}`}
      description={
        project.description ?? "Review the current draft and saved revisions."
      }
      routeKey={`project-overview-${projectId}`}
      actions={
        project.lifecycleStatus === "deleted" ? undefined : (
          <AppLink
            className="button button--primary"
            to={`${projectPath}/editor`}
          >
            {hasCapability(context.organization, "projects.mutate")
              ? "Open canvas"
              : "Review draft"}
          </AppLink>
        )
      }
    >
      {lifecycleError === null ? null : (
        <section className="state-card state-card--error" role="alert">
          <p className="status-label">Lifecycle action failed</p>
          <h2>Project update not confirmed</h2>
          <p>
            {deleteProject.error instanceof ApiClientError &&
            deleteProject.error.envelope.error.code === "access_denied"
              ? "Deleting a project requires owner access and a recent sign-in. Sign in again, then retry."
              : apiErrorMessage(
                  lifecycleError,
                  "CloudMarkup could not update the project lifecycle.",
                )}
          </p>
          {deleteProject.error instanceof ApiClientError &&
          deleteProject.error.envelope.error.code === "access_denied" ? (
            <AppLink
              className="button button--secondary"
              to={signInPathForReturn(projectPath)}
            >
              Sign in again
            </AppLink>
          ) : null}
          <button
            className="button button--secondary"
            type="button"
            disabled={lifecyclePending || projectQuery.isFetching}
            onClick={() => {
              archiveProject.reset();
              deleteProject.reset();
              void projectQuery.refetch();
            }}
          >
            Refresh project status
          </button>
        </section>
      )}
      <dl
        className="project-overview-summary"
        aria-label="Project lifecycle summary"
      >
        <div>
          <dt>Status</dt>
          <dd>{formatProjectLifecycle(project.lifecycleStatus)}</dd>
        </div>
        <div>
          <dt>Draft</dt>
          <dd>Version {project.currentDraft.version}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={project.updatedAt}>
              {formatTimestamp(project.updatedAt)}
            </time>
          </dd>
        </div>
      </dl>
      <nav className="project-overview-links" aria-label="Project tools">
        <AppLink
          className="button button--secondary"
          to={`${projectPath}/revisions`}
        >
          Revisions and exports <ArrowRight aria-hidden="true" size={14} />
        </AppLink>
        <AppLink className="text-link" to={`${projectPath}/intent`}>
          Requirements
        </AppLink>
      </nav>
      {exportAvailability.state === "error" ? (
        <p role="status">
          Export availability could not be checked.{" "}
          <button
            className="text-link"
            type="button"
            onClick={exportAvailability.retry}
          >
            Check again
          </button>
        </p>
      ) : null}
      <Disclosure summary="Saved draft checks">
        <SavedDraftValidationPanel
          key={`${context.principal.id}:${context.organizationId}:${projectId}`}
          organizationId={context.organizationId}
          principal={context.principal}
          project={project}
          onReloadProject={async () => {
            const refreshed = await projectQuery.refetch();
            if (!refreshed.isSuccess)
              throw new Error("Project could not be refreshed.");
          }}
        />
      </Disclosure>
      <Disclosure className="project-settings" summary="Project settings">
        {hasCapability(context.organization, "projects.mutate") &&
        project.lifecycleStatus === "active" ? (
          <section className="state-card state-card--warning">
            <p className="status-label">Archive project</p>
            <h2>Make the project read-only</h2>
            <p>Archiving preserves drafts and immutable revisions.</p>
            <button
              className="button button--secondary"
              type="button"
              disabled={lifecyclePending}
              onClick={() => {
                if (
                  window.confirm(
                    `Archive “${project.name}”? Existing records will remain available read-only.`,
                  )
                ) {
                  archiveProject.mutate({
                    etag: projectQuery.data.etag,
                    idempotencyKey: createMutationKey("project-archive"),
                  });
                }
              }}
            >
              {archiveProject.isPending ? "Archiving…" : "Archive project"}
            </button>
          </section>
        ) : null}
        {hasCapability(context.organization, "projects.delete") &&
        !["deleted", "deletion-pending"].includes(project.lifecycleStatus) ? (
          <section className="state-card state-card--error">
            <p className="status-label">Delete project</p>
            <h2>Delete this project</h2>
            <p>
              This closes the project and requests deletion. Scheduled cleanup
              permanently removes retained project content. An audit record is
              retained.
            </p>
            <button
              className="button button--secondary"
              type="button"
              disabled={lifecyclePending}
              onClick={() => {
                if (
                  window.confirm(
                    `Request deletion of “${project.name}”? This closes the project and cannot be undone from this screen. Scheduled cleanup permanently removes retained project content. An audit record is retained.`,
                  )
                ) {
                  deleteProject.mutate({
                    etag: projectQuery.data.etag,
                    idempotencyKey: createMutationKey("project-delete"),
                  });
                }
              }}
            >
              {deleteProject.isPending
                ? "Requesting deletion…"
                : "Delete project"}
            </button>
          </section>
        ) : null}
      </Disclosure>
    </RoutePage>
  );
}

export function ProjectIntentPage(props: ProjectRoutePageProps) {
  const location = useAppLocation();
  const navigate = useNavigate();
  const selectors = new URLSearchParams(location.search).getAll(
    "acceptedIntent",
  );
  const selection =
    selectors.length === 0
      ? undefined
      : selectors.length === 1
        ? selectors[0]
        : "";
  const root = organizationRoot(props.organizationId ?? "local-org");
  return (
    <RoutePage
      title="Intent review"
      eyebrow="AI project setup"
      description="Preview your application requirements, assumptions and open questions."
      routeKey={`project-intent-${props.projectId}`}
    >
      <ProjectIntentWorkspace
        {...(selection === undefined ? {} : { acceptedIntentId: selection })}
        onAccepted={(id) => {
          navigate(
            `${location.pathname}?acceptedIntent=${encodeRouteSelector(id)}`,
            { replace: true },
          );
        }}
        key={`${props.principal?.id ?? "anonymous"}:${props.organizationId ?? "none"}:${props.projectId}`}
        {...props}
      />
      <section>
        <AppLink
          className="button button--secondary"
          to={`${root}/projects/${encodeRouteSelector(props.projectId)}`}
        >
          Return to project
        </AppLink>
      </section>
    </RoutePage>
  );
}
function LegacyProjectsPage({
  identity,
}: {
  readonly identity: LocalMockIdentity;
}) {
  const [query, setQuery] = useState("");
  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery === ""
      ? localMockProjects
      : localMockProjects.filter((project) =>
          project.name.toLocaleLowerCase().includes(normalizedQuery),
        );
  }, [query]);
  const root = "/organizations/local-org";
  return (
    <RoutePage
      title="Projects"
      eyebrow={`${identity.organization.name} · local mock organization`}
      description="Synthetic project summaries demonstrate the shell only. No project service is connected."
      routeKey="projects"
      actions={
        hasLocalMockCapability("create-project", identity) ? (
          <AppLink
            className="button button--primary"
            to={`${root}/projects/new`}
          >
            New project
          </AppLink>
        ) : null
      }
    >
      <div className="projects-index-content">
        {identity.actorId === localMockIdentity.actorId ? (
          <FirstUseExperience />
        ) : null}
        <section
          className="state-card state-card--warning"
          aria-labelledby="stale-title"
        >
          <p className="status-label">Stale local fixture</p>
          <h2 id="stale-title">Project status is not server-authoritative</h2>
          <p>
            The cards below are versionless local examples. Refresh, save,
            entitlement, and activity status are unavailable.
          </p>
        </section>
        <section className="section-stack" aria-labelledby="project-list-title">
          <div className="section-heading">
            <div>
              <p className="status-label">Local collection</p>
              <h2 id="project-list-title">Project previews</h2>
            </div>
            <label className="search-field">
              <span>Search project previews</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
              />
            </label>
          </div>
          {visibleProjects.length === 0 ? (
            <div className="state-card" role="status">
              <p className="status-label">No search results</p>
              <h3>No local project preview matches “{query}”</h3>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setQuery("");
                }}
              >
                Clear search
              </button>
            </div>
          ) : (
            <ul className="card-grid" aria-label="Local project previews">
              {visibleProjects.map((project) => (
                <li key={project.id} className="project-card">
                  <div className="project-card__status">
                    <span className="text-badge">{project.lifecycle}</span>
                    <span className="text-badge text-badge--neutral">
                      Not connected
                    </span>
                  </div>
                  <h3>{project.name}</h3>
                  <p>{project.summary}</p>
                  <AppLink
                    className="text-link"
                    to={`${root}/projects/${project.id}`}
                  >
                    Open project overview
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </RoutePage>
  );
}

function LegacyNewProjectPage({
  identity,
}: {
  readonly identity: LocalMockIdentity;
}) {
  const location = useAppLocation();
  const navigate = useNavigate();
  const requestedStart = new URLSearchParams(location.search).get("start");
  const [startType, setStartType] = useState<ProjectStartChoice>(() =>
    isProjectStartChoice(requestedStart) ? requestedStart : "blank",
  );
  const [name, setName] = useState("");
  const [applicationDescription, setApplicationDescription] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const root = "/organizations/local-org";
  if (!hasLocalMockCapability("create-project", identity)) {
    return (
      <RoutePage
        title="Access unavailable"
        eyebrow="Permission denied"
        description="Project creation is not enabled in the current environment."
        routeKey="project-new-denied"
      >
        <section className="state-card state-card--permission" role="alert">
          <p className="status-label">Permission required</p>
          <h2>No project can be created</h2>
          <p>
            No project, quota, entitlement, organization policy, or backend
            state is inferred from this unavailable action.
          </p>
          <AppLink className="button button--secondary" to={`${root}/projects`}>
            Return to projects
          </AppLink>
        </section>
      </RoutePage>
    );
  }
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startType === "prompt") {
      setSubmitted(true);
      return;
    }
    navigate(`${root}/projects/field-notes/editor?start=${startType}`);
  }
  return (
    <RoutePage
      title="Create a project"
      eyebrow="Local project-start preview"
      description="Explore a local starting point. No project is saved to the backend."
      routeKey="project-new"
    >
      {submitted ? (
        <section className="state-card state-card--warning" role="alert">
          <p className="status-label">AI placeholder only</p>
          <h2>No model request or project was created</h2>
        </section>
      ) : null}
      <form className="form-card project-setup" onSubmit={handleSubmit}>
        <label className="field">
          <span>Project name</span>
          <input
            required
            value={name}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
          />
          <small>Required · stored only in this in-memory form.</small>
        </label>
        <fieldset className="choice-grid">
          <legend>Start from</legend>
          {(
            [
              [
                "prompt",
                "Describe with AI",
                "A truthful local placeholder; intent extraction is not connected.",
              ],
              [
                "template",
                "Notes API template",
                "Opens the local learning fixture in the existing editor.",
              ],
              [
                "blank",
                "Blank canvas",
                "Opens a valid zero-resource document in the existing editor.",
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="choice-card">
              <input
                aria-label={label}
                type="radio"
                name="start-type"
                value={value}
                checked={startType === value}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (isProjectStartChoice(next)) {
                    setStartType(next);
                    setSubmitted(false);
                  }
                }}
              />
              <span>
                <strong>{label}</strong>
                <small>{help}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {startType === "prompt" ? (
          <label className="field">
            <span>Describe the application</span>
            <textarea
              required
              rows={3}
              value={applicationDescription}
              onChange={(event) => {
                setApplicationDescription(event.currentTarget.value);
                setSubmitted(false);
              }}
            />
          </label>
        ) : null}
        <div className="form-actions">
          <button className="button button--primary" type="submit">
            {startType === "prompt"
              ? "Review AI placeholder"
              : startType === "template"
                ? "Open local notes template"
                : "Open blank canvas"}
          </button>
          <AppLink className="button button--quiet" to={`${root}/projects`}>
            Cancel
          </AppLink>
        </div>
      </form>
    </RoutePage>
  );
}

function LegacyProjectOverviewPage({
  projectId,
}: {
  readonly projectId: string;
}) {
  const project = localMockProjects.find(
    (candidate) => candidate.id === projectId,
  );
  const projectPath = `/organizations/local-org/projects/${encodeRouteSelector(projectId)}`;
  return (
    <RoutePage
      title={project?.name ?? "Project unavailable"}
      eyebrow="Project overview · local mock data"
      description="A lifecycle-aware shell preview with no persisted draft, revision, artifact, finding, or job."
      routeKey={`project-overview-${projectId}`}
      actions={
        <AppLink
          className="button button--primary"
          to={`${projectPath}/editor`}
        >
          Open editor shell
        </AppLink>
      }
    >
      <div className="metric-grid" aria-label="Project lifecycle summary">
        {[
          ["Draft", "Local preview only"],
          ["Latest revision", "None available"],
          ["Artifacts", "None generated"],
          ["Jobs", "Service not connected"],
        ].map(([label, value]) => (
          <section className="metric-card" key={label}>
            <h2>{label}</h2>
            <p>{value}</p>
          </section>
        ))}
      </div>
      <section className="feature-card">
        <p className="status-label">Available shell destinations</p>
        <h2>Review the planned lifecycle surfaces</h2>
        <div className="link-list">
          <AppLink to={`${projectPath}/intent`}>Intent placeholder</AppLink>
          <AppLink to={`${projectPath}/editor`}>Draft editor shell</AppLink>
          <AppLink to={`${projectPath}/revisions`}>Revision history</AppLink>
        </div>
      </section>
    </RoutePage>
  );
}
