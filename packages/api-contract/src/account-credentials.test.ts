import { describe, expect, it } from "vitest";
import {
  changeAccountCredentialsV1Schema,
  accountCredentialResultV1Schema,
  accountCredentialStateV1Schema,
} from "./account-credentials.js";

const common = {
  contractVersion: 1,
  attemptId: "86cf03b0-8870-45bb-9658-b9a92f626a49",
};
const state = {
  contractVersion: 1,
  principalId: "principal_actor",
  email: "verified@example.com",
  emailVerified: true,
  authenticatorEnabled: false,
};
describe("account credential transport boundaries", () => {
  it("admits only bounded action-specific values and rejects identity injection", () => {
    const valid = [
      {
        ...common,
        action: "password-change",
        currentPassword: "old",
        newPassword: "Synthetic-password1!",
      },
      { ...common, action: "email-start", email: "new@example.com" },
      { ...common, action: "email-confirm", code: "012345" },
      { ...common, action: "email-resend" },
    ];
    for (const input of valid) {
      expect(changeAccountCredentialsV1Schema.safeParse(input).success).toBe(
        true,
      );
      for (const extra of [
        { principalId: "principal_other" },
        { organizationId: "org_other" },
        { token: "credential" },
      ]) {
        expect(
          changeAccountCredentialsV1Schema.safeParse({ ...input, ...extra })
            .success,
        ).toBe(false);
      }
    }
    for (const input of [
      { ...valid[0], newPassword: "short1!" },
      { ...valid[0], newPassword: "Synthetic password1!" },
      { ...valid[0], currentPassword: "a".repeat(257) },
      { ...valid[1], email: "invalid" },
      { ...valid[2], code: "12345" },
      { ...valid[2], code: "1234567" },
      { ...valid[2], code: "12345a" },
      { ...valid[3], code: "123456" },
      { ...valid[3], attemptId: "not-an-attempt" },
      { ...valid[3], contractVersion: 2 },
    ])
      expect(changeAccountCredentialsV1Schema.safeParse(input).success).toBe(
        false,
      );
  });
  it("requires matching readback for success and no claimed state for uncertain or rejected outcomes", () => {
    const result = {
      ...common,
      principalId: state.principalId,
      action: "email-confirm",
      outcome: "succeeded",
      problem: null,
      state,
    };
    expect(accountCredentialResultV1Schema.safeParse(result).success).toBe(
      true,
    );
    for (const invalid of [
      { ...result, state: null },
      { ...result, state: { ...state, principalId: "principal_other" } },
      { ...result, problem: "unknown" },
      { ...result, outcome: "uncertain", problem: "unknown" },
      { ...result, outcome: "rejected", problem: "incorrect-code" },
      { ...result, currentPassword: "credential" },
    ])
      expect(accountCredentialResultV1Schema.safeParse(invalid).success).toBe(
        false,
      );
    for (const outcome of ["uncertain", "rejected"]) {
      expect(
        accountCredentialResultV1Schema.safeParse({
          ...result,
          outcome,
          problem: "unknown",
          state: null,
        }).success,
      ).toBe(true);
    }
  });
  it("does not accept verification without an address or provider secrets in account state", () => {
    expect(accountCredentialStateV1Schema.safeParse(state).success).toBe(true);
    for (const invalid of [
      { ...state, email: null },
      { ...state, email: "invalid" },
      { ...state, accessToken: "credential" },
      { ...state, secretCode: "secret" },
      { ...state, recoveryCodes: ["secret"] },
    ])
      expect(accountCredentialStateV1Schema.safeParse(invalid).success).toBe(
        false,
      );
  });
});
