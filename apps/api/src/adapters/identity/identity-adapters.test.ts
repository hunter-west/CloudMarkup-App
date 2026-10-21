import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Principal,
  PrincipalDirectory,
} from "../../application/identity.js";
import { CognitoJwtPrincipalResolver } from "./cognito-jwt-principal-resolver.js";
import {
  LocalDevelopmentPrincipalResolver,
  type LocalDevelopmentIdentityOptions,
} from "./local-development-principal-resolver.js";

const VALID_CLAIMS = {
  auth_time: 1_775_304_000,
  client_id: "client_cloudmarkup",
  exp: 1_775_307_600,
  iat: 1_775_304_000,
  iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
  jti: "jwt_session_1",
  origin_jti: "refresh_session_1",
  scope: "cloudmarkup-api/access",
  sub: "subject_1",
  token_use: "access",
  username: "subject_1",
  version: 2,
} as const;

const mappedDirectory: PrincipalDirectory = {
  resolveActivePrincipal: () =>
    Promise.resolve({ principalId: "principal_mapped" }),
};

const localPrincipal: Omit<Principal, "authenticationSource"> = {
  authenticatedAt: "2026-04-05T12:00:00.000Z",
  expiresAt: "2026-04-05T13:00:00.000Z",
  principalId: "principal_local",
  sessionId: "session_local",
};

describe("Cognito JWT principal resolver", () => {
  it("consults revocation only after verified identity and required scopes", async () => {
    const isActive = vi.fn().mockResolvedValue(false);
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify: () => Promise.resolve(VALID_CLAIMS) },
      sessionAdmission: { isActive },
    });
    await expect(
      resolver.resolve("Bearer signed.jwt.token"),
    ).resolves.toBeNull();
    expect(isActive).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: "principal_mapped",
        sessionId: "refresh_session_1",
        authenticatedAt: "2026-04-04T12:00:00.000Z",
      }),
    );
    isActive.mockResolvedValue(true);
    await expect(
      resolver.resolve("Bearer signed.jwt.token"),
    ).resolves.toMatchObject({ principalId: "principal_mapped" });
    const invalid = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: {
        verify: () => Promise.resolve({ ...VALID_CLAIMS, scope: "openid" }),
      },
      sessionAdmission: { isActive },
    });
    const count = isActive.mock.calls.length;
    await expect(
      invalid.resolve("Bearer signed.jwt.token"),
    ).resolves.toBeNull();
    expect(isActive).toHaveBeenCalledTimes(count);
  });
  it("fails closed on revocation-store outage without treating it as a valid session", async () => {
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify: () => Promise.resolve(VALID_CLAIMS) },
      sessionAdmission: {
        isActive: () => Promise.reject(Error("synthetic admission outage")),
      },
    });
    await expect(resolver.resolve("Bearer signed.jwt.token")).rejects.toThrow(
      "synthetic admission outage",
    );
  });

  it("maps a verified access-token subject to an application Principal", async () => {
    const verify = vi.fn().mockResolvedValue(VALID_CLAIMS);
    const resolveActivePrincipal = vi
      .fn()
      .mockResolvedValue({ principalId: "principal_mapped" });
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: { resolveActivePrincipal },
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify },
    });

    await expect(resolver.resolve("Bearer signed.jwt.token")).resolves.toEqual({
      authenticatedAt: "2026-04-04T12:00:00.000Z",
      authenticationSource: "cognito",
      expiresAt: "2026-04-04T13:00:00.000Z",
      principalId: "principal_mapped",
      sessionId: "refresh_session_1",
    });
    expect(verify).toHaveBeenCalledWith("signed.jwt.token");
    expect(resolveActivePrincipal).toHaveBeenCalledWith({
      issuer: VALID_CLAIMS.iss,
      provider: "cognito",
      subject: "subject_1",
    });
  });

  it("treats malformed, invalid, wrong-use, and deleted-principal tokens as unauthenticated", async () => {
    const invalidVerifier = {
      verify: vi.fn().mockRejectedValue(new Error("invalid signature")),
    };
    const invalidResolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: invalidVerifier,
    });
    await expect(invalidResolver.resolve("Basic token")).resolves.toBeNull();
    await expect(
      invalidResolver.resolve("Bearer invalid.token"),
    ).resolves.toBeNull();

    const wrongUseResolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: {
        verify: () => Promise.resolve({ ...VALID_CLAIMS, token_use: "id" }),
      },
    });
    await expect(
      wrongUseResolver.resolve("Bearer id.token"),
    ).resolves.toBeNull();

    const deletedResolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: {
        resolveActivePrincipal: () => Promise.resolve(null),
      },
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify: () => Promise.resolve(VALID_CLAIMS) },
    });
    await expect(
      deletedResolver.resolve("Bearer valid.token"),
    ).resolves.toBeNull();
  });

  it("requires every configured API scope before resolving a principal", async () => {
    const resolveActivePrincipal = vi
      .fn()
      .mockResolvedValue({ principalId: "principal_mapped" });
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: { resolveActivePrincipal },
      requiredScope: ["cloudmarkup-api/access", "cloudmarkup-api/beta"],
      userPoolId: "us-east-1_example",
      verifier: {
        verify: vi
          .fn()
          .mockResolvedValueOnce({
            ...VALID_CLAIMS,
            scope: "openid cloudmarkup-api/access",
          })
          .mockResolvedValueOnce({
            ...VALID_CLAIMS,
            scope: "cloudmarkup-api/beta openid cloudmarkup-api/access profile",
          }),
      },
    });

    await expect(
      resolver.resolve("Bearer missing.scope.token"),
    ).resolves.toBeNull();
    await expect(
      resolver.resolve("Bearer complete.scope.token"),
    ).resolves.toMatchObject({ principalId: "principal_mapped" });
    expect(resolveActivePrincipal).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty or whitespace-bearing required scope configuration", () => {
    for (const requiredScope of [
      [],
      "",
      "cloudmarkup-api/access beta",
    ] as const) {
      expect(
        () =>
          new CognitoJwtPrincipalResolver({
            clientId: "client_cloudmarkup",
            principalDirectory: mappedDirectory,
            requiredScope,
            userPoolId: "us-east-1_example",
            verifier: { verify: () => Promise.resolve(VALID_CLAIMS) },
          }),
      ).toThrow("Cognito access-token scope is required");
    }
  });

  it("does not hide principal-directory outages as token failures", async () => {
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: {
        resolveActivePrincipal: () =>
          Promise.reject(new Error("database unavailable")),
      },
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify: () => Promise.resolve(VALID_CLAIMS) },
    });
    await expect(resolver.resolve("Bearer valid.token")).rejects.toThrow(
      "database unavailable",
    );
  });
  it("keeps a verified refresh session stable without making authentication more recent", async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce(VALID_CLAIMS)
      .mockResolvedValueOnce({
        ...VALID_CLAIMS,
        jti: "jwt_session_2",
        iat: VALID_CLAIMS.iat + 1800,
        exp: VALID_CLAIMS.exp + 1800,
      });
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify },
    });
    const original = await resolver.resolve("Bearer original.token");
    const renewed = await resolver.resolve("Bearer renewed.token");
    expect(renewed?.sessionId).toBe(original?.sessionId);
    expect(renewed?.sessionId).toBe("refresh_session_1");
    expect(renewed?.authenticatedAt).toBe(original?.authenticatedAt);
    expect(renewed?.expiresAt).toBe("2026-04-04T13:30:00.000Z");
  });

  it("keeps a different verified sign-in separate and supports tokens without a refresh-session claim", async () => {
    const withoutOrigin: Record<string, unknown> = { ...VALID_CLAIMS };
    delete withoutOrigin["origin_jti"];
    const verify = vi
      .fn()
      .mockResolvedValueOnce(VALID_CLAIMS)
      .mockResolvedValueOnce({
        ...VALID_CLAIMS,
        origin_jti: "refresh_session_2",
      })
      .mockResolvedValueOnce(withoutOrigin);
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "client_cloudmarkup",
      principalDirectory: mappedDirectory,
      requiredScope: "cloudmarkup-api/access",
      userPoolId: "us-east-1_example",
      verifier: { verify },
    });
    expect((await resolver.resolve("Bearer original.token"))?.sessionId).toBe(
      "refresh_session_1",
    );
    expect((await resolver.resolve("Bearer other.token"))?.sessionId).toBe(
      "refresh_session_2",
    );
    expect((await resolver.resolve("Bearer legacy.token"))?.sessionId).toBe(
      "jwt_session_1",
    );
  });

  it.each([null, "", 1, "bad session", "x".repeat(257)])(
    "rejects a malformed verified refresh-session identifier",
    async (origin) => {
      const resolveActivePrincipal = vi
        .fn()
        .mockResolvedValue({ principalId: "principal_mapped" });
      const resolver = new CognitoJwtPrincipalResolver({
        clientId: "client_cloudmarkup",
        principalDirectory: { resolveActivePrincipal },
        requiredScope: "cloudmarkup-api/access",
        userPoolId: "us-east-1_example",
        verifier: {
          verify: () =>
            Promise.resolve({ ...VALID_CLAIMS, origin_jti: origin }),
        },
      });
      expect(await resolver.resolve("Bearer malformed.token")).toBeNull();
      expect(resolveActivePrincipal).not.toHaveBeenCalled();
    },
  );
});

