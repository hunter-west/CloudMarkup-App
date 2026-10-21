import { createHash } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { JobQueuePublisherV1 } from "@cloudmarkup/job-framework";
import {
  asyncJobQueueEnvelopeV1Schema,
  asyncJobTrustedOwnershipV1Schema,
  serializeCanonicalJson,
  type AsyncJobQueueEnvelopeV1,
  type AsyncJobTrustedOwnershipV1,
} from "@cloudmarkup/schemas";
import { z } from "zod";

export const SQS_JOB_PUBLICATION_DEADLINE_MILLISECONDS_V1 = 10_000;

const targetSchema = z
  .object({
    queueArn: z.string().min(1).max(256),
    queueUrl: z.string().min(1).max(512),
    region: z
      .string()
      .regex(/^[a-z]{2}(?:-[a-z]+)+-[1-9][0-9]*$/u)
      .max(32),
  })
  .strict()
  .superRefine((value, context) => {
    const match =
      /^arn:aws:sqs:([a-z0-9-]+):([0-9]{12}):([A-Za-z0-9_-]{1,75}\.fifo)$/u.exec(
        value.queueArn,
      );
    const arnRegion = match?.[1];
    const accountId = match?.[2];
    const queueName = match?.[3];
    if (
      arnRegion !== value.region ||
      accountId === undefined ||
      queueName === undefined ||
      value.queueUrl !==
        `https://sqs.${value.region}.amazonaws.com/${accountId}/${queueName}`
    ) {
      context.addIssue({
        code: "custom",
        message: "The fixed FIFO queue identity is invalid.",
      });
    }
  });

export interface SqsJobPublisherOptionsV1 {
  readonly family?: "solution-export-orchestration" | "architecture-proposal";
  readonly target: z.input<typeof targetSchema>;
  /** A current trusted host scopes publication; browser ownership is not authority. */
  readonly ownership: AsyncJobTrustedOwnershipV1;
  /** A real SDK client may be shared by the trusted host. It must use the exact
   * target Region, one SDK attempt and no custom endpoint. Tests intercept send. */
  readonly client?: SQSClient;
  readonly now?: () => Date;
}

export class SqsJobPublicationError extends Error {
  readonly code:
    | "job.publication-invalid"
    | "job.publication-not-due"
    | "job.publication-uncertain";
  constructor(code: SqsJobPublicationError["code"]) {
    super(
      "The job publication is unavailable. Its durable state must be checked before retrying.",
    );
    this.name = "SqsJobPublicationError";
    this.code = code;
  }
}

const digest = (value: unknown) =>
  createHash("sha256").update(serializeCanonicalJson(value)).digest("hex");

/** Real publication-only AWS transport. Never a JobQueue or execution authority.
 * FIFO deduplication is finite; duplicates after five minutes are expected and
 * must be fenced by the real durable worker. No consumer methods are fabricated.
 * A timeout/abort cannot prove non-delivery or retract a late physical send.
 * The same canonical queued record remains available to publication recovery. */
export class SqsJobPublisherV1 implements JobQueuePublisherV1 {
  readonly contractVersion = 1 as const;
  readonly #target: z.output<typeof targetSchema>;
  readonly #family: "solution-export-orchestration" | "architecture-proposal";
  readonly #ownership: AsyncJobTrustedOwnershipV1;
  readonly #client: SQSClient;
  readonly #now: () => Date;

  constructor(options: SqsJobPublisherOptionsV1) {
    try {
      this.#family = options.family ?? "solution-export-orchestration";
      this.#target = Object.freeze(targetSchema.parse(options.target));
      this.#ownership = Object.freeze(
        asyncJobTrustedOwnershipV1Schema.parse(options.ownership),
      );
      if (this.#ownership.projectId === undefined)
        throw new SqsJobPublicationError("job.publication-invalid");
      this.#now = options.now ?? (() => new Date());
      this.#client =
        options.client ??
        new SQSClient({ region: this.#target.region, maxAttempts: 1 });
    } catch {
      throw new SqsJobPublicationError("job.publication-invalid");
    }
  }

  #assertDue(envelope: AsyncJobQueueEnvelopeV1): void {
    const at = this.#now().getTime();
    if (!Number.isFinite(at))
      throw new SqsJobPublicationError("job.publication-invalid");
    if (Date.parse(envelope.availableAt) > at)
      throw new SqsJobPublicationError("job.publication-not-due");
  }

  async publish(input: unknown): Promise<void> {
    let envelope: AsyncJobQueueEnvelopeV1;
    try {
      // Schema parsing copies the complete bounded envelope before the first await.
      envelope = asyncJobQueueEnvelopeV1Schema.parse(input);
      if (
        envelope.family !== this.#family ||
        envelope.ownership.organizationId !== this.#ownership.organizationId ||
        envelope.ownership.projectId !== this.#ownership.projectId
      ) {
        throw new SqsJobPublicationError("job.publication-invalid");
      }
      this.#assertDue(envelope);
    } catch (error) {
      if (error instanceof SqsJobPublicationError) throw error;
      throw new SqsJobPublicationError("job.publication-invalid");
    }
    const body = serializeCanonicalJson(envelope);
    const command = new SendMessageCommand({
      QueueUrl: this.#target.queueUrl,
      MessageBody: body,
      MessageGroupId: digest({
        contractVersion: 1,
        kind: "cloudmarkup.job-message-group",
        queueArn: this.#target.queueArn,
        ownership: envelope.ownership,
        jobId: envelope.jobId,
      }),
      MessageDeduplicationId: digest({
        contractVersion: 1,
        kind: "cloudmarkup.job-publication",
        queueArn: this.#target.queueArn,
        envelope,
      }),
    });
    const controller = new AbortController();
    const stopAt =
      performance.now() + SQS_JOB_PUBLICATION_DEADLINE_MILLISECONDS_V1;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const uncertain = () =>
      new SqsJobPublicationError("job.publication-uncertain");
    const assertActive = () => {
      if (controller.signal.aborted || performance.now() >= stopAt)
        throw uncertain();
    };
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(uncertain());
      }, SQS_JOB_PUBLICATION_DEADLINE_MILLISECONDS_V1);
    });
    const send = async () => {
      const [region, attempts] = await Promise.all([
        this.#client.config.region(),
        this.#client.config.maxAttempts(),
      ]);
      assertActive();
      if (
        region !== this.#target.region ||
        attempts !== 1 ||
        this.#client.config.endpoint !== undefined
      ) {
        throw new SqsJobPublicationError("job.publication-invalid");
      }
      this.#assertDue(envelope);
      assertActive();
      const result = await this.#client.send(command, {
        abortSignal: controller.signal,
      });
      assertActive();
      // MD5 is only the SQS body-ack checksum; SHA-256 above owns identity.
      const bodyAck = createHash("md5").update(body).digest("hex");
      if (
        typeof result.MessageId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(result.MessageId) ||
        result.MD5OfMessageBody !== bodyAck
      )
        throw uncertain();
    };
    try {
      await Promise.race([send(), expired]);
    } catch (error) {
      controller.abort();
      if (error instanceof SqsJobPublicationError) throw error;
      throw uncertain();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
