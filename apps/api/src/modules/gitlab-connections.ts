import {
  gitlabProjectDiscoveryQueryV1Schema,
  gitlabProjectDiscoveryResponseV1Schema,
  gitlabProjectDiscoveryV1Schema,
  gitlabProjectSelectionV1Schema,
  gitlabProjectSelectionListQueryV1Schema,
  gitlabProjectSelectionListResponseV1Schema,
  gitlabProjectSelectionPathV1Schema,
  gitlabProjectSelectionResponseV1Schema,
  updateGitlabProjectSelectionV1Schema,
} from "@cloudmarkup/api-contract";
import type { GitLabProjectsApplication } from "../application/gitlab-projects.js";
import type { Hono } from "hono";
import {
  completeGitlabLinkV1Schema,
  createGitlabLinkIntentV1Schema,
  disconnectGitlabConnectionV1Schema,
  gitlabConnectionCollectionPathV1Schema,
  gitlabConnectionPathV1Schema,
  gitlabConnectionListQueryV1Schema,
  gitlabConnectionV1Schema,
  gitlabConnectionResponseV1Schema,
  gitlabConnectionListResponseV1Schema,
  gitlabLinkIntentResponseV1Schema,
  gitlabLinkIntentV1Schema,
  type GitlabConnectionV1,
} from "@cloudmarkup/api-contract";
import type { GitLabConnectionsApplication } from "../application/gitlab-connections.js";
import { ApplicationError } from "../application/errors.js";
import {
  type ApiContext,
  type ApiEnvironment,
  dataEnvelope,
  listEnvelope,
  parseJsonBody,
  parsePath,
  parseQuery,
  validatedJsonResponse,
} from "../transport/http.js";

