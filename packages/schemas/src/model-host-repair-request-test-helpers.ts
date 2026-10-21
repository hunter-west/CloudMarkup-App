import { digestCanonicalValue, sha256Text } from "./canonical-digest.js";
const path = "application/src/extensions/custom.ts";
const digest = digestCanonicalValue({ synthetic: true });
export function firstHostSeedRepairRequestFixture() {
  const failedCandidates = [
    {
      candidateId: "seed_file",
      content: 'export const witness: number = "invalid";\n',
      contentDigest: sha256Text('export const witness: number = "invalid";\n'),
      encoding: "utf-8",
      kind: "file",
      ownership: "user-owned",
      sourceAuthority: "fixed-host-synthetic",
      path,
    },
  ];
  return {
    contractVersion: 2,
    operation: "candidate.repair",
    requestedMode: "guided",
    boundary: {
      approvalPathIds: ["cloudmarkup.test"],
      boundaryId: "seed_boundary",
      ownedPaths: [path],
      writeAuthority: "candidate-artifacts-only",
    },
    diagnostics: [
      {
        candidateId: "seed_file",
        diagnosticId: "seed_diagnostic",
        checkKind: "build",
        message: "TS2322",
        noSecretValues: true,
        path,
        redactionStatus: "not-required",
        toolId: "cloudmarkup.typescript",
        toolVersion: "5.9.3",
      },
    ],
    failedCandidates,
    failedOutputDigest: digestCanonicalValue(failedCandidates),
    failedCandidatesCanonicalization:
      "cloudmarkup.model-host-seed-files.canonical-json.v2",
    currentAttempt: 1,
    maximumRepairAttempts: 2,
    validationExpectations: [
      {
        checkId: "cloudmarkup.typecheck",
        kind: "build",
        required: true,
        successCondition: "must-pass",
        toolProfileId: "cloudmarkup.fixed",
      },
    ],
    hostSeed: {
      recipeId: "cloudmarkup.model-live.repair-seed.typescript-assignment",
      recipeVersion: "1.1.0",
      recipeDigest: digest,
      sourceTreeDigest: digest,
      solutionRevisionDigest: digest,
      ownershipDigest: digest,
      seedValidationReceiptDigest: digest,
    },
  };
}
