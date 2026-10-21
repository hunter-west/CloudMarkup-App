import {
  digestCanonicalValue as digest,
  modelLiveSequenceInputV3Schema,
  modelLiveSequenceAttemptObservationV4Schema,
} from "@cloudmarkup/schemas";
import {
  normalizeModelHostSeedUsageV3,
  type ReviewedPromptTemplateV1,
} from "@cloudmarkup/model-gateway";
import { seedValidationReceiptFixture } from "../../production-model-live-seed-validation-test-helpers.js";
import { seedCandidateExecutionFixture } from "../../production-model-live-seed-candidate-test-helpers.js";
import { createProductionSeedCandidateValidationHost } from "../../production-model-live-seed-candidate-host.js";
import { result } from "../../production-model-live-host-runner-test-helpers.js";
import { syntheticSeedStageInput } from "./model-live-seed-stage-test-helpers.js";
import { prepareModelLiveSeedStageInputV3 } from "./model-live-runtime-host-evidence-codec.js";
export async function firstSeedCandidateObservationFixture(
  kind: "valid" | "repairable" | "nonrepairable" | "cleanup" = "valid",
  prompt?: ReviewedPromptTemplateV1,
) {
  const seed = await seedValidationReceiptFixture();
  const preparedSeed = await seed.host.prepareRepairInput(
    seed.receipt,
    "guided",
  );
  const input = await syntheticSeedStageInput(
    {
      seedReceipt: seed.receipt,
      preparedSeed,
      now: "2026-09-14T12:01:00.000Z",
    },
    prompt,
  );
  const prepared = prepareModelLiveSeedStageInputV3(input);
  const fields = { ...prepared.fields, issuedAt: input.observedAt };
  const stage = modelLiveSequenceInputV3Schema.parse({
    ...fields,
    inputBindingDigest: digest(fields),
  });
  const source = input.invocation.request.failedCandidates[0];
  if (!source) throw Error("Missing fixture source");
  const line =
    source.content
      .split("\n")
      .findIndex(
        (s) => s === 'export const repairSeedTypeWitness: number = "invalid";',
      ) + 1;
  const f = seedCandidateExecutionFixture(
    input.invocation,
    {
      execute: (_n, command) =>
        command.step === "typecheck" &&
        (kind === "repairable" || kind === "nonrepairable")
          ? result(
              kind === "repairable"
                ? source.path +
                    "(" +
                    String(line) +
                    ",14): error TS2322: Type 'string' is not assignable to type 'number'.\n"
                : "Unrelated failure\n",
              { exitCode: 2 },
            )
          : undefined,
      disposed: () => {
        if (kind === "cleanup") throw Error("synthetic cleanup failure");
      },
    },
    kind === "repairable",
  );
  const usage = normalizeModelHostSeedUsageV3({
    descriptor: input.invocation.descriptor,
    providerUsage: f.providerResult.usage,
    result: "succeeded",
    startedAtMilliseconds: Date.parse(input.observedAt) + 1000,
    completedAtMilliseconds: Date.parse(input.observedAt) + 2000,
  });
  const body = {
    contractVersion: 4,
    parentSequenceContractVersion: 3,
    recordKind: "model-live-sequence-attempt-observation",
    ...Object.fromEntries(
      (
        [
          "selectionId",
          "selectionDigest",
          "planDigest",
          "caseId",
          "caseDigest",
          "stageKey",
          "stageId",
          "invocationId",
        ] as const
      ).map((key) => [key, stage[key]]),
    ),
    inputBindingDigest: stage.inputBindingDigest,
    dispatchDigest: digest("synthetic-dispatch"),
    canonicalWorkflowFingerprint: digest("synthetic-workflow"),
    canonicalAttemptOrdinal: 1,
    canonicalAttemptDigest: digest("synthetic-attempt"),
    normalizedUsageDigest: digest(usage),
    observedAt: usage.completedAt,
  };
  const attemptObservation = modelLiveSequenceAttemptObservationV4Schema.parse({
    ...body,
    observationDigest: digest(body),
  });
  const host = await createProductionSeedCandidateValidationHost({
    seed: seed.configuration,
    policy: f.policy,
    executor: f.h.executor,
    now: () => new Date("2026-09-14T12:02:00.000Z"),
  }).run({
    seedReceipt: seed.receipt,
    invocation: input.invocation,
    providerResult: f.providerResult,
    usage,
  });
  return {
    source: input,
    invocation: input.invocation,
    scope: seed.receipt.scope,
    stage,
    usage,
    attemptObservation,
    host,
    issuedAt: "2026-09-14T12:02:01.000Z",
  };
}
