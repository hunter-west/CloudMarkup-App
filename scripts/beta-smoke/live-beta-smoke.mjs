import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  assertLiveBetaAccessToken,
  comparableNotFoundEnvelope,
  formatLiveBetaSmokeFailure,
  LiveBetaApiStatusError,
  readLiveBetaSmokeConfig,
} from "./live-beta-smoke-core.mjs";

const requestTimeoutMilliseconds = 30_000;
const browserTimeoutMilliseconds = 60_000;
const maximumJsonResponseBytes = 512 * 1024;
const strongEtagPattern = /^"[A-Za-z0-9._:-]+"$/u;
const cognitoDomainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.auth\.us-east-1\.amazoncognito\.com$/u;

let activePhase = "configuration";

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseData(value) {
  requireCondition(
    isRecord(value) && value["apiVersion"] === "v1" && isRecord(value["data"]),
    "The API data response is invalid.",
  );
  return value["data"];
}

async function boundedJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  requireCondition(
    /^application\/json(?:;|$)/iu.test(contentType),
    "The live beta response is not JSON.",
  );
  const text = await response.text();
  requireCondition(
    Buffer.byteLength(text, "utf8") <= maximumJsonResponseBytes,
    "The live beta JSON response is too large.",
  );
  try {
    return JSON.parse(text);
  } catch {
    fail("The live beta JSON response is malformed.");
  }
}

