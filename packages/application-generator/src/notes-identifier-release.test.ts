import { describe, expect, it } from "vitest";
import { generateApplication } from "./generate.js";
import { NOTES_IDENTIFIER_RELEASE_V1_1 } from "./notes-identifier-release.js";
import { sourceDescriptor } from "./source-emitter.js";
import { createNotesGenerationRequest } from "./test-fixtures.js";

const options = {
  identifierSafeGenerator: true,
  entityContractId: "contracts.repair-seed.entity",
  operations: ["create", "read", "update", "delete"],
} as const;

describe("notes identifier release 1.1", () => {
  it("retains original default pins and historical hyphen rendering", () => {
    const old = generateApplication(
      createNotesGenerationRequest({
        ...options,
        identifierSafeGenerator: false,
      }),
    );
    expect(old.artifact.generator).toEqual(sourceDescriptor().generator);
    expect(
      old.artifact.sourceFiles.some(
        (file) =>
          "content" in file &&
          file.content.includes(
            "interface Entity_contracts_repair-seed_entity",
          ),
      ),
    ).toBe(true);
    expect(createNotesGenerationRequest()).toEqual(
      createNotesGenerationRequest({ identifierSafeGenerator: false }),
    );
  });

  it("binds successor source, manifest and revision without changing deployment paths", () => {
    const request = createNotesGenerationRequest(options);
    const result = generateApplication(request);
    const old = generateApplication(
      createNotesGenerationRequest({
        ...options,
        identifierSafeGenerator: false,
      }),
    );
    expect(result.artifact.diagnostics).toEqual([]);
    for (const field of ["generator", "template", "pattern"] as const) {
      expect(result.artifact[field]).toEqual(
        NOTES_IDENTIFIER_RELEASE_V1_1[field],
      );
      expect(result.artifact.sourceManifest[field]).toEqual(
        NOTES_IDENTIFIER_RELEASE_V1_1[field],
      );
    }
    expect(request.solutionRevision.versions.applicationGenerator).toEqual({
      state: "pinned",
      tool: NOTES_IDENTIFIER_RELEASE_V1_1.generator,
    });
    expect(result.artifact.sourceFiles.map((file) => file.path)).toEqual(
      old.artifact.sourceFiles.map((file) => file.path),
    );
    expect(
      result.artifact.buildContracts.map((entry) => entry.contract.entrypoint),
    ).toEqual(
      old.artifact.buildContracts.map((entry) => entry.contract.entrypoint),
    );
    expect(generateApplication(request)).toEqual(result);
  });

  it("keeps punctuated contract identities distinct", () => {
    const names = ["contracts.a-b.entity", "contracts.a.b.entity"].map(
      (entityContractId) => {
        const result = generateApplication(
          createNotesGenerationRequest({ ...options, entityContractId }),
        );
        expect(result.artifact.diagnostics).toEqual([]);
        const typeFile = result.artifact.sourceFiles.find((file) =>
          file.path.endsWith("/generated/types.ts"),
        );
        if (typeFile === undefined || !("content" in typeFile))
          throw new Error("Missing types.");
        return /export interface (Entity_[a-f0-9]{64})/.exec(
          typeFile.content,
        )?.[1];
      },
    );
    expect(names.every((name) => name !== undefined)).toBe(true);
    expect(new Set(names).size).toBe(2);
  });

  it.each(["template", "pattern"] as const)(
    "rejects mixed historical %s coordinates",
    (field) => {
      const request = createNotesGenerationRequest(options);
      const result = generateApplication({
        ...request,
        [field]: sourceDescriptor()[field],
      });
      expect(result.artifact.diagnostics.map((entry) => entry.code)).toContain(
        "APPLICATION_DESCRIPTOR_UNSUPPORTED",
      );
      expect(result.artifact.buildContracts).toEqual([]);
    },
  );

  it("rejects a historical revision pin on a successor request", () => {
    const request = createNotesGenerationRequest(options);
    expect(() =>
      generateApplication({
        ...request,
        solutionRevision: {
          ...request.solutionRevision,
          versions: {
            ...request.solutionRevision.versions,
            applicationGenerator: {
              state: "pinned",
              tool: sourceDescriptor().generator,
            },
          },
        },
      }),
    ).toThrow("Solution Revision must pin the exact application generator.");
  });

  it("rejects an unregistered generator version", () => {
    const request = createNotesGenerationRequest(options);
    const generator = { ...request.generator, version: "1.2.0" };
    const result = generateApplication({
      ...request,
      generator,
      solutionRevision: {
        ...request.solutionRevision,
        versions: {
          ...request.solutionRevision.versions,
          applicationGenerator: { state: "pinned", tool: generator },
        },
      },
    });
    expect(result.artifact.diagnostics.map((entry) => entry.code)).toContain(
      "APPLICATION_DESCRIPTOR_UNSUPPORTED",
    );
    expect(result.artifact.buildContracts).toEqual([]);
  });
});
