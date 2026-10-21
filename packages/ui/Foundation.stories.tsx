import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import {
  Badge,
  Button,
  Checkbox,
  CodeBlock,
  Dialog,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Input,
  LoadingState,
  Popover,
  RadioGroup,
  ResizablePanel,
  SearchInput,
  Select,
  ServiceIconContainer,
  Textarea,
  ToastViewport,
  Tooltip,
} from "./src/index.js";

const meta = {
  parameters: {
    layout: "padded",
  },
  title: "Foundation/CloudMarkup visual system",
};

export default meta;
interface Story {
  readonly render: () => ReactElement;
}

function KeyboardFocusSample({ children }: { readonly children: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    wrapperRef.current?.querySelector("button")?.focus();
  }, []);

  return (
    <div ref={wrapperRef}>
      <Button>{children}</Button>
    </div>
  );
}

function DensitySample({
  density,
}: {
  readonly density: "comfortable" | "compact";
}) {
  return (
    <section data-cm-density={density}>
      <h2>{density === "comfortable" ? "Comfortable" : "Compact"} density</h2>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--cm-toolbar-gap)",
        }}
      >
        <Button variant="primary">Review revision</Button>
        <Button>Validate</Button>
        <IconButton icon="?" label="Open keyboard help" />
      </div>
    </section>
  );
}

export const ActionsStatusAndIndependentDensity: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--cm-space-6)" }}>
      <DensitySample density="comfortable" />
      <DensitySample density="compact" />
      <section>
        <h2>Action and status states</h2>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--cm-space-2)",
          }}
        >
          <Button variant="primary">Default action</Button>
          <Button>Hover target</Button>
          <KeyboardFocusSample>Keyboard focus</KeyboardFocusSample>
          <Button aria-pressed="true">Active view</Button>
          <Button disabled>Disabled action</Button>
          <Button loading loadingLabel="Checking architecture" />
          <Button variant="danger">Delete local example</Button>
          <Badge label="Complete" tone="success" />
          <Badge label="Warning" tone="warning" />
          <Badge label="Security" tone="security" />
          <Badge label="Error" tone="error" />
        </div>
        <p>
          Hover, press, and keyboard-focus the enabled controls to review their
          interaction states.
        </p>
      </section>
    </div>
  ),
};

function FormFixture() {
  const [mode, setMode] = useState("guided");
  return (
    <form
      style={{ display: "grid", gap: "var(--cm-field-gap)", maxWidth: "34rem" }}
    >
      <FormField
        description="A persistent explanation remains available in both modes."
        htmlFor="story-name"
        label="Extremely long translated-like architecture display name that wraps safely"
        required
      >
        <Input id="story-name" placeholder="Example application" />
      </FormField>
      <FormField
        description="Security impact: use a reference, never a secret value."
        htmlFor="story-reference"
        label="Secret reference"
        tone="security"
      >
        <Input id="story-reference" value="reference:not-connected" readOnly />
      </FormField>
      <FormField
        error="Choose an available synthetic environment."
        htmlFor="story-environment"
        label="Environment"
      >
        <Select aria-invalid="true" id="story-environment" defaultValue="">
          <option value="">Choose an environment</option>
          <option value="development">Development</option>
        </Select>
      </FormField>
      <div
        role="alert"
        style={{
          border: "1px solid var(--cm-color-status-error)",
          borderRadius: "var(--cm-radius-md)",
          padding: "var(--cm-space-3)",
        }}
      >
        <strong>Review 1 configuration error</strong>
        <p>Environment: choose an available synthetic environment.</p>
      </div>
      <Disclosure summary="Advanced fields (2)">
        <div
          style={{
            display: "grid",
            gap: "var(--cm-field-gap)",
            padding: "var(--cm-space-3)",
          }}
        >
          <FormField
            description="One item per line. This provider-neutral fixture exercises list input."
            htmlFor="story-list"
            label="Allowed origins"
          >
            <Textarea
              defaultValue={"https://example.test\nhttps://admin.example.test"}
              id="story-list"
              rows={3}
            />
          </FormField>
          <FormField
            description="Only a tagged deployment-time variable is selectable; no secret value is shown."
            htmlFor="story-sensitive-variable"
            label="Sensitive IaC variable"
            tone="security"
          >
            <Select id="story-sensitive-variable">
              <option>signing_key · string</option>
            </Select>
          </FormField>
        </div>
      </Disclosure>
      <SearchInput
        aria-label="Search the service catalog"
        placeholder="Search services"
      />
      <Checkbox
        label="Show explanatory guidance"
        description="Presentation only; available actions do not change."
      />
      <RadioGroup
        legend="Experience mode"
        name="story-mode"
        onValueChange={setMode}
        options={[
          { label: "Guided", value: "guided" },
          { label: "Professional", value: "professional" },
        ]}
        value={mode}
      />
    </form>
  );
}

