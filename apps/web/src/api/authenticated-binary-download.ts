import {
  resolveAccessTokenAuthorization,
  type BrowserAccessTokenSupplier,
} from "./access-token-authorization.js";

import {
  ApiClientError,
  apiErrorEnvelopeV1Schema,
} from "@cloudmarkup/api-contract";

const localTokenPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const maximumDownloadBytes = 64 * 1024 * 1024;

export interface AuthenticatedBinaryDownloadConfiguration {
  readonly accessToken?: BrowserAccessTokenSupplier;
  readonly apiBaseUrl?: string;
  readonly development: boolean;
  readonly fetchImplementation: typeof globalThis.fetch;
  readonly localDevelopmentToken?: string;
}

export interface AuthenticatedBinaryDownload {
  readonly bytes: ArrayBuffer;
  readonly digest: string;
  readonly fileName: string;
  readonly mediaType: "application/zip";
  readonly sizeBytes: number;
}

export type AuthenticatedBinaryDownloader = (
  relativeUrl: string,
  signal?: AbortSignal,
) => Promise<AuthenticatedBinaryDownload>;

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) return undefined;
  if (normalized.length > 2_048 || /[\r\n]/u.test(normalized)) {
    throw new TypeError("The CloudMarkup API base URL is invalid.");
  }
  return normalized.replace(/\/$/u, "");
}

function environmentString(name: string): string | undefined {
  const environment: unknown = import.meta.env;
  if (typeof environment !== "object" || environment === null) return undefined;
  const value = (environment as Readonly<Record<string, unknown>>)[name];
  return typeof value === "string" ? value : undefined;
}

function localAuthorization(
  development: boolean,
  token: string | undefined,
): string | undefined {
  if (token === undefined || token.length === 0) return undefined;
  if (!development || !localTokenPattern.test(token)) {
    throw new TypeError(
      "The local-development identity token is unavailable in this runtime.",
    );
  }
  return `Bearer local-development:${token}`;
}

function safeDownloadPath(value: string): boolean {
  return (
    /^\/v1\/[A-Za-z0-9/_-]+$/u.test(value) &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

function downloadFailure(): TypeError {
  return new TypeError(
    "The authorized download response failed security or integrity checks.",
  );
}

async function throwDownloadResponseError(response: Response): Promise<never> {
  try {
    const parsed = apiErrorEnvelopeV1Schema.safeParse(
      JSON.parse(await response.text()) as unknown,
    );
    if (parsed.success) {
      throw new ApiClientError(response.status, parsed.data);
    }
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
  }
  throw new TypeError("The authorized download request was not accepted.");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function parseDownloadHeaders(response: Response): {
  readonly digest: string;
  readonly fileName: string;
  readonly sizeBytes: number;
} {
  const dispositionMatch =
    /^attachment; filename="([a-z0-9][a-z0-9._-]{0,95}\.zip)"$/u.exec(
      response.headers.get("content-disposition") ?? "",
    );
  const digest = response.headers.get("x-cloudmarkup-content-sha256");
  const length = response.headers.get("content-length");
  const sizeBytes = length === null ? Number.NaN : Number(length);
  if (
    response.headers.get("content-type") !== "application/zip" ||
    dispositionMatch?.[1] === undefined ||
    digest === null ||
    !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    sizeBytes > maximumDownloadBytes ||
    response.headers.get("cache-control") !== "private, no-store" ||
    response.headers.get("x-content-type-options") !== "nosniff" ||
    response.headers.get("content-security-policy") !== "sandbox" ||
    response.headers.get("referrer-policy") !== "no-referrer"
  ) {
    throw downloadFailure();
  }
  return { digest, fileName: dispositionMatch[1], sizeBytes };
}

export function createAuthenticatedBinaryDownloader(
  configuration: AuthenticatedBinaryDownloadConfiguration,
): AuthenticatedBinaryDownloader | undefined {
  return createAuthenticatedBinaryDownloaderCore(
    configuration,
    localAuthorization(
      configuration.development,
      configuration.localDevelopmentToken,
    ),
  );
}

function createAuthenticatedBinaryDownloaderCore(
  configuration: AuthenticatedBinaryDownloadConfiguration,
  staticAuthorization: string | undefined,
): AuthenticatedBinaryDownloader | undefined {
  const baseUrl =
    normalizeBaseUrl(configuration.apiBaseUrl) ??
    (configuration.development ? undefined : "/api");
  if (baseUrl === undefined) {
    return undefined;
  }
  return async (relativeUrl, signal) => {
    if (!safeDownloadPath(relativeUrl)) throw downloadFailure();
    const authorization =
      staticAuthorization ??
      (await resolveAccessTokenAuthorization(configuration.accessToken));
    const response = await configuration.fetchImplementation(
      `${baseUrl}${relativeUrl}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          accept: "application/zip",
          ...(authorization === undefined ? {} : { authorization }),
        },
        method: "GET",
        redirect: "error",
        ...(signal === undefined ? {} : { signal }),
      },
    );
    if (response.status !== 200) await throwDownloadResponseError(response);
    const metadata = parseDownloadHeaders(response);
    const bytes = await response.arrayBuffer();
    if (
      bytes.byteLength !== metadata.sizeBytes ||
      (await sha256(bytes)) !== metadata.digest
    ) {
      throw downloadFailure();
    }
    return {
      bytes,
      digest: metadata.digest,
      fileName: metadata.fileName,
      mediaType: "application/zip",
      sizeBytes: metadata.sizeBytes,
    };
  };
}

export function createConfiguredAuthenticatedBinaryDownloader(
  accessToken?: BrowserAccessTokenSupplier,
): AuthenticatedBinaryDownloader | undefined {
  const apiBaseUrl = environmentString("VITE_CLOUDMARKUP_API_BASE_URL");
  const configuration: AuthenticatedBinaryDownloadConfiguration = {
    ...(accessToken === undefined ? {} : { accessToken }),
    development: import.meta.env.DEV,
    fetchImplementation: window.fetch.bind(window),
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
  };
  if (import.meta.env.DEV) {
    const localDevelopmentToken = environmentString(
      "VITE_CLOUDMARKUP_LOCAL_IDENTITY_TOKEN",
    );
    return createAuthenticatedBinaryDownloader({
      ...configuration,
      ...(localDevelopmentToken === undefined ? {} : { localDevelopmentToken }),
    });
  }
  return createAuthenticatedBinaryDownloaderCore(configuration, undefined);
}
