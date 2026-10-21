import {
  createSeedValidationPgFixture,
  type SeedValidationAdapterOverrides as Overrides,
} from "./model-live-seed-validation-pg-test-helpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import { createModelAccountingPgTestHarness } from "./model-commercial-accounting-pg-test-helpers.js";
import { applySeedValidationProposal } from "./model-live-proposal-migrations-test-helpers.js";
import { PostgresModelLiveSequences } from "./model-live-sequences.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const integration = configured ? describe : describe.skip;
const caseId = "evaluation_case_repair_success_full_beta_v1";
const denied = { code: "model-live-evaluation.seed-validation-unavailable" };
integration("authenticated fixed-seed receipts on actual PostgreSQL", () => {
  const harness = createModelAccountingPgTestHarness(configured);
  beforeAll(async () => {
    await harness.setup();
    await applySeedValidationProposal(harness.database);
  }, 120000);
  afterAll(() => harness.teardown(), 30000);

  const fixture = createSeedValidationPgFixture(harness);

  const reference = (
    receipt: Awaited<ReturnType<PostgresModelLiveSequences["validateSeed"]>>,
  ) => ({
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
  });
  it("owns the failing run outside SQL, restores exact current bindings and replays one immutable receipt", async () => {
    const f = await fixture();
    const preflight = f.host.assertHostIsolation.getMockImplementation();
    f.host.assertHostIsolation.mockImplementation(() => {
      expect(f.state.transactionDepth).toBe(0);
      if (!preflight) throw Error("Expected test preflight");
      return preflight();
    });
    const open = f.host.open.getMockImplementation();
    f.host.open.mockImplementation((input) => {
      expect(f.state.transactionDepth).toBe(0);
      if (!open) throw Error("Expected test executor");
      return open(input);
    });
    const adapter = f.make();
    const receipt = await adapter.validateSeed(caseId);
    expect(receipt.scope).toEqual(f.scope);
    expect(receipt.operatorUserId).toBe(f.scope.userId);
    expect(await adapter.currentSeedValidation(reference(receipt))).toEqual(
      receipt,
    );
    expect(await adapter.validateSeed(caseId)).toEqual(receipt);
    expect(f.host.open).toHaveBeenCalledTimes(1);
    expect(await f.count()).toBe(1);
    const text = JSON.stringify(receipt);
    expect(text).not.toContain("repairSeedTypeWitness");
    expect(text).not.toContain('"files"');
    expect(text).not.toContain('"grade"');
    expect(text).not.toContain("Type 'string'");
  }, 30000);
  it.each([
    "expired",
    "stale-auth",
    "operator",
    "host",
    "environment",
    "scope",
    "malformed",
  ] as const)("denies %s before native execution", async (kind) => {
    const f = await fixture();
    const overrides: Overrides = {};
    if (kind === "expired")
      overrides.principal = {
        ...f.principal,
        expiresAt: f.principal.authenticatedAt,
      };
    if (kind === "stale-auth")
      overrides.principal = {
        ...f.principal,
        authenticatedAt: new Date(
          Date.parse(f.principal.authenticatedAt) - 3600000,
        ).toISOString(),
      };
    if (kind === "operator") f.state.operators = [];
    if (kind === "host") f.state.available = false;
    if (kind === "environment")
      f.host.admission.environment.environmentType = "staging";
    if (kind === "scope")
      overrides.scope = { ...f.scope, projectId: "project_foreign" };
    const adapter = f.make(overrides);
    await expect(
      adapter.validateSeed(
        kind === "malformed" ? { caseId, source: "caller" } : caseId,
      ),
    ).rejects.toMatchObject(denied);
    expect(f.host.open).not.toHaveBeenCalled();
    expect(await f.count()).toBe(0);
  });
  it("prepares only the actual issued seed without holding SQL locks or issuing another receipt", async () => {
    const f = await fixture();
    const adapter = f.make();
    const receipt = await adapter.validateSeed(caseId);
    const preflight = f.host.assertHostIsolation.getMockImplementation();
    f.host.events.splice(0);
    let reachedPreflight = false;
    f.host.assertHostIsolation.mockImplementation(async () => {
      expect(f.state.transactionDepth).toBe(0);
      if (!preflight) throw Error("Expected test preflight");
      await preflight();
      reachedPreflight = true;
    });
    const prepared = await adapter.prepareSeedRepair(caseId, "guided");
    expect(reachedPreflight).toBe(true);
    expect(prepared.authority).toBe("unissued-repair-input");
    expect(prepared.receiptDigest).toBe(receipt.receiptDigest);
    expect(prepared.request.hostSeed.seedValidationReceiptDigest).toBe(
      receipt.receiptDigest,
    );
    expect(prepared.request.failedCandidates[0]?.contentDigest).toBe(
      receipt.bindings.extensionContentDigest,
    );
    expect(f.host.events).toEqual(["preflight"]);
    expect(f.host.open).toHaveBeenCalledTimes(1);
    expect(await f.count()).toBe(1);
  });
  it.each([
    "missing",
    "operator",
    "scope",
    "mode",
    "case",
    "host",
    "authentication",
  ] as const)(
    "denies %s preparation before RAM source admission",
    async (kind) => {
      const f = await fixture();
      if (kind !== "missing") await f.make().validateSeed(caseId);
      f.host.events.splice(0);
      const overrides: Overrides = {};
      if (kind === "operator") f.state.operators = [];
      if (kind === "host") f.state.available = false;
      if (kind === "scope")
        overrides.scope = { ...f.scope, projectId: "foreign_project" };
      if (kind === "authentication")
        overrides.principal = {
          ...f.principal,
          authenticatedAt: new Date(
            Date.parse(f.principal.authenticatedAt) - 3600000,
          ).toISOString(),
        };
      await expect(
        f
          .make(overrides)
          .prepareSeedRepair(
            kind === "case" ? { caseId, source: "caller content" } : caseId,
            kind === "mode" ? "unknown" : "guided",
          ),
      ).rejects.toMatchObject(denied);
      expect(f.host.events).toEqual([]);
      expect(await f.count()).toBe(kind === "missing" ? 0 : 1);
    },
  );
  it.each(["operator", "host", "membership", "cancel", "pins"] as const)(
    "rechecks %s after RAM source preparation and preserves the original receipt",
    async (kind) => {
      const f = await fixture();
      await f.make().validateSeed(caseId);
      let reachedPreflight = false;
      f.host.assertHostIsolation.mockImplementation(async () => {
        expect(f.state.transactionDepth).toBe(0);
        if (kind === "operator") f.state.operators = [];
        if (kind === "host") f.state.available = false;
        if (kind === "pins")
          f.host.admission.helperDigest = sha256DigestSchema.parse(
            "sha256:" + "f".repeat(64),
          );
        if (kind === "cancel") f.host.controller.abort();
        if (kind === "membership")
          await harness.database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
        reachedPreflight = true;
      });
      await expect(
        f.make().prepareSeedRepair(caseId, "guided", f.host.controller.signal),
      ).rejects.toMatchObject(denied);
      expect(reachedPreflight).toBe(true);
      expect(await f.count()).toBe(1);
      if (kind === "membership") {
        const state = await harness.database.query(
          sql(
            "SELECT lifecycle_status FROM memberships WHERE organization_id=$1 AND principal_id=$2",
            [f.scope.organizationId, f.scope.userId],
          ),
        );
        expect(state.rows[0]?.["lifecycle_status"]).toBe("suspended");
      }
    },
  );
  it("rejects an unverified principal during construction", async () => {
    const f = await fixture();
    expect(() =>
      f.make({
        principal: {
          ...f.principal,
          authenticationSource: "local-development",
        },
      }),
    ).toThrow();
    expect(f.host.open).not.toHaveBeenCalled();
  });
  it.each(["preflight", "lint", "diagnostic", "cleanup", "cancel"] as const)(
    "retains no receipt after %s failure",
    async (fault) => {
      const f = await fixture(fault);
      await expect(
        f.make().validateSeed(caseId, f.host.controller.signal),
      ).rejects.toMatchObject(denied);
      expect(await f.count()).toBe(0);
    },
  );
  it.each(["operator", "host", "membership", "cancel", "pins"] as const)(
    "rechecks %s after execution and before insertion",
    async (kind) => {
      const f = await fixture();
      const open = f.host.open.getMockImplementation();
      f.host.open.mockImplementation(async (input) => {
        if (!open) throw Error("Expected test executor");
        const session = await open(input);
        return {
          ...session,
          async dispose() {
            await session.dispose();
            if (kind === "operator") f.state.operators = [];
            if (kind === "host") f.state.available = false;
            if (kind === "pins")
              f.host.admission.helperDigest = sha256DigestSchema.parse(
                "sha256:" + "f".repeat(64),
              );
            if (kind === "cancel") f.host.controller.abort();
            if (kind === "membership")
              await harness.database.query(
                sql(
                  "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
                  [f.scope.organizationId, f.scope.userId],
                ),
              );
          },
        };
      });
      await expect(
        f.make().validateSeed(caseId, f.host.controller.signal),
      ).rejects.toMatchObject(denied);
      expect(await f.count()).toBe(0);
    },
  );
  it("rolls back an insert if configured authority is withdrawn before commit", async () => {
    const f = await fixture();
    f.state.afterInsert = () => {
      f.state.available = false;
      return Promise.resolve();
    };
    await expect(f.make().validateSeed(caseId)).rejects.toMatchObject(denied);
    expect(await f.count()).toBe(0);
  });
  it("concurrent issuance converges on one stored receipt", async () => {
    const f = await fixture();
    const [first, second] = await Promise.all([
      f.make().validateSeed(caseId),
      f.make().validateSeed(caseId),
    ]);
    expect(first).toEqual(second);
    expect(await f.count()).toBe(1);
  }, 30000);
  it("rejects foreign tenant and changed receipt references", async () => {
    const first = await fixture(),
      second = await fixture();
    const receipt = await first.make().validateSeed(caseId);
    await expect(
      second.make().currentSeedValidation(reference(receipt)),
    ).rejects.toMatchObject(denied);
    await expect(
      first.make().currentSeedValidation({
        ...reference(receipt),
        receiptDigest: "sha256:" + "f".repeat(64),
      }),
    ).rejects.toMatchObject(denied);
    expect(second.host.open).not.toHaveBeenCalled();
  }, 30000);
  it.each(["operator", "host", "membership", "pins"] as const)(
    "current restoration rejects withdrawn %s and retains immutable history",
    async (kind) => {
      const f = await fixture();
      const receipt = await f.make().validateSeed(caseId);
      if (kind === "operator") f.state.operators = [];
      if (kind === "host") f.state.available = false;
      if (kind === "pins")
        f.host.admission.helperDigest = sha256DigestSchema.parse(
          "sha256:" + "f".repeat(64),
        );
      if (kind === "membership")
        await harness.database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
            [f.scope.organizationId, f.scope.userId],
          ),
        );
      await expect(
        f.make().currentSeedValidation(reference(receipt)),
      ).rejects.toMatchObject(denied);
      expect(await f.count()).toBe(1);
    },
    30000,
  );
  it.each(["operator", "membership", "host"] as const)(
    "rechecks current %s after source reconstruction outside SQL",
    async (kind) => {
      const f = await fixture();
      const receipt = await f.make().validateSeed(caseId);
      f.host.assertHostIsolation.mockImplementationOnce(async () => {
        expect(f.state.transactionDepth).toBe(0);
        if (kind === "operator") f.state.operators = [];
        if (kind === "host") f.state.available = false;
        if (kind === "membership")
          await harness.database.query(
            sql(
              "UPDATE memberships SET lifecycle_status='suspended' WHERE organization_id=$1 AND principal_id=$2",
              [f.scope.organizationId, f.scope.userId],
            ),
          );
      });
      await expect(
        f.make().currentSeedValidation(reference(receipt)),
      ).rejects.toMatchObject(denied);
      expect(await f.count()).toBe(1);
    },
    30000,
  );
  it("denies an active non-owner even when configured as an operator", async () => {
    const f = await fixture();
    await harness.database.query(
      sql(
        "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) VALUES($1,'editor','authorization-v2',FALSE,cloudmarkup_authorization_v2_permissions('editor'))",
        [f.scope.organizationId],
      ),
    );
    await harness.database.query(
      sql(
        "UPDATE memberships SET role_key='editor' WHERE organization_id=$1 AND principal_id=$2",
        [f.scope.organizationId, f.scope.userId],
      ),
    );
    await expect(f.make().validateSeed(caseId)).rejects.toMatchObject(denied);
    expect(f.host.open).not.toHaveBeenCalled();
    expect(await f.count()).toBe(0);
  });
});
