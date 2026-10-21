import { describe, expect, it } from "vitest";
import { PostgresModelCommercialReservations } from "./model-commercial-accounting.js";
import { CommercialPersistenceError } from "../../application/commercial-persistence.js";
import type { SqlDatabase } from "./sql.js";
import {
  digestStructuredValue,
  projectModelCommercialReservationV1,
} from "@cloudmarkup/model-gateway";
import { modelAccountingFixture } from "./model-commercial-accounting-test-helpers.js";
import {
  accountingNumber,
  modelAccountingBindingSchema,
  modelAccountingPhysicalId,
  verifyModelReservationInput,
} from "./model-commercial-accounting-codec.js";

describe("canonical model reservation metadata", () => {
  it("ignores undeclared transaction and version hooks on the normal adapter", async () => {
    const f = await modelAccountingFixture();
    let injected = false;
    const database: SqlDatabase = {
      query: () => Promise.resolve({ rows: [], rowCount: 0 }),
      transaction: (work) => work(database),
      close: () => Promise.resolve(),
    };
    const input = {
      database,
      scope: f.scope,
      binding: {
        workflowId: f.request.multiCallWorkflowId,
        workflowFingerprint: f.fingerprint,
        runtimeScopeDigest: digestStructuredValue("synthetic runtime scope"),
        runtimeFingerprint: digestStructuredValue(
          "synthetic runtime fingerprint",
        ),
      },
      mapping: "live-evaluation-runtime-windows-v2",
      authorityTransactions: {
        run: () => {
          injected = true;
          return Promise.resolve();
        },
      },
    };
    await expect(
      new PostgresModelCommercialReservations(input).reserve(f.input),
    ).rejects.toBeInstanceOf(CommercialPersistenceError);
    expect(injected).toBe(false);
  });
  it("projects every existing coordinator reservation field and isolates nested values", async () => {
    const f = await modelAccountingFixture();
    expect(f.input.intent.eventDigest).toBe(
      digestStructuredValue(f.input.event),
    );
    expect(f.input.intent.capacityDigest).toBe(
      digestStructuredValue(f.input.capacity),
    );
    expect(verifyModelReservationInput(f.input, f.record)).toEqual(f.input);
    const copy = projectModelCommercialReservationV1(f.record);
    expect(copy.capacity.featureRequests).not.toBe(
      f.record.resolvedContext?.authorization.featureRequests,
    );
    expect(() =>
      projectModelCommercialReservationV1({
        ...f.record,
        reservationIntent: null,
      }),
    ).toThrow();
  });
  it("rejects extra content, changed authority and incomplete event projections", async () => {
    const f = await modelAccountingFixture();
    for (const input of [
      { ...f.input, rawPrompt: "synthetic disallowed content" },
      { ...f.input, requestedCreditUnits: f.input.requestedCreditUnits + 1 },
      { ...f.input, event: { ...f.input.event, userId: "another_user" } },
      { ...f.input, event: { ...f.input.event, cacheWriteUnits: 1 } },
      {
        ...f.input,
        intent: { ...f.input.intent, intentId: "fabricated_intent" },
      },
    ])
      expect(() => verifyModelReservationInput(input, f.record)).toThrow();
  });
  it("scopes equal logical IDs by tenant, project, principal and identity kind", async () => {
    const f = await modelAccountingFixture();
    const ids = new Set([
      modelAccountingPhysicalId("request", f.record),
      modelAccountingPhysicalId("reservation", f.record),
      ...["organizationId", "projectId", "userId"].map((key) =>
        modelAccountingPhysicalId("reservation", {
          ...f.record,
          request: { ...f.request, [key]: "another_identity" },
        }),
      ),
    ]);
    expect(ids.size).toBe(5);
    for (const value of ids)
      expect(value).toMatch(/^model_(request|reservation)_[a-f0-9]{64}$/u);
  });
  it("rejects unsafe integer coercion and browser-authored binding additions", () => {
    for (const value of [
      null,
      undefined,
      true,
      "",
      "1.5",
      "-1",
      "9007199254740992",
      "01",
    ])
      expect(() => accountingNumber(value)).toThrow();
    expect(accountingNumber("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      modelAccountingBindingSchema.safeParse({
        workflowId: "workflow_one",
        workflowFingerprint: digestStructuredValue(1),
        runtimeScopeDigest: digestStructuredValue(2),
        runtimeFingerprint: digestStructuredValue(3),
        maximum: 1000000,
      }).success,
    ).toBe(false);
  });
});
