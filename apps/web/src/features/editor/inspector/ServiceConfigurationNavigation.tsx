import { useRef, useState } from "react";
import { Button, FormField, Select } from "@cloudmarkup/ui";
import { ServiceSetupDialog } from "../catalog/ServiceSetupDialog.js";
import {
  useEditorDocumentSession,
  useEditorSessionStoreApi,
} from "../session/index.js";
import type { EditorCatalogService } from "../model/editor-catalog.js";
import type { SelectedNodeInspectorModel } from "./selected-resource-model.js";

export function ServiceConfigurationNavigation({
  model,
}: {
  readonly model: SelectedNodeInspectorModel;
}) {
  const session = useEditorDocumentSession();
  const store = useEditorSessionStoreApi();
  const trigger = useRef<HTMLElement>(null);
  const [setup, setSetup] = useState<{
    service: EditorCatalogService;
    replace: boolean;
  } | null>(null);
  if (session.status !== "ready") return null;
  const group = model.service.catalogGroup;
  const variants = group
    ? session.catalog.services.filter(
        (service) => service.catalogGroup?.id === group.id,
      )
    : [];
  const related = session.catalog.services.filter((service) =>
    model.service.relatedServiceTypes?.includes(service.serviceType),
  );
  const children = session.document.nodes.filter(
    (node) =>
      (node.semantic.parent?.nodeId === model.node.id ||
        session.document.edges.some(
          (edge) =>
            (edge.semantic.source.nodeId === model.node.id &&
              edge.semantic.target.nodeId === node.id) ||
            (edge.semantic.target.nodeId === model.node.id &&
              edge.semantic.source.nodeId === node.id),
        )) &&
      related.some(
        (service) => service.serviceType === node.semantic.serviceType,
      ),
  );
  if (variants.length < 2 && related.length === 0) return null;
  return (
    <section
      className="service-configuration-navigation"
      aria-label="Service type and related resources"
    >
      {group && variants.length > 1 ? (
        <FormField
          label={group.variantLabel}
          htmlFor={"service-type-" + model.node.id}
        >
          <Select
            id={"service-type-" + model.node.id}
            value={model.service.serviceType}
            onChange={(event) => {
              trigger.current = event.currentTarget;
              const service = variants.find(
                (candidate) => candidate.serviceType === event.target.value,
              );
              if (service && service.serviceType !== model.service.serviceType)
                setSetup({ service, replace: true });
            }}
          >
            {variants.map((service) => (
              <option key={service.serviceType} value={service.serviceType}>
                {service.displayName}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      {related.map((service) => (
        <Button
          key={service.serviceType}
          size="compact"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setSetup({ service, replace: false });
          }}
        >
          Add {service.displayName}
        </Button>
      ))}
      {children.map((node) => (
        <Button
          key={node.id}
          size="compact"
          onClick={() => {
            store.getState().setSelection({ kind: "node", id: node.id });
          }}
        >
          Configure {node.presentation.label}
        </Button>
      ))}
      {setup ? (
        <ServiceSetupDialog
          service={setup.service}
          onClose={() => {
            setSetup(null);
          }}
          returnFocusRef={trigger}
          {...(setup.replace
            ? { replaceNodeId: model.node.id }
            : { parentNodeId: model.node.id })}
        />
      ) : null}
    </section>
  );
}
