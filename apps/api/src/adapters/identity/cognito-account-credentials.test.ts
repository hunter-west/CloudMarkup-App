import { describe, expect, it, vi } from "vitest";
import { CognitoAccountCredentials } from "./cognito-account-credentials.js";
import type {
  AccountCredentialAudit,
  AccountVerifiedContactProjection,
} from "../../application/account-credentials.js";
import type { PrincipalContext } from "../../application/ports.js";
const now = new Date("2026-10-01T10:00:00Z");
const actor: PrincipalContext = {
  principalId: "principal_actor",
  sessionId: "family_actor",
  correlationId: "correlation_credentials",
  authenticationSource: "cognito",
  authenticatedAt: now.toISOString(),
  expiresAt: "2026-10-01T11:00:00Z",
};
const subject = "11111111-2222-4333-8444-555555555555";
const contactSnapshot = { email: null, observedAt: now.toISOString() };
const user = {
  Username: subject,
  UserAttributes: [
    { Name: "sub", Value: subject },
    { Name: "email", Value: "account@example.com" },
    { Name: "email_verified", Value: "true" },
  ],
  UserMFASettingList: ["SOFTWARE_TOKEN_MFA"],
};
const attemptId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const input = {
  contractVersion: 1 as const,
  attemptId,
  action: "password-change" as const,
  currentPassword: "Synthetic-old-Password1!",
  newPassword: "Synthetic-new-Password2!",
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/x-amz-json-1.1" },
  });
