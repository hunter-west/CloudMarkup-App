import assert from "node:assert/strict";
import test from "node:test";

import {
  generateProviderIconSourceReview,
  parseProviderIconSourceReview,
  validateProviderIconSourceReview,
} from "./source-review.mjs";

const manifest = Object.freeze({
  approval: Object.freeze({
    accessibilityContract: "supplementary-icon-with-visible-name-v1",
    approvalDate: "2026-01-15",
    approvedSurfaces: Object.freeze([
      "diagram-export",
      "documentation",
      "product-ui",
    ]),
    recordId: "CM-TEST-PROVIDER-ICON-APPROVAL-001",
    reviewerName: "Example Product Owner",
    reviewerRelationship: "Example provider-partner relationship",
    reviewerRole: "Cloud Markup product owner",
    trademarkUseAcknowledgment: "synthetic-product-owner-acknowledgment",
  }),
  source: Object.freeze({
    importedAt: "2026-01-15T12:00:00.000Z",
    origin: "https://example.invalid/provider-icons/",
    packageLabel: "example-provider-icons-1.0.zip",
    packageSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    packageVersion: "1.0.0",
  }),
});

test("source review has one deterministic owner-evidence representation", () => {
  const text = generateProviderIconSourceReview(manifest);
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(parseProviderIconSourceReview(text), {
    approval: manifest.approval,
    source: manifest.source,
  });
  assert.deepEqual(validateProviderIconSourceReview(text, manifest), {
    approval: manifest.approval,
    source: manifest.source,
  });
});

test("source review rejects missing, extra, reordered, and noncanonical fields", () => {
  const text = generateProviderIconSourceReview(manifest);
  for (const invalid of [
    text.replace(/^- packageVersion:.*\n/mu, ""),
    `${text}- extra: "not allowed"\n`,
    text.replace(/(- recordId:.*\n)(- reviewerName:.*\n)/u, "$2$1"),
    text.replace(
      '- approvedSurfaces: ["diagram-export","documentation","product-ui"]',
      '- approvedSurfaces: [ "diagram-export", "documentation", "product-ui" ]',
    ),
  ]) {
    assert.throws(
      () => parseProviderIconSourceReview(invalid),
      /Invalid provider icon source review/u,
    );
  }
});

test("source review rejects evidence that differs from the manifest", () => {
  const changed = generateProviderIconSourceReview({
    ...manifest,
    source: { ...manifest.source, packageVersion: "different" },
  });
  assert.throws(
    () => validateProviderIconSourceReview(changed, manifest),
    /does not exactly match manifest source and approval evidence/u,
  );
});
