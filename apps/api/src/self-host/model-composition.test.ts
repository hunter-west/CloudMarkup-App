import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { RetainedProviderDirectDispatchFence } from "./retained-provider-dispatch.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAsyncJobRecordV1,
  applyAsyncJobLifecycleCommandV1,
  getAsyncJobInputDigestV1,
  getAsyncJobInputSizeBytesV1,
} from "@cloudmarkup/domain";
import {
  asyncJobInputV1Schema,
  asyncJobTrustedContextV1Schema,
  asyncJobIdSchema,
  asyncJobIdempotencyClaimV1Schema,
  asyncJobAttemptIdSchema,
  asyncJobWorkerIdSchema,
  namespacedIdentifierSchema,
} from "@cloudmarkup/schemas";
import {
  requireServerByokConfigurationV1,
  type ServerByokRoleV1,
} from "@cloudmarkup/model-gateway/server-byok";
import { PostgresProviderDirectInvocationJournalV1 } from "../adapters/persistence/provider-direct-invocation-journal.js";
import { createProviderDirectInvocationPolicyV1 } from "./provider-direct-invocation-policy.js";
import { PostgresBetaAiCreditMeter } from "../adapters/persistence/beta-ai-credit-meter.js";
import type { SqlDatabase } from "../adapters/persistence/sql.js";
import {
  createSelfHostModelComposition,
  type SelfHostVerifiedJobAttempt,
} from "./model-composition.js";

