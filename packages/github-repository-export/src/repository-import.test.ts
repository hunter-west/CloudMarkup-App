import { createNotesGenerationRequest } from "@cloudmarkup/application-generator/testing";
import { awsCatalogArtifactV1 } from "@cloudmarkup/provider-aws";
import {
  createRepositoryImportService,
  hclInspectionResultV1Schema,
  type RepositoryImportResultV1,
} from "@cloudmarkup/repository-importer";
import {
  modelRepositoryInterpretationResponseV1Schema,
  type Sha256Digest,
} from "@cloudmarkup/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  FakeGitHubAppAdapter,
  FakeGitHubRepositoryImportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubRepositoryImportProgressSink,
} from "./fakes.js";
import {
  gitHubInstallationRecordSchema,
  gitHubRepositoryRecordSchema,
  type GitHubRepositoryRecord,
} from "./contracts.js";
import { createMaterializedRepositoryImportRunner } from "./repository-import-runner.js";
import {
  createGitHubRepositoryImportService,
  type GitHubRepositoryCanonicalReconciler,
  type GitHubRepositoryImportContextPort,
  type GitHubRepositoryImportRunner,
  type GitHubRepositoryInterpretationPort,
  type GitHubRepositoryRegenerationPort,
} from "./repository-import.js";

const ORGANIZATION_ID = "organization.1";
const PROJECT_ID = "project.1";
const PRINCIPAL_ID = "principal.1";
const INTEGRATION_ID = "integration.github.1";
const INSTALLATION_ID = 101;
const REPOSITORY_ID = 202;
const AT = new Date("2026-08-25T12:00:00.000Z");
const DIGEST = `sha256:${"a".repeat(64)}` as Sha256Digest;

function context(): GitHubRepositoryImportContextPort {
  const generated = createNotesGenerationRequest({
    mode: "complete-supported-pattern",
  });
  return {
    load: () =>
      Promise.resolve({
        approvedArchitecture: generated.architectureDocument,
        catalog: awsCatalogArtifactV1,
        contractVersion: 1,
        solutionRevision: generated.solutionRevision,
      }),
  };
}

const hcl = hclInspectionResultV1Schema.parse({
  blocks: [
    {
      attributes: [
        {
          expressionDigest: DIGEST,
          expressionKind: "literal",
          name: "name",
          range: {
            endColumn: 20,
            endLine: 2,
            startColumn: 3,
            startLine: 2,
          },
          references: [],
        },
      ],
      blockPath: ["resource", "aws_dynamodb_table", "notes"],
      labels: ["aws_dynamodb_table", "notes"],
      range: {
        endColumn: 2,
        endLine: 3,
        startColumn: 1,
        startLine: 1,
      },
      type: "resource",
    },
  ],
  contractVersion: 1,
  diagnostics: [],
  parser: {
    id: "cloudmarkup.terraform-hcl-inspector",
    version: "1.0.0",
  },
  succeeded: true,
});

function repository(): GitHubRepositoryRecord {
  return gitHubRepositoryRecordSchema.parse({
    archived: false,
    defaultBranch: "main",
    disabled: false,
    installationId: INSTALLATION_ID,
    integrationId: INTEGRATION_ID,
    name: "customer-repository",
    nodeId: "R_repo",
    organizationId: ORGANIZATION_ID,
    owner: "example-org",
    private: true,
    pushedAt: "2026-08-25T11:00:00.000Z",
    repositoryId: REPOSITORY_ID,
    updatedAt: AT.toISOString(),
  });
}

