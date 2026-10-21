import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("validates only the admitted event case and exact completed invocation without new storage or writes", async () => {
  const source = await readFile(
    new URL(
      "../../../migrations/0053_model_live_event_validation_receipts.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(source).not.toMatch(
    /(?:ALTER\s+TABLE|CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+model_|DELETE\s+FROM)/iu,
  );
  expect(source).toContain(
    "evaluation_case_event_driven_image_processing_full_beta_v1",
  );
  expect(source).toContain(
    "live case validation requires exact completed active invocation",
  );
});
