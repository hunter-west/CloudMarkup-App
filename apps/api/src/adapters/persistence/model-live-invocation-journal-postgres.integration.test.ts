import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizedModelUsageV1Schema } from "@cloudmarkup/schemas";
import {
  digestStructuredValue,
  parseIntentPreviewGenerationEvidenceV1,
  parseModelLiveGenerationEvidenceV2,
} from "@cloudmarkup/model-gateway";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createLiveJournalPgFixture } from "./model-live-invocation-journal-pg-test-helpers.js";
import { PostgresModelLiveInvocationJournal } from "./model-live-invocation-journal.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "V2 evaluation journal retains only actual invocation metadata",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(() => harness.setup(), 60000);
    afterAll(() => harness.teardown(), 30000);
    it.each(["standard", "deep"] as const)(
      "records %s usage and output digest without a content or settlement claim",
      async (mode) => {
        const f = await createLiveJournalPgFixture(harness, mode);
        await Promise.all([
          f.journal.prepare(f.callback),
          f.journal.prepare(f.callback),
        ]);
        expect(await f.journal.claim(f.claim)).toEqual({ kind: "claimed" });
        expect(await f.journal.claim(f.claim)).toEqual({
          kind: "duplicate-in-progress",
        });
        await Promise.all([
          f.journal.record(f.usage),
          f.journal.record(f.usage),
        ]);
        await f.journal.complete(f.claim, f.gatewayResult);
        expect(await f.journal.claim(f.claim)).toEqual({
          kind: "duplicate-result-unavailable",
        });
        expect(
          await f.journal.listByInvocationId(f.claim.invocationId),
        ).toEqual([f.usage]);
        const row = await f.row();
        expect(row).toMatchObject({
          gateway_state: "complete",
          output_sha256: digestStructuredValue(f.gatewayResult.response).slice(
            7,
          ),
        });
        expect(JSON.stringify(row)).not.toContain("proposalContext");
        expect(JSON.stringify(row)).not.toContain(
          "Synthetic schema-only fixture",
        );
        expect(
          parseModelLiveGenerationEvidenceV2(
            row?.["generation_evidence"],
            f.record.request,
            f.runtime.request,
          ),
        ).toMatchObject({ status: "completed" });
        expect(() =>
          parseIntentPreviewGenerationEvidenceV1(
            row?.["generation_evidence"],
            f.record.request,
          ),
        ).toThrow();
        expect(Reflect.has(f.journal, "settle")).toBe(false);
        expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual({
          kind: "pending",
        });
        const ledger = await harness.database.query(
          sql(
            "SELECT entry_kind FROM usage_ledger_entries WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(ledger.rows.map((r) => r["entry_kind"]).sort()).toEqual([
          "grant",
          "reservation",
        ]);
      },
    );

    it.each(["standard", "deep"] as const)(
      "recovers %s failed usage from exact durable metadata without financial writes",
      async (mode) => {
        const f = await createLiveJournalPgFixture(harness, mode);
        expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual({
          kind: "unavailable",
        });
        await f.journal.prepare(f.callback);
        expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual({
          kind: "pending",
        });
        await f.journal.claim(f.claim);
        await f.journal.fail(f.claim, "untrusted provider timeout");
        expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual({
          kind: "pending",
        });
        await f.plans.revoke(f.identity);
        await f.journal.record(f.usage);
        const before = await f.row();
        const recovered = await f.journal.recoverVerified(f.recoveryInput);
        expect(recovered).toMatchObject({
          kind: "verified",
          authority: "canonical-model-live-invocation-v2",
          dispatchIntentId: f.callback.dispatchIntentId,
          source: "failed-generation",
          outputDigest: null,
          validationReceiptDigest: null,
          result: {
            usefulOutputDelivered: false,
            status: "internal-failure",
            attempts: [
              {
                usage: {
                  inputUnits: Number(f.usage.inputUnits),
                  outputUnits: Number(f.usage.outputUnits),
                },
              },
            ],
          },
        });
        expect(await f.journal.recoverVerified(f.recoveryInput)).toEqual(
          recovered,
        );
        expect(await f.row()).toEqual(before);
        const entries = await harness.database.query(
          sql(
            "SELECT entry_kind FROM usage_ledger_entries WHERE organization_id=$1",
            [f.scope.organizationId],
          ),
        );
        expect(entries.rows.map((row) => row["entry_kind"]).sort()).toEqual([
          "grant",
          "reservation",
        ]);
      },
    );
    it.each(["request", "admission", "dispatch", "dispatch-time"] as const)(
      "rejects recovery with substituted %s identity",
      async (part) => {
        const f = await createLiveJournalPgFixture(harness);
        await f.journal.prepare(f.callback);
        await f.journal.claim(f.claim);
        await f.journal.record(f.usage);
        await f.journal.fail(f.claim, "synthetic failure");
        const input = {
          ...f.recoveryInput,
          ...(part === "request"
            ? {
                request: {
                  ...f.recoveryInput.request,
                  requestId: "foreign_request",
                },
              }
            : {}),
          ...(part === "admission"
            ? {
                admissionRequest: {
                  ...f.recoveryInput.admissionRequest,
                  evaluationCaseDigest: digestStructuredValue("foreign case"),
                },
              }
            : {}),
          ...(part === "dispatch"
            ? {
                dispatchIntent: {
                  ...f.recoveryInput.dispatchIntent,
                  dispatchIntentId: "foreign_dispatch",
                },
              }
            : {}),
          ...(part === "dispatch-time"
            ? {
                dispatchIntent: {
                  ...f.recoveryInput.dispatchIntent,
                  recordedAt: "2020-01-01T00:00:00.000Z",
                },
              }
            : {}),
        };
        await expect(f.journal.recoverVerified(input)).rejects.toThrow();
        expect((await f.journal.recoverVerified(f.recoveryInput)).kind).toBe(
          "verified",
        );
      },
    );

    it("rolls back output acceptance if approval changes before commit", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.record(f.usage);
      f.withdrawDuringJournalCompletion();
      await expect(
        f.journal.complete(f.claim, f.gatewayResult),
      ).rejects.toThrow();
      expect(await f.row()).toMatchObject({
        gateway_state: "claimed",
        normalized_usage: f.usage,
        output_sha256: null,
        generation_evidence: null,
      });
    });
    it("claims at most once across concurrent callers", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      expect(
        (
          await Promise.all([
            f.journal.claim(f.claim),
            f.journal.claim(f.claim),
          ])
        )
          .map((r) => r.kind)
          .sort(),
      ).toEqual(["claimed", "duplicate-in-progress"]);
    });
    it("requires usage before accepting output and never invents unknown usage", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await expect(
        f.journal.complete(f.claim, f.gatewayResult),
      ).rejects.toThrow();
      await f.journal.fail(f.claim, "sensitive arbitrary provider text");
      expect(await f.row()).toMatchObject({
        gateway_state: "failed",
        normalized_usage: null,
        generation_evidence: null,
        output_sha256: null,
      });
      expect(JSON.stringify(await f.row())).not.toContain(
        "sensitive arbitrary",
      );
    });
    it.each(["revocation", "operators", "configuration"] as const)(
      "records genuine late usage after %s but denies output acceptance",
      async (withdrawal) => {
        const f = await createLiveJournalPgFixture(harness);
        await f.journal.prepare(f.callback);
        await f.journal.claim(f.claim);
        if (withdrawal === "revocation") await f.plans.revoke(f.identity);
        else if (withdrawal === "operators") f.removeOperators();
        else f.removeConfiguration();
        await f.journal.record(f.usage);
        await expect(
          f.journal.complete(f.claim, f.gatewayResult),
        ).rejects.toThrow();
        await f.journal.fail(f.claim, "untrusted error");
        expect(await f.row()).toMatchObject({
          gateway_state: "failed",
          normalized_usage: f.usage,
          output_sha256: null,
        });
        expect(
          await f.journal.listByInvocationId(f.claim.invocationId),
        ).toEqual([f.usage]);
        await expect(f.journal.claim(f.claim)).rejects.toThrow();
      },
    );
    it("retains a late known usage receipt after failure without permitting redispatch", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.fail(f.claim, "timeout");
      await f.plans.revoke(f.identity);
      await f.journal.record(f.usage);
      expect(await f.row()).toMatchObject({
        gateway_state: "failed",
        generation_evidence: { status: "internal-failure" },
        normalized_usage: f.usage,
        output_sha256: null,
      });
    });
    it.each([
      { attemptNumber: 2 },
      { modelId: "foreign.model" },
      { providerId: "foreign.provider" },
      { inputDigest: digestStructuredValue("foreign") },
      { idempotencyKeyDigest: digestStructuredValue("foreign") },
      { inputUnits: "999999" },
      { promptVersion: "9.9.9" },
    ])("denies substituted usage %j", async (patch) => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await expect(
        f.journal.record(
          normalizedModelUsageV1Schema.parse({ ...f.usage, ...patch }),
        ),
      ).rejects.toThrow();
      expect((await f.row())?.["normalized_usage"]).toBeNull();
    });
    it("binds claim authority and rejects content-bearing binding extensions", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await expect(
        f.journal.claim({
          ...f.claim,
          authorityDigest: digestStructuredValue("foreign"),
        }),
      ).rejects.toThrow();
      expect(
        () =>
          new PostgresModelLiveInvocationJournal({
            ...f.options,
            binding: {
              ...f.journalBinding,
              ...{ prompt: "untrusted content" },
            },
          }),
      ).toThrow();
    });
    it("rejects another verified tenant's plan store without exposing or changing journal metadata", async () => {
      const owner = await createLiveJournalPgFixture(harness);
      const other = await createLiveJournalPgFixture(harness);
      await owner.journal.prepare(owner.callback);
      const before = await owner.row();
      const crossed = new PostgresModelLiveInvocationJournal({
        ...owner.options,
        plans: other.plans,
      });
      await expect(crossed.prepare(owner.callback)).rejects.toMatchObject({
        code: "model-live.journal-unavailable",
      });
      await expect(
        crossed.listByInvocationId(owner.claim.invocationId),
      ).rejects.toThrow();
      await expect(
        crossed.recoverVerified(owner.recoveryInput),
      ).rejects.toThrow();
      expect(await owner.row()).toEqual(before);
      expect(await other.row()).toBeUndefined();
    });
    it("requires current tenant membership for historical usage reads", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.record(f.usage);
      await harness.database.query(
        sql(
          "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
          [f.scope.organizationId, f.scope.userId],
        ),
      );
      await expect(
        f.journal.listByInvocationId(f.claim.invocationId),
      ).rejects.toThrow();
      await expect(
        f.journal.recoverVerified(f.recoveryInput),
      ).rejects.toThrow();
    });
    it("rejects mutated output usage and preserves the recorded receipt", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.record(f.usage);
      await expect(
        f.journal.complete(f.claim, {
          ...f.gatewayResult,
          usage: { ...f.usage, outputUnits: "6" },
        }),
      ).rejects.toThrow();
      expect(await f.row()).toMatchObject({
        gateway_state: "claimed",
        normalized_usage: f.usage,
        output_sha256: null,
      });
    });
    it("SQL rejects usage rewrites, claim reset, content fields and deletion", async () => {
      const f = await createLiveJournalPgFixture(harness);
      await f.journal.prepare(f.callback);
      await f.journal.claim(f.claim);
      await f.journal.record(f.usage);
      for (const change of [
        "normalized_usage=jsonb_set(normalized_usage,'{outputUnits}','\"8\"')",
        "gateway_state='registered',gateway_claim=NULL",
        'binding=binding||\'{"prompt":"untrusted content"}\'::jsonb',
      ])
        await expect(
          harness.database.query(
            sql(
              "UPDATE model_live_invocations SET " +
                change +
                " WHERE organization_id=$1",
              [f.scope.organizationId],
            ),
          ),
        ).rejects.toThrow();
      await expect(
        harness.database.query(
          sql("DELETE FROM model_live_invocations WHERE organization_id=$1", [
            f.scope.organizationId,
          ]),
        ),
      ).rejects.toThrow();
    });
  },
);
