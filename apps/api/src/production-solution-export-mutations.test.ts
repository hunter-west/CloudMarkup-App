import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryFifoJobQueue,
  InMemoryJobAuditPort,
  InMemoryJobHandlerRegistry,
  InMemoryJobRepository,
  JobService,
  selectJobPublicationTransportV1,
  SequentialJobIdGenerator,
  type JobHandlerV1,
} from "@cloudmarkup/job-framework";
import {
  asyncJobIdSchema,
  asyncJobTrustedContextV1Schema,
  sha256DigestSchema,
} from "@cloudmarkup/schemas";
import { PostgresSolutionExportAdmission } from "./adapters/persistence/solution-export-admission.js";
import { PostgresSolutionExportRevisionRepository } from "./adapters/persistence/solution-export-revision-repository.js";
import { PostgresSolutionExportTargetPolicy } from "./adapters/persistence/solution-export-target-policy.js";
import { DurableSolutionExportProducer } from "./adapters/persistence/solution-export-producer.js";
import { SolutionExportRequestAuthority } from "./adapters/persistence/solution-export-authority.js";
import { PostgresAsyncJobRepository } from "./adapters/persistence/async-job-repository.js";
import { solutionExportRootAdmissionCommand } from "./application/solution-export-root-admission.js";
import { createSelfHostDirectExportTargetPolicy } from "./self-host/direct-export-policy.js";
import {
  providerDirectExportFundingReferenceV1,
  isProviderDirectExportFundingReferenceV1,
} from "./application/provider-direct-export-funding.js";
import type { ExportAdmissionSelectionV1 } from "./adapters/persistence/solution-export-admission-codec.js";
import type { CloudMarkupApplication } from "./application/ports.js";
import { permissionsForRole } from "./application/authorization.js";
import { InMemoryObjectStore } from "./adapters/persistence/memory-object-store.js";
import { exportRunFixture } from "./adapters/persistence/solution-export-run-test-helpers.js";
import type {
  SqlDatabase,
  SqlResult,
  SqlRow,
  SqlStatement,
} from "./adapters/persistence/sql.js";
import {
  createProductionSolutionExportMutations,
  type ProductionSolutionExportMutationHost,
} from "./production-solution-export-mutations.js";

/** Negative composition proof. The test-only throwing executor is never invoked;
 * no successful compiler, validation, reservation or hosted-worker evidence is fabricated. */
