import { describe, expect, it } from "vitest";
import { createDataApiJsonDatabase } from "./adapters/persistence/data-api-json-test-helpers.js";
import { permissionsForRole } from "./application/authorization.js";
import type { PrincipalContext } from "./application/ports.js";
import { createProductionCommercialReads } from "./production-commercial-reads.js";

const now = "2026-09-14T12:00:00.000Z";
const principal: PrincipalContext = {
  authenticatedAt: now,
  authenticationSource: "test",
  expiresAt: "2026-09-14T13:00:00.000Z",
  principalId: "principal_data_api",
  sessionId: "session_data_api",
  correlationId: "correlation_data_api",
};
const authority = {
  membership_id: "membership_data_api",
  role_key: "owner",
  capabilities_json: JSON.stringify(permissionsForRole("owner")),
};
const plan = {
  account_expensive_operations_enabled: true,
  as_of: "2026-09-14 12:00:00",
  billing_account_state: "active",
  cancel_at_period_end: false,
  current_period_end: "2026-10-01 00:00:00",
  current_period_start: "2026-09-01 00:00:00",
  display_name: "Pro",
  effective_from: "2026-09-01 00:00:00",
  effective_until: null,
  normalized_status: "active",
  organization_id: "org_data_api",
  organization_state: "active",
  plan_id: "plan_pro",
  plan_key: "pro",
  plan_version_id: "planver_pro-1",
  price_currency: "USD",
  proposed_monthly_price_micros: "39000000",
  snapshot_expensive_operations_enabled: true,
  subscription_projection_id: "subscription_data_api",
  subscription_record_version: "1",
  version_number: "1",
};
function fixture(
  changes: object = {},
  finalAuthority: readonly object[] = [authority],
) {
  const { database, commands } = createDataApiJsonDatabase([
    [authority],
    [],
    [{}],
    [{ ...plan, ...changes }],
    [],
    [],
    finalAuthority,
  ]);
  return {
    commands,
    app: createProductionCommercialReads({
      database,
      clock: () => new Date(now),
    }),
  };
}
describe("production current plan through the Data API JSON decoder", () => {
  it("returns a contract-valid subscribed plan with canonical UTC timestamps", async () => {
    const { app, commands } = fixture();
    await expect(
      app.getCurrentPlanEntitlements(principal, "org_data_api"),
    ).resolves.toMatchObject({
      asOf: now,
      organizationId: "org_data_api",
      plan: { effectiveFrom: "2026-09-01T00:00:00.000Z", version: 1 },
      subscription: {
        state: "active",
        currentPeriodStartsAt: "2026-09-01T00:00:00.000Z",
        currentPeriodEndsAt: "2026-10-01T00:00:00.000Z",
      },
    });
    expect(commands).toHaveLength(7);
    expect(
      commands.every((command) => command.input.formatRecordsAs === "JSON"),
    ).toBe(true);
    expect(
      commands[3]?.input.parameters?.map((item) => item.value?.stringValue),
    ).toEqual(["membership_data_api", principal.principalId, "org_data_api"]);
  });
  it.each([{ as_of: "2026-02-30 00:00:00" }, { organization_id: "org_other" }])(
    "rejects invalid or foreign plan evidence %j",
    async (changes) => {
      const { app } = fixture(changes);
      await expect(
        app.getCurrentPlanEntitlements(principal, "org_data_api"),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );
  it("rechecks revoked membership before returning the normalized plan", async () => {
    const { app } = fixture({}, []);
    await expect(
      app.getCurrentPlanEntitlements(principal, "org_data_api"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
