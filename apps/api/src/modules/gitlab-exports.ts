import type { Hono } from "hono";
import {
  createGitlabExportReviewV1Schema,
  advanceGitlabExportV1Schema,
  gitlabExportCollectionPathV1Schema,
  gitlabExportPathV1Schema,
  gitlabExportV1Schema,
  gitlabExportPreviewV1Schema,
  gitlabExportResponseV1Schema,
  gitlabExportPreviewResponseV1Schema,
  type GitlabExportV1,
} from "@cloudmarkup/api-contract";
import type { GitLabExportsApplication } from "../application/gitlab-export-application.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiContext,
  type ApiEnvironment,
  parsePath,
  parseJsonBody,
  dataEnvelope,
  validatedJsonResponse,
} from "../transport/http.js";

export interface GitLabExportsConfiguration {
  readonly application: GitLabExportsApplication;
  readonly publicOrigin: string;
}
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "GitLab export is temporarily unavailable.",
  );
}
export function registerGitLabExportRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: GitLabExportsConfiguration,
): void {
  if (configuration) {
    const origin = new URL(configuration.publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password
    )
      throw new TypeError("GitLab export requires an exact HTTPS origin.");
  }
  const service = (
    context: ApiContext,
    mutation: boolean,
  ): GitLabExportsApplication => {
    if (!configuration) return unavailable();
    if ([...new URL(context.req.url).searchParams.keys()].length !== 0)
      throw new ApplicationError(
        "invalid_request",
        "The GitLab export request is invalid.",
      );
    const site = context.req.header("sec-fetch-site");
    if (
      mutation &&
      (context.req.header("origin") !== configuration.publicOrigin ||
        (site !== undefined && site !== "same-origin"))
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
    context.header("Cache-Control", "no-store");
    return configuration.application;
  };
  const bound = (
    context: ApiContext,
    projectId: string,
    value: GitlabExportV1,
    reviewId?: string,
  ) => {
    const parsed = gitlabExportV1Schema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.projectId !== projectId ||
      parsed.data.principalId !== context.get("principal").principalId ||
      (reviewId !== undefined && parsed.data.reviewId !== reviewId)
    )
      return unavailable();
    return parsed.data;
  };
  const root = "/v1/projects/:projectId/gitlab-exports";
  app.post(root, async (context) => {
    const application = service(context, true),
      path = parsePath(context, gitlabExportCollectionPathV1Schema);
    const input = await parseJsonBody(
      context,
      createGitlabExportReviewV1Schema,
    );
    const parsed = gitlabExportPreviewV1Schema.safeParse(
      await application.preview(
        context.get("principal"),
        path.projectId,
        input,
      ),
    );
    if (!parsed.success) return unavailable();
    const value = bound(context, path.projectId, parsed.data.export);
    if (
      value.connectionId !== input.connectionId ||
      value.providerProjectId !== input.providerProjectId ||
      value.selectionVersion !== input.selectionVersion ||
      value.artifactId !== input.artifactId ||
      value.destinationFolder !== input.destinationFolder
    )
      return unavailable();
    return validatedJsonResponse(
      gitlabExportPreviewResponseV1Schema,
      dataEnvelope(parsed.data),
      201,
    );
  });
  app.get(root + "/:reviewId", async (context) => {
    const application = service(context, false),
      path = parsePath(context, gitlabExportPathV1Schema);
    const value = bound(
      context,
      path.projectId,
      await application.get(
        context.get("principal"),
        path.projectId,
        path.reviewId,
      ),
      path.reviewId,
    );
    return validatedJsonResponse(
      gitlabExportResponseV1Schema,
      dataEnvelope(value),
      200,
    );
  });
  app.post(root + "/:reviewId/advance", async (context) => {
    const application = service(context, true),
      path = parsePath(context, gitlabExportPathV1Schema);
    const input = await parseJsonBody(context, advanceGitlabExportV1Schema);
    const value = bound(
      context,
      path.projectId,
      await application.advance(
        context.get("principal"),
        path.projectId,
        path.reviewId,
        input,
      ),
      path.reviewId,
    );
    if (
      value.approvalDigest !== input.approvalDigest ||
      value.recordVersion < input.expectedVersion ||
      value.recordVersion > input.expectedVersion + 1
    )
      return unavailable();
    return validatedJsonResponse(
      gitlabExportResponseV1Schema,
      dataEnvelope(value),
      200,
    );
  });
}
