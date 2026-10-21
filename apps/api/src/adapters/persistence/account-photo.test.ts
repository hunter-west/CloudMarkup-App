import { Resvg } from "@resvg/resvg-js";
import { afterEach, expect, it, vi } from "vitest";
import type { PrincipalContext } from "../../application/ports.js";
import { PostgresAccountPhoto } from "./account-photo.js";
import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlResult,
  SqlStatement,
} from "./sql.js";
import * as raster from "./account-photo-raster.js";
const photo =
  "data:image/png;base64," +
  new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#365ec8"/></svg>',
    { font: { loadSystemFonts: false } },
  )
    .render()
    .asPng()
    .toString("base64");
const context = (principalId = "principal_photo"): PrincipalContext => ({
  principalId,
  sessionId: "session_photo",
  correlationId: "correlation_photo",
  authenticationSource: "test",
  authenticatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 600000).toISOString(),
});
/** Synthetic transactional port; PostgreSQL locking/constraints require the separate integration suite. */
function fixture() {
  let rows = new Map<
    string,
    { readonly record_version: number; readonly encoded: string | null }
  >();
  const active = new Set(["principal_photo", "principal_other"]),
    calls: SqlStatement[] = [];
  let fault: "audit" | "expiry" | "lock-expiry" | "lock-reauth" | null = null;
  const database: SqlDatabase = {
    close: () => Promise.resolve(),
    query: () => Promise.reject(Error("Use transaction")),
    transaction: async (work) => {
      const snapshot = new Map(rows);
      const tx: SqlExecutor = {
        query: async <TRow extends SqlRow>(
          statement: SqlStatement,
        ): Promise<SqlResult<TRow>> => {
          await Promise.resolve();
          calls.push(statement);
          const actor = String(statement.values[0]);
          let result: readonly SqlRow[] = [];
          if (statement.text.startsWith("SELECT principal_id")) {
            result = active.has(actor) ? [{ principal_id: actor }] : [];
            if (fault === "lock-expiry" || fault === "lock-reauth")
              vi.setSystemTime(
                Date.now() + (fault === "lock-expiry" ? 700000 : 660000),
              );
          } else if (statement.text.startsWith("SELECT record_version"))
            result = rows.has(actor) ? [rows.get(actor) as SqlRow] : [];
          else if (
            statement.text.startsWith("INSERT INTO principal_account_photos")
          )
            rows.set(actor, {
              record_version: Number(statement.values[1]),
              encoded:
                statement.values[2] === null
                  ? null
                  : Buffer.from(statement.values[2] as Uint8Array).toString(
                      "base64",
                    ),
            });
          else if (
            statement.text.startsWith(
              "INSERT INTO principal_account_photo_events",
            )
          ) {
            if (fault === "audit") throw Error("Synthetic audit failure");
            if (fault === "expiry") vi.setSystemTime(Date.now() + 700000);
          } else throw Error("Unexpected SQL");
          return { rows: result as readonly TRow[], rowCount: result.length };
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        rows = snapshot;
        throw error;
      }
    },
  };
  return {
    app: new PostgresAccountPhoto(database),
    database,
    calls,
    active,
    fault: (value: typeof fault) => {
      fault = value;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
});
it("binds saved reads/change/remove to one actor and retains versions across fresh application instances", async () => {
  const f = fixture(),
    actor = context(),
    other = context("principal_other"),
    before = await f.app.get(actor);
  const after = await f.app.update(
    actor,
    { contractVersion: 1, image: photo },
    before.etag,
  );
  expect(after.value).toMatchObject({
    principalId: actor.principalId,
    version: 1,
  });
  expect(after.value.image).not.toBeNull();
  expect(await new PostgresAccountPhoto(f.database).get(actor)).toEqual(after);
  expect((await f.app.get(other)).value).toMatchObject({
    image: null,
    version: 0,
  });
  expect(
    await f.app.update(
      actor,
      { contractVersion: 1, image: after.value.image },
      after.etag,
    ),
  ).toEqual(after);
  const removed = await f.app.update(
    actor,
    { contractVersion: 1, image: null },
    after.etag,
  );
  expect(removed.value).toMatchObject({ image: null, version: 2 });
  await expect(
    f.app.update(actor, { contractVersion: 1, image: photo }, before.etag),
  ).rejects.toMatchObject({ code: "precondition_failed" });
  const audits = f.calls.filter((call) =>
    call.text.startsWith("INSERT INTO principal_account_photo_events"),
  );
  expect(audits.map((call) => call.values)).toEqual([
    [actor.principalId, 1, "changed", actor.correlationId],
    [actor.principalId, 2, "removed", actor.correlationId],
  ]);
});
it("rejects foreign selectors, cross-actor ETags, inactive identities, expired tokens and old authentication", async () => {
  const f = fixture(),
    actor = context(),
    before = await f.app.get(actor),
    other = context("principal_other");
  await expect(
    f.app.update(other, { contractVersion: 1, image: photo }, before.etag),
  ).rejects.toMatchObject({ code: "precondition_failed" });
  await expect(
    f.app.update(
      actor,
      { contractVersion: 1, image: photo, principalId: other.principalId },
      before.etag,
    ),
  ).rejects.toMatchObject({ code: "invalid_request" });
  await expect(
    f.app.get({ ...actor, expiresAt: new Date(0).toISOString() }),
  ).rejects.toMatchObject({ code: "authentication_required" });
  await expect(
    f.app.update(
      {
        ...actor,
        authenticatedAt: new Date(Date.now() - 660000).toISOString(),
      },
      { contractVersion: 1, image: photo },
      before.etag,
    ),
  ).rejects.toMatchObject({ code: "access_denied" });
  f.active.delete(actor.principalId);
  await expect(f.app.get(actor)).rejects.toMatchObject({
    code: "authentication_required",
  });
  expect((await f.app.get(other)).value.image).toBeNull();
});
it.each(["audit", "expiry", "lock-expiry", "lock-reauth"] as const)(
  "leaves bytes/version unchanged when transaction authority or audit fails: %s",
  async (mode) => {
    const f = fixture(),
      actor = context(),
      before = await f.app.get(actor);
    vi.useFakeTimers({ toFake: ["Date"] });
    const target =
      mode === "lock-reauth"
        ? { ...actor, expiresAt: new Date(Date.now() + 3600000).toISOString() }
        : actor;
    f.fault(mode);
    await expect(
      f.app.update(target, { contractVersion: 1, image: photo }, before.etag),
    ).rejects.toThrow();
    vi.useRealTimers();
    f.fault(null);
    expect(await f.app.get(actor)).toEqual(before);
  },
);
it.each(["expiry", "reauth", "revocation"] as const)(
  "rolls back a real raster upload when authority changes after rendering: %s",
  async (mode) => {
    const f = fixture(),
      actor = context(),
      before = await f.app.get(actor);
    const target =
      mode === "reauth"
        ? { ...actor, expiresAt: new Date(Date.now() + 3600000).toISOString() }
        : actor;
    const canonical = raster.canonicalAccountPhoto;
    vi.useFakeTimers({ toFake: ["Date"] });
    const render = vi
      .spyOn(raster, "canonicalAccountPhoto")
      .mockImplementation((image) => {
        const bytes = canonical(image);
        if (mode === "revocation") f.active.delete(actor.principalId);
        else vi.setSystemTime(Date.now() + 700000);
        return bytes;
      });
    try {
      await expect(
        f.app.update(target, { contractVersion: 1, image: photo }, before.etag),
      ).rejects.toMatchObject({
        code: mode === "reauth" ? "access_denied" : "authentication_required",
      });
      expect(render).toHaveBeenCalledOnce();
    } finally {
      render.mockRestore();
      vi.useRealTimers();
      f.active.add(actor.principalId);
    }
    expect(await f.app.get(actor)).toEqual(before);
  },
);
