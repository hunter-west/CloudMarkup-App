import { z } from "zod";
import {
  digestStructuredValue,
  parseModelHostSeedResponseV3,
  parseModelHostSeedPatchResponseV2,
  parseModelHostRepairSuccessorPatchResponseV4,
  sha256Text,
} from "@cloudmarkup/model-gateway";
import {
  modelHostSeedRepairRequestV2Schema,
  modelHostRepairSuccessorRequestV3Schema,
} from "@cloudmarkup/schemas";
import { applyExactUnifiedPatch } from "./patch.js";
import {
  candidateContentSafetyDiagnostics,
  utf8ByteLength,
} from "./security.js";

const limitsSchema = z
  .object({
    maximumFileBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
    maximumPatchHunks: z.number().int().positive().max(256),
  })
  .strict();
export class HostSeedCandidateMaterializationError extends Error {
  readonly code = "model-live.seed-candidate-unavailable";
  constructor() {
    super("The exact bounded host repair candidate is unavailable.");
    this.name = "HostSeedCandidateMaterializationError";
  }
}
/** Pure RAM-only materialization. The production host must separately bind the
 * actual fixed source, issued stage, provider response and known usage. No
 * current authority, validation receipt, export or file write is performed. */
type HostSeedMaterializationInput = Parameters<
  typeof parseModelHostSeedResponseV3
>[0] & {
  readonly limits: z.output<typeof limitsSchema>;
};
export function materializeHostSeedRepairCandidateV3(
  input: HostSeedMaterializationInput,
) {
  return materializeHostSeedRepair(input, false);
}
export function materializeHostSeedRepairPatchV2(
  input: HostSeedMaterializationInput,
) {
  return materializeHostSeedRepair(input, true);
}
function materializeHostSeedRepair(
  input: HostSeedMaterializationInput,
  hostDigest: boolean,
) {
  try {
    const limits = limitsSchema.parse(input.limits);
    const request = modelHostSeedRepairRequestV2Schema.parse(input.request);
    const response = hostDigest
      ? parseModelHostSeedPatchResponseV2(input)
      : parseModelHostSeedResponseV3(input);
    return materializeParsedRepair({
      descriptor: input.descriptor,
      request,
      response,
      limits,
    });
  } catch {
    throw new HostSeedCandidateMaterializationError();
  }
}

/** Final repair applies only to the exact retained predecessor bytes. */
export function materializeHostRepairSuccessorPatchV4(
  input: Parameters<typeof parseModelHostRepairSuccessorPatchResponseV4>[0] & {
    readonly limits: z.output<typeof limitsSchema>;
  },
) {
  try {
    const request = modelHostRepairSuccessorRequestV3Schema.parse(
      input.request,
    );
    const response = parseModelHostRepairSuccessorPatchResponseV4(input);
    const limits = limitsSchema.parse(input.limits);
    return materializeParsedRepair({
      descriptor: input.descriptor,
      request,
      response,
      limits,
    });
  } catch {
    throw new HostSeedCandidateMaterializationError();
  }
}

function materializeParsedRepair({
  descriptor,
  request,
  response,
  limits,
}: {
  readonly descriptor: Pick<
    HostSeedMaterializationInput["descriptor"],
    "inputDigest" | "invocationId"
  >;
  readonly request:
    | z.output<typeof modelHostSeedRepairRequestV2Schema>
    | z.output<typeof modelHostRepairSuccessorRequestV3Schema>;
  readonly response:
    | ReturnType<typeof parseModelHostSeedResponseV3>
    | ReturnType<typeof parseModelHostSeedPatchResponseV2>;
  readonly limits: z.output<typeof limitsSchema>;
}) {
  const source = request.failedCandidates[0];
  const candidate = response.candidateBundle.candidates[0];
  if (
    source === undefined ||
    candidate?.kind !== "patch" ||
    response.candidateBundle.candidates.length !== 1 ||
    response.candidateBundle.dependencies.length !== 0 ||
    candidate.path !== source.path ||
    candidate.baseDigest !== source.contentDigest ||
    utf8ByteLength(source.content) > limits.maximumFileBytes
  )
    throw new HostSeedCandidateMaterializationError();
  const content = applyExactUnifiedPatch({
    path: source.path,
    baseContent: source.content,
    unifiedDiff: candidate.unifiedDiff,
    limits: {
      maximumHunks: limits.maximumPatchHunks,
      maximumOutputBytes: limits.maximumFileBytes,
    },
  });
  const digest = sha256Text(content);
  if (
    ("proposedResultDigest" in candidate &&
      digest !== candidate.proposedResultDigest) ||
    candidateContentSafetyDiagnostics(content, "application").length !== 0
  )
    throw new HostSeedCandidateMaterializationError();
  return Object.freeze({
    path: source.path,
    content,
    digest,
    encoding: "utf-8" as const,
    ownership: "user-owned-preserved" as const,
    sourceAuthority: "unaccepted-model-repair" as const,
    baseDigest: source.contentDigest,
    patchDigest: sha256Text(candidate.unifiedDiff),
    responseDigest: digestStructuredValue(response),
    inputDigest: descriptor.inputDigest,
    invocationId: descriptor.invocationId,
  });
}
