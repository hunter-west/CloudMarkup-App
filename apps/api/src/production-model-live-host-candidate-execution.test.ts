import { describe, expect, it } from "vitest";
import {
  applicationBuildSourceTreeDigest,
  applicationLambdaArtifactManifestV1Schema,
  canonicalJson,
  sha256Digest,
} from "@cloudmarkup/application-build-runner";
import {
  applicationHostRepairCandidateBuildResultV1Schema,
  applicationHostRepairCandidateManifestV1Schema,
  applicationHostRepairSeedBuildRequestV1Schema,
  applicationHostRepairSeedBuildResultV1Schema,
  createApplicationHostRepairCandidateRunner,
  inspectApplicationHostRepairCandidateRequestV1,
  inspectApplicationHostRepairCandidateResultV1,
} from "@cloudmarkup/application-build-runner/host-repair-seed";
import { hostCandidateExecutionFixture as fixture } from "./production-model-live-host-candidate-test-helpers.js";
import {
  createHostExecutionHarness,
  produced,
  result,
  type Hooks,
} from "./production-model-live-host-runner-test-helpers.js";

function harness(f: ReturnType<typeof fixture>, hooks: Hooks = {}) {
  const h = createHostExecutionHarness(f, hooks);
  return {
    ...h,
    runner: createApplicationHostRepairCandidateRunner({
      executor: h.executor,
      config: f.config,
    }),
  };
}
describe("explicit bound host repair candidate runner", () => {
  it("runs the changed extension twice and produces distinct host-only artifacts", async () => {
    const f = fixture(),
      h = harness(f);
    expect(f.request.source.files).not.toEqual(
      f.base.source.positiveControl.files,
    );
    const admitted = inspectApplicationHostRepairCandidateRequestV1(
      f.request,
      f.config,
    );
    expect(admitted.bindings.baseSeedRequestDigest).not.toBe(
      admitted.bindings.requestDigest,
    );
    const output = await h.runner.run(f.request);
    expect(output.state).toBe("passed");
    expect(output.cleanup).toBe("verified");
    expect(output.reproducibility.state).toBe("verified");
    expect(output.steps).toHaveLength(9);
    expect(h.events.filter((e) => e.startsWith("open:"))).toHaveLength(2);
    expect(h.events.filter((e) => e.startsWith("dispose:"))).toHaveLength(2);
    expect(output.artifacts).toHaveLength(3);
    expect(output.artifacts.map((file) => file.ownership)).toEqual(
      Array(3).fill("host-repair-candidate-validation-artifact"),
    );
    const artifact = output.artifacts.find(
      (a) => a.mediaType === "application/json",
    );
    if (artifact === undefined) throw Error("Missing manifest.");
    const manifest: unknown = JSON.parse(
      Buffer.from(artifact.bytesBase64, "base64").toString("utf8"),
    );
    expect(
      applicationHostRepairCandidateManifestV1Schema.parse(manifest).bindings,
    ).toEqual(admitted.bindings);
    expect(
      applicationLambdaArtifactManifestV1Schema.safeParse(manifest).success,
    ).toBe(false);
    expect(
      applicationHostRepairSeedBuildRequestV1Schema.safeParse(f.request)
        .success,
    ).toBe(false);
    expect(
      applicationHostRepairSeedBuildResultV1Schema.safeParse(output).success,
    ).toBe(false);
    expect(
      inspectApplicationHostRepairCandidateResultV1(
        output,
        f.request,
        f.config,
      ),
    ).toEqual(output);
  });
  it.each([
    "generated-file",
    "dependency",
    "lineage",
    "profile",
    "base",
    "checksum",
    "ownership",
    "path",
    "bytes",
    "policy",
    "extra",
  ] as const)("rejects %s before opening any workspace", async (kind) => {
    const f = fixture();
    if (kind === "generated-file") {
      const file = f.request.source.files.find(
        (file) => file.ownership === "generated",
      );
      if (file === undefined) throw Error("Missing generated source.");
      file.content += "\n// changed\n";
      file.checksum = sha256Digest(file.content);
      f.request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
        f.request.source.files,
      );
    }
    if (kind === "dependency")
      f.request.dependencyLock.lockfileContent += "changed";
    if (kind === "lineage")
      f.request.source.lineage.responseDigest = sha256Digest("foreign");
    if (kind === "profile")
      Object.assign(f.request.profile, f.base.request.profile);
    if (kind === "base") f.config.lineage.baseDigest = sha256Digest("foreign");
    const file = f.request.source.files.find(
      (file) => file.path === f.base.source.extensionPath,
    );
    if (file === undefined) throw Error("Missing extension.");
    if (kind === "checksum") file.content += "\n// unbound\n";
    if (kind === "ownership") file.ownership = "generated";
    if (kind === "path") f.request.source.files.push({ ...file });
    if (kind === "bytes") {
      file.content = " ".repeat(f.request.limits.maxFileBytes + 1);
      file.checksum = sha256Digest(file.content);
      f.request.source.extensionContentDigest = file.checksum;
      f.request.source.sourceTreeDigest = applicationBuildSourceTreeDigest(
        f.request.source.files,
      );
    }
    if (kind === "policy")
      f.config.policy.container.digest = sha256Digest("foreign image");
    if (kind === "extra") Object.assign(f.request, { execute: "arbitrary" });
    const h = harness(f);
    await expect(h.runner.run(f.request)).rejects.toThrow("not admitted");
    expect(h.open).not.toHaveBeenCalled();
  });
  it.each([
    "type-failure",
    "empty-tests",
    "scanner",
    "cleanup",
    "different-zip",
  ] as const)("does not accept %s as validated output", async (kind) => {
    const f = fixture();
    const h = harness(f, {
      execute: (_, command) => {
        if (kind === "type-failure" && command.step === "typecheck")
          return result("", { exitCode: 2 });
        if (kind === "empty-tests" && command.step === "unit-tests")
          return result(
            '{"numFailedTests":0,"numPassedTests":0,"numPendingTests":0}',
          );
        if (kind === "scanner" && command.step === "secret-scan")
          return result("invalid scanner output");
        return undefined;
      },
      disposed: () => {
        if (kind === "cleanup") throw Error("synthetic cleanup denial");
      },
      output: (session, files) =>
        kind === "different-zip" ? produced(f, String(session)) : files,
    });
    const output = await h.runner.run(f.request);
    expect(output.state).not.toBe("passed");
    expect(output.artifacts).toEqual([]);
    expect(output.reproducibility.state).toBe("not-established");
    expect(
      output.diagnostics.every((d) => !d.code.endsWith("observed-ts2322")),
    ).toBe(true);
  });
  it("rejects rehashed result lineage substitution and fabricated success", async () => {
    const f = fixture(),
      h = harness(f),
      output = await h.runner.run(f.request);
    const { reportDigest: originalDigest, ...changed } =
      structuredClone(output);
    expect(originalDigest).toMatch(/^sha256:/u);
    changed.bindings.repairLineageDigest = sha256Digest("foreign");
    const forged = {
      ...changed,
      reportDigest: sha256Digest(canonicalJson(changed)),
    };
    expect(() =>
      inspectApplicationHostRepairCandidateResultV1(
        forged,
        f.request,
        f.config,
      ),
    ).toThrow("not admitted");
    const { reportDigest: secondDigest, ...empty } = structuredClone(output);
    expect(secondDigest).toMatch(/^sha256:/u);
    empty.tests = [];
    expect(
      applicationHostRepairCandidateBuildResultV1Schema.safeParse({
        ...empty,
        reportDigest: sha256Digest(canonicalJson(empty)),
      }).success,
    ).toBe(false);
  });
});