describe("local-development identity resolver", () => {
  const originalNodeEnvironment = process.env["NODE_ENV"];

  afterEach(() => {
    if (originalNodeEnvironment === undefined) {
      delete process.env["NODE_ENV"];
    } else {
      process.env["NODE_ENV"] = originalNodeEnvironment;
    }
  });

  it("accepts only its explicit local token namespace", async () => {
    process.env["NODE_ENV"] = "development";
    const resolver = new LocalDevelopmentPrincipalResolver({
      enabled: true,
      principalsByToken: { owner: localPrincipal },
      runtimeEnvironment: "local",
    });
    await expect(
      resolver.resolve("Bearer local-development:owner"),
    ).resolves.toMatchObject({
      authenticationSource: "local-development",
      principalId: "principal_local",
    });
    await expect(resolver.resolve("Bearer owner")).resolves.toBeNull();
    await expect(
      resolver.resolve("Bearer cognito.jwt.token"),
    ).resolves.toBeNull();
  });

  it("cannot activate in production or without both explicit local guards", () => {
    process.env["NODE_ENV"] = "production";
    expect(
      () =>
        new LocalDevelopmentPrincipalResolver({
          enabled: true,
          principalsByToken: { owner: localPrincipal },
          runtimeEnvironment: "local",
        }),
    ).toThrow("cannot run in this environment");

    process.env["NODE_ENV"] = "development";
    const unsafeOptions = {
      enabled: false,
      principalsByToken: { owner: localPrincipal },
      runtimeEnvironment: "test",
    } as unknown as LocalDevelopmentIdentityOptions;
    expect(() => new LocalDevelopmentPrincipalResolver(unsafeOptions)).toThrow(
      "cannot run in this environment",
    );
  });
});
