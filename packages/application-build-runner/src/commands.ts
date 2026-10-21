import type {
  ApplicationBuildCommandInvocation,
  ApplicationBuildCommandResult,
  ApplicationBuildStepSummaryV1,
} from "./contracts.js";

export const APPROVED_APPLICATION_BUILD_COMMANDS = Object.freeze({
  install: {
    args: [
      "install",
      "--dir",
      "application",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--store-dir",
      "/opt/cloudmarkup/pnpm-store",
      "--ignore-workspace",
      "--ignore-pnpmfile",
      "--trust-lockfile",
      "--frozen-store",
      "--no-runtime",
      "--config.node-linker=hoisted",
      "--config.package-import-method=copy",
      "--config.bin-links=false",
      "--config.prefer-symlinked-executables=false",
      "--config.symlink=false",
    ],
    executable: "pnpm",
    step: "install",
  },
  lint: {
    args: [
      "--config",
      "/opt/cloudmarkup/config/eslint.generated.mjs",
      "--no-cache",
      "--max-warnings",
      "0",
      "application/src",
      "application/tests",
    ],
    executable: "eslint",
    step: "lint",
  },
  typecheck: {
    args: ["--project", "application/tsconfig.json", "--noEmit"],
    executable: "tsc",
    step: "typecheck",
  },
  unitTests: {
    args: [
      "run",
      "unit.test.ts",
      "--reporter=json",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ],
    executable: "vitest",
    step: "unit-tests",
  },
  contractTests: {
    args: [
      "run",
      "contracts.test.ts",
      "--reporter=json",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
      "--passWithNoTests=false",
    ],
    executable: "vitest",
    step: "contract-tests",
  },
  dependencyScan: {
    args: [
      "fs",
      "--scanners",
      "vuln",
      "--offline-scan",
      "--skip-db-update",
      "--disable-telemetry",
      "--skip-version-check",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--no-progress",
      "application",
    ],
    executable: "trivy",
    step: "dependency-scan",
  },
  secretScan: {
    args: [
      "fs",
      "--scanners",
      "secret",
      "--offline-scan",
      "--skip-db-update",
      "--disable-telemetry",
      "--skip-version-check",
      "--format",
      "json",
      "--exit-code",
      "0",
      "--no-progress",
      "application",
    ],
    executable: "trivy",
    step: "secret-scan",
  },
  compile: {
    args: [
      "--project",
      "application/tsconfig.json",
      "--noEmit",
      "false",
      "--sourceMap",
      "false",
      "--declaration",
      "false",
    ],
    executable: "tsc",
    step: "compile",
  },
  productionPrune: {
    args: [
      "install",
      "--prod",
      "--dir",
      "application",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--strict-peer-dependencies",
      "--store-dir",
      "/opt/cloudmarkup/pnpm-store",
      "--ignore-workspace",
      "--ignore-pnpmfile",
      "--trust-lockfile",
      "--frozen-store",
      "--no-runtime",
      "--config.node-linker=hoisted",
      "--config.package-import-method=copy",
      "--config.bin-links=false",
      "--config.prefer-symlinked-executables=false",
      "--config.symlink=false",
    ],
    executable: "pnpm",
    step: "production-prune",
  },
} as const satisfies Readonly<
  Record<string, ApplicationBuildCommandInvocation>
>);

const commandsByStep = new Map(
  Object.values(APPROVED_APPLICATION_BUILD_COMMANDS).map(
    (command) => [command.step, command] as const,
  ),
);

export function isApprovedApplicationBuildInvocation(
  invocation: ApplicationBuildCommandInvocation,
): boolean {
  const approved = commandsByStep.get(invocation.step);
  return (
    invocation.executable === approved?.executable &&
    invocation.args.length === approved.args.length &&
    invocation.args.every(
      (argument, index) => argument === approved.args[index],
    )
  );
}

export function commandSummary(
  invocation: ApplicationBuildCommandInvocation,
  result: ApplicationBuildCommandResult,
): ApplicationBuildStepSummaryV1 {
  return {
    executable: invocation.executable,
    outputBytes: result.outputBytes,
    state:
      result.termination === "completed"
        ? result.exitCode === 0
          ? "passed"
          : "failed"
        : result.termination,
    step: invocation.step,
  };
}
