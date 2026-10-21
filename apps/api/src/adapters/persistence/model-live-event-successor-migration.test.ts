import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  modelLiveEventCriterionV211,
  fullBetaEventEvaluationPolicyV2,
} from "@cloudmarkup/model-gateway";
import { splitPostgresStatements, loadMigrations } from "./migrations.js";
import { fileURLToPath } from "node:url";
it("registers exact 0059 and preserves the actual parser predecessor guards", async () => {
  const directory = new URL("../../../migrations/", import.meta.url);
  const prior = await readFile(
    new URL(
      "../../../migrations/0057_model_live_parser_input_receipts.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(createHash("sha256").update(prior).digest("hex")).toBe(
    "67b5381a6e46f30d3b71635d7fddd6d047a73c66e808106a21e685697a656184",
  );
  const next = await readFile(
    new URL("0059_model_live_event_criterion_policy.sql", directory),
    "utf8",
  );
  expect(splitPostgresStatements(next)).toHaveLength(3);
  expect(next.match(/CREATE (?:OR REPLACE )?FUNCTION/gu)).toHaveLength(3);
  expect(next.match(/\$\$/gu)).toHaveLength(6);
  expect(
    next.match(
      /CREATE OR REPLACE FUNCTION cloudmarkup_live_proposal_assessment_shape/gu,
    ),
  ).toHaveLength(1);
  expect(
    next.match(
      /CREATE OR REPLACE FUNCTION validate_model_live_proposal_validation_insert/gu,
    ),
  ).toHaveLength(1);
  expect(next).toContain(
    "AND policy->>'evaluationPolicyDigest' ~ '^sha256:[a-f0-9]{64}$') IS NOT TRUE",
  );
  expect(next).toContain(modelLiveEventCriterionV211.criterionDigest);
  expect(next).toContain(
    fullBetaEventEvaluationPolicyV2.evaluationPolicyDigest,
  );
  const guard =
    "  SELECT * INTO parser_input FROM model_live_parser_input_receipts";
  expect(next.slice(next.indexOf(guard))).toBe(
    prior.slice(prior.indexOf(guard)),
  );
  expect(next).not.toMatch(
    /(?:ALTER\s+TABLE|CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+model_|DELETE\s+FROM)/iu,
  );
  const registered = await loadMigrations(
    fileURLToPath(new URL("../../../migrations/", import.meta.url)),
  );
  expect(registered.at(-1)?.version).toBe("0138");
  expect(
    registered
      .filter((m) => m.version >= "0058" && m.version <= "0059")
      .map((m) => m.statements.length),
  ).toEqual([29, 3]);
});

it("preserves the exact historical 2.8 assessor bytes", async () => {
  const bytes = await readFile(
    new URL("../../model-live-event-case-assessment.ts", import.meta.url),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "bea6f86537b8147f729423e7435769a882d5b4d99d09b4cc21a884572dfa88fd",
  );
});
