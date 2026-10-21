import type {
  ApplicationBuildCommandResult,
  ApplicationBuildTestSummaryV1,
  ApplicationBuildFindingV1,
} from "./contracts.js";
import { compareUtf16 } from "./security.js";

export function parseTestSummary(
  kind: "unit" | "contract",
  result: ApplicationBuildCommandResult,
): ApplicationBuildTestSummaryV1 {
  if (result.termination !== "completed")
    return { failed: 0, kind, passed: 0, skipped: 0, state: "not-run" };
  try {
    const value = JSON.parse(result.stdout) as {
      numFailedTests?: unknown;
      numPassedTests?: unknown;
      numPendingTests?: unknown;
    };
    const failed =
      typeof value.numFailedTests === "number" &&
      Number.isInteger(value.numFailedTests)
        ? Math.max(0, value.numFailedTests)
        : result.exitCode === 0
          ? 0
          : 1;
    const passed =
      typeof value.numPassedTests === "number" &&
      Number.isInteger(value.numPassedTests)
        ? Math.max(0, value.numPassedTests)
        : 0;
    const skipped =
      typeof value.numPendingTests === "number" &&
      Number.isInteger(value.numPendingTests)
        ? Math.max(0, value.numPendingTests)
        : 0;
    return {
      failed,
      kind,
      passed,
      skipped,
      state: result.exitCode === 0 && failed === 0 ? "passed" : "failed",
    };
  } catch {
    return {
      failed: result.exitCode === 0 ? 0 : 1,
      kind,
      passed: 0,
      skipped: 0,
      state: result.exitCode === 0 ? "not-run" : "failed",
    };
  }
}

export function parseTrivyFindings(
  source: "dependency" | "secret",
  stdout: string,
): ApplicationBuildFindingV1[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const results = (value as { Results?: unknown }).Results;
  if (!Array.isArray(results) || results.length > 256) return undefined;
  const findings: ApplicationBuildFindingV1[] = [];
  for (const result of results) {
    if (typeof result !== "object" || result === null || Array.isArray(result))
      return undefined;
    const record = result as Record<string, unknown>;
    const candidates =
      source === "dependency" ? record["Vulnerabilities"] : record["Secrets"];
    if (
      candidates === undefined &&
      Object.keys(record).length === 4 &&
      record["Target"] === "pnpm-lock.yaml" &&
      record["Class"] === "lang-pkgs" &&
      record["Type"] === "pnpm" &&
      Array.isArray(record["Packages"]) &&
      record["Packages"].length > 0 &&
      record["Packages"].every((entry: unknown) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
          return false;
        const pkg = entry as Record<string, unknown>;
        return (
          typeof pkg["Name"] === "string" &&
          pkg["Name"].length > 0 &&
          typeof pkg["Version"] === "string" &&
          pkg["Version"].length > 0 &&
          pkg["ID"] === pkg["Name"] + "@" + pkg["Version"] &&
          pkg["AnalyzedBy"] === "pnpm"
        );
      })
    )
      continue;
    if (!Array.isArray(candidates) || candidates.length > 256) return undefined;
    for (const candidate of candidates) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Array.isArray(candidate)
      )
        return undefined;
      const finding = candidate as Record<string, unknown>;
      const rawId =
        source === "dependency"
          ? finding["VulnerabilityID"]
          : finding["RuleID"];
      if (
        typeof rawId !== "string" ||
        rawId.trim().length === 0 ||
        typeof finding["Severity"] !== "string" ||
        !new Set(["critical", "high", "medium", "low", "unknown"]).has(
          finding["Severity"].toLowerCase(),
        )
      )
        return undefined;
      const normalized = rawId.toLowerCase().replaceAll(/[^a-z0-9._-]/gu, "-");
      const severity = finding["Severity"].toLowerCase();
      findings.push({
        findingId:
          `application.build.${source}.${normalized}` as ApplicationBuildFindingV1["findingId"],
        ...(typeof finding["PkgName"] === "string"
          ? { packageName: finding["PkgName"] }
          : {}),
        severity: new Set(["critical", "high", "medium", "low"]).has(severity)
          ? (severity as ApplicationBuildFindingV1["severity"])
          : "unknown",
        source,
        summary:
          source === "secret"
            ? "Secret scanner reported a redacted finding."
            : "Dependency scanner reported a known vulnerability.",
      });
    }
  }
  return findings.sort((left, right) =>
    compareUtf16(String(left.findingId), String(right.findingId)),
  );
}
