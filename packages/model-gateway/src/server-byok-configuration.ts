import { z } from "zod";

export const SERVER_BYOK_OPENAI_ENDPOINT_V1 =
  "https://api.openai.com/v1/responses" as const;

const roleSchema = z
  .object({
    // Pin an explicit snapshot: a mutable alias cannot satisfy the response's
    // exact model identity or a durable replay/cost binding.
    model: z.string().regex(/^[a-z][a-z0-9.-]{0,70}-\d{4}-\d{2}-\d{2}$/u),
    maximumOutputTokens: z.number().int().min(1).max(12000),
  })
  .strict();

const configurationSchema = z
  .object({
    contractVersion: z.literal(1),
    provider: z.literal("openai-responses"),
    endpoint: z.literal(SERVER_BYOK_OPENAI_ENDPOINT_V1),
    credentialReference: z.string().regex(/^operator\.[a-z][a-z0-9.-]{0,95}$/),
    usageSemantics: z.literal("openai-responses-tokens.v1"),
    roles: z
      .object({
        architecture: roleSchema,
        applicationSource: roleSchema,
      })
      .strict(),
    limits: z
      .object({
        maximumInputBytes: z.number().int().min(1).max(1048576),
        maximumRequestBytes: z.number().int().min(1).max(2097152),
        maximumResponseBytes: z.number().int().min(1).max(1048576),
        deadlineMilliseconds: z.number().int().min(1).max(120000),
      })
      .strict(),
  })
  .strict();

export type ServerByokConfigurationV1 = z.output<typeof configurationSchema>;
export type ServerByokRoleV1 = keyof ServerByokConfigurationV1["roles"];

/** Trusted server configuration only. No default key, model, endpoint or role.
 * Credentials are resolved separately and never become configuration data. */
export function requireServerByokConfigurationV1(
  raw: unknown,
): ServerByokConfigurationV1 {
  try {
    const value = configurationSchema.parse(structuredClone(raw));
    if (
      value.roles.architecture.maximumOutputTokens > 6144 ||
      value.limits.maximumInputBytes > value.limits.maximumRequestBytes
    )
      throw new Error();
    Object.values(value.roles).forEach(Object.freeze);
    Object.freeze(value.roles);
    Object.freeze(value.limits);
    return Object.freeze(value);
  } catch {
    throw new Error("Server BYOK configuration is unavailable.");
  }
}
