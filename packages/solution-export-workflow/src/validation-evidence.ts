import {
  evidenceRecordV1Schema,
  serializeCanonicalJson,
  type EvidenceRecordV1,
} from "@cloudmarkup/schemas";
import {
  encodeUtf8,
  sha256Digest,
  solutionExportSupplementalFileV1Schema,
  type SolutionExportSupplementalFileV1,
} from "@cloudmarkup/solution-export";

const CLOUDFORMATION_EVIDENCE_DIRECTORY = "evidence/cloudformation-validation";
const TERRAFORM_EVIDENCE_DIRECTORY = "evidence/terraform-validation";

function portableEvidenceFileName(
  evidenceId: string,
  targetLabel: string,
): string {
  const stem = evidenceId
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 75);
  if (stem.length === 0) {
    throw new TypeError(
      targetLabel + " validation Evidence ID is not portable.",
    );
  }
  return `evidence-${stem}.json`;
}

function validationEvidenceSupplementalFiles(
  rawRecords: readonly EvidenceRecordV1[],
  directory: string,
  targetLabel: string,
): readonly SolutionExportSupplementalFileV1[] {
  const byPath = new Map<string, SolutionExportSupplementalFileV1>();
  for (const rawRecord of rawRecords) {
    const record = evidenceRecordV1Schema.parse(rawRecord);
    const actor = record.provenance.actor;
    if (
      actor.kind !== "deterministic-tool" ||
      actor.tool.digest === undefined
    ) {
      throw new TypeError(
        targetLabel +
          " validation Evidence requires an exact deterministic tool pin.",
      );
    }
    const path =
      directory + "/" + portableEvidenceFileName(record.id, targetLabel);
    const collisionKey = path.normalize("NFC").toLowerCase();
    if (byPath.has(collisionKey)) {
      throw new TypeError(
        targetLabel +
          " validation Evidence paths collide on a portable filesystem.",
      );
    }
    const content = serializeCanonicalJson(record);
    const bytes = encodeUtf8(content);
    const checksum = sha256Digest(bytes);
    byPath.set(
      collisionKey,
      solutionExportSupplementalFileV1Schema.parse({
        checksum,
        content: { encoding: "utf8", value: content },
        kind: "regular-file",
        mediaType: "application/json",
        ownership: "evidence-artifact",
        path,
        provenance: {
          producer: actor.tool,
          solutionRevisionId: record.solutionRevisionId,
          sourceReferences: [{ id: record.id, kind: "evidence" }],
        },
        semanticChecksum: checksum,
      }),
    );
  }
  return [...byPath.values()].sort((left, right) =>
    left.path === right.path ? 0 : left.path < right.path ? -1 : 1,
  );
}

/** Project validated, data-only Terraform Evidence into immutable export files. */
export function terraformValidationEvidenceSupplementalFiles(
  rawRecords: readonly EvidenceRecordV1[],
): readonly SolutionExportSupplementalFileV1[] {
  return validationEvidenceSupplementalFiles(
    rawRecords,
    TERRAFORM_EVIDENCE_DIRECTORY,
    "Terraform",
  );
}

/** Project structured CloudFormation local-validation Evidence into export files. */
export function cloudFormationValidationEvidenceSupplementalFiles(
  rawRecords: readonly EvidenceRecordV1[],
): readonly SolutionExportSupplementalFileV1[] {
  return validationEvidenceSupplementalFiles(
    rawRecords,
    CLOUDFORMATION_EVIDENCE_DIRECTORY,
    "CloudFormation",
  );
}
