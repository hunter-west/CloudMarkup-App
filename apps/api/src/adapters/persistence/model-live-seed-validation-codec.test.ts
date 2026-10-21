import { syntheticSeedValidationBody as body } from "./model-live-seed-validation-test-helpers.js";
import { describe, expect, it } from "vitest";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import {
  identifyModelLiveSeedValidationReceipt,
  parseModelLiveSeedValidationRow,
  modelLiveSeedValidationReceiptV1Schema,
} from "./model-live-seed-validation-codec.js";

// Synthetic metadata only; these tests run no tools and issue no receipt row.
describe("fixed seed validation receipt metadata", () => {
  it("round-trips deterministic bounded metadata without granting authority", () => {
    const value = body();
    const first = identifyModelLiveSeedValidationReceipt(value);
    expect(identifyModelLiveSeedValidationReceipt(value)).toEqual(first);
    expect(
      modelLiveSeedValidationReceiptV1Schema.parse(
        JSON.parse(JSON.stringify(first)),
      ),
    ).toEqual(first);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(8192);
    expect(Object.keys(first)).not.toContain("source");
    expect(Object.keys(first)).not.toContain("usage");
  });

  it.each(["scope", "operatorUserId", "bindings", "reportDigest"] as const)(
    "rejects an unbound %s substitution",
    (field) => {
      const first = identifyModelLiveSeedValidationReceipt(body());
      const replacement =
        field === "scope"
          ? { ...first.scope, organizationId: "organization_other" }
          : field === "operatorUserId"
            ? "principal_other"
            : field === "bindings"
              ? {
                  ...first.bindings,
                  policyDigest: digestCanonicalValue("different-policy"),
                }
              : digestCanonicalValue("different-report");
      expect(
        modelLiveSeedValidationReceiptV1Schema.safeParse({
          ...first,
          [field]: replacement,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    ["source", "private candidate bytes"],
    ["usage", { inputTokens: 1 }],
    ["artifacts", []],
    ["grade", "passed"],
    ["cleanup", "not-established"],
    ["variant", "positive-control"],
    ["observedDefect", "unclassified"],
    ["recipeVersion", "1.0.0"],
    ["recipeVersion", "1.2.0"],
    ["completedAt", "2026-09-14T11:59:59.000Z"],
    ["issuedAt", "2026-09-14T12:00:19.000Z"],
  ])("rejects coherently identified forbidden %s metadata", (field, value) => {
    const modified = { ...body(), [field]: value };
    const receiptId =
      "seed_validation_" + digestCanonicalValue(modified).slice(7);
    const identified = { ...modified, receiptId };
    expect(
      modelLiveSeedValidationReceiptV1Schema.safeParse({
        ...identified,
        receiptDigest: digestCanonicalValue(identified),
      }).success,
    ).toBe(false);
  });
});

describe("seed validation persisted metadata restoration", () => {
  function fixture() {
    const receipt = identifyModelLiveSeedValidationReceipt(body());
    const row = {
      organization_id: receipt.scope.organizationId,
      project_id: receipt.scope.projectId,
      principal_id: receipt.scope.userId,
      operator_principal_id: receipt.operatorUserId,
      case_id: receipt.caseId,
      receipt_id: receipt.receiptId,
      receipt_sha256: receipt.receiptDigest.slice(7),
      configuration_sha256: receipt.configurationDigest.slice(7),
      receipt_record: receipt,
      issued_at_text: receipt.issuedAt,
    };
    return { receipt, row };
  }
  it.each(["object", "json"] as const)(
    "restores only the exact bounded %s row",
    (serialization) => {
      const { receipt, row } = fixture();
      const stored = {
        ...row,
        receipt_record:
          serialization === "json" ? JSON.stringify(receipt) : receipt,
      };
      expect(parseModelLiveSeedValidationRow(stored, receipt.scope)).toEqual(
        receipt,
      );
    },
  );
  it.each([
    "organization_id",
    "project_id",
    "principal_id",
    "operator_principal_id",
    "case_id",
    "receipt_id",
    "receipt_sha256",
    "configuration_sha256",
    "issued_at_text",
  ] as const)("rejects mismatched %s columns", (field) => {
    const { receipt, row } = fixture();
    expect(() =>
      parseModelLiveSeedValidationRow(
        {
          ...row,
          [field]:
            field === "issued_at_text"
              ? new Date(Date.parse(receipt.issuedAt) + 1).toISOString()
              : "unbound",
        },
        receipt.scope,
      ),
    ).toThrow("authenticated seed validation");
  });
  it("rejects foreign expected scope and oversized or malformed stored records", () => {
    const { receipt, row } = fixture();
    expect(() =>
      parseModelLiveSeedValidationRow(row, {
        ...receipt.scope,
        organizationId: "organization_foreign",
      }),
    ).toThrow();
    for (const record of [
      undefined,
      "{",
      " ".repeat(8193),
      { ...receipt, grade: "pass" },
    ]) {
      expect(() =>
        parseModelLiveSeedValidationRow(
          { ...row, receipt_record: record },
          receipt.scope,
        ),
      ).toThrow("authenticated seed validation");
    }
  });
});
