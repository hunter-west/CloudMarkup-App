import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseResumingException,
  ExecuteStatementCommand,
  RDSDataClient,
  RollbackTransactionCommand,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";

import { RepositoryError } from "../../application/persistence.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlResult,
  SqlRow,
  SqlStatement,
  SqlValue,
} from "./sql.js";

export interface RdsDataApiDatabaseConfig {
  readonly client?: RDSDataClient;
  readonly database: string;
  readonly resourceArn: string;
  readonly secretArn: string;
  /** Absent by default. Hosts must explicitly budget Aurora resume before
   * enabling pause; this never retries an ambiguous transport/SQL failure. */
  readonly resumeRetry?: RdsDataApiResumeRetryPolicy;
}

export interface RdsDataApiResumeRetryPolicy {
  readonly maxElapsedMilliseconds: number;
  /** Total sends, including the initial attempt; SDK retries stay at one. */
  readonly maxAttempts: number;
  readonly abortSignal?: AbortSignal;
}

interface RdsDataExecutorConfig extends RdsDataApiDatabaseConfig {
  readonly client: RDSDataClient;
  readonly transactionId?: string;
}

function resumeUnavailable(): RepositoryError {
  return new RepositoryError(
    "persistence-unavailable",
    "The database is temporarily unavailable.",
  );
}

function resumePolicy(
  policy: RdsDataApiResumeRetryPolicy,
): RdsDataApiResumeRetryPolicy {
  if (
    !Number.isSafeInteger(policy.maxElapsedMilliseconds) ||
    policy.maxElapsedMilliseconds < 1 ||
    policy.maxElapsedMilliseconds > 60_000 ||
    !Number.isSafeInteger(policy.maxAttempts) ||
    policy.maxAttempts < 2 ||
    policy.maxAttempts > 20 ||
    (policy.abortSignal !== undefined &&
      !(policy.abortSignal instanceof AbortSignal))
  ) {
    throw new TypeError("The database resume retry policy is invalid.");
  }
  return Object.freeze({ ...policy });
}

async function assertSingleSdkAttempt(config: RdsDataExecutorConfig) {
  if (config.resumeRetry === undefined) return;
  // A custom retry policy must not sit on top of SDK retries for unrelated
  // errors, particularly an ambiguous statement or CommitTransaction outcome.
  if ((await config.client.config.maxAttempts()) !== 1) {
    throw resumeUnavailable();
  }
}

function assertResumeActive(signal: AbortSignal, deadline: number): void {
  if (signal.aborted || performance.now() >= deadline)
    throw resumeUnavailable();
}

function resumeDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      reject(resumeUnavailable());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function sendWithResumeRetry<TResult>(
  send: (signal: AbortSignal) => Promise<TResult>,
  policy: RdsDataApiResumeRetryPolicy,
): Promise<TResult> {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  if (policy.abortSignal?.aborted) throw resumeUnavailable();
  policy.abortSignal?.addEventListener("abort", abort, { once: true });
  const deadline = performance.now() + policy.maxElapsedMilliseconds;
  const timeout = setTimeout(abort, policy.maxElapsedMilliseconds);
  const canceled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        reject(resumeUnavailable());
      },
      { once: true },
    );
  });
  const attempt = async () => {
    for (let index = 0; index < policy.maxAttempts; index += 1) {
      assertResumeActive(controller.signal, deadline);
      try {
        const result = await send(controller.signal);
        assertResumeActive(controller.signal, deadline);
        return result;
      } catch (error) {
        // AWS documents this specific exception as a canceled request that
        // starts resuming Aurora. A name-shaped error is insufficient evidence.
        if (!(error instanceof DatabaseResumingException)) throw error;
        if (index + 1 >= policy.maxAttempts) throw resumeUnavailable();
        const remaining = deadline - performance.now();
        assertResumeActive(controller.signal, deadline);
        const backoff = Math.min(1_000 * 2 ** index, 3_000);
        const delay = Math.min(
          remaining,
          Math.max(1, Math.floor(backoff * (0.5 + Math.random() * 0.5))),
        );
        await resumeDelay(delay, controller.signal);
      }
    }
    throw resumeUnavailable();
  };
  try {
    // A stalled transport must not defeat the budget, even if a custom client
    // ignores abort. A late outcome is uncertain and never triggers replay.
    return await Promise.race([attempt(), canceled]);
  } finally {
    clearTimeout(timeout);
    policy.abortSignal?.removeEventListener("abort", abort);
    controller.abort();
  }
}

function encodeValue(value: SqlValue): SqlParameter["value"] {
  if (value === null) {
    return { isNull: true };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "bigint") {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      return { stringValue: value.toString() };
    }
    return { longValue: Number(value) };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RepositoryError(
        "invalid-input",
        "A database value is invalid.",
      );
    }
    return Number.isInteger(value)
      ? { longValue: value }
      : { doubleValue: value };
  }
  if (typeof value === "string") {
    return { stringValue: value };
  }
  return { blobValue: value };
}

