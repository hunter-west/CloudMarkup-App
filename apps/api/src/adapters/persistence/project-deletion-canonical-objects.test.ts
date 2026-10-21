import { describe, expect, it, vi } from "vitest";
import {
  ProjectDeletionCanonicalObjects,
  type CanonicalDeletionObjectPlan,
} from "./project-deletion-canonical-objects.js";
import type { ProjectDeletionRecoveryAuthority } from "./project-deletion-recovery-authority.js";
import type { ObjectStore } from "../../application/persistence.js";
import {
  cleanupHistoryId,
  type CleanupHistoryPort,
  type CleanupHistoryRecord,
} from "../../application/project-cleanup-history.js";
import type { SqlDatabase, SqlRow, SqlStatement, SqlResult } from "./sql.js";
const binding = {
  organizationId: "org_test",
  projectId: "project_test",
  recordVersion: 2,
  deletionRequestedAt: "2026-10-03T00:00:00.000Z",
};
const plan: CanonicalDeletionObjectPlan = {
  bytes: new TextEncoder().encode('{"canonical":"terminal"}'),
  purpose: "report",
  jobId: "job_test",
  jobRecordVersion: 3,
  createdByPrincipalId: "principal_test",
};
function fixture() {
  let registered = false,
    failRegistration = false,
    failCompletion = false,
    status = "in-flight",
    failBody = false,
    failIssue = false;
  const events: string[] = [],
    records = new Map<string, CleanupHistoryRecord>();
  const query = vi.fn(async (s: SqlStatement): Promise<SqlResult> => {
    await Promise.resolve();
    events.push(s.text);
    if (s.text.startsWith("SELECT lifecycle_status"))
      return {
        rows: registered ? [{ lifecycle_status: status }] : [],
        rowCount: registered ? 1 : 0,
      };
    if (s.text.startsWith("INSERT INTO project_deletion_recovery_objects")) {
      if (failRegistration) throw Error("registration commit unavailable");
      registered = true;
    }
    if (s.text.startsWith("INSERT INTO stored_objects")) {
      if (failCompletion) throw Error("SQL completion lost");
    }
    if (s.text.includes("SET lifecycle_status='uncertain'"))
      status = "uncertain";
    return { rows: [], rowCount: 0 };
  });
  const database: SqlDatabase = {
    query: <T extends SqlRow>(s: SqlStatement) =>
      query(s) as Promise<SqlResult<T>>,
    transaction: async (work) => work(database),
    close: () => Promise.resolve(),
  };
  const authority = {
    ...database,
    binding,
  } as unknown as ProjectDeletionRecoveryAuthority;
  const history: CleanupHistoryPort = {
    prepare: async (envelope) => {
      await Promise.resolve();
      events.push("history prepared");
      records.set(cleanupHistoryId(envelope), { envelope, state: "prepared" });
    },
    read: (id) => Promise.resolve(records.get(id) ?? null),
    page: () => Promise.resolve({ records: [] }),
    transition: async (envelope, from, to, completion) => {
      await Promise.resolve();
      if (to === "issued" && failIssue) throw Error("issuance unavailable");
      const prior = records.get(cleanupHistoryId(envelope));
      if (prior?.state !== from) throw Error("conditional history mismatch");
      events.push("history " + to);
      records.set(cleanupHistoryId(envelope), {
        envelope,
        state: to,
        ...(completion === undefined ? {} : { completion }),
      });
    },
  };
  const stage = vi.fn<ObjectStore["stage"]>(async (_scope, input) => {
    await Promise.resolve();
    events.push("body issued");
    expect(registered).toBe(true);
    expect([...records.values()][0]?.state).toBe("issued");
    if (failBody) throw Error("PUT response unknown");
    return {
      storageProvider: "s3",
      storageKey: "canonical-key",
      objectVersion: "actual-version",
      entityTag: '"actual-etag"',
      owner: input.owner,
      objectId: input.objectId,
      purpose: input.purpose,
      mediaType: input.mediaType,
      contentSha256: input.contentSha256,
      sizeBytes: input.sizeBytes,
    };
  });
  const publish = vi.fn(() => Promise.resolve()),
    store = { stage, publish } as unknown as ObjectStore;
  const objects = new ProjectDeletionCanonicalObjects(
      authority,
      store,
      [plan],
      history,
    ),
    id = objects.identity(plan);
  return {
    objects,
    id,
    stage,
    publish,
    query,
    events,
    records,
    failRegistration: () => {
      failRegistration = true;
    },
    failCompletion: () => {
      failCompletion = true;
    },
    failBody: () => {
      failBody = true;
    },
    failIssue: () => {
      failIssue = true;
    },
    status: () => status,
  };
}
describe("canonical deletion publication fencing", () => {
  it("does not issue body or external history before SQL registration commits", async () => {
    const f = fixture();
    f.failRegistration();
    await expect(f.objects.publish(f.id)).rejects.toThrow(/registration/);
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
  });
  it("cannot issue a body until external issuance is strongly confirmed", async () => {
    const f = fixture();
    f.failIssue();
    await expect(f.objects.publish(f.id)).rejects.toThrow(/issuance/);
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.status()).toBe("uncertain");
    expect([...f.records.values()][0]?.state).toBe("prepared");
  });
  it("unknown PUT keeps ISSUED history and durable SQL uncertainty with no automatic resend", async () => {
    const f = fixture();
    f.failBody();
    await expect(f.objects.publish(f.id)).rejects.toThrow(/unknown/);
    expect([...f.records.values()][0]?.state).toBe("issued");
    expect(f.status()).toBe("uncertain");
    expect(f.publish).not.toHaveBeenCalled();
    await expect(f.objects.publish(f.id)).rejects.toThrow(/uncertain/);
    expect(f.stage).toHaveBeenCalledOnce();
  });
  it("retains actual completed provider proof before a lost SQL completion and refuses resend", async () => {
    const f = fixture();
    f.failCompletion();
    await expect(f.objects.publish(f.id)).rejects.toThrow(/SQL completion/);
    const retained = [...f.records.values()][0];
    expect(retained?.state).toBe("completed");
    expect(retained?.completion).toEqual({
      objectVersion: "actual-version",
      entityTag: '"actual-etag"',
    });
    expect(f.events.indexOf("history completed")).toBeLessThan(
      f.events.findIndex((e) => e.startsWith("INSERT INTO stored_objects")),
    );
    await expect(f.objects.publish(f.id)).rejects.toThrow(/uncertain/);
    expect(f.stage).toHaveBeenCalledOnce();
  });
  it("rejects request supplied or changed canonical bytes without issuance", async () => {
    const f = fixture();
    await expect(f.objects.publish("object_unplanned")).rejects.toThrow(
      /Unplanned/,
    );
    expect(f.stage).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
});
