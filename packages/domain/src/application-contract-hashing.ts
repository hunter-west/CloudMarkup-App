import {
  applicationContractRecordV1Schema,
  normalizeApplicationContractRecordV1,
  serializeCanonicalJson,
  type Sha256Digest,
} from "@cloudmarkup/schemas";

import { sha256Hex } from "./sha256.js";

export function getApplicationContractRecordContentHash(
  input: unknown,
): Sha256Digest {
  const contract = applicationContractRecordV1Schema.parse(input);
  return `sha256:${sha256Hex(
    serializeCanonicalJson(normalizeApplicationContractRecordV1(contract)),
  )}` as Sha256Digest;
}
