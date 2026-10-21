import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { goCompilationResultV1Schema } from "@cloudmarkup/solution-export-workflow";

import {
  architectureCliEventCompilerSourceFromModel,
  architectureCliGeneratedEventCases,
} from "./event-compiler-fixture-source.js";

describe("event compiler repository source corpus", () => {
  for (const eventCase of architectureCliGeneratedEventCases) {
    it(`keeps ${eventCase} catalog source bound to the checked compiler model`, () => {
      const fixtureRoot = new URL(
        `./fixtures/aws-eventing/compiler-v1/${eventCase}/`,
        import.meta.url,
      );
      const compilation = goCompilationResultV1Schema.parse(
        JSON.parse(
          readFileSync(new URL("compilation.json", fixtureRoot), "utf8"),
        ),
      );
      if (compilation.model === undefined) {
        throw new TypeError(
          `Event compiler fixture lacks a model for ${eventCase}.`,
        );
      }
      const expected = architectureCliEventCompilerSourceFromModel(
        eventCase,
        compilation.model,
      );
      const sourcePath = new URL("source.json", fixtureRoot);
      if (process.env["CLOUDMARKUP_UPDATE_EVENT_REPOSITORY_SOURCES"] === "1") {
        writeFileSync(sourcePath, JSON.stringify(expected, null, 2) + "\n");
      }
      const source: unknown = JSON.parse(readFileSync(sourcePath, "utf8"));
      expect(source).toEqual(expected);
    });
  }
});
