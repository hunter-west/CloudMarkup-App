import { Button, Dialog, Disclosure } from "@cloudmarkup/ui";
import { useMemo, useRef, useState } from "react";
import {
  prepareResourceRepair,
  type PreparedResourceRepair,
  type ResourceRepairKind,
} from "../model/resource-repair-command.js";
import { useEditorDocumentSession } from "../session/index.js";

export function ResourceRepairControl({
  nodeId,
  kind,
}: {
  readonly nodeId: string;
  readonly kind: ResourceRepairKind;
}) {
  const session = useEditorDocumentSession();
  const trigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<PreparedResourceRepair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const available = useMemo(() => {
    if (session.status !== "ready") return null;
    let sequence = 0;
    try {
      return prepareResourceRepair({
        document: session.document,
        catalog: session.catalog,
        nodeId,
        kind,
        createId: () => "operation_repair_availability_" + String(++sequence),
      }) === null
        ? null
        : { ready: true as const };
    } catch {
      return { ready: false as const };
    }
  }, [session.status, session.document, session.catalog, nodeId, kind]);
  if (session.status !== "ready" || available === null) return null;
  const label =
    kind === "parent-connection"
      ? "Review parent connection repair"
      : "Set up infrastructure-only export";
  return (
    <div className="selected-inspector__actions">
      {available.ready ? (
        <Button
          variant="secondary"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            try {
              setPreview(
                prepareResourceRepair({
                  document: session.document,
                  catalog: session.catalog,
                  nodeId,
                  kind,
                  createId: () => session.createId(),
                }),
              );
              setError(null);
            } catch {
              setError(
                "This repair is unavailable. Review the current resource and its ownership.",
              );
            }
          }}
        >
          {label}
        </Button>
      ) : (
        <p role="status">
          Review this resource&apos;s existing connections and ownership before
          repairing it.
        </p>
      )}
      {error === null || preview !== null ? null : <p role="alert">{error}</p>}
      {preview === null ? null : (
        <Dialog
          open
          title={preview.label}
          description="Review this change before applying it to your draft."
          onClose={() => {
            setPreview(null);
          }}
          returnFocusRef={trigger}
          footer={
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  setPreview(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const result = session.applyResourceRepair(preview);
                  if (result.ok) setPreview(null);
                  else setError(result.message);
                }}
              >
                Apply to draft
              </Button>
            </>
          }
        >
          <p>{preview.description}</p>
          <p>
            The design has not changed. Applying creates one undo step; save a
            new revision before exporting.
          </p>
          <Disclosure summary="Exact changes">
            <pre>{JSON.stringify(preview.command, null, 2)}</pre>
          </Disclosure>
          {error === null ? null : <p role="alert">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}
