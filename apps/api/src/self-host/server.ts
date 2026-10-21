import { createSelfHostAdapterRegistry } from "./adapter-registry.js";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { constants } from "node:fs";
import { access, lstat, open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  API_CONTRACT_VERSION,
  MAX_JSON_REQUEST_BYTES,
  apiErrorEnvelopeV1Schema,
} from "@cloudmarkup/api-contract";
import type { SelfHostCredentialResolver } from "./configuration.js";

import { API_SECURITY_HEADERS } from "../transport/http.js";
import {
  SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME,
  SelfHostConfigurationError,
  parseSelfHostConfiguration,
  type SelfHostConfiguration,
} from "./configuration.js";
import {
  createSelfHostRuntime,
  type SelfHostRuntime,
  type SelfHostRuntimeFactories,
  type SelfHostShutdownObservation,
} from "./runtime.js";

const MAXIMUM_PRIVATE_FILE_BYTES = 262144;

/** Server-side private file IO. No error exposes a filename, contents or cause. */
async function privateText(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new Error();
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > MAXIMUM_PRIVATE_FILE_BYTES
    )
      throw new Error();
    if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) {
      // Docker Desktop may project a Windows read-only secret as mode 0777.
      // Accept that projection only when the kernel confirms a read-only mount;
      // EACCES alone does not prove another user cannot write the file.
      let readOnlyMount = false;
      try {
        await access(path, constants.W_OK);
      } catch (error) {
        readOnlyMount = (error as NodeJS.ErrnoException).code === "EROFS";
      }
      if (!readOnlyMount) throw new Error();
    }
    let ancestor = resolve(path);
    for (;;) {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error();
      const parent = resolve(ancestor, "..");
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const handle = await open(path, "r");
    try {
      const actual = await handle.stat();
      if (
        !actual.isFile() ||
        actual.dev !== stat.dev ||
        actual.ino !== stat.ino ||
        actual.size !== stat.size
      )
        throw new Error();
      const bytes = await handle.readFile();
      if (bytes.length > MAXIMUM_PRIVATE_FILE_BYTES) throw new Error();
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      await handle.close();
    }
  } catch {
    throw new SelfHostConfigurationError();
  }
}

export async function readSelfHostConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<SelfHostConfiguration> {
  try {
    const file = environment[SELF_HOST_CONFIGURATION_ENVIRONMENT_NAME];
    if (file?.trim() !== file || !file) throw new Error();
    const text = await privateText(file);
    return parseSelfHostConfiguration(JSON.parse(text) as unknown);
  } catch {
    throw new SelfHostConfigurationError();
  }
}

/** Values never become browser/runtime config. Reference selection is closed to
 * the already validated server document; requests cannot select a source. */
export function createSelfHostCredentialResolver(
  configuration: SelfHostConfiguration,
  environment: NodeJS.ProcessEnv,
): SelfHostCredentialResolver {
  return async (reference, signal) => {
    try {
      signal.throwIfAborted();
      const source = configuration.credentialSources[reference];
      if (source === undefined) throw new Error();
      const value =
        source.kind === "file"
          ? await privateText(source.path)
          : environment[source.name];
      signal.throwIfAborted();
      if (
        value === undefined ||
        value.length === 0 ||
        value.length > MAXIMUM_PRIVATE_FILE_BYTES ||
        value.includes("\0")
      )
        throw new Error();
      // Secret mounts commonly end in one LF. Do not silently strip password
      // spaces or other bytes; only the file terminator is removed.
      const resolved =
        source.kind === "file" ? value.replace(/\r?\n$/u, "") : value;
      if (resolved.length === 0) throw new Error();
      return resolved;
    } catch {
      throw new SelfHostConfigurationError();
    }
  };
}

export async function createSelfHostRequest(
  request: IncomingMessage,
  publicOrigin: string,
  signal: AbortSignal,
): Promise<Request> {
  const method = request.method ?? "GET";
  const target = request.url ?? "/";
  // Origin-form only. Host/forwarded headers cannot redirect internal requests.
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\")
  )
    throw new SelfHostConfigurationError();
  const url = new URL(target, publicOrigin);
  if (url.origin !== publicOrigin) throw new SelfHostConfigurationError();
  if (url.pathname.startsWith("/api/")) {
    const pathname = url.pathname.slice(4);
    if (
      pathname.startsWith("/v1/") ||
      pathname.startsWith("/openapi/") ||
      ["/runtime-config", "/ready", "/health"].includes(pathname)
    )
      url.pathname = pathname;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value))
      value.forEach((entry) => {
        headers.append(name, entry);
      });
    else if (value !== undefined) headers.set(name, value);
  }
  headers.delete("host");
  headers.delete("forwarded");
  headers.delete("x-forwarded-host");
  headers.delete("x-forwarded-proto");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (method !== "GET" && method !== "HEAD") {
    for await (const raw of request) {
      signal.throwIfAborted();
      const chunk: unknown = raw;
      if (!(chunk instanceof Uint8Array))
        throw new SelfHostConfigurationError();
      size += chunk.length;
      if (size > MAX_JSON_REQUEST_BYTES) throw new SelfHostConfigurationError();
      chunks.push(chunk);
    }
  }
  signal.throwIfAborted();
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(url, {
    method,
    headers,
    signal,
    ...(size === 0 ? {} : { body }),
  });
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=UTF-8",
  js: "text/javascript; charset=UTF-8",
  css: "text/css; charset=UTF-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  wasm: "application/wasm",
  webmanifest: "application/manifest+json",
  txt: "text/plain; charset=UTF-8",
};
export const SELF_HOST_WEB_ROOT = resolve(
  import.meta.dirname,
  "../../../../apps/web/dist",
);

