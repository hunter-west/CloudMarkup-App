import type {
  RepositoryImportRequestV1,
  RepositoryImportResultV1,
} from "@cloudmarkup/repository-importer";
import type { ModelRepositoryInterpretationResponseV1 } from "./repository-import-fake-types.js";
import type {
  GitHubRepositoryCanonicalReconciler,
  GitHubRepositoryImportContextPort,
  GitHubRepositoryImportProgressEvent,
  GitHubRepositoryImportProgressSink,
  GitHubRepositoryImportRunner,
  GitHubRepositoryImportStore,
  GitHubRepositoryInterpretationPort,
  GitHubRepositoryReconciliationReview,
  GitHubRepositoryRegenerationPort,
  StoredGitHubRepositoryImport,
} from "./repository-import.js";

export class FakeGitHubRepositoryImportStore implements GitHubRepositoryImportStore {
  readonly reviews: GitHubRepositoryReconciliationReview[] = [];
  readonly #attempts = new Map<string, string>();
  readonly #byIdempotency = new Map<string, string>();
  readonly #records = new Map<string, StoredGitHubRepositoryImport>();

  getImport(input: {
    readonly importId: string;
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<StoredGitHubRepositoryImport | null> {
    const record = this.#records.get(input.importId);
    return Promise.resolve(
      record?.organizationId === input.organizationId &&
        record.projectId === input.projectId
        ? structuredClone(record)
        : null,
    );
  }

  listImports(input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly repositoryId?: number;
  }): Promise<readonly StoredGitHubRepositoryImport[]> {
    return Promise.resolve(
      [...this.#records.values()]
        .filter(
          (record) =>
            record.organizationId === input.organizationId &&
            record.projectId === input.projectId &&
            (input.repositoryId === undefined ||
              record.repositoryId === input.repositoryId),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((record) => structuredClone(record)),
    );
  }

  getReviewByIdempotency(input: {
    readonly idempotencyDigest: GitHubRepositoryReconciliationReview["idempotencyDigest"];
    readonly organizationId: string;
    readonly projectId: string;
  }): Promise<GitHubRepositoryReconciliationReview | null> {
    const review = this.reviews.find(
      (candidate) =>
        candidate.idempotencyDigest === input.idempotencyDigest &&
        candidate.organizationId === input.organizationId &&
        candidate.projectId === input.projectId,
    );
    return Promise.resolve(
      review === undefined ? null : structuredClone(review),
    );
  }

  reserveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }) {
    const key = [
      input.record.organizationId,
      input.record.projectId,
      input.record.idempotencyDigest,
    ].join(":");
    const existingId = this.#byIdempotency.get(key);
    if (existingId !== undefined) {
      const existing = this.#records.get(existingId);
      if (existing === undefined)
        throw new Error("Fake import state is corrupt.");
      return Promise.resolve({
        outcome:
          existing.state === "running"
            ? ("in-progress" as const)
            : ("terminal" as const),
        record: structuredClone(existing),
      });
    }
    this.#byIdempotency.set(key, input.record.importId);
    this.#attempts.set(input.record.importId, input.attemptId);
    this.#records.set(input.record.importId, structuredClone(input.record));
    return Promise.resolve({
      outcome: "acquired" as const,
      record: structuredClone(input.record),
    });
  }

  saveImport(input: {
    readonly attemptId: string;
    readonly record: StoredGitHubRepositoryImport;
  }): Promise<"saved" | "stale"> {
    if (this.#attempts.get(input.record.importId) !== input.attemptId) {
      return Promise.resolve("stale");
    }
    this.#records.set(input.record.importId, structuredClone(input.record));
    return Promise.resolve("saved");
  }

  saveReview(
    record: GitHubRepositoryReconciliationReview,
  ): Promise<GitHubRepositoryReconciliationReview> {
    const existing = this.reviews.find(
      ({ idempotencyDigest }) => idempotencyDigest === record.idempotencyDigest,
    );
    if (existing !== undefined)
      return Promise.resolve(structuredClone(existing));
    const stored = structuredClone(record);
    this.reviews.push(stored);
    return Promise.resolve(structuredClone(stored));
  }
}

export class FakeGitHubRepositoryImportContext implements GitHubRepositoryImportContextPort {
  value: Omit<RepositoryImportRequestV1, "profile"> | null = null;

  load(): Promise<Omit<RepositoryImportRequestV1, "profile"> | null> {
    return Promise.resolve(
      this.value === null ? null : structuredClone(this.value),
    );
  }
}

export class FakeGitHubRepositoryImportRunner implements GitHubRepositoryImportRunner {
  readonly calls: {
    readonly files: readonly { readonly path: string }[];
    readonly request: RepositoryImportRequestV1;
  }[] = [];
  result?: RepositoryImportResultV1;

  importPinnedSnapshot(input: {
    readonly files: readonly {
      readonly path: string;
    }[];
    readonly request: RepositoryImportRequestV1;
  }): Promise<RepositoryImportResultV1> {
    this.calls.push({
      files: input.files.map(({ path }) => ({ path })),
      request: structuredClone(input.request),
    });
    if (this.result === undefined) {
      return Promise.reject(
        new Error("Fake importer result is not configured."),
      );
    }
    return Promise.resolve(structuredClone(this.result));
  }
}

export class FakeGitHubRepositoryInterpreter implements GitHubRepositoryInterpretationPort {
  readonly calls: Parameters<
    GitHubRepositoryInterpretationPort["interpret"]
  >[0][] = [];
  response?: ModelRepositoryInterpretationResponseV1;

  interpret(
    input: Parameters<GitHubRepositoryInterpretationPort["interpret"]>[0],
  ): Promise<ModelRepositoryInterpretationResponseV1> {
    this.calls.push(structuredClone(input));
    if (this.response === undefined) {
      return Promise.reject(
        new Error("Fake repository interpretation is not configured."),
      );
    }
    return Promise.resolve(structuredClone(this.response));
  }
}

export class FakeGitHubRepositoryCanonicalReconciler implements GitHubRepositoryCanonicalReconciler {
  readonly calls: Parameters<
    GitHubRepositoryCanonicalReconciler["review"]
  >[0][] = [];
  designChanged = false;

  review(input: Parameters<GitHubRepositoryCanonicalReconciler["review"]>[0]) {
    this.calls.push(structuredClone(input));
    return Promise.resolve({
      designChanged: this.designChanged,
      receiptId: `reconciliation.${String(this.calls.length)}`,
    });
  }
}

export class FakeGitHubRepositoryRegeneration implements GitHubRepositoryRegenerationPort {
  readonly calls: Parameters<
    GitHubRepositoryRegenerationPort["createExportPreview"]
  >[0][] = [];

  createExportPreview(
    input: Parameters<
      GitHubRepositoryRegenerationPort["createExportPreview"]
    >[0],
  ) {
    this.calls.push(structuredClone(input));
    return Promise.resolve({
      exportPreviewId: `githubpreview.regenerate.${String(this.calls.length)}`,
    });
  }
}

export class RecordingGitHubRepositoryImportProgressSink implements GitHubRepositoryImportProgressSink {
  readonly events: GitHubRepositoryImportProgressEvent[] = [];

  record(event: GitHubRepositoryImportProgressEvent): Promise<void> {
    this.events.push(structuredClone(event));
    return Promise.resolve();
  }
}