export interface GitLabConnectionsConfiguration {
  readonly application: GitLabConnectionsApplication;
  readonly projects?: GitLabProjectsApplication;
  readonly publicOrigin: string;
  readonly clock?: () => Date;
}
const cookieName = "__Host-cloudmarkup-gitlab-link";
const cookiePattern = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
function invalid(): never {
  throw new ApplicationError(
    "invalid_request",
    "The GitLab connection request is invalid.",
  );
}
function unavailable(): never {
  throw new ApplicationError(
    "service_unavailable",
    "GitLab connections are temporarily unavailable.",
  );
}
function setCookie(context: ApiContext, value: string, maxAge: number): void {
  context.header(
    "Set-Cookie",
    `${cookieName}=${value}; Max-Age=${String(maxAge)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
}
function getCookie(context: ApiContext): string {
  const matches = (context.req.header("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(cookieName + "="));
  const value = matches[0]?.slice(cookieName.length + 1) ?? "";
  if (matches.length !== 1 || value.length > 4096 || !cookiePattern.test(value))
    invalid();
  return value;
}
export function registerGitLabConnectionRoutes(
  app: Hono<ApiEnvironment>,
  configuration?: GitLabConnectionsConfiguration,
): void {
  if (configuration) {
    const origin = new URL(configuration.publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== configuration.publicOrigin ||
      origin.username ||
      origin.password
    )
      throw new TypeError("GitLab connections require an exact HTTPS origin.");
  }
  function service(): GitLabConnectionsApplication {
    if (!configuration) return unavailable();
    return configuration.application;
  }
  function query(context: ApiContext, allowed: readonly string[] = []): void {
    const parameters = new URL(context.req.url).searchParams;
    if (
      [...parameters.keys()].some(
        (key) => !allowed.includes(key) || parameters.getAll(key).length !== 1,
      )
    )
      invalid();
  }
  function mutation(context: ApiContext): GitLabConnectionsApplication {
    const application = service();
    query(context);
    const site = context.req.header("sec-fetch-site");
    if (
      context.req.header("origin") !== configuration?.publicOrigin ||
      (site !== undefined && site !== "same-origin")
    )
      throw new ApplicationError(
        "access_denied",
        "The request must come from this application.",
      );
    return application;
  }
  function bound(
    context: ApiContext,
    organizationId: string,
    value: GitlabConnectionV1,
  ): GitlabConnectionV1 {
    const result = gitlabConnectionV1Schema.safeParse(value);
    if (
      !result.success ||
      result.data.organizationId !== organizationId ||
      result.data.principalId !== context.get("principal").principalId
    )
      return unavailable();
    return result.data;
  }
  const root = "/v1/organizations/:organizationId/gitlab-connections";
  app.post(root + "/link-intents", async (context) => {
    const application = mutation(context),
      path = parsePath(context, gitlabConnectionCollectionPathV1Schema);
    await parseJsonBody(context, createGitlabLinkIntentV1Schema);
    const result = await application.start(
      context.get("principal"),
      path.organizationId,
    );
    const intent = gitlabLinkIntentV1Schema.safeParse(result.intent);
    if (
      !intent.success ||
      typeof result.cookie !== "string" ||
      result.cookie.length > 4096 ||
      !cookiePattern.test(result.cookie)
    )
      return unavailable();
    if (
      new URL(intent.data.authorizationUrl).searchParams.get("redirect_uri") !==
      (configuration?.publicOrigin ?? "") + "/account/gitlab/callback"
    )
      return unavailable();
    const maxAge = Math.min(
      600,
      Math.floor(
        (Date.parse(intent.data.expiresAt) -
          (configuration?.clock ?? (() => new Date()))().getTime()) /
          1000,
      ),
    );
    if (maxAge <= 0) return unavailable();
    context.res = validatedJsonResponse(
      gitlabLinkIntentResponseV1Schema,
      dataEnvelope(intent.data),
      201,
    );
    setCookie(context, result.cookie, maxAge);
    return context.res;
  });
  app.post(root + "/link-completions", async (context) => {
    const application = mutation(context),
      path = parsePath(context, gitlabConnectionCollectionPathV1Schema);
    const input = await parseJsonBody(context, completeGitlabLinkV1Schema);
    const result = await application.complete(
      context.get("principal"),
      path.organizationId,
      input,
      getCookie(context),
    );
    context.res = validatedJsonResponse(
      gitlabConnectionResponseV1Schema,
      dataEnvelope(bound(context, path.organizationId, result)),
      200,
    );
    setCookie(context, "", 0);
    return context.res;
  });
  app.get(root, async (context) => {
    const application = service();
    query(context, ["limit", "cursor"]);
    const path = parsePath(context, gitlabConnectionCollectionPathV1Schema),
      options = parseQuery(context, gitlabConnectionListQueryV1Schema);
    const result = await application.list(
      context.get("principal"),
      path.organizationId,
      options.limit,
      options.cursor,
    );
    return validatedJsonResponse(
      gitlabConnectionListResponseV1Schema,
      listEnvelope(
        result.items.map((value) => bound(context, path.organizationId, value)),
        result.nextCursor,
      ),
      200,
    );
  });
  app.get(root + "/:connectionId", async (context) => {
    const application = service();
    query(context);
    const path = parsePath(context, gitlabConnectionPathV1Schema);
    const result = await application.get(
      context.get("principal"),
      path.organizationId,
      path.connectionId,
    );
    if (result.id !== path.connectionId) return unavailable();
    return validatedJsonResponse(
      gitlabConnectionResponseV1Schema,
      dataEnvelope(bound(context, path.organizationId, result)),
      200,
    );
  });

  function projectService(): GitLabProjectsApplication {
    service();
    if (!configuration?.projects) return unavailable();
    return configuration.projects;
  }
  function projectBinding(
    context: ApiContext,
    path: { organizationId: string; connectionId: string },
    value: {
      organizationId: string;
      principalId: string;
      connectionId: string;
    },
  ) {
    if (
      value.organizationId !== path.organizationId ||
      value.connectionId !== path.connectionId ||
      value.principalId !== context.get("principal").principalId
    )
      unavailable();
  }
  app.get(root + "/:connectionId/projects", async (context) => {
    const application = projectService();
    query(context, ["page"]);
    const path = parsePath(context, gitlabConnectionPathV1Schema),
      options = parseQuery(context, gitlabProjectDiscoveryQueryV1Schema);
    const result = gitlabProjectDiscoveryV1Schema.safeParse(
      await application.discover(
        context.get("principal"),
        path.organizationId,
        path.connectionId,
        options.page,
      ),
    );
    if (
      !result.success ||
      (result.data.nextPage !== null &&
        result.data.nextPage !== options.page + 1)
    )
      return unavailable();
    projectBinding(context, path, result.data);
    return validatedJsonResponse(
      gitlabProjectDiscoveryResponseV1Schema,
      dataEnvelope(result.data),
      200,
    );
  });
  app.get(root + "/:connectionId/project-selections", async (context) => {
    const application = projectService();
    query(context, ["limit", "cursor"]);
    const path = parsePath(context, gitlabConnectionPathV1Schema),
      options = parseQuery(context, gitlabProjectSelectionListQueryV1Schema);
    const result = await application.selections(
      context.get("principal"),
      path.organizationId,
      path.connectionId,
      options.limit,
      options.cursor,
    );
    const items = result.items.map((value) => {
      const parsed = gitlabProjectSelectionV1Schema.safeParse(value);
      if (!parsed.success) return unavailable();
      projectBinding(context, path, parsed.data);
      return parsed.data;
    });
    if (
      items.length > options.limit ||
      items.some(
        (item, index) =>
          item.projectId <=
          (items[index - 1]?.projectId ?? Number(options.cursor ?? 0)),
      ) ||
      (result.nextCursor !== undefined &&
        result.nextCursor !== String(items.at(-1)?.projectId))
    )
      return unavailable();
    return validatedJsonResponse(
      gitlabProjectSelectionListResponseV1Schema,
      listEnvelope(items, result.nextCursor),
      200,
    );
  });
  app.post(
    root + "/:connectionId/project-selections/:projectId",
    async (context) => {
      mutation(context);
      const application = projectService(),
        path = parsePath(context, gitlabProjectSelectionPathV1Schema);
      const input = await parseJsonBody(
        context,
        updateGitlabProjectSelectionV1Schema,
      );
      const parsed = gitlabProjectSelectionV1Schema.safeParse(
        await application.update(
          context.get("principal"),
          path.organizationId,
          path.connectionId,
          Number(path.projectId),
          input,
        ),
      );
      if (
        !parsed.success ||
        parsed.data.projectId !== Number(path.projectId) ||
        parsed.data.version !== input.expectedVersion + 1 ||
        parsed.data.enabled !== input.enabled
      )
        return unavailable();
      projectBinding(context, path, parsed.data);
      return validatedJsonResponse(
        gitlabProjectSelectionResponseV1Schema,
        dataEnvelope(parsed.data),
        200,
      );
    },
  );
  app.post(root + "/:connectionId/disconnect", async (context) => {
    const application = mutation(context),
      path = parsePath(context, gitlabConnectionPathV1Schema);
    await parseJsonBody(context, disconnectGitlabConnectionV1Schema);
    const result = await application.disconnect(
      context.get("principal"),
      path.organizationId,
      path.connectionId,
    );
    if (result.id !== path.connectionId) return unavailable();
    return validatedJsonResponse(
      gitlabConnectionResponseV1Schema,
      dataEnvelope(bound(context, path.organizationId, result)),
      200,
    );
  });
}
