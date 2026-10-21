import {
  AI_INTENT_PREVIEW_INVOCATION_HEADER_V1,
  AI_INTENT_PREVIEW_STREAM_LIMITS_V1,
  acknowledgeAiIntentPreviewV1Schema,
  aiIntentPreviewAcknowledgementResponseV1Schema,
  aiIntentPreviewRequestHeadersV1Schema,
  aiIntentPreviewResponseHeadersV1Schema,
  apiOperationsV1,
  createAiIntentPreviewV1Schema,
  projectPathV1Schema,
  type CreateAiIntentPreviewV1,
} from "@cloudmarkup/api-contract";
import { accessTokenAuthorization } from "../../api/browser-client.js";
import {
  consumeAiIntentPreviewV1,
  type AiIntentPreviewConsumptionV1,
} from "./ai-intent-preview-consumer.js";

type Consumer = Parameters<typeof consumeAiIntentPreviewV1>[0];
export interface BrowserAiIntentPreviewAuthorityV1 {
  readonly principalId: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly draftEtag: string;
  readonly editingProof: CreateAiIntentPreviewV1["editingProof"];
  readonly accessToken: string;
}
class BrowserPreviewUnavailable extends Error {
  constructor() {
    super("The AI preview is unavailable. Your saved design has not changed.");
    this.name = "BrowserPreviewUnavailable";
  }
}
function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Already owned or closed. */
  }
}

/** Same-origin browser host. Authority comes from the current authenticated UI
 * session and editing lease; the server independently verifies every request.
 * Prompt/candidate/token/proofs remain in closures only. No query cache, storage,
 * retry, accepted Intent or Graph Command is created by this transport. */