export const FormsLongLabelsAndErrors: Story = {
  render: () => <FormFixture />,
};

export const DurableStates: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--cm-space-4)" }}>
      <EmptyState
        description="Add a locally available fixture to start this development example."
        title="No services yet"
      />
      <LoadingState
        description="Static text remains visible with reduced motion."
        progress={48}
        progressLabel="Catalog loading progress"
        title="Loading catalog"
      />
      <ErrorState
        actions={<Button>Retry</Button>}
        description="The failure remains in this durable region rather than only in a toast."
        title="Catalog could not load"
      />
      <ToastViewport
        onDismiss={(id) => {
          void id;
        }}
        toasts={[
          {
            description: "The durable activity record remains available.",
            id: "story-success",
            title: "Local preference saved",
            tone: "success",
          },
          {
            id: "story-error",
            title: "Save was not acknowledged",
            tone: "error",
          },
        ]}
      />
    </div>
  ),
};

function OverlayFixture() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: "var(--cm-space-2)" }}
    >
      <Button
        onClick={() => {
          setDialogOpen(true);
        }}
      >
        Open modal dialog
      </Button>
      <Button
        onClick={() => {
          setDrawerOpen(true);
        }}
      >
        Open modeless drawer
      </Button>
      <Tooltip content="Supplemental keyboard help">
        <button type="button">Focus for tooltip</button>
      </Tooltip>
      <Popover
        label="Version summary"
        trigger="Version"
        triggerLabel="Open version summary"
      >
        Exact synthetic version details.
      </Popover>
      <Dialog
        footer={<Button variant="primary">Review</Button>}
        onClose={() => {
          setDialogOpen(false);
        }}
        open={dialogOpen}
        title="Review a bounded decision"
      >
        Modal focus remains contained.
      </Dialog>
      <Drawer
        onClose={() => {
          setDrawerOpen(false);
        }}
        open={drawerOpen}
        title="Modeless inspector"
      >
        <Button>Drawer action</Button>
      </Drawer>
    </div>
  );
}

export const OverlaysAndFocus: Story = {
  render: () => <OverlayFixture />,
};

function ResizableFixture() {
  const [size, setSize] = useState(280);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <ResizablePanel
      collapsed={collapsed}
      defaultSize={280}
      label="Synthetic catalog"
      maxSize={400}
      minSize={224}
      onCollapsedChange={setCollapsed}
      onSizeChange={setSize}
      orientation="vertical"
      size={size}
      style={{ blockSize: "22rem" }}
    >
      Use the panel header to collapse or reopen this fixture. Pointer, touch,
      or keyboard-resize this provider-neutral panel.
    </ResizablePanel>
  );
}

export const ResizingIconsCodeAndDisclosure: Story = {
  render: () => (
    <div style={{ display: "grid", gap: "var(--cm-space-5)" }}>
      <ResizableFixture />
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: "var(--cm-space-3)",
        }}
      >
        <ServiceIconContainer label="Example service" />
        <span>Neutral placeholder with visible service name</span>
      </div>
      <CodeBlock
        code={'resource "example" "placeholder" {\n  available = false\n}'}
        label="Synthetic generated-code placeholder"
        language="hcl"
      />
      <Disclosure summary="Advanced presentation options">
        The inset focus ring stays visible inside the rounded boundary.
        Collapsing this section does not clear its content.
      </Disclosure>
    </div>
  ),
};

export const NarrowReducedMotion: Story = {
  render: () => (
    <div data-cm-reduced-motion="true" style={{ maxWidth: "20rem" }}>
      <FormFixture />
    </div>
  ),
};

export const HighContrastPreview: Story = {
  render: () => (
    <div
      data-cm-high-contrast-preview="true"
      style={{ padding: "var(--cm-space-4)" }}
    >
      <h2>High-contrast preview</h2>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: "var(--cm-space-2)" }}
      >
        <Button variant="primary">Continue</Button>
        <KeyboardFocusSample>Focused action</KeyboardFocusSample>
        <Badge label="Security warning" tone="security" />
        <Badge label="Error" tone="error" />
      </div>
    </div>
  ),
};
