import { deriveAsyncJobQueueEnvelopeV1 } from "@cloudmarkup/domain";
import {
  parseAsyncJobRecordV1,
  serializeCanonicalJson,
  type AsyncJobQueueEnvelopeV1,
} from "@cloudmarkup/schemas";
import type {
  JobClock,
  JobPublicationReadinessPort,
  JobPublicationTransportV1,
  JobQueue,
  JobQueuePublisherV1,
  JobRepository,
} from "./framework-ports.js";
import { JobFrameworkError } from "./framework-contracts.js";

function isQueue(value: unknown): value is JobQueue {
  return (
    typeof value === "object" &&
    value !== null &&
    "publish" in value &&
    typeof value.publish === "function" &&
    "receive" in value &&
    typeof value.receive === "function" &&
    "acknowledge" in value &&
    typeof value.acknowledge === "function" &&
    "release" in value &&
    typeof value.release === "function"
  );
}
function isPublisher(value: unknown): value is JobQueuePublisherV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    value.contractVersion === 1 &&
    "publish" in value &&
    typeof value.publish === "function"
  );
}

/** Validate untyped host construction before any admission or storage writes.
 * Returns the selected real object; no synthetic consumer methods are added. */
export function selectJobPublicationTransportV1(
  input: unknown,
): JobPublicationTransportV1 {
  if (typeof input === "object" && input !== null) {
    const hasQueue = Object.hasOwn(input, "queue");
    const hasPublisher = Object.hasOwn(input, "publisher");
    const queue: unknown = Object.getOwnPropertyDescriptor(
      input,
      "queue",
    )?.value;
    const publisher: unknown = Object.getOwnPropertyDescriptor(
      input,
      "publisher",
    )?.value;
    if (hasQueue && !hasPublisher && isQueue(queue)) return { queue };
    if (hasPublisher && !hasQueue && isPublisher(publisher))
      return { publisher };
  }
  throw new JobFrameworkError(
    "job.publication-transport-invalid",
    "Exactly one valid queue or version-one publisher is required.",
  );
}

/** All service/worker publication paths share the export preparation fence. */
export async function publishReadyJobEnvelope(
  dependencies: JobPublicationTransportV1 & {
    readonly clock: JobClock;
    readonly repository: JobRepository;
    readonly publicationReadiness?: JobPublicationReadinessPort;
  },
  envelope: AsyncJobQueueEnvelopeV1,
): Promise<boolean> {
  const transport = selectJobPublicationTransportV1(dependencies);
  const publish = (value: AsyncJobQueueEnvelopeV1) =>
    transport.publisher !== undefined
      ? transport.publisher.publish(value)
      : transport.queue.publish(value);
  if (envelope.family !== "solution-export-orchestration") {
    await publish(envelope);
    return true;
  }
  const gate = dependencies.publicationReadiness;
  if (gate === undefined) return false;
  const before = await dependencies.repository.get(envelope.jobId);
  if (
    before?.state !== "queued" ||
    serializeCanonicalJson(deriveAsyncJobQueueEnvelopeV1(before)) !==
      serializeCanonicalJson(envelope) ||
    before.cancellation.state !== "none" ||
    !(await gate.isReady(parseAsyncJobRecordV1(before)))
  )
    return false;
  // Readiness may await storage. Never publish the pre-await record/version.
  const current = await dependencies.repository.get(envelope.jobId);
  const now = dependencies.clock.now().getTime();
  if (
    !Number.isFinite(now) ||
    current?.state !== "queued" ||
    current.cancellation.state !== "none" ||
    (current.expiresAt !== undefined && Date.parse(current.expiresAt) <= now) ||
    serializeCanonicalJson(current) !== serializeCanonicalJson(before)
  )
    return false;
  await publish(deriveAsyncJobQueueEnvelopeV1(current));
  return true;
}
