import { requireRecentAuthentication } from "../../application/identity.js";
import { CognitoJwtPrincipalResolver } from "../identity/cognito-jwt-principal-resolver.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { architectureDocumentV3Schema } from "@cloudmarkup/schemas";
import { applyDraftCommandV1Schema } from "@cloudmarkup/api-contract";
import {
  applyGraphCommand,
  getArchitectureDocumentContentHash,
} from "@cloudmarkup/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { permissionsForRole } from "../../application/authorization.js";
import type { AuthorizedOrganizationScope } from "../../application/persistence.js";
import type {
  PrincipalContext,
  CloudMarkupApplication,
} from "../../application/ports.js";
import { createRepositoryBackedApplication } from "../../application/repository-backed-application.js";
import type { DraftWriteLeaseContext } from "../../application/project-editing-leases.js";
import { exportPrincipal } from "./solution-export-artifact-test-helpers.js";
import { InMemoryObjectStore } from "./memory-object-store.js";
import { runMigrations } from "./migrations.js";
import { loadHistoricalBetaMigrations } from "./historical-beta-migrations-test-helper.js";
import { PostgresDatabase } from "./postgres-driver.js";
import { ObjectPublicationCoordinator } from "./publication.js";
import { PostgresCloudMarkupRepository } from "./repositories.js";
import { PostgresProjectEditingLeases } from "./project-editing-leases.js";
import { sql } from "./sql.js";

const configured = process.env["CLOUDMARKUP_TEST_DATABASE_URL"]?.trim();
const suite =
  configured === undefined || configured === "" ? describe.skip : describe;
const nonce = randomUUID().replaceAll("-", "");
const schema = `cm_editing_lease_it_${nonce}`;
const marker = `CloudMarkup synthetic editing lease ${nonce}`;
const id = (kind: string) => `${kind}_${randomUUID().replaceAll("-", "")}`;
const token = () => randomBytes(32).toString("base64url");
const digest = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");

