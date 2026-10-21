import { cleanupRequired } from "./cleanup-required.js";
import {
  cleanupHistoryId,
  confirmCleanupHistory,
  type CleanupHistoryPort,
  type CleanupHistoryEnvelope,
} from "../../application/project-cleanup-history.js";
import { createHash } from "node:crypto";
import { sha256DigestSchema } from "@cloudmarkup/schemas";
import type { AsyncJobPersistenceObjectPort } from "./async-job-repository.js";
import type {
  ObjectStore,
  StoredObjectReference,
  AuthorizedOrganizationScope,
  ObjectPurpose,
} from "../../application/persistence.js";
import {
  verifiedObjectStream,
  referencesMatch,
} from "./object-store-common.js";
import { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import {
  exportStoredObject,
  solutionExportWorkflowByteLimit,
} from "./solution-export-workflow-storage.js";
import { sql } from "./sql.js";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export interface CanonicalDeletionObjectPlan {
  readonly bytes: Uint8Array;
  readonly purpose: ObjectPurpose;
  readonly mediaType?: string;
  readonly objectId?: string;
  readonly jobId: string;
  readonly jobRecordVersion: number;
  readonly createdByPrincipalId: string;
}
/** Exact canonical bytes are supplied by the trusted domain/projection planner,
 * never a request payload. Registration commits before object I/O. Only returned,
 * verified S3 publication may complete its row; uncertainty is retained forever
 * until an independent canonical completion receipt proves the request ended. */
export class ProjectDeletionCanonicalObjects {
  readonly #authority: ProjectDeletionRecoveryAuthority;
  readonly #store: ObjectStore;
  readonly #history: CleanupHistoryPort | undefined;
  readonly #plans: ReadonlyMap<string, CanonicalDeletionObjectPlan>;
  readonly #published = new Map<string, StoredObjectReference>();
  readonly #reads = new Map<
    string,
    { reference: StoredObjectReference; bytes: Uint8Array }
  >();
  constructor(
    authority: ProjectDeletionRecoveryAuthority,
    store: ObjectStore,
    plans: readonly CanonicalDeletionObjectPlan[],
    history?: CleanupHistoryPort,
  ) {
    this.#authority = authority;
    this.#store = store;
    this.#history = history;
    this.#plans = new Map(
      plans.map((plan) => {
        const copied = { ...plan, bytes: Uint8Array.from(plan.bytes) };
        if (
          copied.bytes.length < 1 ||
          copied.bytes.length >
            solutionExportWorkflowByteLimit(
              copied.purpose,
              copied.mediaType ?? "application/json",
            )
        )
          throw Error("Canonical recovery bytes are invalid.");
        return [this.identity(copied), copied];
      }),
    );
  }
  identity(plan: CanonicalDeletionObjectPlan): string {
    return (
      plan.objectId ??
      "object.deletion." +
        digest(
          new TextEncoder().encode(
            JSON.stringify({
              binding: this.#authority.binding,
              jobId: plan.jobId,
              jobRecordVersion: plan.jobRecordVersion,
              purpose: plan.purpose,
              digest: digest(plan.bytes),
            }),
          ),
        )
    );
  }
  #scope(actor: string): AuthorizedOrganizationScope {
    return {
      organizationId: this.#authority.binding.organizationId,
      principalId: actor,
      membershipId: "membership.retention",
      sessionId: "session.retention",
      correlationId: "correlation.retention",
      roleKey: "retention",
      capabilities: [],
    };
  }
  async read(
    reference: StoredObjectReference,
    actor: string,
  ): Promise<Uint8Array> {
    const binding = this.#authority.binding;
    if (
      reference.owner.organizationId !== binding.organizationId ||
      reference.owner.projectId !== binding.projectId ||
      reference.storageProvider !== "s3" ||
      reference.sizeBytes >
        solutionExportWorkflowByteLimit(reference.purpose, reference.mediaType)
    )
      throw Error("Recovery read authority is invalid.");
    const metadata = await this.#authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND lifecycle_state='published'",
        [binding.organizationId, binding.projectId, reference.objectId],
      ),
    );
    if (
      metadata.rows.length !== 1 ||
      !referencesMatch(
        exportStoredObject(cleanupRequired(metadata.rows[0])),
        reference,
      )
    )
      throw Error("Recovery object authority changed.");
    const chunks: Uint8Array[] = [];
    for await (const chunk of verifiedObjectStream(
      await this.#store.open(this.#scope(actor), reference),
      reference.sizeBytes,
      reference.contentSha256,
    ))
      chunks.push(chunk.slice());
    const after = await this.#authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND lifecycle_state='published'",
        [binding.organizationId, binding.projectId, reference.objectId],
      ),
    );
    if (
      after.rows.length !== 1 ||
      !referencesMatch(
        exportStoredObject(cleanupRequired(after.rows[0])),
        reference,
      )
    )
      throw Error("Recovery object changed during I/O.");
    return Uint8Array.from(Buffer.concat(chunks));
  }
  async preload(objectId: string, actor: string): Promise<void> {
    const b = this.#authority.binding;
    const metadata = await this.#authority.query(
      sql(
        "SELECT * FROM stored_objects WHERE organization_id=$1 AND project_id=$2 AND object_id=$3 AND lifecycle_state='published'",
        [b.organizationId, b.projectId, objectId],
      ),
    );
    if (metadata.rows.length !== 1)
      throw Error("Recovery hydration is unavailable.");
    const reference = exportStoredObject(cleanupRequired(metadata.rows[0]));
    this.#reads.set(objectId, {
      reference,
      bytes: await this.read(reference, actor),
    });
  }
  importHydration(other: ProjectDeletionCanonicalObjects): void {
    if (other.#authority !== this.#authority)
      throw Error("Recovery hydration authority mismatch.");
    for (const [id, value] of other.#reads)
      this.#reads.set(id, {
        reference: structuredClone(value.reference),
        bytes: value.bytes.slice(),
      });
  }
  async publish(objectId: string): Promise<StoredObjectReference> {
    const plan = this.#plans.get(objectId);
    if (plan === undefined) throw Error("Unplanned recovery publication.");
    const b = this.#authority.binding,
      sha = digest(plan.bytes);
    const envelope: CleanupHistoryEnvelope = {
      kind: "write",
      writeId: objectId,
      organizationId: b.organizationId,
      projectId: b.projectId,
      objectId,
      contentSha256: sha,
      sizeBytes: plan.bytes.length,
      purpose: plan.purpose,
      mediaType: plan.mediaType ?? "application/json",
      storageNamespace: "deletion-recovery",
      principalId: plan.createdByPrincipalId,
      recovery: {
        jobId: plan.jobId,
        jobRecordVersion: plan.jobRecordVersion,
        deletionRecordVersion: b.recordVersion,
      },
    };
    const registered = await this.#authority.transaction(async (tx) => {
      const existing = await tx.query(
        sql(
          "SELECT lifecycle_status FROM project_deletion_recovery_objects WHERE object_id=$1 FOR UPDATE",
          [objectId],
        ),
      );
      if (existing.rows.length !== 0) return false;
      await tx.query(
        sql(
          `INSERT INTO project_deletion_recovery_objects(object_id,organization_id,project_id,job_id,job_record_version,
        deletion_record_version,content_sha256,size_bytes,object_purpose,created_by_principal_id,media_type,history_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            objectId,
            b.organizationId,
            b.projectId,
            plan.jobId,
            plan.jobRecordVersion,
            b.recordVersion,
            sha,
            plan.bytes.length,
            plan.purpose,
            plan.createdByPrincipalId,
            plan.mediaType ?? "application/json",
            this.#history === undefined ? null : cleanupHistoryId(envelope),
          ],
        ),
      );
      return true;
    });
    if (!registered) {
      const prior = await this.#authority.query(
        sql(
          `SELECT o.* FROM stored_objects o JOIN project_deletion_recovery_objects r USING(object_id)
        WHERE o.object_id=$1 AND r.lifecycle_status='completed' AND o.lifecycle_state='published'
        AND r.organization_id=$2 AND r.project_id=$3 AND r.content_sha256=$4 AND r.object_purpose=$5`,
          [objectId, b.organizationId, b.projectId, sha, plan.purpose],
        ),
      );
      if (prior.rows.length !== 1)
        throw Error("Recovery publication outcome is uncertain.");
      const ref = exportStoredObject(cleanupRequired(prior.rows[0]));
      await this.read(ref, plan.createdByPrincipalId);
      this.#published.set(objectId, ref);
      return ref;
    }
    try {
      if (this.#history !== undefined) {
        await this.#history.prepare(envelope);
        await confirmCleanupHistory({
          history: this.#history,
          envelope,
          state: "prepared",
        });
        await this.#history.transition(envelope, "prepared", "issued");
        await confirmCleanupHistory({
          history: this.#history,
          envelope,
          state: "issued",
        });
      }
      const staged = await this.#store.stage(
        this.#scope(plan.createdByPrincipalId),
        {
          objectId,
          owner: { organizationId: b.organizationId, projectId: b.projectId },
          contentSha256: sha,
          sizeBytes: plan.bytes.length,
          mediaType: plan.mediaType ?? "application/json",
          purpose: plan.purpose,
          open: async function* () {
            yield await Promise.resolve(plan.bytes.slice());
          },
        },
      );
      if (
        staged.storageProvider !== "s3" ||
        staged.owner.organizationId !== b.organizationId ||
        staged.owner.projectId !== b.projectId ||
        staged.contentSha256 !== sha ||
        staged.objectId !== objectId ||
        staged.sizeBytes !== plan.bytes.length ||
        staged.purpose !== plan.purpose ||
        staged.mediaType !== (plan.mediaType ?? "application/json")
      )
        throw Error("Canonical publication binding is invalid.");
      await this.#store.publish(this.#scope(plan.createdByPrincipalId), staged);
      if (this.#history !== undefined) {
        await this.#history.transition(envelope, "issued", "completed", {
          objectVersion: staged.objectVersion,
          ...(staged.entityTag === undefined
            ? {}
            : { entityTag: staged.entityTag }),
        });
        await confirmCleanupHistory({
          history: this.#history,
          envelope,
          state: "completed",
        });
      }
      await this.#authority.transaction(async (tx) => {
        await tx.query(
          sql(
            `INSERT INTO stored_objects(object_id,organization_id,project_id,storage_provider,object_purpose,storage_key,
          object_version,entity_tag,content_sha256,size_bytes,media_type,lifecycle_state,created_by_principal_id,published_at)
          VALUES($1,$2,$3,'s3',$4,$5,$6,$7,$8,$9,$11,'published',$10,clock_timestamp())`,
            [
              objectId,
              b.organizationId,
              b.projectId,
              plan.purpose,
              staged.storageKey,
              staged.objectVersion,
              staged.entityTag ?? null,
              sha,
              plan.bytes.length,
              plan.createdByPrincipalId,
              plan.mediaType ?? "application/json",
            ],
          ),
        );
        await tx.query(
          sql(
            "UPDATE project_deletion_recovery_objects SET lifecycle_status='completed',finalized_at=clock_timestamp() WHERE object_id=$1 AND lifecycle_status='in-flight'",
            [objectId],
          ),
        );
      });
      const bytes = await this.read(staged, plan.createdByPrincipalId);
      if (!Buffer.from(bytes).equals(Buffer.from(plan.bytes)))
        throw Error("Canonical recovery bytes did not read back.");
      this.#published.set(objectId, staged);
      return staged;
    } catch (error) {
      try {
        await this.#authority.query(
          sql(
            "UPDATE project_deletion_recovery_objects SET lifecycle_status='uncertain',finalized_at=clock_timestamp() WHERE object_id=$1 AND lifecycle_status='in-flight'",
            [objectId],
          ),
        );
      } catch {
        /* In-flight remains a durable blocker. No timer clears it. */
      }
      throw error;
    }
  }
  /** Only primed completed exact JSON is served to the repository. Its transaction
   * may perform no new S3 body write; canonical SQL CAS/audit remains unchanged. */
  jobPort(): AsyncJobPersistenceObjectPort {
    return {
      put: (input) => {
        const plan = [...this.#plans.entries()].find(
          ([, p]) =>
            p.purpose === "report" &&
            input.kind === "job-record" &&
            Buffer.from(p.bytes).equals(Buffer.from(input.bytes)) &&
            input.digest === `sha256:${digest(p.bytes)}`,
        );
        const ref =
          plan === undefined ? undefined : this.#published.get(plan[0]);
        if (
          ref === undefined ||
          input.ownership.organizationId !==
            this.#authority.binding.organizationId ||
          input.ownership.projectId !== this.#authority.binding.projectId
        )
          return Promise.reject(
            Error("Repository cannot publish unprimed deletion content."),
          );
        return Promise.resolve({
          objectId: ref.objectId,
          digest: sha256DigestSchema.parse(`sha256:${ref.contentSha256}`),
          sizeBytes: ref.sizeBytes,
        });
      },
      get: (input) => {
        const b = this.#authority.binding;
        const hydrated = this.#reads.get(input.objectId);
        const purpose: ObjectPurpose =
          input.kind === "input" ? "input-payload" : "report";
        if (
          input.ownership.organizationId !== b.organizationId ||
          input.ownership.projectId !== b.projectId ||
          hydrated?.reference.purpose !== purpose ||
          hydrated.reference.contentSha256 !== input.digest.slice(7) ||
          hydrated.reference.sizeBytes !== input.sizeBytes
        )
          return Promise.reject(
            Error("Repository cannot read unprimed deletion content."),
          );
        return Promise.resolve(hydrated.bytes.slice());
      },
    };
  }
}