export async function serveSelfHostWeb(
  request: Request,
  configuration: SelfHostConfiguration,
  root = SELF_HOST_WEB_ROOT,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname === "/runtime-config" ||
    url.pathname === "/ready" ||
    url.pathname === "/health" ||
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/openapi/") ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/github/setup" ||
    url.pathname === "/github/callback" ||
    url.pathname.startsWith("/auth/local-owner/v1/") ||
    url.pathname.startsWith("/auth/session/v1/") ||
    url.pathname.startsWith("/webhooks/")
  )
    return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    throw new SelfHostConfigurationError();
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.split("/").some((part) => part.startsWith("."))
  )
    throw new SelfHostConfigurationError();
  const segments = decoded.split("/").filter(Boolean);
  let path = resolve(root, ...segments);
  if (
    path !== root &&
    !path.startsWith(resolve(root) + "/") &&
    !path.startsWith(resolve(root) + "\\")
  )
    throw new SelfHostConfigurationError();
  let stat = await lstat(path).catch(() => null);
  if (stat === null || stat.isDirectory()) {
    if (
      segments.length > 0 &&
      !request.headers.get("accept")?.includes("text/html")
    )
      return null;
    path = resolve(root, "index.html");
    stat = await lstat(path);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 33554432)
    throw new SelfHostConfigurationError();
  let ancestor = path;
  for (;;) {
    if ((await lstat(ancestor)).isSymbolicLink())
      throw new SelfHostConfigurationError();
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const extension = path.split(".").at(-1) ?? "";
  const type = MIME_TYPES[extension];
  if (type === undefined) return null;
  const headers = new Headers({
    ...API_SECURITY_HEADERS,
    "content-type": type,
    "content-length": String(stat.size),
  });
  const identityOrigin =
    configuration.identity.mode === "cognito"
      ? " " +
        new URL(configuration.identity.publicRuntime.authentication.domain)
          .origin
      : "";
  const upgrade =
    new URL(configuration.server.publicOrigin).protocol === "https:"
      ? "; upgrade-insecure-requests"
      : "";
  headers.set(
    "content-security-policy",
    `default-src 'self'; base-uri 'none'; child-src 'none'; connect-src 'self'${identityOrigin}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src 'none'; img-src 'self' data: blob:; manifest-src 'self'; media-src 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:${upgrade}`,
  );
  if (request.method === "HEAD") return new Response(null, { headers });
  const handle = await open(path, "r");
  const current = await handle.stat();
  if (
    !current.isFile() ||
    current.dev !== stat.dev ||
    current.ino !== stat.ino ||
    current.size !== stat.size
  ) {
    await handle.close();
    throw new SelfHostConfigurationError();
  }
  return new Response(
    Readable.toWeb(
      handle.createReadStream({ autoClose: true }),
    ) as ReadableStream<Uint8Array>,
    { headers },
  );
}

function unavailableResponse(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const payload = apiErrorEnvelopeV1Schema.parse({
    apiVersion: API_CONTRACT_VERSION,
    error: {
      code: "service_unavailable",
      correlationId: randomUUID(),
      message: "The self-host API could not complete the request.",
    },
  });
  response.writeHead(503, {
    ...API_SECURITY_HEADERS,
    "content-type": "application/json; charset=UTF-8",
  });
  response.end(JSON.stringify(payload));
}

async function writeResponse(
  incoming: Response,
  outgoing: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const headers: Record<string, string | string[]> = {};
  incoming.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const cookies = incoming.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  outgoing.writeHead(incoming.status, headers);
  const reader = incoming.body?.getReader();
  if (reader !== undefined) {
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        if (!outgoing.write(next.value)) {
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              outgoing.off("drain", done);
              outgoing.off("error", failed);
              outgoing.off("close", failed);
              signal.removeEventListener("abort", failed);
            };
            const done = () => {
              cleanup();
              resolve();
            };
            const failed = () => {
              cleanup();
              reject(new SelfHostConfigurationError());
            };
            outgoing.once("drain", done);
            outgoing.once("error", failed);
            outgoing.once("close", failed);
            signal.addEventListener("abort", failed, { once: true });
            if (signal.aborted) failed();
          });
        }
      }
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  outgoing.end();
}

