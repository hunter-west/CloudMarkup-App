import { z } from "zod";
import {
  createDataEnvelopeSchema,
  createListEnvelopeSchema,
  utcTimestampSchema,
} from "./common.js";
import { organizationIdSchema, principalIdSchema } from "./resources.js";

export const gitlabConnectionIdV1Schema = z
  .string()
  .regex(/^gitlab_[a-f0-9]{32}$/u);
export const gitlabLinkIntentIdV1Schema = z
  .string()
  .regex(/^gitlablink_[a-f0-9]{32}$/u);
const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const authorizationUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const match = /^https:\/\/gitlab\.com\/oauth\/authorize\?([^#]*)$/u.exec(
      value,
    );
    if (!match) return false;
    const keys = [
      "client_id",
      "redirect_uri",
      "response_type",
      "state",
      "scope",
      "code_challenge",
      "code_challenge_method",
    ];
    const parameters = new Map<string, string>();
    try {
      for (const pair of (match[1] ?? "").split("&")) {
        const separator = pair.indexOf("=");
        if (separator < 1) return false;
        const key = decodeURIComponent(
          pair.slice(0, separator).replaceAll("+", " "),
        );
        const entry = decodeURIComponent(
          pair.slice(separator + 1).replaceAll("+", " "),
        );
        if (!keys.includes(key) || parameters.has(key)) return false;
        parameters.set(key, entry);
      }
    } catch {
      return false;
    }
    if (
      parameters.size !== keys.length ||
      parameters.get("response_type") !== "code" ||
      parameters.get("scope") !== "api" ||
      parameters.get("code_challenge_method") !== "S256" ||
      !/^[a-f0-9]{64}$/u.test(parameters.get("client_id") ?? "") ||
      !state.safeParse(parameters.get("state")).success ||
      !state.safeParse(parameters.get("code_challenge")).success
    )
      return false;
    const redirect = parameters.get("redirect_uri") ?? "";
    return (
      /^https:\/\/[^/?#@\s]+(?:\/[^?#]*)?$/u.test(redirect) &&
      z.url({ protocol: /^https$/u }).safeParse(redirect).success
    );
  }, "Must be a bounded GitLab.com authorization-code URL with S256 PKCE.");

export const createGitlabLinkIntentV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();
export const gitlabLinkIntentV1Schema = z
  .object({
    contractVersion: z.literal(1),
    intentId: gitlabLinkIntentIdV1Schema,
    authorizationUrl,
    expiresAt: utcTimestampSchema,
  })
  .strict();
export const completeGitlabLinkV1Schema = z
  .object({
    contractVersion: z.literal(1),
    intentId: gitlabLinkIntentIdV1Schema,
    state,
    code: z
      .string()
      .min(20)
      .max(4096)
      .regex(/^[A-Za-z0-9._~+/-]+={0,2}$/u),
  })
  .strict();
export const disconnectGitlabConnectionV1Schema = z
  .object({ contractVersion: z.literal(1) })
  .strict();
export const gitlabConnectionV1Schema = z
  .object({
    contractVersion: z.literal(1),
    id: gitlabConnectionIdV1Schema,
    organizationId: organizationIdSchema,
    principalId: principalIdSchema,
    providerUsername: z.string().min(1).max(255),
    status: z.enum([
      "active",
      "refreshing",
      "reconnect-required",
      "disconnected",
      "revoked",
    ]),
    providerRevocation: z.enum([
      "not-requested",
      "pending",
      "requires-user-action",
      "confirmed",
    ]),
  })
  .strict()
  .refine((value) => {
    if (value.status === "revoked")
      return value.providerRevocation === "confirmed";
    if (value.status === "disconnected")
      return (
        value.providerRevocation === "pending" ||
        value.providerRevocation === "requires-user-action"
      );
    if (value.status === "reconnect-required")
      return value.providerRevocation === "requires-user-action";
    return value.providerRevocation === "not-requested";
  }, "Connection and provider-revocation states must agree.");
export const gitlabConnectionCollectionPathV1Schema = z
  .object({ organizationId: organizationIdSchema })
  .strict();
export const gitlabConnectionPathV1Schema =
  gitlabConnectionCollectionPathV1Schema
    .extend({ connectionId: gitlabConnectionIdV1Schema })
    .strict();
export const gitlabConnectionListQueryV1Schema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: gitlabConnectionIdV1Schema.optional(),
  })
  .strict();
export const gitlabLinkIntentResponseV1Schema = createDataEnvelopeSchema(
  gitlabLinkIntentV1Schema,
);
export const gitlabConnectionResponseV1Schema = createDataEnvelopeSchema(
  gitlabConnectionV1Schema,
);
export const gitlabConnectionListResponseV1Schema = createListEnvelopeSchema(
  gitlabConnectionV1Schema,
);
export type GitlabLinkIntentV1 = z.output<typeof gitlabLinkIntentV1Schema>;
export type CompleteGitlabLinkV1 = z.output<typeof completeGitlabLinkV1Schema>;
export type GitlabConnectionV1 = z.output<typeof gitlabConnectionV1Schema>;
