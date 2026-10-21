import { projectRepositoryInterpretationReviewV1 } from "@cloudmarkup/schemas";
import { Disclosure } from "@cloudmarkup/ui";
export type RepositoryInterpretationReviewInput = Omit<
  Parameters<typeof projectRepositoryInterpretationReviewV1>[0],
  "requestedMode"
>;
export function RepositoryInterpretationReview({
  input,
  requestedMode,
}: {
  readonly input: RepositoryInterpretationReviewInput;
  readonly requestedMode: "guided" | "professional";
}) {
  const review = projectRepositoryInterpretationReviewV1({
    ...input,
    requestedMode,
  });
  return (
    <section aria-label="Repository interpretation review">
      <h3>Repository interpretation</h3>
      <p>{review.explanation}</p>
      <h4>Imported observations</h4>
      {review.semantic.parseFindings.length === 0 ? (
        <p>No deterministic findings were established for this source.</p>
      ) : (
        <ul>
          {review.semantic.parseFindings.map((finding) => (
            <li key={finding.findingId}>
              <strong>{finding.status}</strong> · {finding.severity}:{" "}
              {finding.summary}
            </li>
          ))}
        </ul>
      )}
      <h4>Assistant suggestions</h4>
      {review.semantic.claims.length === 0 ? (
        <p>No assistant suggestions were returned.</p>
      ) : (
        <ul>
          {review.semantic.claims.map((claim) => (
            <li key={claim.claimId}>
              <p>
                <strong>Unverified suggestion</strong>: {claim.summary}
              </p>
              <p>{claim.confidence.rationale}</p>
              {claim.citations.map((citation, index) => (
                <div key={String(index)}>
                  {citation.source === null ? (
                    <p role="alert">
                      This citation does not match the imported source.
                    </p>
                  ) : (
                    <Disclosure summary={"Source: " + citation.source.path}>
                      <pre>
                        <code>{citation.source.content}</code>
                      </pre>
                    </Disclosure>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {review.semantic.unknowns.length === 0 ? null : (
        <>
          <h4>Still unresolved</h4>
          <ul>
            {review.semantic.unknowns.map((q) => (
              <li key={q.unknownId}>{q.question}</li>
            ))}
          </ul>
        </>
      )}
      {review.semantic.assumptions.length === 0 ? null : (
        <>
          <h4>Assumptions to review</h4>
          <ul>
            {review.semantic.assumptions.map((a) => (
              <li key={a.assumptionId}>{a.statement}</li>
            ))}
          </ul>
        </>
      )}
      <p>
        Reviewing these suggestions does not change the saved design or
        repository.
      </p>
    </section>
  );
}
