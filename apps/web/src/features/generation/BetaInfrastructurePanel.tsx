import {
  describeBetaInfrastructureCredits,
  BetaInfrastructureRequestError,
  requestBetaInfrastructureProposal,
} from "./beta-infrastructure-client.js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { AiProposalReview, AiWorkflowProgress } from "./AiProposalReview.js";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { useAiCapabilities } from "../../api/use-ai-capabilities.js";
import { Button, Disclosure } from "@cloudmarkup/ui";
import {
  betaInfrastructureProposalSchema,
  digestCanonicalValue,
  type BetaInfrastructureProposal,
} from "@cloudmarkup/schemas";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { mapApiError } from "../../api/api-errors.js";
import { getCognitoAccessToken } from "../auth/cognito-browser-auth.js";
import {
  useEditorDocumentSession,
  useEditorSessionStoreApi,
} from "../editor/session/index.js";
import { prepareBetaInfrastructureProposal } from "./beta-infrastructure-proposal.js";
import type { PreparedResourceRepair } from "../editor/model/resource-repair-command.js";
import type { ValidationFinding } from "@cloudmarkup/domain";
import {
  betaInfrastructureSelectedIssue,
  unsupportedBetaInfrastructureIssueRepair,
} from "./beta-infrastructure-issue.js";

/** Constructed only from reviewed local guard copy, never remote exceptions. */
class ProposalPreparationError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super("Proposal preparation was blocked.");
    this.safeMessage = safeMessage;
  }
}

