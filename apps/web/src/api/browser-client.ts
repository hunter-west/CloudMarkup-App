import {
  resolveAccessTokenAuthorization,
  type BrowserAccessTokenSupplier,
} from "./access-token-authorization.js";

import {
  createCloudMarkupClient,
  createFetchTransport,
  type ApiTransport,
  type CloudMarkupClient,
  type FetchLike,
} from "@cloudmarkup/api-contract";

const localTokenPattern = /^[A-Za-z0-9._:-]{1,128}$/;

export interface BrowserClientConfiguration {
  readonly accessToken?: BrowserAccessTokenSupplier;
  readonly apiBaseUrl?: string;
  readonly development: boolean;
  readonly fetchImplementation: FetchLike;
  readonly localDevelopmentToken?: string;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  if (normalized.length > 2_048 || /[\r\n]/u.test(normalized)) {
    throw new TypeError("The CloudMarkup API base URL is invalid.");
  }
  return normalized.replace(/\/$/u, "");
}

function environmentString(name: string): string | undefined {
  const environment: unknown = import.meta.env;
  if (typeof environment !== "object" || environment === null) {
    return undefined;
  }
  const value = (environment as Readonly<Record<string, unknown>>)[name];
  return typeof value === "string" ? value : undefined;
}

function localAuthorization(
  development: boolean,
  token: string | undefined,
): string | undefined {
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  if (!development || !localTokenPattern.test(token)) {
    throw new TypeError(
      "The local-development identity token is unavailable in this runtime.",
    );
  }
  return `Bearer local-development:${token}`;
}

/**
 * Creates a browser client when an API base URL is configured. An unconfigured
 * development preview stays on the explicit synthetic boundary; production
 * fails closed instead of silently presenting synthetic data. The optional
 * local token is held in the runtime closure only: it is never placed in Query
 * keys, localStorage, IndexedDB, request bodies, or draft content.
 */
export function createBrowserCloudMarkupClient(
  configuration: BrowserClientConfiguration,
): CloudMarkupClient | undefined {
  return createBrowserCloudMarkupClientCore(
    configuration,
    localAuthorization(
      configuration.development,
      configuration.localDevelopmentToken,
    ),
  );
}

function createBrowserCloudMarkupClientCore(
  configuration: BrowserClientConfiguration,
  staticAuthorization: string | undefined,
): CloudMarkupClient | undefined {
  const baseUrl =
    normalizeBaseUrl(configuration.apiBaseUrl) ??
    (configuration.development ? undefined : "/api");
  if (baseUrl === undefined) {
    return undefined;
  }

  const fetchTransport = createFetchTransport(
    configuration.fetchImplementation,
  );
  const transport: ApiTransport = async (request) => {
    const authorization =
      staticAuthorization ??
      (await resolveAccessTokenAuthorization(configuration.accessToken));
    return fetchTransport({
      ...request,
      headers:
        authorization === undefined
          ? request.headers
          : { ...request.headers, authorization },
    });
  };

  return createCloudMarkupClient({ baseUrl, transport });
}

export function createConfiguredBrowserCloudMarkupClient(
  accessToken?: BrowserAccessTokenSupplier,
): CloudMarkupClient | undefined {
  const apiBaseUrl = environmentString("VITE_CLOUDMARKUP_API_BASE_URL");
  const configuration: BrowserClientConfiguration = {
    ...(accessToken === undefined ? {} : { accessToken }),
    development: import.meta.env.DEV,
    fetchImplementation: window.fetch.bind(window),
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
  };
  if (import.meta.env.DEV) {
    const localDevelopmentToken = environmentString(
      "VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN",
    );
    return createBrowserCloudMarkupClient({
      ...configuration,
      ...(localDevelopmentToken === undefined ? {} : { localDevelopmentToken }),
    });
  }
  return createBrowserCloudMarkupClientCore(configuration, undefined);
}

export { accessTokenAuthorization } from "./access-token-authorization.js";
