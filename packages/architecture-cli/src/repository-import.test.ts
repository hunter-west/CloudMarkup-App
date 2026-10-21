import { rm } from "node:fs/promises";

import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws";
import {
  createRepositoryImportService,
  hclInspectionResultV1Schema,
  repositoryImportRequestV1Schema,
  type HCLInspectionResultV1,
} from "@cloudmarkup/repository-importer";
import { describe, expect, it } from "vitest";

import { ARCHITECTURE_CLI_EXIT_CODES } from "./contracts.js";
import { createArchitectureCliRepositoryImportPort } from "./repository-import.js";
import { repositorySourceInputs } from "./repository.js";
import {
  createArchitectureCliService,
  type ArchitectureCliPipelineV1,
} from "./service.js";
import {
  architectureCliFixtureArtifact,
  architectureCliFixtureSnapshot,
  writeArchitectureCliFixtureRepository,
} from "./test-fixtures.js";

const emptyHcl: HCLInspectionResultV1 = hclInspectionResultV1Schema.parse({
  contractVersion: 1,
  parser: {
    id: "cloudmarkup.terraform-hcl-inspector",
    version: "1.0.0",
  },
  succeeded: true,
  diagnostics: [],
  blocks: [],
});

function pipeline(): ArchitectureCliPipelineV1 {
  const result = {
    artifact: architectureCliFixtureArtifact(),
    diagnostics: [],
    evidence: { current: 0, failed: 0, stale: 0, unavailableLevels: [] },
    semanticSnapshot: architectureCliFixtureSnapshot(),
    state: "ready" as const,
  };
  return {
    inspect: () => Promise.resolve(result),
    run: () => Promise.resolve(result),
  };
}

function importer() {
  return createArchitectureCliRepositoryImportPort({
    importer: createRepositoryImportService({
      hclInspector: { inspect: () => Promise.resolve(emptyHcl) },
    }),
    request({ repository }) {
      const source = repositorySourceInputs(repository);
      return repositoryImportRequestV1Schema.parse({
        contractVersion: 1,
        profile: {
          contractVersion: 1,
          profileId: "cloudmarkup.repository-import.cli",
          profileVersion: "1.0.0",
          importedAt: source.solutionRevision.createdAt,
          commitSha: source.lock.solutionRevision.digest.slice(7),
          snapshotId: "snapshot.cli.1",
          observedSolutionId: "observed.cli.1",
          sourceId: "repository.local.cli",
          sourceDescriptor: "cloudmarkup-cli-local-source",
          selectedPaths: ["."],
          limits: {
            maximumFileCount: 4_096,
            maximumFileBytes: 8 * 1024 * 1024,
            maximumTotalBytes: 128 * 1024 * 1024,
          },
        },
        approvedArchitecture: source.documents.architectureDocument,
        solutionRevision: source.solutionRevision,
        catalog: awsCatalogArtifactV1,
      });
    },
  });
}

describe("architecture CLI repository importer commands", () => {
  it.each([
    "import",
    "inspect-repository",
    "compare",
    "verify-repository",
  ] as const)(
    "runs %s without mutating approved repository files",
    async (command) => {
      const root = await writeArchitectureCliFixtureRepository();
      try {
        const before =
          architectureCliFixtureArtifact().manifest.solutionRevision;
        const output = await createArchitectureCliService(
          pipeline(),
          importer(),
        ).execute({ command, root });
        expect(output.exitCode).toBe(ARCHITECTURE_CLI_EXIT_CODES.success);
        expect(output.repositoryImport?.snapshot.source.kind).toBe("local");
        expect(output.repositoryImport?.evidence.level).toEqual({
          rank: 8,
          kind: "repository-conformance",
        });
        expect(output.solutionRevision).toEqual(before);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
  );

  it("fails closed before presenting a tampered importer result", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    const trusted = importer();
    try {
      const output = await createArchitectureCliService(pipeline(), {
        async run(input) {
          const result = await trusted.run(input);
          return {
            ...result,
            resultDigest: ("sha256:" +
              "0".repeat(64)) as typeof result.resultDigest,
          };
        },
      }).execute({ command: "verify-repository", root });
      expect(output).toMatchObject({
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
        state: "failed",
        diagnostics: [
          { code: "cloudmarkup.cli.import-result-integrity-invalid" },
        ],
      });
      expect(output.repositoryImport).toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when no approved importer is registered", async () => {
    const root = await writeArchitectureCliFixtureRepository();
    try {
      const output = await createArchitectureCliService(pipeline()).execute({
        command: "import",
        root,
      });
      expect(output).toMatchObject({
        exitCode: ARCHITECTURE_CLI_EXIT_CODES.pipeline,
        state: "failed",
        diagnostics: [
          { code: "cloudmarkup.cli.repository-importer-unavailable" },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
