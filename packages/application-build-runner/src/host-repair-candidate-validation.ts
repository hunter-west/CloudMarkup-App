import { applicationBuildSourceTreeDigest } from "./contracts.js";
import type { ApplicationHostRepairSeedBuildRequestV1 } from "./host-repair-seed-contracts.js";
import type { ApplicationHostRepairCandidateBuildResultV1 } from "./host-repair-candidate-contracts.js";
import {
  canonicalJson,
  contentSecurityIssue,
  sha256Digest,
  sourcePathIssue,
} from "./security.js";

function exact(value: boolean): asserts value {
  if (!value) throw new Error("The bounded host candidate does not match.");
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Source = Pick<
  ApplicationHostRepairSeedBuildRequestV1["source"],
  "files" | "extensionPath" | "extensionContentDigest" | "sourceTreeDigest"
>;

/** Both stages may change only the one extension of their separately admitted predecessor. */
export function inspectBoundHostRepairSource(
  source: Source,
  base: Source,
  limits: ApplicationHostRepairSeedBuildRequestV1["limits"],
  metadata: Readonly<Record<string, unknown>>,
): void {
  const file = source.files.find((item) => item.path === base.extensionPath);
  exact(
    file?.ownership === "user-owned" &&
      sha256Digest(file.content) === file.checksum &&
      source.extensionContentDigest === file.checksum,
  );
  const files = base.files.map((original) =>
    original.path === base.extensionPath
      ? { ...original, content: file.content, checksum: file.checksum }
      : original,
  );
  exact(
    same(source, {
      ...base,
      ...metadata,
      files,
      sourceTreeDigest: applicationBuildSourceTreeDigest(files),
      extensionContentDigest: file.checksum,
    }),
  );
  let total = 0;
  for (const item of source.files) {
    const bytes = Buffer.byteLength(item.content, "utf8");
    total += bytes;
    exact(
      bytes <= limits.maxFileBytes &&
        sha256Digest(item.content) === item.checksum &&
        sourcePathIssue(item.path) === undefined &&
        contentSecurityIssue(item.content) === undefined,
    );
  }
  exact(
    source.files.length <= limits.maxFiles && total <= limits.maxTotalFileBytes,
  );
}

/** Structural rejoin only. The runner and private journal own execution provenance. */
export function inspectBoundHostRepairResult(
  result: Pick<
    ApplicationHostRepairCandidateBuildResultV1,
    "bindings" | "state" | "artifacts" | "steps" | "diagnostics"
  >,
  admitted: {
    readonly bindings: unknown;
    readonly request: Pick<
      ApplicationHostRepairSeedBuildRequestV1,
      "limits" | "solutionRevision"
    >;
    readonly originalBuildContract: {
      readonly contract: {
        readonly expectedArtifact: { readonly path: string };
      };
    };
  },
): void {
  exact(same(result.bindings, admitted.bindings));
  const path = admitted.originalBuildContract.contract.expectedArtifact.path;
  const expected = [
    { path, mediaType: "application/zip" },
    {
      path: path.replace(/\/function\.zip$/u, "/artifact-manifest.json"),
      mediaType: "application/json",
    },
    {
      path: path
        .replace("application/artifacts/", "application/evidence/")
        .replace(/\/function\.zip$/u, "/sbom.cdx.json"),
      mediaType: "application/vnd.cyclonedx+json",
    },
  ];
  if (result.state === "passed")
    exact(
      same(
        result.artifacts.map(({ path, mediaType }) => ({ path, mediaType })),
        expected,
      ),
    );
  exact(
    result.artifacts.reduce((n, file) => n + file.sizeBytes, 0) <=
      admitted.request.limits.maxArtifactBytes &&
      result.steps.every(
        (step) => step.outputBytes <= admitted.request.limits.maxOutputBytes,
      ) &&
      result.diagnostics.every(
        (item) =>
          item.references.solutionRevisionId ===
          admitted.request.solutionRevision.solutionRevisionId,
      ),
  );
}
