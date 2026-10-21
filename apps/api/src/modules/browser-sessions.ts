import type { Hono } from "hono";
import { z } from "zod";
import { ApplicationError } from "../application/errors.js";
import {
  BrowserSessionError,
  browserSessionCookieSchema,
  browserSessionHandleSchema,
  type BrowserRefreshSessionService,
  type BrowserSessionGrant,
} from "../adapters/identity/browser-refresh-session-service.js";
import type { ApiContext, ApiEnvironment } from "../transport/http.js";

const cookieName = "__Host-cloudmarkup-refresh";
const emptySchema = z.object({ schemaVersion: z.literal(1) }).strict();
const cancelSchema = emptySchema.extend({ handle: browserSessionHandleSchema });
const logoutSchema = emptySchema.extend({
  handle: browserSessionHandleSchema.optional(),
});
const exchangeSchema = cancelSchema.extend({
  code: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9._~-]+$/u),
  verifier: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u),
});
export interface BrowserSessionRoutes {
  readonly publicOrigin: string;
  readonly service: BrowserRefreshSessionService;
}
function cookie(context: ApiContext): [string, string] | undefined {
  const matches = (context.req.header("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(cookieName + "="));
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new BrowserSessionError("rejected");
  const value = matches[0]?.slice(cookieName.length + 1) ?? "";
  if (!/^[A-Za-z0-9_-]{1,3800}$/u.test(value))
    throw new BrowserSessionError("rejected");
  try {
    return browserSessionCookieSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
  } catch {
    throw new BrowserSessionError("rejected");
  }
}
function grant(
  context: ApiContext,
  value: BrowserSessionGrant,
  writeCookie = true,
) {
  const encoded = Buffer.from(
    JSON.stringify([value.handle, value.refreshToken]),
  ).toString("base64url");
  if (encoded.length > 3800) throw new BrowserSessionError("unavailable");
  const age = Math.floor(
    (Date.parse(value.sessionExpiresAt) - Date.now()) / 1000,
  );
  if (age <= 0) throw new BrowserSessionError("rejected");
  if (writeCookie)
    context.header(
      "Set-Cookie",
      `${cookieName}=${encoded}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${String(Math.min(age, 28800))}`,
    );
  return context.json(
    {
      schemaVersion: 1,
      accessToken: value.accessToken,
      expiresIn: value.expiresIn,
      sessionExpiresAt: value.sessionExpiresAt,
    },
    200,
  );
}
async function sessionBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new BrowserSessionError("invalid");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array))
        throw new BrowserSessionError("invalid");
      length += chunk.byteLength;
      if (length > 8192) throw new BrowserSessionError("invalid");
      chunks.push(chunk);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } catch {
    throw new BrowserSessionError("invalid");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export function registerBrowserSessionRoutes(
  app: Hono<ApiEnvironment>,
  config?: BrowserSessionRoutes,
): void {
  if (config === undefined) return;
  const origin = new URL(config.publicOrigin);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== config.publicOrigin ||
    origin.username ||
    origin.password
  )
    throw new TypeError("One exact HTTPS browser session origin is required.");
  for (const operation of [
    "exchange",
    "restore",
    "cancel",
    "logout",
  ] as const) {
    app.post("/auth/session/v1/" + operation, async (context) => {
      const site = context.req.header("sec-fetch-site");
      if (
        context.req.header("origin") !== config.publicOrigin ||
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
      context.header("Cache-Control", "no-store, private");
      try {
        const body = await sessionBody(context.req.raw);
        if (operation === "exchange") {
          const input = exchangeSchema.safeParse(body);
          if (!input.success) throw new BrowserSessionError("invalid");
          return grant(context, await config.service.exchange(input.data));
        }
        if (operation === "cancel") {
          const input = cancelSchema.safeParse(body);
          if (!input.success) throw new BrowserSessionError("invalid");
          await config.service.revoke(input.data.handle);
          return context.body(null, 204);
        }
        if (operation === "logout") {
          const input = logoutSchema.safeParse(body);
          if (!input.success) throw new BrowserSessionError("invalid");
          const current = cookie(context);
          if (input.data.handle !== undefined)
            await config.service.revoke(input.data.handle);
          if (current !== undefined)
            await config.service.revoke(current[0], current[1]);
          // Revocation is authoritative. A delayed logout response must not
          // delete a newer sign-in cookie shared by another request or tab.
          return context.body(null, 204);
        }
        if (!emptySchema.safeParse(body).success)
          throw new BrowserSessionError("invalid");
        const current = cookie(context);
        if (current === undefined) throw new BrowserSessionError("rejected");
        return grant(
          context,
          await config.service.restore({
            handle: current[0],
            refreshToken: current[1],
          }),
          false,
        );
      } catch (error) {
        const code =
          error instanceof BrowserSessionError ? error.code : "unavailable";
        // A delayed restore must never replace or clear a newer sign-in cookie.
        return context.json(
          { schemaVersion: 1, error: code },
          code === "invalid" ? 400 : code === "rejected" ? 401 : 503,
        );
      }
    });
  }
}