export async function startSelfHostServer(
  configuration: SelfHostConfiguration,
  factories: SelfHostRuntimeFactories,
  createRuntime: typeof createSelfHostRuntime = createSelfHostRuntime,
  webRoot = SELF_HOST_WEB_ROOT,
): Promise<{
  readonly server: Server;
  readonly runtime: SelfHostRuntime;
  stop(): Promise<SelfHostShutdownObservation>;
}> {
  // No source/development HTML or synthetic Vite fallback. The packaged browser
  // must exist before any job or HTTP admission begins.
  const index = await serveSelfHostWeb(
    new Request(configuration.server.publicOrigin + "/", {
      headers: { accept: "text/html" },
    }),
    configuration,
    webRoot,
  );
  if (index === null) throw new SelfHostConfigurationError();
  await index.body?.cancel();
  const runtime = await createRuntime(
    {
      schemaVersion: configuration.schemaVersion,
      server: configuration.server,
      identity: configuration.identity,
      persistence: configuration.persistence,
      models: configuration.models,
      adapters: configuration.adapters,
      credentialSources: configuration.credentialSources,
    },
    factories,
  );
  const controllers = new Set<AbortController>();
  let stopping: Promise<SelfHostShutdownObservation> | undefined;
  const server = createServer((request, response) => {
    if (
      stopping !== undefined ||
      controllers.size >= configuration.server.maximumInFlightRequests
    ) {
      unavailableResponse(response);
      request.resume();
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const aborted = () => {
      controller.abort();
    };
    request.once("aborted", aborted);
    response.once("close", aborted);
    const timer = setTimeout(() => {
      controller.abort();
      request.destroy();
    }, configuration.server.requestDeadlineMilliseconds);
    void (async () => {
      try {
        const input = await createSelfHostRequest(
          request,
          configuration.server.publicOrigin,
          controller.signal,
        );
        const output =
          (await serveSelfHostWeb(input, configuration, webRoot)) ??
          (await runtime.app.fetch(input));
        await writeResponse(output, response, controller.signal);
      } catch {
        unavailableResponse(response);
      } finally {
        clearTimeout(timer);
        request.off("aborted", aborted);
        response.off("close", aborted);
        controllers.delete(controller);
      }
    })();
  });
  server.requestTimeout = configuration.server.requestDeadlineMilliseconds;
  server.headersTimeout = Math.min(
    10000,
    configuration.server.requestDeadlineMilliseconds,
  );
  const stop = (): Promise<SelfHostShutdownObservation> => {
    stopping ??= (async () => {
      runtime.stopAdmissions();
      for (const controller of controllers) controller.abort();
      const httpClosed = new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      server.closeIdleConnections();
      const outcome = await runtime.close();
      // Abort the transport after application/model drain. Connection disposal
      // never stands in for confirmed journal or PostgreSQL disposal.
      server.closeAllConnections();
      await httpClosed;
      return outcome;
    })();
    return stopping;
  };
  try {
    // The pinned Node HTTP server otherwise ends an asynchronous response when
    // a client finishes its write half. Use its existing owned-server switch;
    // unsupported runtimes refuse before HTTP admission and dispose normally.
    if (
      !("httpAllowHalfOpen" in server) ||
      typeof server.httpAllowHalfOpen !== "boolean"
    )
      throw new SelfHostConfigurationError();
    server.httpAllowHalfOpen = true;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        configuration.server.port,
        configuration.server.host,
        () => {
          server.off("error", reject);
          resolve();
        },
      );
    });
    return { server, runtime, stop };
  } catch {
    await stop();
    throw new SelfHostConfigurationError();
  }
}

async function main(): Promise<void> {
  const configuration = await readSelfHostConfiguration(process.env);
  const resolveCredential = createSelfHostCredentialResolver(
    configuration,
    process.env,
  );
  // Static reviewed factories; private configuration cannot load JS/modules.
  const running = await startSelfHostServer(configuration, {
    resolveCredential,
    adapters: createSelfHostAdapterRegistry(),
  });
  const stop = () => {
    void running
      .stop()
      .then((outcome) => {
        if (!outcome.resourcesDisposed) process.exitCode = 1;
      })
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch(() => {
    // Error details, key references, settings and paths stay private.
    console.error("CloudMarkup self-host startup failed.");
    process.exitCode = 1;
  });
}
