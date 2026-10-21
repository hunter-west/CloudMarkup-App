import {
  getArchitectureDocumentHashes,
  parseArchitectureDocument,
} from "@cloudmarkup/domain";
import { describe, expect, it } from "vitest";

import {
  awsEditorArchitectureInput,
  loadManualNotesApiArchitectureDocument,
} from "./aws-editor-fixture.js";
import { awsEditorValidationEvaluator } from "./aws-editor-validation.js";

describe("AWS editor validation composition", () => {
  it("binds both requested targets to the exact document, provider, catalog, and unknown environment", async () => {
    const document = loadManualNotesApiArchitectureDocument();
    const hashes = getArchitectureDocumentHashes(document);
    const draftReport = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "draft",
    });
    const compilationReport = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "compilation",
    });

    for (const [target, report] of [
      ["draft", draftReport],
      ["compilation", compilationReport],
    ] as const) {
      expect(report.target).toBe(target);
      expect(report.environment).toBe("unknown");
      expect(report.documentHash).toBe(hashes.contentHash);
      expect(report.provider).toEqual(document.provider);
      expect(report.catalog).toEqual(document.catalog);
      expect(report.evaluationStatus).toBe("complete");
      expect(report.diagnostics).toEqual([]);
    }
  });

  it("returns byte-for-byte-equivalent deterministic report data for repeated evaluation", async () => {
    const document = loadManualNotesApiArchitectureDocument();
    const first = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "draft",
    });
    const second = await awsEditorValidationEvaluator.evaluate({
      document,
      target: "draft",
    });

    expect(second).toEqual(first);
    expect(second.findings.map((finding) => finding.findingId)).toEqual(
      first.findings.map((finding) => finding.findingId),
    );
    expect(second.executedRules).toEqual(first.executedRules);
  });

  it("rejects a structurally valid document that is not bound to the bundled catalog digest", () => {
    const document = parseArchitectureDocument({
      ...structuredClone(awsEditorArchitectureInput),
      catalog: {
        ...awsEditorArchitectureInput.catalog,
        digest: `sha256:${"0".repeat(64)}`,
      },
    });

    expect(() =>
      awsEditorValidationEvaluator.evaluate({
        document,
        target: "draft",
      }),
    ).toThrow(
      "The AWS validation evaluator requires the exact bundled provider catalog.",
    );
  });
});
