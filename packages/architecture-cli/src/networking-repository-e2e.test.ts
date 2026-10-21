import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  getApplicationContractsContentHash,
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  getArchitectureDocumentVisualHash,
  getExternalResourceReferenceContentHash,
  getWorkloadBehaviorContentHash,
} from "@cloudmarkup/domain";
import { edgeIdSchema, nodeIdSchema } from "@cloudmarkup/schemas";
import { describe, expect, it } from "vitest";

import { runArchitectureCliExecutable } from "./executable.js";
import { architectureCliRepositoryProfileV1Schema } from "./contracts.js";
import type { ArchitectureCliPipelineV1 } from "./service.js";
import {
  architectureCliNetworkingFixtureArtifact,
  architectureCliNetworkingGeneratedDriftArtifact,
  architectureCliNetworkingFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";
import { assertCloudMarkupWorkflowTemplate } from "./workflow-policy.js";
import { diffArchitectureCliSemanticSnapshots } from "./semantic-diff.js";
import {
  loadArchitectureRepository,
  repositorySourceInputs,
} from "./repository.js";

const profile = architectureCliRepositoryProfileV1Schema.parse({
  cli: {
    digest: `sha256:${"8".repeat(64)}`,
    id: "cloudmarkup.architecture-cli",
    version: "1.0.0",
  },
  contractVersion: 1,
  kind: "cloudmarkup.repository-verification-profile",
  paths: {
    lock: "cloudmarkup/cloudmarkup.lock.json",
    manifest: "cloudmarkup/cloudmarkup.manifest.json",
    solutionRevision: "cloudmarkup/solution.json",
  },
  pipelineProfile: {
    digest: `sha256:${"9".repeat(64)}`,
    id: "cloudmarkup.pipeline.aws-notes-v1",
    version: "1.0.0",
  },
}).pipelineProfile;

function pipeline(changed: boolean): ArchitectureCliPipelineV1 {
  return {
    inspect: () =>
      Promise.resolve({
        artifact: architectureCliNetworkingFixtureArtifact(),
        diagnostics: [],
        evidence: { current: 4, failed: 0, stale: 0, unavailableLevels: [] },
        semanticSnapshot: architectureCliNetworkingFixtureSnapshot(),
        state: "ready",
      }),
    run: () =>
      Promise.resolve({
        artifact: changed
          ? architectureCliNetworkingGeneratedDriftArtifact()
          : architectureCliNetworkingFixtureArtifact(),
        diagnostics: [],
        evidence: { current: 4, failed: 0, stale: 0, unavailableLevels: [] },
        semanticSnapshot: architectureCliNetworkingFixtureSnapshot(),
        state: "ready",
      }),
  };
}

async function execute(
  root: string,
  command: "diff" | "verify",
  changed: boolean,
) {
  let stdout = "";
  const exitCode = await runArchitectureCliExecutable({
    args: [command, "--root", root, "--format", "json"],
    registrations: [{ ...profile, pipeline: pipeline(changed) }],
    stderr: { write: () => undefined },
    stdout: {
      write(value) {
        stdout += value;
      },
    },
  });
  return { exitCode, output: JSON.parse(stdout) as Record<string, unknown> };
}

describe("AWS networking architecture-as-code repository fixture", () => {
  it("verifies the exact endpoint-based repository without drift", async () => {
    const artifact = architectureCliNetworkingFixtureArtifact();
    const root = await writeArchitectureCliFixtureRepository(artifact);
    try {
      const result = await execute(root, "verify", false);
      expect(result).toMatchObject({
        exitCode: 0,
        output: {
          command: "verify",
          fileChanges: [],
          semanticChanges: [],
          state: "succeeded",
        },
      });
      expect(artifact.files.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "cloudmarkup/architecture.json",
          "cloudmarkup/cloudmarkup.lock.json",
          "cloudmarkup/cloudmarkup.manifest.json",
          "infrastructure/main.tf",
        ]),
      );
      const terraform = await readFile(
        join(root, "infrastructure", "main.tf"),
        "utf8",
      );
      expect(terraform).toContain('resource "aws_vpc_endpoint" "s3"');
      expect(terraform).not.toMatch(
        /(?:aws_eip|credential|terraform\s+apply)/u,
      );
      const natTerraform = await readFile(
        new URL("./fixtures/aws-networking/networking-nat.tf", import.meta.url),
        "utf8",
      );
      expect(natTerraform).not.toContain('resource "aws_eip"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports locked generated-file drift and separately diffs exact endpoint and NAT revisions", async () => {
    const root = await writeArchitectureCliFixtureRepository(
      architectureCliNetworkingFixtureArtifact(),
    );
    try {
      const path = join(root, "infrastructure", "main.tf");
      const before = await readFile(path, "utf8");
      const diff = await execute(root, "diff", true);
      const verify = await execute(root, "verify", true);
      const after = await readFile(path, "utf8");

      expect(diff.exitCode).toBe(0);
      expect(diff.output).toMatchObject({
        command: "diff",
        state: "succeeded",
      });
      expect(verify.exitCode).toBe(4);
      expect(verify.output).toMatchObject({
        command: "verify",
        state: "drift",
      });
      expect(diff.output["fileChanges"]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            change: "modified",
            path: "cloudmarkup/cloudmarkup.manifest.json",
          }),
          expect.objectContaining({
            change: "modified",
            path: "infrastructure/main.tf",
          }),
        ]),
      );
      expect(diff.output["semanticChanges"]).toEqual([]);
      const changes = diffArchitectureCliSemanticSnapshots(
        architectureCliNetworkingFixtureSnapshot(),
        architectureCliNetworkingFixtureSnapshot(true),
      ) as readonly {
        readonly factId: string;
        readonly kind: string;
      }[];
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            factId: "node_nat_a",
            kind: "service-added",
          }),
          expect.objectContaining({
            factId: "node_s3_endpoint",
            kind: "service-removed",
          }),
          expect.objectContaining({
            factId: "edge_private_route_nat",
            kind: "connection-added",
          }),
          expect.objectContaining({
            factId: "edge_endpoint_private_routes",
            kind: "connection-removed",
          }),
        ]),
      );
      expect(after).toBe(before);
      expect(JSON.stringify({ diff, verify })).not.toMatch(
        /(?:token|secret|[A-Za-z]:\\|file:\/\/)/iu,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("binds both semantic snapshots to exact parsed 0.10 source revisions", async () => {
    const catalog = {
      digest:
        "sha256:17627252eb47c7f2a031ca04e90545e4775c0e0b598bd05b4fe4a0889fcd018d",
      id: "aws.cloudmarkup.notes-api-catalog",
      version: "0.10.0",
    };

    for (const changed of [false, true]) {
      const root = await writeArchitectureCliFixtureRepository(
        architectureCliNetworkingFixtureArtifact(changed),
      );
      try {
        const repository = await loadArchitectureRepository(root);
        const source = repositorySourceInputs(repository);
        const document = source.documents.architectureDocument;
        const revision = source.documents.solutionRevision;
        const snapshot = architectureCliNetworkingFixtureSnapshot(changed);
        const sourceNodes = new Map(
          document.nodes.map((node) => [node.id, node]),
        );
        const sourceEdges = new Map(
          document.edges.map((edge) => [edge.id, edge]),
        );

        expect(document.catalog).toEqual(catalog);
        expect(revision.versions.catalog).toEqual(catalog);
        expect(source.lock.tools.catalog).toEqual(catalog);
        expect(source.manifest.tools.catalog).toEqual(catalog);
        expect(revision.architecture).toMatchObject({
          contentHash: getArchitectureDocumentContentHash(document),
          documentHash: getArchitectureDocumentCanonicalHash(document),
          revisionId: document.revision.revisionId,
          visualHash: getArchitectureDocumentVisualHash(document),
        });
        expect(revision.contracts.contentHash).toBe(
          getApplicationContractsContentHash(document.applicationContracts),
        );
        expect(revision.externalResources.contentHash).toBe(
          getExternalResourceReferenceContentHash(document.externalResources),
        );
        expect(revision.workload.contentHash).toBe(
          getWorkloadBehaviorContentHash(document.workloadBehavior),
        );
        expect(source.manifest.inputs).toMatchObject({
          applicationContracts: revision.contracts.contentHash,
          architectureContent: revision.architecture.contentHash,
          architectureDocument: revision.architecture.documentHash,
          architectureVisual: revision.architecture.visualHash,
          externalResources: revision.externalResources.contentHash,
          workload: revision.workload.contentHash,
        });
        for (const service of snapshot.services) {
          expect(
            sourceNodes.get(nodeIdSchema.parse(service.id))?.semantic
              .resourceType,
          ).toBe(service.serviceType);
        }
        for (const connection of snapshot.connections) {
          expect(
            sourceEdges.get(edgeIdSchema.parse(connection.id))?.semantic,
          ).toMatchObject({
            relationshipType: connection.relationshipType,
            source: { nodeId: connection.sourceId },
            target: { nodeId: connection.targetId },
          });
        }
        expect(snapshot.solutionRevision).toEqual({
          digest: source.lock.solutionRevision.digest,
          id: revision.solutionRevisionId,
        });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });

  it("uses the same bounded credentialless workflow for networking verification", async () => {
    const template = await readFile(
      new URL("../templates/cloudmarkup-validate.yml", import.meta.url),
      "utf8",
    );
    const source = await readFile(
      new URL(
        "./fixtures/aws-networking/.github/workflows/cloudmarkup-validate.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toBe(template);
    expect(() => {
      assertCloudMarkupWorkflowTemplate(source);
    }).not.toThrow();
    expect(source).toContain("permissions:\n  contents: read");
    expect(source).toContain("cloudmarkup verify --format json");
    expect(source).toMatch(/cloudmarkup\s+diff --format json/u);
    expect(source).not.toMatch(
      /(?:id-token:\s*write|secrets\.|AWS_|terraform\s+(?:plan|apply|destroy)|pull_request_target)/u,
    );
  });
});
