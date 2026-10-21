import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { z } from "zod";

import { canonicalDigest } from "./security.js";

const stableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const findingClassSchema = z.enum([
  "application-binding-mismatch",
  "designed-but-missing",
  "external-resource",
  "generated-drift",
  "iam-change",
  "network-exposure-change",
  "observed-but-not-designed",
  "ownership-mismatch",
  "stale-or-unknown-evidence",
]);

const canonicalEvidenceIdsSchema = z
  .array(stableIdSchema)
  .min(1)
  .max(256)
  .superRefine((values, context) => {
    for (let index = 0; index < values.length; index += 1) {
      const previous = values.at(index - 1);
      const current = values.at(index);
      if (
        index > 0 &&
        previous !== undefined &&
        current !== undefined &&
        previous >= current
      ) {
        context.addIssue({
          code: "custom",
          message: "Evidence record IDs must be unique and UTF-16 sorted.",
          path: [index],
        });
      }
    }
  });

export const gitHubConformanceActionBindingV1Schema = z
  .object({
    evidenceRecordIds: canonicalEvidenceIdsSchema,
    organizationId: stableIdSchema,
    projectId: stableIdSchema,
    reportDigest: sha256DigestSchema,
    repositoryId: z.number().int().positive(),
    solutionRevision: z
      .object({ digest: sha256DigestSchema, id: stableIdSchema })
      .strict(),
  })
  .strict();

const knownIssueActionSchema = z
  .object({
    actionId: stableIdSchema,
    findingClass: findingClassSchema,
    issueKey: stableIdSchema,
    kind: z.literal("upsert-known-issue"),
  })
  .strict();

const reconciliationPullRequestActionSchema = z
  .object({
    actionId: stableIdSchema,
    baseCommitSha: commitShaSchema,
    extensionPreservationDigest: sha256DigestSchema,
    kind: z.literal("request-reconciliation-pr"),
    proposedArtifactDigest: sha256DigestSchema,
    repositorySnapshotDigest: sha256DigestSchema,
  })
  .strict();

const conformanceActionSchema = z.discriminatedUnion("kind", [
  knownIssueActionSchema,
  reconciliationPullRequestActionSchema,
]);

export const gitHubConformanceKnownActionV1Schema = z
  .object({
    action: conformanceActionSchema,
    bindingDigest: sha256DigestSchema,
    sourceRecordDigest: sha256DigestSchema,
  })
  .strict();

export const gitHubConformanceActionRequestV1Schema = z
  .object({
    action: conformanceActionSchema,
    binding: gitHubConformanceActionBindingV1Schema,
    contractVersion: z.literal(1),
    principalId: stableIdSchema,
  })
  .strict();

export const gitHubConformanceAuthorizationDecisionV1Schema = z
  .object({
    allowed: z.boolean(),
    authorizationDigest: sha256DigestSchema,
    bindingDigest: sha256DigestSchema,
  })
  .strict();

const portResultSchema = z
  .object({
    providerRecordDigest: sha256DigestSchema,
    state: z.enum(["created", "updated", "request-recorded"]),
  })
  .strict();

export const gitHubConformanceActionReceiptV1Schema = z
  .object({
    actionDigest: sha256DigestSchema,
    actionId: stableIdSchema,
    actionKind: z.enum(["upsert-known-issue", "request-reconciliation-pr"]),
    authorizationDigest: sha256DigestSchema,
    bindingDigest: sha256DigestSchema,
    contractVersion: z.literal(1),
    createdAt: z.iso.datetime(),
    idempotencyDigest: sha256DigestSchema,
    mergeAuthority: z.literal("none"),
    providerRecordDigest: sha256DigestSchema,
    providerState: portResultSchema.shape.state,
    remediation: z.literal("none"),
    sourceRecordDigest: sha256DigestSchema,
  })
  .strict();

export type GitHubConformanceActionBindingV1 = z.output<
  typeof gitHubConformanceActionBindingV1Schema
>;
export type GitHubConformanceActionRequestV1 = z.output<
  typeof gitHubConformanceActionRequestV1Schema
