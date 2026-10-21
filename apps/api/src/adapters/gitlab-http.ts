/** Fixed-host GitLab transport. Provider errors never carry response bodies or credentials. */
export class GitLabProviderError extends Error {
  readonly outcome: "not-sent" | "rejected" | "uncertain";
  readonly problem:
    | "invalid-input"
    | "access-denied"
    | "conflict"
    | "rate-limited"
    | "unavailable";
  constructor(
    outcome: "not-sent" | "rejected" | "uncertain",
    problem:
      | "invalid-input"
      | "access-denied"
      | "conflict"
      | "rate-limited"
      | "unavailable",
  ) {
    super("The GitLab operation could not be confirmed.");
    this.name = "GitLabProviderError";
    this.outcome = outcome;
    this.problem = problem;
  }
}

export interface GitLabTransportOptions {
  /** Must recheck the actor/session, tenant, connection and operation admission. */
  readonly assertCurrentAdmission: () => Promise<void>;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export interface GitLabRequest {
  readonly path: string;
  readonly method: "GET" | "POST";
  readonly token?: Uint8Array;
  readonly body?: string;
  readonly contentType?:
    "application/json" | "application/x-www-form-urlencoded";
  readonly successStatus: 200 | 201;
  readonly maxBytes?: number;
  readonly allowMissing?: boolean;
}

export interface GitLabResponse {
  readonly value: unknown;
  readonly nextPage: string | null;
}

export interface GitLabOperation {
  readonly signal: AbortSignal;
  request(input: GitLabRequest): Promise<GitLabResponse | null>;
}

const requestDeadlineMs = 10_000;
const maxResponseBytes = 4 * 1024 * 1024;

function reject(
  problem: GitLabProviderError["problem"] = "invalid-input",
): never {
  throw new GitLabProviderError("not-sent", problem);
}

export function gitLabSecretText(value: Uint8Array): string {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 20 ||
    value.byteLength > 4096
  )
    reject();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    reject();
  }
  if (!/^[A-Za-z0-9._~+/-]+={0,2}$/u.test(text)) reject();
  return text;
}

function endpoint(input: GitLabRequest): URL {
  // All variable path segments are encoded by the provider adapters. No host,
  // credential query, pagination URL, upload URL or redirect can be supplied.
  let url: URL;
  try {
    url = new URL(input.path, "https://gitlab.com");
  } catch {
    reject();
  }
  if (
    !input.path.startsWith("/") ||
    input.path.startsWith("//") ||
    url.origin !== "https://gitlab.com" ||
    url.username ||
    url.password ||
    url.hash ||
    /[\\\r\n]/u.test(input.path) ||
    [...url.searchParams.keys()].some(
      (key) =>
        ![
          "page",
          "per_page",
          "membership",
          "min_access_level",
          "archived",
          "ref",
          "recursive",
          "source_branch",
          "target_branch",
          "state",
          "order_by",
          "sort",
        ].includes(key),
    )
  )
    reject();
  const path = url.pathname;
  const allowed =
    input.method === "POST"
      ? /^\/oauth\/(?:token|revoke)$/u.test(path) ||
        /^\/api\/v4\/projects\/[1-9][0-9]*\/(?:repository\/commits|merge_requests)$/u.test(
          path,
        )
      : path === "/oauth/token/info" ||
        path === "/api/v4/user" ||
        path === "/api/v4/projects" ||
        /^\/api\/v4\/projects\/[1-9][0-9]*(?:\/repository\/(?:tree|branches(?:\/[^/]+)?|commits\/[a-f0-9]{40}|files\/[^/]+)|\/merge_requests(?:\/[1-9][0-9]*)?)?$/u.test(
          path,
        );
  if (!allowed || (input.method === "GET" && input.body !== undefined))
    reject();
  if (
    input.allowMissing &&
    (input.method !== "GET" ||
      !/\/repository\/(?:branches|files)\//u.test(path))
  )
    reject();
  return url;
}

function bounded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(new GitLabProviderError("uncertain", "unavailable"));
    };
    signal.addEventListener("abort", abort, { once: true });
    // Always observe the pending rejection, even if admission aborted synchronously.
    pending
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      })
      .catch(() => undefined);
    if (signal.aborted) abort();
  });
}

