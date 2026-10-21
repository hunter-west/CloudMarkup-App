import { z } from "zod";
import { repositoryRelativePathSchema } from "./repository-ownership-v1.js";
import { sha256DigestSchema } from "./architecture-document-v1.js";

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const fieldSegment = z.union([
  z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u)
    .refine(
      (value) => !["__proto__", "prototype", "constructor"].includes(value),
      "Must be a safe field name.",
    ),
  z.number().int().min(0).max(1024),
]);
const fieldPath = z.array(fieldSegment).min(1).max(8).optional();

/** Presentation provenance only: no lookup, selector evaluation or authority. */
export const exportDiagnosticReferenceV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), id, fieldPath }).strict(),
  z.object({ kind: z.literal("edge"), id, fieldPath }).strict(),
  z.object({ kind: z.literal("owned-policy"), id }).strict(),
  z.object({ kind: z.literal("workload"), id }).strict(),
  z
    .object({
      kind: z.literal("repository"),
      path: repositoryRelativePathSchema,
    })
    .strict(),
]);

export interface ExportDiagnosticRecoveryReferencesV1 {
  contractVersion: 1;
  locations: ExportDiagnosticReferenceV1[];
}

// Keep the public operation registry's declaration size bounded.
export const exportDiagnosticRecoveryReferencesV1Schema: z.ZodType<ExportDiagnosticRecoveryReferencesV1> =
  z
    .object({
      contractVersion: z.literal(1),
      locations: z.array(exportDiagnosticReferenceV1Schema).min(1).max(32),
    })
    .strict();

export type ExportDiagnosticReferenceV1 = z.output<
  typeof exportDiagnosticReferenceV1Schema
>;

/** Untrusted navigation data, checked again against authorized immutable reads. */
export const exportDiagnosticRecoveryRequestV1Schema = z
  .object({
    contractVersion: z.literal(1),
    jobId: id,
    solutionRevisionId: id,
    manifestDigest: sha256DigestSchema,
    code: z
      .string()
      .min(3)
      .max(128)
      .regex(/^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)+$/u),
    reference: exportDiagnosticReferenceV1Schema,
  })
  .strict();
export type ExportDiagnosticRecoveryRequestV1 = z.output<
  typeof exportDiagnosticRecoveryRequestV1Schema
>;
