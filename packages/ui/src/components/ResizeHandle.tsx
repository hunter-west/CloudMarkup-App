import type {
  ComponentPropsWithoutRef,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef } from "react";

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA's adjustable separator pattern is intentionally keyboard interactive. */

interface OptionalPointerCapture {
  releasePointerCapture?: (pointerId: number) => void;
  setPointerCapture?: (pointerId: number) => void;
}

export interface ResizeHandleProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "children" | "onChange"
> {
  readonly controlsId?: string;
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (value: number) => void;
  readonly orientation: "horizontal" | "vertical";
  readonly reverse?: boolean;
  readonly value: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * Standalone separator for independently positioned panels.
 *
 * It supports pointer and touch dragging, 8px Arrow changes, 32px Shift+Arrow
 * changes, and Home/End range shortcuts. Panel headers own collapse controls.
 */
export function ResizeHandle({
  className,
  controlsId,
  label,
  maximum,
  minimum,
  onChange,
  orientation,
  reverse = false,
  value,
  ...rest
}: ResizeHandleProps) {
  const pointerStartRef = useRef<{
    readonly coordinate: number;
    readonly value: number;
  } | null>(null);
  const boundedValue = clamp(value, minimum, maximum);
  const classes = ["cm-resize-handle", className].filter(Boolean).join(" ");
  const directionMultiplier = reverse ? -1 : 1;

  const coordinateFor = (event: ReactPointerEvent<HTMLDivElement>) =>
    orientation === "vertical" ? event.clientX : event.clientY;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrementKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const incrementKey =
      orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    const step = event.shiftKey ? 32 : 8;
    let nextValue: number | undefined;

    if (event.key === decrementKey) {
      nextValue = boundedValue - step * directionMultiplier;
    } else if (event.key === incrementKey) {
      nextValue = boundedValue + step * directionMultiplier;
    } else if (event.key === "Home") {
      nextValue = minimum;
    } else if (event.key === "End") {
      nextValue = maximum;
    }

    if (nextValue !== undefined) {
      event.preventDefault();
      onChange(clamp(nextValue, minimum, maximum));
    }
  };

  return (
    <div {...rest} className={classes} data-orientation={orientation}>
      <div
        aria-controls={controlsId}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuemax={maximum}
        aria-valuemin={minimum}
        aria-valuenow={boundedValue}
        className="cm-resize-handle__separator"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          event.preventDefault();
          pointerStartRef.current = {
            coordinate: coordinateFor(event),
            value: boundedValue,
          };
          const target =
            event.currentTarget as unknown as OptionalPointerCapture;
          target.setPointerCapture?.(event.pointerId);
        }}
        onLostPointerCapture={() => {
          pointerStartRef.current = null;
        }}
        onPointerCancel={() => {
          pointerStartRef.current = null;
        }}
        onPointerMove={(event) => {
          const start = pointerStartRef.current;
          if (start === null) {
            return;
          }
          const delta = coordinateFor(event) - start.coordinate;
          onChange(
            clamp(start.value + delta * directionMultiplier, minimum, maximum),
          );
        }}
        onPointerUp={(event) => {
          pointerStartRef.current = null;
          const target =
            event.currentTarget as unknown as OptionalPointerCapture;
          target.releasePointerCapture?.(event.pointerId);
        }}
        role="separator"
        tabIndex={0}
      />
    </div>
  );
}

/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
