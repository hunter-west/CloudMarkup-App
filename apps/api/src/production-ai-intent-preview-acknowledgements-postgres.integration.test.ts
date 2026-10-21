import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createPreviewAuthorityFixture } from "./adapters/persistence/ai-intent-preview-authority-test-helpers.js";
import { createModelAccountingPgTestHarness } from "./adapters/persistence/model-commercial-accounting-pg-test-helpers.js";
import { sql } from "./adapters/persistence/sql.js";
import { createProductionAiIntentPreviewAcknowledgements } from "./production-ai-intent-preview-acknowledgements.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
integration(
  "real fresh-request preview acknowledgement HTTP and PostgreSQL",
  () => {
    const harness = createModelAccountingPgTestHarness(configured);
    beforeAll(() => harness.setup(), 60000);
    afterAll(() => harness.teardown(), 30000);
    async function fixture(deliver = true) {
      const tenant = await harness.tenant();
      const f = await createPreviewAuthorityFixture(harness.database, {
        organizationId: tenant.scope.organizationId,
        projectId: tenant.scope.projectId,
        userId: tenant.scope.userId,
        jobId: `job_${randomUUID()}`,
      });
      const delivery = deliver
        ? await f.disconnect()
        : {
            contractVersion: 1 as const,
            invocationId: f.preview.binding.invocationId,
            outputDigest: f.preview.binding.inputDigest,
            token: "A".repeat(43),
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          };
      function app(
        session = f.authority.principal.sessionId,
        principalId = f.authority.principal.principalId,
      ) {
        return createApp({
          application: new InMemoryCloudMarkupApplication({}),
          principalResolver: new FixedPrincipalResolver({
            "Bearer synthetic-owner": {
              ...f.authority.principal,
              sessionId: session,
              principalId,
            },
          }),
          aiIntentPreviewAcknowledgements:
            createProductionAiIntentPreviewAcknowledgements(harness.database),
        });
      }
      const body = {
        contractVersion: 1,
        delivery,
        editingProof: f.authority.editingProof,
      };
      const path = `/v1/projects/${f.preview.scope.projectId}/ai-intent-previews/acknowledgement`;
      const request = (instance = app(), payload = body, target = path) =>
        instance.request(target, {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-owner",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      const state = async () =>
        (
          await harness.database.query(
            sql(
              "SELECT delivery_state FROM ai_intent_previews WHERE organization_id=$1 AND invocation_id=$2",
              [f.preview.scope.organizationId, f.preview.binding.invocationId],
            ),
          )
        ).rows[0]?.["delivery_state"];
      return { f, app, body, request, state, path };
    }
    it("acknowledges concurrently in separately constructed hosts after RAM loss without another reserve/dispatch", async () => {
      const { f, request, state } = await fixture();
      const counts = async () =>
        (
          await harness.database.query(
            sql(
              `SELECT
        (SELECT count(*)::text FROM stored_objects WHERE organization_id=$1) AS objects,
        (SELECT count(*)::text FROM ai_intent_previews WHERE organization_id=$1) AS previews,
        (SELECT count(*)::text FROM ai_intent_preview_authorities WHERE organization_id=$1) AS authorities`,
              [f.preview.scope.organizationId],
            ),
          )
        ).rows;
      const before = await counts();
      for (const response of await Promise.all([request(), request()])) {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          apiVersion: "v1",
          data: { contractVersion: 1, state: "acknowledged" },
        });
        expect(response.headers.get("cache-control")).toContain("no-store");
      }
      expect((await request()).status).toBe(200);
      expect(await state()).toBe("acknowledged");
      expect(f.invocations).toBe(1);
      expect(f.commercial.accounting.reserveCalls).toBe(1);
      expect(await counts()).toEqual(before);
    }, 60000);
    it.each([
      "session",
      "principal",
      "tab",
      "delivery",
      "draft",
      "released-lease",
    ] as const)(
      "denies changed %s at the real boundary without updating delivery",
      async (change) => {
        const { f, app, body, request, state } = await fixture();
        const input = {
          ...body,
          delivery:
            change === "delivery"
              ? { ...body.delivery, token: "Q".repeat(42) + "A" }
              : body.delivery,
          editingProof:
            change === "tab"
              ? { ...body.editingProof, token: "Q".repeat(42) + "A" }
              : body.editingProof,
        };
        if (change === "draft") await f.advanceDraft(true);
        if (change === "released-lease")
          await f.leases.release(
            f.authority.principal,
            f.preview.scope.projectId,
            f.authority.editingProof,
          );
        const instance =
          change === "session"
            ? app("session_other")
            : change === "principal"
              ? app(undefined, "principal_other")
              : app();
        const response = await request(instance, input);
        expect(response.status).toBe(409);
        expect(await response.text()).not.toContain(body.delivery.token);
        expect(await state()).toBe("pending");
        expect(f.invocations).toBe(1);
        expect(f.commercial.accounting.reserveCalls).toBe(1);
      },
      60000,
    );
    it("rejects an otherwise valid foreign-tenant path without disclosing its delivery", async () => {
      const owner = await fixture();
      const other = await fixture();
      const response = await owner.request(owner.app(), other.body, other.path);
      expect(response.status).toBe(409);
      expect(await owner.state()).toBe("pending");
      expect(await other.state()).toBe("pending");
    }, 60000);
    it("does not create missing preview metadata, reserve or dispatch", async () => {
      const { f, request, state } = await fixture(false);
      expect((await request()).status).toBe(409);
      expect(await state()).toBeUndefined();
      expect(f.invocations).toBe(0);
      expect(f.commercial.accounting.reserveCalls).toBe(0);
    }, 60000);
  },
);
