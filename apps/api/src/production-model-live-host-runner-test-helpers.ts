// Synthetic sessions only: no tools, network or native execution proof.
import { expect, vi } from "vitest";
import {
  canonicalJson,
  sha256Digest,
  type ApplicationBuildCommandInvocation,
  type ApplicationBuildCommandResult,
  type ApplicationBuildProducedFile,
  type ApplicationBuildWorkspaceExecutor,
  type ApplicationBuildWorkspaceSession,
} from "@cloudmarkup/application-build-runner";
import type { hostExecutionFixture } from "./production-model-live-repair-seed-execution-fixture.js";
type SeedFixture = ReturnType<typeof hostExecutionFixture>;
interface Fixture {
  readonly envelope: SeedFixture["envelope"];
  readonly request: {
    readonly source: Pick<SeedFixture["request"]["source"], "files">;
    readonly dependencyLock: SeedFixture["request"]["dependencyLock"];
  };
}
export function result(
  stdout = "",
  overrides: Partial<ApplicationBuildCommandResult> = {},
): ApplicationBuildCommandResult {
  return {
    exitCode: 0,
    termination: "completed",
    stdout,
    stderr: "",
    outputBytes: Buffer.byteLength(stdout),
    ...overrides,
  };
}
function passing(command: ApplicationBuildCommandInvocation) {
  if (command.step === "unit-tests" || command.step === "contract-tests") {
    return result(
      '{"numFailedTests":0,"numPassedTests":2,"numPendingTests":0}',
    );
  }
  if (command.step === "dependency-scan" || command.step === "secret-scan") {
    return result('{"Results":[]}');
  }
  return result();
}
export function produced(
  f: Fixture,
  marker = "same",
): ApplicationBuildProducedFile[] {
  const contract = f.envelope.contract;
  const sourceRoot = contract.entrypoint.slice(
    0,
    contract.entrypoint.lastIndexOf("/") + 1,
  );
  const compiledRoot = contract.compiledEntrypoint.slice(
    0,
    contract.compiledEntrypoint.lastIndexOf("/") + 1,
  );
  const files: ApplicationBuildProducedFile[] = f.request.source.files
    .filter(
      (file) => file.path.startsWith(sourceRoot) && file.path.endsWith(".ts"),
    )
    .map((file) => ({
      kind: "regular-file",
      path:
        compiledRoot +
        file.path.slice(sourceRoot.length).replace(/\.ts$/u, ".js"),
      bytes: Buffer.from(
        `// synthetic output ${marker}; no TypeScript executed\n`,
      ),
    }));
  for (const dependency of f.request.dependencyLock.packages) {
    if (
      dependency.kind !== "runtime" &&
      dependency.kind !== "transitive-runtime"
    )
      continue;
    files.push({
      kind: "regular-file",
      path: `application/node_modules/${dependency.name}/package.json`,
      bytes: Buffer.from(
        canonicalJson({ name: dependency.name, version: dependency.version }),
      ),
    });
    files.push({
      kind: "regular-file",
      path: `application/node_modules/${dependency.name}/index.js`,
      bytes: Buffer.from("// synthetic dependency output\n"),
    });
  }
  return files;
}
export interface Hooks {
  readonly opened?: (session: number, signal: AbortSignal | undefined) => void;
  readonly execute?: (
    session: number,
    command: ApplicationBuildCommandInvocation,
  ) => ApplicationBuildCommandResult | undefined;
  readonly output?: (
    session: number,
    files: ApplicationBuildProducedFile[],
  ) => readonly ApplicationBuildProducedFile[];
  readonly disposed?: (session: number) => void;
}
export function createHostExecutionHarness(f: Fixture, hooks: Hooks = {}) {
  const events: string[] = [];
  const sessions: ApplicationBuildWorkspaceSession[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const open = vi.fn<ApplicationBuildWorkspaceExecutor["open"]>((input) => {
    const number = sessions.length + 1;
    events.push(`open:${String(number)}`);
    signals.push(input.signal);
    expect(sha256Digest(canonicalJson(input.files))).toBe(
      sha256Digest(canonicalJson(f.request.source.files)),
    );
    expect(input.lock).toEqual(f.request.dependencyLock);
    const session: ApplicationBuildWorkspaceSession = {
      execute(command, signal) {
        expect(signal).toBe(input.signal);
        events.push(`${String(number)}:${command.step}`);
        return Promise.resolve(
          hooks.execute?.(number, command) ?? passing(command),
        );
      },
      readProducedFiles() {
        events.push(`collect:${String(number)}`);
        return Promise.resolve(
          hooks.output?.(number, produced(f)) ?? produced(f),
        );
      },
      dispose() {
        events.push(`dispose:${String(number)}`);
        hooks.disposed?.(number);
        return Promise.resolve();
      },
    };
    sessions.push(session);
    hooks.opened?.(number, input.signal);
    return Promise.resolve(session);
  });
  const executor: ApplicationBuildWorkspaceExecutor = { open };
  return {
    events,
    sessions,
    signals,
    open,
    executor,
  };
}