async function system(options: {
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  readonly runner?: GitHubRepositoryImportRunner;
}) {
  const github = new FakeGitHubAppAdapter();
  github.addInstallation({
    accountId: 1,
    accountLogin: "example-org",
    accountType: "Organization",
    installationId: INSTALLATION_ID,
    permissions: {
      contents: "read",
      metadata: "read",
      pullRequests: "none",
      workflows: "none",
    },
    repositorySelection: "selected",
    suspended: false,
  });
  github.addRepository(
    {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: INSTALLATION_ID,
      name: "customer-repository",
      nodeId: "R_repo",
      owner: "example-org",
      ownerId: 1,
      private: true,
      pushedAt: AT.toISOString(),
      repositoryId: REPOSITORY_ID,
    },
    {
      main: options.files ?? {
        ".env": "TOKEN=must-not-be-read",
        "application/index.ts":
          'export const token = "secret-value";\nexport const handler = () => token;\n',
        "infrastructure/main.tf":
          'resource "aws_dynamodb_table" "notes" {\n  name = "notes"\n}\n',
        "infrastructure/template.json": JSON.stringify({
          Resources: {
            NotesTable: {
              Properties: { TableName: "notes" },
              Type: "AWS::DynamoDB::Table",
            },
          },
        }),
        "assets/logo.png": new Uint8Array([0, 1, 2]),
      },
    },
  );
  const installation = gitHubInstallationRecordSchema.parse({
    accountId: 1,
    accountLogin: "example-org",
    accountType: "Organization",
    createdAt: AT.toISOString(),
    installationId: INSTALLATION_ID,
    integrationId: INTEGRATION_ID,
    organizationId: ORGANIZATION_ID,
    permissions: {
      contents: "read",
      metadata: "read",
      pullRequests: "none",
      workflows: "none",
    },
    repositorySelection: "selected",
    status: "connected",
    updatedAt: AT.toISOString(),
  });
  const repositoryRecord = repository();
  const directory = {
    getInstallation: () => Promise.resolve(installation),
    getRepository: () => Promise.resolve(repositoryRecord),
  };
  const store = new FakeGitHubRepositoryImportStore();
  const audit = new RecordingGitHubExportAuditSink();
  const progress = new RecordingGitHubRepositoryImportProgressSink();
  const reconcilerCalls: Parameters<
    GitHubRepositoryCanonicalReconciler["review"]
  >[0][] = [];
  const reconciler: GitHubRepositoryCanonicalReconciler = {
    review(input) {
      reconcilerCalls.push(structuredClone(input));
      return Promise.resolve({
        designChanged: input.decision === "accept-into-design",
        receiptId: `review.${String(reconcilerCalls.length)}`,
      });
    },
  };
  const regenerationCalls: Parameters<
    GitHubRepositoryRegenerationPort["createExportPreview"]
  >[0][] = [];
  const regeneration: GitHubRepositoryRegenerationPort = {
    createExportPreview(input) {
      regenerationCalls.push(structuredClone(input));
      return Promise.resolve({ exportPreviewId: "githubpreview.regenerate.1" });
    },
  };
  let nextId = 0;
  const serviceOptions = {
    audit,
    clock: () => AT,
    context: context(),
    directory,
    github,
    id: () => String(++nextId),
    importer:
      options.runner ??
      createMaterializedRepositoryImportRunner(
        createRepositoryImportService({
          hclInspector: { inspect: () => Promise.resolve(hcl) },
        }),
      ),
    progress,
    reconciler,
    regeneration,
    store,
  };
  const service = createGitHubRepositoryImportService(serviceOptions);
  const branch = await github.withRepositoryReadSession(
    { installationId: INSTALLATION_ID, repositoryIds: [REPOSITORY_ID] },
    async (session) => {
      const descriptor = (await session.listRepositories())[0];
      if (descriptor === undefined) throw new Error("Repository missing.");
      const value = (await session.listBranches(descriptor))[0];
      if (value === undefined) throw new Error("Branch missing.");
      return value;
    },
  );
  github.requestedSessions.length = 0;
  return {
    audit,
    branch,
    directory,
    github,
    progress,
    reconcilerCalls,
    regenerationCalls,
    service,
    serviceOptions,
    store,
  };
}

function request(commitSha: string, idempotencyKey = "import-key") {
  return {
    branch: "main",
    commitSha,
    contractVersion: 1 as const,
    correlationId: "correlation.1",
    idempotencyKey,
    ignoredPaths: ["docs/private"],
    integrationId: INTEGRATION_ID,
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    requestedMode: "professional" as const,
    selectedPaths: ["."],
    trigger: "manual" as const,
  };
}