export function convertPositionalParameters(statement: SqlStatement): {
  readonly parameters: SqlParameter[];
  readonly sql: string;
} {
  const used = new Set<number>();
  const converted = statement.text.replace(
    /\$(\d+)/g,
    (_match, indexText: string) => {
      const index = Number.parseInt(indexText, 10);
      if (index < 1 || index > statement.values.length) {
        throw new RepositoryError(
          "invalid-input",
          "A database statement has an invalid parameter binding.",
        );
      }
      used.add(index);
      return `:p${String(index)}`;
    },
  );

  if (used.size !== statement.values.length) {
    throw new RepositoryError(
      "invalid-input",
      "A database statement has an unused parameter binding.",
    );
  }

  return {
    parameters: statement.values.map((value, index) => ({
      name: `p${String(index + 1)}`,
      value: encodeValue(value),
    })),
    sql: converted,
  };
}

class RdsDataExecutor implements SqlExecutor {
  readonly #config: RdsDataExecutorConfig;

  constructor(config: RdsDataExecutorConfig) {
    this.#config = config;
  }

  async query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    const converted = convertPositionalParameters(statement);
    const command = new ExecuteStatementCommand({
      database: this.#config.database,
      formatRecordsAs: "JSON",
      resultSetOptions: {
        decimalReturnType: "STRING",
        longReturnType: "STRING",
      },
      includeResultMetadata: true,
      parameters: converted.parameters,
      resourceArn: this.#config.resourceArn,
      secretArn: this.#config.secretArn,
      sql: converted.sql,
      ...(this.#config.transactionId === undefined
        ? {}
        : { transactionId: this.#config.transactionId }),
    });
    const send = async (abortSignal?: AbortSignal) => {
      await assertSingleSdkAttempt(this.#config);
      if (abortSignal?.aborted) throw resumeUnavailable();
      return abortSignal === undefined
        ? this.#config.client.send(command)
        : this.#config.client.send(command, { abortSignal });
    };
    const result =
      this.#config.resumeRetry !== undefined &&
      this.#config.transactionId === undefined
        ? await sendWithResumeRetry(send, this.#config.resumeRetry)
        : await send();

    let rows: readonly TRow[] = [];
    if (result.formattedRecords !== undefined) {
      const parsed: unknown = JSON.parse(result.formattedRecords);
      if (!Array.isArray(parsed)) {
        throw new RepositoryError(
          "persistence-unavailable",
          "The database returned an invalid result.",
        );
      }
      rows = parsed as readonly TRow[];
    }

    return {
      // SELECT can return records alongside a zero affected-row count.
      rowCount: Math.max(rows.length, result.numberOfRecordsUpdated ?? 0),
      rows,
    };
  }
}

export class RdsDataApiDatabase implements SqlDatabase {
  readonly #config: RdsDataExecutorConfig;

  constructor(config: RdsDataApiDatabaseConfig) {
    const retry =
      config.resumeRetry === undefined
        ? undefined
        : resumePolicy(config.resumeRetry);
    this.#config = {
      ...config,
      client:
        config.client ??
        new RDSDataClient(retry === undefined ? {} : { maxAttempts: 1 }),
      ...(retry === undefined ? {} : { resumeRetry: retry }),
    };
  }

  close(): Promise<void> {
    this.#config.client.destroy();
    return Promise.resolve();
  }

  query<TRow extends SqlRow = SqlRow>(
    statement: SqlStatement,
  ): Promise<SqlResult<TRow>> {
    return new RdsDataExecutor(this.#config).query<TRow>(statement);
  }

  async transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    const command = new BeginTransactionCommand({
      database: this.#config.database,
      resourceArn: this.#config.resourceArn,
      secretArn: this.#config.secretArn,
    });
    const send = async (abortSignal?: AbortSignal) => {
      await assertSingleSdkAttempt(this.#config);
      if (abortSignal?.aborted) throw resumeUnavailable();
      return abortSignal === undefined
        ? this.#config.client.send(command)
        : this.#config.client.send(command, { abortSignal });
    };
    const begun =
      this.#config.resumeRetry === undefined
        ? await send()
        : await sendWithResumeRetry(send, this.#config.resumeRetry);
    if (begun.transactionId === undefined) {
      throw new RepositoryError(
        "persistence-unavailable",
        "The database transaction could not start.",
      );
    }

    const transactionId = begun.transactionId;
    try {
      const result = await work(
        new RdsDataExecutor({ ...this.#config, transactionId }),
      );
      await assertSingleSdkAttempt(this.#config);
      await this.#config.client.send(
        new CommitTransactionCommand({
          resourceArn: this.#config.resourceArn,
          secretArn: this.#config.secretArn,
          transactionId,
        }),
      );
      return result;
    } catch (error) {
      try {
        await assertSingleSdkAttempt(this.#config);
        await this.#config.client.send(
          new RollbackTransactionCommand({
            resourceArn: this.#config.resourceArn,
            secretArn: this.#config.secretArn,
            transactionId,
          }),
        );
      } catch {
        // The caller receives the original error. Operational telemetry must
        // count rollback failures without logging statement values.
      }
      throw error;
    }
  }
}
