// Synthetic sessions exercise orchestration only; no native proof is claimed.
import { describe, expect, it } from "vitest";
import {
  applicationBuildSourceTreeDigest,
  applicationLambdaArtifactManifestV1Schema,
  canonicalJson,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidateBuildRequestV1Schema,
  applicationHostRepairCandidateBuildResultV1Schema,
  applicationHostRepairCandidateManifestV1Schema,
  applicationHostRepairSuccessorBuildRequestV2Schema,
  applicationHostRepairSuccessorLineageV2Schema,
  applicationHostRepairSuccessorManifestV2Schema,
  createApplicationHostRepairCandidateRunner,
  createApplicationHostRepairSuccessorRunner,
  inspectApplicationHostRepairCandidateRequestV1,
  inspectApplicationHostRepairSuccessorRequestV2,
  inspectApplicationHostRepairSuccessorResultV2,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostCandidateExecutionFixture } from "./production-model-live-host-candidate-test-helpers.js";
import {
  createHostExecutionHarness,
  produced,
  result,
} from "./production-model-live-host-runner-test-helpers.js";

async function fixture() {
  const first = hostCandidateExecutionFixture(true);
  const original = first.request.source.files.find(
    (file) => file.path === first.request.source.extensionPath,
  );
  if (original === undefined) throw Error("Missing extension.");
  const line =
    original.content
      .split("\n")
      .findIndex(
        (value) =>
          value === 'export const repairSeedTypeWitness: number = "invalid";',
      ) + 1;
  const h = createHostExecutionHarness(first, {
    execute: (_, command) =>
      command.step === "typecheck"
        ? result(
            original.path +
              "(" +
              String(line) +
              ",14): error TS2322: Type 'string' is not assignable to type 'number'.\n",
            { exitCode: 2 },
          )
        : undefined,
  });
  const observed = await createApplicationHostRepairCandidateRunner({
    config: first.config,
    executor: h.executor,
  }).run(first.request);
  expect(observed.diagnostics[0]?.code).toBe(
    "application.host-repair-seed.observed-repair-ts2322",
  );
  const predecessor = inspectApplicationHostRepairCandidateRequestV1(
    first.request,
    first.config,
  );
  const lineage = applicationHostRepairSuccessorLineageV2Schema.parse({
    baseDigest: original.checksum,
    inputDigest: sha256Digest("synthetic final input"),
    invocationId: "invocation_successor_native_fixture",
    patchDigest: sha256Digest("synthetic final patch"),
    responseDigest: sha256Digest("synthetic final response"),
    predecessorRequestDigest: predecessor.bindings.requestDigest,
    predecessorReportDigest: observed.reportDigest,
    predecessorLineageDigest: predecessor.bindings.repairLineageDigest,
  });
  const files = first.request.source.files.map((file) => {
    if (file.path !== original.path) return file;
    const content = file.content.replace(
      'repairSeedTypeWitness: number = "invalid"',
      'repairSeedTypeWitness: number = Number("1")',
    );
    return { ...file, content, checksum: sha256Digest(content) };
  });
  const request = applicationHostRepairSuccessorBuildRequestV2Schema.parse({
    ...first.request,
    contractVersion: 2,
    source: {
      ...first.request.source,
      origin: "model-successor-of-host-repair",
      lineage,
      files,
      sourceTreeDigest: applicationBuildSourceTreeDigest(files),
      extensionContentDigest: files.find((f) => f.path === original.path)
        ?.checksum,
    },
  });
  const config = {
    predecessor: first.config,
    predecessorRequest: first.request,
    predecessorResult: observed,
    lineage,
  };
  return { first, request, config, envelope: first.envelope };
}
describe("final host repair native admission", () => {
  it("executes the actual predecessor extension twice and keeps final artifacts host-only", async () => {
    const f = await fixture(),
      h = createHostExecutionHarness(f);
    const admitted = inspectApplicationHostRepairSuccessorRequestV2(
      f.request,
      f.config,
    );
    expect(f.request.source.lineage.baseDigest).not.toBe(
      f.first.base.request.source.extensionContentDigest,
    );
    expect(
      f.request.source.files.find(
        (x) => x.path === f.request.source.extensionPath,
      )?.content,
    ).toContain("first candidate retained comment");
    const output = await createApplicationHostRepairSuccessorRunner({
      config: f.config,
      executor: h.executor,
    }).run(f.request);
    expect(output.state).toBe("passed");
    expect(output.cleanup).toBe("verified");
    expect(output.reproducibility.state).toBe("verified");
    expect(output.steps).toHaveLength(9);
    expect(h.events.filter((e) => e.startsWith("open:"))).toHaveLength(2);
    expect(h.events.filter((e) => e.startsWith("dispose:"))).toHaveLength(2);
    expect(output.artifacts.map((x) => x.ownership)).toEqual(
      Array(3).fill("host-repair-candidate-validation-artifact"),
    );
    const artifact = output.artifacts.find(
      (x) => x.mediaType === "application/json",
    );
    if (artifact === undefined) throw Error("Missing manifest.");
    const manifest: unknown = JSON.parse(
      Buffer.from(artifact.bytesBase64, "base64").toString("utf8"),
    );
    expect(
      applicationHostRepairSuccessorManifestV2Schema.parse(manifest).bindings,
    ).toEqual(admitted.bindings);
    expect(
      applicationHostRepairCandidateManifestV1Schema.safeParse(manifest)
        .success,
    ).toBe(false);
    expect(
      applicationLambdaArtifactManifestV1Schema.safeParse(manifest).success,
    ).toBe(false);
    expect(
      applicationHostRepairCandidateBuildRequestV1Schema.safeParse(f.request)
        .success,
    ).toBe(false);
    expect(
      applicationHostRepairCandidateBuildResultV1Schema.safeParse(output)
        .success,
    ).toBe(false);
    expect(
      inspectApplicationHostRepairSuccessorResultV2(
        output,
        f.request,
        f.config,
      ),
    ).toEqual(output);
    const changed = structuredClone(output);
    changed.bindings.repairLineageDigest = sha256Digest("another lineage");
    const { reportDigest: priorDigest, ...body } = changed;
    expect(priorDigest).toMatch(/^sha256:/u);
    expect(() =>
      inspectApplicationHostRepairSuccessorResultV2(
        { ...body, reportDigest: sha256Digest(canonicalJson(body)) },
        f.request,
        f.config,
      ),
    ).toThrow("not admitted");
  });
  it.each([
    "seed-base",
    "predecessor-request",
    "predecessor-result",
    "predecessor-lineage",
    "same-invocation",
    "generated-file",
    "dependency",
    "limits",
    "profile",
    "old-time",
    "unsafe",
    "extra",
    "wrong-diagnostic",
    "no-cleanup",
  ] as const)("rejects %s before any workspace opens", async (kind) => {
    const f = await fixture();
    if (kind === "seed-base")
      f.config.lineage.baseDigest =
        f.first.base.request.source.extensionContentDigest;
    if (kind === "predecessor-request")
      f.config.lineage.predecessorRequestDigest = sha256Digest("other");
    if (kind === "predecessor-result")
      f.config.lineage.predecessorReportDigest = sha256Digest("other");
    if (kind === "predecessor-lineage")
      f.config.lineage.predecessorLineageDigest = sha256Digest("other");
    if (kind === "same-invocation")
      f.config.lineage.invocationId =
        f.first.request.source.lineage.invocationId;
    f.request.source.lineage = structuredClone(f.config.lineage);
    if (kind === "generated-file" || kind === "unsafe") {
      const file = f.request.source.files.find((x) =>
        kind === "generated-file"
          ? x.ownership === "generated"
          : x.path === f.request.source.extensionPath,
      );
      if (file === undefined) throw Error("Missing source.");
      file.content +=
        kind === "unsafe"
          ? "\n// /home/synthetic/private\n"
          : "\n// foreign generated file\n";
      file.checksum = sha256Digest(file.content);
      if (kind === "unsafe")
        f.request.source.extensionContentDigest = file.checksum;
      f.request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
        f.request.source.files,
      );
    }
    if (kind === "dependency")
      f.request.dependencyLock.lockfileContent += "changed";
    if (kind === "limits") f.request.limits.cpuSeconds += 1;
    if (kind === "profile") f.request.profile.digest = sha256Digest("other");
    if (kind === "old-time")
      Object.assign(f.request, { assessedAt: "2000-01-01T00:00:00.000Z" });
    if (kind === "extra") Object.assign(f.request, { execute: true });
    if (kind === "wrong-diagnostic" || kind === "no-cleanup") {
      const { reportDigest: priorDigest, ...body } = f.config.predecessorResult;
      expect(priorDigest).toMatch(/^sha256:/u);
      if (kind === "no-cleanup") body.cleanup = "not-established";
      else if (body.diagnostics[0])
        Object.assign(body.diagnostics[0], {
          code: "application.host-repair-seed.command-failed",
        });
      f.config.predecessorResult = {
        ...body,
        reportDigest: sha256Digest(canonicalJson(body)),
      };
      f.config.lineage.predecessorReportDigest =
        f.config.predecessorResult.reportDigest;
      f.request.source.lineage = structuredClone(f.config.lineage);
    }
    const h = createHostExecutionHarness(f);
    await expect(
      createApplicationHostRepairSuccessorRunner({
        config: f.config,
        executor: h.executor,
      }).run(f.request),
    ).rejects.toThrow("not admitted");
    expect(h.open).not.toHaveBeenCalled();
  });
  it.each(["cleanup", "different-zip", "empty-tests", "cancelled"] as const)(
    "retains failure for %s",
    async (kind) => {
      const f = await fixture();
      const h = createHostExecutionHarness(f, {
        execute: (_, command) =>
          kind === "empty-tests" && command.step === "unit-tests"
            ? result(
                '{"numFailedTests":0,"numPassedTests":0,"numPendingTests":0}',
              )
            : undefined,
        disposed: () => {
          if (kind === "cleanup") throw Error("synthetic cleanup failure");
        },
        output: (session, files) =>
          kind === "different-zip" ? produced(f, String(session)) : files,
      });
      const output = await createApplicationHostRepairSuccessorRunner({
        config: f.config,
        executor: h.executor,
      }).run(
        f.request,
        kind === "cancelled" ? { signal: AbortSignal.abort() } : {},
      );
      expect(output.state).not.toBe("passed");
      expect(output.artifacts).toEqual([]);
      if (kind === "cancelled") expect(h.open).not.toHaveBeenCalled();
    },
  );
});
