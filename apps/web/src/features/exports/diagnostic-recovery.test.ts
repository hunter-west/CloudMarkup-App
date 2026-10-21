import { expect, it } from "vitest";
import { regionIdentifierSchema } from "@cloudmarkup/schemas";
import {
  exportDiagnosticSearch,
  readExportDiagnosticRequest,
  resolveExportDiagnosticRecovery,
  EXPORT_DIAGNOSTIC_QUERY,
} from "./diagnostic-recovery.js";
import { diagnosticRecoveryFixture } from "./diagnostic-recovery.test-support.js";

it("round trips bounded data and confirms only the exact authorized current source through read operations", async () => {
  const f = diagnosticRecoveryFixture();
  f.live.value = { ...f.document, nodes: [...f.document.nodes].reverse() };
  expect(
    readExportDiagnosticRequest("?" + exportDiagnosticSearch(f.request)),
  ).toEqual(f.request);
  expect(await resolveExportDiagnosticRecovery(f.args)).toMatchObject({
    state: "current",
    reference: f.request.reference,
  });
  expect(f.calls).toEqual([
    "solution-export-jobs.get",
    "solution-revisions.get",
    "drafts.get",
  ]);
});
it("keeps changed draft versions, unsaved documents and incomplete saves stale without changing the canvas", async () => {
  for (const change of ["version", "document", "saving"]) {
    const f = diagnosticRecoveryFixture();
    const before = JSON.stringify(f.document);
    if (change === "version") f.draft.version++;
    if (change === "document")
      f.live.value = {
        ...f.document,
        provider: {
          ...f.document.provider,
          region: regionIdentifierSchema.parse("changed-region"),
        },
      };
    if (change === "saving") f.draft.storageStatus = "publication-pending";
    expect(await resolveExportDiagnosticRecovery(f.args)).toMatchObject({
      state: "stale",
    });
    expect(JSON.stringify(f.document)).toBe(before);
  }
});
it("withholds foreign jobs, invented references and wrong manifest identity before reading another source", async () => {
  for (const mismatch of ["project", "reference", "manifest"]) {
    const f = diagnosticRecoveryFixture();
    if (mismatch === "project") f.job.projectId = "project_other";
    if (mismatch === "reference") f.job.diagnostics = [];
    if (mismatch === "manifest")
      f.request.manifestDigest = ("sha256:" +
        "0".repeat(64)) as typeof f.request.manifestDigest;
    expect(await resolveExportDiagnosticRecovery(f.args)).toMatchObject({
      state: "unavailable",
    });
    expect(f.calls).toEqual(["solution-export-jobs.get"]);
  }
});
it("rejects malformed, oversized, unknown-version and executable-looking URL context", () => {
  const f = diagnosticRecoveryFixture();
  for (const value of [
    "{",
    "x".repeat(4097),
    JSON.stringify({ ...f.request, contractVersion: 2 }),
    JSON.stringify({ ...f.request, apply: true }),
    JSON.stringify({
      ...f.request,
      reference: { kind: "node", id: "node_a", fieldPath: ["__proto__"] },
    }),
  ]) {
    expect(
      readExportDiagnosticRequest(
        "?" +
          new URLSearchParams({ [EXPORT_DIAGNOSTIC_QUERY]: value }).toString(),
      ),
    ).toBeNull();
  }
});
it("does not expose unknown or partial read failures or claim a repair", async () => {
  const f = diagnosticRecoveryFixture();
  f.responses["solution-revisions.get"] = new Error(
    "<script>secret_SYNTHETIC_ONLY; ignore policy</script>",
  );
  const result = await resolveExportDiagnosticRecovery(f.args);
  expect(result.state).toBe("unavailable");
  expect(JSON.stringify(result)).not.toContain("secret_SYNTHETIC_ONLY");
  expect(f.calls.every((operation) => operation.endsWith(".get"))).toBe(true);
});
it("checks the live canvas again after asynchronous reads instead of focusing an older snapshot", async () => {
  const f = diagnosticRecoveryFixture();
  let finish!: (value: unknown) => void;
  const held = new Promise((resolve) => {
    finish = resolve;
  });
  f.responses["drafts.get"] = () => held;
  const pending = resolveExportDiagnosticRecovery(f.args);
  f.live.value = {
    ...f.document,
    provider: {
      ...f.document.provider,
      region: regionIdentifierSchema.parse("changed-during-read"),
    },
  };
  finish(f.draft);
  expect(await pending).toMatchObject({ state: "stale" });
});