async function apiRequest(config, options) {
  const url = new URL(options.path, `${config.baseUrl}/`);
  requireCondition(
    url.origin === config.baseUrl && url.pathname.startsWith("/api/"),
    "The live beta API request target is invalid.",
  );
  const headers = {
    accept: "application/json",
    ...(options.accessToken === undefined
      ? {}
      : { authorization: `Bearer ${options.accessToken}` }),
    ...(options.body === undefined
      ? {}
      : { "content-type": "application/json" }),
    ...options.headers,
  };
  let response;
  try {
    response = await fetch(url, {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      headers,
      method: options.method ?? "GET",
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    fail("The live beta API request failed.");
  }
  if (!options.expectedStatuses.includes(response.status)) {
    let errorBody;
    try {
      errorBody = await boundedJson(response);
    } catch {
      // Status remains useful while malformed or oversized response data stays hidden.
    }
    throw new LiveBetaApiStatusError(response.status, errorBody);
  }
  return {
    body: await boundedJson(response),
    etag: response.headers.get("etag"),
    status: response.status,
  };
}

async function readRuntimeConfig(config) {
  const response = await apiRequest(config, {
    expectedStatuses: [200],
    path: "/api/runtime-config",
  });
  const value = response.body;
  requireCondition(
    isRecord(value) &&
      value["schemaVersion"] === 1 &&
      isRecord(value["authentication"]),
    "The public runtime configuration is invalid.",
  );
  const authentication = value["authentication"];
  requireCondition(
    authentication["provider"] === "cognito" &&
      authentication["clientId"] === config.clientId &&
      Array.isArray(authentication["scopes"]) &&
      isDeepStrictEqual(authentication["scopes"], [
        "openid",
        "profile",
        "cloudmarkup-api/access",
      ]),
    "The public runtime authentication configuration is invalid.",
  );
  let domain;
  try {
    domain = new URL(authentication["domain"]);
  } catch {
    fail("The public Cognito domain is invalid.");
  }
  requireCondition(
    domain.protocol === "https:" &&
      cognitoDomainPattern.test(domain.hostname) &&
      domain.pathname === "/" &&
      domain.search === "" &&
      domain.hash === "" &&
      domain.username === "" &&
      domain.password === "",
    "The public Cognito domain is invalid.",
  );
  return { cognitoDomain: domain.origin };
}

async function signInWithCognito(
  browser,
  contexts,
  config,
  runtimeConfig,
  user,
) {
  const context = await browser.newContext({
    acceptDownloads: false,
    locale: "en-US",
    serviceWorkers: "block",
  });
  contexts.add(context);
  let popupPromise;
  let tokenResponsePromise;
  try {
    const page = await context.newPage();
    const navigation = await page.goto(`${config.baseUrl}/sign-in`, {
      timeout: browserTimeoutMilliseconds,
      waitUntil: "domcontentloaded",
    });
    requireCondition(
      navigation?.status() === 200,
      "The live beta sign-in page is unavailable.",
    );

    const expectedTokenUrl = `${config.baseUrl}/api/auth/session/v1/exchange`;
    tokenResponsePromise = context.waitForEvent("response", {
      predicate: (response) =>
        response.url() === expectedTokenUrl &&
        response.request().method() === "POST",
      timeout: browserTimeoutMilliseconds,
    });
    popupPromise = context.waitForEvent("page", {
      timeout: browserTimeoutMilliseconds,
    });
    await page
      .getByRole("button", { exact: true, name: "Sign in securely" })
      .click({ timeout: browserTimeoutMilliseconds });
    const popup = await popupPromise;
    await popup.waitForURL(
      (url) => url.origin === runtimeConfig.cognitoDomain,
      { timeout: browserTimeoutMilliseconds },
    );

    const usernameInput = popup
      .locator(
        'input[name="username"]:visible, input[id*="username" i]:visible, input[type="email"]:visible',
      )
      .first();
    const passwordInput = popup
      .locator('input[name="password"]:visible, input[type="password"]:visible')
      .first();
    await usernameInput.waitFor({
      state: "visible",
      timeout: browserTimeoutMilliseconds,
    });
    await usernameInput.fill(user.email);
    await passwordInput.fill(user.password);
    await popup
      .locator(
        'button[name="signInSubmitButton"]:visible, input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible',
      )
      .first()
      .click({ timeout: browserTimeoutMilliseconds });

    const tokenResponse = await tokenResponsePromise;
    requireCondition(
      tokenResponse.status() === 200,
      "The Cognito token exchange was rejected.",
    );
    const tokenEnvelope = await tokenResponse.json();
    requireCondition(
      isRecord(tokenEnvelope) &&
        tokenEnvelope["schemaVersion"] === 1 &&
        typeof tokenEnvelope["accessToken"] === "string",
      "The Cognito token response is invalid.",
    );
    const accessToken = tokenEnvelope["accessToken"];
    for (const key of Object.keys(tokenEnvelope)) {
      Reflect.deleteProperty(tokenEnvelope, key);
    }
    assertLiveBetaAccessToken(accessToken, config.clientId);
    const principal = await currentPrincipal(config, accessToken);
    const landingPath = `/organizations/${encodeURIComponent(principal.organizationId)}/projects`;
    await page.waitForURL(
      (url) => url.origin === config.baseUrl && url.pathname === landingPath,
      { timeout: browserTimeoutMilliseconds },
    );
    return { accessToken, context };
  } catch (error) {
    contexts.delete(context);
    await context.close().catch(() => undefined);
    await Promise.allSettled(
      [popupPromise, tokenResponsePromise].filter(
        (pendingPromise) => pendingPromise !== undefined,
      ),
    );
    throw error;
  }
}

async function closeSession(contexts, session, options = {}) {
  if (session === undefined) return;
  contexts.delete(session.context);
  await session.context.close().catch(() => undefined);
  if (options.keepToken !== true) session.accessToken = undefined;
}

function principalIdentity(response) {
  const principal = responseData(response.body);
  requireCondition(
    typeof principal["id"] === "string" &&
      Array.isArray(principal["organizationContexts"]) &&
      principal["organizationContexts"].length === 1 &&
      isRecord(principal["organizationContexts"][0]),
    "The current principal response is invalid.",
  );
  const context = principal["organizationContexts"][0];
  requireCondition(
    typeof context["organizationId"] === "string" &&
      context["role"] === "owner" &&
      context["isOwner"] === true &&
      Array.isArray(context["capabilities"]) &&
      context["capabilities"].includes("projects.create") &&
      context["capabilities"].includes("projects.delete"),
    "The current principal tenant context is invalid.",
  );
  return {
    organizationId: context["organizationId"],
    principalId: principal["id"],
  };
}

async function currentPrincipal(config, accessToken) {
  return principalIdentity(
    await apiRequest(config, {
      accessToken,
      expectedStatuses: [200],
      path: "/api/v1/me",
    }),
  );
}

function idempotencyKey(config, label) {
  return `beta-smoke-${config.runId}-${label}`;
}

async function createProject(config, accessToken, organizationId, label) {
  const request = {
    accessToken,
    body: {
      creationMode: "blank",
      description: "Disposable live beta isolation verification.",
      name: `Beta smoke ${config.runId} ${label.toUpperCase()}`,
    },
    expectedStatuses: [201],
    headers: { "idempotency-key": idempotencyKey(config, `${label}-create`) },
    method: "POST",
    path: `/api/v1/organizations/${encodeURIComponent(organizationId)}/projects`,
  };
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await apiRequest(config, request);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  requireCondition(response !== undefined, "The project was not created.");
  const created = responseData(response.body);
  requireCondition(
    isRecord(created["project"]) &&
      isRecord(created["draft"]) &&
      typeof created["project"]["id"] === "string" &&
      created["project"]["organizationId"] === organizationId &&
      created["project"]["lifecycleStatus"] === "active" &&
      typeof created["draft"]["id"] === "string" &&
      created["draft"]["id"] === created["project"]["currentDraft"]?.["id"],
    "The project creation response is invalid.",
  );
  return created["project"]["id"];
}

async function projectSnapshot(config, accessToken, projectId) {
  const projectResponse = await apiRequest(config, {
    accessToken,
    expectedStatuses: [200],
    path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
  });
  const draftResponse = await apiRequest(config, {
    accessToken,
    expectedStatuses: [200],
    path: `/api/v1/projects/${encodeURIComponent(projectId)}/draft`,
  });
  const project = responseData(projectResponse.body);
  const draft = responseData(draftResponse.body);
  requireCondition(
    project["id"] === projectId && project["lifecycleStatus"] === "active",
    "The persisted project identity is invalid.",
  );
  requireCondition(
    draft["projectId"] === projectId &&
      draft["id"] === project["currentDraft"]?.["id"] &&
      draft["version"] === project["currentDraft"]?.["version"],
    "The persisted draft reference is invalid.",
  );
  requireCondition(
    strongEtagPattern.test(projectResponse.etag),
    "The persisted project ETag is invalid.",
  );
  requireCondition(
    strongEtagPattern.test(draftResponse.etag),
    "The persisted draft ETag is invalid.",
  );
  return {
    draft,
    draftEtag: draftResponse.etag,
    project,
    projectEtag: projectResponse.etag,
  };
}

function inventedProjectId(config) {
  const suffix = createHash("sha256")
    .update(`absent\u0000${config.runId}`, "utf8")
    .digest("hex")
    .slice(0, 24);
  return `project_beta_absent-${suffix}`;
}

async function assertIndistinguishableNotFound(
  config,
  accessToken,
  crossTenantProjectId,
) {
  const crossTenant = await apiRequest(config, {
    accessToken,
    expectedStatuses: [404],
    path: `/api/v1/projects/${encodeURIComponent(crossTenantProjectId)}`,
  });
  const invented = await apiRequest(config, {
    accessToken,
    expectedStatuses: [404],
    path: `/api/v1/projects/${inventedProjectId(config)}`,
  });
  requireCondition(
    isDeepStrictEqual(
      comparableNotFoundEnvelope(crossTenant.body),
      comparableNotFoundEnvelope(invented.body),
    ),
    "Cross-tenant and invented project responses are distinguishable.",
  );
}

async function tombstoneProject(config, target) {
  let lastDeleteError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await apiRequest(config, {
      accessToken: target.accessToken,
      expectedStatuses: [200, 404],
      path: `/api/v1/projects/${encodeURIComponent(target.projectId)}`,
    });
    if (current.status === 404) return;
    const project = responseData(current.body);
    if (
      project["lifecycleStatus"] === "deletion-pending" ||
      project["lifecycleStatus"] === "deleted"
    ) {
      return;
    }
    requireCondition(
      strongEtagPattern.test(current.etag),
      "The project cleanup ETag is invalid.",
    );
    try {
      const deleted = await apiRequest(config, {
        accessToken: target.accessToken,
        expectedStatuses: [200],
        headers: {
          "idempotency-key": target.idempotencyKey,
          "if-match": current.etag,
        },
        method: "DELETE",
        path: `/api/v1/projects/${encodeURIComponent(target.projectId)}`,
      });
      requireCondition(
        responseData(deleted.body)["lifecycleStatus"] === "deletion-pending",
        "The project cleanup did not create a tombstone.",
      );
      return;
    } catch (error) {
      // One readback retry resolves an ambiguous network result safely.
      lastDeleteError = error;
    }
  }
  if (lastDeleteError !== undefined) throw lastDeleteError;
  fail("The project cleanup could not be verified.");
}

async function run() {
  const config = readLiveBetaSmokeConfig(process.env);
  activePhase = "browser startup";
  delete process.env["DEBUG"];
  delete process.env["PWDEBUG"];
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ env: {}, headless: true });
  const contexts = new Set();
  const cleanupTargets = [];
  let scenarioError;
  let scenarioFailurePhase;

  try {
    activePhase = "runtime configuration";
    const runtimeConfig = await readRuntimeConfig(config);

    activePhase = "unauthenticated API boundary";
    const unauthenticated = await apiRequest(config, {
      expectedStatuses: [401],
      path: "/api/v1/me",
    });
    requireCondition(
      isRecord(unauthenticated.body) &&
        isRecord(unauthenticated.body["error"]) &&
        unauthenticated.body["error"]["code"] === "authentication_required",
      "The unauthenticated principal response is invalid.",
    );

    activePhase = "first user authentication and persistence";
    const firstSession = await signInWithCognito(
      browser,
      contexts,
      config,
      runtimeConfig,
      config.users.a,
    );
    const firstPrincipal = await currentPrincipal(
      config,
      firstSession.accessToken,
    );
    const firstProjectId = await createProject(
      config,
      firstSession.accessToken,
      firstPrincipal.organizationId,
      "a",
    );
    const firstCleanup = {
      accessToken: firstSession.accessToken,
      idempotencyKey: idempotencyKey(config, "a-delete"),
      projectId: firstProjectId,
    };
    cleanupTargets.push(firstCleanup);
    const firstSnapshot = await projectSnapshot(
      config,
      firstSession.accessToken,
      firstProjectId,
    );
    await closeSession(contexts, firstSession, { keepToken: true });

    activePhase = "second user authentication and isolation";
    const secondSession = await signInWithCognito(
      browser,
      contexts,
      config,
      runtimeConfig,
      config.users.b,
    );
    const secondPrincipal = await currentPrincipal(
      config,
      secondSession.accessToken,
    );
    requireCondition(
      secondPrincipal.principalId !== firstPrincipal.principalId &&
        secondPrincipal.organizationId !== firstPrincipal.organizationId,
      "The two beta users did not receive distinct tenant identities.",
    );
    const secondProjectId = await createProject(
      config,
      secondSession.accessToken,
      secondPrincipal.organizationId,
      "b",
    );
    const secondCleanup = {
      accessToken: secondSession.accessToken,
      idempotencyKey: idempotencyKey(config, "b-delete"),
      projectId: secondProjectId,
    };
    cleanupTargets.push(secondCleanup);
    await projectSnapshot(config, secondSession.accessToken, secondProjectId);
    await assertIndistinguishableNotFound(
      config,
      secondSession.accessToken,
      firstProjectId,
    );

    activePhase = "first user reauthentication and isolation";
    const reauthenticatedFirstSession = await signInWithCognito(
      browser,
      contexts,
      config,
      runtimeConfig,
      config.users.a,
    );
    const reauthenticatedFirstPrincipal = await currentPrincipal(
      config,
      reauthenticatedFirstSession.accessToken,
    );
    requireCondition(
      isDeepStrictEqual(reauthenticatedFirstPrincipal, firstPrincipal),
      "The first beta principal changed after reauthentication.",
    );
    const persistedSnapshot = await projectSnapshot(
      config,
      reauthenticatedFirstSession.accessToken,
      firstProjectId,
    );
    requireCondition(
      isDeepStrictEqual(persistedSnapshot, firstSnapshot),
      "The project or draft changed across reauthentication.",
    );
    await assertIndistinguishableNotFound(
      config,
      reauthenticatedFirstSession.accessToken,
      secondProjectId,
    );
    firstCleanup.accessToken = reauthenticatedFirstSession.accessToken;
  } catch (error) {
    scenarioError = error;
    scenarioFailurePhase = activePhase;
  }

  activePhase = "project tombstone cleanup";
  let cleanupError;
  for (const target of cleanupTargets) {
    try {
      await tombstoneProject(config, target);
    } catch (error) {
      cleanupError ??= error;
    } finally {
      target.accessToken = undefined;
    }
  }
  for (const context of contexts) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  await browser.close().catch(() => undefined);

  if (scenarioError !== undefined) {
    activePhase = scenarioFailurePhase;
    throw scenarioError;
  }
  if (cleanupError !== undefined) throw cleanupError;
}

try {
  await run();
  console.log(
    "Live beta authentication, persistence, isolation, and cleanup passed.",
  );
} catch (error) {
  console.error(formatLiveBetaSmokeFailure(activePhase, error));
  process.exitCode = 1;
}
