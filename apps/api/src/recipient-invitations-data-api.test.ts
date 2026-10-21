import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createDataApiJsonDatabase } from "./adapters/persistence/data-api-json-test-helpers.js";
import { PostgresOrganizationInvitationRepository } from "./adapters/persistence/organization-invitations.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";

const now = "2026-10-01T12:00:00.000Z";
const actor = {
  principalId: "principal_recipient",
  sessionId: "session_recipient",
  authenticatedAt: "2026-10-01T11:00:00.000Z",
  expiresAt: "2026-10-01T13:00:00.000Z",
};
const active = [{ principal_id: actor.principalId }];

function fixture(rows: readonly (readonly object[])[]) {
  const { database, commands } = createDataApiJsonDatabase(rows);
  const app = createApp({
    application: new InMemoryCloudMarkupApplication({}),
    authenticationClock: () => new Date(now),
    principalResolver: new FixedPrincipalResolver({
      "Bearer recipient": actor,
      "Bearer expired": { ...actor, expiresAt: now },
    }),
    recipientOrganizationInvitations: {
      application: new PostgresOrganizationInvitationRepository(database),
      publicOrigin: "https://beta.example.invalid",
    },
  });
  return { app, commands };
}

afterEach(() => vi.useRealTimers());

describe("invitation inbox through the production Data API decoder", () => {
  it("returns an empty inbox for an active account without requiring recent sign-in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { app, commands } = fixture([active, [], active]);
    const response = await app.request(
      "/v1/account/invitations?page[limit]=100",
      {
        headers: { authorization: "Bearer recipient" },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      apiVersion: "v1",
      data: [],
      page: { hasMore: false },
    });
    expect(commands).toHaveLength(3);
    expect(commands[1]?.input.parameters?.[0]?.value).toEqual({
      stringValue: actor.principalId,
    });
  });

  it.each([{ rows: [[]] }, { rows: [active, [], []] }])(
    "still rejects an inactive account at either admission check (%#)",
    async ({ rows }) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const { app } = fixture(rows);
      const response = await app.request("/v1/account/invitations", {
        headers: { authorization: "Bearer recipient" },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "authentication_required" },
      });
    },
  );

  it("returns invitations scoped to the verified recipient", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const invitation = {
      invitation_id: "invitation_12345678-1234-4234-8234-123456789abc",
      organization_id: "org_example",
      organization_name: "Example",
      target_role: "editor",
      lifecycle_state: "pending",
      unexpired: true,
      expires_iso: "2026-10-02T12:00:00.000Z",
      recipient_id: actor.principalId,
      recipient_name: "Synthetic recipient",
      recipient_username: "recipient_user",
    };
    const { app, commands } = fixture([active, [invitation], active]);
    const response = await app.request("/v1/account/invitations", {
      headers: { authorization: "Bearer recipient" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          id: invitation.invitation_id,
          recipient: { principalId: actor.principalId },
        },
      ],
      page: { hasMore: false },
    });
    expect(commands[1]?.input.sql).toContain("i.recipient_principal_id=:p1");
    expect(commands[1]?.input.parameters?.[0]?.value).toEqual({
      stringValue: actor.principalId,
    });
  });

  it.each([undefined, "Bearer expired"])(
    "rejects missing or expired authentication before database access (%s)",
    async (authorization) => {
      const { app, commands } = fixture([]);
      const response = await app.request("/v1/account/invitations", {
        headers: authorization === undefined ? {} : { authorization },
      });
      expect(response.status).toBe(401);
      expect(commands).toHaveLength(0);
    },
  );
});
