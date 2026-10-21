import {
  githubInstallationLinkIntentV1Schema,
  type GithubInstallationLinkIntentV1,
} from "@cloudmarkup/api-contract";
import {
  GitHubExportError,
  gitHubInstallationLinkStateSchema,
} from "@cloudmarkup/github-repository-export";
import type { Hono } from "hono";
import { z } from "zod";

import type { GitHubInstallationLinkAdapter } from "../adapters/github-installation-link.js";
import { ApplicationError } from "../application/errors.js";
import { requireRecentAuthentication } from "../application/identity.js";
import {
  parseQuery,
  type ApiContext,
  type ApiEnvironment,
} from "../transport/http.js";

export interface GitHubInstallationCallbackConfiguration {
  readonly adapter: GitHubInstallationLinkAdapter;
  readonly publicOrigin: string;
  readonly clock?: () => Date;
}

const cookieName = "__Host-cloudmarkup-github-link";
const setupQuerySchema = z
  .object({
    installation_id: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    setup_action: z.literal("install"),
    state: gitHubInstallationLinkStateSchema,
  })
  .strict();
const authorizationQuerySchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    state: gitHubInstallationLinkStateSchema,
  })
  .strict();

function setCookie(context: ApiContext, value: string, maxAge: number): void {
  context.header(
    "Set-Cookie",
    `${cookieName}=${value}; Max-Age=${String(maxAge)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  );
}

function cookie(context: ApiContext): string {
  const matches = (context.req.header("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`));
  if (matches.length !== 1)
    throw new GitHubExportError("installation-link-invalid");
  return (matches[0] ?? "").slice(cookieName.length + 1);
}

export function requireGitHubBrowserOrigin(
  context: ApiContext,
  configuration: GitHubInstallationCallbackConfiguration,
): void {
  const origin = new URL(configuration.publicOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== configuration.publicOrigin
  )
    throw new ApplicationError(
      "service_unavailable",
      "GitHub browser linking is unavailable.",
    );
  if (
    context.req.header("origin") !== configuration.publicOrigin ||
    (context.req.header("sec-fetch-site") !== undefined &&
      context.req.header("sec-fetch-site") !== "same-origin")
  )
    throw new ApplicationError(
      "access_denied",
      "This GitHub connection request could not be verified.",
    );
  requireRecentAuthentication(
    context.get("principal"),
    (configuration.clock ?? (() => new Date()))(),
  );
}

function returnPath(
  context: ApiContext,
  configuration: GitHubInstallationCallbackConfiguration,
  organizationId: string,
): string {
  const root = `/organizations/${encodeURIComponent(organizationId)}`;
  const fallback = `${root}/settings/integrations`;
  const referrer = context.req.header("referer");
  if (referrer === undefined) return fallback;
  try {
    const parsed = new URL(referrer);
    const tail = parsed.pathname.slice(root.length);
    if (
      parsed.origin === configuration.publicOrigin &&
      parsed.pathname.startsWith(`${root}/`) &&
      parsed.search === "" &&
      parsed.hash === "" &&
      (tail === "/settings/integrations" ||
        /^\/projects\/[A-Za-z0-9_-]+\/artifacts\/[A-Za-z0-9_-]+\/export\/github$/.test(
          tail,
        ))
    )
      return parsed.pathname;
  } catch {
    /* A referrer never proves authority or selects an arbitrary redirect. */
  }
  return fallback;
}

export async function bindGitHubBrowserSession(
  context: ApiContext,
  configuration: GitHubInstallationCallbackConfiguration,
  organizationId: string,
  intent: GithubInstallationLinkIntentV1,
): Promise<void> {
  const parsed = githubInstallationLinkIntentV1Schema.safeParse(intent);
  if (!parsed.success)
    throw new ApplicationError(
      "service_unavailable",
      "GitHub browser linking is unavailable.",
    );
  const principal = context.get("principal");
  const result = await configuration.adapter.createBrowserSession({
    expiresAt: intent.expiresAt,
    intentId: intent.intentId,
    organizationId,
    principalId: principal.principalId,
    returnPath: returnPath(context, configuration, organizationId),
    sessionId: principal.sessionId,
    state: new URL(intent.installationUrl).searchParams.get("state") ?? "",
  });
  if (result.installationUrl !== intent.installationUrl)
    throw new ApplicationError(
      "service_unavailable",
      "GitHub browser linking is unavailable.",
    );
  const now = (configuration.clock ?? (() => new Date()))();
  setCookie(
    context,
    result.cookie,
    Math.min(
      600,
      Math.max(
        0,
        Math.floor((Date.parse(intent.expiresAt) - now.getTime()) / 1_000),
      ),
    ),
  );
}

function callbackFailure(context: ApiContext, error: unknown): Response {
  setCookie(context, "", 0);
  const retryable = error instanceof GitHubExportError && error.transient;
  return context.json(
    {
      status: retryable ? "github-unavailable" : "github-link-invalid",
      message:
        "The GitHub connection could not be verified. Return to Cloud Markup and start a new connection.",
    },
    retryable ? 503 : 400,
  );
}

export function registerGitHubInstallationCallbackRoutes(
  app: Hono<ApiEnvironment>,
  configuration: GitHubInstallationCallbackConfiguration | undefined,
): void {
  app.get("/github/setup", async (context) => {
    if (configuration === undefined)
      return context.json({ status: "github-disabled" }, 503);
    try {
      const query = parseQuery(context, setupQuerySchema);
      const result = await configuration.adapter.continueInstallationSetup({
        cookie: cookie(context),
        installationId: query.installation_id,
        setupAction: query.setup_action,
        state: query.state,
      });
      setCookie(context, result.cookie, 600);
      return context.redirect(result.authorizationUrl, 303);
    } catch (error) {
      return callbackFailure(context, error);
    }
  });
  app.get("/github/callback", async (context) => {
    if (configuration === undefined)
      return context.json({ status: "github-disabled" }, 503);
    try {
      const query = parseQuery(context, authorizationQuerySchema);
      const result = await configuration.adapter.completeAuthorization({
        cookie: cookie(context),
        code: query.code,
        state: query.state,
      });
      const destination = new URL(
        result.returnPath,
        configuration.publicOrigin,
      );
      if (destination.origin !== configuration.publicOrigin)
        throw new GitHubExportError("installation-link-invalid");
      destination.hash = new URLSearchParams({
        github_link_intent: result.intentId,
        github_link_receipt: result.callbackReceipt,
      }).toString();
      setCookie(context, "", 0);
      return context.redirect(destination.href, 303);
    } catch (error) {
      return callbackFailure(context, error);
    }
  });
}