async function json(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new GitLabProviderError("uncertain", "unavailable");
  try {
    if (
      !/^application\/json(?:\s*;|$)/iu.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new Error();
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit))
      throw new Error();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await bounded(reader.read(), signal);
      if (chunk.done) break;
      if (
        !(chunk.value instanceof Uint8Array) ||
        (size += chunk.value.byteLength) > limit
      )
        throw new Error();
      chunks.push(chunk.value);
    }
    const encoding = response.headers.get("content-encoding");
    if (
      length !== null &&
      (!encoding || encoding === "identity") &&
      Number(length) !== size
    )
      throw new Error();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new GitLabProviderError("uncertain", "unavailable");
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** One deadline across admission, all requests and all streamed bodies; no retries. */
export async function withGitLabOperation<T>(
  options: GitLabTransportOptions,
  run: (operation: GitLabOperation) => Promise<T>,
): Promise<T> {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([
    lifetime.signal,
    AbortSignal.timeout(requestDeadlineMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  const isAborted = () => signal.aborted;
  const fetch = options.fetch ?? globalThis.fetch;
  const assertCurrentAdmission = options.assertCurrentAdmission;
  const dispatch = { value: false };
  const admission = async () => {
    if (isAborted())
      throw new GitLabProviderError(
        dispatch.value ? "uncertain" : "not-sent",
        "unavailable",
      );
    try {
      await bounded(assertCurrentAdmission(), signal);
    } catch {
      throw new GitLabProviderError(
        dispatch.value ? "uncertain" : "not-sent",
        "access-denied",
      );
    }
    if (isAborted())
      throw new GitLabProviderError(
        dispatch.value ? "uncertain" : "not-sent",
        "unavailable",
      );
  };
  await admission();
  const operation: GitLabOperation = {
    signal,
    request: async (request) => {
      request = { ...request };
      const url = endpoint(request);
      const maxBytes = request.maxBytes ?? 32768;
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 2 ||
        maxBytes > maxResponseBytes ||
        (request.body !== undefined &&
          Buffer.byteLength(request.body) > maxResponseBytes)
      )
        reject();
      const headers = new Headers({
        accept: "application/json",
        "accept-encoding": "identity",
      });
      if (request.token)
        headers.set(
          "authorization",
          `Bearer ${gitLabSecretText(request.token)}`,
        );
      if (request.body !== undefined) {
        if (!request.contentType) reject();
        headers.set("content-type", request.contentType);
      }
      await admission();
      dispatch.value = true;
      try {
        const pending = fetch(url, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          signal,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        });
        void pending.then(
          (late) => {
            if (signal.aborted) void late.body?.cancel().catch(() => undefined);
          },
          () => undefined,
        );
        const response = await bounded(pending, signal);
        if (
          response.redirected ||
          (response.url && response.url !== url.href)
        ) {
          void response.body?.cancel().catch(() => undefined);
          throw new GitLabProviderError("uncertain", "unavailable");
        }
        if (response.status !== request.successStatus) {
          void response.body?.cancel().catch(() => undefined);
          await admission();
          if (response.status === 404 && request.allowMissing) return null;
          const problem =
            response.status === 401 || response.status === 403
              ? "access-denied"
              : response.status === 409
                ? "conflict"
                : response.status === 429
                  ? "rate-limited"
                  : "unavailable";
          throw new GitLabProviderError(
            [400, 401, 403, 404, 409, 422, 429].includes(response.status)
              ? "rejected"
              : "uncertain",
            problem,
          );
        }
        const value = await json(response, maxBytes, signal);
        await admission();
        return { value, nextPage: response.headers.get("x-next-page") };
      } catch (error) {
        if (error instanceof GitLabProviderError) throw error;
        throw new GitLabProviderError("uncertain", "unavailable");
      }
    },
  };
  try {
    const result = await bounded(run(operation), signal);
    await admission();
    return result;
  } catch (error) {
    if (error instanceof GitLabProviderError) throw error;
    throw new GitLabProviderError(
      dispatch.value ? "uncertain" : "not-sent",
      "unavailable",
    );
  } finally {
    lifetime.abort();
  }
}
