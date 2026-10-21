import { createHash } from "node:crypto";
import {
  aiIntentPreviewCandidateFrameV1Schema,
  aiIntentPreviewDeliveryProofV1Schema,
  aiIntentPreviewStatusFrameV1Schema,
} from "@cloudmarkup/api-contract";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import {
  createAiIntentPreviewNodeSinkV1,
  type AiIntentPreviewNativeOutputV1,
} from "./ai-intent-preview-node-sink.js";
import {
  checkedAiIntentPreviewStreamLimitsV1,
  encodeAiIntentPreviewFrameV1,
  streamAiIntentPreviewV1,
  type AiIntentPreviewStreamResultV1,
} from "./ai-intent-preview-stream.js";

type FramerInput = Parameters<typeof streamAiIntentPreviewV1>[0];
type Emission = Parameters<Parameters<FramerInput["execute"]>[0]["emit"]>[0];
interface CandidateHandoff {
  readonly digest: string;
  readonly bytes: number;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
  readonly assertCurrentEmission: Emission["assertCurrentEmission"];
}

class NativePreviewUnavailable extends Error {
  constructor() {
    super("The memory-only preview producer is unavailable.");
    this.name = "NativePreviewUnavailable";
  }
}
function requireActive(condition: boolean): asserts condition {
  if (!condition) throw new NativePreviewUnavailable();
}
function frameSelection(bytes: Uint8Array) {
  // This is the exact wire encoding, not the pretty-printed content digest.
  return {
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    bytes: bytes.byteLength,
  };
}
const statuses = aiIntentPreviewStatusFrameV1Schema.shape.code.options.map(
  (code) =>
    frameSelection(
      encodeAiIntentPreviewFrameV1({
        contractVersion: 1,
        type: "status",
        code,
      }),
    ),
);

/** Joins the strict framer to the native final-write guard. Only this request's
 * application emission can install candidate handoff authority. Every native
 * write rechecks current host scope; a candidate additionally rechecks the real
 * application execution closure and exact delivery deadline after backpressure.
 * The authenticated host sets fixed response headers and exclusively owns a
 * fresh binary output. This function creates no model, ACK, credit or storage
 * authority and must never be registered through a buffered JSON response. */
export async function streamAiIntentPreviewToNodeV1(input: {
  readonly output: AiIntentPreviewNativeOutputV1;
  readonly invocationId: string;
  readonly signal: AbortSignal;
  readonly execute: FramerInput["execute"];
  readonly assertCurrentAuthority: () => Promise<{
    readonly expiresAt: string;
  }>;
  readonly limits?: FramerInput["limits"];
}): Promise<AiIntentPreviewStreamResultV1> {
  const identity =
    aiIntentPreviewDeliveryProofV1Schema.shape.invocationId.safeParse(
      input.invocationId,
    );
  requireActive(identity.success);
  const limits = checkedAiIntentPreviewStreamLimitsV1(input.limits);
  let candidate: CandidateHandoff | undefined;
  let candidateClaimed = false;
  const output = createAiIntentPreviewNodeSinkV1({
    output: input.output,
    signal: input.signal,
    limits: {
      candidateFrameBytes: limits.candidateFrameBytes,
      totalBytes: limits.totalBytes,
      backpressureMilliseconds: limits.backpressureMilliseconds,
      deadlineMilliseconds: limits.deadlineMilliseconds,
    },
    authorizeHandoff: async (selection) => {
      const selected =
        candidate?.digest === selection.frameDigest &&
        candidate.bytes === selection.byteLength
          ? candidate
          : undefined;
      requireActive(
        selected !== undefined ||
          statuses.some(
            (status) =>
              status.digest === selection.frameDigest &&
              status.bytes === selection.byteLength,
          ),
      );
      if (selected !== undefined) {
        requireActive(!selected.signal.aborted);
        await selected.assertCurrentEmission();
      }
      const current = await input.assertCurrentAuthority();
      const parsed =
        aiIntentPreviewDeliveryProofV1Schema.shape.expiresAt.safeParse(
          current.expiresAt,
        );
      requireActive(parsed.success);
      const expiresAt = Math.min(
        Date.parse(parsed.data),
        selected?.expiresAt ?? Number.POSITIVE_INFINITY,
      );
      requireActive(
        !input.signal.aborted &&
          !selection.signal.aborted &&
          Date.now() < expiresAt &&
          (selected === undefined ||
            (candidate === selected && !selected.signal.aborted)),
      );
      return { expiresAt: new Date(expiresAt).toISOString() };
    },
  });
  return streamAiIntentPreviewV1({
    output,
    signal: input.signal,
    limits,
    execute: (execution) =>
      input.execute({
        ...(execution.signal === undefined ? {} : { signal: execution.signal }),
        emit: async (value) => {
          requireActive(!candidateClaimed);
          candidateClaimed = true;
          const frame = aiIntentPreviewCandidateFrameV1Schema.parse({
            contractVersion: 1,
            type: "candidate",
            candidate: value.candidate,
            delivery: value.delivery,
          });
          requireActive(frame.delivery.invocationId === identity.data);
          const encoded = encodeAiIntentPreviewFrameV1(frame);
          requireActive(encoded.byteLength <= limits.candidateFrameBytes);
          candidate = {
            ...frameSelection(encoded),
            expiresAt: Date.parse(frame.delivery.expiresAt),
            signal: value.signal,
            assertCurrentEmission: value.assertCurrentEmission,
          };
          try {
            await execution.emit({
              candidate: frame.candidate,
              delivery: {
                ...frame.delivery,
                outputDigest: sha256DigestSchema.parse(
                  frame.delivery.outputDigest,
                ),
              },
              signal: candidate.signal,
              assertCurrentEmission: candidate.assertCurrentEmission,
            });
          } finally {
            candidate = undefined;
          }
        },
      }),
  });
}
