import { describe, expect, it, vi } from "vitest";
import {
  BETA_PLAN_VERSIONS_V1,
  ENTITLEMENT_POLICY_VERSION,
  STAFF_TRIAL_PLAN_V1,
} from "@cloudmarkup/domain";
import {
  TEST_TARGET_SETTINGS,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import {
  permissionsForRole,
  type OrganizationRole,
} from "../../application/authorization.js";
import { SolutionExportRequestAuthority } from "./solution-export-authority.js";
import { SolutionExportWorkerAuthority } from "./solution-export-worker-authority.js";
import { PostgresSolutionExportTargetPolicy } from "./solution-export-target-policy.js";
import { admissionSelectionFixture } from "./solution-export-admission-test-helpers.js";
import type { SqlDatabase, SqlResult, SqlRow, SqlStatement } from "./sql.js";

describe("canonical export target decision without commercial writes", () => {
  function fixture(
    role: OrganizationRole = "editor",
    changed: SqlRow = {},
    featureOverrides: Readonly<Record<string, boolean>> = {},
  ) {
    const selection = admissionSelectionFixture();
    const record = selection.initialRecord;
    const foundPlan =
      changed["plan_version_id"] === STAFF_TRIAL_PLAN_V1.planVersionId
        ? STAFF_TRIAL_PLAN_V1
        : BETA_PLAN_VERSIONS_V1.find(
            (value) => value.planVersionId === "planver_pro_2026_08_14_v2",
          );
    if (foundPlan === undefined)
      throw new Error("Missing canonical synthetic plan fixture.");
    const plan = foundPlan;
    const price = plan.proposedMonthlyPrice;
    if (price === null)
      throw new Error("Missing canonical synthetic plan price.");
    let now = new Date("2026-10-06T12:00:00.000Z");
    let missing = false;
    const statements: SqlStatement[] = [];
    const principal = {
      principalId: selection.createdByPrincipalId,
      sessionId: "session.synthetic",
      correlationId: "correlation.synthetic",
      authenticatedAt: "2026-10-06T11:00:00.000Z",
      expiresAt: "2026-10-06T14:00:00.000Z",
      authenticationSource: "test" as const,
    };
    const row: Record<string, unknown> = {
      billing_account_id: "billing.synthetic",
      account_state: "active",
      account_expensive: true,
      account_version: "1",
      entitlement_snapshot_id: "entitlement.synthetic",
      entitlement_policy_version: ENTITLEMENT_POLICY_VERSION,
      snapshot_version: "1",
      snapshot_expensive: true,
      subscription_projection_id: "subscription.synthetic",
      subscription_version: "1",
      normalized_status: "active",
      plan_version_id: plan.planVersionId,
      plan_id: plan.planDefinitionId,
      configuration_version: plan.configurationVersion,
      proposed_monthly_price_micros: String(price.unitAmountMicros),
      price_currency: price.currencyCode,
      effective_from: plan.effectiveFrom,
      effective_until: plan.effectiveUntil,
      included_billable_seats: String(plan.includedBillableSeats),
      additional_seat_enabled: false,
      additional_seat_monthly_price_micros: null,
      additional_seat_price_currency: null,
      additional_seat_credit_units: null,
      capabilities: JSON.stringify(permissionsForRole(role)),
      ...changed,
    };
    function query<TRow extends SqlRow = SqlRow>(
      statement: SqlStatement,
    ): Promise<SqlResult<TRow>> {
      statements.push(statement);
      let rows: readonly SqlRow[];
      if (statement.text.includes("WITH authorized_project"))
        rows = [
          {
            authenticated: true,
            membership_id: "membership.synthetic",
            role_key: role,
            capabilities_json: JSON.stringify(permissionsForRole(role)),
          },
        ];
      else if (statement.text.includes(" AS authenticated"))
        rows = [{ authenticated: true }];
      else if (statement.text.includes("FROM solution_export_runs x"))
        rows = [
          {
            membership_id: "membership.synthetic",
            role_key: role,
            capabilities_json: JSON.stringify(permissionsForRole(role)),
            correlation_id: "correlation.worker",
            root_state: "running",
            attempt_state: "running",
            lease_current: true,
            job_current: true,
            cancellation_requested: false,
          },
        ];
      else if (statement.text.startsWith("SELECT project_id FROM projects"))
        rows = [{ project_id: selection.projectId }];
      else if (statement.text.includes("FROM memberships m"))
        rows = [
          {
            membership_id: "membership.synthetic",
            role_key: role,
            capabilities_json: JSON.stringify(permissionsForRole(role)),
          },
        ];
      else if (statement.text.startsWith("SET TRANSACTION")) rows = [];
      else if (
        statement.text.startsWith("SELECT cloudmarkup_staff_credit_access_v1")
      )
        rows = [
          { staff_credit_current: changed["staff_credit_current"] === true },
        ];
      else if (statement.text.includes("FROM organization_billing_accounts a"))
        rows = missing ? [] : [{ ...row, evaluated_at: now.toISOString() }];
      else if (
        statement.text.includes("FROM commercial_plan_feature_entitlements")
      )
        rows = plan.entitlements.map((value) => ({
          feature_key: value.feature,
          entitlement_state:
            (featureOverrides[value.feature] ?? value.enabled)
              ? "enabled"
              : "disabled",
        }));
      else if (statement.text.includes("FROM commercial_plan_numeric_limits"))
        rows = plan.limits.map((value) => ({
          limit_key: value.key,
          limit_scope: value.scope,
          period_kind: value.period,
          limit_value: String(value.value),
        }));
      else if (
        statement.text.includes("FROM commercial_plan_included_credit_grants")
      )
        rows = plan.includedCreditGrants.map((value) => ({
          grant_kind: value.kind,
          credit_units: String(value.units),
        }));
      else throw new Error("Unexpected decision SQL.");
      return Promise.resolve({
        rows,
        rowCount: rows.length,
      } as SqlResult<TRow>);
    }
    const database: SqlDatabase = {
      query,
      close: () => Promise.resolve(),
      transaction: (work) => work({ query }),
    };
    const ownership = {
      organizationId: selection.organizationId,
      projectId: selection.projectId,
    };
    const authority = new SolutionExportRequestAuthority(
      database,
      principal,
      ownership,
      "exports.run",
      () => now,
    );
    const policy = new PostgresSolutionExportTargetPolicy(
      authority,
      TEST_TARGET_SETTINGS,
    );
    const input = {
      principal,
      organizationId: selection.organizationId,
      targetProfileId: "cloudmarkup.export.terraform-nodejs24-v1" as const,
      environment: record.job.target.environment,
      binding: {
        ...ownership,
        solutionRevisionId: record.job.solutionRevision.solutionRevisionId,
        manifestRecordId: record.job.solutionRevision.manifestRecordId,
        manifestDigest: sha256DigestSchema.parse(
          record.job.solutionRevision.manifestDigest,
        ),
        applicationCodeRequired: false,
        generationCoverage: record.job.generationCoverage,
        workflowSources: record.workflowSubmission.request.sources,
      },
    };
    return {
      policy,
      database,
      selection,
      input,
      statements,
      authority,
      row,
      setMissing: () => {
        missing = true;
      },
      advance: () => {
        now = new Date(now.getTime() + 1000);
      },
    };
  }
  it("uses the actual plan projection under exports.run without prices, grants or reservation mutations", async () => {
    const f = fixture();
    const first = await f.policy.evaluate(f.input);
    expect(first.entitlementDecisionReference).toMatch(
      /^export-decision\.[a-f0-9]{64}$/u,
    );
    expect(first.targetSettings).toEqual(TEST_TARGET_SETTINGS);
    expect(f.authority.permission).toBe("exports.run");
    expect(
      f.statements.every((statement) =>
        /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(
          statement.text,
        ),
      ),
    ).toBe(true);
    expect(
      f.statements.some((statement) =>
        /credit_reservations|usage_ledger_entries|FROM credit_grants/u.test(
          statement.text,
        ),
      ),
    ).toBe(false);
    f.advance();
    expect(
      (await f.policy.evaluate(f.input)).entitlementDecisionReference,
    ).toBe(first.entitlementDecisionReference);
    f.row["snapshot_version"] = "2";
    expect(
      (await f.policy.evaluate(f.input)).entitlementDecisionReference,
    ).not.toBe(first.entitlementDecisionReference);
  });
  it("uses the exact CloudFormation entitlement and denies the current plan without changing it", async () => {
    const f = fixture();
    const settings = workflowFixture("infrastructure-only", "cloudformation")
      .request.targetSettings;
    const policy = new PostgresSolutionExportTargetPolicy(
      f.authority,
      settings,
    );
    await expect(
      policy.evaluate({
        ...f.input,
        targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(
      f.statements.every((statement) =>
        /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(
          statement.text,
        ),
      ),
    ).toBe(true);
  });
  it.each(["terraform", "cloudformation"] as const)(
    "rejects target profile substitution for %s before any database read",
    async (target) => {
      const f = fixture();
      const settings = workflowFixture("infrastructure-only", target).request
        .targetSettings;
      const policy = new PostgresSolutionExportTargetPolicy(
        f.authority,
        settings,
      );
      await expect(
        policy.evaluate({
          ...f.input,
          targetProfileId:
            target === "terraform"
              ? "cloudmarkup.export.cloudformation-nodejs24-v1"
              : "cloudmarkup.export.terraform-nodejs24-v1",
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(f.statements).toHaveLength(0);
    },
  );
  it("requires only infrastructure stages for an explicit delivery while preserving the full-application gate", async () => {
    const f = fixture(
      "editor",
      {},
      {
        cloudformation: true,
        "complete-application-generation": false,
      },
    );
    const settings = workflowFixture("infrastructure-only", "cloudformation")
      .request.targetSettings;
    const policy = new PostgresSolutionExportTargetPolicy(
      f.authority,
      settings,
    );
    const input = {
      ...f.input,
      targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1" as const,
      binding: { ...f.input.binding, applicationCodeRequired: true },
    };
    await expect(policy.evaluate(input)).rejects.toMatchObject({
      code: "access_denied",
    });
    const result = await policy.evaluate({
      ...input,
      applicationDelivery: "infrastructure-only-v1",
    });
    expect(result.targetSettings).toEqual(settings);
    expect(result.entitlementDecisionReference).toMatch(
      /^export-decision\.[a-f0-9]{64}$/u,
    );
    expect(input.binding.applicationCodeRequired).toBe(true);
  });
  it.each([
    "cloudformation",
    "validation-jobs",
    "zip-export",
    "diagram-export",
  ])(
    "keeps the %s entitlement mandatory for explicit infrastructure delivery",
    async (feature) => {
      const f = fixture(
        "editor",
        {},
        { cloudformation: true, [feature]: false },
      );
      const settings = workflowFixture("infrastructure-only", "cloudformation")
        .request.targetSettings;
      const policy = new PostgresSolutionExportTargetPolicy(
        f.authority,
        settings,
      );
      await expect(
        policy.evaluate({
          ...f.input,
          targetProfileId: "cloudmarkup.export.cloudformation-nodejs24-v1",
          applicationDelivery: "infrastructure-only-v1",
          binding: { ...f.input.binding, applicationCodeRequired: true },
        }),
      ).rejects.toMatchObject({ code: "access_denied" });
    },
  );
  it("reports inactive subscription policy absence without commercial mutations or an invented decision", async () => {
    const f = fixture("editor", {
      normalized_status: "canceled",
      snapshot_expensive: false,
    });
    await expect(f.policy.evaluate(f.input)).rejects.toMatchObject({
      code: "service_unavailable",
      status: 503,
      fieldIssues: [
        {
          code: "solution-export.inactive-subscription-policy-unavailable.v1",
          path: ["targetProfileId"],
          message:
            "Export access after subscription changes is not configured.",
        },
      ],
    });
    expect(
      f.statements.every((statement) =>
        /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(
          statement.text,
        ),
      ),
    ).toBe(true);
  });
  it("explains Credits only export denial for prior-subscription and new staff-credit accounts", async () => {
    for (const missingPaidOrTrialRow of [false, true]) {
      const f = fixture("editor", {
        normalized_status: "canceled",
        snapshot_expensive: false,
        staff_credit_current: true,
      });
      if (missingPaidOrTrialRow) f.setMissing();
      await expect(f.policy.evaluate(f.input)).rejects.toMatchObject({
        code: "access_denied",
        status: 403,
        fieldIssues: [
          {
            code: "solution-export.staff-credits-ai-only.v1",
            path: ["targetProfileId"],
            message: "Exports require an eligible paid plan or trial.",
          },
        ],
      });
      expect(
        f.statements.every((statement) =>
          /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(
            statement.text,
          ),
        ),
      ).toBe(true);
    }
    const paid = fixture("editor", { staff_credit_current: true });
    await expect(paid.policy.evaluate(paid.input)).resolves.toMatchObject({
      targetSettings: TEST_TARGET_SETTINGS,
    });
    expect(
      paid.statements.some((statement) =>
        statement.text.startsWith("SELECT cloudmarkup_staff_credit_access_v1"),
      ),
    ).toBe(false);
  });
  it("does not create a free account or invent a fallback plan", async () => {
    const f = fixture();
    f.setMissing();
    await expect(f.policy.evaluate(f.input)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    expect(
      f.statements.every((statement) =>
        /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(
          statement.text,
        ),
      ),
    ).toBe(true);
  });
  it.each([
    { account_expensive: false },
    { snapshot_expensive: false },
    { account_state: "suspended", account_expensive: true },
  ])("denies disabled expensive stages %j", async (changed) => {
    const f = fixture("editor", changed);
    await expect(f.policy.evaluate(f.input)).rejects.toMatchObject({
      code: "access_denied",
    });
    await expect(
      f.policy.evaluate({
        ...f.input,
        applicationDelivery: "infrastructure-only-v1",
        binding: { ...f.input.binding, applicationCodeRequired: true },
      }),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
  it.each([
    { account_version: "9007199254740993" },
    { account_version: "1e2" },
    { included_billable_seats: " " },
    { entitlement_policy_version: "unknown-policy" },
    { capabilities: "{}" },
    { capabilities: JSON.stringify(["exports.run"]) },
  ])(
    "rejects malformed or unrecognized canonical projections %j",
    async (changed) => {
      const f = fixture("editor", changed);
      await expect(f.policy.evaluate(f.input)).rejects.toThrow();
    },
  );
  it("rejects a viewer, wrong session or foreign binding before commercial lookup", async () => {
    const viewer = fixture("viewer");
    await expect(viewer.policy.evaluate(viewer.input)).rejects.toMatchObject({
      code: "access_denied",
    });
    expect(
      viewer.statements.some((statement) =>
        statement.text.includes("FROM organization_billing_accounts a"),
      ),
    ).toBe(false);
    const f = fixture();
    await expect(
      f.policy.evaluate({
        ...f.input,
        principal: { ...f.input.principal, sessionId: "session.other" },
      }),
    ).rejects.toThrow();
    await expect(
      f.policy.evaluate({
        ...f.input,
        binding: { ...f.input.binding, organizationId: "org.other" },
      }),
    ).rejects.toThrow();
    expect(f.statements).toHaveLength(0);
  });
  const trialRow = {
    plan_version_id: STAFF_TRIAL_PLAN_V1.planVersionId,
    subscription_projection_id: null,
    subscription_version: null,
    normalized_status: null,
    trial_current: true,
    trial_id: "trial.synthetic",
    trial_starts_at: "2026-10-06T00:00:00.000Z",
    trial_expires_at: "2026-10-07T00:00:00.000Z",
  };
  it.each(["terraform", "cloudformation"] as const)(
    "admits trial %s export with independent authority and fences revocation",
    async (target) => {
      const f = fixture("editor", trialRow);
      const settings = workflowFixture("infrastructure-only", target).request
        .targetSettings;
      const policy = new PostgresSolutionExportTargetPolicy(
        f.authority,
        settings,
      );
      const input = {
        ...f.input,
        targetProfileId:
          target === "terraform"
            ? ("cloudmarkup.export.terraform-nodejs24-v1" as const)
            : ("cloudmarkup.export.cloudformation-nodejs24-v1" as const),
      };
      await expect(policy.evaluate(input)).resolves.toHaveProperty(
        "entitlementDecisionReference",
      );
      f.row["trial_current"] = false;
      await expect(policy.evaluate(input)).rejects.toMatchObject({
        code: "access_denied",
      });
    },
  );
  it("rejects elapsed trial export even when a stale observation says current", async () => {
    const f = fixture("editor", {
      ...trialRow,
      trial_expires_at: "2026-10-06T12:00:00.000Z",
    });
    await expect(f.policy.evaluate(f.input)).rejects.toMatchObject({
      code: "access_denied",
    });
  });
  it("rechecks trial revocation under the claimed worker authority", async () => {
    const f = workerFixture(trialRow);
    const clock = vi
      .spyOn(Date, "now")
      .mockImplementation(() => f.authority.clock().getTime());
    try {
      await expect(
        f.workerPolicy.evaluateForWorker(f.workerInput),
      ).resolves.toHaveProperty("entitlementDecisionReference");
      f.row["trial_current"] = false;
      await expect(
        f.workerPolicy.evaluateForWorker(f.workerInput),
      ).rejects.toMatchObject({ code: "access_denied" });
      f.row["trial_current"] = true;
      clock.mockReturnValue(Date.parse(trialRow.trial_expires_at));
      await expect(
        f.workerPolicy.evaluateForWorker(f.workerInput),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    } finally {
      clock.mockRestore();
    }
  });
  function workerFixture(changed: SqlRow = {}) {
    const f = fixture("editor", changed);
    const authority = new SolutionExportWorkerAuthority(f.database, {
      jobId: f.selection.initialRecord.job.id,
      organizationId: f.input.organizationId,
      projectId: f.input.binding.projectId,
      actorId: f.input.principal.principalId,
      attemptId: "attempt.synthetic",
      attemptNumber: 1,
      workerId: "worker.synthetic",
      inputDigest: "sha256:" + "a".repeat(64),
    });
    const policy = new PostgresSolutionExportTargetPolicy(
      authority,
      TEST_TARGET_SETTINGS,
    );
    const { principal: _principal, ...input } = f.input;
    void _principal;
    return {
      ...f,
      workerAuthority: authority,
      workerPolicy: policy,
      workerInput: input,
    };
  }
  it("rechecks a claimed worker's current plan without request authentication or commercial writes", async () => {
    const f = workerFixture();
    const result = await f.workerPolicy.evaluateForWorker(f.workerInput);
    expect(result.entitlementDecisionReference).toMatch(
      /^export-decision\.[a-f0-9]{64}$/u,
    );
    expect(
      f.statements.filter((x) => x.text.includes("FROM solution_export_runs x"))
        .length,
    ).toBeGreaterThanOrEqual(4);
    expect(f.statements.some((x) => x.text.includes(" AS authenticated"))).toBe(
      false,
    );
    expect(f.statements.some((x) => x.text.endsWith("REPEATABLE READ"))).toBe(
      true,
    );
    expect(
      f.statements.every((x) =>
        /^\s*(SELECT|SET TRANSACTION|WITH authorized_project\b)/u.test(x.text),
      ),
    ).toBe(true);
  });
  it.each([
    { account_expensive: false },
    { snapshot_expensive: false },
    { normalized_status: "canceled" },
    { normalized_status: "past-due" },
    { account_state: "suspended" },
  ])(
    "revokes queued worker eligibility when the current projection changes %j",
    async (changed) => {
      const f = workerFixture();
      await f.workerPolicy.evaluateForWorker(f.workerInput);
      Object.assign(f.row, changed);
      await expect(
        f.workerPolicy.evaluateForWorker(f.workerInput),
      ).rejects.toMatchObject({
        code: Object.hasOwn(changed, "normalized_status")
          ? "service_unavailable"
          : "access_denied",
      });
    },
  );
  it("keeps request, worker, lifecycle and foreign-scope entries separate", async () => {
    const f = workerFixture();
    await expect(f.policy.evaluateForWorker(f.workerInput)).rejects.toThrow();
    await expect(f.workerPolicy.evaluate(f.input)).rejects.toThrow();
    await expect(
      f.workerPolicy.evaluateForWorker({
        ...f.workerInput,
        organizationId: "org.foreign",
      }),
    ).rejects.toThrow();
    const terminal = new PostgresSolutionExportTargetPolicy(
      new SolutionExportWorkerAuthority(
        f.database,
        f.workerAuthority.identity,
        "terminal",
      ),
      TEST_TARGET_SETTINGS,
    );
    await expect(terminal.evaluateForWorker(f.workerInput)).rejects.toThrow();
    expect(f.statements).toHaveLength(0);
  });
});