>;
export type GitHubConformanceActionReceiptV1 = z.output<
  typeof gitHubConformanceActionReceiptV1Schema
>;
export type GitHubConformanceKnownActionV1 = z.output<
  typeof gitHubConformanceKnownActionV1Schema
>;
export type GitHubConformanceAuthorizationDecisionV1 = z.output<
  typeof gitHubConformanceAuthorizationDecisionV1Schema
>;

export type GitHubConformanceActionErrorCode =
  | "action-mismatch"
  | "action-not-known"
  | "authorization-binding-invalid"
  | "authorization-denied"
  | "binding-mismatch"
  | "receipt-conflict";

export class GitHubConformanceActionError extends Error {
  readonly code: GitHubConformanceActionErrorCode;

  constructor(code: GitHubConformanceActionErrorCode) {
    super(`GitHub conformance action failed: ${code}.`);
    this.name = "GitHubConformanceActionError";
    this.code = code;
  }
}

export interface GitHubConformanceActionAuthorizationPort {
  authorize(input: {
    readonly actionKind: GitHubConformanceActionRequestV1["action"]["kind"];
    readonly binding: GitHubConformanceActionBindingV1;
    readonly principalId: string;
  }): Promise<GitHubConformanceAuthorizationDecisionV1>;
}

export interface GitHubConformanceKnownActionPort {
  resolve(input: {
    readonly actionId: string;
    readonly actionKind: GitHubConformanceActionRequestV1["action"]["kind"];
    readonly binding: GitHubConformanceActionBindingV1;
  }): Promise<GitHubConformanceKnownActionV1 | null>;
}

export interface GitHubConformanceActionPort {
  requestReconciliationPullRequest(input: {
    readonly action: z.output<typeof reconciliationPullRequestActionSchema>;
    readonly binding: GitHubConformanceActionBindingV1;
    readonly idempotencyDigest: z.output<typeof sha256DigestSchema>;
    readonly mergeAuthority: "none";
    readonly remediation: "none";
    readonly summary: "A reviewed reconciliation proposal is available.";
    readonly title: "CloudMarkup reviewed reconciliation request";
  }): Promise<z.output<typeof portResultSchema>>;
  upsertKnownIssue(input: {
    readonly action: z.output<typeof knownIssueActionSchema>;
    readonly binding: GitHubConformanceActionBindingV1;
    readonly idempotencyDigest: z.output<typeof sha256DigestSchema>;
    readonly labels: readonly ["cloudmarkup-conformance"];
    readonly summary: "A reviewed conformance report requires attention.";
    readonly title: "CloudMarkup conformance finding";
  }): Promise<z.output<typeof portResultSchema>>;
}

export interface GitHubConformanceActionReceiptStore {
  findByIdempotencyDigest(
    idempotencyDigest: z.output<typeof sha256DigestSchema>,
  ): Promise<GitHubConformanceActionReceiptV1 | null>;
  saveIfAbsent(
    receipt: GitHubConformanceActionReceiptV1,
  ): Promise<GitHubConformanceActionReceiptV1>;
}

export interface GitHubConformanceActionServiceDependencies {
  readonly actions: GitHubConformanceActionPort;
  readonly authorization: GitHubConformanceActionAuthorizationPort;
  readonly knownActions: GitHubConformanceKnownActionPort;
  readonly now: () => Date;
  readonly receipts: GitHubConformanceActionReceiptStore;
}

function assertExactBinding(
  actual: GitHubConformanceActionBindingV1,
  expected: GitHubConformanceActionBindingV1,
): void {
  if (canonicalDigest(actual) !== canonicalDigest(expected)) {
    throw new GitHubConformanceActionError("binding-mismatch");
  }
}

export class GitHubConformanceActionService {
  readonly #dependencies: GitHubConformanceActionServiceDependencies;

