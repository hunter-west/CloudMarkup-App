import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOperatorArguments,
  validateOperatorUser,
} from "./platform-account-operator.mjs";
const valid = [
  "--profile",
  "synthetic",
  "--email",
  "staff@example.test",
  "--action",
  "staff-authorize",
  "--reason",
  "Synthetic staff bootstrap",
];
test("provider-cost access requires explicit global permission and a separate exact organization action", () => {
  assert.ok(
    !parseOperatorArguments(valid).permissions.includes("provider-costs.read"),
  );
  assert.deepEqual(
    parseOperatorArguments([...valid, "--permissions", "provider-costs.read"])
      .permissions,
    ["provider-costs.read"],
  );
  const scoped = valid.map((v) =>
    v === "staff-authorize" ? "staff-cost-authorize" : v,
  );
  assert.throws(() => parseOperatorArguments(scoped));
  assert.throws(() =>
    parseOperatorArguments([...valid, "--organization-id", "org_fixture"]),
  );
  assert.throws(() =>
    parseOperatorArguments([
      ...scoped,
      "--organization-id",
      "org_fixture",
      "--permissions",
      "accounts.read",
    ]),
  );
  const parsed = parseOperatorArguments([
    ...scoped,
    "--organization-id",
    "org_fixture",
  ]);
  assert.equal(parsed.organizationId, "org_fixture");
  assert.equal(parsed.confirmation, undefined);
  const disabled = {
    Enabled: false,
    UserStatus: "CONFIRMED",
    UserAttributes: [
      { Name: "email", Value: "staff@example.test" },
      { Name: "email_verified", Value: "true" },
      { Name: "sub", Value: "synthetic_subject" },
    ],
  };
  assert.throws(() => validateOperatorUser(disabled, parsed));
  const revoke = parseOperatorArguments([
    ...scoped.map((v) =>
      v === "staff-cost-authorize" ? "staff-cost-revoke" : v,
    ),
    "--organization-id",
    "org_fixture",
  ]);
  assert.equal(validateOperatorUser(disabled, revoke).sub, "synthetic_subject");
  assert.throws(() =>
    validateOperatorUser(disabled, {
      ...revoke,
      email: "someone@example.test",
    }),
  );
});
test("operator defaults to a read-only preview and requires an explicit reviewed digest for writes", () => {
  assert.equal(parseOperatorArguments(valid).confirmation, undefined);
  assert.equal(
    parseOperatorArguments([...valid, "--confirm-digest", "a".repeat(64)])
      .confirmation,
    "a".repeat(64),
  );
  assert.throws(() =>
    parseOperatorArguments([...valid, "--confirm-digest", "yes"]),
  );
});
test("operator refuses unknown, duplicate, incomplete or injected flags and invalid permissions", () => {
  for (const args of [
    [...valid, "--admin", "yes"],
    [...valid, "--profile", "other"],
    [...valid, "--reason"],
    [...valid, "--permissions", "owner"],
    [...valid, "--permissions", "accounts.read,accounts.read"],
  ])
    assert.throws(() => parseOperatorArguments(args));
});

test("pending reconciliation requires a complete test-only request attestation and never enables writes implicitly", () => {
  const cutover = valid.map((value) =>
    value === "staff-authorize" ? "live-cutover" : value,
  );
  const evidence = [
    "--pending-checkout-attempt",
    "checkout_" + "a".repeat(32),
    "--pending-checkout-session",
    "cs_test_synthetic",
    "--pending-checkout-request",
    "req_synthetic",
  ];
  const parsed = parseOperatorArguments([...cutover, ...evidence]);
  assert.equal(parsed.confirmation, undefined);
  assert.deepEqual(parsed.pendingCheckout, {
    attemptId: "checkout_" + "a".repeat(32),
    providerSessionReference: "cs_test_synthetic",
    providerRequestId: "req_synthetic",
  });
  for (const args of [
    [...valid, ...evidence],
    [...cutover, ...evidence.slice(0, 4)],
    [
      ...cutover,
      ...evidence.map((value) =>
        value === "cs_test_synthetic" ? "cs_live_synthetic" : value,
      ),
    ],
    [
      ...cutover,
      ...evidence.map((value) =>
        value === "req_synthetic" ? "invalid" : value,
      ),
    ],
  ])
    assert.throws(() => parseOperatorArguments(args));
});

test("trial authority requires explicit permission selection and is absent from legacy defaults", () => {
  assert.deepEqual(parseOperatorArguments(valid).permissions, [
    "accounts.read",
    "credits.grant",
    "credits.revoke",
    "operations.manage",
  ]);
  const trial = parseOperatorArguments([
    ...valid,
    "--permissions",
    "accounts.read,trials.grant,trials.revoke",
  ]);
  assert.deepEqual(trial.permissions, [
    "accounts.read",
    "trials.grant",
    "trials.revoke",
  ]);
  assert.equal(trial.confirmation, undefined);
});