function fixture() {
  const contactProjection = {
    readContact: vi
      .fn<AccountVerifiedContactProjection["readContact"]>()
      .mockResolvedValue(contactSnapshot),
    synchronizeVerifiedContact: vi
      .fn<AccountVerifiedContactProjection["synchronizeVerifiedContact"]>()
      .mockResolvedValue(undefined),
  };
  const audit = {
    begin: vi
      .fn<AccountCredentialAudit["begin"]>()
      .mockResolvedValue(undefined),
    assertCurrent: vi
      .fn<AccountCredentialAudit["assertCurrent"]>()
      .mockResolvedValue(undefined),
    finish: vi
      .fn<AccountCredentialAudit["finish"]>()
      .mockResolvedValue(undefined),
  };
  const resolve = vi.fn().mockResolvedValue(actor);
  const directory = {
    resolveActivePrincipal: vi
      .fn()
      .mockResolvedValue({ principalId: actor.principalId }),
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation((_url, options) => {
      const headers = new Headers(options?.headers);
      return Promise.resolve(
        json(headers.get("x-amz-target")?.endsWith(".GetUser") ? user : {}),
      );
    });
  const service = new CognitoAccountCredentials({
    issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
    principalResolver: { resolve },
    directory,
    audit,
    contactProjection,
    fetch,
    now: () => now,
  });
  return { service, resolve, directory, audit, fetch, contactProjection };
}
describe("verified provider password and email controls", () => {
  it("reads only the currently verified account and does not infer identity from email", async () => {
    const f = fixture();
    expect(await f.service.read(actor, "Bearer synthetic-token")).toEqual({
      contractVersion: 1,
      principalId: actor.principalId,
      email: "account@example.com",
      emailVerified: true,
      authenticatorEnabled: true,
    });
    expect(f.directory.resolveActivePrincipal).toHaveBeenCalledWith({
      provider: "cognito",
      issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
      subject,
    });
    expect(f.audit.begin).not.toHaveBeenCalled();
    expect(f.contactProjection.synchronizeVerifiedContact).toHaveBeenCalledWith(
      actor,
      contactSnapshot,
      { subject, email: "account@example.com" },
    );
  });
  it("does not project an unverified provider email", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      json({
        ...user,
        UserAttributes: user.UserAttributes.map((attribute) =>
          attribute.Name === "email_verified"
            ? { ...attribute, Value: "false" }
            : attribute,
        ),
      }),
    );
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).resolves.toHaveProperty("emailVerified", false);
    expect(f.contactProjection.synchronizeVerifiedContact).toHaveBeenCalledWith(
      actor,
      contactSnapshot,
      { subject, email: null },
    );
    expect(f.audit.begin).not.toHaveBeenCalled();
  });
  it("does not project a provider read after token or session revocation", async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(
      f.contactProjection.synchronizeVerifiedContact,
    ).not.toHaveBeenCalled();
  });
  it("accepts the documented AWS JSON 1.0 response media type", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify(user), {
        headers: { "content-type": "application/x-amz-json-1.0" },
      }),
    );
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).resolves.toHaveProperty("emailVerified", true);
  });
  it("accepts Cognito-specific subjects only through the same active principal mapping", async () => {
    const f = fixture();
    const providerSubject = "11111111-2222-7333-4444-555555555555";
    f.fetch.mockResolvedValueOnce(
      json({
        ...user,
        Username: providerSubject,
        UserAttributes: user.UserAttributes.map((attribute) =>
          attribute.Name === "sub"
            ? { ...attribute, Value: providerSubject }
            : attribute,
        ),
      }),
    );
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).resolves.toHaveProperty("emailVerified", true);
    expect(f.directory.resolveActivePrincipal).toHaveBeenCalledWith({
      provider: "cognito",
      issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_SYNTHETIC",
      subject: providerSubject,
    });
    f.fetch.mockResolvedValueOnce(
      json({
        ...user,
        UserAttributes: user.UserAttributes.map((attribute) =>
          attribute.Name === "sub"
            ? { ...attribute, Value: providerSubject }
            : attribute,
        ),
      }),
    );
    f.directory.resolveActivePrincipal.mockResolvedValue({
      principalId: "principal_other",
    });
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it.each(["", "x".repeat(256)])(
    "rejects empty or oversized provider subjects before directory lookup",
    async (providerSubject) => {
      const f = fixture();
      f.fetch.mockResolvedValueOnce(
        json({
          ...user,
          UserAttributes: user.UserAttributes.map((attribute) =>
            attribute.Name === "sub"
              ? { ...attribute, Value: providerSubject }
              : attribute,
          ),
        }),
      );
      await expect(
        f.service.read(actor, "Bearer synthetic-token"),
      ).rejects.toMatchObject({ code: "service_unavailable" });
      expect(f.directory.resolveActivePrincipal).not.toHaveBeenCalled();
    },
  );
  it.each([
    { body: null, command: input },
    { body: "", command: input },
    {
      body: null,
      command: {
        contractVersion: 1 as const,
        attemptId,
        action: "email-confirm" as const,
        code: "123456",
      },
    },
    {
      body: "",
      command: {
        contractVersion: 1 as const,
        attemptId,
        action: "email-confirm" as const,
        code: "123456",
      },
    },
  ])(
    "accepts a documented empty success body for $command.action",
    async ({ body, command }) => {
      const f = fixture();
      f.fetch
        .mockResolvedValueOnce(json(user))
        .mockResolvedValueOnce(new Response(body, { status: 200 }));
      expect(
        await f.service.change(actor, "Bearer synthetic-token", command),
      ).toMatchObject({ outcome: "succeeded" });
      expect(f.fetch).toHaveBeenCalledTimes(3);
    },
  );
  it("does not accept an empty account read or an empty unsuccessful mutation", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(
      f.service.read(actor, "Bearer synthetic-token"),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    f.fetch
      .mockResolvedValueOnce(json(user))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(
      await f.service.change(actor, "Bearer synthetic-token", input),
    ).toMatchObject({ outcome: "uncertain", state: null });
  });
  it("does not dispatch a mutation after the shared provider deadline expires", async () => {
    const controller = new AbortController();
    const deadline = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    try {
      const f = fixture();
      f.audit.assertCurrent.mockImplementationOnce(() => {
        controller.abort();
        return Promise.resolve();
      });
      expect(
        await f.service.change(actor, "Bearer synthetic-token", input),
      ).toMatchObject({ outcome: "rejected", state: null });
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.audit.finish).toHaveBeenCalledWith(actor, attemptId, "rejected");
      expect(deadline).toHaveBeenCalledExactlyOnceWith(8000);
    } finally {
      deadline.mockRestore();
    }
  });
  it("dispatches one exact token-authorized change and audits only metadata", async () => {
    const f = fixture();
    const result = await f.service.change(
      actor,
      "Bearer synthetic-token",
      input,
    );
    expect(result.outcome).toBe("succeeded");
    expect(f.fetch).toHaveBeenCalledTimes(3);
    const call = f.fetch.mock.calls[1];
    expect(call?.[0]).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(
      JSON.parse(typeof call?.[1]?.body === "string" ? call[1].body : "{}"),
    ).toEqual({
      AccessToken: "synthetic-token",
      PreviousPassword: input.currentPassword,
      ProposedPassword: input.newPassword,
    });
    expect(call?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(f.audit.begin).toHaveBeenCalledWith(
      actor,
      attemptId,
      "password-change",
    );
    expect(f.audit.finish).toHaveBeenCalledWith(actor, attemptId, "succeeded", {
      subject,
      email: "account@example.com",
    });
    for (const value of [
      result,
      f.audit.begin.mock.calls,
      f.audit.finish.mock.calls,
    ]) {
      expect(JSON.stringify(value)).not.toContain(input.currentPassword);
      expect(JSON.stringify(value)).not.toContain(input.newPassword);
      expect(JSON.stringify(value)).not.toContain("synthetic-token");
    }
  });
  it.each([
    null,
    { ...actor, principalId: "principal_other" },
    { ...actor, sessionId: "family_other" },
    { ...actor, authenticatedAt: "2026-10-01T09:59:00Z" },
    { ...actor, expiresAt: "2026-10-01T10:00:00Z" },
    { ...actor, authenticationSource: "test" },
  ])(
    "denies an unverified or different credential context",
    async (current) => {
      const f = fixture();
      f.resolve.mockResolvedValue(current);
      await expect(
        f.service.change(actor, "Bearer synthetic-token", input),
      ).rejects.toMatchObject({ code: "authentication_required" });
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.audit.begin).not.toHaveBeenCalled();
    },
  );
  it("requires recent authentication before password or email access changes", async () => {
    const f = fixture(),
      stale = { ...actor, authenticatedAt: "2026-10-01T09:49:00Z" };
    f.resolve.mockResolvedValue(stale);
    await expect(
      f.service.change(stale, "Bearer synthetic-token", input),
    ).rejects.toMatchObject({ code: "access_denied" });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("rejects a provider subject mapped to another account before mutation", async () => {
    const f = fixture();
    f.directory.resolveActivePrincipal.mockResolvedValue({
      principalId: "principal_other",
    });
    await expect(
      f.service.change(actor, "Bearer synthetic-token", input),
    ).rejects.toMatchObject({ code: "service_unavailable" });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.audit.begin).not.toHaveBeenCalled();
  });
  it("checks revocation again after preflight and before dispatch", async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce(actor).mockResolvedValue(null);
    expect(
      await f.service.change(actor, "Bearer synthetic-token", input),
    ).toMatchObject({ outcome: "rejected", state: null });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.audit.finish).toHaveBeenCalledWith(actor, attemptId, "rejected");
  });
  it("does not dispatch when the durable attempt cannot be recorded or is reused", async () => {
    const f = fixture();
    f.audit.begin.mockRejectedValue(Error("Synthetic audit failure"));
    await expect(
      f.service.change(actor, "Bearer synthetic-token", input),
    ).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["timeout", "server", "malformed"])(
    "returns an uncertain result without retry after %s",
    async (kind) => {
      const f = fixture();
      f.fetch.mockResolvedValueOnce(json(user));
      if (kind === "timeout")
        f.fetch.mockRejectedValueOnce(Error("Sensitive provider diagnostic"));
      else if (kind === "server")
        f.fetch.mockResolvedValueOnce(
          json({ message: "Sensitive provider diagnostic" }, 500),
        );
      else
        f.fetch.mockResolvedValueOnce(
          new Response("Sensitive provider diagnostic", {
            headers: { "content-type": "application/json" },
          }),
        );
      const result = await f.service.change(
        actor,
        "Bearer synthetic-token",
        input,
      );
      expect(result).toMatchObject({
        outcome: "uncertain",
        problem: "unknown",
        state: null,
      });
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain("Sensitive");
    },
  );
  it("does not claim rejection when readback fails after a successful change", async () => {
    const f = fixture();
    f.fetch
      .mockResolvedValueOnce(json(user))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({ __type: "NotAuthorizedException", message: "private" }, 400),
      );
    expect(
      await f.service.change(actor, "Bearer synthetic-token", input),
    ).toMatchObject({ outcome: "uncertain", state: null });
  });
  it("does not claim success when the audit completion is unavailable", async () => {
    const f = fixture();
    f.audit.finish.mockRejectedValue(Error("Synthetic audit failure"));
    expect(
      await f.service.change(actor, "Bearer synthetic-token", input),
    ).toMatchObject({ outcome: "uncertain", state: null });
  });
  it("returns a bounded known provider rejection without echoing its message", async () => {
    const f = fixture();
    f.fetch
      .mockResolvedValueOnce(json(user))
      .mockResolvedValueOnce(
        json({ __type: "InvalidPasswordException", message: "private" }, 400),
      );
    expect(
      await f.service.change(actor, "Bearer synthetic-token", input),
    ).toMatchObject({
      outcome: "rejected",
      problem: "password-policy",
      state: null,
    });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    {
      ...user,
      UserAttributes: [...user.UserAttributes, { Name: "sub", Value: subject }],
    },
    {
      ...user,
      UserAttributes: [
        { Name: "sub", Value: subject },
        { Name: "email_verified", Value: "true" },
      ],
    },
    { ...user, extra: "x".repeat(32768) },
  ])(
    "fails closed on ambiguous or oversized provider state",
    async (response) => {
      const f = fixture();
      f.fetch.mockResolvedValueOnce(json(response));
      await expect(
        f.service.read(actor, "Bearer synthetic-token"),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    },
  );
  it.each([
    {
      contractVersion: 1,
      attemptId,
      action: "email-start",
      email: "new@example.com",
    },
    { contractVersion: 1, attemptId, action: "email-confirm", code: "123456" },
    { contractVersion: 1, attemptId, action: "email-resend" },
  ] as const)(
    "uses the fixed provider operation for $action",
    async (command) => {
      const f = fixture();
      const result = await f.service.change(
        actor,
        "Bearer synthetic-token",
        command,
      );
      expect(result.outcome).toBe("succeeded");
      const options = f.fetch.mock.calls[1]?.[1];
      const body = JSON.parse(
        typeof options?.body === "string" ? options.body : "{}",
      ) as Record<string, unknown>;
      expect(body["AccessToken"]).toBe("synthetic-token");
      expect(body["Username"]).toBeUndefined();
      if (command.action === "email-start")
        expect(body["UserAttributes"]).toEqual([
          { Name: "email", Value: "new@example.com" },
        ]);
      else {
        expect(body["AttributeName"]).toBe("email");
        const target = new Headers(options?.headers).get("x-amz-target");
        if (command.action === "email-confirm") {
          expect(target).toBe(
            "AWSCognitoIdentityProviderService.VerifyUserAttribute",
          );
          expect(body["Code"]).toBe("123456");
        } else {
          expect(target).toBe(
            "AWSCognitoIdentityProviderService.GetUserAttributeVerificationCode",
          );
          expect(body["Code"]).toBeUndefined();
        }
      }
    },
  );
});
