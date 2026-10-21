import {
  createReviewedCustomerCiRepositoryWorkflowsV1,
  generateCustomerCiWorkflowSetV1,
  validateCustomerCiWorkflowSetV1,
} from "@cloudmarkup/customer-ci-workflow";
import { createCustomerCiWorkflowTestConfigV1 } from "@cloudmarkup/customer-ci-workflow/testing";
import {
  serializeCanonicalJson,
  type RepositoryRelativePath,
} from "@cloudmarkup/schemas";
import {
  canonicalSemanticDigest,
  createDeterministicZip,
  generateSolutionExport,
  SOLUTION_EXPORT_MANIFEST_PATH,
  solutionExportManifestV1Schema,
  solutionExportRepositoryWorkflowPathV1Schema,
  verifySolutionExportArtifact,
  type SolutionExportArtifactV1,
} from "@cloudmarkup/solution-export";
import { projectGoCompilationResultToSolutionExportInfrastructure } from "@cloudmarkup/solution-export-workflow";
import {
  TEST_RENDERER,
  TEST_TARGET_SETTINGS,
  workflowFixture,
} from "@cloudmarkup/solution-export-workflow/testing";
import { describe, expect, it } from "vitest";

import {
  gitHubExportPreviewSchema,
  gitHubPreviousExportAuthorityV1Schema,
  type GitHubPreviousExportAuthorityV1,
} from "./contracts.js";
import { GitHubExportError } from "./errors.js";
import {
  FakeGitHubInstallationLinkCallbackVerifier,
  FakeGitHubAppAdapter,
  InMemoryApprovedSolutionPackageRepository,
  InMemoryGitHubExportStore,
  RecordingGitHubExportAuditSink,
  RecordingGitHubExportProgressSink,
} from "./fakes.js";
import type { StoredGitHubExportExecution } from "./ports.js";
import { canonicalDigest, sha256Digest } from "./security.js";
import { GitHubRepositoryExportService } from "./service.js";

const ORGANIZATION_ID = "organization.1";
const PROJECT_ID = "project.1";
const ARTIFACT_ID = "artifact.1";
const PRINCIPAL_ID = "principal.1";
const AT = new Date("2026-08-23T12:00:00.000Z");

function approvedArtifact(): SolutionExportArtifactV1 {
  const fixture = workflowFixture("infrastructure-only");
  const result = generateSolutionExport({
    architectureDocument: fixture.generationRequest.architectureDocument,
    contractVersion: 1,
    existingFiles: [],
    infrastructure: projectGoCompilationResultToSolutionExportInfrastructure(
      fixture.compilation,
    ),
    solutionRevision: fixture.generationRequest.solutionRevision,
    supplementalFiles: [],
    target: {
      exportName: "GitHub Notes API",
      limits: TEST_TARGET_SETTINGS.limits,
      policyPacks: TEST_TARGET_SETTINGS.policyPacks,
      renderer: TEST_RENDERER,
      target: TEST_TARGET_SETTINGS.target,
    },
  });
  if (result.state !== "ready") {
    throw new Error(`Fixture export blocked: ${JSON.stringify(result)}`);
  }
  return result.artifact;
}

const TERRAFORM_MEDIA_TYPE = "application/vnd.hashicorp.terraform" as const;

