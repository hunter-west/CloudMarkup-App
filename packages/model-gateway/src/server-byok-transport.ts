import type { ServerByokConfigurationV1 } from "./server-byok-configuration.js";

export type ServerByokCredentialResolverV1 = (
  reference: string,
  signal: AbortSignal,
) => Promise<string>;

export class ServerByokTransportErrorV1 extends Error {
  readonly reason: "transport" | "body" | "canceled";
  constructor(reason: ServerByokTransportErrorV1["reason"]) {
    super("Server BYOK provider response is unavailable.");
    this.reason = reason;
    this.name = "ServerByokTransportErrorV1";
  }
}

/** Also bounds injected transports and readers which fail to honor abort. */
export async function awaitServerByokAbortV1<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // Work is an already-started promise; attach rejection handling even when
    // an injected adapter aborts synchronously before this boundary.
    void work.catch(() => undefined);
    throw new ServerByokTransportErrorV1("canceled");
  }
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        abort = () => {
          reject(new ServerByokTransportErrorV1("canceled"));
        };
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}

export function createServerByokTransportV1(options: {
  readonly configuration: ServerByokConfigurationV1;
  readonly resolveCredential: ServerByokCredentialResolverV1;
  /** Trusted server/test injection; never a caller-provided endpoint or fetch. */
  readonly fetch?: typeof fetch;
}) {
  const configuration = options.configuration;
  const send = options.fetch ?? globalThis.fetch;
  if (
    typeof send !== "function" ||
    typeof options.resolveCredential !== "function"
  )
    throw new Error("Server BYOK transport is unavailable.");
  return {
    async resolveCredential(signal: AbortSignal): Promise<string> {
      try {
        const value = await awaitServerByokAbortV1(
          options.resolveCredential(configuration.credentialReference, signal),
          signal,
        );
        // Header-safe opaque token. No prefix assumption or ambient key lookup.
        if (typeof value !== "string" || !/^[A-Za-z0-9_.-]{8,512}$/.test(value))
          throw new Error();
        return value;
      } catch {
        throw new Error("Server BYOK credential is unavailable.");
      }
    },
    async dispatch(body: string, credential: string, signal: AbortSignal) {
      let response: Response;
      try {
        signal.throwIfAborted();
        response = await awaitServerByokAbortV1(
          send(configuration.endpoint, {
            method: "POST",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${credential}`,
            },
            body,
            signal,
          }),
          signal,
        );
      } catch {
        throw new ServerByokTransportErrorV1(
          signal.aborted ? "canceled" : "transport",
        );
      }
      const maximum = configuration.limits.maximumResponseBytes;
      const reader = response.body?.getReader();
      try {
        if (
          response.redirected ||
          response.type === "opaqueredirect" ||
          reader === undefined
        )
          throw new Error();
        const declaredLength = response.headers.get("content-length");
        if (
          declaredLength !== null &&
          (!/^\d{1,10}$/.test(declaredLength) ||
            Number(declaredLength) > maximum)
        )
          throw new Error();
        const mediaType = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== "application/json") throw new Error();
        const parts: Uint8Array[] = [];
        let length = 0;
        for (;;) {
          const next = await awaitServerByokAbortV1(reader.read(), signal);
          if (next.done) break;
          const chunk: unknown = next.value;
          if (!(chunk instanceof Uint8Array)) throw new Error();
          length += chunk.byteLength;
          if (length > maximum) throw new Error();
          parts.push(chunk);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        const raw: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        const requestId = response.headers.get("x-request-id");
        // Provider metadata is untrusted; never persist headers verbatim.
        const invalidMetadata =
          requestId !== null &&
          (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId) ||
            /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,512}\b/.test(requestId) ||
            requestId.includes(credential));
        return {
          raw,
          ok: response.ok,
          invalidMetadata,
          providerRequestId: invalidMetadata
            ? undefined
            : (requestId ?? undefined),
        };
      } catch {
        // Never await an uncooperative stream's cancellation past the deadline.
        if (reader !== undefined) void reader.cancel().catch(() => undefined);
        throw new ServerByokTransportErrorV1(
          signal.aborted ? "canceled" : "body",
        );
      } finally {
        reader?.releaseLock();
      }
    },
  };
}
