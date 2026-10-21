import { syntheticSeedValidationBody } from "./adapters/persistence/model-live-seed-validation-test-helpers.js";
import { identifyModelLiveSeedValidationReceipt } from "./adapters/persistence/model-live-seed-validation-codec.js";
import { vi } from "vitest";
import type {
  ApplicationBuildCommandResult,
  ApplicationBuildWorkspaceExecutor,
  ApplicationBuildWorkspaceSession,
} from "@cloudmarkup/application-build-runner";
import { HOST_REPAIR_SEED_EXTENSION_PATH } from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostExecutionFixture } from "./production-model-live-repair-seed-execution-fixture.js";
import { createProductionSeedValidationHost } from "./production-model-live-seed-validation-host.js";

type Fault =
  "preflight" | "lint" | "diagnostic" | "cleanup" | "cancel" | undefined;
export function seedValidationHostFixture(fault?: Fault) {
  const { config } = hostExecutionFixture(true);
  const events: string[] = [];
  const controller = new AbortController();
  const open = vi.fn<ApplicationBuildWorkspaceExecutor["open"]>((input) => {
    events.push("open");
    const source = input.files.find(
      (file) => file.path === HOST_REPAIR_SEED_EXTENSION_PATH,
    );
    if (!source) throw Error("Missing fixed source");
    const line =
      source.content
        .split("\n")
        .findIndex(
          (text) =>
            text === 'export const repairSeedTypeWitness: number = "invalid";',
        ) + 1;
    return Promise.resolve({
      execute(command) {
        events.push(command.step);
        if (fault === "cancel") controller.abort();
        let stdout = "",
          exitCode = 0;
        if (command.step === "typecheck") {
          exitCode = 2;
          stdout =
            fault === "diagnostic"
              ? "unrelated tool failure\n"
              : source.path +
                "(" +
                String(line) +
                ",14): error TS2322: Type 'string' is not assignable to type 'number'.\n";
        } else if (fault === "lint" && command.step === "lint") exitCode = 1;
        return Promise.resolve({
          exitCode,
          stdout,
          stderr: "",
          termination: "completed",
          outputBytes: Buffer.byteLength(stdout),
        } satisfies ApplicationBuildCommandResult);
      },
      readProducedFiles() {
        throw Error("Invalid seed must never collect artifacts");
      },
      dispose() {
        events.push("dispose");
        return fault === "cleanup"
          ? Promise.reject(Error("Synthetic cleanup failure"))
          : Promise.resolve();
      },
    } satisfies ApplicationBuildWorkspaceSession);
  });
  const assertHostIsolation = vi.fn(() => {
    events.push("preflight");
    return fault === "preflight"
      ? Promise.reject(Error("Synthetic native admission failure"))
      : Promise.resolve();
  });
  const admission = {
    policy: config.policy,
    dependencyLock: config.dependencyLock,
    environment: config.environment,
    helperDigest: config.helperDigest,
  };
  const configuration = { admission, executor: { open }, assertHostIsolation };
  const host = createProductionSeedValidationHost(configuration);
  return {
    admission,
    events,
    controller,
    open,
    assertHostIsolation,
    host,
    configuration,
  };
}

export async function seedValidationReceiptFixture() {
  const f = seedValidationHostFixture();
  const body = syntheticSeedValidationBody();
  const observation = await f.host.run(body.caseId, body.startedAt);
  const receipt = identifyModelLiveSeedValidationReceipt({
    ...body,
    configurationDigest: observation.configurationDigest,
    bindings: observation.bindings,
    reportDigest: observation.reportDigest,
    ownershipDigest: observation.ownershipDigest,
    profileDigest: observation.profileDigest,
    toolchainDigest: observation.toolchainDigest,
    builderDigest: observation.builderDigest,
    scannerDigest: observation.scannerDigest,
  });
  f.events.splice(0);
  return { ...f, receipt };
}