export function createBrowserAiIntentPreviewV1(host: {
  readonly currentAuthority: () =>
    BrowserAiIntentPreviewAuthorityV1 | undefined;
  readonly origin: () => string;
  readonly fetchImplementation: typeof fetch;
}) {
  return async (input: {
    readonly projectId: string;
    readonly requirements: string;
    readonly requestedMode: CreateAiIntentPreviewV1["requestedMode"];
    readonly idempotencyKey: string;
    readonly signal: AbortSignal;
    readonly onCandidate: Consumer["onCandidate"];
    readonly onStatus?: Consumer["onStatus"];
  }): Promise<AiIntentPreviewConsumptionV1> => {
    const controller = new AbortController();
    const start = performance.now();
    let original: BrowserAiIntentPreviewAuthorityV1;
    let origin: string;
    let response: Response | undefined;
    let closed = false;
    const stop = () => {
      controller.abort();
    };
    input.signal.addEventListener("abort", stop, { once: true });
    if (input.signal.aborted) stop();
    const timer = setTimeout(
      stop,
      AI_INTENT_PREVIEW_STREAM_LIMITS_V1.deadlineMilliseconds,
    );
    function deny(): never {
      throw new BrowserPreviewUnavailable();
    }

    function current(): BrowserAiIntentPreviewAuthorityV1 {
      const value = host.currentAuthority();
      if (
        closed ||
        controller.signal.aborted ||
        value === undefined ||
        host.origin() !== origin ||
        value.principalId !== original.principalId ||
        value.sessionId !== original.sessionId ||
        value.projectId !== original.projectId ||
        value.draftEtag !== original.draftEtag ||
        value.editingProof.leaseId !== original.editingProof.leaseId ||
        value.editingProof.token !== original.editingProof.token
      )
        deny();
      return value;
    }
    async function bounded<T>(
      work: Promise<T>,
      signal: AbortSignal,
    ): Promise<T> {
      let canceled: (() => void) | undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        canceled = () => {
          reject(new BrowserPreviewUnavailable());
        };
        signal.addEventListener("abort", canceled, { once: true });
        if (signal.aborted) canceled();
      });
      try {
        const result = await Promise.race([work, cancellation]);
        current();
        if (signal.aborted) deny();
        return result;
      } finally {
        if (canceled !== undefined)
          signal.removeEventListener("abort", canceled);
      }
    }
    async function send(
      url: string,
      body: unknown,
      headers: Record<string, string>,
      signal: AbortSignal,
    ): Promise<Response> {
      const authority = current();
      const authorization = accessTokenAuthorization(
        () => authority.accessToken,
      );
      if (authorization === undefined) deny();
      let observed: Response | undefined;
      const pending = host
        .fetchImplementation(url, {
          method: "POST",
          headers: {
            ...headers,
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
          credentials: "omit",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "no-referrer",
          keepalive: false,
          signal,
        })
        .then((value) => {
          observed = value;
          return value;
        });
      void pending.then(
        (late) => {
          if (signal.aborted || closed) cancelBody(late);
        },
        () => undefined,
      );
      try {
        const result = await bounded(pending, signal);
        if (result.redirected || (result.url !== "" && result.url !== url))
          deny();
        return result;
      } catch {
        if (observed !== undefined) cancelBody(observed);
        deny();
      }
    }
    async function acknowledge(
      response: Response,
      signal: AbortSignal,
    ): Promise<void> {
      if (
        response.status !== 200 ||
        response.body === null ||
        !/^application\/json(?:\s*;|$)/iu.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        cancelBody(response);
        deny();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const item = await bounded(reader.read(), signal);
          if (item.done) break;
          length += item.value.byteLength;
          if (length > 16 * 1024) deny();
          chunks.push(item.value);
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const parsed = aiIntentPreviewAcknowledgementResponseV1Schema.safeParse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          ) as unknown,
        );
        if (!parsed.success) deny();
        current();
      } catch {
        void reader.cancel().catch(() => undefined);
        deny();
      } finally {
        reader.releaseLock();
      }
    }
    try {
      const authority = host.currentAuthority();
      if (
        authority === undefined ||
        authority.principalId.length < 1 ||
        authority.sessionId.length < 1
      )
        deny();
      original = structuredClone(authority);
      const location = new URL(host.origin());
      origin = location.origin;
      if (
        origin !== host.origin() ||
        original.projectId !== input.projectId ||
        (location.protocol !== "https:" &&
          !(
            import.meta.env.DEV &&
            location.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
          ))
      )
        deny();
      const path = projectPathV1Schema.parse({ projectId: input.projectId });
      const body = createAiIntentPreviewV1Schema.parse({
        contractVersion: 1,
        requirements: input.requirements,
        requestedMode: input.requestedMode,
        editingProof: original.editingProof,
      });
      const headers = aiIntentPreviewRequestHeadersV1Schema.parse({
        "idempotency-key": input.idempotencyKey,
        "if-match": original.draftEtag,
      });
      const url =
        origin +
        "/api" +
        apiOperationsV1["ai-intent-previews.create"].path.replace(
          ":projectId",
          encodeURIComponent(path.projectId),
        );
      response = await send(
        url,
        body,
        { ...headers, accept: "text/event-stream" },
        controller.signal,
      );
      const receivedHeaders = aiIntentPreviewResponseHeadersV1Schema.safeParse({
        "cache-control": response.headers.get("cache-control"),
        "content-type": response.headers.get("content-type"),
        "content-security-policy": response.headers.get(
          "content-security-policy",
        ),
        "x-content-type-options": response.headers.get(
          "x-content-type-options",
        ),
        [AI_INTENT_PREVIEW_INVOCATION_HEADER_V1]: response.headers.get(
          AI_INTENT_PREVIEW_INVOCATION_HEADER_V1,
        ),
      });
      if (response.status !== 200 || !receivedHeaders.success) deny();
      const streamResponse = response;
      const remaining = Math.floor(
        AI_INTENT_PREVIEW_STREAM_LIMITS_V1.deadlineMilliseconds -
          (performance.now() - start),
      );
      if (remaining <= 0) deny();
      return await consumeAiIntentPreviewV1({
        expectedInvocationId:
          receivedHeaders.data[AI_INTENT_PREVIEW_INVOCATION_HEADER_V1],
        signal: controller.signal,
        request: () => {
          current();
          return Promise.resolve(streamResponse);
        },
        acknowledge: async ({ delivery, signal }) => {
          const authority = current();
          const receipt = acknowledgeAiIntentPreviewV1Schema.parse({
            contractVersion: 1,
            delivery,
            editingProof: authority.editingProof,
          });
          const result = await send(
            url + "/acknowledgement",
            receipt,
            { accept: "application/json" },
            signal,
          );
          await acknowledge(result, signal);
        },
        onCandidate: (candidate) => {
          current();
          return input.onCandidate(candidate);
        },
        ...(input.onStatus === undefined
          ? {}
          : {
              onStatus: (code) => {
                current();
                return input.onStatus?.(code);
              },
            }),
        limits: { deadlineMilliseconds: remaining },
      });
    } catch {
      throw new BrowserPreviewUnavailable();
    } finally {
      closed = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", stop);
      controller.abort();
      if (response !== undefined) cancelBody(response);
    }
  };
}
