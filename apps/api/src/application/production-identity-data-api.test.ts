import { describe, expect, it } from "vitest";
import { createDataApiJsonDatabase } from "../adapters/persistence/data-api-json-test-helpers.js";
import { ProductionIdentityApplication } from "./production-identity-application.js";
import type { PrincipalContext } from "./ports.js";

const principal: PrincipalContext = {
  authenticatedAt: "2026-09-14T12:00:00.000Z",
  authenticationSource: "cognito",
  correlationId: "correlation_directory_test",
  expiresAt: "2026-09-14T12:30:00.000Z",
  principalId: "principal_directory_test",
  sessionId: "session_directory_test",
};
function application(rows: readonly (readonly object[])[]) {
  const { commands, database } = createDataApiJsonDatabase(rows);
  return { commands, app: new ProductionIdentityApplication(database) };
}

const organization = (
  createdAt: string,
  deletionRequestedAt: string | null = null,
) => ({
  organization_id: "org_directory_test",
  display_name: "Synthetic workspace",
  slug: "synthetic-workspace",
  lifecycle_status: "active",
  record_version: "1",
  role_key: "owner",
  created_at: createdAt,
  deletion_requested_at: deletionRequestedAt,
});

describe("production identity through the actual Data API JSON decoder", () => {
  it.each([
    ["2026-09-14 00:00:00", "2026-09-14T00:00:00.000Z"],
    ["2026-09-14 12:34:56.123456", "2026-09-14T12:34:56.123Z"],
    ["2026-09-14T12:34:56.123Z", "2026-09-14T12:34:56.123Z"],
  ])(
    "returns contract-valid organization timestamps from %s",
    async (stored, expected) => {
      const { app, commands } = application([
        [organization(stored)],
        [organization(stored, stored)],
      ]);
      await expect(
        app.listOrganizations(principal, { filters: {}, limit: 100 }),
      ).resolves.toMatchObject({
        items: [{ id: "org_directory_test", createdAt: expected }],
      });
      await expect(
        app.getOrganization(principal, "org_directory_test"),
      ).resolves.toMatchObject({
        value: {
          id: "org_directory_test",
          createdAt: expected,
          deletionRequestedAt: expected,
        },
      });
      expect(
        commands.every((command) => command.input.formatRecordsAs === "JSON"),
      ).toBe(true);
      expect(commands[0]?.input.parameters).toEqual([
        { name: "p1", value: { stringValue: principal.principalId } },
      ]);
    },
  );

  it("normalizes membership join time without changing verified role or tenant", async () => {
    const { app } = application([
      [
        {
          membership_id: "membership_directory_test",
          organization_id: "org_directory_test",
          role_key: "owner",
        },
      ],
      [
        {
          membership_id: "membership_directory_test",
          organization_id: "org_directory_test",
          principal_id: principal.principalId,
          role_key: "owner",
          lifecycle_status: "active",
          joined_at: "2026-09-14 12:34:56.123456",
          display_name: "Synthetic user",
        },
      ],
    ]);
    await expect(
      app.listMemberships(principal, "org_directory_test", {
        filters: {},
        limit: 100,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          organizationId: "org_directory_test",
          joinedAt: "2026-09-14T12:34:56.123Z",
          role: "owner",
          isOwner: true,
        },
      ],
    });
  });

  it.each(["invalid"])(
    "rejects invalid or ambiguous stored timestamp %s",
    async (stored) => {
      const { app } = application([[organization(stored)]]);
      await expect(
        app.listOrganizations(principal, { filters: {}, limit: 100 }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );
});
