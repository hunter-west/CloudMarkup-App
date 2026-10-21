import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("additive explicit Intent acceptance migration", () => {
  it("keeps accepted Intent authority at the final deferred commit and preserves immutable receipts", async () => {
    const source = await readFile(
      new URL("../../../migrations/0046_accepted_intents.sql", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /CREATE CONSTRAINT TRIGGER accepted_intents_authority_commit AFTER INSERT ON accepted_intents\s+DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_ai_intent_preview_authority_commit\(\);/u,
    );
    expect(source).toMatch(
      /CREATE CONSTRAINT TRIGGER stored_objects_accepted_intent_commit AFTER INSERT OR UPDATE ON stored_objects\s+DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_accepted_intent_object_commit\(\);/u,
    );
    expect(source).toContain("reject_immutable_row_change()");
  });
});
