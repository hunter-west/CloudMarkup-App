import { expect, it } from "vitest";
import { currentAiCanvasFixture } from "./ai-canvas-context-test-helpers.js";
import { projectAiSemanticContextV3 } from "./ai-semantic-context.js";
it("rejects an older project without changing its catalog or content", () => {
  const document = currentAiCanvasFixture();
  document.catalog = {
    ...document.catalog,
    version: "0.19.0",
  } as typeof document.catalog;
  const before = structuredClone(document);
  expect(() => projectAiSemanticContextV3(document)).toThrow(
    "This revision uses an unsupported AWS catalog.",
  );
  expect(document).toEqual(before);
});
