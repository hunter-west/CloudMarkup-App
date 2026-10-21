import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { waitForLiveAccountingPgTestWindow } from "./model-live-commercial-accounting-pg-test-helpers.js";
import {
  digestStructuredValue,
  projectModelCommercialPendingReviewV2,
  type ModelRuntimeHostEvidenceVerifierV1,
} from "@cloudmarkup/model-gateway";
import { modelRuntimeInputEvidenceV1Schema } from "@cloudmarkup/schemas";
import { createLiveHostEvidencePgFixture } from "./model-live-runtime-host-evidence-pg-test-helpers.js";
import {
  PostgresModelLiveRoutingAuthority,
  ModelLiveRoutingAuthorityError,
} from "./model-live-routing-authority.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { PostgresModelLiveRuntimeHostEvidence } from "./model-live-runtime-host-evidence.js";
import { ModelLiveRuntimeHostEvidenceError } from "./model-live-runtime-host-evidence-codec.js";
import { rehashLiveAccountingTestMetadata } from "./model-live-commercial-accounting-test-helpers.js";
import { sql } from "./sql.js";
const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "V2 durable host evidence uses actual scoped plans and journal metadata",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(() => harness.setup(), 60000);
    afterAll(() => harness.teardown(), 30000);
    beforeEach(
      () => waitForLiveAccountingPgTestWindow(harness.database),
      65000,
    );

    const fixture = (
      activation: "normal" | "candidate" = "normal",
      exactRouting = false,
    ) => createLiveHostEvidencePgFixture(harness, activation, exactRouting);
    async function authorityFixture() {
      const f = await fixture("candidate", true);
      if (
        f.liveAuthority === undefined ||
        f.liveRouting?.context.routingDecision === undefined ||
        f.liveRouting.context.routingRequest === undefined
      )
        throw Error("Missing exact routing authority.");
      const authorize = {
        phase: "invoke" as const,
        request: f.hostInput.invocation.request,
        context: f.liveRouting.context,
        routingConfigurationDigest: digestStructuredValue(
          f.liveRouting.routing,
        ),
      };
      const resolve = {
        purpose: "execution" as const,
        request: f.runtime.request,
        inputEvidence: f.inputEvidence,
        candidate: {
          plan: f.hostInput.plan,
          routingDecision: f.liveRouting.context.routingDecision,
          routingRequest: f.liveRouting.context.routingRequest,
        },
      };
      return {
        ...f,
        liveAuthority: f.liveAuthority,
        liveRouting: f.liveRouting,
        authorize,
        resolve,
      };
    }
    it("authenticates candidate routing with actual issued input, approval and exact current configuration", async () => {
      const f = await authorityFixture();
      const before = (await f.rows()).rows;
      const prepared = await f.liveAuthority.authorize(f.authorize);
      expect(prepared.plan).toEqual(f.hostInput.plan);
      expect(
        prepared.capabilityRegistry.capabilities.every(
          (c) => !c.evaluation.passed,
        ),
      ).toBe(true);
      expect(
        await f.liveAuthority.authorize({
          ...f.authorize,
          phase: "dispatch",
          invocation: f.hostInput.invocation,
        }),
      ).toMatchObject({ caseId: f.hostInput.caseId, plan: f.hostInput.plan });
      for (const purpose of [
        "execution",
        "dispatch",
        "output",
        "recovery",
      ] as const)
        expect(
          await f.liveAuthority.resolve({ ...f.resolve, purpose }),
        ).toEqual(f.resolve.candidate);
      expect((await f.rows()).rows).toEqual(before);
    });
    it.each([
      "revoke",
      "operator",
      "definition",
      "route-removed",
      "route-changed",
    ] as const)(
      "denies new routing after %s withdrawal and preserves historical recovery only",
      async (kind) => {
        const f = await authorityFixture();
        await f.liveAuthority.authorize(f.authorize);
        if (kind === "revoke") await f.plans.revoke(f.identity);
        if (kind === "operator") f.removeOperators();
        if (kind === "definition") f.removeConfiguration();
        if (kind === "route-removed") f.setRouteConfiguration(null);
        if (kind === "route-changed") {
          const changed = structuredClone(f.hostInput.configuration);
          const route = changed.routes[0];
          if (!route) throw Error("Missing route.");
          route.transport = "converse-stream";
          f.setRouteConfiguration(changed);
        }
        await expect(
          f.liveAuthority.authorize(f.authorize),
        ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
        for (const purpose of ["execution", "dispatch", "output"] as const)
          await expect(
            f.liveAuthority.resolve({ ...f.resolve, purpose }),
          ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
        expect(
          await f.liveAuthority.resolve({ ...f.resolve, purpose: "recovery" }),
        ).toEqual(f.resolve.candidate);
      },
    );
    it.each(["request", "context", "route", "invocation"] as const)(
      "rejects substituted gateway %s before returning any authority",
      async (kind) => {
        const f = await authorityFixture();
        const candidate = structuredClone({
          ...f.authorize,
          phase: "dispatch" as const,
          invocation: f.hostInput.invocation,
        });
        if (kind === "request")
          Reflect.set(candidate.request, "unapproved", true);
        if (kind === "context")
          Reflect.set(candidate.context.scope, "jobId", "other_job");
        if (kind === "route")
          candidate.routingConfigurationDigest = digestStructuredValue("other");
        if (kind === "invocation")
          Reflect.set(candidate.invocation, "maximumOutputTokens", 1);
        await expect(
          f.liveAuthority.authorize(candidate),
        ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
      },
    );
    it.each(["plan", "routing", "evidence", "case"] as const)(
      "rejects substituted runtime %s for execution and historical recovery",
      async (kind) => {
        const f = await authorityFixture(),
          candidate = structuredClone(f.resolve);
        if (kind === "plan")
          Reflect.set(candidate.candidate.plan, "planId", "unissued_plan");
        if (kind === "routing")
          candidate.candidate.routingDecision.maximumOutputTokens++;
        if (kind === "evidence")
          candidate.inputEvidence.evidenceId = "unissued_evidence";
        if (kind === "case") candidate.request.evaluationCaseId = "other_case";
        for (const purpose of ["execution", "recovery"] as const)
          await expect(
            f.liveAuthority.resolve({ ...candidate, purpose }),
          ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
      },
    );
    it.each(["unissued-input", "unissued-plan", "foreign-issuer"] as const)(
      "authenticates durable records instead of accepting %s metadata",
      async (kind) => {
        const f = await authorityFixture();
        const other =
          kind === "foreign-issuer" ? await authorityFixture() : undefined;
        const inputEvidence =
          kind === "unissued-input"
            ? modelRuntimeInputEvidenceV1Schema.parse(
                rehashLiveAccountingTestMetadata(
                  {
                    ...f.inputEvidence,
                    evidenceId: "unissued_evidence",
                  },
                  "evidenceDigest",
                ),
              )
            : f.inputEvidence;
        const authority = new PostgresModelLiveRoutingAuthority({
          plans: f.plans,
          evidence: other?.issuer ?? f.issuer,
          configuration: f.hostInput.configuration,
          resolveCurrentConfiguration: () =>
            Promise.resolve(f.hostInput.configuration),
          context: f.liveRouting.context,
          routing: f.liveRouting.routing,
          invocation: f.hostInput.invocation,
          inputEvidence,
          caseId: f.hostInput.caseId,
          definitionId: f.hostInput.plan.definition.definitionId,
          planDigest:
            kind === "unissued-plan"
              ? digestStructuredValue("unissued")
              : f.hostInput.plan.planDigest,
        });
        await expect(authority.authorize(f.authorize)).rejects.toBeInstanceOf(
          ModelLiveRoutingAuthorityError,
        );
        await expect(
          authority.resolve({
            ...f.resolve,
            inputEvidence,
            purpose: "recovery",
          }),
        ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
      },
    );
    it("requires current execution membership even for historical recovery", async () => {
      const f = await authorityFixture();
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      await expect(
        f.liveAuthority.authorize(f.authorize),
      ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
      await expect(
        f.liveAuthority.resolve({ ...f.resolve, purpose: "recovery" }),
      ).rejects.toBeInstanceOf(ModelLiveRoutingAuthorityError);
    });

    function expected(
      record: Parameters<
        ModelRuntimeHostEvidenceVerifierV1["verify"]
      >[0]["evidence"],
    ) {
      const {
        evidenceKind,
        catalogDigest,
        inputDigest,
        operation,
        organizationId,
        outputBytes,
        outputDigest,
        outputTokens,
        projectId,
        responseSchemaDigest,
        runtimePolicyDigest,
      } = record;
      return {
        evidenceKind,
        catalogDigest,
        inputDigest,
        operation,
        organizationId,
        outputBytes,
        outputDigest,
        outputTokens,
        projectId,
        responseSchemaDigest,
        runtimePolicyDigest,
      };
    }
    it.each(["normal", "candidate"] as const)(
      "issues %s input and completed-output metadata without retaining bodies or settling credits",
      async (activation) => {
        const f = await fixture(activation);
        expect(
          await f.issuer.verifyInputEvidence({ evidence: f.inputEvidence }),
        ).toBe(true);
        expect(await f.issuer.issueInput(f.hostInput.invocation)).toEqual(
          f.inputEvidence,
        );
        await f.complete();
        const issued = await f.issuer.issueOutput({
          invocation: f.hostInput.invocation,
          result: f.gatewayResult,
          journal: f.journal,
        });
        expect(
          await f.issuer.verify({
            evidence: issued.allowListedOperationsEvidence,
            expected: expected(issued.allowListedOperationsEvidence),
          }),
        ).toBe(true);
        expect(
          await f.issuer.verify({
            evidence: issued.sourceOwnershipEvidence,
            expected: expected(issued.sourceOwnershipEvidence),
          }),
        ).toBe(true);
        expect(
          await f.issuer.issueOutput({
            invocation: f.hostInput.invocation,
            result: f.gatewayResult,
            journal: f.journal,
          }),
        ).toEqual(issued);
        expect((await f.rows()).rowCount).toBe(3);
        const saved = JSON.stringify((await f.rows()).rows);
        expect(saved).not.toContain("proposalContext");
        expect(saved).not.toContain("Synthetic schema-only fixture");
        expect(saved).not.toContain(f.hostInput.invocation.prompt.content);
        expect(await f.issuer.verifyOperationalOutcome()).toBe(false);
        expect(
          (
            await harness.database.query(
              sql(
                "SELECT entry_kind FROM usage_ledger_entries WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            )
          ).rows
            .map((r) => r["entry_kind"])
            .sort(),
        ).toEqual(["grant", "reservation"]);
      },
    );
    it("rejects an uncompleted result and rehashed unissued evidence", async () => {
      const f = await fixture();
      await expect(
        f.issuer.issueOutput({
          invocation: f.hostInput.invocation,
          result: f.gatewayResult,
          journal: f.journal,
        }),
      ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
      const forged = rehashLiveAccountingTestMetadata(
        {
          ...f.inputEvidence,
          requested: {
            ...f.inputEvidence.requested,
            nodeCount: f.inputEvidence.requested.nodeCount + 1,
          },
        },
        "evidenceDigest",
      );
      expect(
        await f.issuer.verifyInputEvidence({
          evidence: forged as typeof f.inputEvidence,
        }),
      ).toBe(false);
      expect((await f.rows()).rowCount).toBe(1);
    });
    it.each(["revocation", "operators", "configuration"] as const)(
      "denies new issuance after %s while preserving exact historical verification",
      async (withdrawal) => {
        const f = await fixture("candidate");
        await f.complete();
        if (withdrawal === "revocation") await f.plans.revoke(f.identity);
        else if (withdrawal === "operators") f.removeOperators();
        else f.removeConfiguration();
        await expect(
          f.issuer.issueInput(f.hostInput.invocation),
        ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
        await expect(
          f.issuer.issueOutput({
            invocation: f.hostInput.invocation,
            result: f.gatewayResult,
            journal: f.journal,
          }),
        ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
        expect(
          await f.issuer.verifyInputEvidence({ evidence: f.inputEvidence }),
        ).toBe(true);
        expect((await f.rows()).rowCount).toBe(1);
      },
    );
    it("rolls back both output records when approval is withdrawn during issuance", async () => {
      const f = await fixture();
      await f.complete();
      f.withdrawDuringHostOutput();
      await expect(
        f.issuer.issueOutput({
          invocation: f.hostInput.invocation,
          result: f.gatewayResult,
          journal: f.journal,
        }),
      ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
      expect((await f.rows()).rowCount).toBe(1);
      expect(await f.row()).toMatchObject({ gateway_state: "complete" });
    });
    it.each(["request", "descriptor", "usage", "response", "extra"] as const)(
      "rejects substituted %s after the actual result was journaled",
      async (part) => {
        const f = await fixture();
        await f.complete();
        const invocation = structuredClone(f.hostInput.invocation),
          result = structuredClone(f.gatewayResult);
        if (part === "request")
          Reflect.set(
            invocation,
            "maximumOutputTokens",
            invocation.maximumOutputTokens + 1,
          );
        if (part === "descriptor")
          result.descriptor.budgetDecisionId = "foreign_reservation";
        if (part === "usage") result.usage.outputUnits = "6";
        if (part === "response")
          result.response.proposalContext.confidence.rationale =
            "An unrecorded design assumption.";
        const candidate = {
          invocation,
          result,
          journal: f.journal,
          ...(part === "extra" ? { score: 10000 } : {}),
        };
        await expect(f.issuer.issueOutput(candidate)).rejects.toBeInstanceOf(
          ModelLiveRuntimeHostEvidenceError,
        );
        expect((await f.rows()).rowCount).toBe(1);
      },
    );
    it("binds full job scope and refuses evidence issued for another tenant", async () => {
      const f = await fixture(),
        other = await fixture();
      expect(
        await other.issuer.verifyInputEvidence({ evidence: f.inputEvidence }),
      ).toBe(false);
      const foreignJob = new PostgresModelLiveRuntimeHostEvidence({
        plans: f.plans,
        ...f.identity,
        caseId: f.hostInput.caseId,
        scope: { ...f.hostInput.scope, jobId: "job_other" },
        configuration: f.hostInput.configuration,
      });
      expect(
        await foreignJob.verifyInputEvidence({ evidence: f.inputEvidence }),
      ).toBe(false);
      await expect(
        foreignJob.issueInput(f.hostInput.invocation),
      ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
    });
    it("requires current tenant membership even for historical evidence", async () => {
      const f = await fixture();
      await f.complete();
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      expect(
        await f.issuer.verifyInputEvidence({ evidence: f.inputEvidence }),
      ).toBe(false);
      await expect(
        f.issuer.issueOutput({
          invocation: f.hostInput.invocation,
          result: f.gatewayResult,
          journal: f.journal,
        }),
      ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
    });
    it("serializes concurrent issuance into the same two output receipts", async () => {
      const f = await fixture();
      await f.complete();
      const args = {
        invocation: f.hostInput.invocation,
        result: f.gatewayResult,
        journal: f.journal,
      };
      const [first, second] = await Promise.all([
        f.issuer.issueOutput(args),
        f.issuer.issueOutput(args),
      ]);
      expect(first).toEqual(second);
      expect((await f.rows()).rowCount).toBe(3);
      const changed = rehashLiveAccountingTestMetadata(
        { ...first.allowListedOperationsEvidence, outputTokens: 6 },
        "evidenceDigest",
      );
      expect(
        await f.issuer.verify({
          evidence: changed as typeof first.allowListedOperationsEvidence,
          expected: expected(first.allowListedOperationsEvidence),
        }),
      ).toBe(false);
    });
    it.each(["standard", "deep"] as const)(
      "reads the actual %s commercial reservation with completed output, without a terminal charge",
      async (mode) => {
        const f = await createLiveHostEvidencePgFixture(
          harness,
          "candidate",
          true,
          false,
          mode,
        );
        await f.complete();
        const before = (await f.rows()).rows;
        const projected = await f.journal.withCompletedOutputMetadata(
          f.gatewayResult,
          ({ commercialWorkflow }) =>
            Promise.resolve(
              projectModelCommercialPendingReviewV2(commercialWorkflow),
            ),
        );
        expect(projected).toMatchObject({
          completedCreditUnits: null,
          estimate: {
            maximumCreditUnits: f.callback.acceptedMaximumCreditUnits,
          },
          reservationAccepted: true,
          reservationId: f.callback.reservationId,
          route: mode,
          state: "settlement-pending",
          technicalUnits: null,
        });
        expect((await f.rows()).rows).toEqual(before);
        await expect(
          f.journal.withCompletedOutputMetadata(
            f.gatewayResult,
            ({ commercialWorkflow }) => {
              Object.assign(commercialWorkflow.request, {
                reservationId: "substituted_reservation",
              });
              return Promise.resolve();
            },
          ),
        ).rejects.toThrow();
        await expect(
          f.journal.withCompletedOutputMetadata(
            f.gatewayResult,
            ({ commercialWorkflow }) =>
              Promise.resolve(
                projectModelCommercialPendingReviewV2(commercialWorkflow),
              ),
          ),
        ).resolves.toEqual(projected);
      },
    );

    it("keeps callback metadata detached, rejects mutation and expires the transaction handle", async () => {
      const f = await fixture();
      await f.complete();
      let escaped: import("./sql.js").SqlExecutor | undefined;
      expect(
        await f.journal.withCompletedOutputMetadata(
          f.gatewayResult,
          async (context) => {
            escaped = context.transaction;
            expect(context.result).toEqual(f.gatewayResult);
            expect(context.admission).toEqual(f.runtime.request);
            await context.transaction.query(sql("SELECT 1"));
            return "verified";
          },
        ),
      ).toBe("verified");
      if (escaped === undefined) throw Error("Missing test transaction.");
      expect(() => escaped?.query(sql("SELECT 1"))).toThrow();
      await expect(
        f.journal.withCompletedOutputMetadata(f.gatewayResult, (context) => {
          context.result.usage.outputUnits = "6";
          return Promise.resolve();
        }),
      ).rejects.toThrow();
      expect(f.gatewayResult.usage.outputUnits).toBe("5");
    });
    it.each(["commercial", "runtime"] as const)(
      "rejects a released %s lease before exposing completed result metadata",
      async (kind) => {
        const f = await fixture();
        await f.complete();
        if (kind === "commercial")
          await f.workflows.releaseExecution({
            tenantScopeDigest: f.scope.tenantScopeDigest,
            multiCallWorkflowId: f.record.request.multiCallWorkflowId,
            lease: f.workflowLease,
          });
        else {
          await f.runtimeStore.release({
            tenantScopeDigest: f.runtime.tenantScopeDigest,
            executionLease: f.admitted.executionLease,
          });
        }
        let entered = false;
        await expect(
          f.journal.withCompletedOutputMetadata(f.gatewayResult, () => {
            entered = true;
            return Promise.resolve();
          }),
        ).rejects.toThrow();
        expect(entered).toBe(false);
        await expect(
          f.issuer.issueOutput({
            invocation: f.hostInput.invocation,
            result: f.gatewayResult,
            journal: f.journal,
          }),
        ).rejects.toBeInstanceOf(ModelLiveRuntimeHostEvidenceError);
      },
    );
    it("rechecks held leases before committing completed output metadata", async () => {
      const f = await fixture();
      await f.complete();
      let changed = false;
      await expect(
        f.journal.withCompletedOutputMetadata(
          f.gatewayResult,
          async ({ transaction }) => {
            await transaction.query(
              sql(
                "UPDATE model_commercial_workflows SET lease_id=NULL,lease_acquired_at=NULL,lease_expires_at=NULL WHERE organization_id=$1",
                [f.scope.organizationId],
              ),
            );
            changed = true;
          },
        ),
      ).rejects.toThrow();
      expect(changed).toBe(true);
      expect(
        await f.journal.withCompletedOutputMetadata(f.gatewayResult, () =>
          Promise.resolve(true),
        ),
      ).toBe(true);
    });
    it("rejects direct database mutations and content-bearing or unbound inserts", async () => {
      const f = await fixture();
      const row = (await f.rows()).rows[0];
      if (row === undefined) throw Error("Missing input row.");
      for (const statement of [
        "UPDATE model_live_runtime_host_evidence SET evidence_sha256=evidence_sha256 WHERE organization_id=$1",
        "DELETE FROM model_live_runtime_host_evidence WHERE organization_id=$1",
      ])
        await expect(
          harness.database.query(sql(statement, [f.scope.organizationId])),
        ).rejects.toThrow();
      for (const patch of [
        {
          evidence_record: {
            ...f.inputEvidence,
            rawPrompt: "Synthetic unaccepted prompt.",
          },
        },
        { plan_sha256: "f".repeat(64) },
        { case_sha256: "f".repeat(64) },
        { input_sha256: "f".repeat(64) },
      ]) {
        const candidate: Record<string, unknown> = {
          ...row,
          ...patch,
          evidence_id: "evidence_" + "f".repeat(64),
        };
        const record = rehashLiveAccountingTestMetadata(
          {
            ...("evidence_record" in patch
              ? patch.evidence_record
              : f.inputEvidence),
            evidenceId: candidate["evidence_id"],
            inputDigest: "sha256:" + String(candidate["input_sha256"]),
          },
          "evidenceDigest",
        );
        candidate["evidence_record"] = record;
        candidate["evidence_sha256"] = String(record["evidenceDigest"]).slice(
          7,
        );
        const columns = Object.keys(candidate).filter(
          (k) => k !== "created_at",
        );
        await expect(
          harness.database.query(
            sql(
              "INSERT INTO model_live_runtime_host_evidence (" +
                columns.join(",") +
                ") VALUES (" +
                columns.map((_, i) => "$" + String(i + 1)).join(",") +
                ")",
              columns.map((k) => {
                if (k === "evidence_record")
                  return JSON.stringify(candidate[k]);
                const value = candidate[k];
                if (value !== null && typeof value !== "string")
                  throw Error("Unexpected synthetic metadata scalar.");
                return value;
              }),
            ),
          ),
        ).rejects.toThrow();
      }
      expect((await f.rows()).rowCount).toBe(1);
    });
    it.each([
      { requested: { nodeCount: null } },
      { requested: { nodeCount: -1 } },
      { requested: { fileCount: 1.5 } },
      { requested: { dependencyNames: ["bad package"] } },
      { requested: { moduleSources: ["../unreviewed"] } },
      { requested: { outputBytes: 16777217 } },
      { requested: { repairAttempts: 3 } },
      { sourceOwnership: { status: "verified", evidenceDigests: [] } },
      {
        sourceOwnership: {
          status: "not-applicable",
          evidenceDigests: [digestStructuredValue("binding")],
        },
      },
    ])("SQL denies malformed bounded input metadata %j", async (patch) => {
      // One issued input is enough; the database shape function must reject invalid
      // nested values even when a forged record repeats its own digest.
      const f = await fixture();
      const record = {
        ...f.inputEvidence,
        ...patch,
        requested: { ...f.inputEvidence.requested, ...patch.requested },
      };
      const result = await harness.database.query(
        sql(
          "SELECT cloudmarkup_live_host_evidence_shape($1::jsonb,'input') AS valid",
          [JSON.stringify(record)],
        ),
      );
      expect(result.rows[0]?.["valid"]).toBe(false);
    });
  },
);