export function BetaInfrastructurePanel({
  projectId,
  editingAvailable = true,
  initialRequirements = "",
  selectedIssue,
}: {
  readonly projectId: string;
  readonly editingAvailable?: boolean;
  readonly initialRequirements?: string;
  readonly selectedIssue?: ValidationFinding;
}) {
  const session = useEditorDocumentSession();
  const activityStore = useEditorSessionStoreApi();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const availability = useAiCapabilities();
  const [requirements, setRequirements] = useState(initialRequirements);
  const [fsxFamily, setFsxFamily] = useState("auto");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failureReference, setFailureReference] = useState<{
    code: string;
    correlationId: string;
  } | null>(null);
  const [creditMessage, setCreditMessage] = useState("");
  const [preview, setPreview] = useState<{
    proposal: BetaInfrastructureProposal;
    prepared: PreparedResourceRepair | null;
  } | null>(null);
  const attempt = useRef<AbortController | null>(null);
  const requestInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (initialRequirements) requestInput.current?.focus();
  }, [initialRequirements]);
  const current = useRef(session);
  useLayoutEffect(() => {
    current.current = session;
  }, [session]);
  useEffect(
    () => () => {
      if (attempt.current) {
        attempt.current.abort();
        activityStore.getState().setAssistantActivity({
          status: "cancelled",
          message: "Proposal cancelled when the editor closed.",
        });
      }
    },
    [projectId, activityStore],
  );
  useEffect(() => {
    if (!editingAvailable || runtime?.sessionExpired) {
      attempt.current?.abort();
    }
  }, [editingAvailable, runtime?.sessionExpired]);
  async function propose(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (
      session.status !== "ready" ||
      runtime === null ||
      !editingAvailable ||
      runtime.sessionExpired ||
      !availability.proposalAvailable ||
      attempt.current !== null ||
      pending
    )
      return;
    const source = session.document;
    const digest = digestCanonicalValue(source);
    const controller = new AbortController();
    attempt.current = controller;
    setPending(true);
    activityStore.getState().setAssistantActivity({
      status: "running",
      message: "Designing an infrastructure proposal…",
    });
    setPreview(null);
    setFailureReference(null);
    setCreditMessage("");
    setMessage("Designing an infrastructure proposal…");
    try {
      const unsupported = selectedIssue
        ? unsupportedBetaInfrastructureIssueRepair(source, selectedIssue)
        : null;
      if (unsupported) throw new ProposalPreparationError(unsupported);
      const selected = selectedIssue
        ? betaInfrastructureSelectedIssue(selectedIssue)
        : undefined;
      const support = await runtime.loadAiCapabilities?.(controller.signal);
      if (support?.proposalVersions[0] !== 6)
        throw new ProposalPreparationError(
          "Reviewed canvas AI is unavailable on this server. Check availability again before retrying.",
        );
      const draft = await runtime.client.requestWithMetadata("drafts.get", {
        path: { projectId },
      });
      if (
        draft.data.data.storageStatus === "publication-pending" ||
        digestCanonicalValue(draft.data.data.architectureDocument) !== digest
      )
        throw new ProposalPreparationError(
          "Save your current canvas and wait for saving to finish before requesting AI assistance.",
        );
      controller.signal.throwIfAborted();
      const result = await requestBetaInfrastructureProposal({
        projectId,
        etag: draft.metadata.etag,
        signal: controller.signal,
        accessToken: getCognitoAccessToken,
        onCredits: (receipt) => {
          setCreditMessage(describeBetaInfrastructureCredits(receipt));
        },
        onProgress: (message) => {
          setMessage(message);
          activityStore
            .getState()
            .setAssistantActivity({ status: "running", message });
        },
        request: {
          contractVersion: 1,
          proposalVersion: 6,
          ...(selected ? { selectedIssue: selected } : {}),
          requirements:
            /\bfsx\b/iu.test(requirements) && fsxFamily !== "auto"
              ? requirements.slice(0, 7800) +
                "\nFSx preference: " +
                fsxFamily +
                ". Explain any required transfer client."
              : requirements,
          architectureDocument: source,
        },
      });
      controller.signal.throwIfAborted();
      if (
        current.current.status !== "ready" ||
        digestCanonicalValue(current.current.document) !== digest ||
        result.architectureDigest !== digest
      )
        throw new ProposalPreparationError(
          "The design changed. Request a fresh proposal.",
        );
      const proposal = betaInfrastructureProposalSchema.parse(result.proposal);
      const prepared =
        "review" in proposal &&
        proposal.resources.length +
          proposal.connections.length +
          proposal.updates.length ===
          0
          ? null
          : prepareBetaInfrastructureProposal({
              document: source,
              catalog: session.catalog,
              proposal,
              createId: () => session.createId(),
              ...(selectedIssue ? { selectedIssue } : {}),
            });
      const resultDocument = prepared
        ? applyGraphCommand(source, prepared.command)
        : null;
      const receipt = result.applicability;
      if (
        proposal.contractVersion !== 6 ||
        receipt?.catalogDigest !== source.catalog.digest ||
        receipt.commandDigest !==
          (prepared ? digestCanonicalValue(prepared.command) : null) ||
        receipt.resultDigest !==
          digestCanonicalValue(
            resultDocument ? resultDocument.document : source,
          )
      )
        throw new ProposalPreparationError(
          "The proposal proof does not match the reviewed canvas changes. Request a fresh proposal.",
        );
      setPreview({ proposal, prepared });
      activityStore.getState().setAssistantActivity({
        status: "ready",
        message: "AI proposal ready for review in Assistant.",
      });
      setMessage("Review the AI response and any proposed changes.");
    } catch (error) {
      activityStore.getState().setAssistantActivity(
        controller.signal.aborted
          ? { status: "cancelled", message: "AI proposal cancelled." }
          : {
              status: "failed",
              message:
                "AI proposal could not finish. Review Assistant for details.",
            },
      );
      if (!controller.signal.aborted) {
        const mapped = mapApiError(error);
        setMessage(
          error instanceof ProposalPreparationError ||
            error instanceof BetaInfrastructureRequestError
            ? error.safeMessage
            : mapped.code === "unexpected_error"
              ? "Couldn't confirm the AI proposal; your canvas and request are kept. Check AI availability and Usage before trying again."
              : mapped.message,
        );
        setFailureReference(
          mapped.correlationId
            ? { code: mapped.code, correlationId: mapped.correlationId }
            : null,
        );
      }
    } finally {
      void runtime.queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("editor-credit-balance"),
      });
      if (attempt.current === controller) {
        attempt.current = null;
        setPending(false);
      }
    }
  }
  return (
    <section
      className="beta-infrastructure-panel"
      aria-label="AI infrastructure beta"
    >
      <h3>Canvas assistant</h3>
      <form
        onSubmit={(event) => {
          void propose(event);
        }}
      >
        <label htmlFor="beta-idea">What would you like to build?</label>
        <textarea
          id="beta-idea"
          aria-describedby="beta-idea-help"
          ref={requestInput}
          rows={4}
          maxLength={8000}
          value={requirements}
          onChange={(event) => {
            setRequirements(event.target.value);
            setPreview(null);
          }}
          disabled={pending || !editingAvailable}
          placeholder="A sign-in protected HTTP API with a database for notes"
        />
        <p id="beta-idea-help" className="ai-credit-summary">
          Uses your saved canvas. Review proposed changes before applying.
        </p>
        {/\bfsx\b/iu.test(requirements) ? (
          <label htmlFor="beta-fsx-family">
            FSx file system
            <select
              id="beta-fsx-family"
              value={fsxFamily}
              onChange={(event) => {
                setFsxFamily(event.target.value);
                setPreview(null);
              }}
              disabled={pending || !editingAvailable}
            >
              <option value="auto">Recommend for this application</option>
              <option value="Lustre">Lustre — S3-linked parallel files</option>
              <option value="Windows">Windows — SMB shares</option>
              <option value="OpenZFS">OpenZFS — Linux NFS</option>
              <option value="ONTAP">ONTAP — NetApp storage</option>
            </select>
            <span>
              The proposal explains the choice and any required networking or
              transfer client.
            </span>
          </label>
        ) : null}
        <Button
          type="submit"
          disabled={
            pending ||
            !editingAvailable ||
            (runtime?.sessionExpired ?? false) ||
            !availability.proposalAvailable ||
            requirements.trim().length < 5
          }
        >
          {pending ? "Generating…" : "Generate diagram proposal"}
        </Button>
        {pending ? (
          <Button
            type="button"
            onClick={() => {
              attempt.current?.abort();
              setMessage("Proposal cancelled.");
            }}
          >
            Cancel
          </Button>
        ) : null}
      </form>
      <p className="ai-credit-summary" role="status">
        {availability.checked ? "AI availability checked. " : ""}
        {availability.state === "loading"
          ? "Checking reviewed canvas AI availability."
          : availability.state === "error"
            ? "AI availability could not be checked."
            : availability.proposalAvailable
              ? "Save your canvas before requesting a proposal."
              : "Reviewed canvas AI is unavailable on this server. Existing proposals remain available."}
      </p>
      {pending || preview ? (
        <AiWorkflowProgress stage={pending ? "generating" : "review"} />
      ) : null}
      <Disclosure
        className="ai-context-details"
        summary="Canvas context and usage"
      >
        {session.status === "ready" ? (
          <>
            <p>
              {session.document.nodes.length} resources ·{" "}
              {session.document.edges.length} connections ·{" "}
              {session.document.provider.region}
            </p>
            <p>
              AI receives reviewed configurations, resource references,
              connection settings, permissions context and supported workload
              contracts from your saved canvas. Secret values and their locators
              are excluded; reference values are not retrieved. Missing required
              or oversized context stops the request. Permissions, reference
              settings and existing connection edits use their dedicated
              editors. Review every change before applying; validation checks do
              not prove deployment behavior.
            </p>
          </>
        ) : null}
        <p>
          Usage is based on actual model tokens. Up to 100 credits may be
          temporarily reserved; the estimate and final charge appear here.
        </p>
        <Button
          type="button"
          onClick={availability.retry}
          disabled={pending || availability.state === "loading"}
        >
          Check AI availability
        </Button>
      </Disclosure>
      {pending ? <progress aria-label="Generating diagram proposal" /> : null}
      <p role="status">{message}</p>
      {failureReference ? (
        <Disclosure summary="Technical details">
          <p>Error code: {failureReference.code}</p>
          <p>Reference: {failureReference.correlationId}</p>
        </Disclosure>
      ) : null}
      {creditMessage ? <p aria-live="polite">{creditMessage}</p> : null}
      {preview &&
      session.status === "ready" &&
      editingAvailable &&
      !runtime?.sessionExpired ? (
        <div>
          {"review" in preview.proposal &&
          preview.proposal.review.questions.length > 0 ? (
            <section className="ai-context" aria-label="Clarify your request">
              <h4>A few details will help</h4>
              <p>{preview.proposal.review.intent}</p>
              <ul>
                {preview.proposal.review.questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
              <p>
                Add your answers to the request above, then generate a new
                proposal. Each generation uses credits.
              </p>
            </section>
          ) : (
            <AiProposalReview
              proposal={preview.proposal}
              document={session.document}
              catalog={session.catalog}
              disabled={!preview.prepared}
              onApply={() => {
                if (!preview.prepared) return;
                const result = session.applyReviewedCommand(preview.prepared);
                setMessage(
                  result.ok
                    ? "Proposal applied. Review any remaining issues, then save your design. Undo is available."
                    : result.message,
                );
                if (result.ok) {
                  setPreview(null);
                  activityStore.getState().setAssistantActivity({
                    status: "applied",
                    message:
                      "AI proposal applied. Review Issues, then save your design.",
                  });
                }
              }}
            />
          )}
          <Button
            type="button"
            onClick={() => {
              setPreview(null);
              setMessage("Proposal discarded.");
              activityStore.getState().setAssistantActivity({
                status: "cancelled",
                message: "AI proposal discarded.",
              });
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}
    </section>
  );
}
