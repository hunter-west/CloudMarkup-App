import { aiIntentPreviewCandidateFrameV1Schema } from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import {
  digestCanonicalValue,
  modelIntentExtractionResponseV1Schema,
} from "@cloudmarkup/schemas";
import intentFixture from "../../../../../packages/test-fixtures/fixtures/intent-document/v1/ambiguous/unknown-requirements.json";

// Synthetic browser receipt only. This is not provider, authenticated route,
// runtime admission, real journal ACK, accounting or accepted-Intent evidence.
export function createSyntheticAiPreviewCandidate(
  invocationId = "preview_browser_synthetic",
) {
  const candidate = modelIntentExtractionResponseV1Schema.parse({
    contractVersion: 1,
    operation: "intent.extract",
    intentDocument: intentFixture,
    proposalContext: {
      assumptions: [],
      unknowns: [],
      confidence: {
        basisPoints: 8000,
        evidenceReferences: [],
        rationale: "Synthetic browser receipt.",
      },
    },
    provenance: {
      contractVersion: 1,
      gatewayId: "cloudmarkup.model-gateway",
      invocationId,
      inputDigest: `sha256:${"a".repeat(64)}`,
      modelId: "cloudmarkup.synthetic-model",
      modelVersion: "1",
      ownership: "untrusted-proposal",
      promptDigest: `sha256:${"b".repeat(64)}`,
      promptTemplateId: "cloudmarkup.intent-extract",
      promptVersion: "1.0.0",
      providerId: "cloudmarkup.synthetic-provider",
    },
  });
  const frame = aiIntentPreviewCandidateFrameV1Schema.parse({
    contractVersion: 1,
    type: "candidate",
    candidate,
    delivery: {
      contractVersion: 1,
      invocationId,
      outputDigest: digestCanonicalValue(candidate),
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
      token: "A".repeat(43),
    },
  });
  parseIntentDocument(candidate.intentDocument);
  return frame;
}