function approvedArtifactWithCustomerWorkflows(
  repository: {
    readonly defaultBranch?: string;
    readonly name?: string;
    readonly owner?: string;
    readonly repositoryId?: string;
    readonly repositoryOwnerId?: string;
  } = {},
): SolutionExportArtifactV1 {
  const fixture = workflowFixture("infrastructure-only");
  const infrastructure =
    projectGoCompilationResultToSolutionExportInfrastructure(
      fixture.compilation,
    );
  const config = structuredClone(createCustomerCiWorkflowTestConfigV1());
  const repositoryId = repository.repositoryId ?? "900";
  const repositoryOwnerId = repository.repositoryOwnerId ?? "500";
  const repositoryOwner = repository.owner ?? "example-org";
  const repositoryName = repository.name ?? "customer-repository";
  config.repository = {
    defaultBranch: repository.defaultBranch ?? "main",
    destinationFolder: "solutions/notes-api",
    name: repositoryName,
    oidcSubject: {
      ...config.repository.oidcSubject,
      repositoryId,
      repositoryOwnerId,
      subjectPrefix: `repo:${repositoryOwner}@${repositoryOwnerId}/${repositoryName}@${repositoryId}:environment:`,
    },
    owner: repositoryOwner,
    visibility: config.repository.visibility,
  };
  const approvedDefaultBranch = repository.defaultBranch;
  if (approvedDefaultBranch !== undefined) {
    config.environments = config.environments.map((environment) => ({
      ...environment,
      approvedBranches: [
        approvedDefaultBranch,
        ...environment.approvedBranches.filter(
          (branch) => branch !== approvedDefaultBranch,
        ),
      ],
    }));
  }
  config.solutionRevision = {
    digest: sha256Digest(
      serializeCanonicalJson(fixture.generationRequest.solutionRevision),
    ),
    id: fixture.generationRequest.solutionRevision.solutionRevisionId,
  };
  const terraformRootDirectory = "solutions/notes-api/infrastructure";
  config.terraform = {
    allowedProviderSources: config.terraform.allowedProviderSources,
    backend: {
      ...config.terraform.backend,
      configPath: `${terraformRootDirectory}/backend.hcl`,
    },
    cliSha256LinuxAmd64: config.terraform.cliSha256LinuxAmd64,
    packageTreeDigest: config.terraform.packageTreeDigest,
    providerLockPath: `${terraformRootDirectory}/.terraform.lock.hcl`,
    rootDirectory: terraformRootDirectory,
    version: "1.15.8",
  };
  expect(config.terraform.backend).toEqual({
    configPath: `${config.terraform.rootDirectory}/backend.hcl`,
    contractVersion: 1,
    encryption: "required",
    locking: "s3-native-lockfile",
    type: "aws-s3",
    workspaceIsolation: "workspace-key-prefix",
  });
  expect(config.terraform.providerLockPath).toBe(
    `${config.terraform.rootDirectory}/.terraform.lock.hcl`,
  );
  const provenance = infrastructure.files[0]?.provenance;
  if (provenance === undefined) {
    throw new Error("Customer workflow fixture requires Terraform provenance.");
  }
  const supplementalFile = (path: string, value: string) => {
    const bytes = new TextEncoder().encode(value);
    return {
      checksum: sha256Digest(bytes),
      content: { encoding: "utf8" as const, value },
      kind: "regular-file" as const,
      mediaType: TERRAFORM_MEDIA_TYPE,
      ownership: "user-provided" as const,
      path,
      provenance,
      semanticChecksum: canonicalSemanticDigest(TERRAFORM_MEDIA_TYPE, bytes),
    };
  };
  const supplementalFiles = [
    supplementalFile(
      "infrastructure/backend.hcl",
      'bucket = "replace-with-customer-state-bucket"\n',
    ),
    supplementalFile(
      "infrastructure/.terraform.lock.hcl",
      "# Reviewed customer provider lock fixture.\n",
    ),
  ];
  const packageFiles = [...infrastructure.files, ...supplementalFiles]
    .map(({ checksum, path }) => ({ checksum, path }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  config.terraform = {
    ...config.terraform,
    packageTreeDigest: sha256Digest(
      serializeCanonicalJson(
        packageFiles.filter(({ path }) => path.startsWith("infrastructure/")),
      ),
    ),
  };
  const workflowSet = generateCustomerCiWorkflowSetV1(config);
  const workflowValidation = validateCustomerCiWorkflowSetV1(
    config,
    workflowSet,
  );
  if (!workflowValidation.valid) {
    throw new Error(
      `Customer workflow fixture invalid: ${JSON.stringify(workflowValidation.issues)}`,
    );
  }
  const reviewedRepositoryWorkflows =
    createReviewedCustomerCiRepositoryWorkflowsV1({
      config,
      packageFiles,
      result: workflowSet,
    });
  const result = generateSolutionExport({
    architectureDocument: fixture.generationRequest.architectureDocument,
    contractVersion: 1,
    existingFiles: [],
    infrastructure,
    solutionRevision: fixture.generationRequest.solutionRevision,
    reviewedRepositoryWorkflows,
    supplementalFiles,
    target: {
      exportName: "GitHub Notes API with customer CI",
      limits: TEST_TARGET_SETTINGS.limits,
      policyPacks: TEST_TARGET_SETTINGS.policyPacks,
      renderer: TEST_RENDERER,
      target: TEST_TARGET_SETTINGS.target,
    },
  });
  if (result.state !== "ready") {
    throw new Error(
      "Customer workflow fixture export blocked: " + JSON.stringify(result),
    );
  }
  return result.artifact;
}

const VALIDATION_WORKFLOW_PATH =
  solutionExportRepositoryWorkflowPathV1Schema.parse(
    ".github/workflows/cloudmarkup-validate.yml",
  );
const PLAN_WORKFLOW_PATH = solutionExportRepositoryWorkflowPathV1Schema.parse(
  ".github/workflows/cloudmarkup-plan.yml",
);

function legacyUnboundArtifactWithWorkflows(
  paths: readonly RepositoryRelativePath[],
): SolutionExportArtifactV1 {
  const artifact = approvedArtifact();
  const repositoryWorkflows = artifact.manifest.repositoryWorkflows;
  if (repositoryWorkflows === undefined) {
    throw new Error("Fixture requires repository workflow inventory.");
  }
  const sourceEntry = repositoryWorkflows.files.find(
    ({ path }) => path === VALIDATION_WORKFLOW_PATH,
  );
  const sourceFile = artifact.files.find(
    ({ path }) => path === VALIDATION_WORKFLOW_PATH,
  );
  const sourceOwnership = artifact.manifest.ownership.find(
    ({ path }) => path === VALIDATION_WORKFLOW_PATH,
  );
  const manifestFile = artifact.files.find(
    ({ path }) => path === SOLUTION_EXPORT_MANIFEST_PATH,
  );
  if (
    sourceEntry === undefined ||
    sourceFile === undefined ||
    sourceOwnership === undefined ||
    manifestFile === undefined
  ) {
    throw new Error("Fixture requires the credentialless validation workflow.");
  }
  const manifestValue = structuredClone(artifact.manifest);
  delete manifestValue.repositoryWorkflows;
  manifestValue.files = [
    ...manifestValue.files,
    ...paths.map((path) => ({ ...sourceEntry, path })),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  manifestValue.ownership = [
    ...manifestValue.ownership.filter(
      ({ path }) => path !== VALIDATION_WORKFLOW_PATH,
    ),
    ...paths.map((path) => ({ ...sourceOwnership, path })),
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const manifest = solutionExportManifestV1Schema.parse(manifestValue);
  const manifestBytes = new TextEncoder().encode(
    serializeCanonicalJson(manifest),
  );
  const files = [
    ...artifact.files.filter(
      ({ path }) =>
        path !== VALIDATION_WORKFLOW_PATH &&
        path !== SOLUTION_EXPORT_MANIFEST_PATH,
    ),
    ...paths.map((path) => ({ ...sourceFile, path })),
    {
      ...manifestFile,
      bytes: manifestBytes,
      checksum: sha256Digest(manifestBytes),
      semanticChecksum: canonicalSemanticDigest(
        "application/json",
        manifestBytes,
      ),
    },
  ].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const zipBytes = createDeterministicZip(files);
  return {
    ...artifact,
    files,
    manifest,
    manifestDigest: sha256Digest(manifestBytes),
    zipBytes,
    zipDigest: sha256Digest(zipBytes),
  };
}

function artifactWithOnlyPlanWorkflow(): SolutionExportArtifactV1 {
  return legacyUnboundArtifactWithWorkflows([PLAN_WORKFLOW_PATH]);
}

function repositoryFilesForArtifact(
  artifact: SolutionExportArtifactV1,
): Readonly<Record<string, Uint8Array>> {
  return Object.fromEntries(
    artifact.files.map(({ bytes, path }) => [
      path.startsWith(".github/workflows/")
        ? path
        : "solutions/notes-api/" + path,
      new Uint8Array(bytes),
    ]),
  );
}

function repositoryFilesWithForgedGeneratedOverride(
  artifact: SolutionExportArtifactV1,
): Readonly<Record<string, Uint8Array>> {
  const packagePath = "cloudmarkup/architecture.json";
  const repositoryPath = "solutions/notes-api/" + packagePath;
  const forgedBytes = new TextEncoder().encode('{"forged":"customer-owned"}\n');
  const forgedDigest = sha256Digest(forgedBytes);
  const manifest = solutionExportManifestV1Schema.parse({
    ...artifact.manifest,
    files: artifact.manifest.files.map((entry) =>
      entry.path === packagePath
        ? {
            ...entry,
            checksum: forgedDigest,
            ownership: "generated-replaceable",
            semanticChecksum: canonicalSemanticDigest(
              "application/json",
              forgedBytes,
            ),
            sizeBytes: forgedBytes.byteLength,
          }
        : entry,
    ),
    ownership: artifact.manifest.ownership.map((entry) =>
      entry.path === packagePath
        ? {
            ...entry,
            baselineChecksum: forgedDigest,
            conflictBehavior: "replace-only-when-baseline-matches",
            ownership: "generated-replaceable",
            regeneration: "verified-replacement",
          }
        : entry,
    ),
  });
  return {
    ...repositoryFilesForArtifact(artifact),
    [repositoryPath]: forgedBytes,
    "solutions/notes-api/cloudmarkup/cloudmarkup.manifest.json":
      new TextEncoder().encode(serializeCanonicalJson(manifest)),
  };
}

function setup(
  options: {
    readonly artifact?: SolutionExportArtifactV1;
    readonly baseFiles?: Readonly<Record<string, Uint8Array | string>>;
    readonly clock?: () => Date;
    readonly existingFeatureBranch?: boolean;
    readonly private?: boolean;
    readonly protectFeatureBranches?: boolean;
    readonly workflows?: "none" | "write";
  } = {},
) {
  const artifact = options.artifact ?? approvedArtifact();
  const github = new FakeGitHubAppAdapter();
  const callbackVerifier = new FakeGitHubInstallationLinkCallbackVerifier();
  github.addInstallation({
    accountId: 500,
    accountLogin: "example-org",
    accountType: "Organization",
    installationId: 77,
    permissions: {
      contents: "write",
      metadata: "read",
      pullRequests: "write",
      workflows: options.workflows ?? "write",
    },
    repositorySelection: "selected",
    suspended: false,
  });
  github.addRepository(
    {
      archived: false,
      defaultBranch: "main",
      disabled: false,
      installationId: 77,
      name: "customer-repository",
      nodeId: "repository-node-900",
      owner: "example-org",
      private: options.private ?? true,
      pushedAt: AT.toISOString(),
      ownerId: 500,
      repositoryId: 900,
    },
    {
      main: {
        "solutions/notes-api/CUSTOMER.md": "Customer-owned and unrelated.\n",
        ...options.baseFiles,
      },
      ...(options.existingFeatureBranch
        ? {
            "cloudmarkup/notes-api": {
              "EXISTING.md": "An existing branch with the requested name.\n",
            },
          }
        : {}),
    },
    ["main"],
    options.protectFeatureBranches ? ["cloudmarkup/"] : [],
  );
  const artifacts = new InMemoryApprovedSolutionPackageRepository();
  artifacts.add({
    artifact,
    artifactId: ARTIFACT_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
  });
  const store = new InMemoryGitHubExportStore();
  const audit = new RecordingGitHubExportAuditSink();
  const progress = new RecordingGitHubExportProgressSink();
  let sequence = 0;
  let linkSequence = 0;
  const service = new GitHubRepositoryExportService({
    artifactRepository: artifacts,
    audit,
    installationLinkCallbackVerifier: callbackVerifier,
    installationSetupUrl:
      "https://github.com/apps/cloudmarkup-test/installations/new",
    linkIntentIdFactory: () => `githublink_${String(++linkSequence)}`,
    linkStateFactory: () => `${"s".repeat(42)}${String(linkSequence + 1)}`,
    clock: options.clock ?? (() => new Date(AT)),
    github,
    idFactory: (kind) => `${kind}.${String(++sequence)}`,
    progress,
    store,
  });
  return {
    artifact,
    artifacts,
    audit,
    callbackVerifier,
    github,
    progress,
    service,
    store,
  };
}

async function linked(setupResult: ReturnType<typeof setup>) {
  const intent = await setupResult.service.createInstallationLinkIntent({
    correlationId: "correlation.link",
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
  });
  const callbackReceipt = `callback-${intent.intentId}`;
  setupResult.callbackVerifier.addReceipt(callbackReceipt, {
    installationId: 77,
    setupAction: "install",
    state: intent.state,
  });
  const installation = await setupResult.service.completeInstallationLink({
    callbackReceipt,
    correlationId: "correlation.link.complete",
    intentId: intent.intentId,
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
  });
  const repositories = await setupResult.service.discoverRepositories({
    correlationId: "correlation.discover",
    integrationId: installation.integrationId,
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
  });
  const repository = repositories[0];
  if (repository === undefined) throw new Error("Expected fake repository.");
  return { installation, repository };
}

async function preview(
  setupResult: ReturnType<typeof setup>,
  options: {
    readonly destinationFolder?: string;
    readonly includeWorkflows?: boolean;
  } = {},
) {
  const { installation, repository } = await linked(setupResult);
  return setupResult.service.createPreview({
    artifactId: ARTIFACT_ID,
    baseBranch: "main",
    correlationId: "correlation.preview",
    destinationFolder: options.destinationFolder ?? "solutions/notes-api",
    featureBranch: "cloudmarkup/notes-api",
    includeWorkflows: options.includeWorkflows ?? true,
    integrationId: installation.integrationId,
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
    projectId: PROJECT_ID,
    repositoryId: repository.repositoryId,
  });
}

async function previewForLinked(
  setupResult: ReturnType<typeof setup>,
  link: Awaited<ReturnType<typeof linked>>,
  options: {
    readonly destinationFolder?: string;
    readonly featureBranch?: string;
    readonly includeWorkflows?: boolean;
  } = {},
) {
  return setupResult.service.createPreview({
    artifactId: ARTIFACT_ID,
    baseBranch: "main",
    correlationId: "correlation.preview.linked",
    destinationFolder: options.destinationFolder ?? "solutions/notes-api",
    featureBranch: options.featureBranch ?? "cloudmarkup/notes-api",
    includeWorkflows: options.includeWorkflows ?? true,
    integrationId: link.installation.integrationId,
    organizationId: ORGANIZATION_ID,
    principalId: PRINCIPAL_ID,
    projectId: PROJECT_ID,
    repositoryId: link.repository.repositoryId,
  });
}

async function execute(
  setupResult: ReturnType<typeof setup>,
  value: Awaited<ReturnType<typeof preview>>,
  idempotencyKey = "export-once",
) {
  return setupResult.service.execute({
    confirmedWorkflowFiles: value.workflowFiles,
    correlationId: "correlation.execute",
    idempotencyKey,
    organizationId: ORGANIZATION_ID,
    previewDigest: value.previewDigest,
    previewId: value.previewId,
    principalId: PRINCIPAL_ID,
    projectId: PROJECT_ID,
  });
}

function latestSucceededExecution(setupResult: ReturnType<typeof setup>) {
  const entry = [...setupResult.store.executions.entries()].find(
    ([, record]) =>
      record.state === "succeeded" &&
      record.authority !== undefined &&
      record.receipt !== undefined,
  );
  if (entry === undefined) {
    throw new Error("Expected a successful export execution fixture.");
  }
  return entry;
}

function rebindSuccessfulExecutionForStaleSave(
  template: StoredGitHubExportExecution,
  running: StoredGitHubExportExecution,
): StoredGitHubExportExecution {
  if (
    template.state !== "succeeded" ||
    template.authority === undefined ||
    template.receipt === undefined
  ) {
    throw new Error("Expected a successful terminal execution template.");
  }
  const { authorityDigest: ignoredAuthorityDigest, ...authorityPayload } =
    template.authority;
  void ignoredAuthorityDigest;
  const reboundAuthorityPayload = {
    ...authorityPayload,
    artifactDigest: running.artifactDigest,
    organizationId: running.organizationId,
    previewDigest: running.previewDigest,
    projectId: running.projectId,
  };
  return {
    ...template,
    artifactDigest: running.artifactDigest,
    authority: {
      ...reboundAuthorityPayload,
      authorityDigest: canonicalDigest(reboundAuthorityPayload),
    },
    createdByPrincipalId: running.createdByPrincipalId,
    idempotencyKeyDigest: running.idempotencyKeyDigest,
    organizationId: running.organizationId,
    previewDigest: running.previewDigest,
    previewId: running.previewId,
    projectId: running.projectId,
    receipt: {
      ...template.receipt,
      organizationId: running.organizationId,
      previewDigest: running.previewDigest,
      projectId: running.projectId,
    },
  };
}

function replaceNextExecutionSaveWithStaleRecord(
  setupResult: ReturnType<typeof setup>,
  replacement: (
    running: StoredGitHubExportExecution,
  ) => StoredGitHubExportExecution,
): void {
  const saveExecution = setupResult.store.saveExecution.bind(setupResult.store);
  let pending = true;
  Object.defineProperty(setupResult.store, "saveExecution", {
    configurable: true,
    value: (
      input: Parameters<InMemoryGitHubExportStore["saveExecution"]>[0],
    ) => {
      if (pending) {
        pending = false;
        const staleRecord = replacement(input.record);
        const key = `${input.record.organizationId}:${input.record.projectId}:${input.record.idempotencyKeyDigest}`;
        setupResult.store.executions.set(key, staleRecord);
      }
      return saveExecution(input);
    },
  });
}

function addForgedAuthorityFile(
  setupResult: ReturnType<typeof setup>,
  input: {
    readonly bytes: Uint8Array;
    readonly path: string;
    readonly workflow: boolean;
  },
): GitHubPreviousExportAuthorityV1 {
  const [key, execution] = latestSucceededExecution(setupResult);
  const authority = execution.authority;
  if (authority === undefined) {
    throw new Error("Expected successful authority fixture.");
  }
  const files = [
    ...authority.files,
    {
      checksum: sha256Digest(input.bytes),
      ownership: "generated-replaceable" as const,
      path: input.path,
      workflow: input.workflow,
    },
  ].sort((left, right) => (left.path < right.path ? -1 : 1));
  const inventoryDigest = canonicalDigest(files);
  const { authorityDigest: ignoredAuthorityDigest, ...priorPayload } =
    authority;
  void ignoredAuthorityDigest;
  const payload = { ...priorPayload, files, inventoryDigest };
  const forgedAuthority: GitHubPreviousExportAuthorityV1 = {
    ...payload,
    authorityDigest: canonicalDigest(payload),
  };
  setupResult.store.executions.set(key, {
    ...execution,
    authority: forgedAuthority,
  });
  return forgedAuthority;
}

describe("GitHub App repository export", () => {
  it("lists linked installations only for the authorized organization in stable account order", async () => {
    const value = setup();
    const { installation: first } = await linked(value);
    await value.store.saveInstallation({
      ...first,
      accountLogin: "aaa-customer",
      installationId: 78,
      integrationId: "integration.same-organization",
    });
    await value.store.saveInstallation({
      ...first,
      accountLogin: "other-tenant",
      installationId: 79,
      integrationId: "integration.other-organization",
      organizationId: "organization.other",
    });

    const installations = await value.service.listInstallations({
      organizationId: ORGANIZATION_ID,
    });

    expect(installations.map(({ accountLogin }) => accountLogin)).toEqual([
      "aaa-customer",
      "example-org",
    ]);
    expect(
      installations.every(
        ({ organizationId }) => organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });
  it("previews the complete immutable package, creates only a feature branch, and opens one PR", async () => {
    const value = setup();
    const candidate = await preview(value);

    expect(candidate.issues).toEqual([]);
    expect(candidate.ready).toBe(true);
    expect(candidate.workflowFiles).toHaveLength(1);
    expect(
      candidate.changes.some(({ path }) =>
        path.endsWith("cloudmarkup/architecture.json"),
      ),
    ).toBe(true);
    expect(
      candidate.changes.some(({ path }) => path.startsWith("infrastructure/")),
    ).toBe(false);
    expect(
      candidate.changes.some(({ path }) => path.includes("/infrastructure/")),
    ).toBe(true);
    expect(candidate.changes).toContainEqual(
      expect.objectContaining({
        action: "preserve",
        path: "solutions/notes-api/CUSTOMER.md",
      }),
    );

    const receipt = await execute(value, candidate);
    expect(receipt.branch).toBe("cloudmarkup/notes-api");
    expect(receipt.pullRequestNumber).toBe(1);
    expect(value.github.pullRequestCount).toBe(1);
    expect(
      value.github.branchFiles("example-org", "customer-repository", "main"),
    ).toEqual(
      new Map([
        [
          "solutions/notes-api/CUSTOMER.md",
          new TextEncoder().encode("Customer-owned and unrelated.\n"),
        ],
      ]),
    );
    const branch = value.github.branchFiles(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
    );
    expect(
      branch.has("solutions/notes-api/cloudmarkup/architecture.json"),
    ).toBe(true);
    expect(branch.has(".github/workflows/cloudmarkup-validate.yml")).toBe(true);
    expect(value.github.sessionsOpened).toBe(value.github.sessionsClosed);
    expect(value.audit.events.at(-1)?.action).toBe(
      "github.export.pull-request-created",
    );
  });

  it("exports all five exact reviewed customer CI workflows through one idempotent fake pull request", async () => {
    const artifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({ artifact });
    const candidate = await preview(value);
    const expectedPaths = [
      ".github/workflows/cloudmarkup-deploy.yml",
      ".github/workflows/cloudmarkup-drift.yml",
      ".github/workflows/cloudmarkup-plan.yml",
      ".github/workflows/cloudmarkup-smoke.yml",
      ".github/workflows/cloudmarkup-validate.yml",
    ];

    expect(candidate.ready).toBe(true);
    expect(candidate.issues).toEqual([]);
    expect(candidate.workflowFiles.map(({ path }) => path)).toEqual(
      expectedPaths,
    );
    expect(
      (artifact.manifest.repositoryWorkflows?.files ?? [])
        .filter(({ path }) => path.startsWith(".github/workflows/"))
        .map(({ path }) => path),
    ).toEqual(expectedPaths);
    expect(candidate.repositoryWorkflows).toEqual(
      artifact.manifest.repositoryWorkflows,
    );
    expect(candidate.repositoryWorkflows?.review.roles.length).toBeGreaterThan(
      0,
    );
    expect(candidate.repositoryWorkflows?.review.environments).toHaveLength(3);

    const receipt = await execute(value, candidate, "customer-ci-export");
    const replay = await execute(value, candidate, "customer-ci-export");
    expect(replay).toEqual(receipt);
    expect(value.github.pullRequestCount).toBe(1);
    const branch = value.github.branchFiles(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
    );
    expect(expectedPaths.every((path) => branch.has(path))).toBe(true);
    expect(value.github.sessionsOpened).toBe(value.github.sessionsClosed);
  });

  it("never replays an idempotent terminal receipt to a different principal", async () => {
    const value = setup();
    const candidate = await preview(value);
    await execute(value, candidate, "principal-bound-export");

    await expect(
      value.service.execute({
        confirmedWorkflowFiles: candidate.workflowFiles,
        correlationId: "correlation.execute.other-principal",
        idempotencyKey: "principal-bound-export",
        organizationId: ORGANIZATION_ID,
        previewDigest: candidate.previewDigest,
        previewId: candidate.previewId,
        principalId: "principal.other",
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("replays a lost success after mutable prerequisites expire without another GitHub session", async () => {
    let now = new Date(AT);
    const value = setup({ clock: () => now });
    const candidate = await preview(value);
    const receipt = await execute(
      value,
      candidate,
      "lost-terminal-success-export",
    );
    const sessionsAfterSuccess = value.github.sessionsOpened;

    now = new Date("2026-08-25T12:00:00.000Z");
    value.artifacts.records.delete(
      `${ORGANIZATION_ID}:${PROJECT_ID}:${ARTIFACT_ID}`,
    );
    await value.store.updateInstallationStatus({
      installationId: 77,
      status: "deleted",
      updatedAt: now.toISOString(),
    });

    const replay = await execute(
      value,
      candidate,
      "lost-terminal-success-export",
    );

    expect(replay).toEqual(receipt);
    expect(value.github.sessionsOpened).toBe(sessionsAfterSuccess);
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("denies terminal replay to a different principal or preview tuple without GitHub access", async () => {
    const value = setup();
    const candidate = await preview(value);
    await execute(value, candidate, "terminal-replay-binding-export");
    const sessionsAfterSuccess = value.github.sessionsOpened;
    const baseRequest = {
      confirmedWorkflowFiles: candidate.workflowFiles,
      correlationId: "correlation.execute.terminal-replay-binding",
      idempotencyKey: "terminal-replay-binding-export",
      organizationId: ORGANIZATION_ID,
      previewDigest: candidate.previewDigest,
      previewId: candidate.previewId,
      principalId: PRINCIPAL_ID,
      projectId: PROJECT_ID,
    } as const;

    await expect(
      value.service.execute({
        ...baseRequest,
        principalId: "principal.other",
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    await expect(
      value.service.execute({
        ...baseRequest,
        previewId: "preview.other",
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    await expect(
      value.service.execute({
        ...baseRequest,
        previewDigest: sha256Digest(
          new TextEncoder().encode("different preview digest"),
        ),
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(value.github.sessionsOpened).toBe(sessionsAfterSuccess);
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("returns previous-export authority only from a fully bound successful execution", async () => {
    const value = setup();
    const candidate = await preview(value);
    await execute(value, candidate, "authority-binding-export");
    const [key, execution] = latestSucceededExecution(value);
    const { authority, receipt } = execution;
    if (authority === undefined || receipt === undefined) {
      throw new Error("Expected a successful authority and receipt fixture.");
    }
    const target = {
      baseBranch: authority.baseBranch,
      destinationFolder: authority.destinationFolder,
      installationId: authority.installationId,
      integrationId: authority.integrationId,
      organizationId: authority.organizationId,
      projectId: authority.projectId,
      repositoryId: authority.repositoryId,
      repositoryOwnerId: authority.repositoryOwnerId,
    };
    expect(await value.store.findLatestPreviousExportAuthority(target)).toEqual(
      authority,
    );

    const { receipt: ignoredReceipt, ...executionWithoutReceipt } = execution;
    void ignoredReceipt;
    value.store.executions.set(key, {
      ...executionWithoutReceipt,
      state: "running",
    });
    expect(
      await value.store.findLatestPreviousExportAuthority(target),
    ).toBeNull();
    expect(
      await value.store.getPreviousExportAuthority({
        authorityId: authority.executionId,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();

    value.store.executions.set(key, {
      ...execution,
      receipt: {
        ...receipt,
        pullRequestNumber: receipt.pullRequestNumber + 1,
      },
    });
    expect(
      await value.store.findLatestPreviousExportAuthority(target),
    ).toBeNull();
    expect(
      await value.store.getPreviousExportAuthority({
        authorityId: authority.executionId,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });

  it.each([
    {
      kind: "a path outside the selected destination",
      path: "elsewhere/managed.txt",
      suffix: "outside",
      workflow: false,
    },
    {
      kind: "an unreviewed workflow path",
      path: ".github/workflows/unreviewed.yml",
      suffix: "workflow",
      workflow: true,
    },
    {
      kind: "a destination-prefixed workflow disguised as package content",
      path: "solutions/notes-api/.github/workflows/cloudmarkup-plan.yml",
      suffix: "nested-workflow",
      workflow: false,
    },
    {
      kind: "an exact reviewed workflow mislabeled as package content",
      path: ".github/workflows/cloudmarkup-plan.yml",
      suffix: "workflow-classification",
      workflow: false,
    },
    {
      kind: "root CODEOWNERS under the selected destination",
      path: "solutions/notes-api/CODEOWNERS",
      suffix: "root-codeowners",
      workflow: false,
    },
    {
      kind: "nested CODEOWNERS under the selected destination",
      path: "solutions/notes-api/.github/CODEOWNERS",
      suffix: "nested-codeowners",
      workflow: false,
    },
    {
      kind: "an environment file",
      path: "solutions/notes-api/application/.env",
      suffix: "environment",
      workflow: false,
    },
    {
      kind: "Terraform state",
      path: "solutions/notes-api/infrastructure/terraform.tfstate",
      suffix: "state",
      workflow: false,
    },
    {
      kind: "a Windows device name",
      path: "solutions/notes-api/application/CON.txt",
      suffix: "device",
      workflow: false,
    },
    {
      kind: "a trailing-dot segment",
      path: "solutions/notes-api/application/generated.",
      suffix: "trailing-dot",
      workflow: false,
    },
    {
      kind: "nonportable dependency output",
      path: "solutions/notes-api/application/node_modules/dependency.js",
      suffix: "dependency-output",
      workflow: false,
    },
  ])(
    "rejects self-digested previous-export authority for $kind before repository mutation",
    async ({ path, suffix, workflow }) => {
      const value = setup();
      const link = await linked(value);
      const initial = await previewForLinked(value, link, {
        featureBranch: `cloudmarkup/authority-source-${suffix}`,
      });
      await execute(value, initial, `authority-source-${suffix}`);
      const bytes = new TextEncoder().encode("forged managed bytes\n");
      value.github.setFile(
        "example-org",
        "customer-repository",
        "main",
        path,
        bytes,
      );
      const forged = addForgedAuthorityFile(value, {
        bytes,
        path,
        workflow,
      });
      const { authorityDigest, ...payload } = forged;
      expect(authorityDigest).toBe(canonicalDigest(payload));
      expect(forged.inventoryDigest).toBe(canonicalDigest(forged.files));
      expect(
        gitHubPreviousExportAuthorityV1Schema.safeParse(forged).success,
      ).toBe(false);
      Object.defineProperty(value.store, "findLatestPreviousExportAuthority", {
        configurable: true,
        value: () => Promise.resolve(forged),
      });

      await expect(
        previewForLinked(value, link, {
          featureBranch: `cloudmarkup/authority-forged-${suffix}`,
        }),
      ).rejects.toMatchObject({ code: "service-unavailable" });
      expect(value.github.pullRequestCount).toBe(1);
    },
  );

  it("modifies and deletes only exact authoritative bytes and requires explicit workflow-deletion confirmation", async () => {
    const initialArtifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({ artifact: initialArtifact });
    const link = await linked(value);
    const initial = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/authority-v1",
    });
    await execute(value, initial, "authority-v1-export");
    for (const [path, bytes] of Object.entries(
      repositoryFilesForArtifact(initialArtifact),
    )) {
      value.github.setFile(
        "example-org",
        "customer-repository",
        "main",
        path,
        bytes,
      );
    }

    const nextArtifact = approvedArtifact();
    value.artifacts.add({
      artifact: nextArtifact,
      artifactId: ARTIFACT_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });
    const candidate = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/authority-v2",
    });
    const workflowDeletes = candidate.changes.filter(
      (change) => change.action === "delete" && change.workflow,
    );
    expect(candidate.ready).toBe(true);
    expect(candidate.changes.some(({ action }) => action === "modify")).toBe(
      true,
    );
    expect(workflowDeletes.length).toBeGreaterThan(0);
    expect(
      workflowDeletes.every((change) =>
        candidate.workflowFiles.some(
          ({ digest, path }) =>
            path === change.path && digest === change.currentDigest,
        ),
      ),
    ).toBe(true);
    const omittedDeletion = workflowDeletes[0];
    if (omittedDeletion === undefined) {
      throw new Error("Expected a reviewed workflow deletion fixture.");
    }
    await expect(
      value.service.execute({
        confirmedWorkflowFiles: candidate.workflowFiles.filter(
          ({ path }) => path !== omittedDeletion.path,
        ),
        correlationId: "correlation.execute.missing-delete-confirmation",
        idempotencyKey: "authority-v2-missing-confirmation",
        organizationId: ORGANIZATION_ID,
        previewDigest: candidate.previewDigest,
        previewId: candidate.previewId,
        principalId: PRINCIPAL_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({ code: "workflow-confirmation-required" });
    expect(value.github.pullRequestCount).toBe(1);

    await execute(value, candidate, "authority-v2-export");
    expect(value.github.pullRequestCount).toBe(2);
    const branch = value.github.branchFiles(
      "example-org",
      "customer-repository",
      "cloudmarkup/authority-v2",
    );
    expect(workflowDeletes.every(({ path }) => !branch.has(path))).toBe(true);
  });

  it("preserves and blocks a managed file when live bytes no longer match previous authority", async () => {
    const artifact = approvedArtifact();
    const value = setup({ artifact });
    const link = await linked(value);
    const initial = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/stale-authority-v1",
    });
    await execute(value, initial, "stale-authority-v1");
    for (const [path, bytes] of Object.entries(
      repositoryFilesForArtifact(artifact),
    )) {
      value.github.setFile(
        "example-org",
        "customer-repository",
        "main",
        path,
        bytes,
      );
    }
    const repositoryPath = "solutions/notes-api/cloudmarkup/architecture.json";
    value.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      repositoryPath,
      "Customer changed authoritative bytes.\n",
    );

    const candidate = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/stale-authority-v2",
    });
    expect(candidate.ready).toBe(false);
    expect(candidate.changes).toContainEqual(
      expect.objectContaining({
        action: "preserve",
        path: repositoryPath,
      }),
    );
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "user-or-unmanaged-file-conflict",
        severity: "error",
      }),
    );
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("allows one execution owner while duplicate and conflicting callers fail before opening GitHub", async () => {
    const value = setup();
    const link = await linked(value);
    const firstPreview = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/single-flight-first",
    });
    const conflictingPreview = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/single-flight-conflict",
    });
    const sessionsBeforeExecution = value.github.sessionsOpened;
    const entered = value.github.holdNextInstallationSession();
    const firstExecution = execute(value, firstPreview, "single-flight-export");
    await entered;
    try {
      await expect(
        execute(value, firstPreview, "single-flight-export"),
      ).rejects.toMatchObject({ code: "export-in-progress" });
      await expect(
        execute(value, conflictingPreview, "single-flight-export"),
      ).rejects.toMatchObject({ code: "invalid-request" });
      await expect(
        value.service.execute({
          confirmedWorkflowFiles: firstPreview.workflowFiles,
          correlationId: "correlation.execute.single-flight-other-principal",
          idempotencyKey: "single-flight-export",
          organizationId: ORGANIZATION_ID,
          previewDigest: firstPreview.previewDigest,
          previewId: firstPreview.previewId,
          principalId: "principal.other",
          projectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({ code: "invalid-request" });
      expect(value.github.sessionsOpened - sessionsBeforeExecution).toBe(1);
    } finally {
      value.github.releaseHeldInstallationSession();
    }
    await firstExecution;
    expect(value.github.pullRequestCount).toBe(1);
    expect(value.github.sessionsOpened - sessionsBeforeExecution).toBe(1);
  });

  it("never lets a stale execution attempt overwrite the canonical success", async () => {
    const value = setup();
    const candidate = await preview(value);
    await execute(value, candidate, "stale-loser-export");
    const [key, successful] = latestSucceededExecution(value);
    const {
      authority: ignoredAuthority,
      failureCode: ignoredFailure,
      receipt: ignoredReceipt,
      ...staleFields
    } = successful;
    void ignoredAuthority;
    void ignoredFailure;
    void ignoredReceipt;
    const staleResult = await value.store.saveExecution({
      attemptId: "attempt.stale-loser",
      record: {
        ...staleFields,
        failureCode: "service-unavailable",
        state: "failed-transient",
        updatedAt: "2026-08-23T12:01:00.000Z",
      },
    });

    expect(staleResult).toEqual({ outcome: "stale", record: successful });
    expect(value.store.executions.get(key)).toEqual(successful);
  });

  it("returns only an exact sealed success after losing a progress-save CAS", async () => {
    const source = setup();
    const sourcePreview = await preview(source);
    await execute(source, sourcePreview, "stale-cas-source-success");
    const [, template] = latestSucceededExecution(source);
    const value = setup();
    const candidate = await preview(value);
    let winner: StoredGitHubExportExecution | undefined;
    replaceNextExecutionSaveWithStaleRecord(value, (running) => {
      winner = rebindSuccessfulExecutionForStaleSave(template, running);
      return winner;
    });

    const receipt = await execute(value, candidate, "stale-cas-exact-winner");

    if (winner?.receipt === undefined) {
      throw new Error("Expected an injected successful CAS winner.");
    }
    expect(receipt).toEqual(winner.receipt);
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects malformed terminal evidence after losing a progress-save CAS", async () => {
    const source = setup();
    const sourcePreview = await preview(source);
    await execute(source, sourcePreview, "stale-cas-malformed-source");
    const [, template] = latestSucceededExecution(source);
    const value = setup();
    const candidate = await preview(value);
    replaceNextExecutionSaveWithStaleRecord(value, (running) => {
      const rebound = rebindSuccessfulExecutionForStaleSave(template, running);
      if (rebound.authority === undefined) {
        throw new Error("Expected rebound authority.");
      }
      return {
        ...rebound,
        authority: {
          ...rebound.authority,
          authorityDigest: sha256Digest("malformed stale CAS authority"),
        },
      };
    });

    await expect(
      execute(value, candidate, "stale-cas-malformed-winner"),
    ).rejects.toMatchObject({
      code: "service-unavailable",
      transient: true,
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects a differently bound success after losing the failure-save CAS", async () => {
    const source = setup();
    const sourcePreview = await preview(source);
    await execute(source, sourcePreview, "stale-cas-mismatch-source");
    const [, template] = latestSucceededExecution(source);
    const value = setup();
    const candidate = await preview(value);
    value.github.failNext("read-snapshot");
    replaceNextExecutionSaveWithStaleRecord(value, (running) => ({
      ...rebindSuccessfulExecutionForStaleSave(template, running),
      createdByPrincipalId: "principal.other",
      previewId: "preview.other",
    }));

    await expect(
      execute(value, candidate, "stale-cas-mismatched-winner"),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects malformed success writes and refuses malformed terminal replay", async () => {
    const source = setup();
    const candidate = await preview(source);
    await execute(source, candidate, "terminal-template-export");
    const [sourceKey, template] = latestSucceededExecution(source);
    const { authority, receipt } = template;
    if (authority === undefined || receipt === undefined) {
      throw new Error("Expected successful terminal template.");
    }
    const {
      authority: ignoredAuthority,
      commitSha: ignoredCommitSha,
      failureCode: ignoredFailure,
      receipt: ignoredReceipt,
      ...initialFields
    } = template;
    void ignoredAuthority;
    void ignoredCommitSha;
    void ignoredFailure;
    void ignoredReceipt;
    const store = new InMemoryGitHubExportStore();
    const running = {
      ...initialFields,
      branchCreated: false,
      recordVersion: 1,
      state: "running" as const,
      updatedAt: "2026-08-23T12:00:01.000Z",
    };
    const claim = await store.reserveExecution({
      attemptId: "attempt.terminal-owner",
      record: running,
    });
    if (claim.outcome !== "acquired") {
      throw new Error("Expected fresh fake execution claim.");
    }
    const invalidSuccess = {
      ...claim.record,
      authority,
      commitSha: receipt.commitSha,
      receipt,
      state: "succeeded" as const,
      updatedAt: receipt.completedAt,
    };
    await expect(
      Promise.resolve().then(() =>
        store.saveExecution({
          attemptId: "attempt.terminal-owner",
          record: invalidSuccess,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid-request" });

    const malformedTerminal = {
      ...invalidSuccess,
      authority: {
        ...authority,
        authorityDigest: sha256Digest(
          new TextEncoder().encode("not the canonical authority digest"),
        ),
      },
      branchCreated: true,
    };
    const executionKey = `${running.organizationId}:${running.projectId}:${running.idempotencyKeyDigest}`;
    store.executions.set(executionKey, malformedTerminal);
    await expect(
      Promise.resolve().then(() =>
        store.reserveExecution({
          attemptId: "attempt.terminal-replay",
          record: running,
        }),
      ),
    ).rejects.toMatchObject({
      code: "service-unavailable",
      transient: true,
    });

    const sessionsAfterSuccess = source.github.sessionsOpened;
    source.store.executions.set(sourceKey, {
      ...template,
      authority: {
        ...authority,
        authorityDigest: sha256Digest(
          new TextEncoder().encode("malformed stored terminal authority"),
        ),
      },
    });
    await expect(
      execute(source, candidate, "terminal-template-export"),
    ).rejects.toMatchObject({
      code: "service-unavailable",
      transient: true,
    });
    expect(source.github.sessionsOpened).toBe(sessionsAfterSuccess);
  });

  it("binds included customer CI workflows to their reviewed destination while leaving legacy or omitted workflows relocatable", async () => {
    const artifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({ artifact });
    const candidate = await preview(value, {
      destinationFolder: "solutions/elsewhere",
    });

    expect(candidate.ready).toBe(false);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "repository-workflow-destination-mismatch",
        severity: "error",
      }),
    );

    const omitted = await preview(setup({ artifact }), {
      destinationFolder: "solutions/elsewhere",
      includeWorkflows: false,
    });
    expect(omitted.ready).toBe(true);
    expect(
      omitted.issues.some(
        ({ code }) => code === "repository-workflow-destination-mismatch",
      ),
    ).toBe(false);

    const legacy = await preview(setup(), {
      destinationFolder: "solutions/elsewhere",
    });
    expect(legacy.ready).toBe(true);
  });

  it("requires customer CI repository names, default branch, and immutable IDs to match exactly", async () => {
    const mismatchedArtifacts = [
      approvedArtifactWithCustomerWorkflows({ owner: "different-org" }),
      approvedArtifactWithCustomerWorkflows({ name: "different-repository" }),
      approvedArtifactWithCustomerWorkflows({ defaultBranch: "trunk" }),
      approvedArtifactWithCustomerWorkflows({ repositoryId: "901" }),
      approvedArtifactWithCustomerWorkflows({
        repositoryOwnerId: "501",
      }),
    ];

    for (const artifact of mismatchedArtifacts) {
      const candidate = await preview(setup({ artifact }));
      expect(candidate.ready).toBe(false);
      expect(candidate.issues).toContainEqual(
        expect.objectContaining({
          code: "repository-workflow-repository-mismatch",
          severity: "error",
        }),
      );
    }
  });

  it.each([
    ["repository", { repositoryId: 901 }],
    ["owner", { ownerId: 501 }],
  ] as const)(
    "rejects same-name %s identity replacement after preview",
    async (identity, replacement) => {
      const value = setup({
        artifact: approvedArtifactWithCustomerWorkflows(),
      });
      const candidate = await preview(value);
      expect(candidate.ready).toBe(true);

      value.github.setRepositoryIdentity(
        "example-org",
        "customer-repository",
        replacement,
      );

      await expect(
        execute(value, candidate, `recreated-${identity}`),
      ).rejects.toMatchObject({
        code: "repository-changed",
      });
      expect(value.github.pullRequestCount).toBe(0);
    },
  );

  it("blocks a reviewed plan workflow for a public repository without treating other workflow sets as sensitive", async () => {
    const sensitive = setup({
      artifact: approvedArtifactWithCustomerWorkflows(),
      private: false,
    });
    const blocked = await preview(sensitive);

    expect(blocked.ready).toBe(false);
    expect(blocked.issues).toContainEqual({
      code: "public-repository-plan-workflow-denied",
      message:
        "The reviewed plan workflow can only be exported to a private repository.",
      path: PLAN_WORKFLOW_PATH,
      severity: "error",
    });
    await expect(
      execute(sensitive, blocked, "public-plan-workflow"),
    ).rejects.toMatchObject({ code: "preview-blocked" });
    expect(sensitive.github.pullRequestCount).toBe(0);

    const validationOnly = setup({ private: false });
    const allowed = await preview(validationOnly);
    expect(allowed.ready).toBe(true);
    expect(
      allowed.issues.some(
        ({ code }) => code === "public-repository-plan-workflow-denied",
      ),
    ).toBe(false);

    const omittedSensitive = setup({
      artifact: approvedArtifactWithCustomerWorkflows(),
      private: false,
    });
    const omitted = await preview(omittedSensitive, {
      includeWorkflows: false,
    });
    expect(omitted.ready).toBe(true);
    expect(omitted.workflowFiles).toEqual([]);
    expect(
      omitted.issues.some(
        ({ code }) => code === "public-repository-plan-workflow-denied",
      ),
    ).toBe(false);
    await expect(execute(omittedSensitive, omitted)).resolves.toMatchObject({
      pullRequestNumber: 1,
    });
  });

  it("rechecks live repository visibility before exporting a reviewed plan workflow", async () => {
    const value = setup({ artifact: approvedArtifactWithCustomerWorkflows() });
    const candidate = await preview(value);
    value.github.setRepositoryPrivate(
      "example-org",
      "customer-repository",
      false,
    );

    await expect(
      execute(value, candidate, "repository-became-public"),
    ).rejects.toMatchObject({
      code: "public-repository-workflow-denied",
      message:
        "The reviewed plan workflow can only be exported to a private repository.",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects a stable repository ID whose owner or name changes after preview", async () => {
    const value = setup({ artifact: approvedArtifactWithCustomerWorkflows() });
    const candidate = await preview(value);
    const stored = [...value.store.repositories.entries()][0];
    if (stored === undefined) {
      throw new Error("Expected the selected repository record.");
    }
    const [key, repository] = stored;
    value.store.repositories.set(key, {
      ...repository,
      name: "transferred-repository",
      owner: "transferred-org",
    });

    await expect(
      execute(value, candidate, "repository-transferred-after-preview"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("preserves retired reviewed workflows and blocks legacy replacement without verified previous-export authority", async () => {
    const priorArtifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({
      artifact: approvedArtifact(),
      baseFiles: repositoryFilesForArtifact(priorArtifact),
    });
    const candidate = await preview(value);
    const retiredPaths = [
      ".github/workflows/cloudmarkup-deploy.yml",
      ".github/workflows/cloudmarkup-drift.yml",
      ".github/workflows/cloudmarkup-plan.yml",
      ".github/workflows/cloudmarkup-smoke.yml",
    ];

    expect(candidate.ready).toBe(false);
    expect(
      candidate.changes
        .filter(({ path }) => retiredPaths.includes(path))
        .map(({ action, path }) => ({ action, path })),
    ).toEqual(retiredPaths.map((path) => ({ action: "preserve", path })));
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "previous-export-authority-missing",
        severity: "error",
      }),
    );
    await expect(
      execute(value, candidate, "legacy-workflow-replacement"),
    ).rejects.toMatchObject({ code: "preview-blocked" });
  });

  it("preserves all five prior reviewed workflows when workflow export is explicitly omitted", async () => {
    const artifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({
      artifact,
      baseFiles: repositoryFilesForArtifact(artifact),
      workflows: "none",
    });
    const candidate = await preview(value, { includeWorkflows: false });
    const expectedPaths = [
      ".github/workflows/cloudmarkup-deploy.yml",
      ".github/workflows/cloudmarkup-drift.yml",
      ".github/workflows/cloudmarkup-plan.yml",
      ".github/workflows/cloudmarkup-smoke.yml",
      ".github/workflows/cloudmarkup-validate.yml",
    ];

    expect(candidate.ready).toBe(true);
    expect(
      candidate.changes
        .filter(({ workflow }) => workflow)
        .map(({ action, path }) => ({ action, path })),
    ).toEqual(expectedPaths.map((path) => ({ action: "preserve", path })));

    await execute(value, candidate, "omit-prior-workflows");
    const branch = value.github.branchFiles(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
    );
    expect(expectedPaths.every((path) => branch.has(path))).toBe(true);
    expect(
      value.github.requestedSessions.every(
        ({ permissions }) => permissions.workflows === "none",
      ),
    ).toBe(true);
  });

  it("fails the stale check when a retired reviewed workflow changes after preview", async () => {
    const priorArtifact = approvedArtifactWithCustomerWorkflows();
    const value = setup({
      artifact: priorArtifact,
      baseFiles: repositoryFilesForArtifact(priorArtifact),
    });
    const candidate = await preview(value);
    value.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      ".github/workflows/cloudmarkup-deploy.yml",
      "changed after preview",
    );

    await expect(
      execute(value, candidate, "stale-retired-workflow"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects a package whose only workflow is not the exact credentialless validator", async () => {
    const value = setup({ artifact: artifactWithOnlyPlanWorkflow() });
    const candidate = await preview(value);

    expect(candidate.ready).toBe(false);
    expect(candidate.workflowFiles).toEqual([
      expect.objectContaining({ path: PLAN_WORKFLOW_PATH }),
    ]);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "credentialless-workflow-missing",
        path: VALIDATION_WORKFLOW_PATH,
        severity: "error",
      }),
    );
    await expect(execute(value, candidate)).rejects.toMatchObject({
      code: "preview-blocked",
    });
  });

  it("requires immutable binding for any privileged workflow subset during preview and execution", async () => {
    const artifact = legacyUnboundArtifactWithWorkflows([
      VALIDATION_WORKFLOW_PATH,
      PLAN_WORKFLOW_PATH,
    ]);
    expect(verifySolutionExportArtifact(artifact)).toEqual([]);
    const value = setup({ artifact });
    const candidate = await preview(value);

    expect(candidate.ready).toBe(false);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "repository-workflow-binding-missing",
        severity: "error",
      }),
    );
    await expect(
      execute(value, candidate, "portable-privileged-subset"),
    ).rejects.toMatchObject({ code: "preview-blocked" });

    const stored = await value.store.getPreview({
      organizationId: ORGANIZATION_ID,
      previewId: candidate.previewId,
      projectId: PROJECT_ID,
    });
    if (stored === null) throw new Error("Expected stored preview fixture.");
    const { previewDigest: ignoredPreviewDigest, ...blockedProjection } =
      candidate;
    void ignoredPreviewDigest;
    const forgedProjection = {
      ...blockedProjection,
      issues: [],
      ready: true,
    };
    const forgedPreview = gitHubExportPreviewSchema.parse({
      ...forgedProjection,
      previewDigest: canonicalDigest(forgedProjection),
    });
    await value.store.savePreview({ ...stored, preview: forgedPreview });

    await expect(
      execute(value, forgedPreview, "portable-privileged-forged-preview"),
    ).rejects.toMatchObject({ code: "artifact-invalid" });
    expect(value.github.pullRequestCount).toBe(0);
  });
  it("does not request workflow permission when workflows are omitted and reports exact readiness", async () => {
    const value = setup({ workflows: "none" });
    const candidate = await preview(value, { includeWorkflows: false });

    expect(candidate.ready).toBe(true);
    expect(candidate.workflowFiles).toEqual([]);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "workflow-files-omitted",
        severity: "warning",
      }),
    );
    await execute(value, candidate);
    expect(
      value.github.requestedSessions.every(
        ({ permissions }) => permissions.workflows === "none",
      ),
    ).toBe(true);
    expect(
      value.github
        .branchFiles(
          "example-org",
          "customer-repository",
          "cloudmarkup/notes-api",
        )
        .has(".github/workflows/cloudmarkup-validate.yml"),
    ).toBe(false);
  });

  it("blocks workflow export when the App lacks permission and never expands it", async () => {
    const value = setup({ workflows: "none" });
    const candidate = await preview(value);
    expect(candidate.ready).toBe(false);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({ code: "workflow-permission-unavailable" }),
    );
    await expect(execute(value, candidate)).rejects.toMatchObject({
      code: "preview-blocked",
    });
    expect(
      value.github.requestedSessions.every(
        ({ permissions }) => permissions.workflows === "none",
      ),
    ).toBe(true);
  });

  it("requires exact confirmation of every previewed workflow file", async () => {
    const value = setup();
    const candidate = await preview(value);
    await expect(
      value.service.execute({
        confirmedWorkflowFiles: [],
        correlationId: "correlation.execute",
        idempotencyKey: "missing-confirmation",
        organizationId: ORGANIZATION_ID,
        previewDigest: candidate.previewDigest,
        previewId: candidate.previewId,
        principalId: PRINCIPAL_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toMatchObject({ code: "workflow-confirmation-required" });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("never trusts a forged repository manifest to overwrite customer-owned content", async () => {
    const artifact = approvedArtifact();
    const value = setup({
      artifact,
      baseFiles: repositoryFilesWithForgedGeneratedOverride(artifact),
    });
    const candidate = await preview(value);

    expect(candidate.ready).toBe(false);
    expect(candidate.changes).toContainEqual(
      expect.objectContaining({
        action: "preserve",
        path: "solutions/notes-api/cloudmarkup/architecture.json",
      }),
    );
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "previous-export-authority-missing",
        severity: "error",
      }),
    );
    await expect(
      execute(value, candidate, "forged-ownership-manifest"),
    ).rejects.toMatchObject({
      code: "preview-blocked",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("does not acquire ownership of identical unmanaged repository bytes", async () => {
    const artifact = approvedArtifact();
    const architecture = artifact.files.find(
      ({ path }) => path === "cloudmarkup/architecture.json",
    );
    if (architecture === undefined) {
      throw new Error("Expected architecture source fixture.");
    }
    const repositoryPath = "solutions/notes-api/cloudmarkup/architecture.json";
    const value = setup({
      artifact,
      baseFiles: { [repositoryPath]: architecture.bytes },
    });
    const link = await linked(value);
    const initial = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/unmanaged-baseline",
    });
    expect(initial.ready).toBe(true);
    expect(initial.changes).toContainEqual(
      expect.objectContaining({
        action: "unchanged",
        path: repositoryPath,
      }),
    );

    await execute(value, initial, "unmanaged-baseline-export");
    const [, successful] = latestSucceededExecution(value);
    expect(
      successful.authority?.files.some(({ path }) => path === repositoryPath),
    ).toBe(false);

    value.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      repositoryPath,
      "Customer changed this pre-existing file.\n",
    );
    const replacement = await previewForLinked(value, link, {
      featureBranch: "cloudmarkup/unmanaged-replacement",
    });
    expect(replacement.ready).toBe(false);
    expect(replacement.changes).toContainEqual(
      expect.objectContaining({
        action: "preserve",
        path: repositoryPath,
      }),
    );
    expect(replacement.issues).toContainEqual(
      expect.objectContaining({
        code: "previous-export-authority-missing",
        severity: "error",
      }),
    );
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("marks unmanaged collisions and changed generated files without overwriting", async () => {
    const value = setup();
    value.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      "solutions/notes-api/README.md",
      "User-authored README.\n",
    );
    const candidate = await preview(value);
    expect(candidate.ready).toBe(false);
    expect(candidate.changes).toContainEqual(
      expect.objectContaining({
        action: "preserve",
        path: "solutions/notes-api/README.md",
      }),
    );
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "previous-export-authority-missing",
      }),
    );
  });

  it.each([
    {
      baseFiles: {
        "solutions/notes-api/readme.md": "Case-fold collision.\n",
      },
      kind: "case-fold",
    },
    {
      baseFiles: {
        "solutions/notes-api/caf\u00e9.txt": "Composed path.\n",
        "solutions/notes-api/cafe\u0301.txt": "Decomposed path.\n",
      },
      kind: "NFC-normalized",
    },
  ])(
    "rejects $kind portable path collisions across the approved artifact and live snapshot",
    async ({ baseFiles }) => {
      const value = setup({ baseFiles });

      await expect(preview(value)).rejects.toMatchObject({
        code: "destination-invalid",
      });
      expect(value.github.pullRequestCount).toBe(0);
    },
  );

  it.each([
    {
      baseFiles: {
        "solutions/notes-api/README.md/customer.txt":
          "Customer-owned subtree.\n",
      },
      code: "path-conflict",
      kind: "candidate file over a user-owned subtree",
    },
    {
      baseFiles: {
        ".github/workflows/cloudmarkup-validate.yml/customer.txt":
          "Customer-owned workflow subtree.\n",
      },
      code: "path-conflict",
      kind: "exact reviewed workflow over a user-owned subtree",
    },
    {
      baseFiles: {
        "Solutions/Notes-Api/customer.txt": "Differently cased destination.\n",
      },
      code: "destination-invalid",
      kind: "differently cased destination",
    },
    {
      baseFiles: {
        ".github/workflows/CloudMarkup-Validate.yml":
          "Differently cased workflow.\n",
      },
      code: "destination-invalid",
      kind: "differently cased reviewed workflow",
    },
  ])(
    "rejects $kind from full tree metadata before preview or mutation",
    async ({ baseFiles, code }) => {
      const value = setup({ baseFiles });

      await expect(preview(value)).rejects.toMatchObject({ code });
      expect(value.github.pullRequestCount).toBe(0);
    },
  );

  it("keeps a safe unrelated tree outside the scoped snapshot and preserves it on the feature branch", async () => {
    const unrelatedPath = "docs/customer/guide.md";
    const unrelatedText = "Customer documentation outside the export.\n";
    const value = setup({
      baseFiles: { [unrelatedPath]: unrelatedText },
    });

    const candidate = await preview(value);
    expect(candidate.ready).toBe(true);
    expect(candidate.changes.some(({ path }) => path === unrelatedPath)).toBe(
      false,
    );

    await execute(value, candidate, "safe-unrelated-tree");
    const branch = value.github.branchFiles(
      "example-org",
      "customer-repository",
      candidate.featureBranch,
    );
    expect(new TextDecoder().decode(branch.get(unrelatedPath))).toBe(
      unrelatedText,
    );
  });

  it("detects base and affected-file changes since preview before mutation", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.setFile(
      "example-org",
      "customer-repository",
      "main",
      "solutions/notes-api/new-customer-file.txt",
      "changed after preview",
    );
    await expect(execute(value, candidate)).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("recovers ambiguous commit and PR responses and retries without duplicates", async () => {
    const commitFailure = setup();
    const firstPreview = await preview(commitFailure);
    commitFailure.github.failNext("create-commit-after-update");
    await expect(
      execute(commitFailure, firstPreview, "commit-retry"),
    ).rejects.toMatchObject({
      transient: true,
    });
    const recoveredCommit = await execute(
      commitFailure,
      firstPreview,
      "commit-retry",
    );
    expect(recoveredCommit.pullRequestNumber).toBe(1);
    expect(commitFailure.github.pullRequestCount).toBe(1);

    const prFailure = setup();
    const secondPreview = await preview(prFailure);
    prFailure.github.failNext("create-pull-request-after-create");
    await expect(
      execute(prFailure, secondPreview, "pr-retry"),
    ).rejects.toMatchObject({
      transient: true,
    });
    const recoveredPr = await execute(prFailure, secondPreview, "pr-retry");
    const duplicate = await execute(prFailure, secondPreview, "pr-retry");
    expect(duplicate).toEqual(recoveredPr);
    expect(prFailure.github.pullRequestCount).toBe(1);
  });

  it("rejects ambiguous commit recovery when the feature branch has any extra commit or file", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.failNext("create-commit-after-update");
    await expect(
      execute(value, candidate, "tampered-commit-retry"),
    ).rejects.toMatchObject({
      transient: true,
    });
    value.github.setFile(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
      ".github/workflows/unreviewed.yml",
      "name: unreviewed",
    );

    await expect(
      execute(value, candidate, "tampered-commit-retry"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rechecks the exact feature head before recovering or creating a pull request", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.failNext("create-pull-request-after-create");
    await expect(
      execute(value, candidate, "moved-pr-retry"),
    ).rejects.toMatchObject({
      transient: true,
    });
    expect(value.github.pullRequestCount).toBe(1);
    value.github.setFile(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
      "solutions/notes-api/UNREVIEWED.md",
      "changed after the approved commit",
    );

    await expect(
      execute(value, candidate, "moved-pr-retry"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("fails closed when the feature head moves between pull request lookup and creation", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.changeFeatureHeadAfterNextPullRequestLookup(
      ".github/workflows/unreviewed.yml",
      "name: unreviewed",
    );

    await expect(
      execute(value, candidate, "pull-request-head-race"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("fails closed when the base head moves after pull request lookup", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.changeBaseHeadAfterNextPullRequestLookup(
      "solutions/notes-api/BASE-MOVED.md",
      "changed before pull request creation",
    );

    await expect(
      execute(value, candidate, "pull-request-base-race"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("fails closed when the final merge base does not match the reviewed base", async () => {
    const value = setup();
    const candidate = await preview(value);
    value.github.returnMergeBaseOnce("f".repeat(40));

    await expect(
      execute(value, candidate, "pull-request-merge-base-race"),
    ).rejects.toMatchObject({
      code: "repository-changed",
    });
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("fails safely for existing feature names and feature-branch protection rules", async () => {
    const existing = setup({ existingFeatureBranch: true });
    const existingPreview = await preview(existing);
    await expect(execute(existing, existingPreview)).rejects.toMatchObject({
      code: "branch-conflict",
    });
    expect(existing.github.pullRequestCount).toBe(0);

    const protectedRepository = setup({ protectFeatureBranches: true });
    const protectedPreview = await preview(protectedRepository);
    await expect(
      execute(protectedRepository, protectedPreview),
    ).rejects.toMatchObject({ code: "github-permission-denied" });
    expect(protectedRepository.github.pullRequestCount).toBe(0);
    expect(
      protectedRepository.github.branchFiles(
        "example-org",
        "customer-repository",
        "main",
      ),
    ).toEqual(
      new Map([
        [
          "solutions/notes-api/CUSTOMER.md",
          new TextEncoder().encode("Customer-owned and unrelated.\n"),
        ],
      ]),
    );
  });

  it("warns when the prior repository package uses a different generator pin", async () => {
    const value = setup();
    const first = await preview(value, { includeWorkflows: false });
    await execute(value, first);
    const manifestPath =
      "solutions/notes-api/cloudmarkup/cloudmarkup.manifest.json";
    const branchFiles = value.github.branchFiles(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
    );
    const currentManifest = branchFiles.get(manifestPath);
    if (currentManifest === undefined)
      throw new Error("Expected prior manifest.");
    const prior = JSON.parse(new TextDecoder().decode(currentManifest)) as {
      tools: {
        generator: null | { digest: string; id: string; version: string };
        renderer: { digest: string; id: string; version: string };
      };
    };
    prior.tools.generator = {
      ...prior.tools.renderer,
      id: "cloudmarkup.application-generator",
      version: "9.9.9",
    };
    value.github.setFile(
      "example-org",
      "customer-repository",
      "cloudmarkup/notes-api",
      manifestPath,
      JSON.stringify(prior),
    );
    const { installation, repository } = await linked(value);

    const candidate = await value.service.createPreview({
      artifactId: ARTIFACT_ID,
      baseBranch: "cloudmarkup/notes-api",
      correlationId: "correlation.preview.generator-mismatch",
      destinationFolder: "solutions/notes-api",
      featureBranch: "cloudmarkup/notes-api-v2",
      includeWorkflows: false,
      integrationId: installation.integrationId,
      organizationId: ORGANIZATION_ID,
      principalId: PRINCIPAL_ID,
      projectId: PROJECT_ID,
      repositoryId: repository.repositoryId,
    });

    expect(candidate.issues).toContainEqual(
      expect.objectContaining({
        code: "generator-lock-mismatch",
        severity: "warning",
      }),
    );
    expect(value.github.pullRequestCount).toBe(1);
  });

  it("reports oversized repository binaries before any mutation", async () => {
    const value = setup();
    const oversized = new Uint8Array(16 * 1024 * 1024 + 1);
    const checksum = sha256Digest(oversized);
    const fixture = workflowFixture("infrastructure-only");
    const generated = generateSolutionExport({
      architectureDocument: fixture.generationRequest.architectureDocument,
      contractVersion: 1,
      existingFiles: [],
      infrastructure: projectGoCompilationResultToSolutionExportInfrastructure(
        fixture.compilation,
      ),
      solutionRevision: fixture.generationRequest.solutionRevision,
      supplementalFiles: [
        {
          checksum,
          content: {
            encoding: "utf8",
            value: "\0".repeat(oversized.byteLength),
          },
          kind: "regular-file",
          mediaType: "application/pdf",
          ownership: "evidence-artifact",
          path: "evidence/oversized.pdf",
          provenance:
            value.artifact.files[0]?.provenance ??
            (() => {
              throw new Error("Expected base artifact provenance.");
            })(),
          semanticChecksum: checksum,
        },
      ],
      target: {
        exportName: "GitHub Notes API",
        limits: {
          ...TEST_TARGET_SETTINGS.limits,
          maxArchiveBytes: 64 * 1024 * 1024,
          maxDecompressedBytes: 64 * 1024 * 1024,
          maxFileBytes: 32 * 1024 * 1024,
        },
        policyPacks: TEST_TARGET_SETTINGS.policyPacks,
        renderer: TEST_RENDERER,
        target: TEST_TARGET_SETTINGS.target,
      },
    });
    expect(generated.state).toBe("ready");
    if (generated.state !== "ready") return;
    value.artifacts.add({
      artifact: generated.artifact,
      artifactId: ARTIFACT_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });

    const candidate = await preview(value);

    expect(candidate.ready).toBe(false);
    expect(candidate.issues).toContainEqual(
      expect.objectContaining({ code: "repository-binary-policy-blocked" }),
    );
    expect(value.github.pullRequestCount).toBe(0);
  });

  it("rejects the default branch and revoked installations", async () => {
    const value = setup();
    const { installation, repository } = await linked(value);
    await expect(
      value.service.createPreview({
        artifactId: ARTIFACT_ID,
        baseBranch: "main",
        correlationId: "correlation.preview",
        destinationFolder: "solutions/notes-api",
        featureBranch: "main",
        includeWorkflows: false,
        integrationId: installation.integrationId,
        organizationId: ORGANIZATION_ID,
        principalId: PRINCIPAL_ID,
        projectId: PROJECT_ID,
        repositoryId: repository.repositoryId,
      }),
    ).rejects.toBeInstanceOf(GitHubExportError);
    await value.store.updateInstallationStatus({
      installationId: 77,
      status: "deleted",
      updatedAt: AT.toISOString(),
    });
    await expect(
      value.service.discoverBranches({
        integrationId: installation.integrationId,
        organizationId: ORGANIZATION_ID,
        repositoryId: repository.repositoryId,
      }),
    ).rejects.toMatchObject({ code: "installation-revoked" });
  });
});