function interpretationResponse(input: {
  readonly digest: Sha256Digest;
  readonly evidenceId: string;
  readonly grounded?: boolean;
  readonly path: string;
}) {
  const referenceId =
    input.grounded === false ? "evidence.invented" : input.evidenceId;
  return modelRepositoryInterpretationResponseV1Schema.parse({
    claims: [
      {
        category: "connection",
        claimId: "claim.application.connection",
        confidence: {
          basisPoints: 7_500,
          evidenceReferences: [],
          rationale: "Bounded inference from one selected source excerpt.",
        },
        evidenceReferences: [
          {
            digest: input.digest,
            kind: "repository-evidence",
            location: { endLine: 2, startLine: 1 },
            path: input.path,
            referenceId,
          },
        ],
        summary: "The handler reads a repository-defined dependency.",
      },
    ],
    contractVersion: 1,
    operation: "repository.interpret",
    proposalContext: {
      assumptions: [],
      confidence: {
        basisPoints: 7_500,
        evidenceReferences: [],
        rationale: "One selected source excerpt supports this proposal.",
      },
      unknowns: [],
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      inputDigest: DIGEST,
      invocationId: "invocation.repository.1",
      modelId: "cloudmarkup.deterministic-fake",
      modelVersion: "1",
      ownership: "untrusted-proposal",
      promptDigest: DIGEST,
      promptTemplateId: "cloudmarkup.repository-interpretation",
      promptVersion: "1.0.0",
      providerId: "cloudmarkup.deterministic-fake",
    },
  });
}