suite("project editing leases on isolated real PostgreSQL", () => {
  let admin: PostgresDatabase | undefined;
  let database: PostgresDatabase;
  let opened: PostgresDatabase | undefined;
  let created = false;
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.search !== "" ||
      url.hash !== "" ||
      !/^\/[A-Za-z][A-Za-z0-9_]{0,62}$/u.test(url.pathname)
    )
      throw new Error("Explicit synthetic loopback PostgreSQL is required.");
    admin = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    await admin.transaction(async (tx) => {
      await tx.query(sql(`CREATE SCHEMA "${schema}"`));
      await tx.query(sql(`COMMENT ON SCHEMA "${schema}" IS '${marker}'`));
    });
    created = true;
    database = new PostgresDatabase({
      connectionString: configured ?? "",
      max: 4,
      connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema} -c timezone=Pacific/Honolulu -c statement_timeout=5000`,
    });
    opened = database;
    await runMigrations(
      database,
      await loadHistoricalBetaMigrations(
        fileURLToPath(new URL("../../../migrations", import.meta.url)),
      ),
    );
  }, 60_000);
  afterAll(async () => {
    try {
      await opened?.close();
      if (created && admin !== undefined) {
        if (!/^cm_editing_lease_it_[a-f0-9]{32}$/u.test(schema))
          throw new Error("Unsafe synthetic schema.");
        const check = await admin.query(
          sql(
            "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
            [schema],
          ),
        );
        if (check.rows[0]?.["marker"] !== marker)
          throw new Error("Synthetic schema marker mismatch.");
        await admin.query(sql(`DROP SCHEMA "${schema}" CASCADE`));
      }
    } finally {
      await admin?.close();
    }
  }, 30_000);

  async function fixture(publishInitial = true) {
    const principal = { ...exportPrincipal(), principalId: id("principal") };
    const organizationId = id("org");
    const projectId = id("project");
    const draftId = id("draft");
    const membershipId = id("membership");
    await database.transaction(async (tx) => {
      await tx.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Synthetic editor')",
          [principal.principalId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organizations(organization_id,display_name,slug) VALUES($1,'Synthetic editing',$2)",
          [organizationId, id("slug").replaceAll("_", "-")],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO organization_roles(organization_id,role_key,policy_version,is_owner,capabilities) SELECT $1,role,'authorization-v2',role='owner',cloudmarkup_authorization_v2_permissions(role) FROM unnest(ARRAY['owner','administrator','editor','viewer']) role",
          [organizationId],
        ),
      );
      await tx.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,'owner')",
          [membershipId, organizationId, principal.principalId],
        ),
      );
    });
    const scope: AuthorizedOrganizationScope = {
      ...principal,
      organizationId,
      membershipId,
      roleKey: "owner",
      capabilities: permissionsForRole("owner"),
    };
    const repository = new PostgresCloudMarkupRepository(database, {
      draftEditingLeases: "required",
    });
    const leases = new PostgresProjectEditingLeases(database);
    const objects = new InMemoryObjectStore();
    const publication = new ObjectPublicationCoordinator(repository, objects);
    function payload(value: number) {
      const body = new TextEncoder().encode(
        JSON.stringify({ synthetic: value }),
      );
      return {
        contentSha256: digest(body),
        mediaType: "application/vnd.cloudmarkup.architecture+json",
        objectId: id("object"),
        owner: { organizationId, projectId },
        purpose: "architecture-draft" as const,
        sizeBytes: body.byteLength,
        open: async function* () {
          yield await Promise.resolve(body);
        },
      };
    }
    const initial = payload(1);
    const initialObject = await objects.stage(scope, initial);
    await repository.createProjectWithInitialDraft(
      scope,
      {
        projectId,
        name: "Synthetic project",
        idempotencyKey: id("create-idempotency-key"),
        requestSha256: initial.contentSha256,
        draft: {
          draftId,
          documentSchemaVersion: 3,
          contentSha256: initial.contentSha256,
          semanticSha256: initial.contentSha256,
          visualSha256: initial.contentSha256,
        },
      },
      initialObject,
    );
    if (publishInitial)
      await publication.recover(scope, initialObject, { principal });
    async function acquire(
      selectedPrincipal: PrincipalContext = principal,
      selectedToken = token(),
    ) {
      const result = await leases.acquire(selectedPrincipal, projectId, {
        token: selectedToken,
      });
      if (result.state !== "owned")
        throw new Error("Expected an owned synthetic lease.");
      return {
        principal: selectedPrincipal,
        proof: { leaseId: result.leaseId, token: selectedToken },
      } satisfies DraftWriteLeaseContext;
    }
    async function pending(context: DraftWriteLeaseContext, version = 1) {
      const object = await objects.stage(scope, payload(version + 1));
      await repository.updateDraft(
        {
          ...scope,
          principalId: context.principal.principalId,
          sessionId: context.principal.sessionId,
        },
        {
          projectId,
          draftId,
          expectedDraftVersion: version,
          documentSchemaVersion: 3,
          contentSha256: object.contentSha256,
          semanticSha256: object.contentSha256,
          visualSha256: object.contentSha256,
        },
        object,
        context,
      );
      return object;
    }
    async function expire() {
      await database.query(
        sql(
          "UPDATE project_editing_leases SET acquired_at=clock_timestamp()-INTERVAL '120 seconds',updated_at=clock_timestamp()-INTERVAL '61 seconds',expires_at=clock_timestamp()-INTERVAL '2 seconds' WHERE organization_id=$1 AND project_id=$2",
          [organizationId, projectId],
        ),
      );
    }
    async function draft() {
      const found = await database.query(
        sql(
          "SELECT draft_version,document_object_id,pending_document_object_id,pending_editing_lease_id FROM architecture_drafts WHERE organization_id=$1 AND project_id=$2",
          [organizationId, projectId],
        ),
      );
      return found.rows[0];
    }
    async function member(role: "editor" | "viewer") {
      const second = {
        ...principal,
        principalId: id("principal"),
        sessionId: id("session"),
      };
      await database.query(
        sql(
          "INSERT INTO principals(principal_id,display_name) VALUES($1,'Another synthetic member')",
          [second.principalId],
        ),
      );
      await database.query(
        sql(
          "INSERT INTO memberships(membership_id,organization_id,principal_id,role_key) VALUES($1,$2,$3,$4)",
          [id("membership"), organizationId, second.principalId, role],
        ),
      );
      return second;
    }
    return {
      principal,
      organizationId,
      projectId,
      draftId,
      membershipId,
      scope,
      repository,
      leases,
      objects,
      publication,
      initialObject,
      acquire,
      pending,
      expire,
      draft,
      member,
      payload,
    };
  }

  it("permits only the exact creator's initial publication before a lease and preserves retry-safe project creation", async () => {
    const f = await fixture(false);
    await expect(
      f.leases.acquire(f.principal, f.projectId, { token: token() }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.repository.markObjectPublished(
        f.scope,
        f.initialObject.objectId,
        f.initialObject.objectVersion,
      ),
    ).rejects.toThrow();
    await f.publication.recover(f.scope, f.initialObject, {
      principal: f.principal,
    });
    expect((await f.draft())?.["draft_version"]).toBe("1");
    expect(await f.leases.get(f.principal, f.projectId)).toEqual({
      contractVersion: 1,
      projectId: f.projectId,
      state: "available",
    });
  });
  it("serializes concurrent tabs, including the same user, and stores only a SHA256 tab proof", async () => {
    const f = await fixture();
    const first = token();
    const second = token();
    const results = await Promise.all([
      f.leases.acquire(f.principal, f.projectId, { token: first }),
      f.leases.acquire(f.principal, f.projectId, { token: second }),
    ]);
    expect(results.map((value) => value.state).sort()).toEqual([
      "held",
      "owned",
    ]);
    const winningToken = results[0].state === "owned" ? first : second;
    const winner = results.find((value) => value.state === "owned");
    expect(
      await f.leases.acquire(f.principal, f.projectId, { token: winningToken }),
    ).toEqual(winner);
    const row = await database.query(
      sql(
        "SELECT row_to_json(l)::text AS record FROM project_editing_leases l WHERE project_id=$1",
        [f.projectId],
      ),
    );
    expect(row.rows[0]?.["record"]).not.toContain(first);
    expect(row.rows[0]?.["record"]).not.toContain(second);
    expect(await f.leases.get(f.principal, f.projectId)).toMatchObject({
      state: "held",
    });
    expect(
      await f.leases.get(await f.member("viewer"), f.projectId),
    ).toMatchObject({ state: "held" });
    expect(
      await f.leases.acquire(await f.member("editor"), f.projectId, {
        token: token(),
      }),
    ).toMatchObject({ state: "held" });
  });
  it("renews and releases only exact principal/session/tab/epoch proof and never takes over an active lease", async () => {
    const f = await fixture();
    const context = await f.acquire();
    const proof = context.proof;
    for (const [principal, bad] of [
      [f.principal, { ...proof, token: token() }],
      [{ ...f.principal, sessionId: id("session") }, proof],
      [f.principal, { ...proof, leaseId: `projectlease_${randomUUID()}` }],
    ] as const) {
      await expect(
        f.leases.renew(principal, f.projectId, bad),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        f.leases.release(principal, f.projectId, bad),
      ).rejects.toMatchObject({ code: "conflict" });
    }
    expect(await f.leases.renew(f.principal, f.projectId, proof)).toMatchObject(
      { state: "owned", leaseId: proof.leaseId },
    );
    expect(
      await f.leases.release(f.principal, f.projectId, proof),
    ).toMatchObject({ state: "available" });
    expect(
      await f.leases.release(f.principal, f.projectId, proof),
    ).toMatchObject({ state: "available" });
    const next = await f.acquire();
    expect(next.proof.leaseId).not.toBe(proof.leaseId);
    await expect(
      f.leases.renew(f.principal, f.projectId, proof),
    ).rejects.toThrow();
  });

  it("renews the same tab lease across verified access-token renewal while denying another sign-in", async () => {
    const f = await fixture();
    const started = Math.floor(Date.now() / 1000);
    let claims = {
      auth_time: started - 1200,
      exp: started + 45,
      iat: started,
      token_use: "access",
      sub: "synthetic_lease_subject",
      iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
      scope: "cloudmarkup-api/access",
      jti: "synthetic_access_1",
      origin_jti: "synthetic_refresh_family",
    };
    const resolver = new CognitoJwtPrincipalResolver({
      clientId: "synthetic_client",
      userPoolId: "us-east-1_example",
      requiredScope: "cloudmarkup-api/access",
      principalDirectory: {
        resolveActivePrincipal: () =>
          Promise.resolve({ principalId: f.principal.principalId }),
      },
      verifier: { verify: () => Promise.resolve(claims) },
    });
    const verified = async () => {
      const result = await resolver.resolve("Bearer synthetic.signed.token");
      if (result === null)
        throw new Error("Synthetic verified session is missing.");
      return { ...result, correlationId: f.principal.correlationId };
    };
    const original = await verified();
    const tabToken = token();
    const acquired = await f.leases.acquire(original, f.projectId, {
      token: tabToken,
    });
    if (acquired.state !== "owned")
      throw new Error("Synthetic lease was not acquired.");
    const proof = { leaseId: acquired.leaseId, token: tabToken };
    claims = {
      ...claims,
      jti: "synthetic_access_2",
      iat: started + 30,
      exp: started + 1800,
    };
    const renewed = await verified();
    expect(renewed.authenticatedAt).toBe(original.authenticatedAt);
    expect(() => {
      requireRecentAuthentication(renewed, new Date());
    }).toThrow("Recent authentication is required");
    const lease = await f.leases.renew(renewed, f.projectId, proof);
    expect(lease).toMatchObject({ state: "owned", leaseId: proof.leaseId });
    if (lease.state !== "owned")
      throw new Error("Synthetic lease was not renewed.");
    expect(Date.parse(lease.expiresAt)).toBeGreaterThan(
      Date.parse(acquired.expiresAt),
    );
    expect(Date.parse(lease.expiresAt)).toBeLessThanOrEqual(
      Date.parse(renewed.expiresAt),
    );
    claims = { ...claims, origin_jti: "synthetic_other_sign_in" };
    await expect(
      f.leases.renew(await verified(), f.projectId, proof),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("bounds lease expiry to verified authentication and denies malformed tab tokens", async () => {
    const f = await fixture();
    const expiresAt = new Date(Date.now() + 20_000).toISOString();
    const result = await f.leases.acquire(
      { ...f.principal, expiresAt },
      f.projectId,
      { token: token() },
    );
    expect(result.state).toBe("owned");
    if (result.state === "owned")
      expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(
        Date.parse(expiresAt),
      );
    await expect(
      f.leases.acquire(f.principal, f.projectId, { token: "not-a-tab-proof" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it.each(["acquire-own", "acquire-held", "release-replay"])(
    "rejects expired authentication on %s paths",
    async (kind) => {
      const f = await fixture();
      const context = await f.acquire();
      if (kind === "release-replay")
        await f.leases.release(f.principal, f.projectId, context.proof);
      const expired = { ...f.principal, expiresAt: "2000-01-01T00:00:00.000Z" };
      await expect(
        kind === "release-replay"
          ? f.leases.release(expired, f.projectId, context.proof)
          : f.leases.acquire(expired, f.projectId, {
              token: kind === "acquire-own" ? context.proof.token : token(),
            }),
      ).rejects.toMatchObject({ code: "authentication_required" });
    },
  );
  it.each(["viewer", "cross-tenant", "expired", "revoked", "deleted-project"])(
    "denies %s editing authority",
    async (kind) => {
      const f = await fixture();
      let principal = f.principal;
      let projectId = f.projectId;
      if (kind === "viewer") principal = await f.member("viewer");
      if (kind === "cross-tenant") projectId = (await fixture()).projectId;
      if (kind === "expired")
        principal = { ...principal, expiresAt: "2000-01-01T00:00:00.000Z" };
      if (kind === "revoked")
        await database.query(
          sql(
            "UPDATE memberships SET lifecycle_status='suspended',record_version=record_version+1 WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      if (kind === "deleted-project")
        await database.query(
          sql(
            "UPDATE projects SET lifecycle_status='deletion-pending',record_version=record_version+1,deletion_requested_at=clock_timestamp() WHERE project_id=$1",
            [projectId],
          ),
        );
      await expect(
        f.leases.acquire(principal, projectId, { token: token() }),
      ).rejects.toThrow();
    },
  );
  it.each(["role-revoked", "project-deleted", "authentication-expired"])(
    "denies existing-lease renewal and pending promotion after %s",
    async (kind) => {
      const f = await fixture();
      const context = await f.acquire();
      const object = await f.pending(context);
      let principal = f.principal;
      if (kind === "role-revoked")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer',record_version=record_version+1 WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      if (kind === "project-deleted")
        await database.query(
          sql(
            "UPDATE projects SET lifecycle_status='deletion-pending',record_version=record_version+1,deletion_requested_at=clock_timestamp() WHERE project_id=$1",
            [f.projectId],
          ),
        );
      if (kind === "authentication-expired")
        principal = { ...principal, expiresAt: "2000-01-01T00:00:00.000Z" };
      await expect(
        f.leases.renew(principal, f.projectId, context.proof),
      ).rejects.toThrow();
      await expect(
        f.publication.recover(f.scope, object, {
          principal,
          proof: context.proof,
        }),
      ).rejects.toThrow();
      expect((await f.draft())?.["document_object_id"]).toBe(
        f.initialObject.objectId,
      );
    },
  );

  it("fences pending and publication commits, including generic recovery without a proof", async () => {
    const f = await fixture();
    const context = await f.acquire();
    const object = await f.pending(context);
    await expect(f.publication.recover(f.scope, object)).rejects.toThrow();
    await expect(
      f.publication.recover(f.scope, object, {
        principal: f.principal,
        proof: { ...context.proof, token: token() },
      }),
    ).rejects.toThrow();
    expect((await f.draft())?.["document_object_id"]).toBe(
      f.initialObject.objectId,
    );
    await f.publication.recover(f.scope, object, context);
    expect((await f.draft())?.["document_object_id"]).toBe(object.objectId);
    expect((await f.draft())?.["pending_document_object_id"]).toBeNull();
  });
  it("abandons only an expired holder's exact pending pointer, retains content, and lets the next editor save", async () => {
    const f = await fixture();
    const old = await f.acquire();
    const pending = await f.pending(old);
    await f.expire();
    const next = await f.acquire();
    expect((await f.draft())?.["document_object_id"]).toBe(
      f.initialObject.objectId,
    );
    expect((await f.draft())?.["pending_document_object_id"]).toBeNull();
    const retained = await database.query(
      sql("SELECT lifecycle_state FROM stored_objects WHERE object_id=$1", [
        pending.objectId,
      ]),
    );
    expect(retained.rows[0]?.["lifecycle_state"]).toBe("publication-pending");
    await expect(
      f.publication.recover(f.scope, pending, old),
    ).rejects.toThrow();
    await expect(
      f.publication.recover(f.scope, pending, next),
    ).rejects.toThrow();
    const current = await f.pending(next);
    await f.publication.recover(f.scope, current, next);
    expect((await f.draft())?.["document_object_id"]).toBe(current.objectId);
  });
  it("release cancels only its exact pending metadata while keeping the previous published document", async () => {
    const f = await fixture();
    const context = await f.acquire();
    const pending = await f.pending(context);
    await f.leases.release(f.principal, f.projectId, context.proof);
    expect((await f.draft())?.["document_object_id"]).toBe(
      f.initialObject.objectId,
    );
    expect((await f.draft())?.["pending_document_object_id"]).toBeNull();
    await expect(
      f.publication.recover(f.scope, pending, context),
    ).rejects.toThrow();
  });
  async function commandFixture() {
    const f = await fixture();
    const application = createRepositoryBackedApplication({
      draftEditingLeases: "required",
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "command-test",
      objectStore: f.objects,
      repository: f.repository,
      organizationForProject: () => f.organizationId,
      organizationForRequestedScope: () => f.organizationId,
    });
    const created = await application.createProject(
      f.principal,
      f.organizationId,
      { creationMode: "blank", name: "Command acceptance" },
      id("create"),
    );
    const projectId = created.project.id;
    const current = await application.getDraft(f.principal, projectId);
    const document = architectureDocumentV3Schema.parse(
      current.value.architectureDocument,
    );
    const tabToken = token();
    const lease = await f.leases.acquire(f.principal, projectId, {
      token: tabToken,
    });
    if (lease.state !== "owned")
      throw new Error("Expected owned synthetic lease.");
    const input = applyDraftCommandV1Schema.parse({
      contractVersion: 1,
      editingLease: { leaseId: lease.leaseId, token: tabToken },
      command: {
        commandId: id("command"),
        inverseCommandId: id("inverse"),
        kind: "add-node",
        origin: "user",
        schemaVersion: 1,
        target: {
          architectureId: document.architectureId,
          documentId: document.documentId,
          revisionId: document.revision.revisionId,
        },
        node: {
          id: "node_queue",
          presentation: { label: "Queue", position: { x: 10, y: 20 } },
          semantic: {
            configuration: {
              schemaId: "example.queue.config",
              schemaVersion: "1.0.0",
              values: {},
            },
            deploymentKey: "queue",
            lifecycle: { origin: "user", ownership: "user" },
            resourceType: "example.queue",
            serviceType: "example.queue",
          },
        },
      },
    });
    const editingProof = input.editingLease;
    if (editingProof === undefined)
      throw new Error("Missing synthetic editing proof.");
    const requestKey = id("request");
    const apply = async (
      body: unknown = input,
      etag = current.etag,
      key = requestKey,
      principal = f.principal,
    ) =>
      application.applyDraftCommand(
        principal,
        projectId,
        applyDraftCommandV1Schema.parse(body),
        etag,
        key,
      );
    const count = async () =>
      (
        await database.query(
          sql(
            "SELECT count(*) AS count FROM draft_command_receipts WHERE project_id=$1",
            [projectId],
          ),
        )
      ).rows[0]?.["count"];
    return {
      ...f,
      application,
      projectId,
      current,
      input,
      requestKey,
      editingProof,
      apply,
      count,
    };
  }

  it("durably accepts a command and replays its exact version after later edits and application reconstruction", async () => {
    const f = await commandFixture();
    const accepted = await f.apply();
    expect(accepted.value.draft.version).toBe(2);
    expect(
      architectureDocumentV3Schema.parse(
        accepted.value.draft.architectureDocument,
      ).nodes,
    ).toHaveLength(1);
    const document = architectureDocumentV3Schema.parse(
      accepted.value.draft.architectureDocument,
    );
    const later = await f.application.saveDraft(
      f.principal,
      f.projectId,
      {
        contractVersion: 1,
        editingLease: f.input.editingLease,
        architectureDocument: {
          ...document,
          nodes: document.nodes.map((n) => ({
            ...n,
            presentation: { ...n.presentation, label: "Later edit" },
          })),
        },
      },
      accepted.etag,
    );
    expect(later.value.version).toBe(3);
    const rebuilt = createRepositoryBackedApplication({
      draftEditingLeases: "required",
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "command-test",
      objectStore: f.objects,
      repository: new PostgresCloudMarkupRepository(database, {
        draftEditingLeases: "required",
      }),
      organizationForProject: () => f.organizationId,
      organizationForRequestedScope: () => f.organizationId,
    });
    expect(
      await rebuilt.applyDraftCommand(
        f.principal,
        f.projectId,
        f.input,
        f.current.etag,
        f.requestKey,
      ),
    ).toEqual(accepted);
    expect(
      (await f.application.getDraft(f.principal, f.projectId)).value,
    ).toMatchObject({
      version: 3,
      architectureDocument: later.value.architectureDocument,
    });
    expect(await f.count()).toBe("1");
  });

  it("binds a reviewed command to exact content while replaying the accepted version", async () => {
    const f = await commandFixture();
    const contentBinding = {
      expectedContentDigest: getArchitectureDocumentContentHash(
        f.current.value.architectureDocument,
      ),
      resultingContentDigest: getArchitectureDocumentContentHash(
        applyGraphCommand(f.current.value.architectureDocument, f.input.command)
          .document,
      ),
    };
    const input = { ...f.input, contentBinding };
    const accepted = await f.apply(input);
    expect(await f.apply(input)).toEqual(accepted);
    await expect(
      f.apply({
        ...input,
        contentBinding: {
          ...contentBinding,
          resultingContentDigest: "sha256:" + "0".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });
    expect(await f.count()).toBe("1");
  });
  it.each(["expectedContentDigest", "resultingContentDigest"] as const)(
    "rejects a mismatched %s before staging or saving the reviewed command",
    async (field) => {
      const f = await commandFixture();
      const contentBinding = {
        expectedContentDigest: getArchitectureDocumentContentHash(
          f.current.value.architectureDocument,
        ),
        resultingContentDigest: getArchitectureDocumentContentHash(
          applyGraphCommand(
            f.current.value.architectureDocument,
            f.input.command,
          ).document,
        ),
        [field]: "sha256:" + "0".repeat(64),
      };
      const stage = vi.spyOn(f.objects, "stage");
      await expect(
        f.apply({ ...f.input, contentBinding }),
      ).rejects.toMatchObject({
        code:
          field === "expectedContentDigest"
            ? "precondition_failed"
            : "invalid_request",
      });
      expect(stage).not.toHaveBeenCalled();
      expect(await f.count()).toBe("0");
      expect(
        (await f.application.getDraft(f.principal, f.projectId)).value.version,
      ).toBe(1);
    },
  );
  it.each(["eightkey", "k".repeat(128)])(
    "accepts a public-contract idempotency key of length %s",
    async (key) => {
      const f = await commandFixture();
      const accepted = await f.apply(f.input, f.current.etag, key);
      expect(await f.apply(f.input, f.current.etag, key)).toEqual(accepted);
      expect(await f.count()).toBe("1");
    },
  );
  it("concurrent duplicate command requests publish one accepted version", async () => {
    const f = await commandFixture();
    const outcomes = await Promise.allSettled([f.apply(), f.apply()]);
    const successes = outcomes.flatMap((o) =>
      o.status === "fulfilled" ? [o.value] : [],
    );
    expect(successes.length).toBeGreaterThan(0);
    expect(await f.apply()).toEqual(successes[0]);
    expect(
      (await f.application.getDraft(f.principal, f.projectId)).value.version,
    ).toBe(2);
    expect(await f.count()).toBe("1");
  });

  it.each(["command", "etag"] as const)(
    "rejects changed %s under an accepted request identity",
    async (kind) => {
      const f = await commandFixture();
      await f.apply();
      await expect(
        f.apply(
          kind === "command"
            ? {
                ...f.input,
                command: { ...f.input.command, commandId: id("changed") },
              }
            : f.input,
          kind === "etag" ? '"draft:changed:v1"' : f.current.etag,
        ),
      ).rejects.toMatchObject({ code: "idempotency_key_reused" });
      expect(await f.count()).toBe("1");
    },
  );

  it.each(["stale", "invalid-target", "invalid-batch"] as const)(
    "rejects %s without an accepted receipt or draft mutation",
    async (kind) => {
      const f = await commandFixture();
      const body =
        kind === "stale"
          ? f.input
          : {
              ...f.input,
              command:
                kind === "invalid-target"
                  ? {
                      ...f.input.command,
                      target: {
                        ...f.input.command.target,
                        documentId: "doc_wrong",
                      },
                    }
                  : {
                      commandId: id("batch"),
                      kind: "batch" as const,
                      origin: "user" as const,
                      schemaVersion: 1 as const,
                      target: f.input.command.target,
                      commands: [
                        f.input.command,
                        { ...f.input.command, commandId: id("duplicate_node") },
                      ],
                    },
            };
      await expect(
        f.apply(body, kind === "stale" ? '"draft:changed:v1"' : f.current.etag),
      ).rejects.toThrow();
      expect(
        (await f.application.getDraft(f.principal, f.projectId)).value.version,
      ).toBe(1);
      expect(await f.count()).toBe("0");
    },
  );

  it.each(["publication", "ambiguous-commit"] as const)(
    "recovers %s without applying the command twice",
    async (kind) => {
      const f = await commandFixture();
      if (kind === "publication") {
        vi.spyOn(f.objects, "publish").mockRejectedValueOnce(
          new Error("Synthetic publication failure"),
        );
        await expect(f.apply()).rejects.toThrow();
        expect(await f.count()).toBe("1");
        expect(
          (await f.application.getDraft(f.principal, f.projectId)).value
            .version,
        ).toBe(1);
      } else {
        const original = f.repository.updateDraft.bind(f.repository);
        vi.spyOn(f.repository, "updateDraft").mockImplementationOnce(
          async (...args) => {
            await original(...args);
            throw new Error("Synthetic lost commit acknowledgement");
          },
        );
      }
      const accepted = await f.apply();
      expect(accepted.value.draft.version).toBe(2);
      expect(await f.apply()).toEqual(accepted);
      expect(await f.count()).toBe("1");
    },
  );

  it.each([
    "missing-proof",
    "wrong-proof",
    "revoked",
    "cross-tenant",
    "expired",
    "deleted",
  ] as const)(
    "denies %s even for an already accepted command",
    async (kind) => {
      const f = await commandFixture();
      await f.apply();
      if (kind === "revoked")
        await database.query(
          sql(
            "UPDATE memberships SET role_key='viewer',record_version=record_version+1 WHERE membership_id=$1",
            [f.membershipId],
          ),
        );
      if (kind === "deleted")
        await database.query(
          sql(
            "UPDATE projects SET lifecycle_status='deletion-pending',record_version=record_version+1,deletion_requested_at=clock_timestamp() WHERE project_id=$1",
            [f.projectId],
          ),
        );
      const withoutProof = {
        contractVersion: f.input.contractVersion,
        command: f.input.command,
      };
      const body =
        kind === "missing-proof"
          ? withoutProof
          : kind === "wrong-proof"
            ? {
                ...f.input,
                editingLease: { ...f.editingProof, token: token() },
              }
            : f.input;
      const principal =
        kind === "cross-tenant"
          ? (await fixture()).principal
          : kind === "expired"
            ? { ...f.principal, expiresAt: "2000-01-01T00:00:00.000Z" }
            : f.principal;
      await expect(
        f.apply(body, f.current.etag, f.requestKey, principal),
      ).rejects.toThrow();
      expect(await f.count()).toBe("1");
    },
  );

  it("does not promote an abandoned pending command under a replacement editing lease", async () => {
    const f = await commandFixture();
    vi.spyOn(f.objects, "publish").mockRejectedValueOnce(
      new Error("Synthetic publication failure"),
    );
    await expect(f.apply()).rejects.toThrow();
    await f.leases.release(f.principal, f.projectId, f.editingProof);
    const newToken = token();
    const lease = await f.leases.acquire(f.principal, f.projectId, {
      token: newToken,
    });
    if (lease.state !== "owned") throw new Error("Expected replacement lease");
    await expect(
      f.apply({
        ...f.input,
        editingLease: { leaseId: lease.leaseId, token: newToken },
      }),
    ).rejects.toThrow();
    expect(
      (await f.application.getDraft(f.principal, f.projectId)).value.version,
    ).toBe(1);
  });

  it("retains immutable, content-free command metadata and rejects forged receipt insertion", async () => {
    const f = await commandFixture();
    await f.apply();
    const receipt = (
      await database.query(
        sql("SELECT * FROM draft_command_receipts WHERE project_id=$1", [
          f.projectId,
        ]),
      )
    ).rows[0];
    expect(JSON.stringify(receipt)).not.toContain("Queue");
    expect(JSON.stringify(receipt)).not.toContain(f.editingProof.token);
    await expect(
      database.query(
        sql(
          "UPDATE draft_command_receipts SET draft_version=100 WHERE project_id=$1",
          [f.projectId],
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql("DELETE FROM draft_command_receipts WHERE project_id=$1", [
          f.projectId,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      database.query(
        sql(
          `INSERT INTO draft_command_receipts SELECT organization_id,project_id,principal_id,$2,
      request_sha256,command_id,draft_id,draft_version+1,document_schema_version,document_object_id,
      content_sha256,semantic_sha256,visual_sha256,created_at FROM draft_command_receipts WHERE project_id=$1`,
          [f.projectId, "a".repeat(64)],
        ),
      ),
    ).rejects.toThrow();
  });

  it("saves identical content through the real application after expired-epoch abandonment using a distinct immutable object", async () => {
    const f = await fixture();
    const application = createRepositoryBackedApplication({
      draftEditingLeases: "required",
      fallback: {} as CloudMarkupApplication,
      identifierNamespace: "lease-test",
      objectStore: f.objects,
      repository: f.repository,
      organizationForProject: () => f.organizationId,
      organizationForRequestedScope: () => f.organizationId,
    });
    const created = await application.createProject(
      f.principal,
      f.organizationId,
      { creationMode: "blank", name: "Identical-content recovery" },
      id("idempotency"),
    );
    const projectId = created.project.id;
    const original = await application.getDraft(f.principal, projectId);
    const oldToken = token();
    const old = await f.leases.acquire(f.principal, projectId, {
      token: oldToken,
    });
    if (old.state !== "owned") throw new Error("Expected synthetic lease.");
    const input = {
      contractVersion: 1 as const,
      architectureDocument: original.value.architectureDocument,
      editingLease: { leaseId: old.leaseId, token: oldToken },
    };
    const publish = vi.spyOn(f.objects, "publish");
    publish.mockRejectedValueOnce(
      new Error("Synthetic object publication interruption."),
    );
    await expect(
      application.saveDraft(f.principal, projectId, input, original.etag),
    ).rejects.toThrow();
    const pending = await database.query(
      sql(
        "SELECT pending_document_object_id FROM architecture_drafts WHERE project_id=$1",
        [projectId],
      ),
    );
    const oldObject = pending.rows[0]?.["pending_document_object_id"];
    expect(typeof oldObject).toBe("string");
    await database.query(
      sql(
        "UPDATE project_editing_leases SET acquired_at=clock_timestamp()-INTERVAL '120 seconds',updated_at=clock_timestamp()-INTERVAL '61 seconds',expires_at=clock_timestamp()-INTERVAL '2 seconds' WHERE project_id=$1",
        [projectId],
      ),
    );
    const nextToken = token();
    const next = await f.leases.acquire(f.principal, projectId, {
      token: nextToken,
    });
    if (next.state !== "owned") throw new Error("Expected replacement lease.");
    const saved = await application.saveDraft(
      f.principal,
      projectId,
      { ...input, editingLease: { leaseId: next.leaseId, token: nextToken } },
      original.etag,
    );
    expect(saved.value.version).toBe(2);
    const final = await database.query(
      sql(
        "SELECT document_object_id FROM architecture_drafts WHERE project_id=$1",
        [projectId],
      ),
    );
    expect(final.rows[0]?.["document_object_id"]).not.toBe(oldObject);
    const retained = await database.query(
      sql("SELECT lifecycle_state FROM stored_objects WHERE object_id=$1", [
        String(oldObject),
      ]),
    );
    expect(retained.rows[0]?.["lifecycle_state"]).toBe("publication-pending");
    publish.mockRestore();
  });
  it.each(["active", "released"] as const)(
    "rejects an old disabled writer after %s lease history without changing the published draft",
    async (state) => {
      const f = await fixture();
      const context = await f.acquire();
      if (state === "released")
        await f.leases.release(f.principal, f.projectId, context.proof);
      const before = await f.draft();
      const object = await f.objects.stage(f.scope, f.payload(2));
      const legacy = new PostgresCloudMarkupRepository(database, {
        draftEditingLeases: "disabled",
      });
      await expect(
        legacy.updateDraft(
          f.scope,
          {
            projectId: f.projectId,
            draftId: f.draftId,
            expectedDraftVersion: 1,
            documentSchemaVersion: 3,
            contentSha256: object.contentSha256,
            semanticSha256: object.contentSha256,
            visualSha256: object.contentSha256,
          },
          object,
        ),
      ).rejects.toThrow(
        "project editing lease proof is required after first acquisition",
      );
      expect(await f.draft()).toEqual(before);
      const inserted = await database.query(
        sql("SELECT object_id FROM stored_objects WHERE object_id=$1", [
          object.objectId,
        ]),
      );
      expect(inserted.rows).toEqual([]);
      await expect(
        database.transaction((tx) =>
          tx.query(
            sql(
              "UPDATE architecture_drafts SET semantic_sha256=$3 WHERE organization_id=$1 AND project_id=$2",
              [f.organizationId, f.projectId, object.contentSha256],
            ),
          ),
        ),
      ).rejects.toThrow(
        "project editing lease proof is required after first acquisition",
      );
      expect(await f.draft()).toEqual(before);
    },
  );
  it("preserves untagged initial publication and full historical saves only for exact projects without lease history", async () => {
    const other = await fixture();
    await other.acquire();
    const f = await fixture(false);
    const legacy = new PostgresCloudMarkupRepository(database, {
      draftEditingLeases: "disabled",
    });
    const publication = new ObjectPublicationCoordinator(legacy, f.objects);
    await publication.recover(f.scope, f.initialObject);
    const object = await f.objects.stage(f.scope, f.payload(2));
    await legacy.updateDraft(
      f.scope,
      {
        projectId: f.projectId,
        draftId: f.draftId,
        expectedDraftVersion: 1,
        documentSchemaVersion: 3,
        contentSha256: object.contentSha256,
        semanticSha256: object.contentSha256,
        visualSha256: object.contentSha256,
      },
      object,
    );
    expect((await f.draft())?.["pending_editing_lease_id"]).toBeNull();
    await publication.recover(f.scope, object);
    expect(await f.draft()).toMatchObject({
      draft_version: "2",
      document_object_id: object.objectId,
      pending_document_object_id: null,
      pending_editing_lease_id: null,
    });
    const history = await database.query(
      sql(
        "SELECT lease_id FROM project_editing_leases WHERE organization_id=$1 AND project_id=$2",
        [f.organizationId, f.projectId],
      ),
    );
    expect(history.rows).toEqual([]);
  });
  it("fails closed for unbound legacy pending metadata instead of deleting or promoting it", async () => {
    const f = await fixture();
    const object = await f.objects.stage(f.scope, f.payload(2));
    await new PostgresCloudMarkupRepository(database, {
      draftEditingLeases: "disabled",
    }).updateDraft(
      f.scope,
      {
        projectId: f.projectId,
        draftId: f.draftId,
        expectedDraftVersion: 1,
        documentSchemaVersion: 3,
        contentSha256: object.contentSha256,
        semanticSha256: object.contentSha256,
        visualSha256: object.contentSha256,
      },
      object,
    );
    await expect(f.acquire()).rejects.toMatchObject({ code: "conflict" });
    expect((await f.draft())?.["pending_document_object_id"]).toBe(
      object.objectId,
    );
    expect((await f.draft())?.["document_object_id"]).toBe(
      f.initialObject.objectId,
    );
  });
  it("rejects a lease-tagged write at deferred COMMIT if its database-clock deadline expires after the write", async () => {
    const f = await fixture();
    const context = await f.acquire();
    const pending = await f.pending(context);
    await expect(
      database.transaction(async (tx) => {
        await tx.query(
          sql(
            "UPDATE project_editing_leases SET expires_at=clock_timestamp()+INTERVAL '40 milliseconds' WHERE project_id=$1",
            [f.projectId],
          ),
        );
        await tx.query(
          sql(
            "UPDATE architecture_drafts SET updated_at=clock_timestamp() WHERE project_id=$1",
            [f.projectId],
          ),
        );
        await tx.query(sql("SELECT pg_sleep(0.08)"));
      }),
    ).rejects.toThrow("project editing lease expired before commit");
    expect((await f.draft())?.["pending_document_object_id"]).toBe(
      pending.objectId,
    );
  });
});
