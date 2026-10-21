import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiIntentPreviewError } from "../../application/ai-intent-preview-journal.js";
import type { AiIntentPreviewDeliveryProofV1 } from "../../application/ai-intent-preview-journal.js";
import { PostgresIntentRuntimeHostEvidence } from "./model-runtime-host-evidence.js";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { createPreviewAuthorityFixture } from "./ai-intent-preview-authority-test-helpers.js";
import { PostgresAiIntentPreviewJournal } from "./ai-intent-preview.js";
import { PreviewRequestAuthority } from "./ai-intent-preview-request-authority.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "original preview request authority on isolated real PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(() => harness.setup(), 60000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture(authenticationMilliseconds?: number) {
      const tenant = await harness.tenant();
      return createPreviewAuthorityFixture(
        harness.database,
        {
          organizationId: tenant.scope.organizationId,
          projectId: tenant.scope.projectId,
          userId: tenant.scope.userId,
          jobId: `job_${randomUUID()}`,
        },
        authenticationMilliseconds,
      );
    }
    async function deliveryState(organizationId: string) {
      return (
        await harness.database.query(
          sql(
            "SELECT gateway_state,delivery_state FROM ai_intent_previews WHERE organization_id=$1",
            [organizationId],
          ),
        )
      ).rows[0];
    }
    it("fresh requests ACK concurrently after original RAM loss, with one reserve/dispatch and exact recovery replay", async () => {
      const f = await fixture();
      const proof = await f.disconnect();
      await Promise.all([
        f.ack(structuredClone(proof)),
        f.ack(structuredClone(proof)),
      ]);
      await f.ack(proof);
      expect(await deliveryState(f.preview.scope.organizationId)).toMatchObject(
        { delivery_state: "acknowledged" },
      );
      const recovered = await f.commercial.coordinator.recover(
        f.preview.request,
      );
      expect(recovered.state).toBe("completed");
      expect(await f.commercial.coordinator.recover(f.preview.request)).toEqual(
        recovered,
      );
      expect(f.commercial.accounting.reserveCalls).toBe(1);
      expect(f.invocations).toBe(1);
      const restarted = new PostgresAiIntentPreviewJournal({
        database: harness.database,
        binding: f.preview.binding,
        requestAuthority: f.authority,
      });
      expect(await restarted.claim(f.preview.claim)).toEqual({
        kind: "duplicate-result-unavailable",
      });
    });
    it("does not create a preview or receipt when a fresh request names missing delivery metadata", async () => {
      const f = await fixture();
      await expect(
        f.ack({
          contractVersion: 1,
          invocationId: f.preview.binding.invocationId,
          outputDigest: f.preview.binding.inputDigest,
          token: "A".repeat(43),
          expiresAt: new Date(Date.now() + 30000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(
        await deliveryState(f.preview.scope.organizationId),
      ).toBeUndefined();
      expect(f.invocations).toBe(0);
      expect(f.commercial.accounting.reserveCalls).toBe(0);
    });
    it("keeps historical internal journals compatible without letting fresh ACK use a missing-receipt fallback", async () => {
      const f = await fixture();
      const legacy = new PostgresAiIntentPreviewJournal({
        database: harness.database,
        binding: f.preview.binding,
      });
      const evidence = new PostgresIntentRuntimeHostEvidence({
        database: harness.database,
        scope: f.preview.scope,
      });
      let proof: AiIntentPreviewDeliveryProofV1 | undefined;
      await expect(
        f.commercial.coordinator.execute(
          f.preview.request,
          async (callback) => {
            await legacy.prepare(callback);
            expect(await legacy.claim(f.preview.claim)).toEqual({
              kind: "claimed",
            });
            await legacy.record(f.preview.result.usage);
            await legacy.complete(f.preview.claim, f.preview.result);
            await evidence.issueInput(f.preview.invocation);
            proof = await legacy.prepareDelivery(
              await evidence.issueOutput(f.preview.outputInput),
            );
            throw new Error("Synthetic historical callback loss.");
          },
        ),
      ).rejects.toMatchObject({ code: "dependency-failure" });
      if (proof === undefined) throw new Error("Missing legacy proof.");
      await expect(f.ack(proof)).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(
        (
          await harness.database.query(
            sql(
              "SELECT 1 FROM ai_intent_preview_authorities WHERE organization_id=$1",
              [f.preview.scope.organizationId],
            ),
          )
        ).rowCount,
      ).toBe(0);
      await legacy.acknowledge(proof);
      expect(await deliveryState(f.preview.scope.organizationId)).toMatchObject(
        { delivery_state: "acknowledged" },
      );
    });
    it.each([
      "session",
      "principal",
      "project",
      "tab-token",
      "delivery-token",
      "output",
      "invocation",
      "expiry",
    ] as const)(
      "denies a fresh ACK with changed %s without modifying delivery",
      async (changed) => {
        const f = await fixture();
        const proof = await f.disconnect();
        const input = {
          principal: { ...f.authority.principal },
          projectId: f.preview.scope.projectId,
          editingProof: { ...f.authority.editingProof },
          proof: { ...proof },
        };
        if (changed === "session")
          input.principal.sessionId = "different_session";
        if (changed === "principal")
          input.principal.principalId = "different_principal";
        if (changed === "project") input.projectId = "different_project";
        if (changed === "tab-token") input.editingProof.token = "A".repeat(43);
        if (changed === "delivery-token") input.proof.token = "A".repeat(43);
        if (changed === "output")
          input.proof.outputDigest = f.preview.binding.inputDigest;
        if (changed === "invocation")
          input.proof.invocationId = "different_invocation";
        if (changed === "expiry")
          input.proof.expiresAt = "2099-01-01T00:00:00.000Z";
        await expect(f.ack(proof, input)).rejects.toBeInstanceOf(
          AiIntentPreviewError,
        );
        expect(
          await deliveryState(f.preview.scope.organizationId),
        ).toMatchObject({ delivery_state: "pending" });
        await f.ack(proof);
      },
    );
    it.each(["released", "replaced", "expired"] as const)(
      "denies the original tab after its lease is %s",
      async (state) => {
        const f = await fixture();
        const proof = await f.disconnect();
        const projectId = f.preview.scope.projectId;
        if (state === "expired")
          await harness.database.query(
            sql(
              "UPDATE project_editing_leases SET acquired_at=clock_timestamp()-INTERVAL '120 seconds',updated_at=clock_timestamp()-INTERVAL '61 seconds',expires_at=clock_timestamp()-INTERVAL '2 seconds' WHERE organization_id=$1 AND project_id=$2",
              [f.preview.scope.organizationId, projectId],
            ),
          );
        else {
          await f.leases.release(
            f.authority.principal,
            projectId,
            f.authority.editingProof,
          );
          if (state === "replaced") {
            const next = await f.leases.acquire(
              f.authority.principal,
              projectId,
              { token: "A".repeat(43) },
            );
            expect(next.state).toBe("owned");
            if (next.state === "owned")
              expect(next.leaseId).not.toBe(f.authority.editingProof.leaseId);
          }
        }
        await expect(f.ack(proof)).rejects.toBeInstanceOf(AiIntentPreviewError);
        expect(
          await deliveryState(f.preview.scope.organizationId),
        ).toMatchObject({ delivery_state: "pending" });
        await f.journal.closeDelivery();
        expect(
          (await f.commercial.coordinator.recover(f.preview.request)).state,
        ).toBe("compensated");
        expect(f.invocations).toBe(1);
      },
    );
    it.each([false, true])(
      "denies a pending/changed saved baseline, published=%s",
      async (publish) => {
        const f = await fixture();
        const proof = await f.disconnect();
        await f.advanceDraft(publish);
        await expect(f.ack(proof)).rejects.toBeInstanceOf(AiIntentPreviewError);
        expect(
          await deliveryState(f.preview.scope.organizationId),
        ).toMatchObject({ delivery_state: "pending" });
      },
    );
    it.each(["membership", "principal", "project"] as const)(
      "denies fresh ACK after current %s is inactive",
      async (kind) => {
        const f = await fixture();
        const proof = await f.disconnect();
        const statements = {
          membership: sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
            [f.preview.scope.organizationId, f.preview.scope.userId],
          ),
          principal: sql(
            "UPDATE principals SET lifecycle_status='suspended' WHERE principal_id=$1",
            [f.preview.scope.userId],
          ),
          project: sql(
            "UPDATE projects SET lifecycle_status='archived' WHERE project_id=$1",
            [f.preview.scope.projectId],
          ),
        };
        await harness.database.query(statements[kind]);
        await expect(f.ack(proof)).rejects.toBeInstanceOf(AiIntentPreviewError);
      },
    );
    it("does not let a refreshed same-session principal extend immutable original authentication", async () => {
      const f = await fixture(2500);
      const proof = await f.disconnect();
      const refreshed = {
        ...f.authority.principal,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
      await f.leases.renew(
        refreshed,
        f.preview.scope.projectId,
        f.authority.editingProof,
      );
      await harness.database.query(
        sql(
          "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM $1::timestamptz-clock_timestamp()))+0.02)",
          [f.authority.principal.expiresAt],
        ),
      );
      await expect(
        f.ack(proof, { principal: refreshed }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      expect(await deliveryState(f.preview.scope.organizationId)).toMatchObject(
        { delivery_state: "pending" },
      );
    });
    it("refuses expired current bearer independently of the original receipt", async () => {
      const f = await fixture();
      const proof = await f.disconnect();
      await expect(
        f.ack(proof, {
          principal: {
            ...f.authority.principal,
            authenticatedAt: "2020-01-01T00:00:00.000Z",
            expiresAt: "2020-01-02T00:00:00.000Z",
          },
        }),
      ).rejects.toBeInstanceOf(AiIntentPreviewError);
      await f.ack(proof);
    });
    it("rechecks original authority at deferred commit and rolls back a late direct ACK", async () => {
      const f = await fixture(2500);
      await f.disconnect();
      await expect(
        harness.database.transaction(async (tx) => {
          await tx.query(
            sql(
              "UPDATE ai_intent_previews SET delivery_state='acknowledged',acknowledged_at=clock_timestamp() WHERE organization_id=$1",
              [f.preview.scope.organizationId],
            ),
          );
          await tx.query(
            sql(
              "SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM $1::timestamptz-clock_timestamp()))+0.02)",
              [f.authority.principal.expiresAt],
            ),
          );
        }),
      ).rejects.toThrow("preview original request authority");
      expect(await deliveryState(f.preview.scope.organizationId)).toMatchObject(
        { delivery_state: "pending" },
      );
    });
    it("losing the lease before claim denies dispatch, but losing it after claim preserves known usage without emission", async () => {
      for (const beforeClaim of [true, false]) {
        const f = await fixture();
        const outcome = await f.commercial.coordinator.execute(
          f.preview.request,
          async (callback) => {
            await f.journal.prepare(callback);
            if (!beforeClaim)
              expect(await f.journal.claim(f.preview.claim)).toEqual({
                kind: "claimed",
              });
            await f.leases.release(
              f.authority.principal,
              f.preview.scope.projectId,
              f.authority.editingProof,
            );
            if (beforeClaim)
              await expect(
                f.journal.claim(f.preview.claim),
              ).rejects.toBeInstanceOf(AiIntentPreviewError);
            else {
              await f.journal.record(f.preview.result.usage);
              await f.journal.complete(f.preview.claim, f.preview.result);
              await expect(
                new PreviewRequestAuthority(f.authority).assertCurrent(
                  harness.database,
                  f.preview.scope,
                  f.preview.binding,
                ),
              ).rejects.toBeInstanceOf(AiIntentPreviewError);
            }
            throw new Error("Synthetic lost editing authority.");
          },
        );
        expect(outcome.state).toBe(
          beforeClaim ? "reconciliation-required" : "compensated",
        );
        expect(outcome.completedCreditUnits).toBe(beforeClaim ? null : 0);
        expect(f.commercial.accounting.reserveCalls).toBe(1);
        expect(
          await deliveryState(f.preview.scope.organizationId),
        ).toMatchObject({
          gateway_state: beforeClaim ? "registered" : "complete",
          delivery_state: beforeClaim ? "none" : "unconfirmed",
        });
      }
    });
    it("retains bounded immutable hashes only and rejects forged authority lineage", async () => {
      const f = await fixture();
      const proof = await f.disconnect();
      const metadata = (
        await harness.database.query(
          sql(
            "SELECT row_to_json(a)::text AS metadata FROM ai_intent_preview_authorities a WHERE organization_id=$1",
            [f.preview.scope.organizationId],
          ),
        )
      ).rows[0]?.["metadata"];
      expect(typeof metadata).toBe("string");
      if (typeof metadata !== "string") throw new Error("Missing metadata.");
      expect(Buffer.byteLength(metadata)).toBeLessThan(4096);
      for (const value of [
        f.authority.principal.sessionId,
        f.authority.editingProof.token,
        proof.token,
        f.preview.modelRequest.source.content,
        JSON.stringify(f.preview.result.response),
      ])
        expect(metadata).not.toContain(value);
      await expect(
        harness.database.query(
          sql(
            "UPDATE ai_intent_preview_authorities SET authentication_expires_at=clock_timestamp()+INTERVAL '1 hour' WHERE organization_id=$1",
            [f.preview.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        harness.database.query(
          sql(
            "DELETE FROM ai_intent_preview_authorities WHERE organization_id=$1",
            [f.preview.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        harness.database.query(
          sql(
            "INSERT INTO ai_intent_preview_authorities SELECT organization_id,project_id,principal_id,'forged_invocation',binding_sha256,draft_id,draft_version,content_sha256,lease_id,session_sha256,authentication_expires_at,created_at FROM ai_intent_preview_authorities WHERE organization_id=$1",
            [f.preview.scope.organizationId],
          ),
        ),
      ).rejects.toThrow();
      await f.ack(proof);
    });
  },
);