describe("GitHub repository import and synchronization", () => {
  it("imports the pinned commit with minimum permissions through Prompt 33C and preserves history", async () => {
    const harness = await system({});
    const pinned = harness.branch.sha;
    harness.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      "application/new.ts",
      "export const changed = true;\n",
    );

    const imported = await harness.service.importRepository(request(pinned));
    expect(imported.commitSha).toBe(pinned);
    expect(imported.branchHeadSha).not.toBe(pinned);
    expect(imported.result?.branchChangedSinceSelection).toBe(true);
    expect(imported.result?.ignoredFiles).toEqual(
      expect.arrayContaining([
        { path: ".env", reason: "sensitive-path" },
        { path: "assets/logo.png", reason: "unsupported-file-type" },
      ]),
    );
    expect(imported.result?.files.map(({ path }) => path)).not.toContain(
      "application/new.ts",
    );
    expect(
      imported.result?.importResult.facts.some(
        (fact) => fact.target === "terraform",
      ),
    ).toBe(true);
    expect(
      imported.result?.importResult.facts.some(
        (fact) => fact.target === "cloudformation",
      ),
    ).toBe(true);
    expect(harness.github.requestedSessions).toEqual([
      {
        installationId: INSTALLATION_ID,
        permissions: {
          contents: "read",
          metadata: "read",
          pullRequests: "none",
          workflows: "none",
        },
        repositoryIds: [REPOSITORY_ID],
      },
    ]);
    expect(harness.github.sessionsClosed).toBe(harness.github.sessionsOpened);

    const repeated = await harness.service.importRepository(request(pinned));
    expect(repeated.importId).toBe(imported.importId);
    expect(harness.github.requestedSessions).toHaveLength(1);
    const distinct = await harness.service.importRepository(
      request(pinned, "same-commit-new-request"),
    );
    expect(distinct.importId).not.toBe(imported.importId);
    expect(distinct.snapshotId).not.toBe(imported.snapshotId);
    expect(harness.github.requestedSessions).toHaveLength(2);

    const current = await harness.github.withRepositoryReadSession(
      { installationId: INSTALLATION_ID, repositoryIds: [REPOSITORY_ID] },
      async (session) => {
        const descriptor = (await session.listRepositories())[0];
        if (descriptor === undefined) throw new Error("Repository missing.");
        return (await session.listBranches(descriptor))[0]?.sha;
      },
    );
    if (current === undefined) throw new Error("Current commit missing.");
    const refreshed = await harness.service.importRepository({
      ...request(current, "refresh-key"),
      previousImportId: imported.importId,
    });
    expect(refreshed.previousImportId).toBe(imported.importId);
    expect(refreshed.result?.fileDifferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "added",
          path: "application/new.ts",
        }),
      ]),
    );
    expect(
      await harness.service.listImports({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).toHaveLength(3);
  }, 30_000);

  it("routes only unresolved application evidence to grounded interpretation and rejects invented references", async () => {
    let latestRequest:
      | Parameters<GitHubRepositoryImportRunner["importPinnedSnapshot"]>[0]
      | undefined;
    const baseImporter = createMaterializedRepositoryImportRunner(
      createRepositoryImportService({
        hclInspector: { inspect: () => Promise.resolve(hcl) },
      }),
    );
    const runner: GitHubRepositoryImportRunner = {
      async importPinnedSnapshot(input) {
        latestRequest = input;
        const result = await baseImporter.importPinnedSnapshot(input);
        return {
          ...result,
          facts: [
            ...result.facts,
            {
              confidence: "unresolved",
              factId: "fact.application.connection",
              kind: "connection",
              source: {
                column: 1,
                evidenceId: "evidence.application.connection",
                line: 1,
                path: "application/index.ts",
              },
            },
          ],
        } as RepositoryImportResultV1;
      },
    };
    const harness = await system({ runner });
    const interpreterCalls: Parameters<
      GitHubRepositoryInterpretationPort["interpret"]
    >[0][] = [];
    const interpreter: GitHubRepositoryInterpretationPort = {
      interpret(input) {
        interpreterCalls.push(structuredClone(input));
        const evidence = input.evidence[0];
        if (evidence === undefined) throw new Error("Evidence missing.");
        return Promise.resolve(
          interpretationResponse({
            digest: evidence.fileChecksum,
            evidenceId: evidence.evidenceId,
            path: evidence.path,
          }),
        );
      },
    };
    const service = createGitHubRepositoryImportService({
      ...harness.serviceOptions,
      interpreter,
    });
    const imported = await service.importRepository(
      request(harness.branch.sha, "ai-key"),
    );
    expect(latestRequest).toBeDefined();
    expect(interpreterCalls).toHaveLength(1);
    expect(interpreterCalls[0]?.privateRepository).toBe(true);
    expect(interpreterCalls[0]?.evidence[0]?.content).toContain("[REDACTED]");
    expect(imported.result?.inferenceClaims[0]).toMatchObject({
      category: "connection",
      confidenceBasisPoints: 7_500,
    });
    expect(imported.result?.inferenceIssues[0]).toMatchObject({
      lifecycle: "current",
      source: "repository-import-mismatch",
    });

    const secondHarness = await system({ runner });
    const ungrounded = createGitHubRepositoryImportService({
      ...secondHarness.serviceOptions,
      interpreter: {
        interpret(input) {
          const evidence = input.evidence[0];
          if (evidence === undefined) throw new Error("Evidence missing.");
          return Promise.resolve(
            interpretationResponse({
              digest: evidence.fileChecksum,
              evidenceId: evidence.evidenceId,
              grounded: false,
              path: evidence.path,
            }),
          );
        },
      },
    });
    await expect(
      ungrounded.importRepository(
        request(secondHarness.branch.sha, "ungrounded-key"),
      ),
    ).rejects.toMatchObject({ code: "ungrounded-claim" });
  }, 30_000);

  it("fails closed for path attacks, oversized files, revoked installations, and rate limits", async () => {
    const attacked = await system({
      files: { "../escape.ts": "export const escape = true;\n" },
    });
    await expect(
      attacked.service.importRepository(
        request(attacked.branch.sha, "path-attack"),
      ),
    ).rejects.toMatchObject({ code: "import-blocked" });

    const oversized = await system({
      files: {
        "application/large.ts": new Uint8Array(8 * 1024 * 1024 + 1),
      },
    });
    await expect(
      oversized.service.importRepository(
        request(oversized.branch.sha, "oversized"),
      ),
    ).rejects.toMatchObject({ code: "import-blocked" });

    const revoked = await system({});
    revoked.github.revokeInstallation(INSTALLATION_ID);
    await expect(
      revoked.service.importRepository(request(revoked.branch.sha, "revoked")),
    ).rejects.toMatchObject({ code: "installation-revoked" });

    const limited = await system({});
    limited.github.rateLimitNext("open-session");
    await expect(
      limited.service.importRepository(
        request(limited.branch.sha, "rate-limit"),
      ),
    ).rejects.toMatchObject({ code: "rate-limited", transient: true });
  }, 30_000);

  it("dispatches reviewed reconciliation only after a stale check and keeps regeneration in export preview", async () => {
    const baseImporter = createMaterializedRepositoryImportRunner(
      createRepositoryImportService({
        hclInspector: { inspect: () => Promise.resolve(hcl) },
      }),
    );
    const operations = [
      { kind: "accept-observed-graph-change", operationId: "operation.accept" },
      { kind: "keep-observed-only", operationId: "operation.keep" },
      {
        kind: "mark-intentionally-external",
        operationId: "operation.external",
      },
      { kind: "ignore-observation", operationId: "operation.ignore" },
      {
        kind: "update-generated-output-to-design",
        operationId: "operation.regenerate",
      },
    ];
    const runner: GitHubRepositoryImportRunner = {
      async importPinnedSnapshot(input) {
        const result = await baseImporter.importPinnedSnapshot(input);
        return {
          ...result,
          proposal: {
            operations,
          },
        } as unknown as RepositoryImportResultV1;
      },
    };
    const harness = await system({ runner });
    const imported = await harness.service.importRepository(
      request(harness.branch.sha, "review-base"),
    );
    if (imported.snapshotDigest === undefined) {
      throw new Error("Snapshot digest missing.");
    }
    const importedSnapshotDigest = imported.snapshotDigest;
    const review = (
      decision:
        | "accept-into-design"
        | "keep-observed"
        | "mark-external"
        | "regenerate"
        | "ignore"
        | "reject",
      operationId: string,
      reason?: string,
    ) =>
      harness.service.review({
        correlationId: "correlation.review",
        decision,
        expectedSnapshotDigest: importedSnapshotDigest,
        idempotencyKey: `review:${decision}:${operationId}`,
        importId: imported.importId,
        operationId,
        organizationId: ORGANIZATION_ID,
        principalId: PRINCIPAL_ID,
        projectId: PROJECT_ID,
        ...(reason === undefined ? {} : { reason }),
      });

    const accepted = await review("accept-into-design", "operation.accept");
    expect(accepted.designChanged).toBe(true);
    await expect(
      review("accept-into-design", "operation.accept"),
    ).resolves.toEqual(accepted);
    expect(harness.reconcilerCalls).toHaveLength(1);
    await review("keep-observed", "operation.keep");
    await review("mark-external", "operation.external");
    await review("ignore", "operation.ignore", "Managed by another team.");
    const regenerated = await review("regenerate", "operation.regenerate");
    expect(regenerated.receiptId).toBe("githubpreview.regenerate.1");
    expect(harness.regenerationCalls).toHaveLength(1);
    expect(harness.github.pullRequestCount).toBe(0);
    expect(harness.reconcilerCalls.map(({ decision }) => decision)).toEqual([
      "accept-into-design",
      "keep-observed",
      "mark-external",
      "ignore",
    ]);

    harness.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      "application/stale.ts",
      "export const stale = true;\n",
    );
    await expect(
      review("reject", "operation.keep", "Repository moved on."),
    ).rejects.toMatchObject({ code: "repository-changed" });
  }, 30_000);
});

