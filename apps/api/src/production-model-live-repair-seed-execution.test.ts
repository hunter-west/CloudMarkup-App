import {
  createHostExecutionHarness,
  result,
  produced,
  type Hooks,
} from "./production-model-live-host-runner-test-helpers.js";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applicationLambdaArtifactManifestV1Schema,
  applicationBuildSourceTreeDigest,
  applicationDependencyLockPackageV1Schema,
  canonicalJson,
  sha256Digest,
  type ApplicationBuildProducedFile,
} from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairSeedManifestV1Schema,
  createApplicationHostRepairSeedRunner,
  HOST_REPAIR_SEED_STEPS,
  inspectApplicationHostRepairSeedRequestV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostExecutionFixture } from "./production-model-live-repair-seed-execution-fixture.js";

// Fake sessions below establish orchestration only. None represents tool proof.
type Fixture = ReturnType<typeof hostExecutionFixture>;
function harness(f: Fixture, hooks: Hooks = {}) {
  const h = createHostExecutionHarness(f, hooks);
  return {
    ...h,
    runner: createApplicationHostRepairSeedRunner({
      executor: h.executor,
      config: f.config,
    }),
  };
}
function diagnostic(f: Fixture) {
  const source = f.request.source.files.find(
    (file) => file.path === f.request.source.extensionPath,
  );
  if (source === undefined) throw Error("Missing fixed fixture extension.");
  const line =
    source.content
      .split("\n")
      .findIndex(
        (value) =>
          value === 'export const repairSeedTypeWitness: number = "invalid";',
      ) + 1;
  return `${source.path}(${String(line)},14): error TS2322: Type 'string' is not assignable to type 'number'.\n`;
}
afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixed host runner orchestration without real tools", () => {
  it("requires two complete independent sessions and cleanup before host-only artifacts", async () => {
    const f = hostExecutionFixture();
    const original = sha256Digest(canonicalJson(f));
    const h = harness(f);
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("passed");
    const matrix = HOST_REPAIR_SEED_STEPS.map(([step]) => step);
    expect(h.events).toEqual([
      "open:1",
      ...matrix.map((step) => `1:${step}`),
      "collect:1",
      "dispose:1",
      "open:2",
      ...matrix.map((step) => `2:${step}`),
      "collect:2",
      "dispose:2",
    ]);
    expect(h.sessions[0]).not.toBe(h.sessions[1]);
    expect(observation.steps).toHaveLength(9);
    expect(observation.tests.map((test) => test.passed)).toEqual([2, 2]);
    expect(observation.cleanup).toBe("verified");
    expect(observation.reproducibility.state).toBe("verified");
    expect(observation.artifacts).toHaveLength(3);
    const manifestFile = observation.artifacts.find(
      (file) => file.mediaType === "application/json",
    );
    if (manifestFile === undefined) throw Error("Missing host manifest.");
    const manifest: unknown = JSON.parse(
      Buffer.from(manifestFile.bytesBase64, "base64").toString("utf8"),
    );
    const admitted = applicationHostRepairSeedManifestV1Schema.parse(manifest);
    expect(
      admitted.files.some((file) => file.path === "extensions/custom.js"),
    ).toBe(true);
    expect(admitted.bindings).toEqual(observation.bindings);
    expect(
      applicationLambdaArtifactManifestV1Schema.safeParse(manifest).success,
    ).toBe(false);
    expect(sha256Digest(canonicalJson(f))).toBe(original);
  });

  it("denies coherently rehashed substituted source before opening", async () => {
    const f = hostExecutionFixture();
    const h = harness(f);
    const changed = structuredClone(f.request);
    const file = changed.source.files[0];
    if (file === undefined) throw Error("Missing source.");
    file.content += "\n// substituted fixed source\n";
    file.checksum = sha256Digest(file.content);
    changed.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
      changed.source.files,
    );
    await expect(h.runner.run(changed)).rejects.toThrow();
    expect(h.open).not.toHaveBeenCalled();
  });

  it.each(HOST_REPAIR_SEED_STEPS.map(([step]) => step))(
    "stops after the first failed %s command",
    async (step) => {
      const f = hostExecutionFixture();
      const h = harness(f, {
        execute: (_session, command) =>
          command.step === step ? result("", { exitCode: 1 }) : undefined,
      });
      const observation = await h.runner.run(f.request);
      expect(observation.state).toBe("failed");
      expect(observation.steps.at(-1)?.step).toBe(step);
      expect(observation.steps.at(-1)?.state).toBe("failed");
      expect(h.events.at(-1)).toBe("dispose:1");
      expect(h.events).not.toContain("collect:1");
      expect(h.open).toHaveBeenCalledTimes(1);
      expect(observation.artifacts).toEqual([]);
    },
  );

  it("records only the exact intended invalid control as a failed tool observation", async () => {
    const f = hostExecutionFixture(true);
    const h = harness(f, {
      execute: (_session, command) =>
        command.step === "typecheck"
          ? result(diagnostic(f), { exitCode: 2 })
          : undefined,
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("failed");
    expect(observation.diagnostics.map((item) => item.code)).toContain(
      "application.host-repair-seed.observed-ts2322",
    );
    expect(observation.diagnostics[0]?.references.path).toBe(
      f.request.source.extensionPath,
    );
    expect(canonicalJson(observation)).not.toContain(
      "Type 'string' is not assignable",
    );
    expect(observation.artifacts).toEqual([]);
    expect(h.events).toEqual([
      "open:1",
      "1:install",
      "1:lint",
      "1:typecheck",
      "dispose:1",
    ]);
  });

  it("denies invalid seed success with no actual expected defect", async () => {
    const f = hostExecutionFixture(true);
    const h = harness(f);
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(observation.diagnostics.map((item) => item.code)).toContain(
      "application.host-repair-seed.expected-defect-absent",
    );
    expect(h.events).not.toContain("collect:1");
  });

  it.each(["timeout", "cancelled", "output-limit", "unavailable"] as const)(
    "does not turn %s into an intended defect",
    async (termination) => {
      const f = hostExecutionFixture(true);
      const h = harness(f, {
        execute: (_session, command) =>
          command.step === "typecheck"
            ? result(diagnostic(f), { termination, exitCode: null })
            : undefined,
      });
      const observation = await h.runner.run(f.request);
      expect(observation.state).not.toBe("passed");
      expect(observation.diagnostics.map((item) => item.code)).not.toContain(
        "application.host-repair-seed.observed-ts2322",
      );
      expect(observation.cleanup).toBe("verified");
    },
  );

  it.each([
    "not-json",
    "{}",
    '{"numPassedTests":0}',
    '{"numPassedTests":2}',
    '{"numPassedTests":2,"numFailedTests":-1,"numPendingTests":0}',
    '{"numPassedTests":2,"numFailedTests":0,"numPendingTests":0.5}',
    '{"numPassedTests":2,"numFailedTests":"0","numPendingTests":0}',
    '{"numPassedTests":2,"numPendingTests":1}',
    '{"numPassedTests":2,"numFailedTests":1}',
  ])("requires genuine nonempty passing test summaries: %s", async (stdout) => {
    const f = hostExecutionFixture();
    const h = harness(f, {
      execute: (_session, command) =>
        command.step === "unit-tests" ? result(stdout) : undefined,
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(h.events).not.toContain("1:contract-tests");
    expect(observation.artifacts).toEqual([]);
  });

  it.each([
    "not-json",
    "{}",
    '{"Results":[{"Vulnerabilities":[{"VulnerabilityID":"CVE-2026-1234","Severity":"HIGH","PkgName":"example-runtime"}]}]}',
  ])("rejects malformed or blocking actual scan output: %s", async (stdout) => {
    const f = hostExecutionFixture();
    const h = harness(f, {
      execute: (_session, command) =>
        command.step === "dependency-scan" ? result(stdout) : undefined,
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).not.toBe("passed");
    expect(h.events).not.toContain("1:compile");
    expect(observation.artifacts).toEqual([]);
  });

  it("rejects incorrect tool byte accounting", async () => {
    const f = hostExecutionFixture();
    const h = harness(f, {
      execute: () => result("content", { outputBytes: 0 }),
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(observation.steps).toEqual([]);
    expect(observation.cleanup).toBe("verified");
  });

  const mutations: readonly [
    string,
    (files: ApplicationBuildProducedFile[]) => ApplicationBuildProducedFile[],
  ][] = [
    [
      "missing extension",
      (files) =>
        files.filter((file) => !file.path.endsWith("/extensions/custom.js")),
    ],
    [
      "unreviewed output",
      (files) => [
        ...files,
        {
          path: "application/dist/other.js",
          kind: "regular-file",
          bytes: Buffer.from("x"),
        },
      ],
    ],
    [
      "symlink",
      (files) =>
        files.map((file, index) =>
          index === 0 ? { ...file, kind: "symlink" } : file,
        ),
    ],
    ["duplicate", (files) => [...files, ...files.slice(0, 1)]],
    [
      "portable alias",
      (files) => [
        ...files,
        ...files
          .slice(0, 1)
          .map((file) => ({ ...file, path: file.path.toUpperCase() })),
      ],
    ],
    [
      "map",
      (files) => [
        ...files,
        {
          path: "application/node_modules/example/index.js.map",
          kind: "regular-file",
          bytes: Buffer.from("x"),
        },
      ],
    ],
    [
      "missing package metadata",
      (files) =>
        files.filter(
          (file) =>
            !file.path.startsWith("application/node_modules/") ||
            !file.path.endsWith("/package.json"),
        ),
    ],
    [
      "wrong package identity",
      (files) =>
        files.map((file) =>
          file.path.startsWith("application/node_modules/") &&
          file.path.endsWith("/package.json")
            ? {
                ...file,
                bytes: Buffer.from('{"name":"wrong","version":"1.0.0"}'),
              }
            : file,
        ),
    ],
    [
      "oversized file",
      (files) =>
        files.map((file, index) =>
          index === 0
            ? { ...file, bytes: Buffer.alloc(1024 * 1024 + 1) }
            : file,
        ),
    ],
    [
      "parent traversal",
      (files) => [
        ...files,
        { path: "../output", kind: "regular-file", bytes: Buffer.from("x") },
      ],
    ],
  ];
  it.each(mutations)(
    "denies produced %s before artifacts",
    async (_label, mutate) => {
      const f = hostExecutionFixture();
      const h = harness(f, { output: (_session, files) => mutate(files) });
      const observation = await h.runner.run(f.request);
      expect(observation.state).toBe("error");
      expect(observation.artifacts).toEqual([]);
      expect(observation.cleanup).toBe("verified");
      expect(h.open).toHaveBeenCalledTimes(1);
    },
  );

  it("compares independently collected ZIP bytes", async () => {
    const f = hostExecutionFixture();
    const h = harness(f, { output: (session) => produced(f, String(session)) });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("failed");
    expect(observation.reproducibility.state).toBe("not-established");
    expect(observation.artifacts).toEqual([]);
    expect(h.events.filter((event) => event.startsWith("dispose:"))).toEqual([
      "dispose:1",
      "dispose:2",
    ]);
  });

  it("does not hide a failed second command matrix behind the first successful run", async () => {
    const f = hostExecutionFixture();
    const h = harness(f, {
      execute: (session, command) =>
        session === 2 && command.step === "typecheck"
          ? result("", { exitCode: 2 })
          : undefined,
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("failed");
    expect(observation.artifacts).toEqual([]);
    expect(observation.diagnostics.map((item) => item.code)).toContain(
      "application.host-repair-seed.reproduction-failed",
    );
    expect(h.events).not.toContain("2:unit-tests");
  });

  it("does not open an already cancelled run", async () => {
    const f = hostExecutionFixture();
    const h = harness(f);
    const abort = new AbortController();
    abort.abort();
    const observation = await h.runner.run(f.request, { signal: abort.signal });
    expect(observation.state).toBe("cancelled");
    expect(observation.cleanup).toBe("verified");
    expect(h.open).not.toHaveBeenCalled();
  });

  it("disposes a session whose initialization completed after cancellation", async () => {
    const f = hostExecutionFixture();
    const abort = new AbortController();
    const h = harness(f, {
      opened: () => {
        abort.abort();
      },
    });
    const observation = await h.runner.run(f.request, { signal: abort.signal });
    expect(observation.state).toBe("cancelled");
    expect(h.events).toEqual(["open:1", "dispose:1"]);
    expect(h.signals[0]?.aborted).toBe(true);
    expect(observation.cleanup).toBe("verified");
  });

  it("propagates cancellation during output collection and still disposes", async () => {
    const f = hostExecutionFixture();
    const abort = new AbortController();
    const h = harness(f, {
      output: (_session, files) => {
        abort.abort();
        return files;
      },
    });
    const observation = await h.runner.run(f.request, { signal: abort.signal });
    expect(observation.state).toBe("cancelled");
    expect(observation.artifacts).toEqual([]);
    expect(h.events.at(-1)).toBe("dispose:1");
    expect(h.signals[0]?.aborted).toBe(true);
  });

  it("uses one monotonic deadline across the second session", async () => {
    const f = hostExecutionFixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = harness(f, {
      execute: (session, command) => {
        if (session === 2 && command.step === "install")
          now = f.request.limits.wallTimeMilliseconds + 1;
        return undefined;
      },
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(h.events.at(-1)).toBe("dispose:2");
    expect(h.events).not.toContain("2:lint");
    expect(observation.artifacts).toEqual([]);
    expect(observation.cleanup).toBe("verified");
  });

  it("finishes cleanup after the deadline without returning success", async () => {
    const f = hostExecutionFixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const h = harness(f, {
      disposed: () => {
        now = f.request.limits.wallTimeMilliseconds + 1;
      },
    });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(observation.cleanup).toBe("verified");
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(observation.artifacts).toEqual([]);
  });

  it.each([1, 2])(
    "does not pass if cleanup of session %i fails",
    async (failing) => {
      const f = hostExecutionFixture();
      const h = harness(f, {
        disposed: (session) => {
          if (session === failing) throw Error("UNRETAINED-RAW-ERROR");
        },
      });
      const observation = await h.runner.run(f.request);
      expect(observation.state).toBe("error");
      expect(observation.cleanup).toBe("not-established");
      expect(observation.artifacts).toEqual([]);
      expect(canonicalJson(observation)).not.toContain("UNRETAINED-RAW-ERROR");
    },
  );
});

describe("exact direct runtime package identity at its root", () => {
  function multiversion() {
    const f = hostExecutionFixture();
    const direct = f.envelope.contract.dependencies.find(
      (dependency) => dependency.kind === "runtime",
    );
    if (direct === undefined)
      throw Error("Fixed scaffold needs a direct runtime dependency.");
    const { name: directName, version: directVersion } = direct;
    const first = f.request.dependencyLock.packages.find(
      (dependency) =>
        dependency.kind === "runtime" &&
        dependency.name === directName &&
        dependency.version === directVersion,
    );
    if (first === undefined)
      throw Error("Expected admitted direct dependency in the fixture lock.");
    const alternate = applicationDependencyLockPackageV1Schema.parse({
      ...first,
      kind: "transitive-runtime",
      version: "0.0.1",
      tarballDigest: sha256Digest("synthetic alternate transitive tarball"),
    });
    if (alternate.version === directVersion)
      throw Error("Versions must differ for the regression.");
    f.request.dependencyLock.packages.push(alternate);
    f.request.dependencyLock.packages.sort((a, b) => {
      const left = a.name + "\0" + a.version;
      const right = b.name + "\0" + b.version;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    // This synthetic config shares the request lock. Prove legitimate input
    // admission before testing either layout; the frozen envelope is unchanged.
    expect(
      inspectApplicationHostRepairSeedRequestV1(f.request, f.config).request
        .dependencyLock.packages,
    ).toEqual(f.request.dependencyLock.packages);
    const top = `application/node_modules/${directName}`;
    const parent =
      f.envelope.contract.dependencies.find(
        (dependency) =>
          dependency.kind === "runtime" && dependency.name !== directName,
      )?.name ?? directName;
    const nested = `application/node_modules/${parent}/node_modules/${directName}`;
    function layout(swapped: boolean): ApplicationBuildProducedFile[] {
      const files = produced(f).filter(
        (file) => !file.path.startsWith(top + "/"),
      );
      for (const [root, version] of [
        [top, swapped ? alternate.version : directVersion],
        [nested, swapped ? directVersion : alternate.version],
      ] as const) {
        files.push({
          kind: "regular-file",
          path: root + "/package.json",
          bytes: Buffer.from(canonicalJson({ name: directName, version })),
        });
        files.push({
          kind: "regular-file",
          path: root + "/index.js",
          bytes: Buffer.from("// synthetic multi-version dependency\n"),
        });
      }
      return files;
    }
    return { f, layout };
  }

  it("denies allowed versions swapped between direct and nested roots", async () => {
    const { f, layout } = multiversion();
    const h = harness(f, { output: () => layout(true) });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("error");
    expect(observation.artifacts).toEqual([]);
    expect(observation.cleanup).toBe("verified");
    expect(h.events).toContain("collect:1");
    expect(h.events.at(-1)).toBe("dispose:1");
    expect(h.open).toHaveBeenCalledTimes(1);
  });

  it("admits the exact direct version with a different allowed version nested", async () => {
    const { f, layout } = multiversion();
    const h = harness(f, { output: () => layout(false) });
    const observation = await h.runner.run(f.request);
    expect(observation.state).toBe("passed");
    expect(observation.cleanup).toBe("verified");
    expect(observation.reproducibility.state).toBe("verified");
    expect(h.open).toHaveBeenCalledTimes(2);
    expect(h.events.filter((event) => event.startsWith("dispose:"))).toEqual([
      "dispose:1",
      "dispose:2",
    ]);
  });
});
