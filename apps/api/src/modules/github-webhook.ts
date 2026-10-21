import { GITHUB_REPOSITORY_EXPORT_LIMITS } from "@cloudmarkup/github-repository-export/contracts";
import { GitHubExportError } from "@cloudmarkup/github-repository-export/errors";
import type { GitHubWebhookService } from "@cloudmarkup/github-repository-export/webhook";
import type { Hono } from "hono";

import type { ApiEnvironment } from "../transport/http.js";

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (request.body === null) return new Uint8Array();
  const reader =
    request.body.getReader() as ReadableStreamDefaultReader<unknown>;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) return null;
      size += result.value.byteLength;
      if (size > GITHUB_REPOSITORY_EXPORT_LIMITS.webhookBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function response(status: number, state: string): Response {
  return new Response(
    JSON.stringify({ received: status === 200, status: state }),
    {
      headers: { "content-type": "application/json; charset=UTF-8" },
      status,
    },
  );
}

export function registerGitHubWebhookRoute(
  app: Hono<ApiEnvironment>,
  webhooks: GitHubWebhookService | undefined,
): void {
  app.post("/webhooks/github", async (context) => {
    if (webhooks === undefined) return response(503, "github-disabled");
    const body = await readBoundedBody(context.req.raw);
    if (body === null) return response(413, "invalid-delivery");
    const deliveryId = context.req.header("x-github-delivery");
    const event = context.req.header("x-github-event");
    const signature = context.req.header("x-hub-signature-256");
    if (
      deliveryId === undefined ||
      event === undefined ||
      signature === undefined
    ) {
      return response(400, "invalid-delivery");
    }
    try {
      const result = await webhooks.handle({
        body,
        deliveryId,
        event,
        signature,
      });
      return response(200, result.status);
    } catch (error) {
      if (
        error instanceof GitHubExportError &&
        (error.code === "webhook-invalid" || error.code === "webhook-replayed")
      ) {
        return response(400, "invalid-delivery");
      }
      return response(503, "retry-later");
    }
  });
}