it("discovers eligible metadata without a revision, importer, AI, audit, progress, or import reservation", async () => {
  const importPinnedSnapshot = vi.fn<
    GitHubRepositoryImportRunner["importPinnedSnapshot"]
  >(() => Promise.reject(new Error("Unexpected import")));
  const interpret = vi.fn<GitHubRepositoryInterpretationPort["interpret"]>(() =>
    Promise.reject(new Error("Unexpected AI call")),
  );
  const value = await system({ runner: { importPinnedSnapshot } });
  const load = vi.spyOn(value.serviceOptions.context, "load");
  const reserve = vi.spyOn(value.store, "reserveImport");
  const audit = vi.spyOn(value.audit, "record");
  const progress = vi.spyOn(value.progress, "record");
  const service = createGitHubRepositoryImportService({
    ...value.serviceOptions,
    interpreter: { interpret },
  });
  const result = await service.discoverRepository(request(value.branch.sha));
  expect(result.files.map((file) => file.path)).toEqual([
    "application/index.ts",
    "infrastructure/main.tf",
    "infrastructure/template.json",
  ]);
  for (const sideEffect of [
    load,
    importPinnedSnapshot,
    interpret,
    reserve,
    audit,
    progress,
  ])
    expect(sideEffect).not.toHaveBeenCalled();
  expect(value.regenerationCalls).toEqual([]);
  expect(value.reconcilerCalls).toEqual([]);
});
