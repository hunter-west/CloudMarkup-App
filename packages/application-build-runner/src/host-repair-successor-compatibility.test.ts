import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateApplicationHostRepairSuccessorV2JsonSchema } from "./host-repair-successor-contracts.js";

describe("final host repair additive schema", () => {
  it("matches its separate checked artifact and leaves historical schemas unchanged", () => {
    expect(
      readFileSync(
        new URL(
          "../json-schema/application-host-repair-successor-v2.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ).toBe(
      JSON.stringify(generateApplicationHostRepairSuccessorV2JsonSchema()) +
        "\n",
    );
    for (const name of [
      "application-host-repair-seed-v1",
      "application-host-repair-candidate-v1",
    ])
      expect(
        readFileSync(
          new URL("../json-schema/" + name + ".schema.json", import.meta.url),
          "utf8",
        ),
      ).not.toContain("model-successor-of-host-repair");
    expect(
      readFileSync(new URL("./index.ts", import.meta.url), "utf8"),
    ).not.toContain("host-repair");
  });
});