describe("unregistered production export mutation composition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function fixture(target: "terraform" | "cloudformation" = "terraform") {
    const f = exportRunFixture(target);
    const ids = new SequentialJobIdGenerator();
    const statements: SqlStatement[] = [];
    const objects = new InMemoryObjectStore();
    const stage = vi.spyOn(objects, "stage");
    const execute = vi.fn<JobHandlerV1["execute"]>(() =>
      Promise.reject(
        new Error("The composition test must not execute a worker."),
      ),
    );
    const handler: JobHandlerV1 = {
      family: "solution-export-orchestration",
      handlerId: "synthetic.export-handler",
      handlerVersion: "1",
      resumePolicy: "not-resumable",
      execute,
    };
    const ready = vi.fn<
      ProductionSolutionExportMutationHost["assertCurrentHostReady"]
    >(() => Promise.resolve());
    const entitlementForSelection = vi.fn<
      ProductionSolutionExportMutationHost["entitlementForSelection"]
    >(() => ({
      evaluate: () =>
        Promise.reject(
          new Error("This negative fixture must not admit a root."),
        ),
    }));
    const host: ProductionSolutionExportMutationHost = {
      queue: new InMemoryFifoJobQueue(ids),
      ids,
      audit: new InMemoryJobAuditPort(),
      handlers: new InMemoryJobHandlerRegistry([handler]),
      targetSettings: f.record.workflowSubmission.request.targetSettings,
      assertCurrentHostReady: ready,
      entitlementForSelection,
    };
    const identity = {
      organizationForProject: vi.fn(() =>
        Promise.resolve(f.record.organizationId),
      ),
    };
    const revisions = {
      getSolutionRevision: vi.fn<CloudMarkupApplication["getSolutionRevision"]>(
        () =>
          Promise.reject(
            new Error("No synthetic immutable revision was supplied."),
          ),
      ),
    };
    function query<TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      const rows: readonly SqlRow[] = statement.text.includes(
        "WITH authorized_project",
      )
        ? [
            {
              authenticated: true,
              membership_id: "membership.synthetic",
              role_key: "owner",
              capabilities_json: JSON.stringify(permissionsForRole("owner")),
            },
          ]
        : statement.text.includes(" AS authenticated")
          ? [{ authenticated: true }]
          : statement.text.startsWith("SELECT project_id FROM projects")
            ? [{ project_id: f.record.job.projectId }]
            : statement.text.includes("FROM memberships m")
              ? [
                  {
                    membership_id: "membership.synthetic",
                    role_key: "owner",
                    capabilities_json: JSON.stringify(
                      permissionsForRole("owner"),
                    ),
                  },
                ]
              : [];
      return Promise.resolve({
        rows,
        rowCount: rows.length,
      } as SqlResult<TRow>);
    }
    const database: SqlDatabase = {
      query,
      transaction: (work) => work({ query }),
      close: () => Promise.resolve(),
    };
    const options = { database, objectStore: objects, identity, revisions };
    const input = {
      contractVersion: 1 as const,
      solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
      environment: f.record.job.target.environment,
      exportName: f.record.job.target.exportName,
      targetProfileId: f.record.job.target.profileId,
    };
    return {
      ...f,
      host,
      ready,
      execute,
      stage,
      entitlementForSelection,
      statements,
      options,
      input,
    };
  }
  it.each([false, true])(
    "rechecks the exact retained CloudFormation profile and denies a substituted target (%s)",
    async (substitute) => {
      const f = fixture("cloudformation");
      const ownership = {
        organizationId: f.record.organizationId,
        projectId: f.record.job.projectId,
      };
      const selected: ExportAdmissionSelectionV1 = {
        contractVersion: 1,
        ...ownership,
        createdByPrincipalId: f.principal.principalId,
        originalIdempotencyKeyDigest: f.idempotencyKeyDigest,
        admissionGeneration: 1,
        previousAdmission: null,
        initialRecord: substitute
          ? {
              ...f.record,
              targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1",
            }
          : f.record,
      };
      vi.spyOn(
        PostgresSolutionExportAdmission.prototype,
        "findSelection",
      ).mockResolvedValue(selected);
      vi.spyOn(
        PostgresSolutionExportRevisionRepository.prototype,
        "getImmutableBinding",
      ).mockResolvedValue({
        ...ownership,
        solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
        manifestRecordId: f.record.job.solutionRevision.manifestRecordId,
        manifestDigest: sha256DigestSchema.parse(
          f.record.job.solutionRevision.manifestDigest,
        ),
        applicationCodeRequired: false,
        generationCoverage: f.record.job.generationCoverage,
        workflowSources: f.record.workflowSubmission.request.sources,
      });
      const evaluate = vi.spyOn(
        PostgresSolutionExportTargetPolicy.prototype,
        "evaluate",
      );
      vi.spyOn(
        PostgresSolutionExportAdmission.prototype,
        "resume",
      ).mockImplementation(async function (
        this: PostgresSolutionExportAdmission,
      ) {
        const denied = await this.producer.options.entitlement.evaluate({
          context: asyncJobTrustedContextV1Schema.parse({
            ownership,
            actor: { kind: "principal", actorId: f.principal.principalId },
            correlationId: f.principal.correlationId,
          }),
          family: "solution-export-orchestration",
          idempotencyKeyDigest: f.idempotencyKeyDigest,
          jobId: asyncJobIdSchema.parse(f.record.job.id),
        });
        expect(denied.allowed).toBe(false);
        throw new Error(
          "Negative-only recheck boundary reached; no root admission.",
        );
      });
      const app = createProductionSolutionExportMutations({
        ...f.options,
        host: f.host,
      });
      await expect(
        app.createJob(
          f.principal,
          f.record.job.projectId,
          f.input,
          "synthetic-create-key",
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(evaluate).toHaveBeenCalledOnce();
      expect(evaluate.mock.calls[0]?.[0].targetProfileId).toBe(
        selected.initialRecord.targetProfileId,
      );
      if (substitute)
        expect(
          f.statements.some((statement) =>
            statement.text.includes("FROM organization_billing_accounts a"),
          ),
        ).toBe(false);
      expect(f.stage).not.toHaveBeenCalled();
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.entitlementForSelection).not.toHaveBeenCalled();
    },
  );
  it("resolves dynamic publisher ownership only after current authentication and project authority", async () => {
    const f = fixture();
    const host = vi.fn(
      async ({
        principal,
        ownership,
      }: {
        principal: Parameters<CloudMarkupApplication["getSolutionRevision"]>[0];
        ownership: { organizationId: string; projectId: string };
      }) => {
        expect(principal).not.toBe(f.principal);
        expect(ownership).toEqual({
          organizationId: f.record.organizationId,
          projectId: f.record.job.projectId,
        });
        expect(f.statements.length).toBeGreaterThan(0);
        return await Promise.resolve(f.host);
      },
    );
    const app = createProductionSolutionExportMutations({ ...f.options, host });
    await expect(
      app.cancelJob(
        f.principal,
        f.record.job.projectId,
        f.record.job.id,
        "synthetic-cancel",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(host).toHaveBeenCalledOnce();
    host.mockClear();
    await expect(
      app.cancelJob(
        { ...f.principal, expiresAt: "2000-01-01T00:00:00.000Z" },
        f.record.job.projectId,
        f.record.job.id,
        "synthetic-cancel",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(host).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("rejects absent real host before identity, SQL, object or queue writes", async () => {
    const f = fixture();
    const app = createProductionSolutionExportMutations(f.options);
    await expect(
      app.createJob(
        f.principal,
        f.record.job.projectId,
        f.input,
        "synthetic-create-key",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    await expect(
      app.cancelJob(
        f.principal,
        f.record.job.projectId,
        f.record.job.id,
        "synthetic-cancel-key",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.options.identity.organizationForProject).not.toHaveBeenCalled();
    expect(f.statements).toHaveLength(0);
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("rejects an absent actual handler before admission writes", async () => {
    const f = fixture();
    const app = createProductionSolutionExportMutations({
      ...f.options,
      host: { ...f.host, handlers: new InMemoryJobHandlerRegistry([]) },
    });
    await expect(
      app.createJob(
        f.principal,
        f.record.job.projectId,
        f.input,
        "synthetic-create-key",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.statements).toHaveLength(0);
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("checks real host execution/pricing readiness before any selection or root mutation", async () => {
    const f = fixture();
    f.ready.mockRejectedValue(new Error("Synthetic host unavailable"));
    const app = createProductionSolutionExportMutations({
      ...f.options,
      host: f.host,
    });
    await expect(
      app.createJob(
        f.principal,
        f.record.job.projectId,
        f.input,
        "synthetic-create-key",
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(
      f.statements.every((statement) =>
        /^\s*(?:SELECT|WITH authorized_project\b)/u.test(statement.text),
      ),
    ).toBe(true);
    expect(f.options.revisions.getSolutionRevision).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.entitlementForSelection).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("does not apply expensive-host availability to cancellation or synthesize a missing job", async () => {
    const f = fixture();
    f.ready.mockRejectedValue(new Error("Synthetic host unavailable"));
    const app = createProductionSolutionExportMutations({
      ...f.options,
      host: f.host,
    });
    await expect(
      app.cancelJob(
        f.principal,
        f.record.job.projectId,
        f.record.job.id,
        "synthetic-cancel-key",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.ready).not.toHaveBeenCalled();
    expect(
      f.statements.every((statement) =>
        /^\s*(?:SELECT|WITH authorized_project\b)/u.test(statement.text),
      ),
    ).toBe(true);
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.entitlementForSelection).not.toHaveBeenCalled();
  });
  it("denies expired authentication before host readiness or any mutation", async () => {
    const f = fixture();
    const app = createProductionSolutionExportMutations({
      ...f.options,
      host: f.host,
    });
    await expect(
      app.createJob(
        { ...f.principal, expiresAt: "2020-01-01T00:00:00.000Z" },
        f.record.job.projectId,
        f.input,
        "synthetic-create-key",
      ),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("selects the explicit direct target factory only after real request authority and never reads hosted billing", async () => {
    const f = fixture();
    const createDirectTargetPolicy = vi.fn<
      NonNullable<
        ProductionSolutionExportMutationHost["createDirectTargetPolicy"]
      >
    >(({ authority }) => {
      expect(authority).toBeInstanceOf(SolutionExportRequestAuthority);
      expect(authority.principal.principalId).toBe(f.principal.principalId);
      expect(f.statements.length).toBeGreaterThan(0);
      return {
        evaluate: () =>
          Promise.reject(Error("synthetic direct policy refusal")),
      };
    });
    const hosted = vi.spyOn(
      PostgresSolutionExportTargetPolicy.prototype,
      "evaluate",
    );
    const host: ProductionSolutionExportMutationHost = {
      ...f.host,
      fundingSource: "provider-direct",
      createDirectTargetPolicy,
    };
    const app = createProductionSolutionExportMutations({ ...f.options, host });
    await expect(
      app.cancelJob(
        f.principal,
        f.record.job.projectId,
        f.record.job.id,
        "synthetic-direct-cancel",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(createDirectTargetPolicy).toHaveBeenCalledOnce();
    expect(hosted).not.toHaveBeenCalled();
    expect(
      f.statements.some((s) =>
        /organization_billing_accounts|credit_reservations/u.test(s.text),
      ),
    ).toBe(false);
    expect(f.stage).not.toHaveBeenCalled();
  });
  it("refuses incomplete, substituted or null funding/factory pairs before object or entitlement writes", async () => {
    for (const change of [
      { fundingSource: "provider-direct", createDirectTargetPolicy: undefined },
      { fundingSource: undefined, createDirectTargetPolicy: vi.fn() },
      { fundingSource: "hosted-credits", createDirectTargetPolicy: vi.fn() },
      { fundingSource: null },
    ]) {
      const f = fixture(),
        host = {
          ...f.host,
          ...change,
        } as unknown as ProductionSolutionExportMutationHost;
      const app = createProductionSolutionExportMutations({
        ...f.options,
        host,
      });
      await expect(
        app.cancelJob(
          f.principal,
          f.record.job.projectId,
          f.record.job.id,
          "synthetic-invalid-funding",
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(f.stage).not.toHaveBeenCalled();
      expect(f.entitlementForSelection).not.toHaveBeenCalled();
      expect(
        f.statements.some((s) => /^\s*(?:INSERT|UPDATE|DELETE)/u.test(s.text)),
      ).toBe(false);
    }
  });
  it("requires current exports.run and exact native tool pins for standalone admission, with no synthetic commercial rows", async () => {
    for (const target of ["terraform", "cloudformation"] as const) {
      const f = fixture(target),
        ownership = {
          organizationId: f.record.organizationId,
          projectId: f.record.job.projectId,
        };
      const settings = f.host.targetSettings,
        tools = settings.stageDescriptors;
      const authority = new SolutionExportRequestAuthority(
        f.options.database,
        f.principal,
        ownership,
        "exports.run",
      );
      const ready = vi.fn(() => Promise.resolve());
      const policy = createSelfHostDirectExportTargetPolicy({
        authority,
        targetSettings: settings,
        assertNativeReady: ready,
      });
      const input = {
        principal: f.principal,
        organizationId: ownership.organizationId,
        environment: f.record.job.target.environment,
        targetProfileId: f.record.job.target.profileId,
        binding: {
          ...ownership,
          solutionRevisionId: f.record.job.solutionRevision.solutionRevisionId,
          manifestRecordId: f.record.job.solutionRevision.manifestRecordId,
          manifestDigest: sha256DigestSchema.parse(
            f.record.job.solutionRevision.manifestDigest,
          ),
          applicationCodeRequired: false,
          generationCoverage: f.record.job.generationCoverage,
          workflowSources: f.record.workflowSubmission.request.sources,
          selectedTools: {
            compiler: {
              state: "pinned" as const,
              tool: tools.compiler.adapter,
            },
            diagramRenderer: {
              state: "pinned" as const,
              tool: tools.diagramRenderer.adapter,
            },
          },
        },
      };
      const admitted = await policy.evaluate(input);
      expect(
        isProviderDirectExportFundingReferenceV1(
          admitted.entitlementDecisionReference,
        ),
      ).toBe(true);
      expect(admitted.targetSettings).toEqual(settings);
      expect(ready).toHaveBeenCalledOnce();
      expect(
        f.statements.some((s) =>
          /commercial_plan|organization_billing_accounts|credit_reservations/u.test(
            s.text,
          ),
        ),
      ).toBe(false);
      ready.mockClear();
      await expect(
        policy.evaluate({
          ...input,
          binding: { ...input.binding, projectId: "foreign_project" },
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(ready).not.toHaveBeenCalled();
      const unpinned = { ...input, binding: { ...input.binding } };
      Reflect.deleteProperty(unpinned.binding, "selectedTools");
      await expect(policy.evaluate(unpinned)).rejects.toMatchObject({
        code: "unsupported_version",
      });
      ready.mockRejectedValueOnce(Error("synthetic native pin unavailable"));
      await expect(policy.evaluate(input)).rejects.toThrow(
        "synthetic native pin unavailable",
      );
      await expect(
        policy.evaluate({
          ...input,
          principal: { ...f.principal, principalId: "foreign_principal" },
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    }
  });
  it("does not reinterpret a stored root across hosted and direct funding modes before any SQL or object write", async () => {
    for (const fundingSource of [
      undefined,
      "hosted-credits",
      "provider-direct",
    ] as const) {
      const f = fixture();
      const record =
        fundingSource === "provider-direct"
          ? f.record
          : {
              ...f.record,
              workflowSubmission: {
                ...f.record.workflowSubmission,
                entitlementDecisionReference:
                  providerDirectExportFundingReferenceV1(
                    f.record.workflowSubmission.entitlementDecisionReference,
                  ),
              },
            };
      const producer = new DurableSolutionExportProducer({
        database: f.options.database,
        objectStore: f.options.objectStore,
        principal: f.principal,
        ownership: {
          organizationId: f.record.organizationId,
          projectId: f.record.job.projectId,
        },
        revisions: {
          getImmutableBinding: () =>
            Promise.reject(Error("must not read revision")),
          prepare: () => Promise.reject(Error("must not prepare")),
        },
        ...selectJobPublicationTransportV1(f.host),
        ids: f.host.ids,
        audit: f.host.audit,
        entitlement: {
          evaluate: () => Promise.reject(Error("must not evaluate")),
        },
        ...(fundingSource === undefined ? {} : { fundingSource }),
      });
      await expect(producer.getRoot(record)).rejects.toMatchObject({
        code: "service_unavailable",
      });
      expect(f.statements).toHaveLength(0);
      expect(f.stage).not.toHaveBeenCalled();
    }
  });
  it("requires the completed exact direct root claim and no hosted reservation when reading or recovering a stored root", async () => {
    const f = fixture();
    const record = {
      ...f.record,
      workflowSubmission: {
        ...f.record.workflowSubmission,
        entitlementDecisionReference: providerDirectExportFundingReferenceV1(
          f.record.workflowSubmission.entitlementDecisionReference,
        ),
      },
    };
    const ownership = {
      organizationId: record.organizationId,
      projectId: record.job.projectId,
    };
    const repository = new InMemoryJobRepository();
    const context = asyncJobTrustedContextV1Schema.parse({
      ownership,
      actor: { kind: "principal", actorId: record.createdByPrincipalId },
      correlationId: f.principal.correlationId,
    });
    const command = solutionExportRootAdmissionCommand(
      record,
      f.idempotencyKeyDigest,
    );
    const entitlement = {
      evaluate: () =>
        Promise.resolve({
          allowed: true,
          decisionReference:
            record.workflowSubmission.entitlementDecisionReference,
        }),
    };
    const service = new JobService({
      repository,
      ...selectJobPublicationTransportV1(f.host),
      ids: f.host.ids,
      audit: f.host.audit,
      entitlement,
      clock: { now: () => new Date(record.job.createdAt) },
      publicationReadiness: { isReady: () => Promise.resolve(false) },
    });
    const created = await service.create(context, command);
    if (created.kind !== "created" && created.kind !== "duplicate")
      throw Error("Synthetic direct root was not prepared");
    const claim = await repository.getCreationClaim({
      ownership: context.ownership,
      operationId: command.idempotency.operationId,
      keyDigest: command.idempotency.keyDigest,
    });
    if (claim === null)
      throw Error("Synthetic direct creation claim is missing");
    const storedRoot = vi
      .spyOn(PostgresAsyncJobRepository.prototype, "get")
      .mockResolvedValue(created.job);
    const storedClaim = vi
      .spyOn(PostgresAsyncJobRepository.prototype, "getCreationClaim")
      .mockResolvedValue(claim);
    const producer = new DurableSolutionExportProducer({
      fundingSource: "provider-direct",
      database: f.options.database,
      objectStore: f.options.objectStore,
      principal: f.principal,
      ownership,
      revisions: {
        getImmutableBinding: () =>
          Promise.reject(Error("must not prepare a revision during read")),
        prepare: () => Promise.reject(Error("must not prepare during read")),
      },
      ...selectJobPublicationTransportV1(f.host),
      ids: f.host.ids,
      audit: f.host.audit,
      entitlement,
    });
    expect(await producer.getRoot(record)).toEqual(created.job);
    for (const changed of [
      null,
      { ...claim, status: "claimed" as const, entitlementDecision: null },
      {
        ...claim,
        entitlementDecision: {
          allowed: false,
          decisionReference:
            record.workflowSubmission.entitlementDecisionReference,
        },
      },
      {
        ...claim,
        entitlementDecision: {
          allowed: true,
          decisionReference: "hosted.foreign-decision",
        },
      },
    ]) {
      storedClaim.mockResolvedValue(changed);
      await expect(producer.getRoot(record)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    }
    storedClaim.mockResolvedValue(claim);
    storedRoot.mockResolvedValue({
      ...created.job,
      reservation: {
        state: "reserved",
        reservationId: "reservation.synthetic",
      },
    });
    await expect(producer.getRoot(record)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(f.stage).not.toHaveBeenCalled();
    expect(
      f.statements.some((s) =>
        /credit_reservations|organization_billing_accounts/u.test(s.text),
      ),
    ).toBe(false);
  });
});
