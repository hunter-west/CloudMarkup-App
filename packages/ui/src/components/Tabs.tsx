import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef } from "react";

export interface TabItem {
  readonly disabled?: boolean;
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
}

export type TabsSize = "compact" | "default";

export interface TabsProps {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly items: readonly TabItem[];
  readonly onValueChange: (value: string) => void;
  readonly orientation?: "horizontal" | "vertical";
  readonly size?: TabsSize;
  readonly value: string;
}

function nextEnabledIndex(
  items: readonly TabItem[],
  startIndex: number,
  step: 1 | -1,
): number {
  if (items.length === 0) {
    return -1;
  }

  let index = startIndex;

  let remaining = items.length;

  while (remaining > 0) {
    index = (index + step + items.length) % items.length;
    if (items[index]?.disabled !== true) {
      return index;
    }
    remaining -= 1;
  }

  return -1;
}

function edgeEnabledIndex(
  items: readonly TabItem[],
  direction: "first" | "last",
): number {
  if (direction === "first") {
    return items.findIndex((item) => item.disabled !== true);
  }

  return items.findLastIndex((item) => item.disabled !== true);
}

/**
 * Controlled automatic-activation tabs following the ARIA tabs pattern.
 */
export function Tabs({
  ariaLabel,
  className,
  items,
  onValueChange,
  orientation = "horizontal",
  size = "default",
  value,
}: TabsProps) {
  const componentId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requestedIndex = items.findIndex(
    (item) => item.id === value && item.disabled !== true,
  );
  const activeIndex =
    requestedIndex >= 0 ? requestedIndex : edgeEnabledIndex(items, "first");
  const classes = ["cm-tabs", className].filter(Boolean).join(" ");

  const activateIndex = (index: number) => {
    const item = items[index];
    if (item === undefined || item.disabled === true) {
      return;
    }

    onValueChange(item.id);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    let nextIndex = -1;

    if (event.key === nextKey) {
      nextIndex = nextEnabledIndex(items, index, 1);
    } else if (event.key === previousKey) {
      nextIndex = nextEnabledIndex(items, index, -1);
    } else if (event.key === "Home") {
      nextIndex = edgeEnabledIndex(items, "first");
    } else if (event.key === "End") {
      nextIndex = edgeEnabledIndex(items, "last");
    }

    if (nextIndex >= 0) {
      event.preventDefault();
      activateIndex(nextIndex);
    }
  };

  return (
    <div className={classes} data-size={size}>
      <div
        aria-label={ariaLabel}
        aria-orientation={orientation}
        className="cm-tabs__list"
        role="tablist"
      >
        {items.map((item, index) => {
          const selected = index === activeIndex;
          const tabId = `${componentId}-tab-${String(index)}`;
          const panelId = `${componentId}-panel-${String(index)}`;

          return (
            <button
              aria-controls={panelId}
              aria-selected={selected}
              className="cm-tabs__tab"
              disabled={item.disabled}
              id={tabId}
              key={item.id}
              onClick={() => {
                activateIndex(index);
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item, index) => {
        const selected = index === activeIndex;

        return (
          <div
            aria-labelledby={`${componentId}-tab-${String(index)}`}
            className="cm-tabs__panel"
            hidden={!selected}
            id={`${componentId}-panel-${String(index)}`}
            key={item.id}
            role="tabpanel"
            tabIndex={selected ? 0 : -1}
          >
            {item.panel}
          </div>
        );
      })}
    </div>
  );
}
