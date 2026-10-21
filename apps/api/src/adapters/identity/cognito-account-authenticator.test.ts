import { describe, expect, it, vi } from "vitest";
import type { AccountAuthenticatorEnrollmentV1 } from "@cloudmarkup/api-contract";
import type {
  AccountAuthenticatorAction,
  AccountAuthenticatorJournal,
} from "../../application/account-authenticator.js";
import { ApplicationError } from "../../application/errors.js";
import type { PrincipalContext } from "../../application/ports.js";
import { CognitoAccountAuthenticator } from "./cognito-account-authenticator.js";
const now = new Date("2026-10-01T12:00:00Z");
const actor: PrincipalContext = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  correlationId: "correlation_mfa",
  authenticationSource: "cognito",
  authenticatedAt: now.toISOString(),
  expiresAt: "2026-10-01T13:00:00Z",
};
const subject = "11111111-2222-4333-8444-555555555555";
const setupId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const attemptId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const key = "JBSWY3DPEHPK3PXP";
const enrollment: AccountAuthenticatorEnrollmentV1 = {
  id: setupId,
  expiresAt: "2026-10-01T12:10:00.000Z",
  status: "ready",
  currentSession: true,
};
const beginInput = {
  contractVersion: 1 as const,
  attemptId: setupId,
  acknowledgedRecovery: true as const,
};
const verifyInput = {
  contractVersion: 1 as const,
  attemptId,
  action: "verify-enable" as const,
  enrollmentId: setupId,
  code: "123456",
};
const disableInput = {
  contractVersion: 1 as const,
  attemptId,
  action: "disable" as const,
  acknowledgedReduction: true as const,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/x-amz-json-1.0" },
  });
