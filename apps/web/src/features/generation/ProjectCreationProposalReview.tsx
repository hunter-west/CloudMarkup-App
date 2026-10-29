import { AiProposalReview, AiWorkflowProgress } from "./AiProposalReview.js";
import { useMemo, useState } from "react";
import { Button, Dialog } from "@cloudmarkup/ui";
import {
  betaProposalApplicabilityReceiptV1Schema,
  digestCanonicalValue,
} from "@cloudmarkup/schemas";
import { applyGraphCommand } from "@cloudmarkup/domain";
import { useOptionalCloudMarkupQueryRuntime } from "../../api/index.js";
import { useEditorDocumentSession } from "../editor/session/index.js";
import { prepareBetaInfrastructureProposal } from "./beta-infrastructure-proposal.js";
import { describeBetaInfrastructureCredits } from "./beta-infrastructure-client.js";
import type { ProjectCreationProposal } from "./project-creation-proposal.js";

export function ProjectCreationProposalReview({
  proposal,
  editingAvailable = false,
  onClose,
}: {
  readonly proposal: ProjectCreationProposal;
  readonly editingAvailable?: boolean;
  readonly onClose: () => void;
}) {
  const session = useEditorDocumentSession();
  const runtime = useOptionalCloudMarkupQueryRuntime();
  const canApply =
    editingAvailable && runtime !== null && !runtime.sessionExpired;
  const [error, setError] = useState("");
  const prepared = useMemo(() => {
    if (session.status !== "ready") return null;
    try {
      if (
        digestCanonicalValue(session.document) !== proposal.architectureDigest
      )
        throw new Error(
          "The draft changed while your diagram was being prepared. Open Assistant to request an updated proposal.",
        );
      const assessment =
        "review" in proposal.proposal &&
        proposal.proposal.resources.length +
          proposal.proposal.connections.length +
          proposal.proposal.updates.length ===
          0;
      const command = assessment
        ? null
        : prepareBetaInfrastructureProposal({
            document: session.document,
            catalog: session.catalog,
            proposal: proposal.proposal,
            createId: () => session.createId(),
          });
      if (proposal.proposal.contractVersion === 6) {
        const parsed = betaProposalApplicabilityReceiptV1Schema.safeParse(
          proposal.applicability,
        );
        const receipt = parsed.success ? parsed.data : undefined;
        const resultDocument = command
          ? applyGraphCommand(session.document, command.command).document
          : session.document;
        if (
          receipt?.architectureDigest !== proposal.architectureDigest ||
          receipt.proposalDigest !== digestCanonicalValue(proposal.proposal) ||
          receipt.catalogDigest !== session.document.catalog.digest ||
          receipt.commandDigest !==
            (command ? digestCanonicalValue(command.command) : null) ||
          receipt.resultDigest !== digestCanonicalValue(resultDocument) ||
          receipt.kind !== (command ? "mutation" : "questions-or-assessment")
        )
          throw new Error(
            "The proposal proof does not match this project. Open Assistant to request a fresh proposal.",
          );
      }
      return {
        command,
        error: null,
      };
    } catch (caught) {
      return {
        command: null,
        error:
          caught instanceof Error
            ? caught.message
            : "The proposed diagram could not be validated.",
      };
    }
  }, [proposal, session]);
  return (
    <Dialog
      title={
        prepared?.error
          ? "Your diagram could not be confirmed"
          : "review" in proposal.proposal &&
              proposal.proposal.review.questions.length
            ? "Your project needs a little more detail"
            : "Your diagram is ready to review"
      }
      description="Review the proposal and any open questions before making changes."
      open
      onClose={onClose}
      className="project-creation-review"
    >
      <AiWorkflowProgress stage="review" />
      <p className="ai-credit-summary">
        {describeBetaInfrastructureCredits(proposal.credits)}
      </p>
      {session.status === "ready" ? (
        <AiProposalReview
          proposal={proposal.proposal}
          document={session.document}
          catalog={session.catalog}
          applyLabel="Use this diagram"
          disabled={!canApply || !prepared?.command}
          onApply={() => {
            if (!canApply || !prepared?.command) return;
            const result = session.applyReviewedCommand(prepared.command);
            if (result.ok) onClose();
            else setError(result.message);
          }}
        />
      ) : null}
      {!canApply ? (
        <p role="status">
          Editing is paused. Restore your editing session before adding this
          diagram.
        </p>
      ) : null}
      {prepared?.error || error ? (
        <p role="alert">{prepared?.error ?? error}</p>
      ) : null}
      <div className="form-actions">
        <Button onClick={onClose}>Continue with empty project</Button>
      </div>
    </Dialog>
  );
}
