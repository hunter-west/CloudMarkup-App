import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  revisionV1Schema,
  discoverGithubRepositoryV1Schema,
  reviewGithubRepositoryImportV1Schema,
} from "@cloudmarkup/api-contract";
import { createRepositoryBackedApplication } from "./application/repository-backed-application.js";
import type { CloudMarkupApplication } from "./application/ports.js";
import { PostgresCloudMarkupRepository } from "./adapters/persistence/repositories.js";
import { InMemoryObjectStore } from "./adapters/persistence/memory-object-store.js";
import { PostgresProjectEditingLeases } from "./adapters/persistence/project-editing-leases.js";
import { PostgresGitHubRepositoryImportStore } from "./adapters/persistence/github-import-store.js";
import { awsCatalogV1, AWS_CATALOG_DIGEST_V1 } from "@cloudmarkup/provider-aws";
import {
  getArchitectureDocumentCanonicalHash,
  getArchitectureDocumentContentHash,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { FakeGitHubAppAdapter } from "@cloudmarkup/github-repository-export/testing";
import { PostgresDatabase } from "./adapters/persistence/postgres-driver.js";
import { runMigrations } from "./adapters/persistence/migrations.js";
import { loadHistoricalBetaMigrations } from "./adapters/persistence/historical-beta-migrations-test-helper.js";
import { PostgresGitHubExportStore } from "./adapters/persistence/github-export-store.js";
import { sql } from "./adapters/persistence/sql.js";
import { createPinnedTerraformHclInspector } from "./adapters/pinned-terraform-inspector.js";
import { buildSolutionRevisionV1 } from "./application/solution-revision-builder.js";
import { createProductionGitHubImports } from "./production-github-imports.js";
import { createApp } from "./app.js";
import {
  FixedPrincipalResolver,
  InMemoryCloudMarkupApplication,
} from "./testing/in-memory-adapters.js";

const databaseUrl = process.env["CLOUDMARKUP_TEST_DATABASE_URL"];
const executablePath = process.env["CLOUDMARKUP_TEST_COMPILER_EXECUTABLE"];
const executableSha256 = process.env["CLOUDMARKUP_TEST_COMPILER_SHA256"];
const configured =
  databaseUrl !== undefined &&
  executablePath !== undefined &&
  executableSha256 !== undefined;
const schema = `cm_hosted_import_it_${randomUUID().replaceAll("-", "")}`;
const marker = `CloudMarkup synthetic hosted import ${schema}`;

describe.skipIf(!configured)(
  "hosted repository import with PostgreSQL and the real Go parser",
  () => {
    let admin: PostgresDatabase | undefined;
    let database: PostgresDatabase;
    let created = false;
    beforeAll(async () => {
      const url = new URL(databaseUrl ?? "");
      if (
        !["postgresql:", "postgres:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.search !== "" ||
        url.hash !== "" ||
        !/^cm_hosted_import_it_[a-f0-9]{32}$/u.test(schema)
      )
        throw new Error("An explicit synthetic loopback database is required.");
      admin = new PostgresDatabase({
        connectionString: url.href,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      await admin.transaction(async (tx) => {
        await tx.query(sql(`CREATE SCHEMA "${schema}"`));
        await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
      });
      created = true;
      database = new PostgresDatabase({
        connectionString: url.href,
        max: 3,
        connectionTimeoutMillis: 5000,
        options: `-c search_path=${schema} -c timezone=UTC`,
      });
      await runMigrations(
        database,
        await loadHistoricalBetaMigrations(
          fileURLToPath(new URL("../migrations", import.meta.url)),
        ),
      );
    }, 60000);
    afterAll(async () => {
      // A failed beforeAll may leave the connection uninitialized.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      await database?.close();
      try {
        if (created && admin !== undefined) {
          const found = await admin.query(
            sql(
              "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
              [schema],
            ),
          );
          if (
            found.rows[0]?.["marker"] !== marker ||
            !/^cm_hosted_import_it_[a-f0-9]{32}$/u.test(schema)
          )
            throw new Error("Refusing to remove an unverified schema.");
          await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
        }
      } finally {
        await admin?.close();
      }
    }, 30000);

    async function fixture(importable = false) {
      const id = (prefix: string) =>
        `${prefix}_${randomUUID().replaceAll("-", "")}`;
      const organizationId = id("org"),
        integrationId = id("integration");
      const now = new Date().toISOString();
      const principal = {
        principalId: id("principal"),
        sessionId: id("session"),
        correlationId: id("correlation"),
        authenticatedAt: now,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        authenticationSource: "test" as const,
      };
      await database.transaction(async (tx) => {
        await tx.query(
          sql(
            "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic import owner')",
            [principal.principalId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic import',$2)",
            [organizationId, organizationId.replaceAll("_", "-")],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT $1,role,'authorization-v2',role='owner',cloudmarkup_authorization_v2_permissions(role) FROM unnest(ARRAY['owner','viewer']) role",
            [organizationId],
          ),
        );
        await tx.query(
          sql(
            "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
            [id("membership"), organizationId, principal.principalId],
          ),
        );
      });
      const installationId = Number.parseInt(
        randomUUID().replaceAll("-", "").slice(0, 10),
        16,
      );
      const installation = {
        accountId: 31,
        accountLogin: "synthetic",
        accountType: "Organization" as const,
        installationId,
        repositorySelection: "selected" as const,
        permissions: {
          contents: "read" as const,
          metadata: "read" as const,
          pullRequests: "none" as const,
          workflows: "none" as const,
        },
      };
      const directory = new PostgresGitHubExportStore(database);
      await directory.saveInstallation({
        ...installation,
        organizationId,
        integrationId,
        status: "connected",
        createdAt: now,
        updatedAt: now,
      });
      const repositoryId = installationId + 1;
      const repository = {
        repositoryId,
        installationId,
        owner: "synthetic",
        name: "source",
        nodeId: "R_synthetic",
        private: true,
        archived: false,
        disabled: false,
        defaultBranch: "main",
        pushedAt: now,
      };
      await directory.saveRepositories({
        organizationId,
        integrationId,
        installationId,
        repositories: [
          { ...repository, organizationId, integrationId, updatedAt: now },
        ],
      });
      const github = new FakeGitHubAppAdapter();
      github.addInstallation({ ...installation, suspended: false });
      github.addRepository(
        { ...repository, ownerId: 31 },
        {
          main: {
            "main.tf":
              'resource "aws_sqs_queue" "incoming" {\n name = "synthetic-incoming"\n}\n',
            "consumer.tf":
              'resource "aws_lambda_function" "consumer" {\n function_name = "synthetic-consumer"\n environment { variables = { QUEUE_URL = aws_sqs_queue.incoming.url } }\n}\n',
            ".env": "PASSWORD=synthetic-never-return-this",
          },
        },
      );
      const source = JSON.parse(
        await readFile(
          new URL(
            "../../../packages/architecture-cli/src/fixtures/aws-eventing/compiler-v1/sqs-consumer-dlq/source.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const seedDocument = {
        ...parseArchitectureDocument(source["architectureDocument"]),
        catalog: {
          id: awsCatalogV1.artifact.catalog.id,
          version: awsCatalogV1.artifact.catalog.version,
          digest: AWS_CATALOG_DIGEST_V1,
        },
      };
      const objects = new InMemoryObjectStore();
      const application = createRepositoryBackedApplication({
        draftEditingLeases: "required",
        fallback: {} as CloudMarkupApplication,
        identifierNamespace: "import-test",
        objectStore: objects,
        repository: new PostgresCloudMarkupRepository(database, {
          draftEditingLeases: "required",
        }),
        organizationForProject: () => organizationId,
        organizationForRequestedScope: () => organizationId,
      });
      const createdProject = await application.createProject(
        principal,
        organizationId,
        {
          creationMode: "draft-copy",
          name: "Synthetic import",
          architectureDocument: seedDocument,
        },
        id("create"),
      );
      const projectId = createdProject.project.id;
      const current = await application.getDraft(principal, projectId);
      const document = parseArchitectureDocument(
        current.value.architectureDocument,
      );
      const leases = new PostgresProjectEditingLeases(database);
      const leaseToken = randomBytes(32).toString("base64url");
      const lease = await leases.acquire(principal, projectId, {
        token: leaseToken,
      });
      if (lease.state !== "owned")
        throw new Error("Missing synthetic editing lease.");
      const editingLease = { leaseId: lease.leaseId, token: leaseToken };
      if (importable) {
        const node = document.nodes.find(
          (candidate) => candidate.semantic.lifecycle.ownership === "user",
        );
        if (node === undefined) throw new Error("Missing import fixture node.");
        const imported = parseArchitectureDocument({
          ...document,
          nodes: [
            ...document.nodes,
            {
              ...node,
              id: "node_imported_extra",
              semantic: { ...node.semantic, deploymentKey: "imported_extra" },
            },
          ],
        });
        github.addRepository(
          { ...repository, ownerId: 31 },
          {
            main: { "cloudmarkup/architecture.json": JSON.stringify(imported) },
          },
        );
      }
      const commitSha = await github.withRepositoryReadSession(
        { installationId, repositoryIds: [repositoryId] },
        async (session) =>
          (await session.listBranches({ ...repository, ownerId: 31 }))[0]?.sha,
      );
      if (commitSha === undefined) throw new Error("Synthetic branch missing.");
      const solution = buildSolutionRevisionV1({
        name: "Import baseline",
        solutionRevisionId: id("solution_revision"),
        revision: revisionV1Schema.parse({
          architectureDocument: document,
          catalogDigest: document.catalog.digest,
          catalogId: document.catalog.id,
          catalogVersion: document.catalog.version,
          contentDigest: getArchitectureDocumentContentHash(document),
          documentDigest: getArchitectureDocumentCanonicalHash(document),
          createdAt: now,
          createdBy: {
            id: principal.principalId,
            displayName: "Synthetic owner",
          },
          graphSchemaVersion: 3,
          id: id("revision"),
          name: "Import baseline",
          projectId,
          sourceDraftId: current.value.id,
          sourceDraftVersion: 1,
          storageStatus: "published",
          workloadBehaviorVersion: 2,
        }),
      });
      const listSolutionRevisions = vi.fn(() =>
        Promise.resolve({
          items: [solution.summary],
        }),
      );
      const imports = createProductionGitHubImports({
        database,
        hclInspector: createPinnedTerraformHclInspector({
          executablePath: executablePath ?? "",
          executableSha256: executableSha256 ?? "",
        }),
        organizationForProject: () => Promise.resolve(organizationId),
        application: {
          listSolutionRevisions,
          getSolutionRevision: () => Promise.resolve(solution),
          applyDraftCommand: application.applyDraftCommand.bind(application),
        },
        createGitHub: (authorize) => ({
          inspectInstallation: async (value) => {
            await authorize();
            return github.inspectInstallation(value);
          },
          withInstallationSession: (input, work) =>
            github.withInstallationSession(input, work),
          withRepositoryReadSession: async (input, work) => {
            await authorize();
            return github.withRepositoryReadSession(input, work);
          },
        }),
      });
      const app = createApp({
        application: new InMemoryCloudMarkupApplication({}),
        githubImports: imports,
        principalResolver: new FixedPrincipalResolver({
          "Bearer synthetic-import": principal,
        }),
      });
      const body = {
        branch: "main",
        commitSha,
        contractVersion: 1,
        integrationId,
        repositoryId,
        ignoredPaths: [".env"],
        selectedPaths: ["."],
        requestedMode: "guided",
      };
      const request = () =>
        app.request(`/v1/projects/${projectId}/github-repository-imports`, {
          method: "POST",
          headers: {
            authorization: "Bearer synthetic-import",
            "content-type": "application/json",
            "idempotency-key": "synthetic-import-once",
          },
          body: JSON.stringify(body),
        });
      const accept = async (
        draftAcceptance: unknown = {
          expectedDraftEtag: current.etag,
          editingLease,
        },
      ) => {
        const importedResponse = await request();
        if (importedResponse.status !== 201)
          throw new Error(await importedResponse.text());
        const records = await imports.listImports(principal, projectId);
        const imported = records[0];
        const operation = imported?.semanticDifferences.find(
          (entry) => entry.operationKind === "accept-observed-graph-change",
        );
        if (imported === undefined || operation?.operationId === undefined)
          throw new Error("No exact graph operation was proposed.");
        return imports.review(
          principal,
          projectId,
          imported.importId,
          reviewGithubRepositoryImportV1Schema.parse({
            contractVersion: 1,
            decision: "accept-into-design",
            expectedSnapshotDigest: imported.snapshotDigest,
            operationId: operation.operationId,
            ...(draftAcceptance === null ? {} : { draftAcceptance }),
          }),
          "synthetic-accept-once",
        );
      };
      const discover = () =>
        imports.discoverRepository(
          principal,
          projectId,
          discoverGithubRepositoryV1Schema.parse({
            branch: "main",
            commitSha,
            contractVersion: 1,
            integrationId,
            repositoryId,
            ignoredPaths: [".env"],
            selectedPaths: ["."],
          }),
        );
      return {
        discover,
        discoveryInput: discoverGithubRepositoryV1Schema.parse({
          branch: "main",
          commitSha,
          contractVersion: 1,
          integrationId,
          repositoryId,
          ignoredPaths: [".env"],
          selectedPaths: ["."],
        }),
        accept,
        application,
        current,
        editingLease,
        objects,
        leases,
        listSolutionRevisions,
        installationId,
        request,
        imports,
        principal,
        projectId,
        organizationId,
        solution,
        github,
      };
    }

    it("discovers metadata without a saved revision, import rows, parsing, or graph changes", async () => {
      const value = await fixture();
      value.listSolutionRevisions.mockResolvedValue({ items: [] });
      const before = JSON.stringify(value.solution);
      const result = await value.discover();
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.some((file) => file.path === ".env")).toBe(false);
      expect(value.listSolutionRevisions).not.toHaveBeenCalled();
      expect(
        await value.imports.listImports(value.principal, value.projectId),
      ).toEqual([]);
      expect(JSON.stringify(value.solution)).toBe(before);
    }, 60000);

    it("denies cross-tenant discovery before opening a repository session", async () => {
      const value = await fixture();
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      await expect(
        value.imports.discoverRepository(
          { ...value.principal, principalId: "principal_foreign" },
          value.projectId,
          value.discoveryInput,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(acquire).not.toHaveBeenCalled();
    }, 60000);

    it("denies a project reader without integration capability before acquisition", async () => {
      const value = await fixture();
      await database.query(
        sql(
          "UPDATE memberships SET role_key='viewer' WHERE organization_id=$1",
          [value.organizationId],
        ),
      );
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      await expect(value.discover()).rejects.toMatchObject({
        code: "access_denied",
      });
      expect(acquire).not.toHaveBeenCalled();
    }, 60000);

    it.each([
      "installation",
      "membership",
      "permissions",
      "installation-permission",
    ] as const)(
      "withholds discovered metadata after %s is revoked during acquisition",
      async (boundary) => {
        const value = await fixture();
        const original = value.github.withRepositoryReadSession.bind(
          value.github,
        );
        const acquisition = vi
          .spyOn(value.github, "withRepositoryReadSession")
          .mockImplementation(async (input, operation) => {
            const result = await original(input, operation);
            if (boundary === "installation")
              await database.query(
                sql(
                  "UPDATE github_app_installations SET lifecycle_status='suspended' WHERE installation_id=$1",
                  [value.installationId],
                ),
              );
            else if (boundary === "installation-permission")
              await database.query(
                sql(
                  "UPDATE github_app_installations SET contents_permission='none' WHERE installation_id=$1",
                  [value.installationId],
                ),
              );
            else if (boundary === "permissions")
              await database.query(
                sql(
                  "UPDATE memberships SET role_key='viewer' WHERE organization_id=$1",
                  [value.organizationId],
                ),
              );
            else
              await database.query(
                sql(
                  "DELETE FROM memberships WHERE organization_id=$1 AND principal_id=$2",
                  [value.organizationId, value.principal.principalId],
                ),
              );
            return result;
          });
        await expect(value.discover()).rejects.toMatchObject({
          code: boundary === "permissions" ? "access_denied" : "not_found",
        });
        expect(acquisition).toHaveBeenCalledOnce();
      },
      60000,
    );

    it.each(["contents", "metadata"] as const)(
      "denies missing current GitHub %s permission before creating a read session",
      async (permission) => {
        const value = await fixture();
        const inspect = value.github.inspectInstallation.bind(value.github);
        vi.spyOn(value.github, "inspectInstallation").mockImplementation(
          async (id) => {
            const descriptor = await inspect(id);
            return {
              ...descriptor,
              permissions: { ...descriptor.permissions, [permission]: "none" },
            };
          },
        );
        const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
        await expect(value.discover()).rejects.toMatchObject({
          code: "not_found",
        });
        expect(acquire).not.toHaveBeenCalled();
      },
      60000,
    );

    it("parses actual HCL, returns resources and connections, persists one pinned import, and leaves the design intact", async () => {
      const value = await fixture();
      const before = JSON.stringify(value.solution);
      const response = await value.request();
      const text = await response.text();
      expect(response.status, text).toBe(201);
      expect(text).not.toContain("synthetic-never-return-this");
      const parsed = JSON.parse(text) as {
        data: {
          importId: string;
          state: string;
          comparisonSolutionRevisionId: string;
          observedSolution: { resources: unknown[]; connections: unknown[] };
        };
      };
      expect(parsed.data.state).toBe("succeeded");
      expect(parsed.data.comparisonSolutionRevisionId).toBe(
        value.solution.summary.solutionRevisionId,
      );
      expect(parsed.data.observedSolution.resources).toHaveLength(2);
      expect(parsed.data.observedSolution.connections.length).toBeGreaterThan(
        0,
      );
      const duplicate = await value.request();
      expect(await duplicate.json()).toMatchObject({
        data: { importId: parsed.data.importId },
      });
      expect(
        await value.imports.listImports(value.principal, value.projectId),
      ).toHaveLength(1);
      expect(JSON.stringify(value.solution)).toBe(before);
    }, 60000);

    it("accepts the exact imported graph through the durable command engine and replays one receipt", async () => {
      const f = await fixture(true);
      const before = await f.application.getDraft(f.principal, f.projectId);
      const review = await f.accept();
      expect(review.designChanged).toBe(true);
      const accepted = await f.application.getDraft(f.principal, f.projectId);
      expect(accepted.value.version).toBe(before.value.version + 1);
      expect(
        parseArchitectureDocument(
          accepted.value.architectureDocument,
        ).nodes.some((node) => node.id === "node_imported_extra"),
      ).toBe(true);
      expect(await f.accept()).toEqual(review);
      expect(
        (await f.application.getDraft(f.principal, f.projectId)).value.version,
      ).toBe(2);
      const persisted = await database.query(
        sql(
          "SELECT row_to_json(r)::text AS json FROM github_repository_import_reviews r WHERE project_id=$1",
          [f.projectId],
        ),
      );
      expect(JSON.stringify(persisted.rows)).not.toContain(
        f.editingLease.token,
      );
    }, 60000);

    it("recovers a command commit when the later import review receipt could not be saved", async () => {
      const f = await fixture(true);
      const save = vi.spyOn(
        PostgresGitHubRepositoryImportStore.prototype,
        "saveReview",
      );
      save.mockRejectedValueOnce(
        new Error("Synthetic review storage interruption."),
      );
      try {
        await expect(f.accept()).rejects.toThrow(
          "Synthetic review storage interruption.",
        );
        expect(
          (await f.application.getDraft(f.principal, f.projectId)).value
            .version,
        ).toBe(2);
        expect((await f.accept()).designChanged).toBe(true);
        expect(
          (await f.application.getDraft(f.principal, f.projectId)).value
            .version,
        ).toBe(2);
      } finally {
        save.mockRestore();
      }
    }, 60000);

    it("rejects missing or wrong editing proof without applying an imported node", async () => {
      const f = await fixture(true);
      await expect(f.accept(null)).rejects.toMatchObject({
        code: "precondition_required",
      });
      await expect(
        f.accept({
          expectedDraftEtag: f.current.etag,
          editingLease: {
            ...f.editingLease,
            token: randomBytes(32).toString("base64url"),
          },
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        (await f.application.getDraft(f.principal, f.projectId)).value.version,
      ).toBe(1);
    }, 60000);

    it("rejects an older import even when the caller supplies the latest ETag", async () => {
      const f = await fixture(true);
      expect((await f.request()).status).toBe(201);
      const document = parseArchitectureDocument(
        f.current.value.architectureDocument,
      );
      const saved = await f.application.saveDraft(
        f.principal,
        f.projectId,
        {
          contractVersion: 1,
          editingLease: f.editingLease,
          architectureDocument: {
            ...document,
            metadata: { ...document.metadata, source: "migration" },
          },
        },
        f.current.etag,
      );
      await expect(
        f.accept({
          expectedDraftEtag: saved.etag,
          editingLease: f.editingLease,
        }),
      ).rejects.toMatchObject({ code: "precondition_failed" });
      expect(
        (await f.application.getDraft(f.principal, f.projectId)).value.version,
      ).toBe(2);
    }, 60000);

    it("keeps archived project history readable while denying new imports", async () => {
      const value = await fixture();
      const response = await value.request();
      expect(response.status, (await response.text()).slice(0, 1024)).toBe(201);
      await database.query(
        sql(
          "UPDATE projects SET lifecycle_status='archived' WHERE project_id=$1",
          [value.projectId],
        ),
      );
      expect(
        await value.imports.listImports(value.principal, value.projectId),
      ).toHaveLength(1);
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      expect((await value.request()).status).toBe(404);
      expect(acquire).not.toHaveBeenCalled();
    }, 60000);

    it("explains a missing saved revision before claiming an import", async () => {
      const value = await fixture();
      value.listSolutionRevisions.mockResolvedValue({ items: [] });
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      const response = await value.request();
      expect(response.status).toBe(409);
      expect(await response.text()).toContain("Create a solution revision");
      expect(acquire).not.toHaveBeenCalled();
      expect(
        await value.imports.listImports(value.principal, value.projectId),
      ).toEqual([]);
    }, 60000);

    it("rechecks installation revocation before reading the selected repository", async () => {
      const value = await fixture();
      const inspect = value.github.inspectInstallation.bind(value.github);
      vi.spyOn(value.github, "inspectInstallation").mockImplementation(
        async (id) => {
          const descriptor = await inspect(id);
          await database.query(
            sql(
              "UPDATE github_app_installations SET lifecycle_status='suspended' WHERE installation_id=$1",
              [value.installationId],
            ),
          );
          return descriptor;
        },
      );
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      expect((await value.request()).status).toBe(404);
      expect(acquire).not.toHaveBeenCalled();
    }, 60000);

    it("denies cross-tenant actors and viewer mutations before repository acquisition", async () => {
      const value = await fixture();
      const acquire = vi.spyOn(value.github, "withRepositoryReadSession");
      await expect(
        value.imports.listImports(
          { ...value.principal, principalId: "principal_foreign" },
          value.projectId,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      await database.query(
        sql(
          "UPDATE memberships SET role_key='viewer' WHERE organization_id=$1",
          [value.organizationId],
        ),
      );
      expect((await value.request()).status).toBe(403);
      expect(acquire).not.toHaveBeenCalled();
    }, 60000);
  },
);
