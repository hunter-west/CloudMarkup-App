import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { useId } from "react";

import { ResizeHandle } from "./ResizeHandle.js";

export interface ResizablePanelProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> {
  readonly children: ReactNode;
  readonly collapsed?: boolean;
  readonly collapsedSize?: number;
  readonly defaultSize: number;
  readonly label: string;
  readonly maxSize: number;
  readonly minSize: number;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
  readonly onReset?: () => void;
  readonly onSizeChange: (size: number) => void;
  readonly orientation: "horizontal" | "vertical";
  readonly resizeDirection?: "negative" | "positive";
  readonly size: number;
}

type ResizableStyle = CSSProperties & {
  "--cm-resizable-size": string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * A named panel and adjacent separator. The separator supports pointer, touch,
 * and 8px/32px keyboard resizing without encoding feature semantics.
 */
export function ResizablePanel({
  children,
  className,
  collapsed = false,
  collapsedSize,
  defaultSize,
  label,
  maxSize,
  minSize,
  onCollapsedChange,
  onReset,
  onSizeChange,
  orientation,
  resizeDirection = "positive",
  size,
  style,
  ...rest
}: ResizablePanelProps) {
  const componentId = useId();
  const boundedSize = clamp(size, minSize, maxSize);
  const effectiveCollapsedSize =
    collapsedSize ?? (orientation === "vertical" ? 48 : 40);
  const effectiveSize = collapsed ? effectiveCollapsedSize : boundedSize;
  const classes = ["cm-resizable-panel", className].filter(Boolean).join(" ");
  const mergedStyle: ResizableStyle = {
    ...style,
    "--cm-resizable-size": `${String(effectiveSize)}px`,
  };
  const panelId = `${componentId}-panel`;

  const changeSize = (nextSize: number) => {
    if (collapsed) {
      onCollapsedChange?.(false);
    }
    onSizeChange(clamp(nextSize, minSize, maxSize));
  };

  return (
    <div
      {...rest}
      className={classes}
      data-collapsed={collapsed ? "true" : "false"}
      data-orientation={orientation}
      style={mergedStyle}
    >
      <section
        aria-labelledby={`${componentId}-label`}
        className="cm-resizable-panel__surface"
        id={panelId}
      >
        <header className="cm-resizable-panel__header">
          <span
            className="cm-resizable-panel__label"
            id={`${componentId}-label`}
          >
            {label}
          </span>
          <span className="cm-resizable-panel__actions">
            {onCollapsedChange === undefined ? null : (
              <button
                aria-expanded={!collapsed}
                className="cm-resizable-panel__action"
                onClick={() => {
                  onCollapsedChange(!collapsed);
                }}
                type="button"
              >
                {collapsed ? `Expand ${label}` : `Collapse ${label}`}
              </button>
            )}
            <button
              className="cm-resizable-panel__action"
              onClick={() => {
                onSizeChange(clamp(defaultSize, minSize, maxSize));
                onReset?.();
              }}
              type="button"
            >
              Reset {label} size
            </button>
          </span>
        </header>
        {collapsed ? null : (
          <div className="cm-resizable-panel__content">{children}</div>
        )}
      </section>
      <ResizeHandle
        controlsId={panelId}
        label={`${label} resize handle`}
        maximum={maxSize}
        minimum={minSize}
        onChange={changeSize}
        orientation={orientation}
        reverse={resizeDirection === "negative"}
        value={boundedSize}
      />
    </div>
  );
}
