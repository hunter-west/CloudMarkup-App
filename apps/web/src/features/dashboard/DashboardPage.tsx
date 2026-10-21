import { useQuery } from "@tanstack/react-query";
import {
  creditBalanceV1Schema,
  type CurrentPrincipalV1,
} from "@cloudmarkup/api-contract";
import { ArrowRight, FolderOpen, Sparkles, BookOpen } from "lucide-react";
import {
  cloudMarkupQueryKeys,
  useOptionalCloudMarkupQueryRuntime,
} from "../../api/index.js";
import { AppLink, encodeRouteSelector } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { useOptionalLocalOwnerSession } from "../auth/local-owner-session.js";
import { ProjectStartLinks } from "../projects/ProjectStartLinks.js";
import { restartWorkspaceTour } from "../onboarding/workspace-tour-events.js";
import "./dashboard.css";

interface DashboardProps {
  readonly principal?: CurrentPrincipalV1;
  readonly organizationId?: string;
}
export function DashboardPage({ principal, organizationId }: DashboardProps) {
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const localOwner = useOptionalLocalOwnerSession();
  const organization = principal?.organizationContexts.find(
    (entry) => entry.organizationId === organizationId,
  );
  if (principal === undefined && organizationId === undefined) {
    return (
      <DashboardView
        root="/organizations/local-org"
        canCreate
        projects={[]}
        usage={<p>Sign in to see your recorded credit balance.</p>}
      />
    );
  }
  if (
    !runtime ||
    !principal ||
    !organization?.capabilities.includes("projects.read")
  ) {
    return (
      <RoutePage title="Dashboard unavailable" routeKey="dashboard-denied">
        <p role="alert">
          You do not have access to this organization’s dashboard.
        </p>
        <AppLink to="/organizations">Choose an organization</AppLink>
      </RoutePage>
    );
  }
  return (
    <VerifiedDashboard
      principal={principal}
      organization={organization}
      runtime={runtime}
      localOwnerMode={localOwner !== null}
    />
  );
}
function VerifiedDashboard({
  principal,
  organization,
  runtime,
  localOwnerMode,
}: {
  readonly principal: CurrentPrincipalV1;
  readonly organization: CurrentPrincipalV1["organizationContexts"][number];
  readonly runtime: NonNullable<
    ReturnType<typeof useOptionalCloudMarkupQueryRuntime>
  >;
  readonly localOwnerMode: boolean;
}) {
  const organizationId = organization.organizationId;
  const scope = JSON.stringify(organization);
  const projects = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.projects(principal.id, organizationId),
      "dashboard",
      scope,
    ],
    queryFn: async ({ signal }) => {
      const response = await runtime.client.request("projects.list", {
        path: { organizationId },
        query: { "page[limit]": "100", sort: "-updatedAt" },
      });
      if (
        signal.aborted ||
        response.data.some(
          (project) => project.organizationId !== organizationId,
        )
      )
        throw new Error("Project scope changed.");
      return response.data.filter(
        (project) =>
          !["deleted", "deletion-pending"].includes(project.lifecycleStatus),
      );
    },
    retry: false,
    staleTime: 0,
  });
  const mayReadUsage =
    !localOwnerMode &&
    (organization.capabilities.includes("commercial.summary.read") ||
      organization.capabilities.includes("organizations.read"));
  const balance = useQuery({
    queryKey: [
      ...cloudMarkupQueryKeys.commercialSummary(principal.id, organizationId),
      "dashboard-credits",
      scope,
    ],
    enabled: mayReadUsage,
    queryFn: async ({ signal }) => {
      const response = await runtime.client.request(
        "commercial.credit-balance.get",
        { path: { organizationId } },
      );
      const value = creditBalanceV1Schema.parse(response.data);
      if (signal.aborted || value.organizationId !== organizationId)
        throw new Error("Credit scope changed.");
      return value;
    },
    retry: false,
    staleTime: 0,
  });
  const root = "/organizations/" + encodeRouteSelector(organizationId);
  return (
    <DashboardView
      root={root}
      canCreate={organization.capabilities.includes("projects.create")}
      projects={projects.data ?? []}
      projectState={
        projects.isPending ? "loading" : projects.isError ? "error" : "ready"
      }
      retryProjects={() => void projects.refetch()}
      usage={
        localOwnerMode ? (
          <p>
            Hosted credits and billing are unavailable in this local workspace.
          </p>
        ) : !mayReadUsage ? (
          <p>Your role does not include usage access.</p>
        ) : balance.isPending ? (
          <p role="status">Loading usage…</p>
        ) : balance.isError ? (
          <div role="alert">
            <p>Usage is temporarily unavailable.</p>
            <button
              className="button button--secondary"
              onClick={() => void balance.refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          <CreditChart value={balance.data} />
        )
      }
    />
  );
}
interface DashboardProject {
  readonly id: string;
  readonly name: string;
  readonly lifecycleStatus: string;
  readonly updatedAt: string;
}
function CreditChart({
  value,
}: {
  readonly value: ReturnType<typeof creditBalanceV1Schema.parse>;
}) {
  const values = [
    {
      label: "Available",
      value: value.availableCreditUnits,
      tone: "available",
    },
    { label: "Reserved", value: value.reservedCreditUnits, tone: "reserved" },
    { label: "Used (lifetime)", value: value.settledCreditUnits, tone: "used" },
  ];
  const maximum = Math.max(1, ...values.map((entry) => entry.value));
  return (
    <figure className="dashboard-chart">
      <figcaption>Recorded credit balance</figcaption>
      <div className="dashboard-bars">
        {values.map((entry) => (
          <div className="dashboard-bar" key={entry.label}>
            <span>{entry.label}</span>
            <div className="dashboard-bar__track" aria-hidden="true">
              <span
                data-tone={entry.tone}
                style={{ width: String((entry.value / maximum) * 100) + "%" }}
              />
            </div>
            <strong>{entry.value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <p>
        Available credits exclude reservations. Used credits are historical
        settled usage.
      </p>
      <p>
        Organization totals · Updated{" "}
        <time dateTime={value.asOf}>
          {new Date(value.asOf).toLocaleDateString()}
        </time>
      </p>
    </figure>
  );
}
function DashboardView({
  root,
  canCreate,
  projects,
  projectState = "ready",
  retryProjects,
  usage,
}: {
  readonly root: string;
  readonly canCreate: boolean;
  readonly projects: readonly DashboardProject[];
  readonly projectState?: "loading" | "error" | "ready";
  readonly retryProjects?: () => void;
  readonly usage: React.ReactNode;
}) {
  const active = projects.filter(
    (project) => project.lifecycleStatus !== "archived",
  );
  const recent = [...active]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const states = [
    { label: "Active", count: active.length },
    { label: "Archived", count: projects.length - active.length },
  ];
  return (
    <RoutePage
      title="Dashboard"
      description="Pick up where you left off, or start with an idea."
      routeKey={"dashboard-" + root}
      actions={
        <button
          className="button button--secondary"
          onClick={restartWorkspaceTour}
        >
          <BookOpen aria-hidden="true" size={16} /> Workspace tour
        </button>
      }
    >
      <div className="dashboard">
        {canCreate ? <ProjectStartLinks root={root} /> : null}
        <div className="dashboard-grid">
          <section
            className="dashboard-panel dashboard-recent"
            aria-labelledby="dashboard-recent-title"
          >
            <header>
              <h2 id="dashboard-recent-title">Recent projects</h2>
              <AppLink to={root + "/projects"}>
                View all <ArrowRight aria-hidden="true" size={14} />
              </AppLink>
            </header>
            {projectState === "loading" ? (
              <p role="status">Loading recent projects…</p>
            ) : projectState === "error" ? (
              <div role="alert">
                <p>Recent projects are unavailable.</p>
                <button
                  className="button button--secondary"
                  onClick={retryProjects}
                >
                  Try again
                </button>
              </div>
            ) : recent.length === 0 ? (
              <div className="dashboard-empty">
                <FolderOpen aria-hidden="true" size={30} />
                <h3>Your next idea starts here</h3>
                <p>
                  {canCreate
                    ? "Describe your app with AI, begin with a template, or open a blank canvas."
                    : "Projects shared with you will appear here."}
                </p>
              </div>
            ) : (
              <ul className="dashboard-projects">
                {recent.map((project) => (
                  <li key={project.id}>
                    <AppLink
                      to={
                        root +
                        "/projects/" +
                        encodeRouteSelector(project.id) +
                        "/editor"
                      }
                    >
                      <span
                        className="dashboard-project-mark"
                        aria-hidden="true"
                      >
                        {project.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <strong>{project.name}</strong>
                        <small>
                          Updated{" "}
                          <time dateTime={project.updatedAt}>
                            {new Date(project.updatedAt).toLocaleDateString()}
                          </time>
                        </small>
                      </span>
                      <ArrowRight aria-hidden="true" size={17} />
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            className="dashboard-panel"
            aria-labelledby="dashboard-usage-title"
          >
            <header>
              <h2 id="dashboard-usage-title">AI usage</h2>
              <AppLink to={root + "/usage"}>
                Details <ArrowRight aria-hidden="true" size={14} />
              </AppLink>
            </header>
            {usage}
          </section>
          <section
            className="dashboard-panel"
            aria-labelledby="dashboard-project-activity"
          >
            <header>
              <h2 id="dashboard-project-activity">Project snapshot</h2>
            </header>
            {projectState !== "ready" ? (
              <p>Project counts will appear once the list is available.</p>
            ) : (
              <>
                <div className="dashboard-snapshot">
                  {states.map((state) => (
                    <div key={state.label}>
                      <strong>{state.count}</strong>
                      <span>{state.label}</span>
                      <div
                        aria-hidden="true"
                        style={{
                          width:
                            String(
                              (state.count / Math.max(1, projects.length)) *
                                100,
                            ) + "%",
                        }}
                      />
                    </div>
                  ))}
                </div>
                <p className="dashboard-caption">
                  From the latest {projects.length} projects. Saved revisions
                  remain in each project.
                </p>
              </>
            )}
          </section>
          <section
            className="dashboard-panel dashboard-guide"
            aria-labelledby="dashboard-guide-title"
          >
            <header>
              <h2 id="dashboard-guide-title">From idea to architecture</h2>
              <Sparkles aria-hidden="true" size={19} />
            </header>
            <ol>
              <li>
                <strong>Describe or design</strong>
                <span>Start with AI, a template, or your own services.</span>
              </li>
              <li>
                <strong>Connect and review</strong>
                <span>Configure each service and resolve design issues.</span>
              </li>
              <li>
                <strong>Save and export</strong>
                <span>Create a revision, then review the generated code.</span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </RoutePage>
  );
}
