import { z } from "zod";

/** Nonsecret display support only; authenticated admission remains authoritative. */
export const runtimeAiCapabilitiesV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    proposalVersions: z.union([z.tuple([]), z.tuple([z.literal(6)])]),
    applicationSources: z.union([
      z.tuple([]),
      z.tuple([z.literal("ai-source-draft-v3")]),
    ]),
  })
  .strict();

export const UNAVAILABLE_RUNTIME_AI_CAPABILITIES_V1 = Object.freeze({
  schemaVersion: 1 as const,
  proposalVersions: [] as [],
  applicationSources: [] as [],
});

export type RuntimeAiCapabilitiesV1 = z.output<
  typeof runtimeAiCapabilitiesV1Schema
>;