  constructor(dependencies: GitHubConformanceActionServiceDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(
    rawRequest: unknown,
    rawExpectedBinding: unknown,
  ): Promise<GitHubConformanceActionReceiptV1> {
    const request = gitHubConformanceActionRequestV1Schema.parse(rawRequest);
    const expectedBinding =
      gitHubConformanceActionBindingV1Schema.parse(rawExpectedBinding);
    assertExactBinding(request.binding, expectedBinding);

    const bindingDigest = canonicalDigest(request.binding);
    const actionDigest = canonicalDigest(request.action);
    const idempotencyDigest = canonicalDigest({
      actionDigest,
      bindingDigest,
      principalId: request.principalId,
    });
    const existing =
      await this.#dependencies.receipts.findByIdempotencyDigest(
        idempotencyDigest,
      );

    const decision = gitHubConformanceAuthorizationDecisionV1Schema.parse(
      await this.#dependencies.authorization.authorize({
        actionKind: request.action.kind,
        binding: request.binding,
        principalId: request.principalId,
      }),
    );
    if (decision.bindingDigest !== bindingDigest) {
      throw new GitHubConformanceActionError("authorization-binding-invalid");
    }
    if (!decision.allowed) {
      throw new GitHubConformanceActionError("authorization-denied");
    }
    const resolved = await this.#dependencies.knownActions.resolve({
      actionId: request.action.actionId,
      actionKind: request.action.kind,
      binding: expectedBinding,
    });
    if (resolved === null) {
      throw new GitHubConformanceActionError("action-not-known");
    }
    const known = gitHubConformanceKnownActionV1Schema.parse(resolved);
    if (
      known.bindingDigest !== bindingDigest ||
      canonicalDigest(known.action) !== actionDigest
    ) {
      throw new GitHubConformanceActionError("action-mismatch");
    }
    if (existing !== null) {
      const receipt = gitHubConformanceActionReceiptV1Schema.parse(existing);
      if (
        receipt.actionDigest !== actionDigest ||
        receipt.bindingDigest !== bindingDigest ||
        receipt.idempotencyDigest !== idempotencyDigest ||
        receipt.sourceRecordDigest !== known.sourceRecordDigest
      ) {
        throw new GitHubConformanceActionError("receipt-conflict");
      }
      return receipt;
    }

    const result = portResultSchema.parse(
      request.action.kind === "upsert-known-issue"
        ? await this.#dependencies.actions.upsertKnownIssue({
            action: request.action,
            binding: request.binding,
            idempotencyDigest,
            labels: ["cloudmarkup-conformance"],
            summary: "A reviewed conformance report requires attention.",
            title: "CloudMarkup conformance finding",
          })
        : await this.#dependencies.actions.requestReconciliationPullRequest({
            action: request.action,
            binding: request.binding,
            idempotencyDigest,
            mergeAuthority: "none",
            remediation: "none",
            summary: "A reviewed reconciliation proposal is available.",
            title: "CloudMarkup reviewed reconciliation request",
          }),
    );
    if (
      request.action.kind === "upsert-known-issue" &&
      result.state === "request-recorded"
    ) {
      throw new GitHubConformanceActionError("receipt-conflict");
    }
    if (
      request.action.kind === "request-reconciliation-pr" &&
      result.state !== "request-recorded"
    ) {
      throw new GitHubConformanceActionError("receipt-conflict");
    }

    const receipt = gitHubConformanceActionReceiptV1Schema.parse({
      actionDigest,
      actionId: request.action.actionId,
      actionKind: request.action.kind,
      authorizationDigest: decision.authorizationDigest,
      bindingDigest,
      contractVersion: 1,
      createdAt: this.#dependencies.now().toISOString(),
      idempotencyDigest,
      mergeAuthority: "none",
      providerRecordDigest: result.providerRecordDigest,
      providerState: result.state,
      remediation: "none",
      sourceRecordDigest: known.sourceRecordDigest,
    });
    const stored = await this.#dependencies.receipts.saveIfAbsent(receipt);
    if (stored.idempotencyDigest !== idempotencyDigest) {
      throw new GitHubConformanceActionError("receipt-conflict");
    }
    return stored;
  }
}
