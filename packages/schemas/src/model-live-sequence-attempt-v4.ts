import { z } from "zod";
import { digestCanonicalValue } from "./canonical-digest.js";
import {
  sha256DigestSchema,
  utcTimestampSchema,
} from "./architecture-document-v1.js";
import {
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceDispatchV3Schema,
  modelLiveSequenceOutcomeV3Schema,
} from "./model-live-evaluation-sequence-v3.js";

function exactDigest(
  value: Record<string, unknown>,
  key: string,
  context: z.RefinementCtx,
) {
  const body = Object.fromEntries(
    Object.entries(value).filter(([name]) => name !== key),
  );
  if (value[key] !== digestCanonicalValue(body))
    context.addIssue({
      code: "custom",
      path: [key],
      message: "The exact complete stage metadata digest is required.",
    });
}
const stage = modelLiveSequenceInputV3Schema.shape;
const boundStage = {
  selectionId: stage.selectionId,
  selectionDigest: stage.selectionDigest,
  planDigest: stage.planDigest,
  caseId: stage.caseId,
  caseDigest: stage.caseDigest,
  stageKey: stage.stageKey,
  stageId: stage.stageId,
  invocationId: stage.invocationId,
};
const version = {
  contractVersion: z.literal(4),
  parentSequenceContractVersion: z.literal(3),
};
function exactOrdinal(
  value: { stageKey: "repair-1" | "repair-2"; canonicalAttemptOrdinal: number },
  context: z.RefinementCtx,
) {
  if (value.canonicalAttemptOrdinal !== (value.stageKey === "repair-1" ? 1 : 2))
    context.addIssue({
      code: "custom",
      path: ["canonicalAttemptOrdinal"],
      message: "The canonical repair ordinal must match its pre-issued stage.",
    });
}
const { canonicalAttemptDigest: legacyFutureAttempt, ...dispatchFields } =
  modelLiveSequenceDispatchV3Schema.shape;
void legacyFutureAttempt;

/** Additive actual-attempt contract over unchanged V3 plan/selection/input.
 * Before HTTP, bind the real accepted workflow and recorded dispatch intent.
 * A completed canonical attempt cannot exist at this boundary. Parsing is never
 * approval, issuance, a reservation or evidence that HTTP actually happened. */
export const modelLiveSequenceDispatchV4Schema = z
  .object({
    ...dispatchFields,
    ...version,
    canonicalWorkflowFingerprint: sha256DigestSchema,
    canonicalDispatchIntentDigest: sha256DigestSchema,
    canonicalPlannedCallDigest: sha256DigestSchema,
    canonicalAttemptOrdinal: z.number().int().min(1).max(2),
  })
  .strict()
  .superRefine((value, context) => {
    exactDigest(value, "dispatchDigest", context);
    exactOrdinal(value, context);
  });
export type ModelLiveSequenceDispatchV4 = z.output<
  typeof modelLiveSequenceDispatchV4Schema
>;

/** Actual known-usage observation after the send, before whole-case settlement.
 * The authenticated host must join the real canonical workflow, planned call,
 * completed attempt and usage. This immutable record does not settle, release,
 * refund or assert final financial truth. */
export const modelLiveSequenceAttemptObservationV4Schema = z
  .object({
    ...version,
    ...boundStage,
    recordKind: z.literal("model-live-sequence-attempt-observation"),
    observationDigest: sha256DigestSchema,
    inputBindingDigest: sha256DigestSchema,
    dispatchDigest: sha256DigestSchema,
    canonicalWorkflowFingerprint: sha256DigestSchema,
    canonicalAttemptOrdinal: z.number().int().min(1).max(2),
    canonicalAttemptDigest: sha256DigestSchema,
    normalizedUsageDigest: sha256DigestSchema,
    observedAt: utcTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    exactDigest(value, "observationDigest", context);
    exactOrdinal(value, context);
  });
export type ModelLiveSequenceAttemptObservationV4 = z.output<
  typeof modelLiveSequenceAttemptObservationV4Schema
>;

const [unused, validated, failed, unknown] =
  modelLiveSequenceOutcomeV3Schema.options;
const {
  commercialTerminalDigest: legacyValidationTerminal,
  ...validatedFields
} = validated.shape;
const { commercialTerminalDigest: legacyFailureTerminal, ...failedFields } =
  failed.shape;
void legacyValidationTerminal;
void legacyFailureTerminal;
const knownUsage = { commercialAttemptObservationDigest: sha256DigestSchema };

/** Stage disposition joins the actual observed attempt, not a fabricated
 * whole-workflow terminal. The case's final canonical terminal is verified
 * separately after its pre-issued stages end. Unknown dispatch stays held. */
export const modelLiveSequenceOutcomeV4Schema = z
  .discriminatedUnion("status", [
    z.object({ ...unused.shape, ...version }).strict(),
    z.object({ ...validatedFields, ...version, ...knownUsage }).strict(),
    z.object({ ...failedFields, ...version, ...knownUsage }).strict(),
    z.object({ ...unknown.shape, ...version }).strict(),
  ])
  .superRefine((value, context) => {
    exactDigest(value, "outcomeDigest", context);
  });
export type ModelLiveSequenceOutcomeV4 = z.output<
  typeof modelLiveSequenceOutcomeV4Schema
>;

export const modelLiveSequenceAttemptRecordV4Schema = z.union([
  modelLiveSequenceDispatchV4Schema,
  modelLiveSequenceAttemptObservationV4Schema,
  modelLiveSequenceOutcomeV4Schema,
]);
export type ModelLiveSequenceAttemptRecordV4 = z.output<
  typeof modelLiveSequenceAttemptRecordV4Schema
>;
