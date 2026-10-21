import { describe, expect, it } from "vitest";
import {
  accountAuthenticatorStateV1Schema,
  startAccountAuthenticatorV1Schema,
  changeAccountAuthenticatorV1Schema,
  accountAuthenticatorStartResultV1Schema,
  accountAuthenticatorChangeResultV1Schema,
  accountRecoveryContactV1Schema,
} from "./account-authenticator.js";
const common = {
  contractVersion: 1,
  attemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
};
const state = {
  contractVersion: 1,
  principalId: "principal_actor",
  enabled: false,
  enrollmentAvailable: true,
  recoveryContact: { kind: "email", value: "help@example.com" },
  enrollment: {
    id: common.attemptId,
    expiresAt: "2026-10-01T12:10:00.000Z",
    status: "ready",
    currentSession: true,
  },
};
describe("staged authenticator contracts", () => {
  it("canonicalizes enrollment and attempt UUIDs before they cross storage boundaries", () => {
    expect(
      startAccountAuthenticatorV1Schema.parse({
        ...common,
        attemptId: common.attemptId.toUpperCase(),
        acknowledgedRecovery: true,
      }).attemptId,
    ).toBe(common.attemptId);
    const command = changeAccountAuthenticatorV1Schema.parse({
      ...common,
      action: "verify-enable",
      enrollmentId: common.attemptId.toUpperCase(),
      code: "123456",
    });
    expect(
      command.action === "verify-enable" ? command.enrollmentId : null,
    ).toBe(common.attemptId);
  });
  it("requires explicit recovery/reduction acknowledgement and bounded verification input", () => {
    expect(
      startAccountAuthenticatorV1Schema.safeParse({
        ...common,
        acknowledgedRecovery: true,
      }).success,
    ).toBe(true);
    for (const input of [
      common,
      { ...common, acknowledgedRecovery: false },
      { ...common, acknowledgedRecovery: true, principalId: "principal_other" },
    ])
      expect(startAccountAuthenticatorV1Schema.safeParse(input).success).toBe(
        false,
      );
    const verify = {
      ...common,
      action: "verify-enable",
      enrollmentId: common.attemptId,
      code: "012345",
    };
    expect(changeAccountAuthenticatorV1Schema.safeParse(verify).success).toBe(
      true,
    );
    for (const extra of [
      { code: "12345" },
      { code: "1234567" },
      { code: "12345A" },
      { accessToken: "credential" },
      { secretCode: "JBSWY3DPEHPK3PXP" },
      { enrollmentId: "not-an-id" },
    ])
      expect(
        changeAccountAuthenticatorV1Schema.safeParse({ ...verify, ...extra })
          .success,
      ).toBe(false);
    expect(
      changeAccountAuthenticatorV1Schema.safeParse({
        ...common,
        action: "disable",
      }).success,
    ).toBe(false);
    expect(
      changeAccountAuthenticatorV1Schema.safeParse({
        ...common,
        action: "disable",
        acknowledgedReduction: true,
      }).success,
    ).toBe(true);
  });
  it("never exposes setup secrets after rejected/uncertain starts or from a different enrollment", () => {
    const result = {
      ...common,
      principalId: state.principalId,
      action: "start",
      outcome: "succeeded",
      problem: null,
      state,
      secretCode: "JBSWY3DPEHPK3PXP",
    };
    expect(
      accountAuthenticatorStartResultV1Schema.safeParse(result).success,
    ).toBe(true);
    for (const invalid of [
      { ...result, state: { ...state, enabled: true } },
      { ...result, state: { ...state, principalId: "principal_other" } },
      {
        ...result,
        state: {
          ...state,
          enrollment: { ...state.enrollment, currentSession: false },
        },
      },
      {
        ...result,
        state: {
          ...state,
          enrollment: { ...state.enrollment, status: "uncertain" },
        },
      },
      {
        ...result,
        state: {
          ...state,
          enrollment: {
            ...state.enrollment,
            id: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          },
        },
      },
      { ...result, outcome: "uncertain", problem: "unknown", state: null },
      { ...result, outcome: "rejected", problem: "setup-active", state: null },
    ])
      expect(
        accountAuthenticatorStartResultV1Schema.safeParse(invalid).success,
      ).toBe(false);
    expect(
      accountAuthenticatorStartResultV1Schema.safeParse({
        ...result,
        outcome: "uncertain",
        problem: "unknown",
        state: null,
        secretCode: null,
      }).success,
    ).toBe(true);
  });
  it("requires readback that matches the requested enable/disable/cancel result", () => {
    const result = {
      ...common,
      principalId: state.principalId,
      action: "verify-enable",
      outcome: "succeeded",
      problem: null,
      state: {
        ...state,
        enabled: true,
        enrollmentAvailable: false,
        enrollment: null,
      },
    };
    expect(
      accountAuthenticatorChangeResultV1Schema.safeParse(result).success,
    ).toBe(true);
    for (const invalid of [
      { ...result, state },
      { ...result, action: "disable" },
      { ...result, secretCode: "JBSWY3DPEHPK3PXP" },
      { ...result, action: "cancel-setup", state },
    ])
      expect(
        accountAuthenticatorChangeResultV1Schema.safeParse(invalid).success,
      ).toBe(false);
  });
  it("does not offer enrollment without a real bounded recovery contact", () => {
    expect(
      accountAuthenticatorStateV1Schema.safeParse({
        ...state,
        recoveryContact: null,
      }).success,
    ).toBe(false);
    expect(
      accountAuthenticatorStateV1Schema.safeParse({
        ...state,
        enrollmentAvailable: false,
        recoveryContact: null,
      }).success,
    ).toBe(true);
    for (const value of [
      "javascript:alert(1)",
      "http://example.com/help",
      "https://user:password@example.com/help",
    ])
      expect(
        accountRecoveryContactV1Schema.safeParse({ kind: "url", value })
          .success,
      ).toBe(false);
    expect(
      accountRecoveryContactV1Schema.safeParse({
        kind: "url",
        value: "https://example.com/help",
      }).success,
    ).toBe(true);
  });
});
