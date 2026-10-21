import { describe, expect, it } from "vitest";

import {
  CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH,
  CONTRACT_GOLDEN_MAX_FILENAME_LENGTH,
  projectContractGoldenPaths,
  type ContractGoldenIdentity,
} from "./contract-golden-paths.js";

const CHECKSUM_A = `sha256:${"a".repeat(64)}`;
const CHECKSUM_B = `sha256:${"b".repeat(64)}`;

function identity(
  overrides: Partial<ContractGoldenIdentity> = {},
): ContractGoldenIdentity {
  return {
    canonicalPath: "application/contracts/notes-create-operation.json",
    checksum: CHECKSUM_A,
    contractId: "contracts.notes.create.operation",
    contractVersion: "1.2.3",
    ...overrides,
  };
}

function entries(
  projected: ReadonlyMap<string, string>,
): readonly (readonly [string, string])[] {
  return [...projected.entries()];
}

describe("Prompt 30 compact contract golden paths", () => {
  it("keeps a unique bounded logical identity readable and unsuffixed", () => {
    const projected = projectContractGoldenPaths([identity()]);

    expect(entries(projected)).toEqual([
      [
        "application/contracts/notes-create-operation.json",
        "notes-create-operation-v1-2-3.json",
      ],
    ]);
  });

  it("uses explicit UTF-16 source ordering independent of input order", () => {
    const values = [
      identity({
        canonicalPath: "application/contracts/a_thing.json",
        checksum: CHECKSUM_B,
        contractId: "contracts.sort.underscore",
      }),
      identity({
        canonicalPath: "application/contracts/az.json",
        contractId: "contracts.sort.letters",
      }),
      identity({
        canonicalPath: "application/contracts/a-thing.json",
        checksum: `sha256:${"c".repeat(64)}`,
        contractId: "contracts.sort.hyphen",
      }),
    ];

    const forward = entries(projectContractGoldenPaths(values));
    const reversed = entries(projectContractGoldenPaths([...values].reverse()));

    expect(forward).toEqual(reversed);
    expect(forward.map(([canonicalPath]) => canonicalPath)).toEqual([
      "application/contracts/a-thing.json",
      "application/contracts/a_thing.json",
      "application/contracts/az.json",
    ]);
  });

  it("suffixes every member of a logical collision with its checksum prefix", () => {
    const first = identity({
      canonicalPath: "application/contracts/first.json",
      contractId: "contracts.notes-create.operation",
    });
    const second = identity({
      canonicalPath: "application/contracts/second.json",
      checksum: CHECKSUM_B,
      contractId: "contracts.notes.create-operation",
    });

    expect(entries(projectContractGoldenPaths([second, first]))).toEqual([
      [
        first.canonicalPath,
        `notes-create-operation-v1-2-3-${"a".repeat(
          CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH,
        )}.json`,
      ],
      [
        second.canonicalPath,
        `notes-create-operation-v1-2-3-${"b".repeat(
          CONTRACT_GOLDEN_DIGEST_PREFIX_LENGTH,
        )}.json`,
      ],
    ]);
  });

  it("truncates an overlength identity to the exact filename budget", () => {
    const projected = projectContractGoldenPaths([
      identity({ contractId: `contracts.${"g".repeat(120)}` }),
    ]);
    const filename = [...projected.values()][0];

    expect(filename).toHaveLength(CONTRACT_GOLDEN_MAX_FILENAME_LENGTH);
    expect(filename).toMatch(new RegExp(`-${"a".repeat(12)}\\.json$`, "u"));
    expect(filename).not.toMatch(/[a-f0-9]{64}/u);
  });

  it("fails closed when colliding logical identities share a short prefix", () => {
    const sharedPrefix = "abc123def456";
    const first = identity({
      canonicalPath: "application/contracts/first.json",
      checksum: `sha256:${sharedPrefix}${"a".repeat(52)}`,
      contractId: "contracts.notes-create.operation",
    });
    const second = identity({
      canonicalPath: "application/contracts/second.json",
      checksum: `sha256:${sharedPrefix}${"b".repeat(52)}`,
      contractId: "contracts.notes.create-operation",
    });

    expect(() => projectContractGoldenPaths([second, first])).toThrow(
      new RegExp(
        `short-digest collision.*${first.canonicalPath}.*${second.canonicalPath}`,
        "u",
      ),
    );
  });

  it("rejects duplicate canonical source paths", () => {
    expect(() =>
      projectContractGoldenPaths([
        identity({
          canonicalPath: "application/contracts/duplicate.json",
          contractId: "contracts.notes.first",
        }),
        identity({
          canonicalPath: "application/contracts/duplicate.json",
          checksum: CHECKSUM_B,
          contractId: "contracts.notes.second",
        }),
      ]),
    ).toThrow(/duplicate .* source path/iu);
  });

  it.each([
    [
      "traversal",
      { canonicalPath: "application/contracts/../escape.json" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "nested path",
      { canonicalPath: "application/contracts/nested/file.json" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "backslash",
      { canonicalPath: "application/contracts/evil\\file.json" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "wrong extension",
      { canonicalPath: "application/contracts/file.txt" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "missing filename",
      { canonicalPath: "application/contracts/" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "uppercase filename",
      { canonicalPath: "application/contracts/File.json" },
      /flat portable application\/contracts JSON paths/u,
    ],
    [
      "short checksum",
      { checksum: "sha256:abc123" },
      /complete SHA-256 values/u,
    ],
    [
      "uppercase checksum",
      { checksum: `sha256:${"A".repeat(64)}` },
      /complete SHA-256 values/u,
    ],
    ["unnamespaced ID", { contractId: "notes" }, /namespaced identifiers/u],
    [
      "nonportable ID",
      { contractId: "contracts.notes/escape" },
      /namespaced identifiers/u,
    ],
    ["invalid version", { contractVersion: "v1" }, /semantic versions/u],
  ])(
    "rejects malicious or malformed %s input",
    (_label, overrides, expectedError) => {
      expect(() => projectContractGoldenPaths([identity(overrides)])).toThrow(
        expectedError,
      );
    },
  );
});
