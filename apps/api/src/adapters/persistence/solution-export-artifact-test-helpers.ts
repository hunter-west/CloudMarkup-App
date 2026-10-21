import { generateSolutionExport } from "@cloudmarkup/solution-export";
import { projectGoCompilationResultToSolutionExportInfrastructure } from "@cloudmarkup/solution-export-workflow";
import {
  TEST_RENDERER,
  TEST_TARGET_SETTINGS,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";

import { permissionsForRole } from "../../application/authorization.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type { PrincipalContext } from "../../application/ports.js";

export function retainedArtifactFixture() {
  const fixture = workflowFixture("infrastructure-only");
  const result = generateSolutionExport({
    architectureDocument: fixture.generationRequest.architectureDocument,
    contractVersion: 1,
    existingFiles: [],
    infrastructure: projectGoCompilationResultToSolutionExportInfrastructure(
      fixture.compilation,
    ),
    solutionRevision: fixture.generationRequest.solutionRevision,
    supplementalFiles: [],
    target: {
      exportName: "Synthetic retained export",
      limits: TEST_TARGET_SETTINGS.limits,
      policyPacks: TEST_TARGET_SETTINGS.policyPacks,
      renderer: TEST_RENDERER,
      target: TEST_TARGET_SETTINGS.target,
    },
  });
  if (result.state !== "ready")
    throw new Error("Synthetic export fixture was blocked.");
  return result.artifact;
}

export function exportPrincipal(): PrincipalContext {
  return {
    authenticatedAt: new Date().toISOString(),
    authenticationSource: "cognito",
    correlationId: "correlation.retained-export",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    principalId: "principal.export-owner",
    sessionId: "session.retained-export",
  };
}

export function exportScope(
  actor = exportPrincipal(),
): AuthorizedOrganizationScope {
  return {
    capabilities: permissionsForRole("owner"),
    correlationId: actor.correlationId,
    membershipId: "membership.export-owner",
    organizationId: "organization.export",
    principalId: actor.principalId,
    roleKey: "owner",
    sessionId: actor.sessionId,
  };
}
