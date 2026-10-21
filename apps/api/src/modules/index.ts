import type { Hono } from "hono";

import type {
  CloudMarkupApplication,
  ReadinessProbe,
} from "../application/ports.js";
import type { ContinuousConformanceApplication } from "../application/continuous-conformance.js";
import type { GitHubRepositoryExportApplication } from "../application/github-exports.js";
import type { GitHubRepositoryImportApplication } from "../application/github-imports.js";
import type { SolutionExportApplication } from "../application/solution-exports.js";
import type { SolutionExportReadApplication } from "../application/solution-export-reads.js";
import type { ApiEnvironment } from "../transport/http.js";
import { registerArtifactRoutes } from "./artifacts.js";
import { registerAuditRoutes } from "./audit.js";
import { registerCommercialRoutes } from "./commercial.js";
import { registerContinuousConformanceRoutes } from "./continuous-conformance.js";
import { registerIdentityRoutes } from "./identity.js";
import { registerIntegrationRoutes } from "./integrations.js";
import { registerGitHubExportRoutes } from "./github-exports.js";
import type { GitHubInstallationCallbackConfiguration } from "./github-installation-callback.js";
import { registerGitHubImportRoutes } from "./github-imports.js";
import { registerJobRoutes } from "./jobs.js";
import { registerOperationalRoutes } from "./operational.js";
import { registerOrganizationRoutes } from "./organizations.js";
import { registerProjectRoutes } from "./projects.js";
import { registerRevisionRoutes } from "./revisions.js";
import { registerSolutionRevisionRoutes } from "./solution-revisions.js";
import { registerSolutionExportRoutes } from "./solution-exports.js";
import { registerValidationRoutes } from "./validation.js";

export function registerModules(
  app: Hono<ApiEnvironment>,
  application: CloudMarkupApplication,
  solutionExports: SolutionExportApplication,
  githubExports: GitHubRepositoryExportApplication,
  githubImports: GitHubRepositoryImportApplication,
  readiness: ReadinessProbe,
  continuousConformance: ContinuousConformanceApplication,
  githubInstallationCallback?: GitHubInstallationCallbackConfiguration,
  solutionExportReads?: SolutionExportReadApplication,
  solutionExportCredits?: Parameters<typeof registerSolutionExportRoutes>[3],
): void {
  registerOperationalRoutes(app, readiness);
  registerIdentityRoutes(app, application);
  registerOrganizationRoutes(app, application);
  registerCommercialRoutes(app, application);
  registerProjectRoutes(app, application);
  registerRevisionRoutes(app, application);
  registerSolutionRevisionRoutes(app, application);
  registerSolutionExportRoutes(
    app,
    solutionExports,
    solutionExportReads,
    solutionExportCredits,
  );
  registerGitHubExportRoutes(app, githubExports, githubInstallationCallback);
  registerGitHubImportRoutes(app, githubImports);
  registerContinuousConformanceRoutes(app, continuousConformance);
  registerValidationRoutes(app, application);
  registerJobRoutes(app, application);
  registerArtifactRoutes(app, application);
  registerIntegrationRoutes(app, application);
  registerAuditRoutes(app, application);
}