function fixture(contact = true) {
  let active: AccountAuthenticatorEnrollmentV1 | null = null;
  let enabled = false;
  let action: AccountAuthenticatorAction = "start";
  let honorPreference = true;
  const operations: string[] = [];
  const journal = {
    read: vi
      .fn<AccountAuthenticatorJournal["read"]>()
      .mockImplementation(() => Promise.resolve(active)),
    begin: vi
      .fn<AccountAuthenticatorJournal["begin"]>()
      .mockImplementation((_principal, id, next) => {
        action = next;
        if (next === "start")
          active = { ...enrollment, id, status: "starting" };
        else if (next === "verify-enable" && active)
          active = { ...active, status: "verifying" };
        return Promise.resolve(active);
      }),
    assertCurrent: vi
      .fn<AccountAuthenticatorJournal["assertCurrent"]>()
      .mockResolvedValue(undefined),
    finish: vi
      .fn<AccountAuthenticatorJournal["finish"]>()
      .mockImplementation((_principal, _id, outcome) => {
        if (outcome === "succeeded")
          active =
            action === "start" ? { ...enrollment, status: "ready" } : null;
        else if (active)
          active = {
            ...active,
            status: outcome === "uncertain" ? "uncertain" : "ready",
          };
        return Promise.resolve();
      }),
  };
  const resolve = vi.fn().mockResolvedValue(actor);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((_url, init) => {
      const operation =
        new Headers(init?.headers).get("x-amz-target")?.split(".").at(-1) ?? "";
      operations.push(operation);
      if (operation === "GetUser")
        return Promise.resolve(
          json({
            Username: subject,
            UserAttributes: [
              { Name: "sub", Value: subject },
              { Name: "email", Value: "actor@example.com" },
              { Name: "email_verified", Value: "true" },
            ],
            UserMFASettingList: enabled ? ["SOFTWARE_TOKEN_MFA"] : [],
          }),
        );
      if (operation === "AssociateSoftwareToken")
        return Promise.resolve(json({ SecretCode: key }));
      if (operation === "VerifySoftwareToken")
        return Promise.resolve(json({ Status: "SUCCESS" }));
      if (operation === "SetUserMFAPreference") {
        const body = JSON.parse(
          typeof init?.body === "string" ? init.body : "{}",
        ) as { SoftwareTokenMfaSettings: { Enabled: boolean } };
        if (honorPreference) enabled = body.SoftwareTokenMfaSettings.Enabled;
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      throw Error("Unexpected synthetic provider operation");
    });
  const service = new CognitoAccountAuthenticator({
    issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
    principalResolver: { resolve },
    directory: {
      resolveActivePrincipal: () =>
        Promise.resolve({ principalId: actor.principalId }),
    },
    journal,
    fetch,
    now: () => now,
    ...(contact
      ? {
          recoveryContact: {
            kind: "email" as const,
            value: "help@example.com",
          },
        }
      : {}),
  });
  return {
    service,
    journal,
    resolve,
    fetch,
    operations,
    pending: () => {
      active = { ...enrollment };
    },
    enable: () => {
      enabled = true;
    },
    ignorePreference: () => {
      honorPreference = false;
    },
  };
}
describe("token-bound authenticator provider flow", () => {
  it("does not offer or begin setup without recovery contact", async () => {
    const f = fixture(false);
    expect(await f.service.read(actor, "Bearer synthetic-token")).toMatchObject(
      { enrollmentAvailable: false, recoveryContact: null },
    );
    expect(
      await f.service.start(actor, "Bearer synthetic-token", beginInput),
    ).toMatchObject({
      outcome: "rejected",
      problem: "recovery-unavailable",
      secretCode: null,
    });
    expect(f.journal.begin).not.toHaveBeenCalled();
    expect(f.operations).toEqual(["GetUser", "GetUser"]);
  });
  it("never silently replaces an enabled authenticator", async () => {
    const f = fixture();
    f.enable();
    expect(
      await f.service.start(actor, "Bearer synthetic-token", beginInput),
    ).toMatchObject({ outcome: "rejected", problem: "already-enabled" });
    expect(
      await f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).toMatchObject({ outcome: "rejected", problem: "already-enabled" });
    expect(f.journal.begin).not.toHaveBeenCalled();
    expect(f.operations).toEqual(["GetUser", "GetUser"]);
  });
  it("returns a setup key once, with a bound ready enrollment and metadata-only journal", async () => {
    const f = fixture();
    const result = await f.service.start(
      actor,
      "Bearer synthetic-token",
      beginInput,
    );
    expect(result).toMatchObject({
      outcome: "succeeded",
      secretCode: key,
      state: { enabled: false, enrollment },
    });
    expect(f.operations).toEqual([
      "GetUser",
      "AssociateSoftwareToken",
      "GetUser",
    ]);
    expect(f.journal.begin).toHaveBeenCalledWith(actor, setupId, "start");
    const metadata = JSON.stringify([
      f.journal.begin.mock.calls,
      f.journal.finish.mock.calls,
    ]);
    expect(metadata).not.toContain(key);
    expect(metadata).not.toContain("synthetic-token");
  });
  it("requires successful verification, preference update and matching provider readback", async () => {
    const f = fixture();
    f.pending();
    const result = await f.service.change(
      actor,
      "Bearer synthetic-token",
      verifyInput,
    );
    expect(result).toMatchObject({
      outcome: "succeeded",
      state: { enabled: true, enrollment: null },
    });
    expect(f.operations).toEqual([
      "GetUser",
      "VerifySoftwareToken",
      "SetUserMFAPreference",
      "GetUser",
    ]);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(f.journal.begin.mock.calls)).not.toContain(
      verifyInput.code,
    );
  });
  it.each(["ERROR", "missing"])(
    "does not enable after verification status %s",
    async (status) => {
      const f = fixture();
      f.pending();
      const original = f.fetch.getMockImplementation();
      if (!original) throw Error("Missing provider fixture");
      f.fetch.mockImplementation((url, init) =>
        new Headers(init?.headers)
          .get("x-amz-target")
          ?.endsWith(".VerifySoftwareToken")
          ? Promise.resolve(json(status === "ERROR" ? { Status: "ERROR" } : {}))
          : original(url, init),
      );
      expect(
        await f.service.change(actor, "Bearer synthetic-token", verifyInput),
      ).toMatchObject({
        outcome: status === "ERROR" ? "rejected" : "uncertain",
        state: null,
      });
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.operations).not.toContain("SetUserMFAPreference");
    },
  );
  it("retains an uncertain outcome after verification succeeds but enabling is rejected", async () => {
    const f = fixture();
    f.pending();
    const original = f.fetch.getMockImplementation();
    if (!original) throw Error("Missing provider fixture");
    f.fetch.mockImplementation((url, init) =>
      new Headers(init?.headers)
        .get("x-amz-target")
        ?.endsWith(".SetUserMFAPreference")
        ? Promise.resolve(json({ __type: "InvalidParameterException" }, 400))
        : original(url, init),
    );
    expect(
      await f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).toMatchObject({ outcome: "uncertain", state: null });
    expect(f.fetch).toHaveBeenCalledTimes(3);
  });
  it("does not claim enabled state from a preference response alone", async () => {
    const f = fixture();
    f.pending();
    f.ignorePreference();
    expect(
      await f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).toMatchObject({ outcome: "uncertain", state: null });
    expect(f.journal.finish).toHaveBeenCalledWith(
      actor,
      attemptId,
      "uncertain",
    );
    expect(f.fetch).toHaveBeenCalledTimes(4);
  });
  it("disables only the authenticator preference and checks readback", async () => {
    const f = fixture();
    f.enable();
    expect(
      await f.service.change(actor, "Bearer synthetic-token", disableInput),
    ).toMatchObject({ outcome: "succeeded", state: { enabled: false } });
    expect(f.operations).toEqual([
      "GetUser",
      "SetUserMFAPreference",
      "GetUser",
    ]);
    const init = f.fetch.mock.calls[1]?.[1];
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    ).toEqual({
      AccessToken: "synthetic-token",
      SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
    });
  });
  it("cancels a pending setup without changing provider preferences", async () => {
    const f = fixture();
    f.pending();
    expect(
      await f.service.change(actor, "Bearer synthetic-token", {
        contractVersion: 1,
        attemptId,
        action: "cancel-setup",
        enrollmentId: setupId,
      }),
    ).toMatchObject({
      outcome: "succeeded",
      state: { enabled: false, enrollment: null },
    });
    expect(f.operations).toEqual(["GetUser", "GetUser"]);
  });
  it("checks application revocation again before enabling", async () => {
    const f = fixture();
    f.pending();
    f.resolve
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(actor)
      .mockResolvedValue(null);
    expect(
      await f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).toMatchObject({ outcome: "uncertain", state: null });
    expect(f.operations).toEqual(["GetUser", "VerifySoftwareToken"]);
  });
  it("cannot dispatch after a stale or concurrent journal claim", async () => {
    const f = fixture();
    f.pending();
    f.journal.begin.mockRejectedValue(
      new ApplicationError("conflict", "The setup is no longer current."),
    );
    await expect(
      f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.operations).toEqual(["GetUser"]);
  });
  it("does not claim success after a lost journal completion", async () => {
    const f = fixture();
    f.pending();
    f.journal.finish.mockRejectedValue(Error("Synthetic journal failure"));
    expect(
      await f.service.change(actor, "Bearer synthetic-token", verifyInput),
    ).toMatchObject({ outcome: "uncertain", state: null });
    expect(f.fetch).toHaveBeenCalledTimes(4);
  });
  it("requires recent authentication and rejects invalid acknowledgements before provider mutation", async () => {
    const f = fixture();
    const stale = { ...actor, authenticatedAt: "2026-10-01T11:49:00Z" };
    f.resolve.mockResolvedValue(stale);
    await expect(
      f.service.start(stale, "Bearer synthetic-token", beginInput),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(f.fetch).not.toHaveBeenCalled();
    await expect(
      f.service.change(actor, "Bearer synthetic-token", {
        ...disableInput,
        acknowledgedReduction: false,
      } as unknown as typeof disableInput),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