const at = "2026-10-12T10:00:00Z";
const digest = `sha256:${"a".repeat(64)}`;
function context(role: ServerByokRoleV1, project = "project.synthetic") {
  const object = {
    contractVersion: 1,
    objectId: "object.synthetic",
    digest,
    sizeBytes: 64,
    mediaType: "application/json",
    purpose: "input-payload",
  };
  const draft = {
    kind: "draft",
    draftId: "draft.synthetic",
    draftVersion: 1,
    contentDigest: digest,
    etag: '"draft-synthetic"',
  };
  const family =
    role === "architecture"
      ? "architecture-proposal"
      : "application-source-generation";
  const input = asyncJobInputV1Schema.parse(
    role === "architecture"
      ? { contractVersion: 1, family, intentDocument: object, subject: draft }
      : {
          contractVersion: 1,
          family,
          generatorTargetId: "cloudmarkup.generator.synthetic",
          environment: {
            environmentId: "environment.synthetic",
            environmentType: "test",
          },
          subject: {
            kind: "solution-revision",
            solutionRevisionId: "revision.synthetic",
            manifestRecordId: "manifest.synthetic",
            manifestDigest: digest,
          },
        },
  );
  const job = createAsyncJobRecordV1({
    context: asyncJobTrustedContextV1Schema.parse({
      actor: { kind: "principal", actorId: "principal.synthetic" },
      correlationId: "correlation.synthetic",
      ownership: { organizationId: "org.synthetic", projectId: project },
    }),
    createdAt: at,
    expiresAt: "2026-10-12T11:00:00Z",
    jobId: asyncJobIdSchema.parse("job.synthetic." + role),
    input,
    inputDigest: getAsyncJobInputDigestV1(input),
    inputSizeBytes: getAsyncJobInputSizeBytesV1(input),
    idempotency: asyncJobIdempotencyClaimV1Schema.parse({
      actorId: "principal.synthetic",
      operationId: "cloudmarkup.synthetic.create",
      keyDigest: digest,
      requestDigest: digest,
    }),
    reservation: { state: "none" },
  }).job;
  const record = applyAsyncJobLifecycleCommandV1(job, {
    kind: "claim",
    at: "2026-10-12T10:00:01Z",
    expectedInputDigest: job.inputDigest,
    expectedRecordVersion: job.recordVersion,
    attemptId: asyncJobAttemptIdSchema.parse("attempt.synthetic"),
    workerId: asyncJobWorkerIdSchema.parse("worker.synthetic"),
    leaseExpiresAt: "2026-10-12T10:05:00Z",
    dependencies: [],
    handler: {
      family: job.family,
      handlerId: namespacedIdentifierSchema.parse(
        "cloudmarkup.synthetic.handler",
      ),
      handlerVersion: "1.0.0",
      resumePolicy: "restart-from-input",
    },
  }).job;
  return {
    record,
    attemptId: "attempt.synthetic",
    workerId: "worker.synthetic",
    signal: new AbortController().signal,
    assertCurrent: vi.fn(() => Promise.resolve()),
  } satisfies SelfHostVerifiedJobAttempt;
}
function configuration() {
  return requireServerByokConfigurationV1({
    contractVersion: 1,
    provider: "openai-responses",
    endpoint: "https://api.openai.com/v1/responses",
    credentialReference: "operator.openai",
    usageSemantics: "openai-responses-tokens.v1",
    roles: Object.fromEntries(
      ["architecture", "applicationSource"].map((role) => [
        role,
        { model: "gpt-5.4-2026-03-05", maximumOutputTokens: 512 },
      ]),
    ),
    limits: {
      maximumInputBytes: 1024,
      maximumRequestBytes: 4096,
      maximumResponseBytes: 8192,
      deadlineMilliseconds: 60000,
    },
  });
}
function fixture() {
  const close = vi.fn(() => Promise.resolve());
  const database: SqlDatabase = {
    close,
    query: () => Promise.reject(Error("Unexpected synthetic SQL")),
    transaction: () => Promise.reject(Error("Unexpected synthetic SQL")),
  };
  const quota = {
    windowId: "window.synthetic",
    startsAt: at,
    expiresAt: "2026-10-12T11:00:00Z",
    maximumRequests: 10,
    maximumOutputTokenUnits: "100000",
    maximumConcurrent: 2,
  };
  const journals = {
    proposal: new PostgresProviderDirectInvocationJournalV1({
      database,
      purpose: "proposal",
      quota,
      statementTimeoutMilliseconds: 1000,
      dispatchFence: new RetainedProviderDirectDispatchFence({
        root: resolve(tmpdir(), "cm-unused-composition-journal"),
        identity: "a".repeat(64),
      }),
    }),
    export: new PostgresProviderDirectInvocationJournalV1({
      database,
      purpose: "export",
      quota,
      statementTimeoutMilliseconds: 1000,
      dispatchFence: new RetainedProviderDirectDispatchFence({
        root: resolve(tmpdir(), "cm-unused-composition-journal"),
        identity: "a".repeat(64),
      }),
    }),
  };
  const policy = vi.fn(createProviderDirectInvocationPolicyV1);
  const gateway = vi.fn(() => {
    // These substitutes only exercise scope/factory/lifetime boundaries. Actual
    // provider schemas and usage/claim ordering stay in the shared gateway/C tests.
    const reject = () => Promise.reject(Error("Synthetic model result"));
    return {
      architecture: reject,
      applicationSource: reject,
    };
  });
  const resolveCredential = vi.fn(() =>
    Promise.reject(Error("Unexpected synthetic credential resolution")),
  );
  const models = createSelfHostModelComposition({
    fundingSource: "provider-direct",
    configuration: configuration(),
    journals,
    maximumInFlightInvocations: 2,
    now: () => Date.parse("2026-10-12T10:00:02Z"),
    createPolicy: policy,
    createModels: gateway,
    resolveCredential,
  });
  return { models, journals, policy, gateway, close, resolveCredential };
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("real C factory and scoped shared BYOK composition", () => {
  it.each(["architecture", "applicationSource"] as const)(
    "binds %s to its actual durable family/purpose/attempt without hosted calls",
    async (role) => {
      const hosted = [
        vi.spyOn(PostgresBetaAiCreditMeter.prototype, "reserve"),
        vi.spyOn(PostgresBetaAiCreditMeter.prototype, "claim"),
        vi.spyOn(PostgresBetaAiCreditMeter.prototype, "record"),
        vi.spyOn(PostgresBetaAiCreditMeter.prototype, "settle"),
        vi.spyOn(PostgresBetaAiCreditMeter.prototype, "release"),
      ];
      const f = fixture();
      const current = context(role);
      await expect(
        f.models.runForVerifiedAttempt(role, current, () => Promise.resolve()),
      ).resolves.toBeUndefined();
      const call = f.policy.mock.calls[0]?.[0];
      expect(call?.journal).toBe(
        role === "architecture" ? f.journals.proposal : f.journals.export,
      );
      expect(call?.authority).toEqual({
        attemptId: current.attemptId,
        workerReference: current.workerId,
        jobInputDigest: current.record.inputDigest,
        correlationId: current.record.correlationId,
      });
      expect(call?.identity.scope).toMatchObject({
        userId: "principal.synthetic",
        projectId: "project.synthetic",
        organizationId: "org.synthetic",
        jobId: current.record.jobId,
      });
      expect(current.assertCurrent).toHaveBeenCalledTimes(2);
      expect(f.resolveCredential).toHaveBeenCalledTimes(0);
      for (const spy of hosted) expect(spy).toHaveBeenCalledTimes(0);
      await f.models.close();
      expect(f.close).toHaveBeenCalledTimes(0);
    },
  );
  it("does not accept an export orchestration root as a synthetic model child", async () => {
    const f = fixture();
    const root = context("architecture");
    await expect(
      f.models.runForVerifiedAttempt("applicationSource", root, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow("model is unavailable");
    expect(f.policy).toHaveBeenCalledTimes(0);
    await f.models.close();
  });
  it("refuses stale/foreign attempts and real authority withdrawal before policy construction", async () => {
    const f = fixture();
    for (const patch of [{ attemptId: "other" }, { workerId: "other" }]) {
      await expect(
        f.models.runForVerifiedAttempt(
          "architecture",
          { ...context("architecture"), ...patch },
          () => Promise.resolve(),
        ),
      ).rejects.toThrow();
    }
    const revoked = context("architecture");
    revoked.assertCurrent.mockRejectedValueOnce(
      Error("Synthetic denied tenant"),
    );
    await expect(
      f.models.runForVerifiedAttempt("architecture", revoked, () =>
        Promise.resolve(),
      ),
    ).rejects.toThrow();
    expect(f.policy).toHaveBeenCalledTimes(0);
    await f.models.close();
  });
  it("reuses stable invocation/replay identity for the same verified job and separates role/project scope", async () => {
    const f = fixture();
    for (const current of [
      context("architecture"),
      context("architecture"),
      context("architecture", "project.other"),
    ]) {
      await f.models.runForVerifiedAttempt("architecture", current, () =>
        Promise.resolve(),
      );
    }
    const first = f.policy.mock.calls[0]?.[0].identity;
    expect(f.policy.mock.calls[1]?.[0].identity).toEqual(first);
    expect(f.policy.mock.calls[2]?.[0].identity.invocationId).not.toBe(
      first?.invocationId,
    );
    await f.models.close();
  });
  it("quarantines leaked callables and refuses claims after stop/close without closing borrowed SQL", async () => {
    const f = fixture();
    let leaked:
      | Parameters<Parameters<typeof f.models.runForVerifiedAttempt>[2]>[0]
      | undefined;
    await f.models.runForVerifiedAttempt(
      "architecture",
      context("architecture"),
      (models) => {
        leaked = models;
        return Promise.resolve();
      },
    );
    if (leaked === undefined) throw Error("Missing synthetic callable");
    await expect(
      leaked.architecture({
        requirements: "synthetic requirements",
        catalog: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    f.models.stopAdmissions();
    await expect(
      f.models.runForVerifiedAttempt(
        "architecture",
        context("architecture"),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow();
    await Promise.all([f.models.close(), f.models.close()]);
    expect(f.close).toHaveBeenCalledTimes(0);
    expect(f.gateway).toHaveBeenCalledTimes(1);
  });
  it("drains an in-flight verified execution before closing C journals", async () => {
    const f = fixture();
    let finish: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = f.models.runForVerifiedAttempt(
      "architecture",
      context("architecture"),
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          entered?.();
        }),
    );
    await started;
    const proposalClose = vi.spyOn(f.journals.proposal, "close");
    const stopping = f.models.close();
    expect(proposalClose).toHaveBeenCalledTimes(0);
    if (finish === undefined)
      throw Error("Missing synthetic execution continuation");
    finish();
    await pending;
    await stopping;
    expect(proposalClose).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(0);
  });
});
