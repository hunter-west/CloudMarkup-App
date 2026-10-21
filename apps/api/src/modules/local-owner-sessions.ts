import type { Hono } from "hono";
import { z } from "zod";

import { ApplicationError } from "../application/errors.js";
import type { LocalOwnerIdentity } from "../self-host/local-owner-identity.js";
import type { ApiContext, ApiEnvironment } from "../transport/http.js";

const exchangeSchema = z
  .object({
    schemaVersion: z.literal(1),
    proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  })
  .strict();
const logoutSchema = z.object({ schemaVersion: z.literal(1) }).strict();

export interface LocalOwnerSessionRoutes {
  readonly publicOrigin: string;
  readonly service: LocalOwnerIdentity;
}

async function boundedBody(context: ApiContext): Promise<unknown> {
  const reader = context.req.raw.body?.getReader();
  if (reader === undefined) throw new Error("Invalid local session body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array))
        throw new Error("Invalid local session body.");
      length += chunk.byteLength;
      if (length > 256) throw new Error("Invalid local session body.");
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function requestContext(context: ApiContext) {
  return {
    method: context.req.method,
    origin: context.req.header("origin"),
    fetchSite: context.req.header("sec-fetch-site"),
    sessionHeader: context.req.header("x-cloudmarkup-session"),
    contentType: context.req.header("content-type"),
  };
}

function sameOrigin(context: ApiContext, publicOrigin: string): void {
  const site = context.req.header("sec-fetch-site");
  if (new URL(context.req.url).search !== "")
    throw new ApplicationError(
      "invalid_request",
      "The local session request is invalid.",
    );
  if (
    context.req.header("origin") !== publicOrigin ||
    (site !== undefined && site !== "same-origin") ||
    context.req.header("x-cloudmarkup-session") !== "1" ||
    !/^application\/json(?:\s*;|$)/iu.test(
      context.req.header("content-type") ?? "",
    )
  )
    throw new ApplicationError(
      "access_denied",
      "Open this action from CloudMarkup.",
    );
}

/** Deliberately separate from Cognito's /auth/session/v1 routes and cookies. */
export function registerLocalOwnerSessionRoutes(
  app: Hono<ApiEnvironment>,
  config?: LocalOwnerSessionRoutes,
): void {
  if (config === undefined) return;
  const origin = new URL(config.publicOrigin);
  if (
    origin.hostname !== "127.0.0.1" ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== config.publicOrigin ||
    origin.username ||
    origin.password
  )
    throw new TypeError(
      "Local owner sessions require an exact loopback origin.",
    );

  app.post("/auth/local-owner/v1/exchange", async (context) => {
    sameOrigin(context, config.publicOrigin);
    context.header("Cache-Control", "no-store, private");
    let body: unknown;
    try {
      body = await boundedBody(context);
    } catch {
      return context.json({ schemaVersion: 1, error: "invalid" }, 400);
    }
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success)
      return context.json({ schemaVersion: 1, error: "invalid" }, 400);
    try {
      const grant = await config.service.issue({
        ...requestContext(context),
        proof: parsed.data.proof,
      });
      if (grant === null)
        return context.json({ schemaVersion: 1, error: "rejected" }, 401);
      return context.json({ schemaVersion: 1, ...grant }, 200);
    } catch {
      return context.json({ schemaVersion: 1, error: "unavailable" }, 503);
    }
  });

  app.post("/auth/local-owner/v1/logout", async (context) => {
    sameOrigin(context, config.publicOrigin);
    context.header("Cache-Control", "no-store, private");
    let body: unknown;
    try {
      body = await boundedBody(context);
    } catch {
      return context.json({ schemaVersion: 1, error: "invalid" }, 400);
    }
    if (!logoutSchema.safeParse(body).success)
      return context.json({ schemaVersion: 1, error: "invalid" }, 400);
    try {
      if (
        !(await config.service.revoke({
          ...requestContext(context),
          authorization: context.req.header("authorization"),
        }))
      )
        return context.json({ schemaVersion: 1, error: "rejected" }, 401);
      return context.body(null, 204);
    } catch {
      return context.json({ schemaVersion: 1, error: "unavailable" }, 503);
    }
  });
}
