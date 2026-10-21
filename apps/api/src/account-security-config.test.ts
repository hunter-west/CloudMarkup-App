import { describe, it, expect } from "vitest";
import { readProductionAccountSecurity } from "./account-security-config.js";
describe("operator account security configuration", () => {
  it("defaults new enrollment to unavailable without a recovery contact", () => {
    expect(readProductionAccountSecurity({})).toEqual({
      schemaVersion: 1,
      recoveryContact: null,
    });
  });
  it.each([
    { kind: "email", value: "help@example.com" },
    { kind: "url", value: "https://example.com/recovery" },
    null,
  ])(
    "accepts a reviewed contact or an explicit closed state",
    (recoveryContact) => {
      const input = { schemaVersion: 1, recoveryContact };
      expect(
        readProductionAccountSecurity({
          CLOUDMARKUP_ACCOUNT_SECURITY: JSON.stringify(input),
        }),
      ).toEqual(input);
    },
  );
  it.each([
    "",
    "null",
    "{}",
    '{"schemaVersion":2,"recoveryContact":null}',
    '{"schemaVersion":1,"recoveryContact":{"kind":"url","value":"https://user:pass@example.com"}}',
    '{"schemaVersion":1,"recoveryContact":{"kind":"url","value":"javascript:alert(1)"}}',
    '{"schemaVersion":1,"recoveryContact":{"kind":"email","value":"invalid"}}',
    '{"schemaVersion":1,"recoveryContact":null,"enabled":true}',
  ])(
    "rejects malformed and unsafe operator input without echoing it",
    (value) => {
      expect(() =>
        readProductionAccountSecurity({ CLOUDMARKUP_ACCOUNT_SECURITY: value }),
      ).toThrow("CLOUDMARKUP_ACCOUNT_SECURITY is invalid.");
    },
  );
});
