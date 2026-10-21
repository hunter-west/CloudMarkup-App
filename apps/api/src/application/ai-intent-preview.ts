import { parseIntentDocument } from "@cloudmarkup/domain";
import {
  assertIntentModelOperationBindingV1,
  digestStructuredValue,
  inspectModelValueForSecretCandidatesV1,
  INTENT_PREVIEW_ACKNOWLEDGEMENT_MILLISECONDS,
  invokeReservedIntentModelV1,
  serializedByteLength,
  verifyModelRuntimeInvocationOutputV1,
  type IntentModelResultV1,
  type ModelGateway,
  type ModelGatewayInvocationContextV1,
  type ModelRequestFor,
  type ModelRuntimeControlExecutionInputV1,
  type ModelRuntimeControlServiceV1,
  type ModelRuntimeHostEvidenceVerifierV1,
  type ModelRuntimeSanitizedOutputEvidenceV1,
} from "@cloudmarkup/model-gateway";
import { modelGatewayRequestV1Schema } from "@cloudmarkup/schemas";
import {
  AiIntentPreviewError,
  type AiIntentPreviewBindingV1,
  type AiIntentPreviewDeliveryProofV1,
  type AiIntentPreviewJournalV1,
} from "./ai-intent-preview-journal.js";

export interface AiIntentPreviewResolvedV1 {
  readonly baseline: {
    readonly draftEtag: string;
    readonly editingLeaseId: string;
  };
  readonly context: ModelGatewayInvocationContextV1;
  readonly modelRequest: ModelRequestFor<"intent.extract">;
  readonly runtime: ModelRuntimeControlExecutionInputV1;
}
export interface AiIntentPreviewHostV1 {
  /** Fresh authentication/current membership, project, baseline and editing
   * lease proof; the closure owns the request's raw lease proof in RAM only. */
  assertCurrentAuthority(input: AiIntentPreviewResolvedV1): Promise<void>;
  issueOutputEvidence(input: {
    readonly resolved: AiIntentPreviewResolvedV1;
    readonly result: IntentModelResultV1;
  }): Promise<ModelRuntimeSanitizedOutputEvidenceV1>;
}
function requirePreview(value: boolean): asserts value {
  if (!value) throw new AiIntentPreviewError();
}
async function withinDeliveryWindow(
  work: (signal: AbortSignal, invalidate: () => void) => Promise<void>,
  stopAt: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const remaining = stopAt - performance.now();
  requirePreview(remaining > 0 && signal?.aborted !== true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const emission = new AbortController();
  const expired = new Promise<never>((_resolve, reject) => {
    abort = () => {
      emission.abort();
      reject(new AiIntentPreviewError());
    };
    timer = setTimeout(abort, remaining);
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([
      work(emission.signal, () => {
        abort?.();
      }),
      expired,
    ]);
  } catch (error) {
    emission.abort();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener("abort", abort);
  }
}

/** Recomputable metadata identity. It never serializes the prompt into storage. */
export function aiIntentPreviewBindingV1(
  resolved: AiIntentPreviewResolvedV1,
): AiIntentPreviewBindingV1 {
  const request = modelGatewayRequestV1Schema.parse(resolved.modelRequest);
  requirePreview(
    request.operation === "intent.extract" &&
      resolved.context.scope.jobId !== undefined &&
      resolved.context.scope.projectId !== undefined &&
      resolved.context.routingDecision?.routeId === "standard-design" &&
      resolved.runtime.liveEvaluationAuthority === undefined &&
      resolved.runtime.admissionRequest.executionClass === "normal" &&
      inspectModelValueForSecretCandidatesV1(request).detectedValueCount === 0,
  );
  assertIntentModelOperationBindingV1({
    commercial: resolved.runtime.commercialRequest,
    context: resolved.context,
    model: request,
  });
  const inputDigest = digestStructuredValue({
    request,
    scope: resolved.context.scope,
  });
  requirePreview(
    resolved.runtime.admissionRequest.inputDigest === inputDigest &&
      resolved.runtime.inputEvidence.inputDigest === inputDigest &&
      digestStructuredValue(resolved.runtime.routingDecision) ===
        digestStructuredValue(resolved.context.routingDecision) &&
      digestStructuredValue(resolved.runtime.routingRequest) ===
        digestStructuredValue(resolved.context.routingRequest),
  );
  return {
    contractVersion: 1,
    scope: structuredClone(resolved.context.scope),
    request: structuredClone(resolved.runtime.commercialRequest),
    invocationId: resolved.context.invocationId,
    idempotencyKeyDigest: resolved.context.idempotencyKeyDigest,
    inputDigest,
    previewBindingDigest: digestStructuredValue({
      baseline: resolved.baseline,
      context: resolved.context,
      runtime: resolved.runtime,
      policy: "intent-preview-delivery-v1",
    }),
  };
}

/** A callback-only lane through the real runtime and one canonical commercial
 * entry. A production factory must supply the strict single-attempt gateway
 * with the actual final HTTP spending fence; this class activates no provider. */
export class AiIntentPreviewApplication {
  readonly #gateway: ModelGateway;
  readonly #runtime: Pick<ModelRuntimeControlServiceV1, "execute">;
  readonly #journal: AiIntentPreviewJournalV1;
  readonly #host: AiIntentPreviewHostV1;
  readonly #verifier: ModelRuntimeHostEvidenceVerifierV1;
  readonly #now: () => Date;
  constructor(input: {
    readonly gateway: ModelGateway;
    readonly runtime: Pick<ModelRuntimeControlServiceV1, "execute">;
    readonly journal: AiIntentPreviewJournalV1;
    readonly host: AiIntentPreviewHostV1;
    readonly evidenceVerifier: ModelRuntimeHostEvidenceVerifierV1;
    readonly now?: () => Date;
  }) {
    this.#gateway = input.gateway;
    this.#runtime = input.runtime;
    this.#journal = input.journal;
    this.#host = input.host;
    this.#verifier = input.evidenceVerifier;
    this.#now = input.now ?? (() => new Date());
  }
  async execute(input: {
    readonly resolved: AiIntentPreviewResolvedV1;
    readonly emit: (value: {
      readonly candidate: IntentModelResultV1["response"];
      readonly delivery: AiIntentPreviewDeliveryProofV1;
      /** Transport MUST check this immediately before writing bytes, stop on
       * abort, and never report a late write as acknowledged delivery. */
      readonly signal: AbortSignal;
      /** Host-owned exact execution/authentication/deadline assertion. A real
       * transport must await this immediately before writing candidate bytes. */
      readonly assertCurrentEmission: () => Promise<void>;
    }) => Promise<void>;
    readonly signal?: AbortSignal;
  }) {
    const resolved = structuredClone(input.resolved);
    const canceled = () => input.signal?.aborted === true;
    await this.#host.assertCurrentAuthority(resolved);
    requirePreview(
      digestStructuredValue(aiIntentPreviewBindingV1(resolved)) ===
        digestStructuredValue(this.#journal.binding),
    );
    const deliveryState = { emitted: false };
    const execution = await this.#runtime.execute(
      resolved.runtime,
      async (admitted) => {
        const assertExecution = admitted.assertCurrentExecution;
        requirePreview(
          typeof assertExecution === "function" &&
            digestStructuredValue(admitted.inputEvidence) ===
              digestStructuredValue(resolved.runtime.inputEvidence),
        );
        await assertExecution();
        await this.#host.assertCurrentAuthority(resolved);
        requirePreview(!canceled());
        await this.#journal.prepare(admitted.commercial);
        await assertExecution();
        await this.#host.assertCurrentAuthority(resolved);
        requirePreview(!canceled());
        const invoked = await invokeReservedIntentModelV1({
          callback: admitted.commercial,
          clock: { now: this.#now },
          commercialRequest: resolved.runtime.commercialRequest,
          context: resolved.context,
          gateway: this.#gateway,
          modelRequest: resolved.modelRequest,
          usageEvidence: this.#journal,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        if (invoked.modelResult === null)
          return { commercial: invoked.commercial, output: null };
        const result = invoked.modelResult;
        requirePreview(
          result.response.operation === "intent.extract" &&
            inspectModelValueForSecretCandidatesV1(result.response)
              .detectedValueCount === 0,
        );
        parseIntentDocument(result.response.intentDocument);
        const output = await this.#host.issueOutputEvidence({
          resolved,
          result,
        });
        requirePreview(
          output.outputDigest === digestStructuredValue(result.response) &&
            output.outputBytes === serializedByteLength(result.response),
        );
        const checked = await verifyModelRuntimeInvocationOutputV1(
          { commercial: invoked.commercial, output },
          {
            admissionRequest: resolved.runtime.admissionRequest,
            commercialRequest: resolved.runtime.commercialRequest,
            evidenceVerifier: this.#verifier,
            liveEvaluationAuthority: undefined,
            policy: resolved.runtime.policy,
            routingDecision: resolved.runtime.routingDecision,
          },
        );
        requirePreview(!checked.rejected && checked.output !== null);
        await assertExecution();
        await this.#host.assertCurrentAuthority(resolved);
        const stopAt =
          performance.now() + INTENT_PREVIEW_ACKNOWLEDGEMENT_MILLISECONDS;
        const proof = await this.#journal.prepareDelivery(checked.output);
        try {
          await assertExecution();
          await this.#host.assertCurrentAuthority(resolved);
          requirePreview(!canceled());
          await withinDeliveryWindow(
            (signal, invalidate) => {
              const emissionCanceled = () => signal.aborted;
              const assertCurrentEmission = async () => {
                try {
                  requirePreview(
                    !emissionCanceled() &&
                      !canceled() &&
                      performance.now() < stopAt,
                  );
                  await assertExecution();
                  await this.#host.assertCurrentAuthority(resolved);
                  requirePreview(
                    !emissionCanceled() &&
                      !canceled() &&
                      performance.now() < stopAt,
                  );
                } catch {
                  invalidate();
                  throw new AiIntentPreviewError();
                }
              };
              return input.emit({
                candidate: result.response,
                delivery: proof,
                signal,
                assertCurrentEmission,
              });
            },
            stopAt,
            input.signal,
          );
          deliveryState.emitted = true;
        } catch {
          await this.#journal.closeDelivery();
          throw new AiIntentPreviewError();
        }
        let outcome = await this.#journal.deliveryOutcome();
        while (outcome.kind === "pending") {
          if (canceled() || performance.now() >= stopAt)
            await this.#journal.closeDelivery();
          else
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 250);
            });
          outcome = await this.#journal.deliveryOutcome();
        }
        requirePreview(outcome.kind === "terminal");
        await assertExecution();
        await this.#host.assertCurrentAuthority(resolved);
        return {
          commercial: outcome.commercial,
          output: outcome.acknowledged ? checked.output : null,
        };
      },
    );
    return {
      contractVersion: 1 as const,
      delivery: deliveryState.emitted
        ? ("memory-only" as const)
        : ("result-unavailable" as const),
      execution,
    };
  }
}
