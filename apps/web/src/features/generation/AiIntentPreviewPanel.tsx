import {
  AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1,
  acceptedIntentV1Schema,
  type AcceptedIntentV1,
  type AcceptAiIntentPreviewV1,
  type AiIntentPreviewFrameV1,
  type CreateAiIntentPreviewV1,
} from "@cloudmarkup/api-contract";
import { parseIntentDocument } from "@cloudmarkup/domain";
import { digestCanonicalValue } from "@cloudmarkup/schemas";
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import {
  createBrowserAiIntentPreviewV1,
  type BrowserAiIntentPreviewAuthorityV1,
} from "./ai-intent-preview-client.js";

import { IntentRequirementsDetails } from "./IntentRequirementsDetails.js";

type Candidate = Extract<
  AiIntentPreviewFrameV1,
  { type: "candidate" }
>["candidate"];

/** Temporary content belongs only to this mounted, authorized workspace. A
 * candidate is retained synchronously before the transport acknowledges it.
 * Neither receipt confirmation nor viewing this panel accepts or saves Intent. */
export function AiIntentPreviewPanel({
  projectId,
  currentAuthority,
  requestedMode = "guided",
  editingAvailable = true,
  onAccept,
  onAccepted,
}: {
  readonly projectId: string;
  readonly onAccepted?: (record: AcceptedIntentV1) => void;
  readonly onAccept?: (
    body: AcceptAiIntentPreviewV1,
    headers: { "if-match": string; "idempotency-key": string },
  ) => Promise<AcceptedIntentV1>;
  readonly requestedMode?: CreateAiIntentPreviewV1["requestedMode"];
  readonly editingAvailable?: boolean;
  readonly currentAuthority: () =>
    BrowserAiIntentPreviewAuthorityV1 | undefined;
}) {
  const [requirements, setRequirements] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [pending, setPending] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState<AcceptedIntentV1 | null>(null);
  const acceptanceKey = useRef("");
  const originalAuthority = useRef<BrowserAiIntentPreviewAuthorityV1 | null>(
    null,
  );
  const acceptanceInFlight = useRef(false);
  const [message, setMessage] = useState("");
  const retained = useRef<Candidate | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const authority = useRef(currentAuthority);
  const mounted = useRef(false);
  const hasRetainedCandidate = () => retained.current !== null;
  useLayoutEffect(() => {
    authority.current = currentAuthority;
  }, [currentAuthority]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attempt.current?.abort();
      attempt.current = null;
      retained.current = null;
      originalAuthority.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (!editingAvailable) attempt.current?.abort();
  }, [editingAvailable]);
  async function preview(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (
      !editingAvailable ||
      attempt.current !== null ||
      acceptanceInFlight.current ||
      currentAuthority() === undefined
    )
      return;
    const initialAuthority = currentAuthority();
    if (initialAuthority === undefined) return;
    originalAuthority.current = structuredClone(initialAuthority);
    acceptanceKey.current =
      "intent-acceptance:" + globalThis.crypto.randomUUID();
    setAccepted(null);
    const controller = new AbortController();
    attempt.current = controller;
    retained.current = null;
    setCandidate(null);
    setPending(true);
    setMessage("Preparing the requirements preview…");
    const current = () => mounted.current && attempt.current === controller;
    try {
      const run = createBrowserAiIntentPreviewV1({
        currentAuthority: () => authority.current(),
        origin: () => window.location.origin,
        fetchImplementation: window.fetch.bind(window),
      });
      const result = await run({
        projectId,
        requirements,
        requestedMode,
        idempotencyKey: "intent-preview:" + globalThis.crypto.randomUUID(),
        signal: controller.signal,
        onCandidate: (value) => {
          if (!current() || controller.signal.aborted)
            throw new Error("Preview is no longer active.");
          retained.current = structuredClone(value);
          setCandidate(retained.current);
          setMessage("Review the extracted requirements and open questions.");
        },
      });
      if (!current()) return;
      setMessage(
        result.candidateHandedOff
          ? result.acknowledgement === "confirmed"
            ? "Preview received. Review the requirements below; your saved design has not changed."
            : "Preview received, but delivery confirmation is incomplete. Keep this page open while reviewing it."
          : controller.signal.aborted
            ? "Preview stopped. Your saved design has not changed."
            : "The preview service is unavailable. Your saved design has not changed.",
      );
    } catch {
      if (current())
        setMessage(
          !hasRetainedCandidate()
            ? controller.signal.aborted
              ? "Preview stopped. Your saved design has not changed."
              : "The preview service is unavailable. Your saved design has not changed."
            : "The connection ended after the preview arrived. Your preview is still available below.",
        );
    } finally {
      if (current()) {
        attempt.current = null;
        setPending(false);
      }
    }
  }
  async function accept() {
    const value = retained.current;
    const original = originalAuthority.current;
    const current = authority.current();
    if (
      onAccept === undefined ||
      value === null ||
      pending ||
      acceptanceInFlight.current
    )
      return;
    if (
      !editingAvailable ||
      original === null ||
      current?.principalId !== original.principalId ||
      current.sessionId !== original.sessionId ||
      current.projectId !== original.projectId ||
      current.draftEtag !== original.draftEtag ||
      current.editingProof.leaseId !== original.editingProof.leaseId ||
      current.editingProof.token !== original.editingProof.token
    ) {
      setMessage(
        "Original editing access has changed. Keep the preview open and restore access before accepting it.",
      );
      return;
    }
    acceptanceInFlight.current = true;
    setAccepting(true);
    setMessage("Saving accepted requirements…");
    try {
      const result = await onAccept(
        {
          contractVersion: 1,
          candidate: value,
          editingProof: original.editingProof,
        },
        {
          "if-match": original.draftEtag,
          "idempotency-key": acceptanceKey.current,
        },
      );
      if (!mounted.current || retained.current !== value) return;
      const response = acceptedIntentV1Schema.parse(result);
      const now = authority.current();
      if (
        now?.principalId !== original.principalId ||
        now.sessionId !== original.sessionId ||
        now.projectId !== original.projectId ||
        response.projectId !== projectId ||
        response.invocationId !== value.provenance.invocationId ||
        response.outputDigest !== digestCanonicalValue(value) ||
        response.intentDigest !==
          digestCanonicalValue(parseIntentDocument(value.intentDocument)) ||
        response.intentDigest !== digestCanonicalValue(response.intentDocument)
      )
        throw new Error("Accepted requirements response is unavailable.");
      setAccepted(response);
      setCandidate(null);
      retained.current = null;
      originalAuthority.current = null;
      setRequirements("");
      setMessage("Accepted requirements saved. The canvas has not changed.");
      onAccepted?.(response);
    } catch {
      if (mounted.current && retained.current === value)
        setMessage(
          "Saving could not be confirmed. Keep this preview open and retry to recover the same acceptance.",
        );
    } finally {
      acceptanceInFlight.current = false;
      if (mounted.current) setAccepting(false);
    }
  }
  const valid =
    requirements.trim().length > 0 &&
    new TextEncoder().encode(requirements).byteLength <=
      AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1;
  const intent = accepted?.intentDocument ?? candidate?.intentDocument;
  return (
    <section
      aria-label="Requirements preview"
      className="project-setup intent-preview"
    >
      <form
        onSubmit={(event) => {
          void preview(event);
        }}
      >
        <label htmlFor="intent-requirements">What do you want to build?</label>
        <p id="intent-requirements-help">
          Describe the application, its users, data and constraints. Temporary
          prompts and previews stay in memory and are discarded when you leave
          this page.
        </p>
        <textarea
          id="intent-requirements"
          aria-describedby="intent-requirements-help"
          rows={6}
          maxLength={AI_INTENT_PREVIEW_REQUIREMENTS_MAX_BYTES_V1}
          value={requirements}
          disabled={pending || accepting}
          autoComplete="off"
          onChange={(event) => {
            setRequirements(event.target.value);
          }}
        />
        <button
          className="button button--primary"
          type="submit"
          disabled={
            !editingAvailable ||
            pending ||
            accepting ||
            !valid ||
            currentAuthority() === undefined
          }
        >
          {pending ? "Preparing preview…" : "Preview requirements"}
        </button>
        {pending ? (
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              attempt.current?.abort();
            }}
          >
            Stop preview
          </button>
        ) : null}
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {intent === undefined ? null : (
        <section aria-label="Extracted requirements">
          <h2>
            {accepted === null
              ? "Requirements to review"
              : "Accepted requirements"}
          </h2>
          <IntentRequirementsDetails
            intent={intent}
            requestedMode={requestedMode}
          />
          {candidate?.proposalContext.assumptions.length ? (
            <section>
              <h3>Additional assumptions</h3>
              <ul>
                {candidate.proposalContext.assumptions.map((item) => (
                  <li key={item.assumptionId}>{item.statement}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {candidate?.proposalContext.unknowns.length ? (
            <section>
              <h3>Additional questions</h3>
              <ul>
                {candidate.proposalContext.unknowns.map((item) => (
                  <li key={item.unknownId}>
                    {item.question}
                    {item.blocking ? " (blocking)" : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p>
            {accepted === null
              ? "Receiving a preview does not accept requirements or apply changes to the canvas."
              : "These requirements are saved to this project. Canvas changes require a separate review."}
          </p>
          {onAccept !== undefined && accepted === null ? (
            <button
              className="button button--primary"
              type="button"
              disabled={pending || accepting || !editingAvailable}
              onClick={() => {
                void accept();
              }}
            >
              {accepting
                ? "Saving requirements…"
                : "Accept and save requirements"}
            </button>
          ) : null}
          <button
            className="button button--secondary"
            type="button"
            disabled={pending || accepting}
            onClick={() => {
              retained.current = null;
              setCandidate(null);
              originalAuthority.current = null;
              setAccepted(null);
              setMessage(
                accepted === null
                  ? "Preview discarded."
                  : "Accepted requirements remain saved to this project.",
              );
            }}
          >
            {accepted === null ? "Discard preview" : "Close requirements"}
          </button>
        </section>
      )}
    </section>
  );
}
